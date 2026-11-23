import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Agent,
  AgentError,
  parseAgentResponse,
  extractJsonObject,
  repairJson,
  buildSystemPrompt,
  availableTools
} from '../web/js/agent.js';
import { normalizeSettings } from '../web/js/config.js';
import { BridgeError } from '../web/js/tools.js';

const settings = (over = {}) => normalizeSettings({ apiKey: 'test-key', maxSteps: 4, ...over });

function scriptedChat(responses) {
  let i = 0;
  const calls = [];
  const fn = async (payload) => {
    // snapshot: the agent mutates its message array after each call
    calls.push({ ...payload, messages: (payload.messages || []).map((m) => ({ ...m })) });
    const text = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return { text: typeof text === 'function' ? text(payload) : text, usage: null, provider: 'fake', model: 'fake' };
  };
  fn.calls = calls;
  return fn;
}

function fakeBridge(overrides = {}) {
  const calls = [];
  return {
    calls,
    async execute(args) {
      calls.push(args);
      return {
        ok: true,
        exitCode: 0,
        stdout: `ran:${args.code}`,
        stderr: '',
        durationMs: 5,
        cwd: '.',
        lang: args.lang
      };
    },
    async readFile(path) {
      return { path, content: 'file-body', encoding: 'utf-8', size: 9 };
    },
    async writeFile(path, content) {
      return { path, bytes: content.length };
    },
    async listDir(path) {
      return { path, entries: [{ name: 'a.txt', type: 'file', size: 10 }] };
    },
    async memorySearch() {
      return { items: [{ kind: 'fact', content: 'المستخدم اسمه أمير' }] };
    },
    ...overrides
  };
}

const action = (tool, args = {}) =>
  JSON.stringify({ thought: 'خطوة', action: { tool, args } });
const final = (text) => JSON.stringify({ thought: 'انتهى', final: text });

test('extractJsonObject handles braces inside strings and nested objects', () => {
  const text = 'prefix {"a":"}{","b":{"c":1}} suffix';
  assert.equal(extractJsonObject(text), '{"a":"}{","b":{"c":1}}');
  assert.equal(extractJsonObject('no json here'), null);
});

test('repairJson fixes fences, smart quotes and trailing commas', () => {
  const broken = '```json\n{"final":"مرحبا" ,}\n```';
  const parsed = JSON.parse(repairJson(broken));
  assert.equal(parsed.final, 'مرحبا');
});

test('parseAgentResponse recognises action, final and done aliases', () => {
  assert.equal(parseAgentResponse(action('exec', { code: 'ls' })).kind, 'action');
  assert.equal(parseAgentResponse(action('exec', { code: 'ls' })).tool, 'exec');
  assert.equal(parseAgentResponse(final('تم')).text, 'تم');
  assert.equal(parseAgentResponse('{"answer":"42"}').text, '42');
  assert.equal(parseAgentResponse('{"tool":"done","args":{"final":"انتهى"}}').kind, 'final');
  assert.equal(parseAgentResponse('{"tool":"done","args":{"final":"انتهى"}}').text, 'انتهى');
  assert.equal(parseAgentResponse('{"action":{"tool":"exec","args":"{\\"code\\":\\"ls\\"}"}}').args.code, 'ls');
  assert.equal(parseAgentResponse('{"code":"uname -a"}').tool, 'exec');
  assert.equal(parseAgentResponse('hello world').kind, 'invalid');
});

