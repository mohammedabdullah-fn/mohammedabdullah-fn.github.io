// Instruments: IMU oscilloscope, surface classifier, mecanum IK diagram, lab minimap,
// telemetry text and labels projected from the 3D scene.
import * as THREE from 'three';
import { BEACONS, T2H, CLASSES, MAP_HALF } from './shared.js';
import { KIN, LIMITS } from './drive.js';

const $ = (id) => document.getElementById(id);
const ACID = '#a6ff3c', AMBER = '#ffb02e', IMU = '#ff5a1f';
const ZC = { carpet: '#76d832', hardwood: '#ffb02e', grass: '#a6ff3c', tile: '#d2ffb4' };
const SHORT = { carpet: 'C', hardwood: 'H', grass: 'G', tile: 'T' };

function fit(canvas) {
  if (!canvas) return 0;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return 0;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  return dpr;
}
const sign = (v) => (v >= 0 ? '+' : '−');
const fmt = (v, d = 2) => sign(v) + Math.abs(v).toFixed(d);

export class Hud {
  constructor() {
    this.el = {};
    for (const k of ['surf', 'amp', 'pattern', 'feel', 'ml', 'mr', 'ml-bar', 'mr-bar', 'rms', 'pred', 'truth', 'strip',
      'mode', 'x', 'z', 'hdg', 'v', 'w', 'tgt', 'pos', 'twist', 'labels', 'zonechip', 'm-surf', 'm-meta', 'm-pred']) {
      this.el[k] = $('tl-' + k);
    }
    this.bars = CLASSES.map((c) => {
      const li = document.querySelector(`.tl-cls-bars [data-class="${c}"]`);
      return li ? { li, bar: li.querySelector('i'), val: li.querySelector('em') } : null;
    });
    this.scope = $('tl-scope');
    this.ik = $('tl-ik');
    this.map = $('tl-minimap');
    this.sg = this.scope ? this.scope.getContext('2d') : null;
    this.ig = this.ik ? this.ik.getContext('2d') : null;
    this.mg = this.map ? this.map.getContext('2d') : null;
    this.surface = null;
    this.blabels = [];
    this.v3 = new THREE.Vector3();
    this.makeLabels();
    this.makeStrip();
    this.resize();
  }

  resize() {
    this.scopeDpr = fit(this.scope);
    this.ikDpr = fit(this.ik);
    this.mapDpr = fit(this.map);
  }

  makeLabels() {
    const wrap = this.el.labels;
    if (!wrap) return;
    for (const b of BEACONS) {
      const a = document.createElement('a');
      a.className = 'tl-bl tl-bl--' + b.kind;
      a.href = b.kind === 'section' ? '#' + b.id : b.href;
      if (b.kind === 'link' && b.id !== 'email') { a.target = '_blank'; a.rel = 'noopener'; }
      a.tabIndex = -1;
      a.dataset.id = b.id;
      a.innerHTML = `<span class="tl-bl-in"><b>${b.num}</b><span class="tl-bl-name">${b.label}${b.kind === 'link' ? ' ↗' : ''}</span><small class="tl-bl-d">-</small></span>`;
      wrap.appendChild(a);
      this.blabels.push({ b, el: a, d: a.querySelector('.tl-bl-d'), lastD: -1 });
    }
    const imu = document.createElement('div');
    imu.className = 'tl-imutag';
    imu.innerHTML = '<i></i><span>VN-100 IMU</span>';
    wrap.appendChild(imu);
    this.imuTag = imu;
    const tgt = document.createElement('div');
    tgt.className = 'tl-tgttag';
    tgt.innerHTML = '<span>TGT</span><b>0.00 m</b>';
    wrap.appendChild(tgt);
    this.tgtTag = tgt;
    this.tgtVal = tgt.querySelector('b');
  }

  makeStrip() {
    const s = this.el.strip;
    if (!s) return;
    this.cells = [];
    for (let i = 0; i < 16; i++) {
      const c = document.createElement('span');
      c.className = 'tl-cell';
      s.appendChild(c);
      this.cells.push(c);
    }
  }

