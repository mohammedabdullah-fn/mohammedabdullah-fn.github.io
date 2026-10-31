// Q-4 concept quadruped: orthographic side elevation + isometric inset.
// Legs are 2-link chains solved with closed-form inverse kinematics.
// The trot is a pure function of distance travelled, so a stance foot's world
// position is constant by construction: the body moves, the foot does not.
import { svg, setAttrs, n, Path, clamp, lerp, minjerk, sstep, smooth, DEG, fin, PX_PER_MM } from './util.js';

export const Q = {
  L1: 220,          // thigh, hip to knee (mm)
  L2: 220,          // shin, knee to foot centre (mm)
  hipX: 236,        // hip offset from body centre along the body (mm)
  hipY: -8,         // hip offset below the body centre line (mm)
  standH: 330,      // nominal hip height above the ground (mm)
  footR: 16,        // foot radius (mm); the foot centre sits footR above ground
  beta: 0.6,        // duty factor: fraction of a cycle each foot is in stance
  swingH: 64,       // swing apex height (mm)
  Dnom: 400,        // nominal cycle length: body travel per gait cycle (mm)
  halfLen: 340,     // half the overall length incl. head, for lane padding (mm)
  height: 474,      // overall height used to fit the lane (mm)
  vmax: 1150,       // top walking speed (mm/s)
  legZ: 165,        // lateral offset of each leg plane (mm), iso view only
};

// Body side profile, body frame (mm, y up), clockwise.
const BODY = [[-300, 58], [262, 58], [318, 32], [330, -14], [306, -56], [-292, -56], [-326, -26], [-326, 30]];

// Trot: diagonal pairs share a phase. "near" legs face the viewer.
const LEGS = [
  { id: 'FN', f: 1, near: true, off: 0.0, label: 'Front leg · near side' },
  { id: 'RN', f: -1, near: true, off: 0.5, label: 'Rear leg · near side' },
  { id: 'FF', f: 1, near: false, off: 0.5, label: 'Front leg · far side' },
  { id: 'RF', f: -1, near: false, off: 0.0, label: 'Rear leg · far side' },
];

// Idle "look around" keyframes: [t (s), head yaw (deg, + = toward viewer), head tilt (deg, + = up)]
const LOOK = [[0, 0, 0], [0.9, 34, -5], [1.7, 34, -12], [2.4, 34, -5], [3.4, -26, 2], [4.5, -26, 2], [5.3, 0, 7], [6.0, 0, 0], [8.6, 0, 0]];

/** Closed-form 2-link IK in the sagittal plane. Knee bends rearward. */
export function ik(hip, target, L1 = Q.L1, L2 = Q.L2) {
  let dx = target.x - hip.x, dy = target.y - hip.y;
  let d = Math.hypot(dx, dy);
  const dmax = (L1 + L2) * 0.999, dmin = Math.abs(L1 - L2) + 20;
  let clamped = false;
  if (!(d > 1e-9)) { dx = 0; dy = -dmin; d = dmin; clamped = true; }
  if (d > dmax) { dx *= dmax / d; dy *= dmax / d; d = dmax; clamped = true; }
  else if (d < dmin) { dx *= dmin / d; dy *= dmin / d; d = dmin; clamped = true; }
  const a = Math.atan2(dy, dx);
  const g = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  const t1 = a - g;                                   // thigh angle (world)
  const knee = { x: hip.x + L1 * Math.cos(t1), y: hip.y + L1 * Math.sin(t1) };
  const t2 = Math.atan2(hip.y + dy - knee.y, hip.x + dx - knee.x); // shin angle (world)
  // forward kinematics from the joint angles (this is what gets drawn)
  const foot = { x: knee.x + L2 * Math.cos(t2), y: knee.y + L2 * Math.sin(t2) };
  return { knee, foot, t1, t2, clamped };
}

/** Outline of two circles joined by their external tangents (a tapered link). */
function capsule(a, ra, b, rb) {
  const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy);
  if (!(d > Math.abs(ra - rb) + 0.01)) return new Path().circle(a[0], a[1], Math.max(ra, rb)).toString();
  const th = Math.atan2(dy, dx);
  const al = Math.acos(clamp((ra - rb) / d, -1, 1));
  const P = (c, r, ang) => [c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)];
  const p1 = P(a, ra, th + al), p2 = P(b, rb, th + al), p3 = P(b, rb, th - al), p4 = P(a, ra, th - al);
  return new Path()
    .M(p1[0], p1[1]).L(p2[0], p2[1])
    .A(rb, rb, 0, 2 * al > Math.PI, 0, p3[0], p3[1])
    .L(p4[0], p4[1])
    .A(ra, ra, 0, 2 * Math.PI - 2 * al > Math.PI, 0, p1[0], p1[1])
    .Z().toString();
}

