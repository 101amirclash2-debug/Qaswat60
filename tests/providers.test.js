import test from 'node:test';
import assert from 'node:assert/strict';

import { chat, parseResponse, redact, testConnection, ProviderError } from '../web/js/providers.js';
import { normalizeSettings, chatEndpoint, DEFAULT_SETTINGS } from '../web/js/config.js';

const gemini = (over = {}) =>
  normalizeSettings({ provider: 'gemini', apiKey: 'AIzaTESTKEY1234567890abcd', model: 'gemini-2.5-flash', ...over });
const groq = (over = {}) =>
  normalizeSettings({ provider: 'groq', apiKey: 'gsk_testkey1234567890abcdef', model: 'llama-3.3-70b-versatile', ...over });

function mockFetch(response, { status = 200 } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const body = typeof response === 'string' ? response : JSON.stringify(response);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => body
    };
  };
  fn.calls = calls;
  return fn;
}

test('chatEndpoint builds the right URL per protocol', () => {
  assert.equal(
    chatEndpoint(gemini()),
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
  );
  assert.equal(chatEndpoint(groq()), 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(
    chatEndpoint(normalizeSettings({ provider: 'custom', customBaseUrl: 'https://llm.local/v1', model: 'm' })),
    'https://llm.local/v1/chat/completions'
  );
  assert.throws(() => chatEndpoint(normalizeSettings({ provider: 'custom', customBaseUrl: '' })), /Base URL/);
});

test('gemini request shape: header key, systemInstruction, merged roles', async () => {
  const fetchImpl = mockFetch({
    candidates: [{ content: { parts: [{ text: 'مرحبا' }] }, finishReason: 'STOP' }],
    usageMetadata: { totalTokenCount: 12 }
  });
  const result = await chat({
    settings: gemini(),
    system: 'SYSTEM',
    messages: [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'assistant', content: 'c' },
      { role: 'user', content: 'd' }
    ],
    fetchImpl
  });

  assert.equal(result.text, 'مرحبا');
  const { url, init } = fetchImpl.calls[0];
  assert.match(url, /gemini-2\.5-flash:generateContent$/);
  assert.equal(init.headers['x-goog-api-key'], gemini().apiKey);
  const body = JSON.parse(init.body);
  assert.equal(body.systemInstruction.parts[0].text, 'SYSTEM');
  assert.deepEqual(body.contents.map((c) => c.role), ['user', 'model', 'user']);
  assert.equal(body.contents[1].parts.length, 2, 'consecutive assistant turns must merge');
  assert.equal(body.generationConfig.candidateCount, 1);
});

test('openai-compatible request shape includes bearer token and system message', async () => {
  const fetchImpl = mockFetch({ choices: [{ message: { content: 'OK' } }], usage: { total_tokens: 3 } });
  await chat({
    settings: groq(),
    system: 'SYS',
    messages: [{ role: 'user', content: 'hi' }],
    fetchImpl
  });
  const { init } = fetchImpl.calls[0];
  assert.equal(init.headers.Authorization, `Bearer ${groq().apiKey}`);
  const body = JSON.parse(init.body);
  assert.equal(body.model, 'llama-3.3-70b-versatile');
  assert.deepEqual(body.messages.map((m) => m.role), ['system', 'user']);
  assert.equal(body.max_tokens, DEFAULT_SETTINGS.maxOutputTokens);
});

test('gemini thinking parts are ignored and MAX_TOKENS is reported', async () => {
  const fetchImpl = mockFetch({
    candidates: [
      {
        content: { parts: [{ text: 'internal thinking', thought: true }, { text: 'الجواب' }] },
        finishReason: 'STOP'
      }
    ]
  });
  const res = await chat({ settings: gemini(), system: 's', messages: [{ role: 'user', content: 'q' }], fetchImpl });
  assert.equal(res.text, 'الجواب');

  const truncated = parseResponse('gemini', { candidates: [{ finishReason: 'MAX_TOKENS' }] });
  assert.equal(truncated.finishReason, 'MAX_TOKENS');
  assert.equal(truncated.text, '');
});

test('HTTP errors are mapped to actionable Arabic messages and stay retryable', async () => {
  const fetchImpl = mockFetch({ error: { message: 'rate limited' } }, { status: 429 });
  await assert.rejects(
    () => chat({ settings: groq(), system: 's', messages: [{ role: 'user', content: 'q' }], fetchImpl }),
    (err) => {
      assert.ok(err instanceof ProviderError);
      assert.equal(err.status, 429);
      assert.equal(err.retryable, true);
      assert.match(err.message, /الحصة|المعدل/);
      return true;
    }
  );

  await assert.rejects(
    () =>
      chat({
        settings: groq(),
        system: 's',
        messages: [{ role: 'user', content: 'q' }],
        fetchImpl: mockFetch({ error: { message: 'bad key' } }, { status: 401 })
      }),
    (err) => err.status === 401 && /المفتاح/.test(err.message)
  );
});

test('missing API key fails fast with a config error', async () => {
  await assert.rejects(
    () => chat({ settings: normalizeSettings({ apiKey: '' }), system: 's', messages: [], fetchImpl: mockFetch({}) }),
    (err) => err.kind === 'config'
  );
});

test('network failures are reported as retryable network errors', async () => {
  const failing = async () => {
    throw new TypeError('Failed to fetch');
  };
  await assert.rejects(
    () => chat({ settings: groq(), system: 's', messages: [{ role: 'user', content: 'q' }], fetchImpl: failing }),
    (err) => err.kind === 'network' && err.retryable === true
  );
});

test('abort errors are rethrown untouched so the UI can distinguish them', async () => {
  const aborting = async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  };
  await assert.rejects(
    () => chat({ settings: groq(), system: 's', messages: [{ role: 'user', content: 'q' }], fetchImpl: aborting }),
    (err) => err.name === 'AbortError'
  );
});

test('testConnection reports latency on success and a redacted error on failure', async () => {
  const ok = await testConnection(groq(), {
    fetchImpl: mockFetch({ choices: [{ message: { content: 'OK' } }] })
  });
  assert.equal(ok.ok, true);
  assert.equal(typeof ok.latencyMs, 'number');
  assert.equal(ok.reply, 'OK');

  const key = groq().apiKey;
  const bad = await testConnection(groq(), {
    fetchImpl: mockFetch({ error: { message: `invalid key ${key}` } }, { status: 401 })
  });
  assert.equal(bad.ok, false);
  assert.ok(!bad.error.includes(key), 'the API key must never leak into an error string');
});

test('redact hides keys and bearer-looking tokens', () => {
  const out = redact('key=AIzaTESTKEY1234567890abcd sk-abcdefghijklmnopqrstuvwx', ['AIzaTESTKEY1234567890abcd']);
  assert.ok(!out.includes('AIzaTESTKEY1234567890abcd'));
  assert.ok(!out.includes('sk-abcdefghijklmnopqrstuvwx'));
});
