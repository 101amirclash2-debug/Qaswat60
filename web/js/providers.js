/**
 * QASWARA — provider adapters.
 *
 * Two wire protocols cover every supported brain:
 *   • Gemini native (`generateContent`, supports text + inline images + audio)
 *   • OpenAI-compatible (`/chat/completions`, `/images/generations`)
 *
 * Every outbound call passes the privacy shield first: the internet kill switch
 * throws, and the secret scrubber masks keys/JWTs inside prompts.
 */

import { chatEndpoint, providerFor, LIMITS, imageEndpoint } from './config.js';
import { assertInternet, scrubSecrets, InternetBlockedError } from './privacy.js';

export function redact(text, secrets = []) {
  let out = String(text ?? '');
  for (const secret of secrets) {
    if (!secret || secret.length < 6) continue;
    out = out.split(secret).join('«محجوب»');
  }
  return out.replace(/\b(sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|gsk_[A-Za-z0-9]{20,})\b/g, '«محجوب»');
}

async function toBase64(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (typeof btoa === 'function') {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  throw new ProviderError('تعذّر ترميز الصورة في هذه البيئة.', { kind: 'protocol' });
}

export class ProviderError extends Error {
  constructor(message, { status = 0, kind = 'http', retryable = false } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.kind = kind;
    this.retryable = retryable;
  }
}

function describeHttpError(status, detail) {
  const suffix = detail ? ` — ${detail}` : '';
  switch (status) {
    case 400:
      return `طلب غير مقبول (400). تحقّق من اسم النموذج والمعاملات${suffix}`;
    case 401:
      return `المفتاح غير صالح أو منتهي (401). أعد توليده من لوحة المزوّد${suffix}`;
    case 403:
      return `المفتاح لا يملك صلاحية لهذا النموذج (403)${suffix}`;
    case 404:
      return `النموذج أو المسار غير موجود (404). راجع اسم النموذج${suffix}`;
    case 413:
      return `الطلب أكبر من حد المزوّد (413). اختصر الملف أو المحادثة${suffix}`;
    case 429:
      return `تجاوزت حدّ المعدل/الحصة (429). انتظر قليلاً أو بدّل النموذج${suffix}`;
    default:
      if (status >= 500) return `خلل مؤقت عند المزوّد (${status}). أعد المحاولة${suffix}`;
      return `فشل الطلب (${status})${suffix}`;
  }
}

function extractErrorDetail(bodyText) {
  const text = String(bodyText || '').slice(0, 1200);
  try {
    const json = JSON.parse(text);
    return json?.error?.message || json?.message || json?.error?.status || text.slice(0, 300);
  } catch {
    return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  }
}

function mergeConsecutive(contents) {
  const out = [];
  for (const item of contents) {
    const last = out[out.length - 1];
    if (last && last.role === item.role) {
      last.parts.push(...item.parts);
      out[out.length - 1] = last;
    } else {
      out.push({ role: item.role, parts: [...item.parts] });
    }
  }
  return out;
}

function geminiParts(message) {
  const parts = [];
  if (message.content && String(message.content).trim()) parts.push({ text: String(message.content) });
  for (const image of message.images || []) {
    if (!image?.base64) continue;
    parts.push({ inline_data: { mime_type: image.mime || 'image/jpeg', data: image.base64 } });
  }
  if (!parts.length) parts.push({ text: '(صورة/ملف بدون نص)' });
  return parts;
}

function openaiContent(message) {
  if (!message.images?.length) return String(message.content ?? '');
  const parts = [];
  if (message.content) parts.push({ type: 'text', text: String(message.content) });
  for (const image of message.images) {
    if (!image?.base64) continue;
    parts.push({
      type: 'image_url',
      image_url: { url: `data:${image.mime || 'image/jpeg'};base64,${image.base64}` }
    });
  }
  return parts;
}

/** Apply the secret scrubber to a whole request. */
export function protectRequest({ settings, system, messages, images = [] }) {
  const enabled = settings.scrubSecrets !== false;
  const extra = [settings.apiKey].filter(Boolean);
  let redactions = 0;
  const types = new Set();

  const scrub = (text) => {
    const result = scrubSecrets(text, { enabled, extra });
    redactions += result.redactions;
    result.types.forEach((t) => types.add(t));
    return result.text;
  };

  const safeSystem = scrub(system);
  const safeMessages = messages.map((m) => ({
    ...m,
    content: scrub(m.content),
    images: m.images || []
  }));
  // Images from the live camera are never scrubbed (not text) — documented.
  return { system: safeSystem, messages: safeMessages, redactions, types: [...types], images };
}

function buildBody({ settings, provider, system, messages }) {
  if (provider.kind === 'gemini') {
    return {
      systemInstruction: { parts: [{ text: system }] },
      contents: mergeConsecutive(
        messages
          .filter((m) => (m.content && m.content.trim()) || m.images?.length)
          .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: geminiParts(m) }))
      ),
      generationConfig: {
        temperature: Math.min(2, Math.max(0, Number(settings.temperature) || 0)),
        maxOutputTokens: Number(settings.maxOutputTokens) || 2048,
        candidateCount: 1,
        ...(/^gemini-2\.5-flash/.test(settings.model) ? { thinkingConfig: { thinkingBudget: 0 } } : {})
      },
      safetySettings: []
    };
  }
  return {
    model: settings.model,
    temperature: Math.min(2, Math.max(0, Number(settings.temperature) || 0)),
    max_tokens: Number(settings.maxOutputTokens) || 2048,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...messages
        .filter((m) => (m.content && m.content.trim()) || m.images?.length)
        .map((m) => ({ role: m.role, content: openaiContent(m) }))
    ]
  };
}

