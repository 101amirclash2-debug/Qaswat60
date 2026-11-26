/**
 * Fully procedural daytime soundscape (no audio files):
 *  - layered wind through broad leaves (filtered noise with slow gusts)
 *  - grass swish that rises with walking / proximity to the sedges
 *  - sparse mountain bird calls (FM chirps)
 *  - a wide, very quiet valley air bed
 */
export class Ambience {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.muted = false;
    this.volume = 0.65;
    this.grassLevel = 0;
    this.windLevel = 0.5;
    this.stepPhase = 0;
  }

  async start() {
    if (this.started) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    await this.ctx.resume();

    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // gentle limiter-ish shaping
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 24;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.4;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    this.noise = this._makeNoiseBuffer(6);
    this.wind = this._buildWind();
    this.leaves = this._buildLeaves();
    this.air = this._buildAir();
    this.grass = this._buildGrass();

    this.master.gain.linearRampToValueAtTime(0.55 * this.volume, ctx.currentTime + 2.2);
    this.started = true;
    this._scheduleBirds();
  }

  _makeNoiseBuffer(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        // pink-ish filtering for a natural spectrum
        last = last * 0.94 + white * 0.06;
        d[i] = last * 3.2 + white * 0.18;
      }
    }
    return buf;
  }

  _noiseSource(playbackRate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.playbackRate.value = playbackRate;
    s.start(0, Math.random() * 5);
    return s;
  }

  _buildWind() {
    const ctx = this.ctx;
    const src = this._noiseSource(0.7);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    lp.Q.value = 0.6;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 90;
    const g = ctx.createGain();
    g.gain.value = 0.1;
    src.connect(hp).connect(lp).connect(g).connect(this.master);

    // slow gust LFO
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();

    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.031;
    const lfg2 = ctx.createGain();
    lfg2.gain.value = 0.34;
    lfo2.connect(lfg2).connect(g.gain);
    lfo2.start();

    return { src, gain: g, lp };
  }

  _buildLeaves() {
    const ctx = this.ctx;
    const src = this._noiseSource(1.4);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 3100;
    bp.Q.value = 0.7;
    const bp2 = ctx.createBiquadFilter();
    bp2.type = "bandpass";
    bp2.frequency.value = 5200;
    bp2.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.value = 0.085;
    src.connect(bp).connect(g);
    src.connect(bp2).connect(g);
    g.connect(this.master);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lg = ctx.createGain();
    lg.gain.value = 0.055;
    lfo.connect(lg).connect(g.gain);
    lfo.start();

    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.045;
    const lg2 = ctx.createGain();
    lg2.gain.value = 1200;
    lfo2.connect(lg2).connect(bp.frequency);
    lfo2.start();

    return { src, gain: g, bp };
  }

  _buildAir() {
    const ctx = this.ctx;
    const src = this._noiseSource(0.5);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 220;
    const g = ctx.createGain();
    g.gain.value = 0.06;
    src.connect(lp).connect(g).connect(this.master);
    return { src, gain: g };
  }

  _buildGrass() {
    const ctx = this.ctx;
    const src = this._noiseSource(1.9);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 4200;
    bp.Q.value = 0.9;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2200;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(hp).connect(bp).connect(g).connect(this.master);
    return { src, gain: g, bp };
  }

  /** One footstep: filtered noise burst. */
  step(hard = false) {
    if (!this.started || this.muted) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 1.6 + Math.random() * 0.5;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = hard ? 900 + Math.random() * 500 : 1700 + Math.random() * 900;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    const peak = hard ? 0.13 : 0.07;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random() * 5);
    src.stop(t + 0.2);
  }

  _scheduleBirds() {
    const delay = 2200 + Math.random() * 7000;
    this._birdTimer = setTimeout(() => {
      this._chirp();
      this._scheduleBirds();
    }, delay);
  }

  _chirp() {
    if (!this.started || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const count = 2 + Math.floor(Math.random() * 4);
    const base = 1700 + Math.random() * 1900;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const outGain = ctx.createGain();
    outGain.gain.value = 0.09 + Math.random() * 0.07;
    if (pan) {
      pan.pan.value = Math.random() * 2 - 1;
      outGain.connect(pan).connect(this.master);
    } else {
      outGain.connect(this.master);
    }

    // distant = darker
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2600 + Math.random() * 2600;
    lp.connect(outGain);

    for (let i = 0; i < count; i++) {
      const t = now + i * (0.09 + Math.random() * 0.11);
      const osc = ctx.createOscillator();
      osc.type = "sine";
      const f0 = base * (0.9 + Math.random() * 0.35);
      const f1 = f0 * (1.12 + Math.random() * 0.5);
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f1, t + 0.05);
      osc.frequency.exponentialRampToValueAtTime(f0 * (0.92 + Math.random() * 0.2), t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16 + Math.random() * 0.2, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14 + Math.random() * 0.1);
      osc.connect(g).connect(lp);
      osc.start(t);
      osc.stop(t + 0.3);
    }
  }

  /** Called every frame with the player's movement state and grass proximity. */
  update(dt, { moving = 0, nearGrass = 0, wind = 0.7, indoors = false } = {}) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.grassLevel += (nearGrass * (0.35 + moving * 0.9) - this.grassLevel) * Math.min(1, dt * 5);
    this.grass.gain.gain.setTargetAtTime(this.muted ? 0 : this.grassLevel * 0.22, t, 0.12);

    const windTarget = wind * (0.08 + 0.05 * Math.sin(t * 0.07));
    this.wind.gain.gain.setTargetAtTime(this.muted ? 0 : windTarget, t, 0.6);
    this.leaves.gain.gain.setTargetAtTime(this.muted ? 0 : wind * (0.05 + moving * 0.02), t, 0.4);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.55 * this.volume, this.ctx.currentTime, 0.25);
    }
  }

  setVolume(v) {
    this.volume = v;
    if (this.master && this.ctx && !this.muted) {
      this.master.gain.setTargetAtTime(0.55 * v, this.ctx.currentTime, 0.2);
    }
  }
}
