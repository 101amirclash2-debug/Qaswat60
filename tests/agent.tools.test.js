/**
 * QASWARA tool surface: self-diagnosis, auto-install repair, phone control,
 * captures, documents, media, app export and Artemis auditing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Agent, TOOL_DOCS, availableTools, buildSystemPrompt } from '../web/js/agent.js';
import { BridgeError } from '../web/js/tools.js';
import { normalizeSettings } from '../web/js/config.js';

function makeAgent({ settings = {}, bridge = {}, confirm = async () => true, events = [] } = {}) {
  const agent = new Agent({
    settings: normalizeSettings({ apiKey: 'k', safetyMode: 'auto', maxSteps: 3, ...settings }),
    bridge,
    bridgeOnline: true,
    confirm,
    onEvent: (event) => events.push(event)
  });
  return agent;
}

function fakeBridge(over = {}) {
  const calls = [];
  const bridge = {
    calls,
    async execute(request) {
      calls.push(['execute', request]);
      return { ok: true, exitCode: 0, stdout: 'ok', stderr: '', durationMs: 3 };
    },
    async install(request) {
      calls.push(['install', request]);
      return { ok: true, manager: request.manager, name: request.name, stdout: 'installed' };
    },
    async device() {
      return {
        binaries: ['bash', 'ffmpeg'],
        pythonModules: ['sqlite3'],
        capabilities: { shell: true, screen_capture: false, media_audio: true },
        advice: [{ need: 'rish', reason: 'التقاط الشاشة', install: 'pkg install termux-api' }]
      };
    },
    async phone(payload) {
      calls.push(['phone', payload]);
      if (payload.action === 'contacts') return { ok: true, items: [{ name: 'أحمد', number: '+967111222333' }] };
      return { ok: true, message: `تم ${payload.action}` };
    },
    async captureScreen() {
      calls.push(['capture']);
      return { ok: true, base64: 'AAAA', mime: 'image/png', method: 'rish' };
    },
    async uploadFile(path, base64) {
      calls.push(['upload', { path, bytes: base64.length }]);
      return { ok: true, path };
    },
    async extractFile(path) {
      calls.push(['extract', path]);
      return { ok: true, path, kind: 'pdf', tool: 'pdftotext', text: 'نص المستند', note: '', truncated: false };
    },
    async createDocument(payload) {
      calls.push(['office', payload]);
      return { ok: true, path: payload.path, kind: payload.kind, bytes: 1200 };
    },
    async media(payload) {
      calls.push(['media', payload]);
      return { ok: true, files: ['artifacts/song.mp3'], note: '' };
    },
    async exportApp(payload) {
      calls.push(['export', payload]);
      return { ok: true, kind: payload.kind, path: `exports/${payload.name}.zip`, bytes: 900 };
    },
    async audit(payload) {
      calls.push(['audit', payload]);
      return { ok: false, score: 60, summary: '1 ملاحظة', findings: [{ severity: 'high', rule: 'eval', line: 2 }] };
    },
    async memorySearch() {
      return { ok: true, items: [{ kind: 'rule', content: 'أجب بالعربية' }] };
    },
    ...over
  };
  return bridge;
}

test('tools: the catalogue exposes the new QASWARA abilities', () => {
  const names = Object.keys(TOOL_DOCS);
  for (const expected of [
    'exec',
    'device_info',
    'install_tool',
    'phone',
    'capture_screen',
    'extract_file',
    'create_document',
    'synth_media',
    'export_app',
    'audit_code'
  ]) {
    assert.ok(names.includes(expected), `missing ${expected}`);
  }
  assert.equal(availableTools({ bridgeOnline: false }).length, 0);
  assert.ok(availableTools({ bridgeOnline: true }).length >= 10);
  const prompt = buildSystemPrompt({
    settings: normalizeSettings({ apiKey: 'k' }),
    tools: ['exec'],
    personaRules: 'كن مختصراً'
  });
  assert.match(prompt, /قسورة/);
  assert.doesNotMatch(prompt, /JARVIS/);
});

test('tools: device_info reports capabilities and missing tools honestly', async () => {
  const bridge = fakeBridge();
  const agent = makeAgent({ bridge });
  const observation = await agent.execute('device_info', {}, {});
  assert.match(observation, /ffmpeg/);
  assert.match(observation, /screen_capture/);
  assert.match(observation, /termux-api/);
});

test('tools: a missing binary is installed automatically then the tool retries', async () => {
  let attempts = 0;
  const events = [];
  const bridge = fakeBridge({
    async execute(request) {
      attempts += 1;
      if (attempts === 1) {
        throw new BridgeError('ffmpeg غير مثبت', {
          code: 'http',
          status: 422,
          serverCode: 'missing_tool',
          details: { code: 'missing_tool', install: { manager: 'pkg', name: 'ffmpeg' } }
        });
      }
      return { ok: true, exitCode: 0, stdout: 'converted', stderr: '', durationMs: 5, code: request.code };
    }
  });
  const agent = makeAgent({ bridge, events });
  const observation = await agent.execute('exec', { code: 'ffmpeg -version' }, {});
  assert.match(observation, /converted/);
  assert.equal(attempts, 2);
  const installCall = bridge.calls.filter((c) => c[0] === 'install')[0][1];
  assert.equal(installCall.manager, 'pkg');
  assert.equal(installCall.name, 'ffmpeg');
  assert.ok(events.some((e) => e.type === 'workaround' && e.installed === true));
});

test('tools: a failed auto-install surfaces the exact missing dependency', async () => {
  const bridge = fakeBridge({
    async execute() {
      throw new BridgeError('openpyxl غير مثبت', {
        code: 'http',
        status: 422,
        details: { install: { manager: 'pip', name: 'openpyxl' } }
      });
    },
    async install() {
      throw new BridgeError('pip محجوب في وضع عدم الاتصال', { code: 'policy' });
    }
  });
  const agent = makeAgent({ bridge });
  await assert.rejects(() => agent.execute('exec', { code: 'python x.py' }, {}), /openpyxl/);
});

test('tools: phone calls ask for approval and never bypass the gate', async () => {
  const bridge = fakeBridge();
  let asked = 0;
  const agent = makeAgent({
    bridge,
    settings: { safetyMode: 'confirm' },
    confirm: async () => {
      asked += 1;
      return true;
    }
  });
  const observation = await agent.execute('phone', { action: 'call', number: '+967111222333' }, { step: {} });
  assert.equal(asked, 1);
  assert.match(observation, /تم/);

  const locked = makeAgent({ bridge, settings: { safetyMode: 'locked' } });
  const blocked = await locked.execute('phone', { action: 'sms', number: '+967111222333', message: 'hi' }, { step: {} });
  assert.match(blocked, /BLOCKED/);
});

test('tools: contacts lookup returns names and numbers', async () => {
  const agent = makeAgent({ bridge: fakeBridge() });
  const observation = await agent.execute('phone', { action: 'contacts', query: 'أحمد' }, {});
  assert.match(observation, /أحمد/);
  assert.match(observation, /967111222333/);
});

test('tools: screen capture is saved into the workspace', async () => {
  const bridge = fakeBridge();
  const agent = makeAgent({ bridge });
  const observation = await agent.execute('capture_screen', {}, {});
  assert.match(observation, /captures\/screen_/);
  assert.ok(bridge.calls.some((c) => c[0] === 'upload'));
});

test('tools: documents, songs, apps and audits are delegated with real payloads', async () => {
  const bridge = fakeBridge();
  const agent = makeAgent({ bridge });

  const doc = await agent.execute(
    'create_document',
    { kind: 'xlsx', path: 'artifacts/t.xlsx', payload: { rows: [['أ', 1]] } },
    {}
  );
  assert.match(doc, /artifacts\/t\.xlsx/);

  const media = await agent.execute('synth_media', { action: 'song', title: 'نشيد', lyrics: 'كلمات' }, {});
  assert.match(media, /artifacts\/song.mp3/);

  const exported = await agent.execute('export_app', { kind: 'bundle', name: 'Demo', files: { 'index.html': '<h1>x</h1>' } }, {});
  assert.match(exported, /exports\/Demo\.zip/);

  const audit = await agent.execute('audit_code', { code: 'eval(x)', lang: 'javascript' }, {});
  assert.match(audit, /درجة الأمان: 60/);
  assert.match(audit, /eval/);

  await assert.rejects(
    () => agent.execute('create_document', { kind: 'exe', path: 'x' }, {}),
    /نوع المستند غير مدعوم/
  );
});

test('tools: extract_file returns the text and its note', async () => {
  const agent = makeAgent({ bridge: fakeBridge() });
  const observation = await agent.execute('extract_file', { path: 'uploads/a.pdf' }, {});
  assert.match(observation, /نص المستند/);
  assert.match(observation, /pdftotext/);
});
