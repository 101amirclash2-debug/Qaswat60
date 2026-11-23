/**
 * QASWARA — privacy shield.
 *
 *  1. Secret scrubber: removes provider keys / JWTs / private keys from anything
 *     sent to a cloud model, so a pasted env file or log cannot leak a live key.
 *  2. Internet kill switch: a hard client-side gate. While it is closed, no
 *     request leaves the device towards a model provider (the local bridge is
 *     still reachable — it is on 127.0.0.1).
 *
 * Both are deliberately dependency-free and unit-tested.
 */

export const SECRET_PATTERNS = [
  { name: 'openai/groq key', re: /\b(?:sk|gsk|pk)[-_][A-Za-z0-9_-]{16,}\b/g },
  { name: 'google api key', re: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { name: 'anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g },
  { name: 'openrouter key', re: /\bsk-or-v1-[A-Za-z0-9]{20,}\b/g },
  { name: 'github token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: 'slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'aws key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: 'bearer header', re: /\bBearer\s+[A-Za-z0-9._-]{20,}/g }
];

/**
 * Mask secrets in a string.
 * @returns {{text:string, redactions:number, types:string[]}}
 */
export function scrubSecrets(text, { enabled = true, extra = [] } = {}) {
  const value = String(text ?? '');
  if (!enabled || !value) return { text: value, redactions: 0, types: [] };

  let output = value;
  let redactions = 0;
  const types = [];

  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern.re, () => {
      redactions += 1;
      if (!types.includes(pattern.name)) types.push(pattern.name);
      return `«سر محجوب: ${pattern.name}»`;
    });
  }

  for (const secret of extra) {
    if (!secret || secret.length < 8) continue;
    const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'g');
    output = output.replace(re, () => {
      redactions += 1;
      if (!types.includes('مفتاحك الحالي')) types.push('مفتاحك الحالي');
      return '«سر محجوب»';
    });
  }

  return { text: output, redactions, types };
}

/* ------------------------------------------------------------------ */
/* Internet kill switch                                                */
/* ------------------------------------------------------------------ */

let internetEnabled = true;
const listeners = new Set();

export function isInternetEnabled() {
  return internetEnabled;
}

export function setInternetEnabled(value) {
  const next = Boolean(value);
  if (next === internetEnabled) return internetEnabled;
  internetEnabled = next;
  for (const fn of listeners) {
    try {
      fn(next);
    } catch {
      /* a broken listener must never break the switch */
    }
  }
  return internetEnabled;
}

export function onInternetChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export class InternetBlockedError extends Error {
  constructor(message = 'قاطع الإنترنت مُفعّل: لا يمكن إرسال أي طلب خارجي حتى تفتحه من الشريط العلوي.') {
    super(message);
    this.name = 'InternetBlockedError';
    this.code = 'internet_blocked';
  }
}

/** Throws when the kill switch is closed. Called by every outbound adapter. */
export function assertInternet(scope = 'طلب خارجي') {
  if (!internetEnabled) throw new InternetBlockedError(`قاطع الإنترنت مُفعّل — مُنع ${scope}.`);
}
