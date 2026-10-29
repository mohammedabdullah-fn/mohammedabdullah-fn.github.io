import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp } from './util.js';

/* MA-01: a 5-axis articulated arm (base yaw, shoulder, elbow, wrist pitch, tool roll).
   Scene units are metres at 1:3 — the HUD reports them ×1000 as millimetres. */
export const L1 = 1.2;            // shoulder → elbow
export const L2 = 1.1;            // elbow → wrist
export const L3 = 0.4;            // wrist → tool centre point (between the fingertips)
export const SHOULDER_Y = 0.63;   // shoulder axis above the arm root
export const REACH = (L1 + L2 + L3) * 0.95;   // soft reach: never ask for a fully straight (singular) arm
export const DOWN = -Math.PI / 2;
export const LIMITS = { yaw: [-2.9, 2.9], sh: [-0.5, 2.5], el: [-2.8, 0.1], wr: [-2.3, 2.3], roll: [-3.1, 3.1] };
export const FOLDED = { yaw: 0.55, sh: 1.5, el: -2.55, wr: 1.05, roll: 0 };
export const CYAN = new THREE.Color(0x56e1ff);

const TAU = Math.PI * 2;
export const wrapPi = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
export const wrapQuarter = (a) => a - (Math.PI / 2) * Math.round(a / (Math.PI / 2));

// One servo axis: critically damped position loop with velocity feedforward, plus velocity and
// acceleration limits. Feedforward is what lets a real drive follow a moving reference with ~zero lag.
class Joint {
  constructor(obj, axis, sign, [min, max], x, vmax, amax) {
    Object.assign(this, { obj, axis, sign, min, max, x, vmax, amax });
    this.v = 0;
    this.goal = x;
    this.g0 = x;     // goal at the start of the current frame
    this.gv = 0;     // reference velocity (feedforward)
    this.apply();
  }

  step(h, w, speed, ref) {
    const amax = this.amax * speed;
    let a = w * w * (ref - this.x) + 2 * w * (this.gv - this.v);
    a = clamp(a, -amax, amax);
    let v = clamp(this.v + a * h, -this.vmax * speed, this.vmax * speed);
    // soft limits: never approach an end stop faster than the axis can brake (no hard-stop kick)
    v = Math.min(v, Math.sqrt(2 * amax * Math.max(0, this.max - this.x)));
    v = Math.max(v, -Math.sqrt(2 * amax * Math.max(0, this.x - this.min)));
    this.v = v;
    this.x = clamp(this.x + v * h, this.min, this.max);
  }

  apply() { this.obj.rotation[this.axis] = this.sign * this.x; }
}

export class Arm {
  constructor() {
    this.root = new THREE.Group();
    this.pickables = [];
    this.grip = 1;            // gripper command: 0 closed … 1 open
    this.gripX = 1;
    this.gripV = 0;
    this.servo = 20;          // position-loop bandwidth, rad/s
    this.speedScale = 1;
    this.speed = 0;
    this.glowBoost = 0;
    this.elbowGoal = 0;
    this.elbowHi = 0;
    this._v = new THREE.Vector3();
    this._build();
  }

