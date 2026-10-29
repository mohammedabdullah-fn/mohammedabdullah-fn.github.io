// Holonomic motion for the mecanum rover: input shaping, A* path planning and path following.
// Pure maths, no three.js. Units: metres, seconds, radians.
//
// World frame: x east, z south, y up. Heading psi: forward = (sin psi, cos psi) in (x, z),
// left = (cos psi, -sin psi). Positive yaw rate turns left (counter-clockwise seen from above).

export const KIN = {
  wheelR: 0.1,
  rollerR: 0.019,
  // Wheel order FL, FR, RL, RR. f/l = offset of the wheel centre along forward/left.
  // s = roller chirality: the ground-contact roller axis is (left, fwd) = (0.707, -0.707 s).
  wheels: [
    { id: 'FL', f:  0.25, l:  0.35, s:  1 },
    { id: 'FR', f:  0.25, l: -0.35, s: -1 },
    { id: 'RL', f: -0.25, l:  0.35, s: -1 },
    { id: 'RR', f: -0.25, l: -0.35, s:  1 },
  ],
};

export const LIMITS = {
  vMax: 1.5,       // m/s
  aMax: 1.8,       // m/s^2, slew limit on the velocity reference
  wMax: 2.4,       // rad/s
  alphaMax: 5.5,   // rad/s^2
  wn: 12,          // rad/s, natural frequency of the critically damped smoothing stage
  aBrake: 1.1,     // m/s^2, planned braking (kept below aMax so the shaper can always follow)
  kPos: 2.2,       // 1/s, final-approach position gain
  aLat: 1.0,       // m/s^2, lateral acceleration allowed on curves
  kYaw: 2.0,       // 1/s, heading gain
  alphaBrake: 2.6, // rad/s^2, planned yaw braking
};

const TAU = Math.PI * 2;
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------------------------------------
// Path planning: straight line when clear, otherwise A* on a 0.2 m grid with soft circular
// obstacles, then line-of-sight shortcutting, corner fillets and arc-length resampling.

function segClear(ax, az, bx, bz, obs) {
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz;
  for (const o of obs) {
    let t = L2 > 1e-12 ? ((o.x - ax) * dx + (o.z - az) * dz) / L2 : 0;
    t = clamp(t, 0, 1);
    const px = ax + dx * t - o.x, pz = az + dz * t - o.z;
    if (px * px + pz * pz < o.r * o.r) return false;
  }
  return true;
}

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

function astar(sx, sz, gx, gz, obs, bound) {
  const res = 0.2;
  const N = Math.ceil((2 * bound) / res) + 1;
  const org = -bound;
  const cx = (i) => org + i * res;
  const idx = (x) => clamp(Math.round((x - org) / res), 0, N - 1);
  const cost = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      let c = 1;
      const x = cx(i), z = cx(j);
      for (const o of obs) {
        const dx = x - o.x, dz = z - o.z;
        if (dx * dx + dz * dz < o.r * o.r) c += 40;
      }
      cost[j * N + i] = c;
    }
  }
  const si = idx(sx), sj = idx(sz), gi = idx(gx), gj = idx(gz);
  const start = sj * N + si, goal = gj * N + gi;
  const g = new Float32Array(N * N).fill(Infinity);
  const from = new Int32Array(N * N).fill(-1);
  const closed = new Uint8Array(N * N);
  const h = (i, j) => {
    const dx = Math.abs(i - gi), dz = Math.abs(j - gj);
    return Math.max(dx, dz) + 0.41421356 * Math.min(dx, dz);
  };
  const heap = new MinHeap();
  g[start] = 0;
  heap.push(h(si, sj), start);
  const nbr = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.41421356], [1, -1, 1.41421356], [-1, 1, 1.41421356], [-1, -1, 1.41421356]];
  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) break;
    const ci = cur % N, cj = (cur - ci) / N;
    for (const [di, dj, w] of nbr) {
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const nid = nj * N + ni;
      if (closed[nid]) continue;
      const ng = g[cur] + w * 0.5 * (cost[cur] + cost[nid]);
      if (ng < g[nid]) {
        g[nid] = ng;
        from[nid] = cur;
        heap.push(ng + h(ni, nj), nid);
      }
    }
  }
  if (from[goal] === -1 && goal !== start) return null;
  const pts = [];
  for (let c = goal; c !== -1; c = from[c]) {
    const i = c % N, j = (c - i) / N;
    pts.push({ x: cx(i), z: cx(j) });
    if (c === start) break;
  }
  pts.reverse();
  pts[0] = { x: sx, z: sz };
  pts[pts.length - 1] = { x: gx, z: gz };
  return pts;
}

