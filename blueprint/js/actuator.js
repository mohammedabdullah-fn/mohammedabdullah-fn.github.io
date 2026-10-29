// ME 5374 elbow joint actuator: exploded section A-A, end view B and parts list.
// Geometry is a concept layout in (a, r) millimetres: a = axial from the rear face,
// r = radial. Parts translate along the axis in disassembly order as e goes 0 -> 1.
import { svg, setAttrs, n, Path, clamp, lerp, easeInOut, sstep, fin, PX_PER_MM, fmtScale } from './util.js';
import { arrowDir } from './frames.js';

const DUR = 0.5;   // fraction of the explode range each part spends moving

// polys: { h: hatch id or null, pts: [[a, r], ...], full: spans the axis (not mirrored) }
export const PARTS = [
  { id: 'housing', item: 1, name: 'Housing', spec: 'Machined 6061-T6 aluminum', note: 'Every custom part is buildable on a mill or lathe.', row: 1, anchor: [74, 45], delta: 0, t0: 0,
    polys: [{ h: 'al', pts: [[7, 45], [98, 45], [98, 41.5], [84.5, 41.5], [84.5, 38], [55, 38], [55, 41], [9.5, 41], [9.5, 43], [7, 43]] }] },
  { id: 'cover', item: 2, name: 'Rear cover', spec: '6061-T6, closes the rear', note: 'Cable exit on the axis.', row: 1, anchor: [3, 45], delta: -93.2, t0: 0,
    polys: [{ h: 'al2', pts: [[0, 6], [0, 45], [7, 45], [7, 40.6], [9.4, 40.6], [9.4, 37], [5, 37], [5, 6]] }] },
  { id: 'ctrl', item: 3, name: 'Controller board', spec: 'mjbots moteus n1', note: '48 V, dual-encoder mode, gravity feedforward.', row: -1, anchor: [10.8, 22], delta: -82.8, t0: 0.1,
    polys: [{ h: 'pcb', full: true, pts: [[10, -24], [10, 24], [11.6, 24], [11.6, -24]] }],
    boxes: [[11.6, 3, 14.2, 10], [11.6, 13, 13.4, 21], [11.6, -9, 13.6, -3], [11.6, -21, 13.4, -13], [8, 15, 10, 22], [8, -22, 10, -15]] },
  { id: 'brake', item: 4, name: 'Spring-applied brake', spec: 'Miki Pulley BXR-LE', note: 'On the motor side, so it only needs to hold about 1 Nm.', row: 1, anchor: [21, 31], delta: -76.6, t0: 0.2,
    polys: [
      { h: 'st', pts: [[17, 14], [17, 31], [25, 31], [25, 27.5], [19.5, 27.5], [19.5, 17.5], [25, 17.5], [25, 14]] },
      { h: 'cu', pts: [[19.5, 17.5], [19.5, 27.5], [25, 27.5], [25, 17.5]] },
      { h: 'st2', pts: [[25.6, 13], [25.6, 31], [27.4, 31], [27.4, 13]] },
      { h: 'fr', pts: [[28, 9.5], [28, 29], [29.6, 29], [29.6, 9.5]] }] },
  { id: 'rotor', item: 6, name: 'Rotor hub', spec: 'Kollmorgen TBM2G-06008 rotor', note: 'Magnet ring on a hollow hub; carries the wave generator.', row: -1, anchor: [46, 22.2], delta: -65, t0: 0.3,
    polys: [
      { h: 'st', pts: [[27, 7], [27, 9.5], [40, 9.5], [40, 15], [33, 15], [33, 22.2], [51, 22.2], [51, 15], [44, 15], [44, 9.5], [63, 9.5], [63, 7]] },
      { h: 'mag', pts: [[34.5, 22.2], [34.5, 23.4], [49.5, 23.4], [49.5, 22.2]] }] },
  { id: 'stator', item: 5, name: 'Stator', spec: 'Kollmorgen TBM2G-06008 frameless, B winding', note: '0.45 Nm continuous, 1.22 Nm peak at the motor.', row: -1, anchor: [44, 33], delta: 0, t0: 0,
    polys: [
      { h: 'lam', pts: [[34, 24], [34, 41], [50, 41], [50, 24]] },
      { h: 'cu', pts: [[31, 27], [32, 25.5], [34, 25.5], [34, 33], [32, 33], [31, 31.5]] },
      { h: 'cu', pts: [[50, 25.5], [52, 25.5], [53, 27], [53, 31.5], [52, 33], [50, 33]] }] },
  { id: 'wg', item: 7, name: 'Wave generator', spec: 'Harmonic Drive CSF-17-100-2A', note: 'Elliptical cam in a thin-section ball bearing.', row: 1, anchor: [59.5, 18], delta: 51, t0: 0.4,
    polys: [
      { h: 'st2', pts: [[56, 9.5], [56, 22.4], [63, 22.4], [63, 9.5]] },
      { h: null, pts: [[56.2, 22.6], [56.2, 24.6], [62.8, 24.6], [62.8, 22.6]] }],
    balls: [[59.5, 23.6, 0.8]] },
  { id: 'flex', item: 8, name: 'Flexspline cup', spec: 'Harmonic Drive CSF-17-100-2A', note: 'Thin-wall cup; 100:1 with near-zero backlash.', row: -1, anchor: [71, 25.8], delta: 67, t0: 0.32,
    polys: [{ h: 'st', pts: [[56, 24.6], [56, 27.4], [64, 27.4], [64, 25.8], [77.5, 25.8], [80.8, 22.6], [80.8, 10.5], [86.5, 10.5], [86.5, 6], [79, 6], [79, 22], [76.8, 24.6]] }],
    pitch: [[56, 64, 26.6]] },
  { id: 'cs', item: 9, name: 'Circular spline', spec: 'Harmonic Drive CSF-17-100-2A', note: 'Rigid internal-tooth ring, fixed to the housing.', row: 1, anchor: [60, 37], delta: 107, t0: 0.24,
    polys: [{ h: 'st2', pts: [[55.5, 27.6], [55.5, 38], [64.5, 38], [64.5, 27.6]] }],
    pitch: [[55.5, 64.5, 28.3]] },
  { id: 'xrb', item: 10, name: 'Cross-roller bearing', spec: 'Output support bearing', note: 'Takes the output moment loads.', row: -1, anchor: [90.25, 39.5], delta: 96, t0: 0.16,
    polys: [
      { h: 'st', pts: [[84.5, 41.5], [96, 41.5], [96, 35.5], [93.2, 35.5], [90.25, 38.45], [87.3, 35.5], [84.5, 35.5]] },
      { h: 'st2', pts: [[84.5, 28], [96, 28], [96, 34.5], [93.2, 34.5], [90.25, 31.55], [87.3, 34.5], [84.5, 34.5]] },
      { h: null, roller: true, pts: [[90.25, 38.1], [93, 35], [90.25, 31.9], [87.5, 35]] }] },
  { id: 'enc', item: 11, name: 'Absolute encoder ring', spec: 'RLS AksIM-2', note: 'Reads the true output angle at power-up: no homing move.', row: 1, anchor: [97.6, 38], delta: 104.6, t0: 0.08,
    polys: [{ h: 'enc', pts: [[96.4, 35.4], [96.4, 40.6], [98.8, 40.6], [98.8, 35.4]] }] },
  { id: 'flange', item: 12, name: 'Output flange', spec: '6061-T6', note: 'Bolts to the flexspline and the bearing inner race.', row: -1, anchor: [105, 42], delta: 125.9, t0: 0,
    polys: [{ h: 'al', pts: [[86.5, 6], [86.5, 27.9], [96, 27.9], [96, 34.4], [99.2, 34.4], [99.2, 42], [110, 42], [110, 6]] }],
    holes: [[99.2, 110, 37, 2.2]] },
];