  setSurface(surface) {
    if (surface === this.surface) return;
    this.surface = surface;
    const T = T2H[surface], e = this.el;
    if (e.surf) e.surf.textContent = T.label;
    if (e.amp) e.amp.textContent = T.amp.toFixed(2);
    if (e.pattern) e.pattern.textContent = T.patternLabel;
    if (e.feel) e.feel.textContent = T.feel;
    if (e.ml) e.ml.textContent = T.L.toFixed(2);
    if (e.mr) e.mr.textContent = T.R.toFixed(2);
    if (e['ml-bar']) e['ml-bar'].style.transform = `scaleX(${T.L})`;
    if (e['mr-bar']) e['mr-bar'].style.transform = `scaleX(${T.R})`;
    if (e.zonechip) e.zonechip.textContent = 'Zone ' + ({ tile: 'A', hardwood: 'B', carpet: 'C', grass: 'D' })[surface];
    if (e['m-surf']) e['m-surf'].textContent = T.label;
    if (e['m-meta']) e['m-meta'].textContent = `${T.amp.toFixed(2)} · ${T.feel.toLowerCase()} · L/R ${T.L.toFixed(2)}/${T.R.toFixed(2)}`;
    document.documentElement.dataset.surface = surface;
  }

  setClassifier(cls, actual) {
    const pred = cls.predicted();
    for (let j = 0; j < 4; j++) {
      const b = this.bars[j];
      if (!b) continue;
      const p = Math.max(0, Math.min(100, cls.probs[j]));
      b.bar.style.transform = `scaleX(${(p / 100).toFixed(4)})`;
      b.val.textContent = p.toFixed(1) + '%';
      b.li.classList.toggle('is-top', CLASSES[j] === pred);
      b.li.classList.toggle('is-true', CLASSES[j] === actual);
    }
    if (this.el.pred) this.el.pred.textContent = T2H[pred].label;
    if (this.el['m-pred']) this.el['m-pred'].textContent = T2H[pred].label + ' ' + cls.probs[CLASSES.indexOf(pred)].toFixed(1) + '%';
    if (this.el.truth) {
      const ok = pred === actual;
      this.el.truth.textContent = (ok ? '✓ matches ' : '✗ actual ') + T2H[actual].label.toLowerCase();
      this.el.truth.classList.toggle('is-miss', !ok);
    }
    if (this.cells && cls.count !== this.lastCount) {
      this.lastCount = cls.count;
      const w = cls.windows;
      for (let i = 0; i < 16; i++) {
        const c = this.cells[i];
        const it = w[w.length - 16 + i];
        if (!it) { c.textContent = ''; c.className = 'tl-cell'; continue; }
        c.textContent = SHORT[it.pred];
        c.className = 'tl-cell ' + (it.pred === it.actual ? 'is-ok' : 'is-bad');
      }
    }
  }

  telemetry(d) {
    const e = this.el;
    if (e.mode) e.mode.textContent = d.mode;
    if (e.x) e.x.textContent = fmt(d.x);
    if (e.z) e.z.textContent = fmt(d.z);
    if (e.hdg) {
      let deg = Math.round((((Math.PI - d.psi) * 180) / Math.PI + 360) % 360);
      if (deg === 360) deg = 0;
      e.hdg.textContent = String(deg).padStart(3, '0') + '°';
    }
    if (e.v) e.v.textContent = d.speed.toFixed(2);
    if (e.w) e.w.textContent = fmt(d.w);
    if (e.tgt) e.tgt.textContent = d.remaining > 0 ? d.remaining.toFixed(2) + ' m' : '-';
    if (e.pos) e.pos.textContent = `x ${fmt(d.x, 1)}  z ${fmt(d.z, 1)}`;
    if (e.twist) e.twist.textContent = `V ${d.speed.toFixed(2)} · ω ${fmt(d.w)}`;
    if (e.rms) e.rms.textContent = 'RMS ' + d.rms.toFixed(3) + ' g';
  }