function shortcut(pts, obs) {
  const out = [pts[0]];
  let a = 0;
  while (a < pts.length - 1) {
    let b = pts.length - 1;
    while (b > a + 1 && !segClear(pts[a].x, pts[a].z, pts[b].x, pts[b].z, obs)) b--;
    out.push(pts[b]);
    a = b;
  }
  return out;
}

// Round each corner with a quadratic Bezier fillet, then resample at a fixed arc-length step.
function smoothResample(poly, ds) {
  const dense = [poly[0]];
  for (let i = 1; i < poly.length - 1; i++) {
    const p0 = poly[i - 1], p1 = poly[i], p2 = poly[i + 1];
    const l1 = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    const l2 = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const f = Math.min(0.7, 0.45 * l1, 0.45 * l2);
    if (f < 1e-4) { dense.push(p1); continue; }
    const a = { x: p1.x + ((p0.x - p1.x) / l1) * f, z: p1.z + ((p0.z - p1.z) / l1) * f };
    const b = { x: p1.x + ((p2.x - p1.x) / l2) * f, z: p1.z + ((p2.z - p1.z) / l2) * f };
    dense.push(a);
    for (let k = 1; k < 12; k++) {
      const t = k / 12, u = 1 - t;
      dense.push({ x: u * u * a.x + 2 * u * t * p1.x + t * t * b.x, z: u * u * a.z + 2 * u * t * p1.z + t * t * b.z });
    }
    dense.push(b);
  }
  dense.push(poly[poly.length - 1]);

  const X = [dense[0].x], Z = [dense[0].z];
  let carry = 0;
  for (let i = 1; i < dense.length; i++) {
    const ax = dense[i - 1].x, az = dense[i - 1].z;
    const dx = dense[i].x - ax, dz = dense[i].z - az;
    const L = Math.hypot(dx, dz);
    if (L < 1e-9) continue;
    let t = ds - carry;
    while (t <= L) {
      X.push(ax + (dx * t) / L);
      Z.push(az + (dz * t) / L);
      t += ds;
    }
    carry = L - (t - ds);
  }
  const last = dense[dense.length - 1];
  const lx = X[X.length - 1], lz = Z[Z.length - 1];
  if (Math.hypot(last.x - lx, last.z - lz) > 1e-4) { X.push(last.x); Z.push(last.z); }
  return { X, Z };
}

export function planPath(sx, sz, gx, gz, obstacles, bound) {
  gx = clamp(gx, -bound, bound);
  gz = clamp(gz, -bound, bound);
  // Ignore obstacles that contain the start or goal so the rover can always leave or arrive.
  const obs = obstacles.filter((o) => Math.hypot(sx - o.x, sz - o.z) > o.r && Math.hypot(gx - o.x, gz - o.z) > o.r);
  let poly;
  if (segClear(sx, sz, gx, gz, obs)) poly = [{ x: sx, z: sz }, { x: gx, z: gz }];
  else {
    const raw = astar(sx, sz, gx, gz, obs, bound);
    poly = raw ? shortcut(raw, obs) : [{ x: sx, z: sz }, { x: gx, z: gz }];
  }
  const ds = 0.04;
  const { X, Z } = smoothResample(poly, ds);
  const n = X.length;
  const S = new Float32Array(n);
  for (let i = 1; i < n; i++) S[i] = S[i - 1] + Math.hypot(X[i] - X[i - 1], Z[i] - Z[i - 1]);
  // Speed profile: curvature limit plus a backward pass so the rover brakes before tight bends.
  // (Braking for the goal itself is done analytically in follow(), from the exact distance.)
  const V = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let k = 0;
    if (i > 0 && i < n - 1) {
      const a1 = Math.atan2(Z[i] - Z[i - 1], X[i] - X[i - 1]);
      const a2 = Math.atan2(Z[i + 1] - Z[i], X[i + 1] - X[i]);
      const seg = 0.5 * (S[i + 1] - S[i - 1]);
      k = seg > 1e-6 ? Math.abs(wrapAngle(a2 - a1)) / seg : 0;
    }
    V[i] = Math.min(LIMITS.vMax, Math.sqrt(LIMITS.aLat / Math.max(k, 1e-4)));
  }
  for (let i = n - 2; i >= 0; i--) {
    V[i] = Math.min(V[i], Math.sqrt(V[i + 1] * V[i + 1] + 2 * LIMITS.aBrake * (S[i + 1] - S[i])));
  }
  return { X, Z, S, V, n, L: S[n - 1], corners: poly.length - 2 };
}