// precompute axial extents
for (const p of PARTS) {
  let a0 = Infinity, a1 = -Infinity;
  for (const poly of p.polys) for (const [a] of poly.pts) { a0 = Math.min(a0, a); a1 = Math.max(a1, a); }
  if (p.boxes) for (const b of p.boxes) { a0 = Math.min(a0, b[0]); a1 = Math.max(a1, b[2]); }
  p.a0 = a0; p.a1 = a1;
}

const HATCH = {
  al: { angle: 45, gap: 6 },          // ANSI31 style, aluminium housing parts
  al2: { angle: -45, gap: 6 },
  st: { angle: 45, gap: 3.6 },
  st2: { angle: -45, gap: 3.6 },
  cu: { angle: 45, gap: 4.4, dash: true },
  lam: { angle: 90, gap: 2.6 },
  mag: { angle: -45, gap: 2 },
  pcb: { angle: 45, gap: 3, cross: true },
  fr: { angle: 0, gap: 2.2, dots: true },
  enc: { angle: -45, gap: 1.8 },
};

export class Actuator {
  constructor(root, { tip, onScale }) {
    this.root = root;
    this.tip = tip;
    this.onScale = onScale;
    this.drawHost = root.querySelector('.ex-draw');
    this.endHost = root.querySelector('.ex-end');
    this.bomHost = root.querySelector('.ex-bom');
    this.range = root.querySelector('.ex-range');
    this.out = root.querySelector('.ex-out');
    this.modeBtn = root.querySelector('.ex-mode');
    this.scaleOut = root.querySelector('.ex-scale');
    this.track = root;
    this.stage = root.querySelector('.ex-stage');
    this.e = 0; this.manual = false; this.s = 2; this.vertical = false;
    this.hot = null;
    this.snap = [];
    this.buildSection();
    this.buildEnd();
    this.buildBom();
    this.bindControls();
  }

