// Sheet furniture: border + zones (ASME Y14.1 style), revision clouds, sheet-level
// dimensions and leaders, plus the controller that makes drawings plot themselves.
import { svg, setAttrs, n, Path, clamp, relRect, PX_PER_MM, motion, fin } from './util.js';

// Zone letters skip I and O, as on an ASME sheet.
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

// ------------------------------------------------------------------ Drawer
/** Plots registered SVG groups with stroke-dashoffset when they scroll into view. */
export class Drawer {
  constructor() {
    this.items = [];
    this.enabled = motion.ok;
  }

  register(root, trigger, opts = {}) {
    const item = { root, trigger: trigger || root, delay: opts.delay || 0, stagger: opts.stagger ?? 28, dur: opts.dur || 900, played: !this.enabled };
    this.items.push(item);
    if (!item.played) this.arm(item);
    return item;
  }

  /** Call after an item's contents were rebuilt. */
  refresh(item) {
    if (!item) return;
    if (item.played) this.clear(item.root);
    else this.arm(item);
  }

  arm(item) {
    item.root.classList.add('is-armed');
    item.root.classList.remove('is-drawn');
    item.root.querySelectorAll('.dr').forEach((el) => {
      let L = 0;
      try { L = el.getTotalLength(); } catch (e) { L = 0; }
      if (!(L > 0) || !Number.isFinite(L)) { el.style.strokeDasharray = ''; el.style.strokeDashoffset = ''; return; }
      el.style.transition = 'none';
      el.style.strokeDasharray = `${n(L + 1)} ${n(L + 1)}`;
      el.style.strokeDashoffset = n(L + 1);
    });
  }

  clear(root) {
    root.classList.remove('is-armed');
    root.querySelectorAll('.dr').forEach((el) => { el.style.strokeDasharray = ''; el.style.strokeDashoffset = ''; el.style.transition = ''; });
  }

  play(item, instant = false) {
    if (item.played) return;
    item.played = true;
    const els = [...item.root.querySelectorAll('.dr')];
    if (instant) { this.clear(item.root); item.root.classList.add('is-drawn'); return; }
    item.root.classList.add('is-drawn');
    item.root.style.setProperty('--td', `${item.delay + Math.min(els.length, 40) * item.stagger * 0.6}ms`);
    // flush styles so each transition starts from the armed (hidden) dash offset
    item.root.getBoundingClientRect();
    els.forEach((el, i) => {
      if (!el.style.strokeDasharray) return;
      el.style.transition = `stroke-dashoffset ${item.dur}ms cubic-bezier(.55,.08,.25,1) ${item.delay + Math.min(i, 60) * item.stagger}ms`;
      el.style.strokeDashoffset = '0';
      const done = () => { el.style.strokeDasharray = ''; el.style.strokeDashoffset = ''; el.style.transition = ''; el.removeEventListener('transitionend', done); };
      el.addEventListener('transitionend', done);
    });
    // safety net: never leave a drawing half-plotted, even if the animation
    // timeline is frozen (background tab, capture tools)
    setTimeout(() => this.settle(item), item.delay + item.dur + Math.min(els.length, 60) * item.stagger + 1600);
  }

  settle(item) {
    const root = item.root;
    try {
      if (root.getAnimations) root.getAnimations({ subtree: true }).forEach((a) => a.finish());
    } catch (e) { /* finish() throws for infinite animations; none are used here */ }
    this.clear(root);
  }

  check(headerH = 0) {
    const vh = window.innerHeight || 800;
    for (const it of this.items) {
      if (it.played) continue;
      const r = it.trigger.getBoundingClientRect();
      if (r.height === 0 && r.width === 0) continue;
      if (r.top < vh * 0.9 && r.bottom > headerH + 10) this.play(it);
    }
  }

  finishAll() {
    for (const it of this.items) {
      if (it.played) this.settle(it);
      else this.play(it, true);
    }
  }

  disable() { this.enabled = false; this.finishAll(); }
}