export async function chat({ settings, system, messages, signal, fetchImpl = globalThis.fetch, skipScrub = false }) {
  const provider = providerFor(settings);
  if (!settings.apiKey) {
    throw new ProviderError('لا يوجد مفتاح API. افتح الإعدادات وأضِف مفتاح المزوّد.', { kind: 'config' });
  }
  assertInternet('طلب المزوّد');

  let url;
  try {
    url = chatEndpoint(settings);
  } catch (err) {
    throw new ProviderError(err.message, { kind: 'config' });
  }

  const safe = skipScrub ? { system, messages, redactions: 0, types: [] } : protectRequest({ settings, system, messages });
  const headers = { 'Content-Type': 'application/json' };
  const body = buildBody({ settings, provider, system: safe.system, messages: safe.messages });

  if (provider.kind === 'gemini') {
    headers['x-goog-api-key'] = settings.apiKey;
  } else {
    headers.Authorization = `Bearer ${settings.apiKey}`;
    if (provider.id === 'openrouter') {
      headers['HTTP-Referer'] = 'https://github.com/101amirclash2-debug/Qaswat60';
      headers['X-Title'] = 'QASWARA';
    }
  }

  let res;
  try {
    res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    if (err instanceof InternetBlockedError) throw err;
    throw new ProviderError('تعذّر الوصول إلى الشبكة. تحقّق من الاتصال أو من قاطع الإنترنت.', {
      kind: 'network',
      retryable: true
    });
  }

  const rawText = await res.text();
  if (!res.ok) {
    const detail = redact(extractErrorDetail(rawText), [settings.apiKey]);
    throw new ProviderError(describeHttpError(res.status, detail), {
      status: res.status,
      kind: 'http',
      retryable: res.status === 429 || res.status >= 500
    });
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new ProviderError('رد المزوّد ليس JSON صالحاً.', { kind: 'protocol', retryable: true });
  }

  return {
    ...parseResponse(provider.kind, data),
    provider: provider.id,
    model: settings.model,
    scrubbed: safe.redactions
  };
}

export function parseResponse(kind, data) {
  if (kind === 'gemini') {
    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const text = parts
      .filter((p) => typeof p?.text === 'string' && p.thought !== true)
      .map((p) => p.text)
      .join('')
      .trim();
    const blocked = !text && (data?.promptFeedback?.blockReason || candidate?.finishReason === 'SAFETY');
    if (!text) {
      if (blocked) {
        return {
          text: '',
          usage: data?.usageMetadata || null,
          finishReason: 'SAFETY',
          blocked: true,
          finishDetail: data?.promptFeedback?.blockReason || candidate?.finishReason
        };
      }
      if (candidate?.finishReason === 'MAX_TOKENS') {
        return { text: '', usage: data?.usageMetadata || null, finishReason: 'MAX_TOKENS', blocked: false };
      }
      throw new ProviderError('رد فارغ من Gemini.', { kind: 'protocol', retryable: true });
    }
    return { text, usage: data?.usageMetadata || null, finishReason: candidate?.finishReason || 'STOP', blocked: false };
  }

  const choice = data?.choices?.[0];
  const content = choice?.message?.content;
  const text = (typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('')
      : ''
  ).trim();

  if (!text) {
    if (choice?.finish_reason === 'content_filter') {
      return { text: '', usage: data?.usage || null, finishReason: 'content_filter', blocked: true };
    }
    if (choice?.finish_reason === 'length') {
      return { text: '', usage: data?.usage || null, finishReason: 'length', blocked: false };
    }
    throw new ProviderError('رد فارغ من المزوّد.', { kind: 'protocol', retryable: true });
  }
  return { text, usage: data?.usage || null, finishReason: choice?.finish_reason || 'stop', blocked: false };
}