  // ----------------------------------------------------------- building
  buildSection() {
    const s = (this.svg = svg('svg', { class: 'ex-svg', role: 'img', 'aria-label': 'Exploded section A-A of the elbow joint actuator. Parts, from the rear: rear cover, controller board, brake, rotor hub, housing with stator, wave generator, flexspline cup, circular spline, cross-roller bearing, encoder ring and output flange.' }, this.drawHost));
    const defs = svg('defs', null, s);
    this.patterns = {};
    for (const [id, h] of Object.entries(HATCH)) this.patterns[id] = this.makePattern(defs, id, h);
    this.gCl = svg('path', { class: 'ex-cl' }, s);
    this.gParts = svg('g', { class: 'ex-parts' }, s);
    for (const p of PARTS) {
      const g = svg('g', { class: 'ex-part', 'data-part': p.id }, this.gParts);
      p.el = { g, polys: [], tints: [] };
      for (const poly of p.polys) {
        const cls = poly.roller ? 'ex-roller' : poly.h ? 'ex-sec' : 'ex-out';
        const el = svg('path', { class: cls, fill: poly.h ? `url(#hx-${poly.h})` : null }, g);
        p.el.polys.push(el);
      }
      p.el.tint = svg('path', { class: 'ex-tint' }, g);
      p.el.extra = svg('path', { class: 'ex-extra' }, g);
      p.el.hidden = svg('path', { class: 'ex-hid' }, g);
      p.el.chain = svg('path', { class: 'ex-chain' }, g);
    }
    this.gDims = svg('g', { class: 'ex-dims' }, s);
    this.dimLen = svg('g', { class: 'ex-dim' }, this.gDims);
    this.dimDia = svg('g', { class: 'ex-dim' }, this.gDims);
    this.gBalloons = svg('g', { class: 'ex-balloons' }, s);
    for (const p of PARTS) {
      const g = svg('g', { class: 'ex-balloon', 'data-part': p.id }, this.gBalloons);
      p.bl = {
        g,
        lead: svg('path', { class: 'ex-lead' }, g),
        dot: svg('circle', { class: 'ex-dot', r: 2 }, g),
        circ: svg('circle', { class: 'ex-bc' }, g),
        text: svg('text', { class: 'ex-bt', 'text-anchor': 'middle' }, g),
      };
      p.bl.text.textContent = String(p.item);
    }
    this.label = svg('text', { class: 'ex-label', 'text-anchor': 'middle' }, s);
    this.label2 = svg('text', { class: 'ex-label2', 'text-anchor': 'middle' }, s);
  }

  makePattern(defs, id, h) {
    const g = h.gap;
    const w = h.dash || h.cross ? g * 2 : g;
    const pat = svg('pattern', { id: `hx-${id}`, width: w, height: w, patternUnits: 'userSpaceOnUse', patternTransform: `rotate(${h.angle})` }, defs);
    if (h.dots) {
      svg('circle', { cx: g / 2, cy: g / 2, r: 0.55, class: 'hx-dot' }, pat);
    } else {
      svg('line', { x1: 0, y1: 0, x2: 0, y2: w, class: 'hx-l' }, pat);
      if (h.dash) svg('line', { x1: g, y1: 0, x2: g, y2: w, class: 'hx-l hx-l--dash' }, pat);
      if (h.cross) svg('line', { x1: 0, y1: g, x2: w, y2: g, class: 'hx-l' }, pat);
    }
    return pat;
  }

  buildEnd() {
    const s = (this.endSvg = svg('svg', { class: 'ex-endsvg', role: 'img', 'aria-label': 'View B, the output end: Ø90 housing, output flange with an 8-hole bolt circle, hidden encoder ring and wave generator, and the cutting plane A-A.' }, this.endHost));
    this.end = {
      hidden: svg('path', { class: 'ex-hid', 'data-part': 'enc' }, s),
      wg: svg('path', { class: 'ex-hid', 'data-part': 'wg' }, s),
      housing: svg('path', { class: 'ex-vis ex-vis--thick', 'data-part': 'housing' }, s),
      flange: svg('path', { class: 'ex-vis', 'data-part': 'flange' }, s),
      bc: svg('path', { class: 'ex-chain' }, s),
      cm: svg('path', { class: 'ex-chain' }, s),
      cut: svg('path', { class: 'ex-cut' }, s),
      cutEnds: svg('path', { class: 'ex-cut-end' }, s),
      dim: svg('g', { class: 'ex-dim' }, s),
      letters: svg('g', { class: 'ex-cut-letters' }, s),
    };
  }

