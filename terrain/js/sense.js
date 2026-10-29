// Sensing and feedback: a synthetic VN-100 vibration stream, the surface classifier,
// gamepad / phone haptics and an optional WebAudio rumble.
import { T2H, CONFUSION, CLASSES } from './shared.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussFrom(rand) {
  let spare = null;
  return function () {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0, v = 0;
    while (u < 1e-12) u = rand();
    v = rand();
    const m = Math.sqrt(-2 * Math.log(u));
    spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  };
}

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------
// IMU: vertical acceleration (gravity removed) sampled at 40 Hz, like the VNYMR stream.
// Amplitude follows the T2H level of the surface under the IMU wheel and scales with wheel speed.
export class ImuSim {
  constructor(seed = 11) {
    this.rand = mulberry32(seed);
    this.gauss = gaussFrom(this.rand);
    this.rate = 40;
    this.dtS = 1 / this.rate;
    this.n = 200;
    this.buf = new Float32Array(this.n);
    this.surf = new Uint8Array(this.n);
    this.head = 0;
    this.count = 0;
    this.acc = 0;
    this.t = 0;
    this.excite = 0.16;
    this.surface = 'tile';
    this.groutIdx = 0;
    this.jointAt = 1.2;
    this.impulse = 0;
    this.tapClock = 0;
    this.tapNext = 0.14;
    this.tapLeft = 0;
    this.ph = [this.rand() * TAU, this.rand() * TAU, this.rand() * TAU];
  }

  // h: step, surface under the IMU wheel, speed factor 0..1, travel = metres rolled by that wheel.
  advance(h, surface, speedFactor, travel) {
    this.surface = surface;
    const target = 0.16 + 0.84 * Math.min(1, Math.max(0, speedFactor));
    this.excite += (target - this.excite) * (1 - Math.exp(-h * 6));
    this.travel = travel;
    this.acc += h;
    while (this.acc >= this.dtS) {
      this.acc -= this.dtS;
      this.t += this.dtS;
      const v = this.sample();
      this.buf[this.head] = v;
      this.surf[this.head] = CLASSES.indexOf(this.surface);
      this.head = (this.head + 1) % this.n;
      if (this.count < this.n) this.count++;
    }
  }

  // k = 0 is the newest sample.
  at(k) {
    return this.buf[(this.head - 1 - k + this.n * 2) % this.n];
  }
  surfAt(k) {
    return this.surf[(this.head - 1 - k + this.n * 2) % this.n];
  }

  rms(window = 40) {
    const m = Math.min(window, this.count);
    if (!m) return 0;
    let s = 0;
    for (let k = 0; k < m; k++) { const v = this.at(k); s += v * v; }
    return Math.sqrt(s / m);
  }

  sample() {
    const T = T2H[this.surface];
    const A = T.amp * this.excite;
    const t = this.t, n = this.gauss();
    const [p1, p2, p3] = this.ph;
    let x = 0;
    // Surface joints: tile grout every 0.45 m, hardwood plank ends every 0.9 to 1.8 m.
    const travel = this.travel || 0;
    if (this.surface === 'tile') {
      const gi = Math.floor(travel / 0.45);
      if (gi !== this.groutIdx) { this.groutIdx = gi; this.impulse = 1; }
    } else if (this.surface === 'hardwood') {
      if (travel > this.jointAt) { this.jointAt = travel + 0.9 + this.rand() * 0.9; this.impulse = 0.7; }
    } else {
      this.groutIdx = Math.floor(travel / 0.45);
      if (this.jointAt < travel) this.jointAt = travel + 1;
    }
    switch (this.surface) {
      case 'tile': // steady buzz: dense high-frequency vibration, constant envelope
        x = A * (0.62 * Math.sin(TAU * 11.7 * t + p1) + 0.4 * Math.sin(TAU * 17.3 * t + p2) + 0.32 * n);
        break;
      case 'hardwood': // medium hum: smoother, lower carrier
        x = A * (0.78 * Math.sin(TAU * 6.3 * t + p1) + 0.28 * Math.sin(TAU * 12.9 * t + p3) + 0.22 * n);
        break;
      case 'carpet': { // gentle throb: slow pulse envelope on a soft low carrier
        const e = 0.5 + 0.5 * Math.sin(TAU * 1.3 * t + p2);
        x = A * (0.25 + 0.95 * e * e) * (0.85 * Math.sin(TAU * 3.4 * t + p1) + 0.3 * n);
        break;
      }
      case 'grass': { // faint taps: sparse short spikes at a fast rate
        this.tapClock += this.dtS;
        let tap = 0;
        if (this.tapLeft > 0) { tap = -0.55 * Math.sign(this.lastTap || 1); this.tapLeft = 0; }
        if (this.tapClock >= this.tapNext) {
          this.tapClock = 0;
          this.tapNext = 1 / 7 + (this.rand() - 0.5) * 0.06;
          this.lastTap = this.rand() < 0.5 ? -1 : 1;
          tap = 1.3 * this.lastTap;
          this.tapLeft = 1;
        }
        x = A * (tap + 0.14 * n);
        break;
      }
    }
    if (this.impulse > 0.02) {
      x += A * 1.25 * this.impulse * (this.rand() < 0.5 ? -1 : 1);
      this.impulse *= 0.35;
    }
    return x;
  }
}

