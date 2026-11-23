/**
 * QASWARA — HTTP client for the local bridge.
 *
 * The bridge is the only component allowed to touch the phone: shell, files,
 * screen capture, contacts/SMS, media synthesis and app export. Every request
 * carries `X-Jarvis-Token` (kept for wire compatibility) which the bridge
 * compares in constant time.
 */

export const BRIDGE_DEFAULT = 'http://127.0.0.1:8080';

export class BridgeError extends Error {
  constructor(message, { code = 'bridge', status = 0, reason = '', serverCode = '', details = null } = {}) {
    super(message);
    this.name = 'BridgeError';
    this.code = code; // offline | auth | policy | http | timeout | protocol | aborted
    this.status = status;
    this.reason = reason;
    this.serverCode = serverCode; // e.g. missing_tool, capture_unavailable
    this.details = details; // full bridge error payload (install hints, attempts…)
  }

  /** Installation hint for self-repair, when the bridge provided one. */
  get installHint() {
    return this.details?.install || null;
  }
}

export function normalizeBase(url) {
  const raw = String(url || '').trim();
  if (!raw || raw === 'auto') return 'auto';
  const withScheme = /^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, '');
}

function withTimeout(signal, ms) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new BridgeError('انتهت مهلة الجسر.', { code: 'timeout' })),
    ms
  );
  const onAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  };
}

export class BridgeClient {
  constructor({ baseUrl = 'auto', token = '', fetchImpl = globalThis.fetch, timeoutMs = 120000, origin, protocol } = {}) {
    this.baseUrl = normalizeBase(baseUrl);
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.origin = origin;
    this.protocol = protocol;
    this.resolvedBase = this.baseUrl === 'auto' ? null : this.baseUrl;
    this.lastError = null;
  }

  get configured() {
    return this.baseUrl !== 'auto' || Boolean(this.resolvedBase);
  }

  update({ baseUrl, token, timeoutMs } = {}) {
    if (baseUrl !== undefined) {
      this.baseUrl = normalizeBase(baseUrl);
      this.resolvedBase = this.baseUrl === 'auto' ? null : this.baseUrl;
    }
    if (token !== undefined) this.token = token;
    if (timeoutMs !== undefined) this.timeoutMs = timeoutMs;
  }

  candidates() {
    if (this.baseUrl !== 'auto') return [this.baseUrl];
    const list = [];
    const origin = this.origin ?? globalThis.location?.origin;
    const protocol = this.protocol ?? globalThis.location?.protocol;
    const isHttp = origin && /^https?:$/.test(protocol || '');
    if (origin && isHttp) list.push(origin.replace(/\/+$/, ''));
    if (!list.includes(BRIDGE_DEFAULT)) list.push(BRIDGE_DEFAULT);
    return list;
  }

  async resolveBase({ signal } = {}) {
    if (this.resolvedBase) return this.resolvedBase;
    let lastErr = null;
    for (const candidate of this.candidates()) {
      try {
        const res = await this.rawFetch(candidate, '/health', { method: 'GET', timeoutMs: 5000, signal });
        if (res.ok) {
          this.resolvedBase = candidate;
          return candidate;
        }
        lastErr = new BridgeError(`الجسر رد بـ ${res.status}`, {
          code: res.status === 401 ? 'auth' : 'http',
          status: res.status
        });
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new BridgeError('الجسر غير متاح.', { code: 'offline' });
  }

  async rawFetch(base, path, { method = 'GET', body, timeoutMs, signal } = {}) {
    const { signal: timedSignal, cleanup } = withTimeout(signal, timeoutMs ?? this.timeoutMs);
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers['X-Jarvis-Token'] = this.token;
    try {
      return await this.fetchImpl(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: timedSignal,
        mode: 'cors',
        cache: 'no-store'
      });
    } catch (err) {
      if (err?.name === 'AbortError') {
        const reason = timedSignal.reason;
        if (reason instanceof BridgeError) throw reason;
        throw new BridgeError('أُلغيت العملية.', { code: 'aborted' });
      }
      throw new BridgeError('تعذّر الوصول إلى الجسر المحلي. تأكد من تشغيله في Termux ثم أعد المحاولة.', {
        code: 'offline'
      });
    } finally {
      cleanup();
    }
  }

  async call(path, { method = 'GET', body, timeoutMs, signal } = {}) {
    const base = await this.resolveBase({ signal });
    const res = await this.rawFetch(base, path, { method, body, timeoutMs, signal });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new BridgeError('رد الجسر ليس JSON صالحاً.', { code: 'protocol', status: res.status });
    }
    if (!res.ok) {
      const err = data?.error || {};
      if (res.status === 401) {
        throw new BridgeError('رمز الجسر (Token) غير صحيح. انسخه من طرفية Termux إلى الإعدادات.', {
          code: 'auth',
          status: 401
        });
      }
      if (res.status === 403 || err.code === 'policy_blocked' || err.code === 'offline_blocked') {
        throw new BridgeError(err.message || 'الجسر رفض تنفيذ الأمر سياسياً.', {
          code: 'policy',
          status: res.status,
          reason: err.reason || (err.reasons || []).join('، '),
          serverCode: err.code || '',
          details: err
        });
      }
      throw new BridgeError(err.message || `فشل طلب الجسر (${res.status}).`, {
        code: 'http',
        status: res.status,
        serverCode: err.code || '',
        details: err
      });
    }
    return data;
  }