  buildBom() { this.renderBom(1); }

  /** Parts list, one-up or two-up (items 1-6 beside 7-12). */
  renderBom(cols) {
    if (cols === this.bomCols) return;
    this.bomCols = cols;
    const host = this.bomHost;
    while (host.firstChild) host.removeChild(host.firstChild);
    const items = [...PARTS].sort((a, b) => a.item - b.item);
    const table = document.createElement('table');
    table.className = 'bom' + (cols === 2 ? ' bom--2' : '');
    const cap = document.createElement('caption'); cap.textContent = 'Parts list';
    const head = document.createElement('thead');
    const hr = document.createElement('tr');
    for (let c = 0; c < cols; c++) for (const h of ['Item', 'Part · description', 'Qty']) {
      const th = document.createElement('th'); th.scope = 'col'; th.textContent = h; hr.appendChild(th);
    }
    head.appendChild(hr);
    const body = document.createElement('tbody');
    const per = Math.ceil(items.length / cols);
    for (let r = 0; r < per; r++) {
      const tr = document.createElement('tr');
      for (let c = 0; c < cols; c++) {
        const p = items[r + c * per];
        if (!p) { tr.appendChild(document.createElement('td')); continue; }
        const td1 = document.createElement('td'); td1.className = 'bom-item'; td1.textContent = String(p.item); td1.dataset.part = p.id;
        const td2 = document.createElement('td'); td2.dataset.part = p.id; td2.tabIndex = 0;
        const b = document.createElement('b'); b.textContent = p.name;
        const sp = document.createElement('span'); sp.textContent = p.spec;
        td2.append(b, sp);
        const td3 = document.createElement('td'); td3.className = 'bom-qty'; td3.textContent = '1'; td3.dataset.part = p.id;
        tr.append(td1, td2, td3);
      }
      body.appendChild(tr);
    }
    table.append(cap, head, body);
    host.appendChild(table);
    if (this.hot) this.root.querySelectorAll(`[data-part="${this.hot}"]`).forEach((el) => el.classList.add('is-hot'));
  }

  bindControls() {
    const over = (ev) => {
      const t = ev.target.closest && ev.target.closest('[data-part]');
      if (!t || !this.root.contains(t)) return;
      this.setHot(t.dataset.part, ev);
    };
    const move = (ev) => {
      if (!this.hot) return;
      const p = PARTS.find((q) => q.id === this.hot);
      if (p) this.tip.show(ev.clientX, ev.clientY, `${p.item} · ${p.name}`, `${p.spec}. ${p.note}`);
    };
    const out = (ev) => {
      const to = ev.relatedTarget && ev.relatedTarget.closest && ev.relatedTarget.closest('[data-part]');
      if (to && this.root.contains(to)) return;
      this.setHot(null);
    };
    this.root.addEventListener('pointerover', over);
    this.root.addEventListener('pointermove', move);
    this.root.addEventListener('pointerout', out);
    this.bomHost.addEventListener('focusin', (ev) => {
      const td = ev.target.closest('td[data-part]');
      if (!td) return;
      const r = td.getBoundingClientRect();
      this.setHot(td.dataset.part, { clientX: r.left + 20, clientY: r.top + r.height / 2 });
    });
    this.bomHost.addEventListener('focusout', () => this.setHot(null));
    if (this.range) {
      this.range.addEventListener('input', () => {
        this.manual = true;
        this.updateMode();
        this.set(Number(this.range.value) / 1000);
      });
    }
    if (this.modeBtn) this.modeBtn.addEventListener('click', () => {
      this.manual = !this.manual;
      this.updateMode();
      if (!this.manual && this.onRelink) this.onRelink();
    });
  }

  updateMode() {
    if (!this.modeBtn) return;
    this.modeBtn.setAttribute('aria-pressed', String(!this.manual));
    this.modeBtn.textContent = this.manual ? 'Manual · link to scroll' : 'Linked to scroll';
  }

  setHot(id, ev) {
    if (id === this.hot) return;
    this.hot = id;
    this.root.querySelectorAll('.is-hot').forEach((el) => el.classList.remove('is-hot'));
    if (!id) { this.tip.hide(); return; }
    this.root.querySelectorAll(`[data-part="${id}"]`).forEach((el) => el.classList.add('is-hot'));
    const p = PARTS.find((q) => q.id === id);
    if (p && ev) this.tip.show(ev.clientX, ev.clientY, `${p.item} · ${p.name}`, `${p.spec}. ${p.note}`);
  }

