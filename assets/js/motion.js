import { smooth } from './util.js';

/* Motion programs, written the way an industrial controller runs them:
   MoveJ   joint-interpolated move, every axis arrives together (curved tool path, fastest)
   MoveL   straight-line tool move with IK solved every frame (precise approach / retract)
   grip    gripper command, wait, joints (custom joint-space motion), call (side effect).
   Every move uses a minimum-jerk S-curve, so velocity and acceleration start and end at zero. */

const AXES = ['yaw', 'sh', 'el', 'wr'];
// Per-axis velocity / acceleration limits used to time MoveJ (rad/s, rad/s²).
const JLIM = { yaw: [1.9, 6.5], sh: [1.7, 6.5], el: [2.3, 8.5], wr: [3.0, 13] };

// Duration of a min-jerk move of length d: peak speed is 1.875·d/T, peak acceleration 5.77·d/T².
export const mjTime = (d, v, a) => Math.max((1.875 * d) / v, Math.sqrt((5.7735 * d) / a));

// Never plan faster than the servo can follow (92% of its limits), so the arm tracks the plan exactly.
function axisTime(arm, a, d, scale) {
  const J = arm.j[a];
  return mjTime(d, Math.min(JLIM[a][0] * scale, J.vmax * 0.92), Math.min(JLIM[a][1] * scale, J.amax * 0.92));
}

export class Program {
  /* ctx = { ref, arm, speed() } where ref = { pos, vel, pitch, q } is the commanded reference. */
  constructor(steps, ctx, onDone) {
    this.steps = steps;
    this.ctx = ctx;
    this.onDone = onDone;
    this.i = -1;
    this.done = false;
    this._next();
  }

  get step() { return this.steps[this.i]; }

  get progress() {
    const s = this.steps[this.i];
    const f = s && s.T ? Math.min(1, s.t / s.T) : 0;
    return Math.min(1, (this.i + f) / this.steps.length);
  }

  get rollOverride() { return this.step?.kind === 'joints'; }

  cancel() { this.done = true; }

  _next() {
    if (this.done) return;
    this.i++;
    const s = this.steps[this.i];
    if (!s) { this.done = true; this.onDone?.(); return; }
    const { ref, arm } = this.ctx;
    const k = this.ctx.speed();
    s.t = 0;
    s.enter?.();
    if (this.done) return;
    if (s.kind === 'movej') {
      s.q0 = { ...ref.q };
      if (s.toJ) s.q1 = { ...ref.q, ...s.toJ() };
      else {
        const tgt = s.to();
        s.q1 = arm.solve(tgt.pos, tgt.pitch ?? ref.pitch, {}, ref.q.yaw);
      }
      const v = (s.v ?? 1) * k;
      let T = s.min ?? 0.25;
      for (const a of AXES) T = Math.max(T, axisTime(arm, a, Math.abs(s.q1[a] - s.q0[a]), v));
      s.T = T;
    } else if (s.kind === 'movel') {
      const tgt = s.to();
      s.p0 = ref.pos.clone();
      s.p1 = tgt.pos.clone();
      s.f0 = ref.pitch;
      s.f1 = tgt.pitch ?? ref.pitch;
      const v = (s.v ?? 1.2) * k;
      let T = Math.max(s.min ?? 0.18, mjTime(s.p0.distanceTo(s.p1), v, v * 5), mjTime(Math.abs(s.f1 - s.f0), 3 * k, 12 * k));
      // a straight line can still demand fast joints near awkward poses: time it in joint space too
      const qa = arm.solve(s.p0, s.f0, {}, ref.q.yaw);
      const qb = arm.solve(s.p1, s.f1, {}, qa.yaw);
      for (const a of AXES) T = Math.max(T, axisTime(arm, a, Math.abs(qb[a] - qa[a]), k));
      s.T = T;
    } else if (s.kind === 'grip') {
      arm.grip = s.value;
      s.T = s.dur ?? 0.3;
    } else if (s.kind === 'call') {
      s.fn();
      this._next();
      return;
    } else {
      s.T = s.dur ?? 0;
    }
  }

  update(dt) {
    if (this.done) return;
    const s = this.steps[this.i];
    const { ref, arm } = this.ctx;
    s.t += dt;
    const u = s.T > 0 ? Math.min(1, s.t / s.T) : 1;
    const e = smooth(u);
    if (s.kind === 'movej') {
      for (const a of AXES) ref.q[a] = s.q0[a] + (s.q1[a] - s.q0[a]) * e;
      if (s.q1.roll !== undefined && s.toJ) ref.q.roll = s.q0.roll + (s.q1.roll - s.q0.roll) * e;
      arm.fk(ref.q, ref.pos);
      ref.pitch = ref.q.sh + ref.q.el + ref.q.wr;
      ref.vel.set(0, 0, 0);
    } else if (s.kind === 'movel') {
      ref.pos.lerpVectors(s.p0, s.p1, e);
      ref.pitch = s.f0 + (s.f1 - s.f0) * e;
      ref.vel.set(0, 0, 0);
      arm.solve(ref.pos, ref.pitch, ref.q, ref.q.yaw);
    } else if (s.kind === 'joints') {
      s.fn(s.t, ref.q);
      arm.fk(ref.q, ref.pos);
      ref.pitch = ref.q.sh + ref.q.el + ref.q.wr;
      ref.vel.set(0, 0, 0);
    }
    const isMove = s.kind === 'movej' || s.kind === 'movel';
    // "fine" point: a move only completes when the servos have actually settled (or a short timeout).
    if (u >= 1 && (!isMove || arm.settled(s.tol ?? 0.012) || s.t > s.T + 0.6)) {
      s.exit?.();
      this._next();
    }
  }
}

export { smooth };