export class Walker {
  constructor({ laneSvg, isoSvg, isoCap, dro }) {
    this.svg = laneSvg;
    this.isoSvg = isoSvg;
    this.isoCap = isoCap;
    this.dro = dro;
    this.W = 800; this.H = 96; this.G = 72; this.k = 0.14;
    this.stations = [0, 1, 2, 3, 4].map((i) => 400 + i * 1600);
    this.stationsPx = this.stations.map((x) => x * this.k);
    this.gait = { u0: this.stations[0], D: Q.Dnom, phi0: 0.05 };
    this.s = {
      x: this.stations[0], v: 0, prevV: 0, target: this.stations[0], rawTarget: this.stations[0], targetT: -1,
      t: 0, spd: 0, dir: 0, idleT: 0, ib: 0, settle: 0, settleV: 0,
      yaw: 0, yawV: 0, tilt: 0, tiltV: 0, ant: 0, antV: 0, reduced: false, placed: false,
    };
    this.legs = LEGS.map((l) => ({ ...l, wasStance: true, x0: 0, liftX: 0, t1: 0, t2: 0 }));
    this.stats = { frames: 0, maxSlipPx: 0, maxGroundErrPx: 0, maxNearGroundDriftPx: 0, clamps: 0, touchdowns: 0, maxIkErrMm: 0 };
    this.marks = [];
    this.iso = { on: false, w: 130, h: 96, s: 0.08, cx: 65, cy: 70 };
    this.onArrive = null;
    this.arrivedAt = -1;
    this.build();
    this.solve();
  }