// ------------------------------------------------------------------ Frames
export class Frames {
  constructor(sheets, drawer) {
    this.sheets = sheets;
    this.drawer = drawer;
    this.info = new Map();
    for (const sheet of sheets) {
      // border + zones sit under the content; dimensions, leaders and clouds sit over it
      const frame = svg('svg', { class: 'sh-frame', 'aria-hidden': 'true', focusable: 'false' });
      sheet.insertBefore(frame, sheet.firstChild);
      const over = svg('svg', { class: 'sh-over', 'aria-hidden': 'true', focusable: 'false' });
      sheet.appendChild(over);
      const border = svg('g', { class: 'sh-border' }, frame);
      const ann = svg('g', { class: 'sh-ann' }, over);
      const clouds = svg('g', { class: 'sh-clouds' }, over);
      const info = { frame, over, border, ann, clouds, nx: 1, ny: 1, b: 30, W: 0, H: 0 };
      info.borderItem = drawer.register(border, sheet, { stagger: 10, dur: 1100 });
      this.info.set(sheet, info);
    }
    this.annItems = new Map();
  }

  render() {
    for (const sheet of this.sheets) this.renderSheet(sheet);
  }

  renderSheet(sheet) {
    const I = this.info.get(sheet);
    const W = sheet.offsetWidth, H = sheet.offsetHeight;
    if (!(W > 0 && H > 0)) return;
    I.W = W; I.H = H;
    const compact = W < 640;
    const m = compact ? 5 : 9;     // trim line inset
    const b = compact ? 17 : 27;   // border inset; zone labels live between m and b
    I.b = b; I.m = m;
    setAttrs(I.frame, { width: W, height: H, viewBox: `0 0 ${n(W)} ${n(H)}` });
    setAttrs(I.over, { width: W, height: H, viewBox: `0 0 ${n(W)} ${n(H)}` });
    const g = I.border;
    while (g.firstChild) g.removeChild(g.firstChild);

    svg('rect', { class: 'sh-trim dr', x: m, y: m, width: W - 2 * m, height: H - 2 * m }, g);
    svg('rect', { class: 'sh-line dr', x: b, y: b, width: W - 2 * b, height: H - 2 * b }, g);

    const nx = (I.nx = clamp(Math.round((W - 2 * b) / (compact ? 110 : 170)), 2, 12));
    const ny = (I.ny = clamp(Math.round((H - 2 * b) / (compact ? 150 : 190)), 2, LETTERS.length));
    const zw = (W - 2 * b) / nx, zh = (H - 2 * b) / ny;
    const ticks = new Path();
    for (let i = 1; i < nx; i++) {
      const x = b + i * zw;
      ticks.M(x, m).L(x, b).M(x, H - b).L(x, H - m);
    }
    for (let j = 1; j < ny; j++) {
      const y = b + j * zh;
      ticks.M(m, y).L(b, y).M(W - b, y).L(W - m, y);
    }
    svg('path', { class: 'sh-tick dr', d: ticks.toString() }, g);
    // centring marks
    const cm = new Path();
    const ext = compact ? 7 : 12;
    cm.M(W / 2, m).L(W / 2, b + ext).M(W / 2, H - m).L(W / 2, H - b - ext);
    cm.M(m, H / 2).L(b + ext, H / 2).M(W - m, H / 2).L(W - b - ext, H / 2);
    svg('path', { class: 'sh-centre dr', d: cm.toString() }, g);

    const fs = compact ? 8 : 9.5;
    const mid = (m + b) / 2 + fs * 0.36;
    for (let i = 0; i < nx; i++) {
      const x = b + (i + 0.5) * zw;
      const label = String(nx - i);                // numbers count down left to right
      if (compact && Math.abs(x - W / 2) < 10) continue;
      svg('text', { class: 'sh-zone dr-t', x, y: mid, 'text-anchor': 'middle', 'font-size': fs }, g).textContent = label;
      svg('text', { class: 'sh-zone dr-t', x, y: H - (m + b) / 2 + fs * 0.36, 'text-anchor': 'middle', 'font-size': fs }, g).textContent = label;
    }
    for (let j = 0; j < ny; j++) {
      const y = H - b - (j + 0.5) * zh + fs * 0.36; // A at the bottom
      const label = LETTERS[j];
      svg('text', { class: 'sh-zone dr-t', x: (m + b) / 2, y, 'text-anchor': 'middle', 'font-size': fs }, g).textContent = label;
      svg('text', { class: 'sh-zone dr-t', x: W - (m + b) / 2, y, 'text-anchor': 'middle', 'font-size': fs }, g).textContent = label;
    }
    this.drawer.refresh(I.borderItem);
    this.renderClouds(sheet, I);
    this.renderAnnotations(sheet, I);
  }

