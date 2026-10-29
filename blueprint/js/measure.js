// Measure: click two points on a sheet to drop an aligned dimension, in mm at that
// sheet's drawing scale. Snaps to drawing geometry, Shift constrains to ortho,
// Esc clears (a second Esc closes the tool).
import { svg, setAttrs, n, Path, PX_PER_MM, fmtScale, fin } from './util.js';
import { arrowDir } from './frames.js';

const SNAP_PX = 10;

export class Measure {
  constructor({ button, hud, sheets, scaleFor, snapFor, zoneAt, onToggle }) {
    this.btn = button;
    this.hud = hud;
    this.sheets = sheets;
    this.scaleFor = scaleFor;   // (sheet, clientX, clientY) -> { pxPerMm, label }
    this.snapFor = snapFor;     // (sheet) -> [[clientX, clientY], ...]
    this.zoneAt = zoneAt;       // (sheet, x, y) -> "C4"
    this.onToggle = onToggle;
    this.active = false;
    this.pending = null;        // { sheet, x, y, pxPerMm }
    this.dims = [];             // dropped dimensions
    this.layers = new Map();
    this.hover = null;
    this.out = {
      val: hud.querySelector('#mhud-val'),
      d: hud.querySelector('#mhud-d'),
      sheet: hud.querySelector('#mhud-sheet'),
    };
    hud.querySelector('#mhud-clear').addEventListener('click', () => this.clear());
    hud.querySelector('#mhud-done').addEventListener('click', () => this.toggle(false));
    button.addEventListener('click', () => this.toggle());
    this.onDown = this.onDown.bind(this);
    this.onMove = this.onMove.bind(this);
    this.onClick = this.onClick.bind(this);
    document.addEventListener('keydown', (ev) => {
      if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      const tag = (ev.target && ev.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      if (ev.key === 'm' || ev.key === 'M') { this.toggle(); ev.preventDefault(); }
      else if (ev.key === 'Escape' && this.active) {
        if (this.pending || this.dims.length) this.clear(); else this.toggle(false);
        ev.preventDefault();
      }
    });
  }

  layer(sheet) {
    let L = this.layers.get(sheet);
    if (!L) {
      const s = svg('svg', { class: 'm-layer', 'aria-hidden': 'true' });
      sheet.appendChild(s);
      L = { svg: s, dims: svg('g', null, s), live: svg('g', { class: 'm-live' }, s), snap: svg('rect', { class: 'm-snap', width: 9, height: 9, x: 0, y: 0, visibility: 'hidden' }, s) };
      this.layers.set(sheet, L);
    }
    setAttrs(L.svg, { width: sheet.offsetWidth, height: sheet.offsetHeight, viewBox: `0 0 ${n(sheet.offsetWidth)} ${n(sheet.offsetHeight)}` });
    return L;
  }

  toggle(on = !this.active) {
    if (on === this.active) return;
    this.active = on;
    this.btn.setAttribute('aria-pressed', String(on));
    document.body.classList.toggle('is-measuring', on);
    this.hud.hidden = !on;
    if (on) {
      document.addEventListener('pointerdown', this.onDown, true);
      document.addEventListener('pointermove', this.onMove, true);
      document.addEventListener('click', this.onClick, true);
      this.readout(null);
    } else {
      document.removeEventListener('pointerdown', this.onDown, true);
      document.removeEventListener('pointermove', this.onMove, true);
      document.removeEventListener('click', this.onClick, true);
      this.clear();
    }
    if (this.onToggle) this.onToggle(on);
  }

  clear() {
    this.pending = null;
    this.dims = [];
    for (const L of this.layers.values()) {
      while (L.dims.firstChild) L.dims.removeChild(L.dims.firstChild);
      while (L.live.firstChild) L.live.removeChild(L.live.firstChild);
      setAttrs(L.snap, { visibility: 'hidden' });
    }
    this.readout(null);
  }

  sheetAt(x, y) {
    for (const s of this.sheets) {
      const r = s.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return s;
    }
    return null;
  }

  /** Resolve a client point: snapping, ortho, sheet-local coordinates. */
  resolve(clientX, clientY, shift, anchor) {
    const sheet = anchor ? anchor.sheet : this.sheetAt(clientX, clientY);
    if (!sheet) return null;
    let x = clientX, y = clientY, snapped = false;
    let best = SNAP_PX;
    for (const p of this.snapFor(sheet)) {
      const d = Math.hypot(p[0] - clientX, p[1] - clientY);
      if (d < best) { best = d; x = p[0]; y = p[1]; snapped = true; }
    }
    const r = sheet.getBoundingClientRect();
    let lx = x - r.left, ly = y - r.top;
    if (shift && anchor) {
      if (Math.abs(lx - anchor.x) > Math.abs(ly - anchor.y)) ly = anchor.y; else lx = anchor.x;
      snapped = false;
    }
    return { sheet, x: lx, y: ly, cx: lx + r.left, cy: ly + r.top, snapped };
  }

  isUi(target) {
    return !!(target && target.closest && target.closest('.strip, .mhud, .ex-controls, .callout'));
  }

  onDown(ev) {
    this.lastType = ev.pointerType || 'mouse';
    if (!this.active || this.isUi(ev.target)) return;
    if (ev.button !== undefined && ev.button !== 0) return;
    // a touch may turn into a scroll, so touch points are placed on tap (click)
    if (this.lastType === 'touch') return;
    const ok = this.pick(ev.clientX, ev.clientY, ev.shiftKey);
    if (ok) ev.preventDefault();
  }

  onClick(ev) {
    if (!this.active || this.isUi(ev.target)) return;
    if (!this.sheetAt(ev.clientX, ev.clientY)) return;
    // swallow link activation while measuring on a sheet
    ev.preventDefault();
    ev.stopPropagation();
    if (this.lastType === 'touch') this.pick(ev.clientX, ev.clientY, false);
  }

  onMove(ev) {
    if (!this.active || ev.pointerType === 'touch') return;
    if (this.isUi(ev.target)) return;
    this.preview(ev.clientX, ev.clientY, ev.shiftKey);
  }

  /** Same code path as a click: first call sets A, second drops the dimension. Returns the result. */
  pick(clientX, clientY, shift = false) {
    const pt = this.resolve(clientX, clientY, shift, this.pending);
    if (!pt) return null;
    if (!this.pending) {
      const sc = this.scaleFor(pt.sheet, pt.cx, pt.cy);
      this.pending = { ...pt, pxPerMm: sc.pxPerMm, label: sc.label };
      const L = this.layer(pt.sheet);
      while (L.live.firstChild) L.live.removeChild(L.live.firstChild);
      this.cross(L.live, pt.x, pt.y);
      this.readout({ a: this.pending, b: null });
      return { stage: 'A', point: pt };
    }
    const a = this.pending;
    const dim = this.make(a, pt);
    this.dims.push(dim);
    this.pending = null;
    const L = this.layer(a.sheet);
    while (L.live.firstChild) L.live.removeChild(L.live.firstChild);
    this.drawDim(L.dims, dim);
    this.readout(dim);
    return dim;
  }

  make(a, b) {
    const px = Math.hypot(b.x - a.x, b.y - a.y);
    const k = fin(a.pxPerMm, PX_PER_MM) || PX_PER_MM;
    return {
      sheet: a.sheet, a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y },
      px, mm: px / k, dx: Math.abs(b.x - a.x) / k, dy: Math.abs(b.y - a.y) / k,
      pxPerMm: k, scale: fmtScale(k), label: a.label,
      zoneA: this.zoneAt(a.sheet, a.x, a.y), zoneB: this.zoneAt(a.sheet, b.x, b.y),
      snappedA: !!a.snapped, snappedB: !!b.snapped,
    };
  }