test('system prompt includes persona, memory, tool docs and the JSON protocol', () => {
  const prompt = buildSystemPrompt({
    settings: settings(),
    tools: ['exec', 'memory_search'],
    personaRules: 'أجب بالعربية دائماً',
    memories: [{ kind: 'project', content: 'مشروع قسوة', createdAt: 1 }],
    query: 'قسوة'
  });
  assert.match(prompt, /أجب بالعربية دائماً/);
  assert.match(prompt, /مشروع قسوة/);
  assert.match(prompt, /exec\(/);
  assert.match(prompt, /JSON/);
  assert.match(prompt, /لا تدّعي/);
});

test('chat-only prompt forbids pretending to execute and mentions no JSON protocol', () => {
  const prompt = buildSystemPrompt({ settings: settings(), tools: [] });
  assert.match(prompt, /لا تدّعي/);
  assert.doesNotMatch(prompt, /بروتوكول الرد/);
});

test('availableTools respects locked mode and bridge state', () => {
  assert.deepEqual(availableTools({ bridgeOnline: false, mode: 'auto' }), []);
  assert.deepEqual(availableTools({ bridgeOnline: true, mode: 'locked' }), []);
  assert.ok(availableTools({ bridgeOnline: true, mode: 'confirm' }).includes('exec'));
});

test('agent executes a multi-step plan and returns the final report', async () => {
  const events = [];
  const chat = scriptedChat([
    action('exec', { code: 'ls -la', lang: 'bash', timeout: 20 }),
    action('exec', { code: 'python3 -c "print(1)"', lang: 'python' }),
    final('أنجزت المهمة: ملفان.')
  ]);
  const bridge = fakeBridge();
  const agent = new Agent({
    settings: settings(),
    bridge,
    bridgeOnline: true,
    chatImpl: chat,
    onEvent: (e) => events.push(e),
    confirm: async () => true
  });

  const result = await agent.run({ prompt: 'رتّب الملفات', history: [] });

  assert.equal(result.final, 'أنجزت المهمة: ملفان.');
  assert.equal(result.steps.length, 2);
  assert.equal(bridge.calls.length, 2);
  assert.equal(chat.calls.length, 3);
  assert.equal(result.steps[0].status, 'ok');
  assert.match(result.steps[0].observation, /ran:ls -la/);
  assert.ok(events.some((e) => e.type === 'final'));
  // The observation must be fed back to the model, never invented.
  assert.match(chat.calls[1].messages.at(-1).content, /OBSERVATION/);
});

test('agent stops at maxSteps and forces a wrap-up report', async () => {
  const chat = scriptedChat([
    action('exec', { code: 'echo 1' }),
    action('exec', { code: 'echo 2' }),
    final('تقرير نهائي بعد استنفاد الخطوات')
  ]);
  const bridge = fakeBridge();
  const agent = new Agent({
    settings: settings({ maxSteps: 2 }),
    bridge,
    bridgeOnline: true,
    chatImpl: chat,
    confirm: async () => true
  });

  const result = await agent.run({ prompt: 'loop', history: [] });

  assert.equal(result.steps.length, 2);
  assert.equal(result.budgetExhausted, true);
  assert.equal(result.final, 'تقرير نهائي بعد استنفاد الخطوات');
  assert.equal(bridge.calls.length, 2);
  assert.equal(chat.calls.length, 3);
});

test('denied confirmation is reported to the model and nothing is executed', async () => {
  const chat = scriptedChat([
    action('exec', { code: 'sudo rm -rf /data', lang: 'bash' }),
    final('سأستخدم بديلاً آمناً.')
  ]);
  const bridge = fakeBridge();
  let asked = null;
  const agent = new Agent({
    settings: settings({ safetyMode: 'confirm' }),
    bridge,
    bridgeOnline: true,
    chatImpl: chat,
    confirm: async (req) => {
      asked = req;
      return false;
    }
  });

  const result = await agent.run({ prompt: 'احذف المجلد', history: [] });

  assert.ok(asked, 'confirmation must be requested');
  assert.equal(asked.assessment.level, 'high');
  assert.equal(bridge.calls.length, 0);
  assert.equal(result.steps[0].status, 'denied');
  assert.match(chat.calls[1].messages.at(-1).content, /DENIED/);
});

test('locked mode blocks execution without asking', async () => {
  let confirmCalls = 0;
  const agent = new Agent({
    settings: settings({ safetyMode: 'locked' }),
    bridge: fakeBridge(),
    bridgeOnline: false,
    chatImpl: scriptedChat([final('لا أدوات')]),
    confirm: async () => {
      confirmCalls += 1;
      return true;
    }
  });
  const result = await agent.run({ prompt: 'hi', history: [] });
  assert.equal(result.mode, 'chat');
  assert.equal(confirmCalls, 0);
});

test('auto mode skips confirmation for low-risk commands but asks for high-risk', async () => {
  const asked = [];
  const bridge = fakeBridge();
  const agent = new Agent({
    settings: settings({ safetyMode: 'auto' }),
    bridge,
    bridgeOnline: true,
    chatImpl: scriptedChat([action('exec', { code: 'ls' }), final('done')]),
    confirm: async (req) => {
      asked.push(req);
      return true;
    }
  });
  await agent.run({ prompt: 'list', history: [] });
  assert.equal(asked.length, 0, 'low risk must not prompt in auto mode');
  assert.equal(bridge.calls.length, 1);
});

test('a truncated provider response yields an actionable budget error', async () => {
  const agent = new Agent({
    settings: settings(),
    bridge: fakeBridge(),
    bridgeOnline: true,
    chatImpl: async () => ({ text: '', finishReason: 'MAX_TOKENS', usage: null }),
    confirm: async () => true
  });
  await assert.rejects(
    () => agent.run({ prompt: 'q', history: [] }),
    (err) => err instanceof AgentError && err.kind === 'budget' && /حدّ المخرجات/.test(err.message)
  );
});

test('prose answer is accepted when the model ignores the JSON protocol', async () => {
  const agent = new Agent({
    settings: settings(),
    bridge: fakeBridge(),
    bridgeOnline: true,
    chatImpl: scriptedChat(['هذه إجابة نصية عادية بدون JSON.']),
    confirm: async () => true
  });
  const result = await agent.run({ prompt: 'q', history: [] });
  assert.match(result.final, /إجابة نصية/);
});

test('unrecoverable protocol errors surface a helpful AgentError', async () => {
  const agent = new Agent({
    settings: settings(),
    bridge: fakeBridge(),
    bridgeOnline: true,
    chatImpl: scriptedChat(['{"action": ', '{"action": ']),
    confirm: async () => true
  });
  await assert.rejects(
    () => agent.run({ prompt: 'q', history: [] }),
    (err) => err instanceof AgentError && err.kind === 'protocol'
  );
});

test('bridge going offline twice aborts the run with a bridge error', async () => {
  let attempts = 0;
  const bridge = fakeBridge({
    async execute() {
      attempts += 1;
      throw new BridgeError('offline', { code: 'offline' });
    }
  });
  const agent = new Agent({
    settings: settings(),
    bridge,
    bridgeOnline: true,
    chatImpl: scriptedChat([
      action('exec', { code: 'ls' }),
      action('exec', { code: 'pwd' }),
      final('x')
    ]),
    confirm: async () => true
  });
  await assert.rejects(
    () => agent.run({ prompt: 'q', history: [] }),
    (err) => err instanceof AgentError && err.kind === 'bridge'
  );
  assert.equal(attempts, 2, 'the first failure is fed back as an observation; the second aborts');
});

test('aborted signal stops before any provider call', async () => {
  const controller = new AbortController();
  controller.abort();
  const agent = new Agent({
    settings: settings(),
    bridge: fakeBridge(),
    bridgeOnline: true,
    chatImpl: async () => {
      throw new Error('should not be called');
    },
    confirm: async () => true
  });
  await assert.rejects(
    () => agent.run({ prompt: 'q', history: [], signal: controller.signal }),
    (err) => err.name === 'AbortError'
  );
});

test('memory_save tool persists through the injected callback', async () => {
  const saved = [];
  const agent = new Agent({
    settings: settings(),
    bridge: fakeBridge(),
    bridgeOnline: true,
    chatImpl: scriptedChat([
      action('memory_save', { kind: 'preference', content: 'يفضّل التقارير المختصرة' }),
      final('حفظت تفضيلك.')
    ]),
    confirm: async () => true,
    saveMemory: async (item) => saved.push(item)
  });
  await agent.run({ prompt: 'تذكر أنني أفضل التقارير المختصرة', history: [] });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].kind, 'preference');
});

test('unknown tool produces an error observation instead of crashing', async () => {
  const chat = scriptedChat([action('rm_rf', { path: '/' }), final('اعتذر.')]);
  const agent = new Agent({
    settings: settings(),
    bridge: fakeBridge(),
    bridgeOnline: true,
    chatImpl: chat,
    confirm: async () => true
  });
  const result = await agent.run({ prompt: 'q', history: [] });
  assert.equal(result.steps[0].status, 'error');
  assert.match(chat.calls[1].messages.at(-1).content, /أداة غير معروفة/);
});
