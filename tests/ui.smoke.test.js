/**
 * DOM smoke tests: boot the real index.html + app.js in jsdom against stub
 * HTTP servers, then drive the QASWARA UI the way a user would.
 *
 * Skipped automatically when the optional dev dependency `jsdom` is absent.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';

let JSDOM = null;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  JSDOM = null;
}

const HTML = (await fs.readFile(new URL('../web/index.html', import.meta.url), 'utf8')).replace(
  /<script type="module"[^>]*><\/script>/g,
  ''
);

let bootCounter = 0;

function startBridgeStub() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      const send = (payload, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health') {
        return send({
          ok: true,
          name: 'qaswara-bridge',
          version: '2.0.0',
          workspace: '/tmp/work',
          authRequired: false,
          memoryCount: 0,
          memoryFts: true,
          shell: 'bash',
          tools: ['exec', 'read_file', 'write_file', 'list_dir', 'memory_search', 'memory_save', 'device_info']
        });
      }
      if (url.pathname === '/execute') {
        calls.push(body);
        return send({
          ok: true,
          exitCode: 0,
          stdout: `stub-output:${body.code}`,
          stderr: '',
          durationMs: 2,
          cwd: '.',
          lang: body.lang || 'bash'
        });
      }
      if (url.pathname === '/device') {
        return send({
          ok: true,
          binaries: ['bash', 'python3', 'ffmpeg'],
          pythonModules: ['sqlite3'],
          capabilities: { shell: true, files: true, screen_capture: false, media_audio: true },
          advice: [{ need: 'rish', reason: 'التقاط الشاشة', install: 'pkg install termux-api' }]
        });
      }
      if (url.pathname === '/memory') {
        if (req.method === 'POST') return send({ ok: true, item: { id: 1, kind: body.kind, content: body.content } }, 201);
        return send({ ok: true, items: [] });
      }
      return send({ ok: false, error: { code: 'not_found', message: 'no' } }, 404);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, calls }));
  });
}

function startProviderStub() {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      const messages = body.messages || [];
      const observations = messages.filter((m) => m.role === 'user' && String(m.content).startsWith('OBSERVATION')).length;
      const content =
        observations === 0
          ? JSON.stringify({
              thought: 'أفحص الملفات',
              action: { tool: 'exec', args: { code: 'echo hi', lang: 'bash', timeout: 10 } }
            })
          : JSON.stringify({ thought: 'انتهى', final: '**تقرير:** نفّذت أمراً واحداً بنجاح.' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function boot({ settings, kind = 'offline' } = {}) {
  const dom = new JSDOM(HTML, {
    url: 'http://127.0.0.1:8080/',
    pretendToBeVisual: true,
    runScripts: 'outside-only'
  });
  const { window } = dom;

  window.localStorage.setItem(
    'qaswara.agent.v2',
    JSON.stringify({
      version: 2,
      settings: { bridgeUrl: 'auto', safetyMode: 'confirm', ...settings },
      personaRules: '',
      memories: [],
      sessions: [],
      activeSessionId: null
    })
  );

  const noopInterval = () => 0;
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const timers = new Set();
  const saved = {
    interval: globalThis.setInterval,
    setTimeout: realSetTimeout,
    clearTimeout: realClearTimeout,
    window: globalThis.window,
    document: globalThis.document,
    location: globalThis.location,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    localStorage: globalThis.localStorage
  };
  globalThis.setInterval = noopInterval;
  globalThis.setTimeout = (fn, ms, ...args) => {
    const id = realSetTimeout(fn, ms, ...args);
    timers.add(id);
    return id;
  };
  globalThis.clearTimeout = (id) => {
    timers.delete(id);
    realClearTimeout(id);
  };
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.location = window.location;
  globalThis.localStorage = window.localStorage;
  globalThis.requestAnimationFrame = (cb) => globalThis.setTimeout(cb, 0);

  bootCounter += 1;
  await import(`../web/js/app.js?boot=${bootCounter}`);
  await waitFor(() => window.document.body.dataset.qaswaraReady === '1', { label: 'app ready' });
  if (kind === 'bridge') {
    window.qaswara.state.bridge = window.qaswara.state.bridge || null;
    await window.qaswara.checkBridge();
  }

  return {
    dom,
    window,
    document: window.document,
    app: window.qaswara,
    store: window.qaswara.store,
    async restore() {
      await new Promise((resolve) => realSetTimeout(resolve, 120));
      for (const id of timers) realClearTimeout(id);
      timers.clear();
      dom.window.close();
      globalThis.setInterval = saved.interval;
      globalThis.setTimeout = saved.setTimeout;
      globalThis.clearTimeout = saved.clearTimeout;
      if (saved.window === undefined) delete globalThis.window;
      else globalThis.window = saved.window;
      if (saved.document === undefined) delete globalThis.document;
      else globalThis.document = saved.document;
      if (saved.location === undefined) delete globalThis.location;
      else globalThis.location = saved.location;
      if (saved.requestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
      else globalThis.requestAnimationFrame = saved.requestAnimationFrame;
      if (saved.localStorage === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = saved.localStorage;
    }
  };
}

async function waitFor(fn, { timeout = 4000, label = 'condition' } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('ui: boot renders the QASWARA command center without JS errors', async (t) => {
  if (!JSDOM) return t.skip('jsdom not installed');
  const app = await boot();
  try {
    const doc = app.document;
    assert.ok(doc.getElementById('input'), 'composer exists');
    assert.match(doc.title, /قسورة/);
    assert.match(doc.querySelector('.brand-text h1').textContent, /QASWARA/);
    assert.equal(doc.getElementById('setProvider').options.length, 6, 'all providers offered');
    assert.ok(doc.getElementById('setModel').value, 'a default model is preselected');
    assert.match(doc.getElementById('safetyLabel').textContent, /تأكيد/);
    assert.equal(doc.getElementById('watermark').hidden, false, 'watermark visible on empty chat');
    assert.equal(doc.querySelectorAll('.msg').length, 0, 'no fake messages');
    assert.equal(doc.querySelectorAll('.suggestions, .chip-suggestion').length, 0, 'no suggestion chips');
    assert.ok(doc.getElementById('thinking'), 'live thinking panel exists');
    assert.match(doc.getElementById('thinking').textContent, /طريقة التفكير/);
  } finally {
    await app.restore();
  }
});

test('ui: the watermark hides as soon as the user types', async (t) => {
  if (!JSDOM) return t.skip('jsdom not installed');
  const app = await boot();
  try {
    const input = app.document.getElementById('input');
    const watermark = app.document.getElementById('watermark');
    input.value = 'مرحبا';
    input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    assert.equal(watermark.classList.contains('hidden'), true);
    input.value = '';
    input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    assert.equal(watermark.classList.contains('hidden'), false);
  } finally {
    await app.restore();
  }
});

test('ui: "تذكر دائماً" trains memory locally without any network key', async (t) => {
  if (!JSDOM) return t.skip('jsdom not installed');
  const app = await boot();
  try {
    const doc = app.document;
    doc.getElementById('input').value = 'تذكر دائماً: أجب بالعربية وباختصار';
    doc.getElementById('btnSend').click();

    await waitFor(() => app.store.state.memories.length === 1, { label: 'memory saved' });
    assert.equal(app.store.state.memories[0].kind, 'rule');
    assert.match(app.store.state.memories[0].content, /أجب بالعربية/);
    const messages = app.store.activeSession.messages;
    assert.equal(messages.length, 2, 'user + confirmation');
    assert.match(messages[1].content, /الذاكرة الدائمة/);
  } finally {
    await app.restore();
  }
});

test('ui: safety modal applies a new mode after confirmation', async (t) => {
  if (!JSDOM) return t.skip('jsdom not installed');
  const app = await boot();
  try {
    const doc = app.document;
    doc.getElementById('btnSafety').click();
    assert.equal(doc.getElementById('modalSafety').hidden, false);
    const auto = doc.querySelector('input[name="safety"][value="auto"]');
    auto.checked = true;
    auto.dispatchEvent(new app.window.Event('change', { bubbles: true }));
    doc.getElementById('btnApplySafety').click();
    assert.equal(app.store.settings.safetyMode, 'auto');
    assert.match(doc.getElementById('safetyLabel').textContent, /تلقائي/);
    assert.equal(doc.getElementById('modalSafety').hidden, true);
  } finally {
    await app.restore();
  }
});

test('ui: the model picker switches brains and Auto-Genius', async (t) => {
  if (!JSDOM) return t.skip('jsdom not installed');
  const app = await boot();
  try {
    const doc = app.document;
    const picker = doc.getElementById('modelChoice');
    picker.value = 'deepseek-chat';
    picker.dispatchEvent(new app.window.Event('change', { bubbles: true }));
    assert.equal(app.store.settings.provider, 'deepseek');
    assert.equal(app.store.settings.model, 'deepseek-chat');

    picker.value = 'auto';
    picker.dispatchEvent(new app.window.Event('change', { bubbles: true }));
    assert.equal(app.store.settings.autoModel, true);
    assert.match(doc.getElementById('btnLive').textContent, /لايف/);
  } finally {
    await app.restore();
  }
});

test('ui: the internet kill switch asks for confirmation before toggling', async (t) => {
  if (!JSDOM) return t.skip('jsdom not installed');
  const app = await boot();
  try {
    const doc = app.document;
    assert.equal(app.store.settings.internetEnabled, true);
    doc.getElementById('btnInternet').click();
    assert.equal(doc.getElementById('modalInternet').hidden, false);
    assert.match(doc.getElementById('internetText').textContent, /الإنترنت مفتوح/);
    doc.getElementById('btnInternetConfirm').click();
    assert.equal(app.store.settings.internetEnabled, false);
    assert.match(doc.getElementById('netLabel').textContent, /معزول/);
    assert.equal(doc.getElementById('modalInternet').hidden, true);
  } finally {
    await app.restore();
  }
});

test('ui: files lab lists files and refuses a quiz with no material', async (t) => {
  if (!JSDOM) return t.skip('jsdom not installed');
  const app = await boot();
  try {
    const doc = app.document;
    doc.getElementById('btnFilesQuiz').click();
    assert.match(doc.getElementById('toast').textContent, /أضف ملفاً/);
    assert.match(doc.getElementById('filesList').textContent, /لا ملفات/);

    const file = new app.window.File(['سطر أول\nسطر ثانٍ'], 'notes.txt', { type: 'text/plain' });
    await app.app.state.lab.addFiles([file]);
    assert.equal(app.app.state.lab.ready.length, 1);
    assert.match(app.app.state.lab.ready[0].text, /سطر أول/);
  } finally {
    await app.restore();
  }
});

test('ui: a full agent turn goes through the bridge and fills the thinking panel', async (t) => {
  if (!JSDOM) return t.skip('jsdom not installed');
  const bridge = await startBridgeStub();
  const provider = await startProviderStub();
  const app = await boot({
    kind: 'bridge',
    settings: {
      provider: 'custom',
      apiKey: 'test-key',
      model: 'stub-model',
      customBaseUrl: `http://127.0.0.1:${provider.port}/v1`,
      bridgeUrl: `http://127.0.0.1:${bridge.port}`,
      bridgeToken: '',
      maxSteps: 4
    }
  });
  try {
    const doc = app.document;
    doc.getElementById('input').value = 'نفّذ echo hi';
    doc.getElementById('btnSend').click();

    // confirm mode must ask before touching the shell — approve it like a user would
    await waitFor(() => doc.getElementById('modalConfirm').hidden === false, { label: 'confirm modal' });
    doc.getElementById('btnConfirmRun').click();

    await waitFor(() => doc.querySelectorAll('.msg-assistant').length >= 1, { label: 'assistant reply', timeout: 8000 });
    const messages = app.store.activeSession.messages;
    assert.equal(messages.length, 2);
    assert.match(messages[1].content, /نفّذت أمراً واحداً/);
    assert.ok(messages[1].steps.length >= 1, 'steps recorded');
    assert.equal(bridge.calls[0].code, 'echo hi');
    assert.match(doc.getElementById('thinkingList').textContent, /تنفيذ/);
    assert.match(doc.getElementById('thinkingList').textContent, /نتيجة/);
  } finally {
    await app.restore();
    bridge.server.close();
    provider.server.close();
  }
});

test('ui: device diagnostics render capabilities and install actions', async (t) => {
  if (!JSDOM) return t.skip('jsdom not installed');
  const bridge = await startBridgeStub();
  const app = await boot({
    kind: 'bridge',
    settings: { provider: 'gemini', apiKey: 'k', bridgeUrl: `http://127.0.0.1:${bridge.port}` }
  });
  try {
    const doc = app.document;
    doc.getElementById('btnDeviceScan').click();
    await waitFor(() => doc.querySelectorAll('#deviceSummary .cap').length >= 4, { label: 'caps rendered' });
    assert.match(doc.getElementById('deviceSummary').textContent, /screen_capture/);
    assert.match(doc.getElementById('deviceAdvice').textContent, /termux-api/);
  } finally {
    await app.restore();
    bridge.server.close();
  }
});