  drawScope(imu, surface) {
    const c = this.scope, g = this.sg, d = this.scopeDpr;
    if (!g || !d) return;
    const W = c.width, H = c.height;
    g.fillStyle = '#020702';
    g.fillRect(0, 0, W, H);
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(166,255,60,0.08)';
    g.beginPath();
    for (let i = 1; i < 12; i++) { const x = Math.round((i * W) / 12) + 0.5; g.moveTo(x, 0); g.lineTo(x, H); }
    for (let j = 1; j < 4; j++) { const y = Math.round((j * H) / 4) + 0.5; g.moveTo(0, y); g.lineTo(W, y); }
    g.stroke();
    g.strokeStyle = 'rgba(166,255,60,0.22)';
    g.beginPath();
    g.moveTo(0, Math.round(H / 2) + 0.5);
    g.lineTo(W, Math.round(H / 2) + 0.5);
    g.stroke();
    const FS = 0.5, mid = H / 2, sy = (H / 2) * 0.88;
    const ya = (T2H[surface].amp / FS) * sy;
    g.setLineDash([4 * d, 4 * d]);
    g.strokeStyle = 'rgba(255,176,46,0.5)';
    g.beginPath();
    g.moveTo(0, mid - ya); g.lineTo(W, mid - ya);
    g.moveTo(0, mid + ya); g.lineTo(W, mid + ya);
    g.stroke();
    g.setLineDash([]);
    const N = 120, n = Math.min(N, imu.count);
    if (n < 2) return;
    const step = W / (N - 1), frac = imu.acc / imu.dtS;
    const trace = () => {
      g.beginPath();
      for (let k = 0; k < n; k++) {
        const v = Math.max(-1, Math.min(1, imu.at(k) / FS));
        const x = W - (k + frac) * step, y = mid - v * sy;
        if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
    };
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(166,255,60,0.16)';
    g.lineWidth = 4.5 * d;
    trace(); g.stroke();
    g.strokeStyle = ACID;
    g.lineWidth = 1.25 * d;
    trace(); g.stroke();
    const v0 = Math.max(-1, Math.min(1, imu.at(0) / FS));
    g.fillStyle = '#e9ffd6';
    g.beginPath();
    g.arc(W - frac * step, mid - v0 * sy, 2.2 * d, 0, Math.PI * 2);
    g.fill();
  }

  drawIK(drive) {
    const c = this.ik, g = this.ig, d = this.ikDpr;
    if (!g || !d) return;
    const W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    const cx = W * 0.3, cy = H * 0.5;
    const sc = Math.min(W * 0.5, H * 0.92) / 0.95;
    g.lineWidth = 1 * d;
    g.strokeStyle = 'rgba(166,255,60,0.35)';
    g.strokeRect(cx - 0.25 * sc, cy - 0.33 * sc, 0.5 * sc, 0.66 * sc);
    g.fillStyle = 'rgba(166,255,60,0.5)';
    g.beginPath();
    g.moveTo(cx, cy - 0.29 * sc); g.lineTo(cx - 0.035 * sc, cy - 0.22 * sc); g.lineTo(cx + 0.035 * sc, cy - 0.22 * sc);
    g.fill();
    g.font = `${10 * d}px "IBM Plex Mono", monospace`;
    g.textBaseline = 'middle';
    const ww = 0.075 * sc, wh = 0.17 * sc;
    for (let i = 0; i < 4; i++) {
      const K = KIN.wheels[i];
      const x = cx - K.l * sc, y = cy - K.f * sc;
      const rim = drive.rim[i];
      g.strokeStyle = i === 0 ? 'rgba(255,90,31,0.9)' : 'rgba(166,255,60,0.6)';
      g.strokeRect(x - ww / 2, y - wh / 2, ww, wh);
      // Top rollers as seen from above (an X pattern across the four wheels).
      g.save();
      g.beginPath();
      g.rect(x - ww / 2, y - wh / 2, ww, wh);
      g.clip();
      g.strokeStyle = 'rgba(166,255,60,0.28)';
      const off = ((drive.wheelAngle[i] * KIN.wheelR) % 0.04) * sc;
      for (let k = -6; k <= 6; k++) {
        const yy = y + k * 0.04 * sc - off; // top surface moves forward (up) when rolling forward
        // top roller axis in (left, fwd) = (0.707, 0.707 s) -> screen direction (1, s)
        g.beginPath();
        g.moveTo(x - ww, yy - ww * K.s);
        g.lineTo(x + ww, yy + ww * K.s);
        g.stroke();
      }
      g.restore();
      // Traction vector along the ground-contact roller axis.
      const len = (rim / LIMITS.vMax) * 0.22 * sc;
      const fx = Math.SQRT1_2 * K.s * len, fy = -Math.SQRT1_2 * len; // screen: left = -x, fwd = -y
      if (Math.abs(len) > 0.5 * d) {
        g.strokeStyle = AMBER;
        g.fillStyle = AMBER;
        g.lineWidth = 1.6 * d;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + fx, y + fy); g.stroke();
        const m = Math.hypot(fx, fy) || 1, ux = fx / m, uy = fy / m, hl = Math.min(6 * d, m * 0.5);
        g.beginPath();
        g.moveTo(x + fx, y + fy);
        g.lineTo(x + fx - ux * hl - uy * hl * 0.6, y + fy - uy * hl + ux * hl * 0.6);
        g.lineTo(x + fx - ux * hl + uy * hl * 0.6, y + fy - uy * hl - ux * hl * 0.6);
        g.fill();
        g.lineWidth = 1 * d;
      }
      // Wheel speed readout
      const tx = cx + 0.43 * sc + (i % 2) * W * 0.2, ty = cy + (i < 2 ? -0.17 : 0.17) * sc;
      g.fillStyle = i === 0 ? IMU : 'rgba(217,247,196,0.85)';
      g.fillText(`${K.id} ${fmt(drive.wheelRate[i], 1)}`, tx, ty);
    }
    g.fillStyle = 'rgba(159,190,140,0.9)';
    g.fillText('rad/s', cx + 0.43 * sc, cy);
    // Net body velocity in the robot frame.
    const bv = drive.bodyVel();
    const vx = -bv.l / LIMITS.vMax * 0.32 * sc, vy = -bv.f / LIMITS.vMax * 0.32 * sc;
    if (Math.hypot(vx, vy) > 1 * d) {
      g.strokeStyle = ACID;
      g.lineWidth = 2 * d;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + vx, cy + vy); g.stroke();
      g.lineWidth = 1 * d;
    }
    if (Math.abs(bv.w) > 0.02) {
      g.strokeStyle = ACID;
      g.beginPath();
      const a0 = -Math.PI / 2, sweep = Math.max(-2.6, Math.min(2.6, -bv.w));
      g.arc(cx, cy, 0.12 * sc, a0, a0 + sweep, sweep < 0);
      g.stroke();
    }
  }

  drawMinimap(o) {
    const c = this.map, g = this.mg, d = this.mapDpr;
    if (!g || !d) return;
    const W = c.width, H = c.height, h2 = MAP_HALF * 2;
    const px = (x) => ((x + MAP_HALF) / h2) * W, py = (z) => ((z + MAP_HALF) / h2) * H;
    g.fillStyle = '#020502';
    g.fillRect(0, 0, W, H);
    const q = [['tile', -MAP_HALF, -MAP_HALF], ['hardwood', 0, -MAP_HALF], ['carpet', -MAP_HALF, 0], ['grass', 0, 0]];
    for (const [s, x0, z0] of q) {
      g.globalAlpha = s === o.surface ? 0.2 : 0.09;
      g.fillStyle = ZC[s];
      g.fillRect(px(x0), py(z0), W / 2, H / 2);
    }
    g.globalAlpha = 1;
    g.strokeStyle = 'rgba(166,255,60,0.12)';
    g.lineWidth = 1;
    g.beginPath();
    for (let m = -5; m <= 5; m++) {
      const x = Math.round(px(m)) + 0.5, y = Math.round(py(m)) + 0.5;
      g.moveTo(x, 0); g.lineTo(x, H); g.moveTo(0, y); g.lineTo(W, y);
    }
    g.stroke();
    g.font = `600 ${9 * d}px "IBM Plex Mono", monospace`;
    g.textBaseline = 'top';
    g.fillStyle = 'rgba(217,247,196,0.55)';
    g.fillText('A TILE', 4 * d, 4 * d);
    g.fillText('B WOOD', W / 2 + 4 * d, 4 * d);
    g.textBaseline = 'bottom';
    g.fillText('C CARPET', 4 * d, H - 3 * d);
    g.fillText('D GRASS', W / 2 + 4 * d, H - 3 * d);
    // Camera footprint
    if (o.view) {
      g.strokeStyle = 'rgba(217,247,196,0.28)';
      g.beginPath();
      o.view.forEach((p, i) => (i ? g.lineTo(px(p.x), py(p.z)) : g.moveTo(px(p.x), py(p.z))));
      g.closePath();
      g.stroke();
    }
    // LIDAR wedge
    const rx = px(o.x), rz = py(o.z), rr = (o.range / h2) * W;
    const grad = g.createRadialGradient(rx, rz, 0, rx, rz, rr);
    grad.addColorStop(0, 'rgba(166,255,60,0.28)');
    grad.addColorStop(1, 'rgba(166,255,60,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(rx, rz);
    g.arc(rx, rz, rr, o.sweep - 0.95, o.sweep);
    g.closePath();
    g.fill();
    // Path
    if (o.path) {
      g.strokeStyle = 'rgba(166,255,60,0.85)';
      g.setLineDash([2 * d, 3 * d]);
      g.beginPath();
      const p = o.path;
      for (let i = p.i || 0; i < p.n; i += 3) (i === (p.i || 0) ? g.moveTo(px(p.X[i]), py(p.Z[i])) : g.lineTo(px(p.X[i]), py(p.Z[i])));
      g.lineTo(px(p.X[p.n - 1]), py(p.Z[p.n - 1]));
      g.stroke();
      g.setLineDash([]);
      g.strokeStyle = AMBER;
      g.beginPath();
      g.arc(px(p.X[p.n - 1]), py(p.Z[p.n - 1]), 3.5 * d, 0, Math.PI * 2);
      g.stroke();
    }
    // Beacons
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.font = `600 ${8 * d}px "IBM Plex Mono", monospace`;
    for (const b of BEACONS) {
      const bx = px(b.x), bz = py(b.z);
      g.fillStyle = b.kind === 'link' ? AMBER : ACID;
      g.globalAlpha = 0.9;
      g.beginPath();
      g.arc(bx, bz, 6.5 * d, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = '#020502';
      g.fillText(b.num, bx, bz + 0.5 * d);
    }
    g.textAlign = 'start';
    // Rover
    const s = Math.sin(o.psi), cz = Math.cos(o.psi);
    const L = 7 * d, Wd = 4.5 * d;
    g.fillStyle = '#e9ffd6';
    g.beginPath();
    g.moveTo(rx + s * L, rz + cz * L);
    g.lineTo(rx - s * L * 0.6 + cz * Wd, rz - cz * L * 0.6 - s * Wd);
    g.lineTo(rx - s * L * 0.6 - cz * Wd, rz - cz * L * 0.6 + s * Wd);
    g.closePath();
    g.fill();
    g.fillStyle = IMU;
    g.beginPath();
    g.arc(px(o.imu.x), py(o.imu.z), 1.8 * d, 0, Math.PI * 2);
    g.fill();
  }

  // Projects labels into the page. The camera's world matrix must be current.
  placeLabels(camera, rect, o) {
    const v = this.v3;
    for (const L of this.blabels) {
      v.set(L.b.x, 1.95, L.b.z).project(camera);
      const vis = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15;
      L.el.classList.toggle('is-off', !vis);
      if (vis) {
        const x = rect.left + ((v.x + 1) / 2) * rect.width, y = rect.top + ((1 - v.y) / 2) * rect.height;
        L.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      }
      const st = o.beacons[L.b.id];
      if (st) {
        L.el.classList.toggle('is-near', st.prox > 0.55);
        L.el.classList.toggle('is-in', st.inside);
        const dd = Math.round(st.dist * 10) / 10;
        if (dd !== L.lastD) { L.lastD = dd; L.d.textContent = dd.toFixed(1) + ' m'; }
      }
    }
    if (this.imuTag) {
      v.copy(o.imuPos).project(camera);
      const x = rect.left + ((v.x + 1) / 2) * rect.width, y = rect.top + ((1 - v.y) / 2) * rect.height;
      this.imuTag.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
    if (this.tgtTag) {
      const show = !!o.path;
      this.tgtTag.classList.toggle('is-off', !show);
      if (show) {
        const p = o.path;
        v.set(p.X[p.n - 1], 0.9, p.Z[p.n - 1]).project(camera);
        const x = rect.left + ((v.x + 1) / 2) * rect.width, y = rect.top + ((1 - v.y) / 2) * rect.height;
        this.tgtTag.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
        this.tgtVal.textContent = o.remaining.toFixed(2) + ' m';
      }
    }
  }
}