// ---------------------------------------------------------------------------------------------

export class Drive {
  constructor({ half, margin = 0.45, obstacles = [] }) {
    this.bound = half - margin;
    this.obstacles = obstacles; // [{ id, x, z, r }]
    this.wheelAngle = [0, 0, 0, 0];
    this.wheelRate = [0, 0, 0, 0];
    this.rim = [0, 0, 0, 0];
    this.rollerAngle = [0, 0, 0, 0];
    this.rollerRate = [0, 0, 0, 0];
    this.travel = [0, 0, 0, 0];
    this.contactSpeed = [0, 0, 0, 0];
    this.manual = { x: 0, z: 0, w: 0 };
    this.hold = false;
    this.arrival = null;
    this.teleport(0, 0, 0);
  }

  teleport(x, z, psi) {
    this.x = x; this.z = z; this.psi = wrapAngle(psi);
    this.vx = 0; this.vz = 0; this.ax = 0; this.az = 0; this.rx = 0; this.rz = 0;
    this.w = 0; this.aw = 0; this.rw = 0;
    this.path = null;
    this.mode = 'idle';
    this.updateWheels(0);
  }

  // Unit commands in the world frame (from keys, gamepad or joystick). |(x, z)| <= 1, |w| <= 1.
  setManual(x, z, w) {
    this.manual.x = x; this.manual.z = z; this.manual.w = w;
    const active = Math.hypot(x, z) > 0.02 || Math.abs(w) > 0.02;
    if (active) {
      if (this.mode === 'auto') this.path = null;
      this.mode = 'manual';
    } else if (this.mode === 'manual') {
      this.mode = 'idle';
    }
  }

  planTo(gx, gz, { beacon = null } = {}) {
    const obs = this.obstacles.filter((o) => o.id !== beacon);
    const p = planPath(this.x, this.z, gx, gz, obs, this.bound);
    p.i = 0;
    p.beacon = beacon;
    p.gx = p.X[p.n - 1];
    p.gz = p.Z[p.n - 1];
    // Long trips turn to face the direction of travel; short hops strafe and keep the heading.
    p.faceTravel = p.L > 1.2;
    p.psiDes = this.psi;
    if (p.faceTravel) {
      const k = Math.min(p.n - 1, 12);
      p.psiDes = Math.atan2(p.X[k] - p.X[0], p.Z[k] - p.Z[0]);
    }
    this.path = p;
    this.mode = 'auto';
    this.arrival = null;
    return p;
  }

  cancel() {
    this.path = null;
    if (this.mode === 'auto') this.mode = 'idle';
  }

  remaining() {
    const P = this.path;
    if (!P) return 0;
    return Math.max(0, P.L - (P.s ?? P.S[P.i]));
  }

  consumeArrival() {
    const a = this.arrival;
    this.arrival = null;
    return a;
  }

