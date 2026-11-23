import test from 'node:test';
import assert from 'node:assert/strict';

import { BridgeClient, BridgeError, formatExecutionResult, normalizeBase, BRIDGE_DEFAULT } from '../web/js/tools.js';

function jsonResponse(payload, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload)
  };
}

test('normalizeBase accepts bare hosts and strips trailing slashes', () => {
  assert.equal(normalizeBase('127.0.0.1:8080'), 'http://127.0.0.1:8080');
  assert.equal(normalizeBase('http://host:1///'), 'http://host:1');
  assert.equal(normalizeBase('auto'), 'auto');
  assert.equal(normalizeBase(''), 'auto');
});

test('health sends the token header and returns the payload', async () => {
  const calls = [];
  const client = new BridgeClient({
    baseUrl: 'http://127.0.0.1:9999',
    token: 'secret-token',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ ok: true, name: 'qaswara-bridge', version: '1.0.0' });
    }
  });
  const info = await client.health();
  assert.equal(info.version, '1.0.0');
  assert.equal(calls[0].url, 'http://127.0.0.1:9999/health');
  assert.equal(calls[0].init.headers['X-Jarvis-Token'], 'secret-token');
});

test('401 becomes an actionable auth error', async () => {
  const client = new BridgeClient({
    baseUrl: 'http://127.0.0.1:9999',
    fetchImpl: async () => jsonResponse({ error: { code: 'unauthorized' } }, { status: 401 })
  });
  await assert.rejects(
    () => client.health(),
    (err) => err instanceof BridgeError && err.code === 'auth' && /Token|رمز/.test(err.message)
  );
});

test('policy rejections are surfaced separately from generic HTTP errors', async () => {
  const client = new BridgeClient({
    baseUrl: 'http://127.0.0.1:9999',
    fetchImpl: async () =>
      jsonResponse({ error: { code: 'policy_blocked', message: 'الجسر رفض الأمر', reason: 'rm -rf /' } }, { status: 403 })
  });
  await assert.rejects(
    () => client.execute({ code: 'rm -rf /' }),
    (err) => err.code === 'policy' && err.reason.includes('rm -rf')
  );
});

test('auto mode probes same-origin first, then falls back to 127.0.0.1:8080', async () => {
  const urls = [];
  const client = new BridgeClient({
    baseUrl: 'auto',
    origin: 'https://app.example',
    protocol: 'https:',
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.startsWith('https://app.example')) throw new TypeError('offline');
      return jsonResponse({ ok: true });
    }
  });
  const info = await client.health();
  assert.equal(info.ok, true);
  assert.equal(client.resolvedBase, BRIDGE_DEFAULT);
  assert.deepEqual(urls.slice(0, 2), ['https://app.example/health', `${BRIDGE_DEFAULT}/health`]);
  assert.equal(new Set(urls.slice(1)).size, 1, 'after resolution every call uses the same base');
});

test('network failure maps to an offline BridgeError with a Termux hint', async () => {
  const client = new BridgeClient({
    baseUrl: 'http://127.0.0.1:9999',
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch');
    }
  });
  await assert.rejects(
    () => client.health(),
    (err) => err.code === 'offline' && /Termux/.test(err.message)
  );
});

test('slow bridges time out instead of hanging the UI', async () => {
  const client = new BridgeClient({
    baseUrl: 'http://127.0.0.1:9999',
    timeoutMs: 25,
    fetchImpl: (url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      })
  });
  await assert.rejects(
    () => client.health(),
    (err) => err.code === 'timeout'
  );
});

test('execute posts code/lang/timeout as JSON', async () => {
  let body = null;
  const client = new BridgeClient({
    baseUrl: 'http://127.0.0.1:9999',
    fetchImpl: async (url, init) => {
      body = JSON.parse(init.body);
      return jsonResponse({ ok: true, exitCode: 0, stdout: 'hi' });
    }
  });
  const result = await client.execute({ code: 'echo hi', lang: 'bash', timeout: 30 });
  assert.equal(result.stdout, 'hi');
  assert.equal(body.code, 'echo hi');
  assert.equal(body.lang, 'bash');
  assert.equal(body.timeout, 30);
});

test('non-JSON bridge responses raise a protocol error', async () => {
  const client = new BridgeClient({
    baseUrl: 'http://127.0.0.1:9999',
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<html>proxy error</html>' })
  });
  await assert.rejects(() => client.health(), (err) => err.code === 'protocol');
});

test('formatExecutionResult summarises and truncates observations', () => {
  const text = formatExecutionResult({
    exitCode: 2,
    durationMs: 12,
    stdout: 'out',
    stderr: 'bad',
    cwd: '.',
    lang: 'bash'
  });
  assert.match(text, /exit=2/);
  assert.match(text, /stdout:\nout/);
  assert.match(text, /stderr:\nbad/);

  const long = formatExecutionResult({ exitCode: 0, stdout: 'x'.repeat(20000) }, { maxChars: 500 });
  assert.ok(long.length <= 600);
  assert.match(long, /اختصار/);
});
