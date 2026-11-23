import test from 'node:test';
import assert from 'node:assert/strict';

import { Store, migrateState, newSession } from '../web/js/store.js';
import { STORAGE_KEY, DEFAULT_SETTINGS, LIMITS } from '../web/js/config.js';

class MemStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
}

class FailingStorage extends MemStorage {
  setItem(key, value) {
    if (String(value).length > 500) {
      const err = new Error('QuotaExceededError');
      err.name = 'QuotaExceededError';
      throw err;
    }
    super.setItem(key, value);
  }
}

const makeStore = (storage = new MemStorage()) => new Store({ storage });

test('a corrupted blob never bricks the app and is preserved for inspection', () => {
  const storage = new MemStorage();
  storage.setItem(STORAGE_KEY, '{"sessions": [not json');
  const store = makeStore(storage);
  assert.deepEqual(store.state.sessions, []);
  assert.equal(store.settings.provider, DEFAULT_SETTINGS.provider);
  assert.ok(storage.getItem(`${STORAGE_KEY}.corrupt`).includes('not json'));
});

test('migrateState drops invalid entries instead of throwing', () => {
  const state = migrateState({
    settings: { provider: 'nope', maxSteps: '999', temperature: 9, safetyMode: 'yolo' },
    sessions: [{ id: 'a', messages: [{ role: 'system', content: 'x' }, { role: 'user', content: 'hi' }] }, null, 'x'],
    memories: [{ content: 'ok' }, { content: '' }, 42]
  });
  assert.equal(state.settings.provider, 'gemini');
  assert.equal(state.settings.maxSteps, LIMITS.maxSteps.max);
  assert.equal(state.settings.temperature, 2);
  assert.equal(state.settings.safetyMode, 'confirm');
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].messages.length, 1, 'system messages are not persisted');
  assert.equal(state.memories.length, 1);
});

test('settings are clamped and persisted', () => {
  const store = makeStore();
  store.updateSettings({ maxSteps: 500, maxOutputTokens: 999999, historyWindow: 1, bridgeTimeoutMs: 1 });
  assert.equal(store.settings.maxSteps, LIMITS.maxSteps.max);
  assert.equal(store.settings.maxOutputTokens, LIMITS.maxOutputTokens.max);
  assert.equal(store.settings.historyWindow, 2);
  assert.equal(store.settings.bridgeTimeoutMs, 5000);
});

test('sessions get titles from the first user message and can be selected/deleted', () => {
  const store = makeStore();
  const session = store.createSession();
  store.appendMessage(session.id, { role: 'user', content: 'رتّب ملفاتي في مجلد واحد' });
  assert.match(store.activeSession.title, /رتّب ملفاتي/);

  const second = store.createSession();
  store.selectSession(session.id);
  assert.equal(store.state.activeSessionId, session.id);

  store.deleteSession(session.id);
  assert.equal(store.state.sessions.length, 1);
  assert.equal(store.activeSession.id, second.id);
});

test('memory is deduplicated case-insensitively and capped', () => {
  const store = makeStore();
  const first = store.addMemory({ kind: 'fact', content: 'اسمي أمير' });
  const dupe = store.addMemory({ kind: 'fact', content: 'اسمي أمير' });
  assert.equal(first.id, dupe.id);
  assert.equal(store.state.memories.length, 1);

  for (let i = 0; i < 600; i += 1) store.addMemory({ content: `معلومة ${i}` });
  assert.equal(store.state.memories.length, 500);
});

test('persona rules round-trip and are capped', () => {
  const store = makeStore();
  store.setPersonaRules('قاعدة');
  assert.equal(store.state.personaRules, 'قاعدة');
  store.setPersonaRules('x'.repeat(20000));
  assert.equal(store.state.personaRules.length, 8000);
});

test('export/import round-trips sessions and memory', () => {
  const store = makeStore();
  const session = store.createSession();
  store.appendMessage(session.id, { role: 'user', content: 'مرحبا' });
  store.appendMessage(session.id, { role: 'assistant', content: 'أهلاً', steps: [{ tool: 'exec', status: 'ok' }] });
  store.addMemory({ kind: 'rule', content: 'أجب بالعربية' });
  store.setPersonaRules('شخصية');

  const dump = store.exportJSON();
  const other = makeStore();
  other.importJSON(dump);

  assert.equal(other.state.memories.length, 1);
  assert.equal(other.state.personaRules, 'شخصية');
  assert.equal(other.state.sessions[0].messages.length, 2);
  assert.equal(other.state.sessions[0].messages[1].steps[0].tool, 'exec');
});

test('importing garbage raises a clear error and keeps existing data', () => {
  const store = makeStore();
  store.addMemory({ content: 'مهم' });
  assert.throws(() => store.importJSON('not json'), /ليس JSON/);
  assert.throws(() => store.importJSON('{"foo":1}'), /لا يحتوي/);
  assert.equal(store.state.memories.length, 1);
});

test('quota exhaustion notifies once and keeps the newest sessions', () => {
  const store = makeStore(new FailingStorage());
  let notified = 0;
  store.onError = () => {
    notified += 1;
  };
  for (let i = 0; i < 12; i += 1) {
    const session = store.createSession();
    store.appendMessage(session.id, { role: 'user', content: 'x'.repeat(200) });
    store.save({ immediate: true });
  }
  assert.ok(notified >= 1, 'the UI must be told about the quota problem');
  assert.ok(store.state.sessions.length <= 12);
});

test('newSession produces unique ids', () => {
  const ids = new Set(Array.from({ length: 50 }, () => newSession().id));
  assert.equal(ids.size, 50);
});