  follow() {
    const P = this.path;
    const L = LIMITS;
    let best = P.i, bestD = Infinity;
    const end = Math.min(P.n - 1, P.i + 40);
    for (let k = P.i; k <= end; k++) {
      const dx = P.X[k] - this.x, dz = P.Z[k] - this.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = k; }
    }
    P.i = best;
    // Refine progress by projecting onto the segment ahead, so "remaining" is continuous.
    let sCur = P.S[best];
    if (best < P.n - 1) {
      const sx = P.X[best + 1] - P.X[best], sz = P.Z[best + 1] - P.Z[best];
      const sl2 = sx * sx + sz * sz;
      if (sl2 > 1e-12) {
        const t = clamp(((this.x - P.X[best]) * sx + (this.z - P.Z[best]) * sz) / sl2, 0, 1);
        sCur += t * Math.sqrt(sl2);
      }
    }
    P.s = sCur;
    const remaining = Math.max(0, P.L - sCur);
    const dGoal = Math.hypot(P.gx - this.x, P.gz - this.z);
    const speed = Math.hypot(this.vx, this.vz);

    // Heading target: path tangent at the lookahead point, frozen for the last few centimetres.
    const Ld = 0.3 + 0.35 * speed;
    const k2 = this.indexAt(sCur + Ld);
    if (P.faceTravel && remaining > 0.35) {
      const a = Math.max(0, k2 - 2), b = Math.min(P.n - 1, k2 + 2);
      const tx = P.X[b] - P.X[a], tz = P.Z[b] - P.Z[a];
      if (tx * tx + tz * tz > 1e-8) P.psiDes = Math.atan2(tx, tz);
    }
    const e = wrapAngle(P.psiDes - this.psi);

    if (dGoal < 0.012 && speed < 0.03 && Math.abs(e) < 0.01 && Math.abs(this.w) < 0.05) {
      this.arrival = { x: this.x, z: this.z, beacon: P.beacon };
      this.path = null;
      this.mode = 'idle';
      return [0, 0, 0];
    }