  // ---------------------------------------------------------------- DOM
  build() {
    const s = this.svg;
    while (s.firstChild) s.removeChild(s.firstChild);
    const defs = svg('defs', null, s);
    const pat = svg('pattern', { id: 'ln-hatch', width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
    svg('line', { x1: 0, y1: 0, x2: 0, y2: 5, class: 'ln-hatch-l' }, pat);
    const clip = svg('clipPath', { id: 'q-body-clip' }, defs);
    this.clip = svg('path', { d: 'M0 0' }, clip);

    const ground = svg('g', { class: 'ln-ground' }, s);
    this.groundHatch = svg('rect', { class: 'ln-gh', fill: 'url(#ln-hatch)', x: 0, y: 0, width: 0, height: 0 }, ground);
    this.groundLine = svg('line', { class: 'ln-gl', x1: 0, y1: 0, x2: 0, y2: 0 }, ground);
    this.gStations = svg('g', { class: 'ln-stn' }, s);
    const gMarks = svg('g', { class: 'ln-marks' }, s);
    for (let i = 0; i < 12; i++) this.marks.push({ el: svg('path', { class: 'ln-mark', d: 'M0 0', opacity: 0 }, gMarks), age: 99 });

    const robot = (this.gRobot = svg('g', { class: 'q-robot' }, s));
    this.gFar = svg('g', { class: 'q-far' }, robot);
    this.gBody = svg('g', { class: 'q-body' }, robot);
    this.gFarHidden = svg('g', { class: 'q-far-hidden', 'clip-path': 'url(#q-body-clip)' }, robot);
    this.gNear = svg('g', { class: 'q-near' }, robot);
    this.ray = svg('path', { class: 'q-ray', d: 'M0 0', opacity: 0 }, robot);

    for (const leg of this.legs) {
      const g = svg('g', { class: 'q-leg' + (leg.near ? '' : ' q-leg--far'), 'data-part': 'leg-' + leg.id }, leg.near ? this.gNear : this.gFar);
      leg.el = {
        thigh: svg('path', { class: 'q-link' }, g),
        shin: svg('path', { class: 'q-link' }, g),
        knee: svg('circle', { class: 'q-joint' }, g),
        pin: svg('circle', { class: 'q-pin' }, g),
        foot: svg('circle', { class: 'q-foot' }, g),
        pad: svg('path', { class: 'q-pad' }, g),
        hip: svg('circle', { class: 'q-joint' }, g),
        cl: leg.near ? svg('path', { class: 'q-cl q-cl--leg' }, g) : null,
      };
      if (!leg.near) {
        // dashed hidden-line copy, clipped to the body silhouette
        const gh = svg('g', { class: 'q-leg q-leg--hidden' }, this.gFarHidden);
        leg.elH = { thigh: svg('path', { class: 'q-link' }, gh), shin: svg('path', { class: 'q-link' }, gh), hip: svg('circle', { class: 'q-joint' }, gh) };
      }
    }

    const b = this.gBody;
    this.el = {
      shell: svg('path', { class: 'q-shell', 'data-part': 'body' }, b),
      seams: svg('path', { class: 'q-seam' }, b),
      hipF: svg('path', { class: 'q-hip', 'data-part': 'hip-front' }, b),
      hipR: svg('path', { class: 'q-hip', 'data-part': 'hip-rear' }, b),
      cmark: svg('path', { class: 'q-cmark' }, b),
      handle: svg('path', { class: 'q-handle', 'data-part': 'handle' }, b),
      antenna: svg('path', { class: 'q-ant', 'data-part': 'antenna' }, b),
      cl: svg('path', { class: 'q-cl' }, b),
    };
    const head = (this.el.head = svg('g', { class: 'q-head', 'data-part': 'head' }, b));
    this.el.neck = svg('path', { class: 'q-neck' }, head);
    this.el.headSide = svg('path', { class: 'q-face' }, head);
    this.el.headEnd = svg('path', { class: 'q-face q-face--end' }, head);
    this.el.lens = svg('path', { class: 'q-lens' }, head);
    this.el.lensSide = svg('path', { class: 'q-lens q-lens--side' }, head);

    // isometric inset
    if (this.isoSvg) {
      const iso = this.isoSvg;
      while (iso.firstChild) iso.removeChild(iso.firstChild);
      const idefs = svg('defs', null, iso);
      const ic = svg('clipPath', { id: 'iso-clip' }, idefs);
      this.isoClip = svg('rect', { x: 0, y: 0, width: 10, height: 10 }, ic);
      this.isoGrid = svg('path', { class: 'iso-grid', 'clip-path': 'url(#iso-clip)' }, iso);
      this.isoShadow = svg('path', { class: 'iso-contact' }, iso);
      this.isoFar = svg('path', { class: 'iso-leg iso-leg--far' }, iso);
      this.isoHidden = svg('path', { class: 'iso-hidden' }, iso);
      this.isoBody = svg('path', { class: 'iso-body' }, iso);
      this.isoBodyFill = this.isoBody;
      this.isoHead = svg('path', { class: 'iso-head' }, iso);
      this.isoNear = svg('path', { class: 'iso-leg' }, iso);
      this.isoJoints = svg('path', { class: 'iso-joint' }, iso);
      this.isoAxes = svg('path', { class: 'iso-axes' }, iso);
    }
  }

  // ------------------------------------------------------------- layout
  /** Lay the lane out for a W x H px box. Keeps the robot's progress between stations. */
  layout(W, H, isoBox) {
    const prev = this.stations;
    const prevSigma = (this.s.x - prev[0]) / Math.max(1, prev[1] - prev[0]);
    this.W = Math.max(120, fin(W, 800));
    this.H = Math.max(40, fin(H, 96));
    const compact = this.H < 80;
    this.G = this.H - (compact ? 17 : 23);
    // the desktop lane keeps a band at the top for the DRO readout
    this.k = (this.G - (compact ? 5 : 19)) / Q.height;
    const pad = Q.halfLen * this.k + (compact ? 8 : 16);
    const x0 = pad, x4 = Math.max(pad + 40, this.W - pad);
    this.stationsPx = [0, 1, 2, 3, 4].map((i) => x0 + ((x4 - x0) * i) / 4);
    this.stations = this.stationsPx.map((p) => p / this.k);
    // cycle length chosen so station spacing is a whole number of half cycles:
    // every station is then an all-four-feet-down pose.
    const dmm = this.stations[1] - this.stations[0];
    const halves = Math.max(1, Math.round((2 * dmm) / Q.Dnom));
    this.gait = { u0: this.stations[0], D: (2 * dmm) / halves, phi0: 0.05 };

    const sig = Number.isFinite(prevSigma) ? clamp(prevSigma, 0, 4) : 0;
    const nx = this.stations[0] + sig * dmm;
    this.s.x = nx; this.s.target = nx; this.s.rawTarget = nx; this.s.v = 0;
    this.resetTracking();

    setAttrs(this.svg, { viewBox: `0 0 ${n(this.W)} ${n(this.H)}`, width: this.W, height: this.H });
    setAttrs(this.groundLine, { x1: 0, y1: this.G, x2: this.W, y2: this.G });
    setAttrs(this.groundHatch, { x: 0, y: this.G, width: this.W, height: compact ? 4 : 6 });
    const gs = this.gStations;
    while (gs.firstChild) gs.removeChild(gs.firstChild);
    this.stationEls = this.stationsPx.map((x) => {
      const g = svg('g', { class: 'ln-stn-g' }, gs);
      svg('line', { x1: x, y1: this.G - 6, x2: x, y2: this.G + 5, class: 'ln-stn-tick' }, g);
      svg('path', { d: new Path().poly([[x, this.G + 1], [x - 3.5, this.G + 6.5], [x + 3.5, this.G + 6.5]]).toString(), class: 'ln-stn-tri' }, g);
      return g;
    });

    if (this.isoSvg && isoBox) {
      this.iso.on = isoBox.w > 20 && isoBox.h > 20;
      const w = (this.iso.w = isoBox.w), h = (this.iso.h = isoBox.h);
      // fit: width ~ (L + W) cos30, height ~ Ht + (L + W)/2
      const ext = 2 * (Q.halfLen + Q.legZ + 20);
      this.iso.s = Math.min((w - 12) / (ext * 0.866), (h - 18) / (Q.height + ext * 0.5));
      this.iso.cx = w * 0.5;
      this.iso.cy = h - 5 - (ext * 0.25) * this.iso.s;
      setAttrs(this.isoSvg, { viewBox: `0 0 ${n(w)} ${n(h)}`, width: w, height: h });
      setAttrs(this.isoClip, { x: 1, y: 1, width: Math.max(0, w - 2), height: Math.max(0, h - 2) });
      if (this.isoCap) this.isoCap.textContent = 'ISO · 1:' + Math.round(PX_PER_MM / this.iso.s);
    } else {
      this.iso.on = false;
    }
    this.solve();
  }

  /** Drawing scale of the side elevation, as model mm per paper mm. */
  scaleDenominator() { return PX_PER_MM / this.k; }

  // ------------------------------------------------------------- control
  setTarget(xmm, now) {
    const x = clamp(fin(xmm, this.stations[0]), this.stations[0], this.stations[4]);
    if (Math.abs(x - this.s.rawTarget) > 0.01) this.s.targetT = fin(now, this.s.t);
    this.s.rawTarget = x;
  }

  /** Jump straight to a position (no walking): used on load and with reduced motion. */
  place(xmm) {
    const x = clamp(fin(xmm, this.stations[0]), this.stations[0], this.stations[4]);
    const s = this.s;
    s.x = s.target = s.rawTarget = this.snap(x, true);
    s.v = s.prevV = 0; s.spd = 0; s.dir = 0;
    s.placed = true;
    this.resetTracking();
    this.solve();
  }

  /** Nearest position where all four feet are planted (phase = phi0 mod 1/2). */
  snap(T, nearest = false) {
    const g = this.gait, half = g.D / 2;
    const k = (T - g.u0) / half;
    const xLo = g.u0 + Math.floor(k) * half, xHi = g.u0 + Math.ceil(k) * half;
    let pick = T - xLo <= xHi - T ? xLo : xHi;
    if (!nearest) {
      const { x, v } = this.s;
      if (v > 1 && pick < x - 0.5) pick = xHi;   // never turn back to settle
      if (v < -1 && pick > x + 0.5) pick = xLo;
    }
    return clamp(pick, this.stations[0], this.stations[4]);
  }

  stationIndex(x = this.s.x) {
    let best = 0, bd = Infinity;
    this.stations.forEach((sx, i) => { const d = Math.abs(sx - x); if (d < bd) { bd = d; best = i; } });
    return { i: best, d: bd };
  }

  // ---------------------------------------------------------------- step
  step(dt) {
    const s = this.s;
    dt = clamp(fin(dt, 1 / 60), 0.0005, 0.1);
    s.t += dt;
    if (s.reduced) {
      // Reduced motion: no walking, no idle animation. Stand at the target station.
      const t = this.snap(s.rawTarget, true);
      if (Math.abs(t - s.x) > 0.01) this.place(t);
      s.ib = 0; s.idleT = 0; s.settle = 0; s.yaw = s.tilt = s.ant = 0;
      this.solve();
      this.arrive();
      return;
    }
    // 1) target: follow the scroll; once it rests, settle on an all-feet-down pose
    let tgt = s.rawTarget;
    if (s.t - s.targetT > 0.2) tgt = this.snap(tgt);
    s.target = tgt;
    // The springs below are integrated in small sub-steps so any frame time is stable.
    const steps = Math.max(1, Math.ceil(dt * 240));
    const h = dt / steps;
    const a = 1 - Math.exp(-h / 0.22);
    for (let i = 0; i < steps; i++) {
      // 2) critically damped follow with a speed cap
      const w = 5.2;
      const v0 = s.v;
      s.v = clamp(s.v + (w * w * (tgt - s.x) - 2 * w * s.v) * h, -Q.vmax, Q.vmax);
      s.x += s.v * h;
      if (Math.abs(tgt - s.x) < 0.25 && Math.abs(s.v) < 5) { s.x = tgt; s.v = 0; }
      const accel = (s.v - v0) / h;
      // 3) smoothed speed measures (gait amplitude, lean)
      s.spd += (Math.min(1, Math.abs(s.v) / Q.vmax) - s.spd) * a;
      s.dir += (s.v / Q.vmax - s.dir) * a;
      // 4) idle: settle, breathe, look around
      const still = Math.abs(s.v) < 0.5 && Math.abs(tgt - s.x) < 0.5;
      s.idleT = still ? s.idleT + h : 0;
      s.ib = sstep(0.35, 1.1, s.idleT);
      const tt = s.t - dt + (i + 1) * h;
      const settleTarget = -9 * s.ib + 1.3 * Math.sin(tt * Math.PI * 2 * 0.24) * s.ib;
      const ws = 9, zs = 0.32;
      s.settleV += (ws * ws * (settleTarget - s.settle) - 2 * zs * ws * s.settleV) * h;
      s.settle += s.settleV * h;
      const look = this.lookAt(s.idleT - 1.4);
      const yT = still ? look.yaw : 0;
      const tT = still ? look.tilt : -3 * DEG * s.spd;
      const wh = still ? 5 : 10;
      s.yawV += (wh * wh * (yT - s.yaw) - 2 * wh * s.yawV) * h; s.yaw += s.yawV * h;
      s.tiltV += (wh * wh * (tT - s.tilt) - 2 * wh * s.tiltV) * h; s.tilt += s.tiltV * h;
      // antenna: light spring driven by body acceleration
      const wa = 14, za = 0.18;
      s.antV += (-wa * wa * s.ant - 2 * za * wa * s.antV - clamp(accel, -6000, 6000) * 0.00009) * h;
      s.ant = clamp(s.ant + s.antV * h, -0.6, 0.6);
    }
    s.prevV = s.v;

    this.solve();
    this.track(dt);
    this.arrive();
  }

  lookAt(t) {
    if (!(t > 0)) return { yaw: 0, tilt: 0 };
    const T = LOOK[LOOK.length - 1][0];
    t %= T;
    for (let i = 1; i < LOOK.length; i++) {
      if (t <= LOOK[i][0]) {
        const [t0, y0, p0] = LOOK[i - 1], [t1, y1, p1] = LOOK[i];
        const u = smooth((t - t0) / (t1 - t0));
        return { yaw: lerp(y0, y1, u) * DEG, tilt: lerp(p0, p1, u) * DEG };
      }
    }
    return { yaw: 0, tilt: 0 };
  }

  arrive() {
    const s = this.s;
    if (Math.abs(s.v) > 0.5) { this.arrivedAt = -1; return; }
    const { i, d } = this.stationIndex();
    if (d < 1 && this.arrivedAt !== i) {
      this.arrivedAt = i;
      if (this.onArrive) this.onArrive(i);
    }
  }

  // ------------------------------------------------------------ kinematics
  footTarget(leg, x) {
    const g = this.gait;
    const phi = (x - g.u0) / g.D + g.phi0;
    const psi = phi - leg.off;
    const c = Math.floor(psi);
    const p = psi - c;
    // world x of the stance point for gait cycle c (constant during the stance)
    const X = g.u0 + leg.f * Q.hipX + g.D * (c + leg.off - g.phi0 + Q.beta / 2);
    if (p < Q.beta) return { x: X, y: Q.footR, stance: true, s: 0, lift: X, land: X };
    const s = (p - Q.beta) / (1 - Q.beta);
    // lift vertically, carry, then place vertically: no horizontal motion near the ground
    const ex = minjerk(clamp((s - 0.12) / 0.76, 0, 1));
    const h = Math.sin(Math.PI * s);
    return { x: X + g.D * ex, y: Q.footR + Q.swingH * h * h, stance: false, s, lift: X, land: X + g.D };
  }

  solve() {
    const s = this.s, g = this.gait;
    const phi = (s.x - g.u0) / g.D + g.phi0;
    const w = 2 * Math.PI * (phi - g.phi0);
    let y = Q.standH - Q.hipY - 4.5 * s.spd * (1 - Math.cos(2 * w));   // bob, twice per cycle
    let pitch = (1.2 * s.spd * Math.sin(w) - 1.0 * s.dir) * DEG;        // sway + lean into travel
    y += s.settle;
    pitch += 0.22 * s.tilt * s.ib;
    this.pose = { x: s.x, y, pitch, phi };
    const c = Math.cos(pitch), sn = Math.sin(pitch);
    for (const leg of this.legs) {
      const bx = leg.f * Q.hipX, by = Q.hipY;
      const hip = { x: s.x + c * bx - sn * by, y: y + sn * bx + c * by };
      const tgt = this.footTarget(leg, s.x);
      const sol = ik(hip, tgt);
      leg.hip = hip; leg.tgt = tgt; leg.knee = sol.knee; leg.foot = sol.foot; leg.t1 = sol.t1; leg.t2 = sol.t2;
      if (sol.clamped) this.stats.clamps++;
      const err = Math.hypot(sol.foot.x - tgt.x, sol.foot.y - tgt.y);
      if (err > this.stats.maxIkErrMm) this.stats.maxIkErrMm = err;
    }
  }

  resetTracking() {
    for (const leg of this.legs) leg.wasStance = null;
  }

  resetStats() {
    Object.assign(this.stats, { frames: 0, maxSlipPx: 0, maxGroundErrPx: 0, maxNearGroundDriftPx: 0, clamps: 0, touchdowns: 0, maxIkErrMm: 0 });
    this.resetTracking();
  }

  /** Measure what the drawing does: stance slip and ground error in screen px. */
  track(dt) {
    const k = this.k, groundY = this.G - Q.footR * k;
    this.stats.frames++;
    for (const leg of this.legs) {
      const fx = leg.foot.x * k, fy = this.G - leg.foot.y * k;
      const st = leg.tgt.stance;
      if (leg.wasStance === null) { leg.wasStance = st; leg.x0 = fx; leg.liftX = fx; continue; }
      if (st) {
        if (!leg.wasStance) { leg.x0 = fx; this.stats.touchdowns++; if (leg.near) this.mark(fx); }
        const slip = Math.abs(fx - leg.x0);
        if (slip > this.stats.maxSlipPx) this.stats.maxSlipPx = slip;
        const ge = Math.abs(fy - groundY);
        if (ge > this.stats.maxGroundErrPx) this.stats.maxGroundErrPx = ge;
      } else {
        if (leg.wasStance) leg.liftX = fx;
        if (Math.abs(fy - groundY) < 0.5) {
          // within half a pixel of the ground while swinging: how far is the foot from the
          // nearer end of its swing? (walking backwards swaps lift-off and touch-down)
          const drift = Math.min(Math.abs(fx - leg.tgt.lift * k), Math.abs(fx - leg.tgt.land * k));
          if (drift > this.stats.maxNearGroundDriftPx) this.stats.maxNearGroundDriftPx = drift;
        }
      }
      leg.wasStance = st;
    }
    for (const m of this.marks) if (m.age < 99) m.age += dt;
  }

  mark(x) {
    const m = this.marks.reduce((a, b) => (b.age > a.age ? b : a));
    m.age = 0; m.x = x;
  }

  // -------------------------------------------------------------- render
  render() {
    const k = this.k, G = this.G, p = this.pose, s = this.s;
    const c = Math.cos(p.pitch), sn = Math.sin(p.pitch);
    const B = (bx, by) => [(p.x + c * bx - sn * by) * k, G - (p.y + sn * bx + c * by) * k];
    const W = (x, y) => [x * k, G - y * k];

    // body
    const shell = new Path().poly(BODY.map((q) => B(q[0], q[1]))).toString();
    this.el.shell.setAttribute('d', shell);
    this.clip.setAttribute('d', shell);
    const sm = new Path();
    const seg = (a, b) => sm.M(a[0], a[1]).L(b[0], b[1]);
    seg(B(-326, 22), B(320.6, 22));
    sm.poly([B(-126, -42), B(126, -42), B(132, -36), B(132, 2), B(126, 8), B(-126, 8), B(-132, 2), B(-132, -36)]);
    for (let i = 0; i < 7; i++) seg(B(-75 + i * 25, -31), B(-75 + i * 25, -8));
    this.el.seams.setAttribute('d', sm.toString());
    const cm = new Path();
    for (const [el, f] of [[this.el.hipF, 1], [this.el.hipR, -1]]) {
      const C = B(f * Q.hipX, Q.hipY);
      el.setAttribute('d', new Path().circle(C[0], C[1], 44 * k).circle(C[0], C[1], 33 * k).toString());
      // centre mark extending past the housing
      const e = 52 * k;
      const ax = [c * e, -sn * e], ay = [sn * e, c * e];
      cm.M(C[0] - ax[0], C[1] - ax[1]).L(C[0] + ax[0], C[1] + ax[1]).M(C[0] - ay[0], C[1] - ay[1]).L(C[0] + ay[0], C[1] + ay[1]);
    }
    this.el.cmark.setAttribute('d', cm.toString());
    const h = [B(-96, 58), B(-96, 76), B(-88, 83), B(88, 83), B(96, 76), B(96, 58)];
    this.el.handle.setAttribute('d', new Path().poly(h, false).toString());
    const base = [-282, 58], L = 66;
    const tipB = [base[0] - Math.sin(s.ant) * L, base[1] + Math.cos(s.ant) * L];
    const b0 = B(base[0], base[1]), b1 = B(tipB[0], tipB[1]);
    this.el.antenna.setAttribute('d', new Path().M(b0[0], b0[1]).L(b1[0], b1[1]).circle(b1[0], b1[1], 5.5 * k).toString());
    const c0 = B(-378, Q.hipY), c1 = B(380, Q.hipY);
    this.el.cl.setAttribute('d', new Path().M(c0[0], c0[1]).L(c1[0], c1[1]).toString());
    this.renderHead(B, k);

    // legs
    for (const leg of this.legs) {
      const H = W(leg.hip.x, leg.hip.y), K = W(leg.knee.x, leg.knee.y), F = W(leg.foot.x, leg.foot.y);
      const e = leg.el;
      const thigh = capsule(H, 26 * k, K, 19 * k), shin = capsule(K, 16 * k, F, 11 * k);
      e.thigh.setAttribute('d', thigh);
      e.shin.setAttribute('d', shin);
      setAttrs(e.hip, { cx: H[0], cy: H[1], r: 24 * k });
      setAttrs(e.knee, { cx: K[0], cy: K[1], r: 19 * k });
      setAttrs(e.pin, { cx: K[0], cy: K[1], r: 6 * k });
      const fr = Q.footR * k;
      setAttrs(e.foot, { cx: F[0], cy: F[1], r: fr });
      e.pad.setAttribute('d', new Path().M(F[0] - fr * 0.87, F[1] + fr * 0.5).A(fr, fr, 0, 0, 0, F[0] + fr * 0.87, F[1] + fr * 0.5).toString());
      if (e.cl) e.cl.setAttribute('d', new Path().M(H[0], H[1]).L(K[0], K[1]).L(F[0], F[1]).toString());
      if (leg.elH) {
        leg.elH.thigh.setAttribute('d', thigh);
        leg.elH.shin.setAttribute('d', shin);
        setAttrs(leg.elH.hip, { cx: H[0], cy: H[1], r: 24 * k });
      }
    }

    // contact marks
    for (const m of this.marks) {
      if (m.age >= 1.6) { if (m.shown) { m.el.setAttribute('opacity', '0'); m.shown = false; } continue; }
      m.shown = true;
      m.el.setAttribute('d', new Path().M(m.x - 4, G - 0.5).L(m.x, G - 4.5).L(m.x + 4, G - 0.5).toString());
      m.el.setAttribute('opacity', n(1 - m.age / 1.6));
    }

    // active station
    const { i: si, d: sd } = this.stationIndex();
    this.stationEls.forEach((g, i) => g.classList.toggle('is-here', i === si && sd < 2));

    if (this.dro) {
      const txt = `X ${Math.round(s.x - this.stations[0]).toString().padStart(4, '0')} MM · Φ ${(((p.phi % 1) + 1) % 1).toFixed(2)} · V ${(Math.abs(s.v) / 1000).toFixed(2)} M/S`;
      if (txt !== this._dro) { this.dro.textContent = txt; this._dro = txt; }
    }
    if (this.iso.on) this.renderIso();
  }

  renderHead(B, k) {
    const s = this.s;
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw), ct = Math.cos(s.tilt), st = Math.sin(s.tilt);
    const piv = [246, 58];
    const Pp = (x, y, z) => {
      const xr = x * cy - z * sy;                 // yaw, projected onto the side plane
      return B(piv[0] + xr * ct - y * st, piv[1] + xr * st + y * ct);
    };
    const x0 = -16, x1 = 60, y0 = 10, y1 = 54, zz = 46;
    const neck = [B(piv[0] - 9, piv[1]), B(piv[0] + 9, piv[1]), B(piv[0] + 7, piv[1] + 11), B(piv[0] - 7, piv[1] + 11)];
    this.el.neck.setAttribute('d', new Path().poly(neck).toString());
    this.el.headSide.setAttribute('d', new Path().poly([Pp(x0, y0, zz), Pp(x1, y0, zz), Pp(x1, y1, zz), Pp(x0, y1, zz)]).toString());
    let end = '';
    if (sy > 0.02) end = new Path().poly([Pp(x1, y0, zz), Pp(x1, y0, -zz), Pp(x1, y1, -zz), Pp(x1, y1, zz)]).toString();
    else if (sy < -0.02) end = new Path().poly([Pp(x0, y0, zz), Pp(x0, y0, -zz), Pp(x0, y1, -zz), Pp(x0, y1, zz)]).toString();
    this.el.headEnd.setAttribute('d', end || 'M0 0');
    let lens = 'M0 0';
    if (sy > 0.05) {
      const pts = [];
      for (let i = 0; i < 18; i++) { const t = (i / 18) * Math.PI * 2; pts.push(Pp(x1, 32 + 12 * Math.sin(t), 12 * Math.cos(t))); }
      lens = new Path().poly(pts).toString();
    }
    this.el.lens.setAttribute('d', lens);
    const ls = [];
    for (let i = 0; i < 14; i++) { const t = (i / 14) * Math.PI * 2; ls.push(Pp(24 + 8 * Math.cos(t), 32 + 8 * Math.sin(t), zz)); }
    this.el.lensSide.setAttribute('d', new Path().poly(ls).toString());

    // sight lines while idling (a construction-line cone from the camera)
    const op = this.s.reduced ? 0 : 0.75 * this.s.ib * sstep(0.1, 0.5, Math.abs(Math.cos(s.yaw)));
    if (op > 0.01) {
      const o = Pp(x1, 32, 0), r = new Path();
      for (const a of [-9 * DEG, 9 * DEG]) {
        const e = Pp(x1 + 640 * Math.cos(a), 32 + 640 * Math.sin(a), 0);
        // stop at the ground line
        let ex = e[0], ey = e[1];
        if (ey > this.G - 1 && e[1] !== o[1]) { const t = (this.G - 1 - o[1]) / (e[1] - o[1]); ex = o[0] + (e[0] - o[0]) * t; ey = this.G - 1; }
        r.M(o[0], o[1]).L(ex, ey);
      }
      this.ray.setAttribute('d', r.toString());
    } else this.ray.setAttribute('d', 'M0 0');
    this.ray.setAttribute('opacity', n(op));
  }

  renderIso() {
    const I = this.iso, sc = I.s, p = this.pose, X0 = p.x;
    const C30 = 0.8660254, S30 = 0.5;
    const P = (x, y, z) => [I.cx + (x - z) * C30 * sc, I.cy - y * sc + (x + z) * S30 * sc];
    const c = Math.cos(p.pitch), sn = Math.sin(p.pitch);
    const Bw = (bx, by, z) => P(c * bx - sn * by, p.y + sn * bx + c * by, z); // body frame -> iso (x relative to body)

    // ground grid scrolls with travel so planted feet stay put on it
    const G = 150, gp = new Path();
    const off = ((X0 % G) + G) % G;
    for (let gx = -600 - off; gx <= 600; gx += G) { const a = P(gx, 0, -330), b = P(gx, 0, 330); gp.M(a[0], a[1]).L(b[0], b[1]); }
    for (let gz = -300; gz <= 300; gz += G) { const a = P(-640, 0, gz), b = P(640, 0, gz); gp.M(a[0], a[1]).L(b[0], b[1]); }
    this.isoGrid.setAttribute('d', gp.toString());

    // body prism: extrude the side profile across the width
    const Z = 130;
    const near = BODY.map((q) => Bw(q[0], q[1], Z)), far = BODY.map((q) => Bw(q[0], q[1], -Z));
    const vis = BODY.map((q, i) => {
      const r = BODY[(i + 1) % BODY.length];
      const dx = r[0] - q[0], dy = r[1] - q[1];
      const nx = -dy, ny = dx;                       // outward normal (clockwise profile)
      const wx = c * nx - sn * ny, wy = sn * nx + c * ny;
      return wx + wy > 0;                            // faces the (1,1,1) viewer
    });
    const solid = new Path(), hidden = new Path();
    solid.poly(near);
    BODY.forEach((q, i) => {
      const j = (i + 1) % BODY.length;
      (vis[i] ? solid : hidden).M(far[i][0], far[i][1]).L(far[j][0], far[j][1]);
      const prev = (i - 1 + BODY.length) % BODY.length;
      (vis[i] || vis[prev] ? solid : hidden).M(near[i][0], near[i][1]).L(far[i][0], far[i][1]);
    });
    this.isoBody.setAttribute('d', solid.toString());
    this.isoHidden.setAttribute('d', hidden.toString());

    // head pod
    const s = this.s, cy = Math.cos(s.yaw), sy = Math.sin(s.yaw), ct = Math.cos(s.tilt), st = Math.sin(s.tilt);
    const pod = (x, y, z) => {
      const xr = x * cy - z * sy, zr = x * sy + z * cy;
      return Bw(246 + xr * ct - y * st, 58 + xr * st + y * ct, zr);
    };
    const hp = new Path();
    const xs = [-16, 60], ys = [10, 54], zs = [-46, 46];
    const corner = (i, j, l) => pod(xs[i], ys[j], zs[l]);
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      let q0 = corner(0, a, b), q1 = corner(1, a, b); hp.M(q0[0], q0[1]).L(q1[0], q1[1]);
      q0 = corner(a, 0, b); q1 = corner(a, 1, b); hp.M(q0[0], q0[1]).L(q1[0], q1[1]);
      q0 = corner(a, b, 0); q1 = corner(a, b, 1); hp.M(q0[0], q0[1]).L(q1[0], q1[1]);
    }
    this.isoHead.setAttribute('d', hp.toString());

    // legs (x relative to the body), near legs at +z
    const nearP = new Path(), farP = new Path(), joints = new Path(), contacts = new Path();
    for (const leg of this.legs) {
      const z = leg.near ? Q.legZ : -Q.legZ;
      const H = P(leg.hip.x - X0, leg.hip.y, z), K = P(leg.knee.x - X0, leg.knee.y, z), F = P(leg.foot.x - X0, leg.foot.y, z);
      const path = leg.near ? nearP : farP;
      path.M(H[0], H[1]).L(K[0], K[1]).L(F[0], F[1]);
      if (leg.near) { joints.circle(H[0], H[1], 2.2).circle(K[0], K[1], 1.6).circle(F[0], F[1], 1.6); }
      if (leg.tgt.stance) {
        const g0 = P(leg.foot.x - X0 - 30, 0, z), g1 = P(leg.foot.x - X0 + 30, 0, z);
        contacts.M(g0[0], g0[1]).L(g1[0], g1[1]);
      }
    }
    this.isoNear.setAttribute('d', nearP.toString());
    this.isoFar.setAttribute('d', farP.toString());
    this.isoJoints.setAttribute('d', joints.toString());
    this.isoShadow.setAttribute('d', contacts.toString());
    // small axis triad in the corner: x (travel), y (up), z (toward the near side)
    const o = [14, I.h - 10], L = 8;
    const ax = new Path()
      .M(o[0], o[1]).L(o[0] + L * C30, o[1] + L * S30)
      .M(o[0], o[1]).L(o[0], o[1] - L)
      .M(o[0], o[1]).L(o[0] - L * C30, o[1] + L * S30);
    this.isoAxes.setAttribute('d', ax.toString());
  }

