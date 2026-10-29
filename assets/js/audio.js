/* Procedural sound, built on first use: room tone, a servo whine that follows joint speed,
   and short cues for clicks, grips, releases and successes. Nothing plays until enabled. */
export class Sound {
  constructor() {
    this.enabled = false;
    this.ctx = null;
  }

  get ready() { return this.enabled && !!this.ctx; }

  async setEnabled(on) {
    if (on && !this.ctx) this._init();
    if (!this.ctx) return false;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.enabled = on;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? 0.8 : 0, t, 0.25);
    return on;
  }

  _init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // room tone: detuned low drones through a slowly breathing low-pass
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    lp.Q.value = 0.8;
    const amb = ctx.createGain();
    amb.gain.value = 0.07;
    for (const [f, type, g] of [[55, 'sawtooth', 0.35], [55.4, 'sawtooth', 0.35], [82.4, 'triangle', 0.5], [110, 'sine', 0.25]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(lp);
      o.start();
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 80;
    lfo.connect(lfoG).connect(lp.frequency);
    lfo.start();
    lp.connect(amb).connect(this.master);

    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    air.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 500;
    bp.Q.value = 0.6;
    const ag = ctx.createGain();
    ag.gain.value = 0.012;
    air.connect(bp).connect(ag).connect(this.master);
    air.start();

    // servo voice
    const so = ctx.createOscillator();
    so.type = 'sawtooth';
    so.frequency.value = 120;
    const so2 = ctx.createOscillator();
    so2.type = 'square';
    so2.frequency.value = 241;
    const sf = ctx.createBiquadFilter();
    sf.type = 'bandpass';
    sf.frequency.value = 900;
    sf.Q.value = 4;
    const sg = ctx.createGain();
    sg.gain.value = 0;
    so.connect(sf);
    so2.connect(sf);
    sf.connect(sg).connect(this.master);
    so.start();
    so2.start();
    this.servo = { so, so2, sf, sg };
  }

  motion(speed) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const s = Math.min(1, speed / 5);
    this.servo.sg.gain.setTargetAtTime(s * s * 0.06, t, 0.05);
    this.servo.so.frequency.setTargetAtTime(110 + s * 240, t, 0.06);
    this.servo.so2.frequency.setTargetAtTime(221 + s * 470, t, 0.06);
    this.servo.sf.frequency.setTargetAtTime(600 + s * 1600, t, 0.08);
  }

  _tone(freq, dur, type, vol, delay = 0, slideTo = null) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _noise(dur, type, freq, q, vol, attack = 0.002) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  click() { this._noise(0.035, 'highpass', 2600, 0.7, 0.22); }
  tick() { this._tone(2400, 0.05, 'sine', 0.035); }
  grip() { this._tone(150, 0.16, 'sine', 0.32, 0, 70); this._noise(0.05, 'bandpass', 1800, 1.2, 0.16); }
  release() { this._noise(0.28, 'bandpass', 3200, 0.8, 0.11, 0.01); }
  thud() { this._tone(90, 0.14, 'sine', 0.28, 0, 50); }
  chime() { [880, 1318.5, 1760].forEach((f, i) => this._tone(f, 0.9, 'sine', 0.11, i * 0.07)); }
  press() { this._tone(660, 0.12, 'triangle', 0.12); this._tone(990, 0.2, 'sine', 0.1, 0.06); }
  sweep() { this._tone(180, 0.7, 'sawtooth', 0.07, 0, 1400); this._noise(0.6, 'bandpass', 2000, 0.7, 0.05, 0.2); }
}