  _add(parent, geo, mat, x = 0, y = 0, z = 0, { pick = true, edges = false, angle = 24 } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    if (pick) this.pickables.push(m);
    if (edges) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, angle), this.edgeMat));
    return m;
  }

  // Side covers of a joint hub: dark bezel, glowing actuator core, thin halo.
  _caps(group, r, half, glowMat) {
    const caps = [];
    for (const s of [-1, 1]) {
      const c = new THREE.Group();
      c.position.x = s * (half + 0.002);
      c.rotation.y = s * Math.PI / 2;
      c.userData.home = half + 0.002;
      group.add(c);
      c.add(new THREE.Mesh(new THREE.RingGeometry(r * 0.5, r * 0.8, 48), this.dark));
      const disc = new THREE.Mesh(new THREE.CircleGeometry(r * 0.3, 40), glowMat);
      disc.position.z = 0.001;
      c.add(disc);
      const halo = new THREE.Mesh(new THREE.RingGeometry(r * 0.85, r * 0.91, 56), glowMat);
      halo.position.z = 0.001;
      c.add(halo);
      caps.push(c);
    }
    return caps;
  }

  _build() {
    const shell = new THREE.MeshPhysicalMaterial({ color: 0xeceae6, roughness: 0.3, metalness: 0, clearcoat: 0.75, clearcoatRoughness: 0.2 });
    const shell2 = new THREE.MeshPhysicalMaterial({ color: 0xd2cec9, roughness: 0.38, metalness: 0.05, clearcoat: 0.4, clearcoatRoughness: 0.3 });
    const dark = (this.dark = new THREE.MeshStandardMaterial({ color: 0x16161a, roughness: 0.38, metalness: 0.65, side: THREE.DoubleSide }));
    const rubber = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.9 });
    const redGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.16, 0.18), toneMapped: false });
    this.glow = new THREE.MeshBasicMaterial({ color: CYAN.clone().multiplyScalar(2.2), toneMapped: false, side: THREE.DoubleSide });
    this.elbowGlow = this.glow.clone();
    this.edgeMat = new THREE.LineBasicMaterial({ color: 0x24222a, transparent: true, opacity: 0.6 });
    const alongX = (g) => g.rotateZ(Math.PI / 2);
    const alongZ = (g) => g.rotateX(Math.PI / 2);
    const R = this.root;

    // base plate, glowing ring and bolt circle
    this._add(R, new THREE.CylinderGeometry(0.48, 0.52, 0.05, 56), dark, 0, 0.025, 0, { pick: false, edges: true });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.53, 0.011, 8, 96), redGlow);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.052;
    R.add(ring);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 0.2;
      this._add(R, new THREE.CylinderGeometry(0.022, 0.022, 0.02, 12), dark, Math.cos(a) * 0.42, 0.06, Math.sin(a) * 0.42, { pick: false });
    }

    // J0 · base yaw turret
    const yaw = new THREE.Group();
    yaw.position.y = 0.05;
    R.add(yaw);
    this._add(yaw, new RoundedBoxGeometry(0.6, 0.38, 0.6, 3, 0.05), shell, 0, 0.19, 0);
    this._add(yaw, new RoundedBoxGeometry(0.63, 0.07, 0.63, 2, 0.02), dark, 0, 0.365, 0);
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.016, 0.004), this.glow);
    led.position.set(0, 0.24, 0.302);
    yaw.add(led);

    // J1 · shoulder pitch + upper arm
    const sh = new THREE.Group();
    sh.position.y = SHOULDER_Y - 0.05;
    yaw.add(sh);
    this._add(sh, alongX(new THREE.CylinderGeometry(0.22, 0.22, 0.4, 48)), shell, 0, 0, 0, { edges: true });
    const shCaps = this._caps(sh, 0.22, 0.2, this.glow);
    this._add(sh, alongZ(new THREE.CylinderGeometry(0.112, 0.13, L1 - 0.12, 40)).translate(0, 0, (L1 - 0.12) / 2 + 0.06), shell, 0, 0, 0, { edges: true });
    for (const z of [0.42, 0.8]) this._add(sh, new THREE.TorusGeometry(0.124, 0.008, 8, 48), dark, 0, 0, z, { pick: false });
    this._add(sh, alongZ(new THREE.CylinderGeometry(0.02, 0.02, L1 * 0.72, 10)), rubber, 0, 0.128, L1 * 0.5, { pick: false });

    // J2 · elbow + forearm
    const el = new THREE.Group();
    el.position.z = L1;
    sh.add(el);
    this._add(el, alongX(new THREE.CylinderGeometry(0.17, 0.17, 0.34, 44)), shell, 0, 0, 0, { edges: true });
    const elCaps = this._caps(el, 0.17, 0.17, this.elbowGlow);
    this._add(el, alongZ(new THREE.CylinderGeometry(0.078, 0.098, L2 - 0.1, 36)).translate(0, 0, (L2 - 0.1) / 2 + 0.05), shell, 0, 0, 0, { edges: true });
    for (const z of [0.38, 0.74]) this._add(el, new THREE.TorusGeometry(0.09, 0.007, 8, 40), dark, 0, 0, z, { pick: false });

    // J3 · wrist pitch
    const wr = new THREE.Group();
    wr.position.z = L2;
    el.add(wr);
    this._add(wr, alongX(new THREE.CylinderGeometry(0.11, 0.11, 0.23, 36)), shell, 0, 0, 0, { edges: true });
    const wrCaps = this._caps(wr, 0.11, 0.115, this.glow);

    // J4 · tool roll + parallel gripper
    const roll = new THREE.Group();
    wr.add(roll);
    this._add(roll, alongZ(new THREE.CylinderGeometry(0.07, 0.082, 0.12, 32)).translate(0, 0, 0.11), dark, 0, 0, 0, { edges: true });
    this._add(roll, new RoundedBoxGeometry(0.3, 0.11, 0.1, 2, 0.022), shell, 0, 0, 0.21);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.006, 0.03), this.glow);
    strip.position.set(0, 0.056, 0.21);
    roll.add(strip);
    this.fingers = [-1, 1].map((side) => {
      const f = new THREE.Group();
      f.position.z = 0.21;
      f.userData.side = side;
      roll.add(f);
      this._add(f, new RoundedBoxGeometry(0.034, 0.08, 0.22, 2, 0.01), shell2, 0, 0, 0.15);
      this._add(f, new THREE.BoxGeometry(0.008, 0.062, 0.12), rubber, -side * 0.019, 0, 0.19, { pick: false });
      return f;
    });
    this.tcp = new THREE.Object3D();
    this.tcp.position.z = L3;
    roll.add(this.tcp);

    this.j = {
      yaw: new Joint(yaw, 'y', 1, LIMITS.yaw, FOLDED.yaw, 2.4, 10),
      sh: new Joint(sh, 'x', -1, LIMITS.sh, FOLDED.sh, 2.2, 9),
      el: new Joint(el, 'x', -1, LIMITS.el, FOLDED.el, 2.8, 11),
      wr: new Joint(wr, 'x', -1, LIMITS.wr, FOLDED.wr, 4, 18),
      roll: new Joint(roll, 'z', 1, LIMITS.roll, FOLDED.roll, 5, 24),
    };
    this.groups = { yaw, sh, el, wr, roll };
    this.caps = [...shCaps, ...elCaps, ...wrCaps];
    this._shY = sh.position.y;

    // CAD joint frames (shown in design mode)
    this.frames = [yaw, sh, el, wr, roll].map((g) => {
      const a = new THREE.AxesHelper(0.34);
      a.visible = false;
      a.material.depthTest = false;
      a.material.toneMapped = false;
      a.renderOrder = 20;
      g.add(a);
      return a;
    });
  }

  setGoals(q) {
    for (const k in this.j) if (Number.isFinite(q[k])) this.j[k].goal = q[k];
  }

  update(dt) {
    const n = Math.max(1, Math.ceil(dt / 0.004));
    const h = dt / n;
    for (const k in this.j) {
      const J = this.j[k];
      J.gv = dt > 0 ? clamp((J.goal - J.g0) / dt, -J.vmax, J.vmax) : 0;
    }
    for (let i = 0; i < n; i++) {
      const f = (i + 1) / n;
      for (const k in this.j) {
        const J = this.j[k];
        J.step(h, this.servo, this.speedScale, J.g0 + (J.goal - J.g0) * f);   // goal interpolated across sub-steps
      }
    }
    for (const k in this.j) {
      this.j[k].g0 = this.j[k].goal;
      this.j[k].apply();
    }

    // gripper fingers: their own critically damped loop
    const w = 22;
    this.gripV += (w * w * (this.grip - this.gripX) - 2 * w * this.gripV) * dt;
    this.gripX = clamp(this.gripX + this.gripV * dt, 0, 1.05);
    const gap = 0.04 + this.gripX * 0.3;
    for (const f of this.fingers) f.position.x = f.userData.side * (gap / 2 + 0.017);

    // actuator cores brighten with joint effort
    const J = this.j;
    this.speed = Math.abs(J.yaw.v) + Math.abs(J.sh.v) + Math.abs(J.el.v) + Math.abs(J.wr.v);
    const k = 2 + Math.min(1.6, this.speed * 0.45) + this.glowBoost;
    this.glow.color.copy(CYAN).multiplyScalar(k);
    this.elbowHi += (this.elbowGoal - this.elbowHi) * (1 - Math.exp(-dt * 6));
    this.elbowGlow.color.copy(CYAN).multiplyScalar(k + this.elbowHi * (1.8 + Math.sin(performance.now() * 0.009) * 1.2));
    this.root.updateMatrixWorld(true);
  }

  // True once every axis has reached its goal and stopped.
  settled(tol = 0.012) {
    for (const k in this.j) {
      const J = this.j[k];
      if (Math.abs(J.goal - J.x) > tol || Math.abs(J.v) > 0.25) return false;
    }
    return true;
  }

  q(out = {}) {
    for (const k in this.j) out[k] = this.j[k].x;
    return out;
  }

  /* Closed-form inverse kinematics.
     Base yaw points the arm plane at the target; the shoulder–elbow pair is a planar 2-link
     solved for the wrist centre (elbow-up); the wrist pitch makes the tool meet `pitch`. */
  solve(target, pitch, out = {}, refYaw = this.j.yaw.x) {
    const p = this._v.copy(target).sub(this.root.position);
    const r = Math.hypot(p.x, p.z);
    let yaw = r > 1e-4 ? Math.atan2(p.x, p.z) : refYaw;
    yaw = refYaw + wrapPi(yaw - refYaw);
    const y = p.y - SHOULDER_Y;
    let wx = r - L3 * Math.cos(pitch);
    let wy = y - L3 * Math.sin(pitch);
    let d = Math.hypot(wx, wy);
    const dMax = (L1 + L2) * 0.995;
    const dMin = Math.abs(L1 - L2) + 0.06;
    let reachable = true;
    if (d > dMax) { const s = dMax / d; wx *= s; wy *= s; d = dMax; reachable = false; }
    else if (d < dMin) { const s = dMin / Math.max(d, 1e-6); wx *= s; wy *= s; d = dMin; reachable = false; }
    const el = -Math.acos(clamp((d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1));
    const sh = Math.atan2(wy, wx) - Math.atan2(L2 * Math.sin(el), L1 + L2 * Math.cos(el));
    // the wrist angle is a physical relative angle: never wrap it (a ±π wrap would flip the tool)
    const wr = pitch - sh - el;
    const m = 0.03;   // keep goals just inside the end stops
    out.yaw = clamp(yaw, LIMITS.yaw[0] + m, LIMITS.yaw[1] - m);
    out.sh = clamp(sh, LIMITS.sh[0] + m, LIMITS.sh[1] - m);
    out.el = clamp(el, LIMITS.el[0] + m, LIMITS.el[1] - m);
    out.wr = clamp(wr, LIMITS.wr[0] + m, LIMITS.wr[1] - m);
    out.limited = !reachable || out.yaw !== yaw || out.sh !== sh || out.el !== el || out.wr !== wr;
    return out;
  }

  // Forward kinematics of joint values `q` → tool centre point in world space.
  fk(q, out) {
    const a1 = q.sh;
    const a2 = a1 + q.el;
    const a3 = a2 + q.wr;
    const r = L1 * Math.cos(a1) + L2 * Math.cos(a2) + L3 * Math.cos(a3);
    const y = SHOULDER_Y + L1 * Math.sin(a1) + L2 * Math.sin(a2) + L3 * Math.sin(a3);
    const o = this.root.position;
    return out.set(o.x + r * Math.sin(q.yaw), o.y + y, o.z + r * Math.cos(q.yaw));
  }

  tcpWorld(out) { return this.tcp.getWorldPosition(out); }
  wristWorld(out) { return this.groups.wr.getWorldPosition(out); }
  elbowWorld(out) { return this.groups.el.getWorldPosition(out); }
  shoulderWorld(out) { return this.groups.sh.getWorldPosition(out); }

  // Exploded assembly view: 0 = assembled, 1 = fully exploded along the kinematic chain.
  explode(k) {
    const g = this.groups;
    g.sh.position.y = this._shY + 0.32 * k;
    g.el.position.z = L1 + 0.38 * k;
    g.wr.position.z = L2 + 0.32 * k;
    g.roll.position.z = 0.28 * k;
    for (const c of this.caps) c.position.x = Math.sign(c.position.x) * (c.userData.home + 0.24 * k);
  }

  setDesign(on) {
    for (const f of this.frames) f.visible = on;
    this.edgeMat.color.set(on ? 0x2a8fb0 : 0x24222a);
    this.edgeMat.opacity = on ? 0.9 : 0.6;
  }
}