  // ---------------- core ----------------

  async health({ signal } = {}) {
    const data = await this.call('/health', { timeoutMs: 6000, signal });
    this.lastError = null;
    return data;
  }

  /** Full capabilities snapshot: packages, termux-api, rish, ffmpeg, storage… */
  async device({ signal, refresh = false } = {}) {
    return this.call(`/device${refresh ? '?refresh=1' : ''}`, { timeoutMs: 20000, signal });
  }

  async execute({ code, lang = 'bash', cwd, timeout, signal }) {
    return this.call('/execute', {
      method: 'POST',
      body: { code, lang, cwd, timeout },
      timeoutMs: (timeout ? (timeout + 5) * 1000 : undefined) ?? this.timeoutMs,
      signal
    });
  }

  /** Allow-listed installer: pkg install <tool> | pip install <tool>. */
  async install({ manager = 'pkg', name, signal }) {
    return this.call('/install', {
      method: 'POST',
      body: { manager, name },
      timeoutMs: 600000,
      signal
    });
  }

  async readFile(path, { signal } = {}) {
    return this.call('/files/read', { method: 'POST', body: { path }, signal });
  }

  async writeFile(path, content, { append = false, signal } = {}) {
    return this.call('/files/write', { method: 'POST', body: { path, content, append }, signal });
  }

  async listDir(path = '.', { signal } = {}) {
    return this.call('/files/list', { method: 'POST', body: { path }, signal });
  }

  /** Upload binary content (base64) — camera frames, PDFs, images. */
  async uploadFile(path, base64, { mime = 'application/octet-stream', signal } = {}) {
    return this.call('/files/upload', {
      method: 'POST',
      body: { path, base64, mime },
      timeoutMs: 120000,
      signal
    });
  }

  // ---------------- phone ----------------

  /** action: contacts | call | sms | whatsapp | battery | clipboard | notify */
  async phone(payload, { signal } = {}) {
    return this.call('/phone', { method: 'POST', body: payload, timeoutMs: 60000, signal });
  }

  // ---------------- vision sources ----------------

  /** Capture the current screen (needs rish/Shizuku or an accessible screencap). */
  async captureScreen({ signal } = {}) {
    return this.call('/capture', { method: 'POST', body: { target: 'screen' }, timeoutMs: 60000, signal });
  }

  // ---------------- documents / media ----------------

  async extractFile(path, { signal } = {}) {
    return this.call('/extract', { method: 'POST', body: { path }, timeoutMs: 180000, signal });
  }

  /** kind: pdf | xlsx | docx | csv | zip | md */
  async createDocument({ kind, path, payload, signal }) {
    return this.call('/office', { method: 'POST', body: { kind, path, payload }, timeoutMs: 120000, signal });
  }

  /** action: song | video | trim | mix */
  async media(payload, { signal }) {
    return this.call('/media', { method: 'POST', body: payload, timeoutMs: 300000, signal });
  }

  /** kind: bundle | apk */
  async exportApp(payload, { signal }) {
    return this.call('/app/export', { method: 'POST', body: payload, timeoutMs: 900000, signal });
  }

  async audit({ path, code, lang, signal }) {
    return this.call('/audit', { method: 'POST', body: { path, code, lang }, timeoutMs: 120000, signal });
  }

  // ---------------- memory ----------------

  async memoryList({ signal, limit = 200 } = {}) {
    return this.call(`/memory?limit=${encodeURIComponent(limit)}`, { signal });
  }

  async memorySave({ kind, content, signal }) {
    return this.call('/memory', { method: 'POST', body: { kind, content }, signal });
  }

  async memoryDelete(id, { signal } = {}) {
    return this.call(`/memory?id=${encodeURIComponent(id)}`, { method: 'DELETE', signal });
  }

  async memorySearch(query, { signal, limit = 20 } = {}) {
    return this.call('/memory/search', { method: 'POST', body: { query, limit }, signal });
  }
}

export function formatExecutionResult(result, { maxChars = 6000 } = {}) {
  if (!result) return 'لا نتيجة.';
  const stdout = String(result.stdout ?? '');
  const stderr = String(result.stderr ?? '');
  const head = `exit=${result.exitCode ?? '?'} · ${result.durationMs ?? '?'}ms · cwd=${result.cwd || '.'} · lang=${result.lang || 'bash'}`;
  let body = '';
  if (stdout.trim()) body += `stdout:\n${stdout.trim()}\n`;
  if (stderr.trim()) body += `stderr:\n${stderr.trim()}\n`;
  if (!body) body = '(لا مخرجات)\n';
  const full = `${head}\n${body}`;
  if (full.length <= maxChars) return full;
  const half = Math.floor(maxChars / 2);
  return `${full.slice(0, half)}\n… [تم اختصار ${full.length - maxChars} حرفاً] …\n${full.slice(-half)}`;
}