    const kp = this.indexAt(sCur + 0.12); // look slightly ahead to absorb the shaper's lag
    const vDes = Math.min(L.vMax, P.V[kp], Math.sqrt(2 * L.aBrake * remaining), L.kPos * dGoal);
    let tx = P.X[k2] - this.x, tz = P.Z[k2] - this.z;
    const tm = Math.hypot(tx, tz);
    let cx = 0, cz = 0;
    if (tm > 1e-6) { cx = (tx / tm) * vDes; cz = (tz / tm) * vDes; }
    const ae = Math.abs(e);
    const cw = Math.sign(e) * Math.min(L.wMax, Math.sqrt(2 * L.alphaBrake * ae), L.kYaw * ae);
    return [cx, cz, cw];
  }

  indexAt(s) {
    const P = this.path;
    if (s >= P.L) return P.n - 1;
    // Uniform resampling: S[i] ~= i * ds.
    let i = Math.min(P.n - 1, Math.max(0, Math.floor(s / 0.04)));
    while (i < P.n - 1 && P.S[i] < s) i++;
    return i;
  }

  wallLimit(c, pos) {
    const L = LIMITS;
    if (c > 0) {
      const d = Math.max(0, this.bound - pos);
      return Math.min(c, Math.sqrt(2 * L.aBrake * d), L.kPos * d);
    }
    if (c < 0) {
      const d = Math.max(0, this.bound + pos);
      return Math.max(c, -Math.min(Math.sqrt(2 * L.aBrake * d), L.kPos * d));
    }
    return c;
  }

  step(h) {
    const L = LIMITS;
    let cx = 0, cz = 0, cw = 0;
    if (!this.hold) {
      if (this.mode === 'manual') {
        cx = this.manual.x * L.vMax;
        cz = this.manual.z * L.vMax;
        cw = this.manual.w * L.wMax;
      } else if (this.mode === 'auto' && this.path) {
        [cx, cz, cw] = this.follow();
      }
    }
    cx = this.wallLimit(cx, this.x);
    cz = this.wallLimit(cz, this.z);

    // Stage 1: slew-rate limit on the reference (bounds acceleration).
    let dx = cx - this.rx, dz = cz - this.rz;
    const m = Math.hypot(dx, dz), lim = L.aMax * h;
    if (m > lim) { dx *= lim / m; dz *= lim / m; }
    this.rx += dx; this.rz += dz;
    let dw = cw - this.rw;
    const limw = L.alphaMax * h;
    if (dw > limw) dw = limw; else if (dw < -limw) dw = -limw;
    this.rw += dw;

    // Stage 2: critically damped 2nd-order follower (continuous acceleration, bounded jerk,
    // no overshoot for monotone references).
    const wn = L.wn, wn2 = wn * wn;
    this.ax += (wn2 * (this.rx - this.vx) - 2 * wn * this.ax) * h;
    this.az += (wn2 * (this.rz - this.vz) - 2 * wn * this.az) * h;
    this.aw += (wn2 * (this.rw - this.w) - 2 * wn * this.aw) * h;
    this.vx += this.ax * h;
    this.vz += this.az * h;
    this.w += this.aw * h;

    // Settle exactly to rest once everything is negligible (avoids endless micro-motion).
    if (cx === 0 && cz === 0 && cw === 0 && Math.abs(this.rx) + Math.abs(this.rz) + Math.abs(this.rw) < 1e-9) {
      if (Math.abs(this.vx) + Math.abs(this.vz) < 1e-5 && Math.abs(this.ax) + Math.abs(this.az) < 1e-4) {
        this.vx = this.vz = this.ax = this.az = 0;
      }
      if (Math.abs(this.w) < 1e-5 && Math.abs(this.aw) < 1e-4) this.w = this.aw = 0;
    }

    this.x += this.vx * h;
    this.z += this.vz * h;
    this.psi = wrapAngle(this.psi + this.w * h);

    // Hard walls (the soft limit above normally stops the rover before it gets here).
    const b = this.bound;
    if (this.x > b || this.x < -b) {
      this.x = clamp(this.x, -b, b);
      if (this.x * this.vx > 0) this.vx = 0;
      if (this.x * this.ax > 0) this.ax = 0;
      if (this.x * this.rx > 0) this.rx = 0;
    }
    if (this.z > b || this.z < -b) {
      this.z = clamp(this.z, -b, b);
      if (this.z * this.vz > 0) this.vz = 0;
      if (this.z * this.az > 0) this.az = 0;
      if (this.z * this.rz > 0) this.rz = 0;
    }
    this.updateWheels(h);
  }

  bodyVel() {
    const s = Math.sin(this.psi), c = Math.cos(this.psi);
    return { f: this.vx * s + this.vz * c, l: this.vx * c - this.vz * s, w: this.w };
  }

  bodyAcc() {
    const s = Math.sin(this.psi), c = Math.cos(this.psi);
    return { f: this.ax * s + this.az * c, l: this.ax * c - this.az * s };
  }

  updateWheels(h) {
    const { f: vf, l: vl } = this.bodyVel();
    const R = KIN.wheelR;
    for (let i = 0; i < 4; i++) {
      const W = KIN.wheels[i];
      const vfp = vf - this.w * W.l;
      const vlp = vl + this.w * W.f;
      const rim = vfp - W.s * vlp; // inverse kinematics: rim speed, + = rolling forward
      this.rim[i] = rim;
      this.wheelRate[i] = rim / R;
      this.wheelAngle[i] = (this.wheelAngle[i] + this.wheelRate[i] * h) % TAU;
      this.rollerRate[i] = (Math.SQRT2 * W.s * vlp) / KIN.rollerR;
      this.rollerAngle[i] = (this.rollerAngle[i] + this.rollerRate[i] * h) % TAU;
      const sp = Math.hypot(vfp, vlp);
      this.contactSpeed[i] = sp;
      this.travel[i] += sp * h;
    }
  }

  // World position of a wheel's ground contact.
  wheelGround(i) {
    const W = KIN.wheels[i];
    const s = Math.sin(this.psi), c = Math.cos(this.psi);
    return { x: this.x + W.f * s + W.l * c, z: this.z + W.f * c - W.l * s };
  }
}