  preview(clientX, clientY, shift) {
    const pt = this.resolve(clientX, clientY, shift, this.pending);
    for (const [s, L] of this.layers) if (!pt || s !== pt.sheet) setAttrs(L.snap, { visibility: 'hidden' });
    if (!pt) return;
    const L = this.layer(pt.sheet);
    setAttrs(L.snap, pt.snapped ? { x: pt.x - 4.5, y: pt.y - 4.5, visibility: 'visible' } : { visibility: 'hidden' });
    if (!this.pending) {
      const sc = this.scaleFor(pt.sheet, pt.cx, pt.cy);
      this.out.sheet.textContent = `${pt.sheet.dataset.label} · ${sc.label} · ZONE ${this.zoneAt(pt.sheet, pt.x, pt.y)}`;
      return;
    }
    const dim = this.make(this.pending, pt);
    while (L.live.firstChild) L.live.removeChild(L.live.firstChild);
    this.cross(L.live, this.pending.x, this.pending.y);
    this.drawDim(L.live, dim, true);
    this.readout(dim);
  }

  cross(g, x, y) {
    svg('path', { class: 'm-cross', d: new Path().M(x - 6, y).L(x + 6, y).M(x, y - 6).L(x, y + 6).toString() }, g);
  }

  drawDim(parent, d, live = false) {
    const g = svg('g', { class: 'm-dim' + (live ? ' m-dim--live' : '') }, parent);
    const { a, b } = d;
    const L = d.px;
    this.cross(g, a.x, a.y);
    this.cross(g, b.x, b.y);
    if (L < 1) return g;
    const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
    svg('path', { class: 'm-line', d: new Path().M(a.x, a.y).L(b.x, b.y).toString() }, g);
    if (L > 22) {
      arrowDir(g, a.x, a.y, -ux, -uy, 8, 2.6, 'm-arrow');
      arrowDir(g, b.x, b.y, ux, uy, 8, 2.6, 'm-arrow');
    }
    // value: unidirectional text, offset to the upper side of the line
    let nx = -uy, ny = ux;
    if (ny > 0 || (Math.abs(ny) < 1e-6 && nx < 0)) { nx = -nx; ny = -ny; }
    const mx = (a.x + b.x) / 2 + nx * 13, my = (a.y + b.y) / 2 + ny * 13;
    const txt = d.mm >= 1000 ? d.mm.toFixed(0) : d.mm.toFixed(1);
    const tw = txt.length * 7.6 + 10;
    svg('rect', { class: 'm-knock', x: mx - tw / 2, y: my - 9, width: tw, height: 17, rx: 2 }, g);
    svg('text', { class: 'm-text', x: mx, y: my + 4.5, 'text-anchor': 'middle' }, g).textContent = txt;
    return g;
  }

  readout(d) {
    const o = this.out;
    if (!d) {
      o.val.textContent = '—';
      o.d.textContent = 'Click two points on a sheet';
      return;
    }
    if (!d.b && d.a) {
      o.val.textContent = '0.0 mm';
      o.d.textContent = `A set · zone ${this.zoneAt(d.a.sheet, d.a.x, d.a.y)} · pick B`;
      return;
    }
    o.val.textContent = `${d.mm.toFixed(1)} mm`;
    o.d.textContent = `ΔX ${d.dx.toFixed(1)} · ΔY ${d.dy.toFixed(1)} · ${d.zoneA} → ${d.zoneB}`;
    o.sheet.textContent = `${d.sheet.dataset.label} · ${d.label}`;
  }

  /** Re-size layers after layout changes. */
  layout() {
    for (const [sheet] of this.layers) this.layer(sheet);
  }
}
