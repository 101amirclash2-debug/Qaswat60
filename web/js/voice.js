/**
 * QASWARA — voice engine (speech synthesis, recognition, wake word).
 *
 * Real browser APIs only:
 *   • TTS  → `speechSynthesis` (voice, rate 0.5–2.0, pitch, Arabic locale)
 *   • STT  → `SpeechRecognition` (Chrome on Android sends audio to Google's
 *            speech service; the privacy shield documents that)
 *   • Wake → continuous recognition comparing a normalised transcript with the
 *            wake phrase ("يا قسورة" by default), with barge-in support.
 *
 * Nothing here is simulated: unsupported environments report `false` and the
 * UI hides/disables the control instead of pretending to listen.
 */

export function normalizeArabic(text) {
  return String(text || '')
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '') // tashkeel + tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function voiceSupport(scope = globalThis) {
  return {
    tts: Boolean(scope.speechSynthesis && scope.SpeechSynthesisUtterance),
    stt: Boolean(scope.SpeechRecognition || scope.webkitSpeechRecognition),
    wake: Boolean(scope.SpeechRecognition || scope.webkitSpeechRecognition)
  };
}

/** Remove Markdown noise so speech sounds natural. */
export function speakableText(markdown, max = 1200) {
  const text = String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' … كتلة كود … ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/[*_>#|-]{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export class Voice {
  constructor({ getSettings = () => ({}), onError = () => {} } = {}) {
    this.getSettings = getSettings;
    this.onError = onError;
    this.utterance = null;
    this.recognition = null;
    this.wakeRecognition = null;
    this.listening = false;
    this.wakeActive = false;
    this._wakeTimer = null;
  }

  voices() {
    const scope = globalThis;
    if (!scope.speechSynthesis?.getVoices) return [];
    const all = scope.speechSynthesis.getVoices() || [];
    const arabic = all.filter((v) => /^ar/i.test(v.lang));
    return (arabic.length ? arabic : all).map((v) => ({ name: v.name, lang: v.lang, local: v.localService }));
  }

  stop() {
    try {
      globalThis.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
    this.utterance = null;
  }

  /**
   * Speak text with the user's voice settings.
   * @param {string} text
   * @param {{signal?:AbortSignal, onEnd?:Function}} [opts]
   */
  speak(text, { onEnd, signal } = {}) {
    const scope = globalThis;
    if (!scope.speechSynthesis || !scope.SpeechSynthesisUtterance) return false;
    const settings = this.getSettings();
    if (settings.voiceEnabled === false) return false;

    const clean = speakableText(text);
    if (!clean) return false;

    this.stop();
    const utterance = new scope.SpeechSynthesisUtterance(clean);
    utterance.lang = settings.dialect && settings.dialect !== 'standard' ? 'ar' : 'ar-SA';
    utterance.rate = Math.min(2, Math.max(0.5, Number(settings.voiceRate) || 1));
    utterance.pitch = Math.min(2, Math.max(0, Number(settings.voicePitch) || 1));

    const wanted = String(settings.voiceName || '').trim();
    const available = scope.speechSynthesis.getVoices?.() || [];
    const chosen = wanted ? available.find((v) => v.name === wanted) : available.find((v) => /^ar/i.test(v.lang));
    if (chosen) utterance.voice = chosen;

    utterance.onend = () => {
      this.utterance = null;
      onEnd?.();
    };
    utterance.onerror = (event) => {
      this.utterance = null;
      if (event?.error && event.error !== 'interrupted' && event.error !== 'canceled') {
        this.onError?.(`تعذّر التشغيل الصوتي: ${event.error}`);
      }
      onEnd?.();
    };

    if (signal) {
      if (signal.aborted) return false;
      signal.addEventListener('abort', () => this.stop(), { once: true });
    }

    this.utterance = utterance;
    scope.speechSynthesis.speak(utterance);
    return true;
  }

  /** Start one-shot dictation. */
  listen({ onPartial, onFinal, onEnd, onError, lang = 'ar-SA', timeoutMs = 20000 } = {}) {
    const scope = globalThis;
    const Recognition = scope.SpeechRecognition || scope.webkitSpeechRecognition;
    if (!Recognition) {
      onError?.('التعرف على الصوت غير مدعوم في هذا المتصفح. استخدم Chrome على أندرويد.');
      return false;
    }
    this.stopListening();
    const recognition = new Recognition();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let finalText = '';
    let timer = null;

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      if (interim) onPartial?.(interim);
    };

    recognition.onerror = (event) => {
      this.listening = false;
      if (timer) clearTimeout(timer);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        onError?.('لم يُسمح باستخدام الميكروفون. فعّل الإذن من إعدادات المتصفح.');
      } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
        onError?.(`خطأ في التعرف على الصوت: ${event.error}`);
      }
      onEnd?.(finalText);
    };

    recognition.onend = () => {
      this.listening = false;
      if (timer) clearTimeout(timer);
      onEnd?.(finalText);
    };

    try {
      recognition.start();
    } catch (err) {
      onError?.(err?.message || 'تعذّر بدء الاستماع.');
      return false;
    }
    this.recognition = recognition;
    this.listening = true;
    if (timeoutMs) timer = setTimeout(() => this.stopListening(), timeoutMs);
    return true;
  }

  stopListening() {
    try {
      this.recognition?.stop();
    } catch {
      /* ignore */
    }
    this.recognition = null;
    this.listening = false;
  }

  /**
   * Continuous wake-word listener with automatic restart.
   * @param {{phrase:string, onWake:Function, onStatus?:Function}} opts
   */
  startWake({ phrase, onWake, onStatus } = {}) {
    const scope = globalThis;
    const Recognition = scope.SpeechRecognition || scope.webkitSpeechRecognition;
    if (!Recognition) {
      onStatus?.('غير مدعوم');
      return false;
    }
    this.stopWake();
    const target = normalizeArabic(phrase || 'يا قسورة');
    const recognition = new Recognition();
    recognition.lang = 'ar-SA';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = normalizeArabic(event.results[i][0].transcript);
        if (transcript.includes(target) || transcript.includes('قسوره')) {
          this.stopWake();
          onWake?.(event.results[i][0].transcript);
          return;
        }
      }
    };
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        onStatus?.('إذن الميكروفون مرفوض');
        return;
      }
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      onStatus?.(`خطأ: ${event.error}`);
    };
    recognition.onend = () => {
      if (!this.wakeActive) return;
      // Chrome kills continuous recognition often; restart politely.
      this._wakeTimer = setTimeout(() => {
        try {
          recognition.start();
        } catch {
          /* already started */
        }
      }, 700);
    };

    try {
      recognition.start();
    } catch {
      return false;
    }
    this.wakeRecognition = recognition;
    this.wakeActive = true;
    onStatus?.('يستمع…');
    return true;
  }

  stopWake() {
    this.wakeActive = false;
    if (this._wakeTimer) clearTimeout(this._wakeTimer);
    this._wakeTimer = null;
    try {
      this.wakeRecognition?.stop();
    } catch {
      /* ignore */
    }
    this.wakeRecognition = null;
  }
}