// ---------------------------------------------------------------------------------------------
// Classifier: evaluates 1 s windows with 50% overlap (every 0.5 s). The probabilities follow
// the confusion-matrix row of whatever surface(s) the window covered, with slight noise.
export class Classifier {
  constructor(seed = 23, initial = 'tile') {
    this.rand = mulberry32(seed);
    this.gauss = gaussFrom(this.rand);
    this.target = CONFUSION[initial].slice();
    this.probs = CONFUSION[initial].slice();
    this.timer = 0;
    this.windows = [];
    this.count = 0;
    this.actual = initial;
  }

  reset(surface) {
    this.target = CONFUSION[surface].slice();
    this.probs = CONFUSION[surface].slice();
    this.actual = surface;
  }

  advance(h, imu, surfaceNow) {
    this.timer += h;
    while (this.timer >= 0.5) {
      this.timer -= 0.5;
      this.evaluate(imu, surfaceNow);
    }
    const k = 1 - Math.exp(-h / 0.28);
    for (let i = 0; i < 4; i++) this.probs[i] += (this.target[i] - this.probs[i]) * k;
  }

  evaluate(imu, surfaceNow) {
    const counts = [0, 0, 0, 0];
    const m = Math.min(40, imu.count);
    for (let k = 0; k < m; k++) counts[imu.surfAt(k)]++;
    if (!m) counts[CLASSES.indexOf(surfaceNow)] = 1;
    const total = counts.reduce((a, b) => a + b, 0);
    const mix = [0, 0, 0, 0];
    let major = 0;
    for (let c = 0; c < 4; c++) {
      if (counts[c] > counts[major]) major = c;
      const w = counts[c] / total;
      if (!w) continue;
      const row = CONFUSION[CLASSES[c]];
      for (let j = 0; j < 4; j++) mix[j] += w * row[j];
    }
    let sum = 0;
    for (let j = 0; j < 4; j++) { mix[j] *= Math.exp(0.08 * this.gauss()); sum += mix[j]; }
    for (let j = 0; j < 4; j++) mix[j] = (mix[j] / sum) * 100;
    this.target = mix;
    // One sampled decision per window, so misclassifications show up at the matrix's rates.
    let r = this.rand() * 100, pred = 3;
    for (let j = 0; j < 4; j++) { r -= mix[j]; if (r <= 0) { pred = j; break; } }
    this.actual = CLASSES[major];
    this.windows.push({ pred: CLASSES[pred], actual: CLASSES[major] });
    if (this.windows.length > 16) this.windows.shift();
    this.count++;
  }

  predicted() {
    let b = 0;
    for (let j = 1; j < 4; j++) if (this.probs[j] > this.probs[b]) b = j;
    return CLASSES[b];
  }
}

// ---------------------------------------------------------------------------------------------
// Haptics on terrain change: gamepad dual-rumble (Xbox L/R levels from the T2H table) and
// navigator.vibrate on phones.
const PULSES = {
  continuous: [[420, 0]],
  slow: [[190, 230], [190, 230], [190, 0]],
  fast: [[50, 70], [50, 70], [50, 70], [50, 70], [50, 70], [50, 0]],
};

export class Haptics {
  constructor() {
    this.enabled = true;
    this.timers = [];
    this.last = null;
  }

  pad() {
    if (!navigator.getGamepads) return null;
    let pads = [];
    try { pads = navigator.getGamepads() || []; } catch { return null; }
    for (const p of pads) if (p && p.connected && p.vibrationActuator) return p;
    return null;
  }

  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  play(surface) {
    const T = T2H[surface];
    if (!T) return { gamepad: false, vibrate: false };
    this.last = { surface, at: performance.now() };
    if (!this.enabled) return { gamepad: false, vibrate: false };
    this.stop();
    const pulses = PULSES[T.pattern];
    const out = { gamepad: false, vibrate: false };
    const gp = this.pad();
    if (gp) {
      out.gamepad = true;
      let at = 0;
      for (const [onMs, offMs] of pulses) {
        const delay = at;
        this.timers.push(setTimeout(() => {
          const p = this.pad();
          if (!p) return;
          try {
            const r = p.vibrationActuator.playEffect('dual-rumble', {
              startDelay: 0, duration: onMs, strongMagnitude: T.L, weakMagnitude: T.R,
            });
            if (r && r.catch) r.catch(() => {});
          } catch { /* actuator busy or unsupported */ }
        }, delay));
        at += onMs + offMs;
      }
    }
    const ua = navigator.userActivation;
    if (typeof navigator.vibrate === 'function' && (!ua || ua.hasBeenActive)) {
      const pattern = [];
      if (T.pattern === 'continuous') pattern.push(Math.round(220 + 600 * T.amp));
      else for (const [onMs, offMs] of pulses) { pattern.push(T.pattern === 'slow' ? 150 : 28); if (offMs) pattern.push(offMs); }
      try { out.vibrate = navigator.vibrate(pattern); } catch { out.vibrate = false; }
    }
    return out;
  }
}

