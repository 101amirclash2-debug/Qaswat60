/* ==========================================================================
   تجارة — المؤثرات الصوتية (WebAudio مُولّد بالكامل، بلا ملفات خارجية)
   ========================================================================== */
(function (root) {
  'use strict';
  let ctx = null, master = null, sfxBus = null, musicBus = null;
  let musicTimer = null, musicStep = 0, musicOn = false;
  let cfg = { sound: true, music: true, sfxVolume: 0.7, musicVolume: 0.22, vibration: true };

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
      sfxBus = ctx.createGain(); sfxBus.gain.value = cfg.sound ? cfg.sfxVolume : 0; sfxBus.connect(master);
      musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
      return ctx;
    } catch (e) { return null; }
  }
  function configure(patch) {
    cfg = Object.assign(cfg, patch || {});
    if (!ctx) return;
    sfxBus.gain.setTargetAtTime(cfg.sound ? cfg.sfxVolume : 0, ctx.currentTime, 0.05);
    musicBus.gain.setTargetAtTime(musicOn && cfg.music ? cfg.musicVolume : 0, ctx.currentTime, 0.2);
  }
  function vibrate(ms) {
    if (!cfg.vibration) return;
    try { if (root.navigator && root.navigator.vibrate) root.navigator.vibrate(ms); } catch (e) {}
  }
  function tone(freq, dur, opts) {
    if (!ensure() || !cfg.sound) return;
    opts = opts || {};
    const t = ctx.currentTime + (opts.delay || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = opts.type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(Math.max(30, opts.to), t + dur);
    const vol = (opts.gain === undefined ? 0.22 : opts.gain);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(opts.bus || sfxBus);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, opts) {
    if (!ensure() || !cfg.sound) return;
    opts = opts || {};
    const t = ctx.currentTime + (opts.delay || 0);
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = opts.filter || 'bandpass';
    f.frequency.value = opts.freq || 1800; f.Q.value = opts.q || 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain || 0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(sfxBus);
    src.start(t); src.stop(t + dur);
  }
  function seq(notes, step, opts) {
    notes.forEach((n, i) => tone(n, opts.dur || 0.16, Object.assign({}, opts, { delay: i * step })));
  }

  const S = {
    click: () => tone(520, 0.07, { type: 'triangle', gain: 0.13 }),
    tap: () => { tone(700, 0.05, { type: 'square', gain: 0.08 }); },
    deal: () => { noise(0.09, { freq: 2600, gain: 0.16 }); tone(300, 0.09, { to: 180, gain: 0.1, type: 'triangle' }); },
    flip: () => { noise(0.13, { freq: 1400, gain: 0.2 }); tone(420, 0.12, { to: 700, gain: 0.1 }); },
    chip: () => { tone(1180, 0.06, { type: 'square', gain: 0.09 }); tone(780, 0.09, { type: 'triangle', gain: 0.12, delay: 0.04 }); },
    bid: () => { seq([392, 523, 659], 0.07, { dur: 0.13, type: 'triangle', gain: 0.16 }); noise(0.06, { freq: 3200, gain: 0.1 }); },
    raise: () => { seq([440, 554, 659, 880], 0.06, { dur: 0.16, type: 'sawtooth', gain: 0.11 }); },
    pass: () => { tone(330, 0.14, { to: 240, gain: 0.11, type: 'triangle' }); },
    fold: () => { tone(240, 0.22, { to: 120, gain: 0.13, type: 'sine' }); },
    supervisor: () => { seq([523, 659, 784, 1046], 0.09, { dur: 0.22, type: 'triangle', gain: 0.14 }); vibrate(45); },
    offer: () => { seq([659, 587, 523], 0.1, { dur: 0.18, gain: 0.12 }); },
    tick: () => { tone(1000, 0.04, { type: 'square', gain: 0.055 }); },
    timeout: () => { seq([880, 660, 440, 330], 0.1, { dur: 0.18, type: 'square', gain: 0.11 }); vibrate([40, 60, 40]); },
    reveal: () => { noise(0.3, { freq: 900, gain: 0.16 }); seq([261, 329, 392, 523], 0.07, { dur: 0.3, type: 'triangle', gain: 0.12 }); },
    win: () => { seq([523, 659, 784, 1046, 1318], 0.1, { dur: 0.42, type: 'triangle', gain: 0.18 }); vibrate([30, 40, 30, 40, 80]); },
    lose: () => { seq([392, 330, 262, 196], 0.13, { dur: 0.35, type: 'sine', gain: 0.16 }); vibrate(90); },
    mercy: () => { seq([440, 554, 659, 554, 659], 0.1, { dur: 0.3, gain: 0.13 }); },
    suspend: () => { seq([300, 240, 180], 0.14, { dur: 0.32, type: 'sawtooth', gain: 0.1 }); vibrate(140); },
    whale: () => { seq([196, 147, 98], 0.12, { dur: 0.4, type: 'sawtooth', gain: 0.14 }); noise(0.4, { freq: 320, gain: 0.16 }); vibrate([60, 60, 120]); },
    achievement: () => { seq([659, 784, 988, 1318, 1568], 0.09, { dur: 0.35, type: 'triangle', gain: 0.16 }); },
    emoji: () => { tone(880, 0.09, { to: 1320, gain: 0.09, type: 'sine' }); },
    chat: () => { tone(660, 0.06, { type: 'sine', gain: 0.07 }); },
    start: () => { seq([262, 330, 392, 523, 659], 0.1, { dur: 0.32, type: 'triangle', gain: 0.14 }); },
    error: () => { tone(180, 0.18, { to: 120, gain: 0.14, type: 'square' }); vibrate(60); }
  };

  function play(name) {
    try { if (S[name]) S[name](); } catch (e) { /* الصوت اختياري */ }
  }

  /* موسيقى خلفية هادئة ذات نكهة شرقية (حجاز) */
  const SCALE = [220, 233.08, 277.18, 293.66, 329.63, 349.23, 415.30, 440];
  function musicTick() {
    if (!ctx || !musicOn || !cfg.music) return;
    const t = ctx.currentTime;
    const n = SCALE[(musicStep * 3 + (musicStep % 3)) % SCALE.length];
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'triangle'; o.frequency.value = n;
    f.type = 'lowpass'; f.frequency.value = 1100;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
    o.connect(f); f.connect(g); g.connect(musicBus);
    o.start(t); o.stop(t + 1.75);
    if (musicStep % 2 === 0) {
      const o2 = ctx.createOscillator(), g2 = ctx.createGain();
      o2.type = 'sine'; o2.frequency.value = n / 2;
      g2.gain.setValueAtTime(0.0001, t);
      g2.gain.exponentialRampToValueAtTime(0.1, t + 0.4);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      o2.connect(g2); g2.connect(musicBus); o2.start(t); o2.stop(t + 2.45);
    }
    musicStep++;
  }
  function startMusic() {
    ensure(); musicOn = true;
    if (!ctx) return;
    musicBus.gain.setTargetAtTime(cfg.music ? cfg.musicVolume : 0, ctx.currentTime, 0.5);
    if (!musicTimer) { musicTick(); musicTimer = setInterval(musicTick, 1500); }
  }
  function stopMusic() {
    musicOn = false;
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
    if (ctx) musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
  }
  function unlock() { ensure(); play('click'); if (cfg.music && !musicOn) startMusic(); }

  root.TijaraAudio = {
    ensure: ensure, configure: configure, play: play, vibrate: vibrate,
    startMusic: startMusic, stopMusic: stopMusic, unlock: unlock,
    get musicOn() { return musicOn; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