  // ------------------------------------------------------------- layout
  layout(stickyAllowed) {
    this.renderBom(this.bomHost.clientWidth >= 600 ? 2 : 1);
    // exact (fractional) size, so one SVG unit is exactly one CSS pixel
    const box = this.drawHost.getBoundingClientRect();
    const W = Math.max(200, box.width);
    const H = Math.max(200, box.height);
    this.W = W; this.H = H;
    this.vertical = W < 560 && H > W;
    setAttrs(this.svg, { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    // laminations are stacked along the axis, so their lines run across it
    setAttrs(this.patterns.lam, { patternTransform: `rotate(${this.vertical ? 90 : 0})` });
    const eb = this.endHost.getBoundingClientRect();
    const ew = Math.max(120, eb.width);
    const eh = Math.max(120, eb.height || ew * 0.78);
    this.EW = ew; this.EH = eh;
    setAttrs(this.endSvg, { width: ew, height: eh, viewBox: `0 0 ${ew} ${eh}` });
    this.sticky = !!stickyAllowed;
    this.render(this.e, true);
  }

  /** Cache document offsets for the scroll-linked progress. */
  measureTrack() {
    const r = this.root.getBoundingClientRect();
    this.trackTop = r.top + window.scrollY;
    this.trackH = r.height;
    this.stageH = this.stage.offsetHeight;
  }

  /** Scroll position -> explode progress e. */
  progressFor(scrollY, headerH, vh) {
    if (this.sticky && this.trackH - this.stageH > 40) {
      const p = (scrollY + headerH - this.trackTop) / (this.trackH - this.stageH);
      return sstep(0.06, 0.86, clamp(p, 0, 1));
    }
    // in-flow (phones, short windows): explode while the stage crosses the viewport
    const top = this.trackTop - scrollY;
    const p = (vh * 0.8 - top) / Math.max(1, this.stageH * 0.75);
    return sstep(0.05, 0.95, clamp(p, 0, 1));
  }

  set(e) {
    e = clamp(fin(e, 0), 0, 1);
    if (Math.abs(e - this.e) < 1e-4 && this.rendered) return;
    this.render(e);
  }

  setFromScroll(e) {
    if (this.manual) return;
    this.set(e);
  }

  offsetOf(p, e) {
    const u = easeInOut(clamp((e - p.t0) / DUR, 0, 1));
    return p.delta * u;
  }

  // ------------------------------------------------------------- render
  render(e, force = false) {
    this.e = e = clamp(fin(e, 0), 0, 1);
    this.rendered = true;
    const W = this.W || 600, H = this.H || 400, vert = this.vertical;
    const br = W < 420 ? 10 : 11;
    let amin = Infinity, amax = -Infinity;
    for (const p of PARTS) {
      p.d = this.offsetOf(p, e);
      amin = Math.min(amin, p.a0 + p.d);
      amax = Math.max(amax, p.a1 + p.d);
    }
    const dimRoom = 30;
    const band = 34;                       // bottom band for the view label
    const Hd = H - band;
    const along = vert ? Hd : W, across = vert ? W : Hd;
    const sA = (along - 2 * (br + 22) - (e < 0.2 ? dimRoom : 0)) / (amax - amin);
    const sR = (across / 2 - (40 + 2 * br + 8)) / 45;
    const s = (this.s = clamp(Math.min(sA, sR), 0.4, 9));
    const mid = (amin + amax) / 2;
    const cx = W / 2, cy = Hd / 2;
    this.cy = cy;
    const P = vert ? (a, r) => [cx + r * s, cy + (a - mid) * s] : (a, r) => [cx + (a - mid) * s, cy - r * s];
    this.P = P;

    // centre line across the whole set
    const c0 = P(amin - 10, 0), c1 = P(amax + 10, 0);
    this.gCl.setAttribute('d', new Path().M(c0[0], c0[1]).L(c1[0], c1[1]).toString());

    const snap = [];
    for (const p of PARTS) {
      const d = p.d;
      const toS = (pt, sign) => P(pt[0] + d, pt[1] * sign);
      const tint = new Path();
      p.polys.forEach((poly, i) => {
        const path = new Path();
        const halves = poly.full ? [1] : [1, -1];
        for (const sign of halves) {
          const pts = poly.pts.map((q) => toS(q, sign));
          path.poly(pts);
          tint.poly(pts);
          // endpoint and midpoint snaps, as in a CAD sketch
          pts.forEach((q, j) => {
            const nq = pts[(j + 1) % pts.length];
            snap.push(q, [(q[0] + nq[0]) / 2, (q[1] + nq[1]) / 2]);
          });
        }
        if (poly.roller) {
          // rolling element: outline with diagonals, never section-lined
          for (const sign of [1, -1]) {
            const q = poly.pts.map((v) => toS(v, sign));
            path.M(q[0][0], q[0][1]).L(q[2][0], q[2][1]).M(q[1][0], q[1][1]).L(q[3][0], q[3][1]);
          }
        }
        p.el.polys[i].setAttribute('d', path.toString());
      });
      const ex = new Path(), hid = new Path(), ch = new Path();
      if (p.boxes) for (const b of p.boxes) {
        const q = [toS([b[0], b[1]], 1), toS([b[2], b[1]], 1), toS([b[2], b[3]], 1), toS([b[0], b[3]], 1)];
        ex.poly(q); tint.poly(q);
      }
      if (p.balls) for (const [a, r, rr] of p.balls) for (const sign of [1, -1]) { const q = toS([a, r], sign); ex.circle(q[0], q[1], Math.max(1, rr * s)); }
      if (p.pitch) for (const [a0, a1, r] of p.pitch) for (const sign of [1, -1]) { const q0 = toS([a0, r], sign), q1 = toS([a1, r], sign); ch.M(q0[0], q0[1]).L(q1[0], q1[1]); }
      if (p.holes) for (const [a0, a1, r, hr] of p.holes) for (const sign of [1, -1]) {
        const c0 = toS([a0 - 1.5, r], sign), c1 = toS([a1 + 1.5, r], sign);
        ch.M(c0[0], c0[1]).L(c1[0], c1[1]);
        for (const o of [-hr, hr]) { const h0 = toS([a0, r + o], sign), h1 = toS([a1, r + o], sign); hid.M(h0[0], h0[1]).L(h1[0], h1[1]); }
      }
      p.el.extra.setAttribute('d', ex.toString() || 'M0 0');
      p.el.hidden.setAttribute('d', hid.toString() || 'M0 0');
      p.el.chain.setAttribute('d', ch.toString() || 'M0 0');
      p.el.tint.setAttribute('d', tint.toString());
      snap.push(P(p.a0 + d, 0), P(p.a1 + d, 0));
    }
    this.snap = snap;

    this.renderBalloons(P, s, br, vert, amin, amax);
    this.renderEnvelopeDims(P, s, vert, e);

    const pct = Math.round(e * 100);
    const lx = W / 2, ly = H - 8;
    setAttrs(this.label, { x: lx, y: ly - 14 });
    this.label.textContent = 'SECTION A–A';
    setAttrs(this.label2, { x: lx, y: ly });
    this.label2.textContent = `EXPLODED ${String(pct).padStart(2, '0')}% · SCALE ${fmtScale(s)}`;
    if (this.range && !this.dragging) this.range.value = String(Math.round(e * 1000));
    if (this.out) this.out.textContent = `${pct}%`;
    if (this.scaleOut) this.scaleOut.textContent = fmtScale(s);
    if (this.onScale) this.onScale(s);
    this.renderEnd(e);
  }

  renderBalloons(P, s, br, vert, amin, amax) {
    const off = 45 * s + 40;
    const rows = { 1: [], [-1]: [] };
    for (const p of PARTS) {
      const anc = P(p.anchor[0] + p.d, p.anchor[1] * p.row);
      const want = vert ? anc[1] : anc[0];
      rows[p.row].push({ p, anc, want, size: 2 * br + 6 });
    }
    const limit = vert ? this.H - 34 : this.W;
    const cy = this.cy;
    for (const key of [1, -1]) {
      const list = rows[key].sort((a, b) => a.want - b.want);
      // spread so balloons never overlap, then pull the group back inside the view
      let cur = -Infinity;
      for (const it of list) { it.pos = Math.max(it.want, cur); cur = it.pos + it.size; }
      const lo = br + 4, hi = limit - br - 4;
      const shiftR = Math.max(0, (list.length ? list[list.length - 1].pos : 0) - hi);
      for (const it of list) it.pos -= shiftR;
      cur = lo;
      for (const it of list) { if (it.pos < cur) it.pos = cur; cur = it.pos + it.size; }
      for (const it of list) {
        const c = vert ? [this.W / 2 + key * off, it.pos] : [it.pos, cy - key * off];
        const b = it.p.bl;
        setAttrs(b.circ, { cx: c[0], cy: c[1], r: br });
        setAttrs(b.text, { x: c[0], y: c[1] + 4 });
        setAttrs(b.dot, { cx: it.anc[0], cy: it.anc[1] });
        const dx = it.anc[0] - c[0], dy = it.anc[1] - c[1], d = Math.hypot(dx, dy) || 1;
        const st = [c[0] + (dx / d) * br, c[1] + (dy / d) * br];
        b.lead.setAttribute('d', new Path().M(st[0], st[1]).L(it.anc[0], it.anc[1]).toString());
      }
    }
  }

  renderEnvelopeDims(P, s, vert, e) {
    const op = 1 - sstep(0.015, 0.1, e);
    const cover = PARTS.find((p) => p.id === 'cover'), flange = PARTS.find((p) => p.id === 'flange');
    for (const g of [this.dimLen, this.dimDia]) { while (g.firstChild) g.removeChild(g.firstChild); g.setAttribute('opacity', n(op)); }
    if (op < 0.01) return;
    // overall length 110 (rear face of the cover to the output face)
    const aR = cover.a0 + cover.d, aF = flange.a1 + flange.d;
    const gap = 45 * s + 16;
    const g = this.dimLen;
    if (!vert) {
      const y = this.cy + gap;
      const p0 = P(aR, -45), p1 = P(aF, -42);
      svg('path', { class: 'dim-ext', d: new Path().M(p0[0], p0[1] + 3).L(p0[0], y + 5).M(p1[0], p1[1] + 3).L(p1[0], y + 5).toString() }, g);
      this.dimLine(g, [p0[0], y], [p1[0], y], `${Math.round(aF - aR)}`);
      // Ø90 across the housing, beyond the output face
      const q0 = P(98, 45), q1 = P(98, -45), xd = P(aF + 9, 0)[0];
      svg('path', { class: 'dim-ext', d: new Path().M(q0[0] + 3, q0[1]).L(xd + 5, q0[1]).M(q1[0] + 3, q1[1]).L(xd + 5, q1[1]).toString() }, this.dimDia);
      this.dimLine(this.dimDia, [xd, q0[1]], [xd, q1[1]], 'Ø90', true);
    } else {
      const x = this.W / 2 - gap;
      const p0 = P(aR, -45), p1 = P(aF, -42);
      svg('path', { class: 'dim-ext', d: new Path().M(p0[0] - 3, p0[1]).L(x - 5, p0[1]).M(p1[0] - 3, p1[1]).L(x - 5, p1[1]).toString() }, g);
      this.dimLine(g, [x, p0[1]], [x, p1[1]], `${Math.round(aF - aR)}`, true);
      const q0 = P(98, 45), q1 = P(98, -45), yd = P(aF + 9, 0)[1];
      svg('path', { class: 'dim-ext', d: new Path().M(q0[0], q0[1] + 3).L(q0[0], yd + 5).M(q1[0], q1[1] + 3).L(q1[0], yd + 5).toString() }, this.dimDia);
      this.dimLine(this.dimDia, [q0[0], yd], [q1[0], yd], 'Ø90');
    }
  }

  /** Dimension line between two points with arrowheads and unidirectional (horizontal) text. */
  dimLine(g, a, b, text, sideText = false) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    svg('path', { class: 'dim-line', d: new Path().M(a[0], a[1]).L(b[0], b[1]).toString() }, g);
    arrowDir(g, a[0], a[1], -ux, -uy);
    arrowDir(g, b[0], b[1], ux, uy);
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const tw = text.length * 7 + 8;
    if (sideText) {
      svg('rect', { class: 'dim-knock', x: mx + 4, y: my - 8, width: tw, height: 15 }, g);
      svg('text', { class: 'dim-text', x: mx + 8, y: my + 4 }, g).textContent = text;
    } else {
      svg('rect', { class: 'dim-knock', x: mx - tw / 2, y: my - 8, width: tw, height: 15 }, g);
      svg('text', { class: 'dim-text', x: mx, y: my + 4, 'text-anchor': 'middle' }, g).textContent = text;
    }
  }

  renderEnd(e) {
    const W = this.EW || 260, H = this.EH || 200;
    const cx = W / 2, cy = H / 2 + 6;
    const se = Math.max(0.5, Math.min((W - 64) / 90, (H - 56) / 90));
    this.endScale = se;
    const E = this.end;
    E.housing.setAttribute('d', new Path().circle(cx, cy, 45 * se).toString());
    const fl = new Path().circle(cx, cy, 42 * se).circle(cx, cy, 6 * se);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      fl.circle(cx + Math.cos(a) * 37 * se, cy + Math.sin(a) * 37 * se, 2.2 * se);
    }
    E.flange.setAttribute('d', fl.toString());
    E.hidden.setAttribute('d', new Path().circle(cx, cy, 35.4 * se).circle(cx, cy, 40.6 * se).toString());
    // the wave generator ellipse turns as the set explodes
    const rot = e * Math.PI, pts = [];
    for (let i = 0; i < 40; i++) {
      const t = (i / 40) * Math.PI * 2, x = 25.2 * Math.cos(t), y = 23.8 * Math.sin(t);
      pts.push([cx + (x * Math.cos(rot) - y * Math.sin(rot)) * se, cy + (x * Math.sin(rot) + y * Math.cos(rot)) * se]);
    }
    E.wg.setAttribute('d', new Path().poly(pts).toString());
    E.bc.setAttribute('d', new Path().circle(cx, cy, 37 * se).toString());
    const ext = 45 * se + 8;
    E.cm.setAttribute('d', new Path().M(cx - ext, cy).L(cx + ext, cy).M(cx, cy - ext).L(cx, cy + ext).toString());
    // cutting plane A-A: vertical through the axis, arrows show the viewing direction
    const yTop = cy - 45 * se - 10, yBot = cy + 45 * se + 10;
    E.cut.setAttribute('d', new Path().M(cx, yTop).L(cx, yBot).toString());
    const ends = new Path().M(cx, yTop - 10).L(cx, yTop + 4).M(cx, yBot - 4).L(cx, yBot + 10)
      .M(cx, yTop - 10).L(cx - 16, yTop - 10).M(cx, yBot + 10).L(cx - 16, yBot + 10);
    E.cutEnds.setAttribute('d', ends.toString());
    const L = E.letters;
    while (L.firstChild) L.removeChild(L.firstChild);
    arrowDir(L, cx - 17, yTop - 10, -1, 0, 7, 2.6, 'ex-cut-arrow');
    arrowDir(L, cx - 17, yBot + 10, -1, 0, 7, 2.6, 'ex-cut-arrow');
    svg('text', { class: 'ex-cut-l', x: cx - 30, y: yTop - 6, 'text-anchor': 'middle' }, L).textContent = 'A';
    svg('text', { class: 'ex-cut-l', x: cx - 30, y: yBot + 14, 'text-anchor': 'middle' }, L).textContent = 'A';
    const D = E.dim;
    while (D.firstChild) D.removeChild(D.firstChild);
    const yd = cy - 45 * se - 2;
    void yd;
    // Ø90 as a diameter callout at 45°
    const ang = -Math.PI / 4;
    const p0 = [cx + Math.cos(ang) * 45 * se, cy + Math.sin(ang) * 45 * se];
    const p1 = [cx - Math.cos(ang) * 45 * se, cy - Math.sin(ang) * 45 * se];
    svg('path', { class: 'dim-line', d: new Path().M(p1[0], p1[1]).L(p0[0], p0[1]).L(p0[0] + 18, p0[1] - 18).L(p0[0] + 34, p0[1] - 18).toString() }, D);
    arrowDir(D, p0[0], p0[1], Math.cos(ang), Math.sin(ang));
    arrowDir(D, p1[0], p1[1], -Math.cos(ang), -Math.sin(ang));
    svg('text', { class: 'dim-text', x: p0[0] + 20, y: p0[1] - 22 }, D).textContent = 'Ø90';
    this.endSnap = [[cx, cy], [cx - 45 * se, cy], [cx + 45 * se, cy], [cx, cy - 45 * se], [cx, cy + 45 * se]];
  }