// ---------------------------------------------------------------------------------------------
// Optional synthesized rumble. Created on the first click of the Audio toggle (a user gesture).
const AUDIO_TEX = {
  tile:     { type: 'bandpass', f: 190, q: 2.4, lfo: 0,   depth: 0 },
  hardwood: { type: 'bandpass', f: 115, q: 1.3, lfo: 0,   depth: 0 },
  carpet:   { type: 'lowpass',  f: 140, q: 0.7, lfo: 1.3, depth: 0.85 },
  grass:    { type: 'bandpass', f: 520, q: 0.8, lfo: 7,   depth: 0.95 },
};

export class AudioRumble {
  constructor() {
    this.ctx = null;
    this.on = false;
    this.surface = null;
  }

  build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC();
    this.ctx = ctx;
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    const r = mulberry32(5);
    for (let i = 0; i < len; i++) {
      const white = r() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.2;
    }
    this.noiseBuf = buf;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    this.filter = ctx.createBiquadFilter();
    this.roll = ctx.createGain();
    this.roll.gain.value = 0;
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 1;
    this.lfoDepth = ctx.createGain();
    this.lfoDepth.gain.value = 0;
    this.lfo.connect(this.lfoDepth).connect(this.roll.gain);
    this.motor = ctx.createOscillator();
    this.motor.type = 'sawtooth';
    this.motor.frequency.value = 50;
    const mf = ctx.createBiquadFilter();
    mf.type = 'lowpass';
    mf.frequency.value = 380;
    this.motorGain = ctx.createGain();
    this.motorGain.gain.value = 0;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    noise.connect(this.filter).connect(this.roll).connect(this.master);
    this.motor.connect(mf).connect(this.motorGain).connect(this.master);
    this.master.connect(comp).connect(ctx.destination);
    noise.start();
    this.lfo.start();
    this.motor.start();
    return true;
  }

  async setEnabled(v) {
    if (v && !this.ctx && !this.build()) return false;
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    if (v) {
      try { await this.ctx.resume(); } catch { return false; }
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(0.85, now, 0.1);
      this.on = true;
    } else {
      this.on = false;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(0, now, 0.06);
      setTimeout(() => { if (!this.on && this.ctx) this.ctx.suspend().catch(() => {}); }, 400);
    }
    return true;
  }

  update(speedFactor, surface) {
    if (!this.on || !this.ctx) return;
    const now = this.ctx.currentTime;
    const T = T2H[surface], X = AUDIO_TEX[surface];
    if (surface !== this.surface) {
      this.surface = surface;
      this.filter.type = X.type;
      this.filter.frequency.setTargetAtTime(X.f, now, 0.05);
      this.filter.Q.setTargetAtTime(X.q, now, 0.05);
      if (X.lfo) this.lfo.frequency.setTargetAtTime(X.lfo, now, 0.05);
    }
    const base = T.amp * (0.12 + speedFactor) * 0.9;
    this.roll.gain.setTargetAtTime(base, now, 0.08);
    this.lfoDepth.gain.setTargetAtTime(base * X.depth, now, 0.08);
    this.motor.frequency.setTargetAtTime(42 + 120 * speedFactor, now, 0.1);
    this.motorGain.gain.setTargetAtTime(0.045 * speedFactor, now, 0.1);
  }

  // One-shot burst on a terrain change, shaped like the haptic pattern.
  pulse(surface) {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx, T = T2H[surface];
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 120 + 500 * T.R;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    let at = ctx.currentTime + 0.01;
    const peak = 0.4 + 1.6 * T.R;
    for (const [onMs, offMs] of PULSES[T.pattern]) {
      g.gain.setTargetAtTime(peak, at, 0.012);
      g.gain.setTargetAtTime(0, at + onMs / 1000, 0.02);
      at += (onMs + offMs) / 1000;
    }
    src.start();
    src.stop(at + 0.3);
  }
}
