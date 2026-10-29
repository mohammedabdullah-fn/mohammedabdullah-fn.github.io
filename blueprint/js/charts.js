// Plotter-style charts and dimension-chain timelines. Every drawing is rebuilt for
// its container width, so text stays at a readable size on a phone.
import { svg, setAttrs, n, Path, clamp } from './util.js';
import { arrow, arrowDir } from './frames.js';

const CH = 6.6; // approx. width of one IBM Plex Mono character at 11px

// ------------------------------------------------------------- bar chart
export class BarChart {
  constructor(host, cfg, drawer, tip) {
    this.host = host; this.cfg = cfg; this.drawer = drawer; this.tip = tip;
    this.item = null; this.lastW = 0;
  }

  render(force = false) {
    const host = this.host, cfg = this.cfg;
    const W = Math.max(240, Math.round(host.clientWidth));
    if (!force && W === this.lastW) return;
    this.lastW = W;
    const compact = W < 420;
    // label column sized to the longest category name (11px mono)
    const longest = Math.max(...cfg.data.map((d) => d.label.length));
    const labelW = Math.min(W * 0.42, Math.max(64, longest * CH + 16)), valueW = 52;
    const top = 12, rowH = compact ? 30 : 34, axisH = 30;
    const rows = cfg.data.length, plotH = rows * rowH, H = top + plotH + axisH;
    const x0 = labelW, x1 = W - valueW, pw = x1 - x0;
    const X = (v) => x0 + (clamp(v, 0, cfg.max) / cfg.max) * pw;

    while (host.firstChild) host.removeChild(host.firstChild);
    const s = svg('svg', { class: 'ch-svg', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': cfg.aria }, host);
    const grid = new Path(), axis = new Path();
    for (let v = 0; v <= cfg.max + 1e-9; v += cfg.step) {
      const x = X(v);
      if (v > 0) grid.M(x, top - 4).L(x, top + plotH);
      axis.M(x, top + plotH).L(x, top + plotH + 5);
      if (!compact || v % (cfg.step * 2) === 0) svg('text', { class: 'ch-tick dr-t', x, y: top + plotH + 18, 'text-anchor': 'middle' }, s).textContent = String(v);
    }
    svg('path', { class: 'ch-grid', d: grid.toString() }, s);
    axis.M(x0, top - 6).L(x0, top + plotH).L(x1 + 4, top + plotH);
    svg('path', { class: 'ch-axis dr', d: axis.toString() }, s);
    svg('text', { class: 'ch-unit dr-t', x: x1 + 10, y: top + plotH + 18 }, s).textContent = cfg.unitLabel || cfg.unit;
    // plotter registration marks
    const reg = new Path();
    for (const [x, y, sx, sy] of [[2, 2, 1, 1], [W - 2, 2, -1, 1], [2, H - 2, 1, -1], [W - 2, H - 2, -1, -1]]) reg.M(x + sx * 7, y).L(x, y).L(x, y + sy * 7);
    svg('path', { class: 'ch-reg dr', d: reg.toString() }, s);

    cfg.data.forEach((d, i) => {
      const yc = top + i * rowH + rowH / 2, bh = compact ? 12 : 14, y = yc - bh / 2, xe = X(d.value);
      const r = Math.min(4, (xe - x0) / 2);
      const p = new Path().M(x0, y).L(xe - r, y).Q(xe, y, xe, y + r).L(xe, y + bh - r).Q(xe, y + bh, xe - r, y + bh).L(x0, y + bh).Z();
      const bar = svg('path', { class: 'ch-bar' + (d.emph ? ' ch-bar--emph' : ''), d: p.toString() }, s);
      bar.style.setProperty('--i', String(i));
      svg('text', { class: 'ch-label', x: x0 - 10, y: yc + 4, 'text-anchor': 'end' }, s).textContent = d.label;
      const val = svg('text', { class: 'ch-val dr-t', x: xe + 7, y: yc + 4 }, s);
      val.textContent = d.value.toFixed(1) + cfg.unit;
      const nib = svg('g', { class: 'ch-nib', transform: `translate(${n(xe)} ${n(yc)})` }, s);
      nib.style.setProperty('--dx', `${n(x0 - xe)}px`);
      nib.style.setProperty('--i', String(i));
      svg('circle', { r: 3.2 }, nib);
      svg('path', { d: 'M-6 0H6M0 -6V6' }, nib);
      const hit = svg('rect', { class: 'ch-hit', x: 0, y: yc - rowH / 2, width: W, height: rowH, tabindex: '0', role: 'img', 'aria-label': `${d.label}: ${d.value.toFixed(1)}${cfg.unit}` }, s);
      const show = (ev) => {
        bar.classList.add('is-hot');
        const rr = hit.getBoundingClientRect();
        const px = ev && ev.clientX ? ev.clientX : rr.left + (xe / W) * rr.width;
        const py = ev && ev.clientY ? ev.clientY : rr.top + rr.height / 2;
        this.tip.show(px, py, `${d.value.toFixed(1)}${cfg.unit}`, d.tip || d.label);
      };
      const hide = () => { bar.classList.remove('is-hot'); this.tip.hide(); };
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('pointermove', show);
      hit.addEventListener('pointerleave', hide);
      hit.addEventListener('focus', () => show(null));
      hit.addEventListener('blur', hide);
    });
    if (!this.item) this.item = this.drawer.register(s, host, { stagger: 30, dur: 800 });
    else { this.item.root = s; this.drawer.refresh(this.item); }
  }
}

// ------------------------------------------------------ month arithmetic
export const M = (y, mo) => (y - 2023) * 12 + (mo - 1);
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function nowMonths(d = new Date()) {
  return M(d.getFullYear(), d.getMonth() + 1) + (d.getDate() - 1) / 30.5;
}

/** Stack labels along one axis so they never overlap. items: {pos, size}. */
function resolve(items, minPos, maxPos) {
  items.sort((a, b) => a.want - b.want);
  let cur = minPos;
  for (const it of items) { it.pos = Math.max(it.want, cur); cur = it.pos + it.size; }
  let over = cur - maxPos;
  for (let i = items.length - 1; i >= 0 && over > 0; i--) {
    const it = items[i];
    const next = i < items.length - 1 ? items[i + 1].pos - it.size : maxPos - it.size;
    const p = Math.min(it.pos, next);
    over -= it.pos - p; it.pos = p;
  }
  return items;
}

// -------------------------------------------------- experience timeline
export class Timeline {
  constructor(host, data, drawer) {
    this.host = host; this.data = data; this.drawer = drawer; this.item = null; this.lastW = 0;
  }

  render(force = false) {
    const host = this.host;
    const W = Math.max(260, Math.round(host.clientWidth));
    if (!force && W === this.lastW) return;
    this.lastW = W;
    while (host.firstChild) host.removeChild(host.firstChild);
    const vertical = W < 640;
    const s = vertical ? this.vertical(W) : this.horizontal(W);
    host.appendChild(s);
    if (!this.item) this.item = this.drawer.register(s, host, { stagger: 24, dur: 900 });
    else { this.item.root = s; this.drawer.refresh(this.item); }
  }

  horizontal(W) {
    const D = this.data;
    const H = 268, x0 = 28, x1 = W - 34;
    const X = (m) => x0 + ((m - D.start) / (D.end - D.start)) * (x1 - x0);
    const yR = 34, yC = 82, yS = 124, yA = 160;
    const s = svg('svg', { class: 'tl-svg', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': D.aria });
    const ext = new Path(), dim = new Path();
    // time axis with year ticks
    dim.M(x0, yA).L(x1, yA);
    for (let y = 2024; y <= 2028; y++) {
      const x = X(M(y, 1));
      ext.M(x, yA - 4).L(x, yA + 6);
      svg('text', { class: 'tl-year dr-t', x, y: yA + 20, 'text-anchor': 'middle' }, s).textContent = String(y);
    }
    // monthly minor ticks
    const minor = new Path();
    for (let m = Math.ceil(D.start); m <= D.end; m++) { const x = X(m); minor.M(x, yA).L(x, yA + 3); }
    svg('path', { class: 'tl-minor', d: minor.toString() }, s);

    // industry chain + reference overall dimension
    const chainX = [];
    D.chain.forEach((c) => chainX.push(X(c.a), X(c.b)));
    for (const x of new Set(chainX.map((v) => Math.round(v * 100) / 100))) ext.M(x, yA - 3).L(x, yC - 7);
    D.chain.forEach((c) => this.hdim(s, dim, X(c.a), X(c.b), yC, `${c.b - c.a} MO`, c.role ? `${c.label} · ${c.role}` : c.label));
    const rf = D.ref;
    ext.M(X(rf.a), yC - 9).L(X(rf.a), yR - 7).M(X(rf.b), yC - 9).L(X(rf.b), yR - 7);
    this.hdim(s, dim, X(rf.a), X(rf.b), yR, `(${rf.b - rf.a} MO)`, rf.label);
    // Northeastern spans
    D.spans.forEach((c) => {
      ext.M(X(c.a), yA - 3).L(X(c.a), yS - 7).M(X(c.b), yA - 3).L(X(c.b), yS - 7);
      this.hdim(s, dim, X(c.a), X(c.b), yS, c.value, c.label, true);
    });

    // events below the axis, labels resolved left to right
    const labels = D.points.map((p) => {
      const w = Math.max(p.label.length, p.sub.length) * CH * 0.92 + 14;
      return { p, want: X(p.at) - 6, size: w };
    });
    resolve(labels, 4, W - 4);
    const lead = new Path();
    labels.forEach((L, i) => {
      const x = X(L.p.at), level = i % 2 === 0 ? 0 : 1;
      const yL = yA + 44 + level * 40;
      if (L.p.datum) {
        // datum feature symbol: filled triangle on the axis, leader to a boxed letter
        svg('path', { class: 'tl-datum-tri', d: new Path().poly([[x, yA + 1], [x - 5, yA + 9], [x + 5, yA + 9]]).toString() }, s);
        lead.M(x, yA + 9).L(x, yL - 12);
        svg('rect', { class: 'tl-datum-box dr', x: x - 9, y: yL - 12, width: 18, height: 18 }, s);
        svg('text', { class: 'tl-datum-letter dr-t', x, y: yL + 2, 'text-anchor': 'middle' }, s).textContent = L.p.datum;
        const tx = x + 16;
        svg('text', { class: 'tl-ev dr-t', x: tx, y: yL - 1 }, s).textContent = L.p.label;
        svg('text', { class: 'tl-ev-sub dr-t', x: tx, y: yL + 12 }, s).textContent = L.p.sub;
        return;
      }
      svg('circle', { class: 'tl-pt' + (L.p.open ? ' tl-pt--open' : ''), cx: x, cy: yA, r: 3.4 }, s);
      const tx = clamp(L.pos, 4, W - L.size);
      lead.M(x, yA + 5).L(x, yL - 14).L(tx, yL - 14);
      svg('text', { class: 'tl-ev dr-t', x: tx, y: yL - 1 }, s).textContent = L.p.label;
      svg('text', { class: 'tl-ev-sub dr-t', x: tx, y: yL + 12 }, s).textContent = L.p.sub;
    });
    svg('path', { class: 'tl-ext dr', d: ext.toString() }, s);
    svg('path', { class: 'tl-dim dr', d: dim.toString() }, s);
    svg('path', { class: 'tl-lead dr', d: lead.toString() }, s);
    this.nowMarker(s, X(nowMonths()), yR - 18, yA + 8, false, x1);
    return s;
  }

  hdim(s, path, xa, xb, y, value, label, light = false) {
    const len = xb - xa;
    const tw = value.length * CH + 10;
    const mid = (xa + xb) / 2;
    if (len > tw + 22) {
      path.M(xa, y).L(mid - tw / 2, y).M(mid + tw / 2, y).L(xb, y);
      svg('text', { class: 'tl-val dr-t', x: mid, y: y + 4, 'text-anchor': 'middle' }, s).textContent = value;
    } else {
      path.M(xa, y).L(xb, y);
      svg('text', { class: 'tl-val dr-t', x: mid, y: y - 7, 'text-anchor': 'middle' }, s).textContent = value;
    }
    arrow(s, xa, y, 1).classList.add('tl-arrow');
    arrow(s, xb, y, -1).classList.add('tl-arrow');
    if (label) {
      const t = svg('text', { class: 'tl-lbl dr-t' + (light ? ' tl-lbl--light' : ''), x: xa, y: y - (len > tw + 22 ? 8 : 20) }, s);
      t.textContent = label;
    }
  }

  vertical(W) {
    const D = this.data;
    const pxPerMonth = 10.5;
    const y0 = 26, y1 = y0 + (D.end - D.start) * pxPerMonth;
    const H = y1 + 30;
    const Y = (m) => y0 + (m - D.start) * pxPerMonth;
    const xA = 46, xC = 64, xR = 82, xT = 98;
    const s = svg('svg', { class: 'tl-svg', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': D.aria });
    const ext = new Path(), dim = new Path(), lead = new Path();
    dim.M(xA, y0).L(xA, y1);
    for (let y = 2024; y <= 2028; y++) {
      const yy = Y(M(y, 1));
      ext.M(xA - 6, yy).L(xA + 4, yy);
      svg('text', { class: 'tl-year dr-t', x: xA - 10, y: yy + 4, 'text-anchor': 'end' }, s).textContent = String(y);
    }
    const labels = [];
    const vdim = (ya, yb, x, value) => {
      dim.M(x, ya).L(x, yb);
      arrowDir(s, x, ya, 0, -1).classList.add('tl-arrow');
      arrowDir(s, x, yb, 0, 1).classList.add('tl-arrow');
      ext.M(xA + 2, ya).L(x + 6, ya).M(xA + 2, yb).L(x + 6, yb);
    };
    D.chain.forEach((c) => {
      vdim(Y(c.a), Y(c.b), xC, '');
      labels.push({ want: (Y(c.a) + Y(c.b)) / 2 - 10, size: 34, ax: xC, ay: (Y(c.a) + Y(c.b)) / 2, l1: `${c.label} · ${c.b - c.a} MO`, l2: c.dates });
    });
    vdim(Y(D.ref.a), Y(D.ref.b), xR, '');
    const refMid = (Y(D.ref.a) + Y(D.ref.b)) / 2;
    labels.push({ want: refMid + 30, size: 34, ax: xR, ay: refMid + 40, l1: `(${D.ref.b - D.ref.a} MO) ${D.ref.label}`, l2: 'OVERALL, BOSCH + MINAR', ref: true });
    D.spans.forEach((c) => {
      vdim(Y(c.a), Y(c.b), xC, '');
      labels.push({ want: (Y(c.a) + Y(c.b)) / 2 - 10, size: 34, ax: xC, ay: (Y(c.a) + Y(c.b)) / 2, l1: c.label, l2: c.dates });
    });
    D.points.forEach((p) => {
      const y = Y(p.at);
      if (p.datum) {
        svg('path', { class: 'tl-datum-tri', d: new Path().poly([[xA - 1, y], [xA - 9, y - 5], [xA - 9, y + 5]]).toString() }, s);
      } else {
        svg('circle', { class: 'tl-pt' + (p.open ? ' tl-pt--open' : ''), cx: xA, cy: y, r: 3.2 }, s);
      }
      labels.push({ want: y - 10, size: 34, ax: xA, ay: y, l1: p.datum ? `[${p.datum}] ${p.label}` : p.label, l2: p.sub });
    });
    resolve(labels, y0 - 14, H - 4);
    labels.forEach((L) => {
      const ty = L.pos + 11;
      lead.M(L.ax + 4, L.ay).L(xT - 6, L.ay).L(xT - 6, ty - 4).L(xT - 2, ty - 4);
      svg('text', { class: (L.ref ? 'tl-val' : 'tl-ev') + ' dr-t', x: xT, y: ty }, s).textContent = L.l1;
      if (L.l2) svg('text', { class: 'tl-ev-sub dr-t', x: xT, y: ty + 13 }, s).textContent = L.l2;
    });
    svg('path', { class: 'tl-ext dr', d: ext.toString() }, s);
    svg('path', { class: 'tl-dim dr', d: dim.toString() }, s);
    svg('path', { class: 'tl-lead dr', d: lead.toString() }, s);
    const ny = Y(nowMonths());
    if (ny > y0 && ny < y1) {
      // stop short of the label column so it never crosses a label
      svg('path', { class: 'tl-now dr', d: new Path().M(2, ny).L(xT - 10, ny).toString() }, s);
      svg('text', { class: 'tl-now-t dr-t', x: 2, y: ny - 5 }, s).textContent = 'NOW';
    }
    return s;
  }

  nowMarker(s, x, ya, yb, vertical, xmax) {
    if (!(x > 0) || x > xmax) return;
    svg('path', { class: 'tl-now dr', d: new Path().M(x, ya).L(x, yb).toString() }, s);
    svg('text', { class: 'tl-now-t dr-t', x: x + 5, y: ya + 8 }, s).textContent = 'NOW';
  }
}

// ----------------------------------------------------- milestone chain
export class Milestones {
  constructor(host, items, drawer) {
    this.host = host; this.items = items; this.drawer = drawer; this.item = null; this.lastW = 0;
  }

  render(force = false) {
    const host = this.host;
    const W = Math.max(260, Math.round(host.clientWidth));
    if (!force && W === this.lastW) return;
    this.lastW = W;
    while (host.firstChild) host.removeChild(host.firstChild);
    const day = 86400000;
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const ms = this.items.map((it) => ({ ...it, t: new Date(it.date + 'T12:00:00').getTime() }));
    const first = ms[0].t, last = ms[ms.length - 1].t;
    let t0 = Math.min(today.getTime(), first - 7 * day);
    if (today.getTime() > last) t0 = first - 7 * day;
    const t1 = last + 4 * day;
    const x0 = 16, x1 = W - 16;
    const X = (t) => x0 + ((t - t0) / (t1 - t0)) * (x1 - x0);
    const yD = 30, yA = 62;
    const H = yA + 60;
    const s = svg('svg', { class: 'ms-svg', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': 'Milestone dimension chain: ' + ms.map((m) => `${m.label} ${m.day}`).join(', ') });
    const dim = new Path(), ext = new Path(), lead = new Path();
    dim.M(x0, yA).L(x1, yA);
    // weekly ticks
    for (let t = t0; t <= t1; t += day) {
      const d = new Date(t);
      if (d.getDay() === 1) ext.M(X(t), yA).L(X(t), yA + 4);
    }
    // chain of day counts between consecutive milestones
    for (let i = 1; i < ms.length; i++) {
      const xa = X(ms[i - 1].t), xb = X(ms[i].t);
      const days = Math.round((ms[i].t - ms[i - 1].t) / day);
      ext.M(xa, yA - 4).L(xa, yD - 6).M(xb, yA - 4).L(xb, yD - 6);
      const txt = `${days} D`;
      const tw = txt.length * CH + 8;
      if (xb - xa > tw + 18) {
        const mid = (xa + xb) / 2;
        dim.M(xa, yD).L(mid - tw / 2, yD).M(mid + tw / 2, yD).L(xb, yD);
        svg('text', { class: 'tl-val dr-t', x: mid, y: yD + 4, 'text-anchor': 'middle' }, s).textContent = txt;
      } else {
        dim.M(xa, yD).L(xb, yD);
        svg('text', { class: 'tl-val dr-t', x: (xa + xb) / 2, y: yD - 8, 'text-anchor': 'middle' }, s).textContent = txt;
      }
      arrow(s, xa, yD, 1).classList.add('tl-arrow');
      arrow(s, xb, yD, -1).classList.add('tl-arrow');
    }
    const now = today.getTime();
    ms.forEach((m, i) => {
      const x = X(m.t), done = now >= m.t;
      svg('path', { class: 'ms-mark' + (done ? ' ms-mark--done' : ''), d: new Path().poly([[x, yA - 6], [x + 6, yA], [x, yA + 6], [x - 6, yA]]).toString() }, s);
      // close neighbours alternate between two label rows
      const row = i % 2;
      const ty = yA + 24 + row * 26;
      lead.M(x, yA + 7).L(x, ty - 11);
      const anchor = x < 40 ? 'start' : x > W - 40 ? 'end' : 'middle';
      const t = svg('text', { class: 'ms-t dr-t' + (done ? ' ms-t--done' : ''), x, y: ty, 'text-anchor': anchor }, s);
      t.textContent = `${m.label} · ${m.day}`;
      m.el = t;
    });
    if (now >= t0 && now <= t1) {
      const x = X(now);
      svg('path', { class: 'tl-now dr', d: new Path().M(x, yD - 12).L(x, yA + 10).toString() }, s);
      svg('text', { class: 'tl-now-t dr-t', x: x + 5, y: yD - 4 }, s).textContent = 'TODAY';
      const next = ms.find((m) => m.t > now);
      if (next) {
        // round: a daylight-saving change adds or removes an hour
        const days = Math.max(1, Math.round((next.t - now) / day));
        svg('text', { class: 'ms-count dr-t', x: x + 5, y: yA - 8 }, s).textContent = `${days} D TO ${next.label}`;
      }
    }
    svg('path', { class: 'tl-ext dr', d: ext.toString() }, s);
    svg('path', { class: 'tl-dim dr', d: dim.toString() }, s);
    svg('path', { class: 'tl-lead dr', d: lead.toString() }, s);
    host.appendChild(s);
    if (!this.item) this.item = this.drawer.register(s, host, { stagger: 30, dur: 900 });
    else { this.item.root = s; this.drawer.refresh(this.item); }
  }
}

export { MON };
