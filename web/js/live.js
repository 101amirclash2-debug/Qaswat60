/**
 * QASWARA — Live mode sources: camera, screen share, screen capture via bridge.
 *
 * All three produce `{base64, mime}` frames that go straight to a vision model.
 * Capability detection is explicit so the UI can disable what the device cannot
 * do instead of failing silently.
 */

import { visionChat, ProviderError } from './providers.js';
import { supportsVision } from './config.js';

export function mediaSupport(scope = globalThis) {
  const nav = scope.navigator || {};
  return {
    camera: Boolean(nav.mediaDevices?.getUserMedia),
    screen: Boolean(nav.mediaDevices?.getDisplayMedia),
    audio: Boolean(nav.mediaDevices?.getUserMedia)
  };
}

/** Draw the current video frame to a canvas and return JPEG base64. */
export function captureFrameFromVideo(video, { maxWidth = 1280, quality = 0.85 } = {}) {
  if (!video || !video.videoWidth) throw new Error('الكاميرا/الشاشة غير جاهزة بعد.');
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const canvas = (globalThis.document || {}).createElement
    ? globalThis.document.createElement('canvas')
    : null;
  if (!canvas) throw new Error('لا يمكن إنشاء canvas في هذه البيئة.');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return {
    base64: dataUrl.split(',')[1],
    mime: 'image/jpeg',
    width: canvas.width,
    height: canvas.height,
    dataUrl
  };
}

export class LiveSession {
  constructor({ bridge = null, getSettings = () => ({}), onEvent = () => {} } = {}) {
    this.bridge = bridge;
    this.getSettings = getSettings;
    this.onEvent = onEvent;
    this.stream = null;
    this.mode = null; // camera | screen
    this.facing = 'environment';
  }

  async startCamera({ facing = 'environment' } = {}) {
    this.stop();
    const nav = globalThis.navigator;
    if (!nav?.mediaDevices?.getUserMedia) throw new Error('الكاميرا غير مدعومة في هذا المتصفح.');
    const stream = await nav.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    this.stream = stream;
    this.mode = 'camera';
    this.facing = facing;
    this.onEvent({ type: 'live-start', mode: 'camera', facing });
    return stream;
  }

  async startScreen() {
    this.stop();
    const nav = globalThis.navigator;
    if (!nav?.mediaDevices?.getDisplayMedia) {
      throw new Error(
        'مشاركة الشاشة غير مدعومة في متصفح أندرويد. استخدم «التقاط الشاشة» عبر الجسر (rish) أو الثبّت التطبيق (APK).'
      );
    }
    const stream = await nav.mediaDevices.getDisplayMedia({ video: true, audio: false });
    this.stream = stream;
    this.mode = 'screen';
    this.onEvent({ type: 'live-start', mode: 'screen' });
    return stream;
  }

  stop() {
    for (const track of this.stream?.getTracks?.() || []) {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    }
    if (this.mode) this.onEvent({ type: 'live-stop', mode: this.mode });
    this.stream = null;
    this.mode = null;
  }

  get active() {
    return Boolean(this.stream);
  }

  frame(options = {}) {
    const video = options.video;
    return captureFrameFromVideo(video, options);
  }

  /** Screenshot through the bridge (Shizuku/rish) — no browser permission needed. */
  async captureScreenViaBridge() {
    if (!this.bridge) throw new Error('الجسر غير متصل.');
    const result = await this.bridge.captureScreen();
    return { base64: result.base64, mime: result.mime || 'image/png', method: result.method, path: result.path };
  }

  /**
   * Ask the vision model about a frame.
   * @param {{question:string, frames:Array<{base64:string,mime?:string}>, translate?:boolean, signal?:AbortSignal}} p
   */
  async ask({ question, frames, translate = false, signal }) {
    const settings = this.getSettings();
    if (!supportsVision(settings)) {
      throw new ProviderError(
        'النموذج الحالي لا يرى الصور. اختر Gemini أو GPT-4o أو Claude (OpenRouter) من الشريط العلوي.',
        { kind: 'capability' }
      );
    }
    const prompt = translate
      ? `ترجم كل النص الظاهر في الصورة إلى العربية ترجمة دقيقة، حافظ على التنسيق والأسطر، واذكر اللغة الأصلية. سؤال إضافي: ${question || 'لا شيء'}`
      : question || 'صِف ما تراه بدقة، واقرأ أي نص ظاهر.';
    const result = await visionChat({ settings, prompt, images: frames, signal });
    return result;
  }
}

/** Small helper used by tests and the UI to explain what is unavailable. */
export function describeLiveSupport(support = mediaSupport()) {
  return [
    { id: 'camera', label: 'الكاميرا الحية', ok: support.camera, reason: support.camera ? '' : 'غير مدعومة في هذا المتصفح' },
    { id: 'screen', label: 'مشاركة الشاشة', ok: support.screen, reason: support.screen ? '' : 'أندرويد لا يدعم getDisplayMedia — استخدم التقاط الشاشة عبر الجسر' },
    { id: 'voice', label: 'الصوت المباشر', ok: true, reason: '' }
  ];
}