  /** Zone reference ("C4") for a point in sheet coordinates. */
  zoneAt(sheet, x, y) {
    const I = this.info.get(sheet);
    if (!I || !I.W) return '';
    const zw = (I.W - 2 * I.b) / I.nx, zh = (I.H - 2 * I.b) / I.ny;
    const col = clamp(Math.floor((x - I.b) / zw), 0, I.nx - 1);
    const row = clamp(Math.floor((I.H - I.b - y) / zh), 0, I.ny - 1);
    return LETTERS[row] + String(I.nx - col);
  }

  /** Corners of the border, for measure snapping (sheet coordinates). */
  snapPoints(sheet) {
    const I = this.info.get(sheet);
    if (!I || !I.W) return [];
    const { b, W, H } = I;
    return [[b, b], [W - b, b], [b, H - b], [W - b, H - b], [W / 2, b], [W / 2, H - b], [b, H / 2], [W - b, H / 2]];
  }

  // -------------------------------------------------------- revision clouds
  renderClouds(sheet, I) {
    const g = I.clouds;
    while (g.firstChild) g.removeChild(g.firstChild);
    sheet.querySelectorAll('[data-rev]').forEach((el) => {
      const r = relRect(el, sheet);
      if (!(r.w > 0 && r.h > 0)) return;
      const pad = 7;
      const x = r.x - pad, y = r.y - pad, w = r.w + 2 * pad, h = r.h + 2 * pad;
      const grp = svg('g', { class: 'rev' }, g);
      svg('path', { class: 'rev-cloud dr', d: cloudPath(x, y, w, h, 15) }, grp);
      // revision triangle with the letter
      const tx = x + w - 6, ty = y - 2, s = 11;
      svg('path', { class: 'rev-tri dr', d: new Path().poly([[tx, ty - s], [tx + s * 0.95, ty + s * 0.62], [tx - s * 0.95, ty + s * 0.62]]).toString() }, grp);
      svg('text', { class: 'rev-letter dr-t', x: tx, y: ty + s * 0.42, 'text-anchor': 'middle' }, grp).textContent = el.dataset.rev;
      const key = el;
      const prev = this.annItems.get(key);
      if (prev) { prev.root = grp; prev.trigger = el; this.drawer.refresh(prev); }
      else this.annItems.set(key, this.drawer.register(grp, el, { delay: 200, stagger: 0, dur: 1400 }));
    });
  }

  // ---------------------------------------------- sheet-level annotations
  renderAnnotations(sheet, I) {
    const g = I.ann;
    while (g.firstChild) g.removeChild(g.firstChild);
    // horizontal dimensions on [data-dim] elements: value = width in mm at 1:1
    sheet.querySelectorAll('[data-dim]').forEach((el) => {
      const r = relRect(el.querySelector('.dim-target') || el, sheet);
      if (!(r.w > 4)) return;
      const grp = svg('g', { class: 'dim' }, g);
      const off = Number(el.dataset.dimOffset || 18);
      const y = r.y - off;
      const val = (r.w / PX_PER_MM).toFixed(1);
      linearDim(grp, r.x, r.y - 3, r.r, r.y - 3, y, val, el.dataset.dimLabel || '');
      this.track(el, grp, { delay: 300 });
    });
    // leader lines between two elements: [data-leader="#target"]
    sheet.querySelectorAll('[data-leader]').forEach((el) => {
      const target = sheet.querySelector(el.dataset.leader);
      if (!target) return;
      const a = circleOf(el, sheet), b = circleOf(target, sheet);
      if (!a || !b) return;
      const dx = b.cx - a.cx, dy = b.cy - a.cy, d = Math.hypot(dx, dy);
      if (!(d > a.r + b.r + 4)) return;
      const ux = dx / d, uy = dy / d;
      const p0 = [a.cx + ux * a.r, a.cy + uy * a.r], p1 = [b.cx - ux * b.r, b.cy - uy * b.r];
      const grp = svg('g', { class: 'ldr' }, g);
      svg('path', { class: 'ldr-line dr', d: new Path().M(p0[0], p0[1]).L(p1[0], p1[1]).toString() }, grp);
      svg('circle', { class: 'ldr-dot', cx: p0[0], cy: p0[1], r: 2.2 }, grp);
      const lbl = el.dataset.leaderLabel;
      if (lbl) {
        // the letter sits outside the detail circle, opposite the leader
        const lx = a.cx - ux * (a.r + 14), ly = a.cy - uy * (a.r + 14) + 5;
        svg('text', { class: 'ldr-letter dr-t', x: lx, y: ly, 'text-anchor': 'middle' }, grp).textContent = lbl;
      }
      this.track(el, grp, { delay: 500, dur: 1000 });
    });
  }