/**
 * One-shot vision question (camera frame / screen capture / uploaded image).
 * @param {{settings:object, prompt:string, images:Array<{base64:string,mime?:string}>, system?:string, signal?:AbortSignal, fetchImpl?:Function}} p
 */
export async function visionChat({ settings, prompt, images, system = '', signal, fetchImpl }) {
  if (!providerFor(settings).vision) {
    throw new ProviderError(
      `النموذج الحالي (${providerFor(settings).label}) لا يدعم الصور. بدّل إلى Gemini أو GPT-4o أو Claude عبر OpenRouter.`,
      { kind: 'capability' }
    );
  }
  const result = await chat({
    settings,
    system: system || 'أنت قسورة — مساعد بصري دقيق. صِف ما تراه بدقة، واقرأ النصوص كما هي، وأجب بإيجاز.',
    messages: [{ role: 'user', content: prompt, images }],
    signal,
    fetchImpl
  });
  return result;
}

/**
 * Generate an image with the active provider.
 * @returns {{mime:string, base64:string, provider:string}}
 */
export async function generateImage({ settings, prompt, signal, fetchImpl = globalThis.fetch }) {
  const provider = providerFor(settings);
  if (!settings.apiKey) throw new ProviderError('أضف مفتاح API أولاً.', { kind: 'config' });
  assertInternet('توليد الصور');

  const url = imageEndpoint(settings);
  const headers = { 'Content-Type': 'application/json' };
  let body;

  if (provider.kind === 'gemini') {
    headers['x-goog-api-key'] = settings.apiKey;
    body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], candidateCount: 1 }
    };
  } else {
    headers.Authorization = `Bearer ${settings.apiKey}`;
    body = { model: settings.model.includes('image') ? settings.model : 'gpt-image-1', prompt, n: 1, size: '1024x1024' };
  }

  const res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  const raw = await res.text();
  if (!res.ok) {
    throw new ProviderError(describeHttpError(res.status, extractErrorDetail(raw)), {
      status: res.status,
      kind: 'http'
    });
  }
  const data = JSON.parse(raw);

  if (provider.kind === 'gemini') {
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const image = parts.find((p) => p?.inlineData?.data || p?.inline_data?.data);
    const payload = image?.inlineData || image?.inline_data;
    if (!payload?.data) {
      throw new ProviderError('لم يعُد النموذج بأي صورة. جرّب وصفاً أوضح.', { kind: 'protocol' });
    }
    return { mime: payload.mimeType || payload.mime_type || 'image/png', base64: payload.data, provider: provider.id };
  }

  const b64 = data?.data?.[0]?.b64_json;
  if (b64) return { mime: 'image/png', base64: b64, provider: provider.id };
  const remoteUrl = data?.data?.[0]?.url;
  if (remoteUrl) {
    const imgRes = await fetchImpl(remoteUrl, { signal });
    if (!imgRes.ok) throw new ProviderError('تعذّر تنزيل الصورة المولّدة.', { kind: 'network' });
    return { mime: 'image/png', base64: await toBase64(imgRes), provider: provider.id };
  }
  throw new ProviderError('رد توليد الصور غير مفهوم.', { kind: 'protocol' });
}

export async function testConnection(settings, { fetchImpl = globalThis.fetch, signal } = {}) {
  const started = Date.now();
  try {
    const result = await chat({
      settings: { ...settings, maxOutputTokens: 32, temperature: 0 },
      system: 'أنت أداة فحص اتصال. أجب بكلمة واحدة فقط: OK',
      messages: [{ role: 'user', content: 'قل OK فقط.' }],
      fetchImpl,
      signal
    });
    return {
      ok: true,
      latencyMs: Date.now() - started,
      model: settings.model,
      provider: result.provider,
      reply: result.text.slice(0, 120),
      usage: result.usage
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      model: settings.model,
      error:
        err?.name === 'AbortError'
          ? 'أُوقف الاختبار.'
          : redact(err?.message || String(err), [settings.apiKey])
    };
  }
}

export function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

export function maxOutputTokensLimit() {
  return LIMITS.maxOutputTokens;
}
