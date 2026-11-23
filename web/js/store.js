/**
 * Durable state: sessions, settings, long-term memory.
 *
 * Design rules
 *  - Every read path is total: a corrupted blob returns a fresh state instead of throwing.
 *  - Writes are debounced and quota-aware (localStorage is capped on Android Chrome).
 *  - API keys never leave the device and never reach the bridge.
 */

import { STORAGE_KEY, LEGACY_STORAGE_KEY, SCHEMA_VERSION, DEFAULT_SETTINGS, normalizeSettings } from './config.js';

const EMPTY = () => ({
  version: SCHEMA_VERSION,
  settings: { ...DEFAULT_SETTINGS },
  personaRules: '',
  memories: [],
  sessions: [],
  activeSessionId: null
});

export function newId(prefix = 's') {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rnd}`;
}

export function newSession(title = '') {
  const now = Date.now();
  return {
    id: newId('session'),
    title: title || 'محادثة جديدة',
    createdAt: now,
    updatedAt: now,
    messages: []
  };
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Coerce anything into a valid state object. Never throws. */
export function migrateState(raw) {
  const state = EMPTY();
  if (!raw || typeof raw !== 'object') return state;

  state.settings = normalizeSettings(raw.settings);
  state.personaRules = typeof raw.personaRules === 'string' ? raw.personaRules : '';

  if (Array.isArray(raw.memories)) {
    state.memories = raw.memories
      .filter((m) => m && typeof m.content === 'string' && m.content.trim())
      .map((m) => ({
        id: typeof m.id === 'string' ? m.id : newId('mem'),
        kind: ['fact', 'preference', 'skill', 'project', 'rule'].includes(m.kind) ? m.kind : 'fact',
        content: m.content.trim().slice(0, 4000),
        source: typeof m.source === 'string' ? m.source : 'manual',
        createdAt: Number(m.createdAt) || Date.now(),
        synced: Boolean(m.synced)
      }));
  }

  if (Array.isArray(raw.sessions)) {
    state.sessions = raw.sessions
      .filter((s) => s && typeof s === 'object' && Array.isArray(s.messages))
      .map((s) => ({
        id: typeof s.id === 'string' ? s.id : newId('session'),
        title: typeof s.title === 'string' && s.title.trim() ? s.title.slice(0, 120) : 'محادثة',
        createdAt: Number(s.createdAt) || Date.now(),
        updatedAt: Number(s.updatedAt) || Date.now(),
        messages: s.messages
          .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .map((m) => ({
            id: typeof m.id === 'string' ? m.id : newId('msg'),
            role: m.role,
            content: m.content.slice(0, 200000),
            steps: Array.isArray(m.steps) ? m.steps.slice(0, 40) : [],
            error: Boolean(m.error),
            createdAt: Number(m.createdAt) || Date.now(),
            model: typeof m.model === 'string' ? m.model : ''
          }))
      }));
  }

  state.activeSessionId = state.sessions.some((s) => s.id === raw.activeSessionId)
    ? raw.activeSessionId
    : (state.sessions[0]?.id ?? null);

  return state;
}

export class Store {
  constructor({ key = STORAGE_KEY, storage = globalThis.localStorage } = {}) {
    this.key = key;
    this.storage = storage;
    this.state = EMPTY();
    this._timer = null;
    this._quotaWarned = false;
    this.load();
  }

  load() {
    let raw = null;
    try {
      let text = this.storage?.getItem?.(this.key);
      if (!text && LEGACY_STORAGE_KEY && LEGACY_STORAGE_KEY !== this.key) {
        // One-time migration from the previous app identity.
        text = this.storage?.getItem?.(LEGACY_STORAGE_KEY);
        if (text) this.migrated = true;
      }
      raw = text ? safeParse(text) : null;
      if (text && !raw) {
        // Keep the damaged blob for forensics instead of destroying the user's history.
        this.storage.setItem(`${this.key}.corrupt`, text.slice(0, 200000));
      }
    } catch {
      raw = null;
    }
    this.state = migrateState(raw);
    return this.state;
  }

  /** Debounced persistence — safe to call on every keystroke. */
  save({ immediate = false } = {}) {
    if (immediate) {
      if (this._timer) clearTimeout(this._timer);
      this._timer = null;
      return this.flush();
    }
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.flush();
    }, 250);
  }

  flush() {
    try {
      this.state.version = SCHEMA_VERSION;
      this.storage?.setItem?.(this.key, JSON.stringify(this.state));
      return true;
    } catch (err) {
      if (!this._quotaWarned) {
        this._quotaWarned = true;
        this.onError?.(err);
      }
      // Free space by dropping the oldest sessions rather than losing the current one.
      this._pruneOldest();
      return false;
    }
  }

  _pruneOldest() {
    if (this.state.sessions.length <= 3) return;
    const keep = [...this.state.sessions]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 3);
    this.state.sessions = this.state.sessions.filter((s) => keep.includes(s));
    try {
      this.storage?.setItem?.(this.key, JSON.stringify(this.state));
    } catch {
      /* give up quietly — in-memory state still works for this session */
    }
  }

  get settings() {
    return this.state.settings;
  }

  updateSettings(patch) {
    this.state.settings = normalizeSettings({ ...this.state.settings, ...patch });
    this.save();
    return this.state.settings;
  }

  get activeSession() {
    const id = this.state.activeSessionId;
    return this.state.sessions.find((s) => s.id === id) || null;
  }

  createSession(title) {
    const session = newSession(title);
    this.state.sessions.unshift(session);
    this.state.activeSessionId = session.id;
    this.save();
    return session;
  }

  selectSession(id) {
    if (!this.state.sessions.some((s) => s.id === id)) return null;
    this.state.activeSessionId = id;
    this.save();
    return this.activeSession;
  }

  deleteSession(id) {
    const before = this.state.sessions.length;
    this.state.sessions = this.state.sessions.filter((s) => s.id !== id);
    if (this.state.activeSessionId === id) {
      this.state.activeSessionId = this.state.sessions[0]?.id ?? null;
    }
    if (this.state.sessions.length !== before) this.save();
  }

  appendMessage(sessionId, message) {
    const session = this.state.sessions.find((s) => s.id === sessionId);
    if (!session) return null;
    const msg = {
      id: message.id || newId('msg'),
      role: message.role,
      content: message.content,
      steps: message.steps || [],
      error: Boolean(message.error),
      model: message.model || '',
      createdAt: Date.now()
    };
    session.messages.push(msg);
    session.updatedAt = Date.now();
    if (session.title === 'محادثة جديدة' && message.role === 'user') {
      session.title = message.content.replace(/\s+/g, ' ').trim().slice(0, 60) || 'محادثة';
    }
    this.save();
    return msg;
  }

  addMemory({ kind = 'fact', content, source = 'manual' }) {
    const text = String(content || '').trim();
    if (!text) return null;
    const dupe = this.state.memories.find(
      (m) => m.content.toLowerCase() === text.toLowerCase()
    );
    if (dupe) return dupe;
    const item = {
      id: newId('mem'),
      kind,
      content: text.slice(0, 4000),
      source,
      createdAt: Date.now(),
      synced: false
    };
    this.state.memories.unshift(item);
    if (this.state.memories.length > 500) this.state.memories.length = 500;
    this.save();
    return item;
  }

  removeMemory(id) {
    const before = this.state.memories.length;
    this.state.memories = this.state.memories.filter((m) => m.id !== id);
    if (this.state.memories.length !== before) this.save();
  }

  setPersonaRules(text) {
    this.state.personaRules = String(text || '').slice(0, 8000);
    this.save();
  }

  exportJSON() {
    return JSON.stringify({ exportedAt: new Date().toISOString(), ...this.state }, null, 2);
  }

  importJSON(text) {
    const raw = safeParse(text);
    if (!raw || typeof raw !== 'object') throw new Error('ملف غير صالح: ليس JSON.');
    const next = migrateState(raw);
    if (!next.sessions.length && !next.memories.length) {
      throw new Error('الملف لا يحتوي محادثات أو ذاكرة.');
    }
    this.state = next;
    this.save({ immediate: true });
    return next;
  }

  clearAll() {
    this.state = EMPTY();
    this.save({ immediate: true });
  }
}