  track(el, grp, opts) {
    const prev = this.annItems.get(el);
    if (prev) { prev.root = grp; this.drawer.refresh(prev); }
    else this.annItems.set(el, this.drawer.register(grp, el, opts));
  }

  flash(sheet) {
    if (!motion.ok) return;
    sheet.classList.remove('is-arrived');
    void sheet.offsetWidth;
    sheet.classList.add('is-arrived');
    clearTimeout(sheet._arrT);
    sheet._arrT = setTimeout(() => sheet.classList.remove('is-arrived'), 1500);
  }
}

/** Revision cloud: outward scallops around a rectangle, clockwise. */
export function cloudPath(x, y, w, h, chord = 16) {
  const pts = [];
  const nw = Math.max(2, Math.round(w / chord)), nh = Math.max(1, Math.round(h / chord));
  for (let i = 0; i < nw; i++) pts.push([x + (w * i) / nw, y]);
  for (let i = 0; i < nh; i++) pts.push([x + w, y + (h * i) / nh]);
  for (let i = 0; i < nw; i++) pts.push([x + w - (w * i) / nw, y + h]);
  for (let i = 0; i < nh; i++) pts.push([x, y + h - (h * i) / nh]);
  const p = new Path().M(pts[0][0], pts[0][1]);
  for (let i = 1; i <= pts.length; i++) {
    const a = pts[i - 1], b = pts[i % pts.length];
    const c = Math.hypot(b[0] - a[0], b[1] - a[1]);
    p.A(c * 0.62, c * 0.62, 0, 0, 1, b[0], b[1]);
  }
  return p.toString();
}

/** A linear dimension with extension lines, arrowheads and a centred value. */
export function linearDim(g, x1, y1, x2, y2, yDim, text, label = '') {
  const ext = new Path();
  const dir = yDim < y1 ? -1 : 1;
  ext.M(x1, y1 + dir * 2).L(x1, yDim + dir * 6).M(x2, y2 + dir * 2).L(x2, yDim + dir * 6);
  svg('path', { class: 'dim-ext dr', d: ext.toString() }, g);
  const len = Math.abs(x2 - x1);
  const tw = (text.length + (label ? label.length + 1 : 0)) * 6.6 + 10;
  const inside = len > tw + 24;
  const p = new Path();
  if (inside) {
    const mid = (x1 + x2) / 2;
    p.M(x1, yDim).L(mid - tw / 2, yDim).M(mid + tw / 2, yDim).L(x2, yDim);
  } else {
    p.M(x1 - 14, yDim).L(x2 + 14, yDim);
  }
  svg('path', { class: 'dim-line dr', d: p.toString() }, g);
  arrow(g, x1, yDim, inside ? 1 : -1);
  arrow(g, x2, yDim, inside ? -1 : 1);
  const t = svg('text', { class: 'dim-text dr-t', x: inside ? (x1 + x2) / 2 : x2 + 18, y: yDim + 4, 'text-anchor': inside ? 'middle' : 'start' }, g);
  t.textContent = label ? `${text} ${label}` : text;
  return g;
}

/** Filled arrowhead with its tip at (x, y), pointing along +x (dir 1) or -x (dir -1). */
export function arrow(g, x, y, dir, size = 7, half = 2.2) {
  return svg('path', { class: 'dim-arrow', d: new Path().poly([[x, y], [x + dir * size, y - half], [x + dir * size, y + half]]).toString() }, g);
}

/** Arrowhead pointing along an arbitrary unit vector (ux, uy) with its tip at (x, y). */
export function arrowDir(g, x, y, ux, uy, size = 7, half = 2.2, cls = 'dim-arrow') {
  const bx = x - ux * size, by = y - uy * size;
  return svg('path', { class: cls, d: new Path().poly([[x, y], [bx - uy * half, by + ux * half], [bx + uy * half, by - ux * half]]).toString() }, g);
}

function circleOf(el, sheet) {
  const r = relRect(el, sheet);
  if (!(r.w > 0)) return null;
  const pct = el.dataset.circle;   // "cx,cy,r" as fractions of the element box (detail circles on photos)
  if (pct) {
    const [cx, cy, rr] = pct.split(',').map(Number);
    return { cx: r.x + r.w * cx, cy: r.y + r.h * cy, r: r.w * rr };
  }
  return { cx: r.x + r.w / 2, cy: r.y + r.h / 2, r: Math.min(r.w, r.h) / 2 };
}