  /** Snap points in client coordinates, for the measure tool. */
  snapPoints() {
    const out = [];
    const r = this.svg.getBoundingClientRect();
    const kx = r.width / (this.W || 1), ky = r.height / (this.H || 1);
    for (const q of this.snap) out.push([r.left + q[0] * kx, r.top + q[1] * ky, 'section']);
    const re = this.endSvg.getBoundingClientRect();
    const ex = re.width / (this.EW || 1), ey = re.height / (this.EH || 1);
    if (this.endSnap) for (const q of this.endSnap) out.push([re.left + q[0] * ex, re.top + q[1] * ey, 'end']);
    return out;
  }

  /** Which view a client point falls in, and its px-per-mm there. */
  scaleAt(clientX, clientY) {
    const re = this.endSvg.getBoundingClientRect();
    if (clientX >= re.left && clientX <= re.right && clientY >= re.top && clientY <= re.bottom) {
      return { pxPerMm: (this.endScale || 1) * (re.width / (this.EW || re.width || 1)), view: 'VIEW B' };
    }
    const r = this.svg.getBoundingClientRect();
    return { pxPerMm: this.s * (r.width / (this.W || r.width || 1)), view: 'SECTION A–A' };
  }

  state() {
    return {
      e: this.e, pxPerMm: this.s, vertical: this.vertical, sticky: this.sticky, manual: this.manual,
      parts: PARTS.map((p) => ({ id: p.id, item: p.item, delta: +p.d.toFixed(3), finalDelta: p.delta, a0: +(p.a0 + p.d).toFixed(3), a1: +(p.a1 + p.d).toFixed(3) })),
    };
  }
}