  // ------------------------------------------------------------ hover text
  describe(part) {
    const deg = (r) => (r / DEG).toFixed(1);
    const sc = Math.round(this.scaleDenominator());
    if (part && part.startsWith('leg-')) {
      const leg = this.legs.find((l) => 'leg-' + l.id === part);
      if (!leg) return null;
      const hipAng = leg.t1 - (this.pose.pitch - Math.PI / 2);
      const knee = leg.t2 - leg.t1;
      const phase = leg.tgt.stance ? 'stance · foot planted' : `swing · ${Math.round(leg.tgt.s * 100)}%`;
      return { title: leg.label, body: `Hip ${deg(hipAng)}° · knee ${deg(knee)}° · ${phase}. Thigh 220 mm, shin 220 mm, solved by 2-link IK.` };
    }
    const T = {
      body: ['Body frame', `Q-4 concept quadruped, 650 mm long, drawn at 1:${sc}. Hidden lines show the far legs.`],
      'hip-front': ['Front hip actuator', 'Pitch joint, Ø88 housing. Center mark extends past the part, as drawn on a CAD sheet.'],
      'hip-rear': ['Rear hip actuator', 'Pitch joint, Ø88 housing.'],
      handle: ['Carry handle', '192 mm bar on two posts.'],
      antenna: ['Antenna', 'Sprung mast; it sways when the body accelerates.'],
      head: ['Sensor head', `Pan/tilt camera pod. Pan ${deg(this.s.yaw)}°, tilt ${deg(this.s.tilt)}°.`],
    }[part];
    return T ? { title: T[0], body: T[1] } : null;
  }
}
