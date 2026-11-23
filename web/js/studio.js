/**
 * QASWARA — Creative Studio bridge between the UI and real generators.
 *
 *  image  → provider image model (Gemini 2.5 Flash Image / OpenAI images)
 *  song   → pure-Python instrumental + optional espeak vocals + ffmpeg mp3
 *  video  → ffmpeg stills/colour canvas + audio → mp4
 *  doc    → stdlib XLSX/DOCX/CSV/MD/HTML/RTF/ZIP, PDF via reportlab
 *  app    → bundle ZIP always, APK when the Android toolchain exists
 *  audit  → Artemis static reviewer
 *
 * Every function returns real paths/bytes; none of them invents success.
 */

import { generateImage } from './providers.js';

export class StudioError extends Error {
  constructor(message, { kind = 'studio', install = null, cause } = {}) {
    super(message);
    this.name = 'StudioError';
    this.kind = kind;
    this.install = install;
    this.cause = cause;
  }
}

function requireBridge(bridge) {
  if (!bridge) throw new StudioError('استوديو الإبداع يحتاج الجسر المحلي (Termux).', { kind: 'bridge' });
  return bridge;
}

/** Generate a poster/illustration and persist it on the device. */
export async function createImage({ settings, prompt, bridge, signal, size = '1024x1024' }) {
  const result = await generateImage({ settings, prompt, signal });
  let path = null;
  if (bridge) {
    try {
      path = `artifacts/image_${Date.now()}.png`;
      await bridge.uploadFile(path, result.base64, { mime: result.mime });
    } catch {
      path = null; // still usable in the browser
    }
  }
  return {
    ok: true,
    kind: 'image',
    base64: result.base64,
    mime: result.mime,
    provider: result.provider,
    path,
    prompt,
    bytes: Math.round((result.base64.length * 3) / 4),
    size
  };
}

export async function composeSong({ bridge, title, lyrics, bpm = 92, seconds = 24, scale = 'hijaz', mood = 'epic', vocals = true }) {
  const client = requireBridge(bridge);
  if (!lyrics || lyrics.trim().length < 8) {
    throw new StudioError('أضف كلمات الأغنية أولاً (٨ أحرف على الأقل).', { kind: 'input' });
  }
  const result = await client.media({
    action: 'song',
    title,
    lyrics,
    bpm,
    seconds,
    scale,
    mood,
    vocals,
    outDir: 'artifacts'
  });
  return { ok: true, kind: 'song', ...result };
}

export async function composeVideo({ bridge, images = [], audio = null, title = 'qaswara_video', secondsPerImage = 3 }) {
  const client = requireBridge(bridge);
  const result = await client.media({
    action: 'video',
    images,
    audio,
    title,
    secondsPerImage,
    outDir: 'artifacts'
  });
  return { ok: true, kind: 'video', ...result };
}

export async function createDocument({ bridge, kind, path, payload }) {
  const client = requireBridge(bridge);
  const result = await client.createDocument({ kind, path, payload });
  return { ok: true, kind: result.kind || kind, ...result };
}

export async function exportApplication({ bridge, files, name = 'QaswaraApp', kind = 'bundle' }) {
  const client = requireBridge(bridge);
  if (!files || !Object.keys(files).length) {
    throw new StudioError('لا ملفات للتصدير.', { kind: 'input' });
  }
  const result = await client.exportApp({ files, name, kind });
  return { ok: Boolean(result.ok), ...result };
}

export async function auditOutput({ bridge, code, lang = 'text', path = '.' }) {
  const client = requireBridge(bridge);
  const result = await client.audit(code ? { code, lang } : { path });
  return result;
}

/** Build a sandboxed preview document for Live Canvas. */
export function buildPreviewDoc({ html = '', css = '', js = '', title = 'معاينة قسورة' }) {
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${String(title).replace(/[<>]/g, '')}</title>
<style>${css}</style></head>
<body>${html}
<script>${js}<\/script>
</body></html>`;
}

/** Data-URL helper for in-browser previews/downloads. */
export function base64DataUrl(base64, mime = 'image/png') {
  return `data:${mime};base64,${base64}`;
}

export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1048576).toFixed(2)} MB`;
}
