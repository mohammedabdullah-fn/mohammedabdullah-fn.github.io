// Blueprint: wires the drawing set together. Scroll drives the walker and the
// explode; everything else (frames, charts, chains) is laid out per viewport.
import { flags, motion, clamp, lerp, sstep, PX_PER_MM, fmtScale, nanCount, fin } from './util.js';
import { Walker, Q } from './quad.js';
import { Drawer, Frames } from './frames.js';
import { BarChart, Timeline, Milestones, M } from './charts.js';
import { Actuator } from './actuator.js';
import { Measure } from './measure.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const root = document.documentElement;
const strip = $('#strip');
const lane = $('#lane');
const sheets = $$('.sheet');
const stationLinks = $$('.stn');
const isoFig = $('#iso');
const isoBox = $('#iso-box');

root.classList.toggle('motion-ok', motion.ok);
root.classList.add('js');

// ------------------------------------------------------------------ callout
const tipEl = $('#callout');
const tipT = tipEl.querySelector('.co-t'), tipB = tipEl.querySelector('.co-b');
const tipLdr = tipEl.querySelector('.co-ldr path'), tipDot = tipEl.querySelector('.co-ldr circle');
const tip = {
  show(x, y, title, body) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    tipT.textContent = title || '';
    tipB.textContent = body || '';
    tipEl.hidden = false;
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    const left = x + 26 + w > vw - 8;
    const up = y + 24 + h > vh - 8;
    const tx = Math.round(clamp(left ? x - 26 - w : x + 26, 6, Math.max(6, vw - w - 6)));
    const ty = Math.round(clamp(up ? y - 24 - h : y + 24, 6, Math.max(6, vh - h - 6)));
    tipEl.style.transform = `translate(${tx}px, ${ty}px)`;
    // leader from the pointer to the nearest corner of the callout box
    const px = Math.round(x - tx), py = Math.round(y - ty);
    const cx = left ? w : 0, cy = up ? h : 0;
    tipLdr.setAttribute('d', `M${px} ${py}L${cx} ${cy}`);
    tipDot.setAttribute('cx', String(px));
    tipDot.setAttribute('cy', String(py));
  },
  hide() { tipEl.hidden = true; },
};

// -------------------------------------------------------------------- theme
const themeBtn = $('#btn-theme');
const metaTheme = $('meta[name="theme-color"]');
function applyTheme(t) {
  root.dataset.theme = t;
  themeBtn.setAttribute('aria-pressed', String(t === 'whiteprint'));
  if (metaTheme) metaTheme.setAttribute('content', t === 'whiteprint' ? '#f4f2ec' : '#0d2b52');
  try { localStorage.setItem('bp-theme', t); } catch (e) { /* storage unavailable */ }
}
function setTheme(t, animate) {
  if (t !== 'whiteprint' && t !== 'blueprint') return;
  const canAnimate = animate && motion.ok && document.startViewTransition && document.visibilityState === 'visible';
  if (canAnimate) {
    try { document.startViewTransition(() => applyTheme(t)); return; } catch (e) { /* fall through */ }
  }
  applyTheme(t);
}
applyTheme(root.dataset.theme === 'whiteprint' ? 'whiteprint' : 'blueprint');
themeBtn.addEventListener('click', () => setTheme(root.dataset.theme === 'whiteprint' ? 'blueprint' : 'whiteprint', true));

// -------------------------------------------------------------- components
const drawer = new Drawer();
const walker = new Walker({ laneSvg: $('#lane-svg'), isoSvg: $('#iso-svg'), isoCap: $('#iso-cap'), dro: $('#dro') });
walker.s.reduced = !motion.ok;

const tbScale4 = $('#sheet-4 [data-tb="scale"]');
let lastScaleTxt = '';
const act = new Actuator($('#ex'), {
  tip,
  onScale(s) {
    const t = fmtScale(s);
    if (t !== lastScaleTxt && tbScale4) { tbScale4.textContent = t; lastScaleTxt = t; }
  },
});
act.onRelink = () => updateScroll();
if (!motion.ok) { act.manual = true; act.updateMode(); act.e = 1; }
else act.updateMode();

const frames = new Frames(sheets, drawer);

const charts = [
  new BarChart($('#ch-models'), {
    aria: 'Test accuracy by model with full sensor fusion: SVM 87.3 percent, random forest 84.8 percent, 1D-CNN 82.5 percent.',
    max: 100, step: 20, unit: '%',
    data: [
      { label: 'SVM (RBF)', value: 87.3, emph: true, tip: 'SVM, RBF kernel, engineered features' },
      { label: 'Random forest', value: 84.8, tip: 'Random forest, 100 trees' },
      { label: '1D-CNN (raw)', value: 82.5, tip: '1D-CNN on the raw signal' },
    ],
  }, drawer, tip),
  new BarChart($('#ch-class'), {
    aria: 'Per-class accuracy of the best model: grass 99.4 percent, carpet 97.2 percent, tile 79.2 percent, hardwood 72.3 percent.',
    max: 100, step: 20, unit: '%',
    data: [
      { label: 'Grass', value: 99.4, tip: 'Grass' },
      { label: 'Carpet', value: 97.2, tip: 'Carpet' },
      { label: 'Tile', value: 79.2, tip: 'Tile: 18.1% read as hardwood' },
      { label: 'Hardwood', value: 72.3, tip: 'Hardwood: 25.7% read as tile' },
    ],
  }, drawer, tip),
];

const timeline = new Timeline($('#tl'), {
  aria: 'Dimension chain from June 2023 to May 2028. Bosch, graduate engineer, July 2023 to May 2025, 23 months. Minar Industries, design engineer, June to October 2025, 5 months. 28 months in industry. Terrain perception project January to April 2026. CSWP and CSWA April 2026. ME 5374 actuator, fall 2026. M.S. expected May 2028.',
  start: M(2023, 4), end: M(2028, 8),
  chain: [
    { a: M(2023, 7), b: M(2025, 6), label: 'BOSCH', role: 'GRADUATE ENGINEER', dates: 'JUL 2023 – MAY 2025' },
    { a: M(2025, 6), b: M(2025, 11), label: 'MINAR', role: 'DESIGN ENGINEER', dates: 'JUN – OCT 2025' },
  ],
  ref: { a: M(2023, 7), b: M(2025, 11), label: 'IN INDUSTRY · REF' },
  spans: [
    { a: M(2026, 1), b: M(2026, 5), value: '4 MO', label: 'TERRAIN PROJECT', dates: 'EECE 5554 · JAN – APR 2026' },
    { a: M(2026, 9), b: M(2027, 1), value: 'FALL', label: 'ME 5374 · ELBOW ACTUATOR', dates: 'ROBOT DESIGN · FALL 2026' },
  ],
  points: [
    { at: M(2023, 6) + 0.5, label: 'B.E. MECHANICAL · VTU', sub: 'JUN 2023', datum: 'A' },
    { at: M(2024, 4) + 0.5, label: 'CNC MACHINING TRAINING', sub: 'KGTTI · APR 2024' },
    { at: M(2026, 1) + 0.2, label: 'ASME · NUHOC MEMBER', sub: 'NORTHEASTERN · JAN 2026' },
    { at: M(2026, 4) + 0.5, label: 'CSWP + CSWA', sub: 'DASSAULT SYSTÈMES · APR 2026' },
    { at: M(2028, 5) + 0.5, label: 'M.S. MRA · NORTHEASTERN', sub: 'EXPECTED MAY 2028', open: true },
  ],
}, drawer);

const milestones = new Milestones($('#ms'), [
  { date: '2026-11-15', label: 'M1', day: 'NOV 15' },
  { date: '2026-11-29', label: 'M2', day: 'NOV 29' },
  { date: '2026-12-07', label: 'M3', day: 'DEC 7' },
  { date: '2026-12-10', label: 'M4', day: 'DEC 10' },
], drawer);

// milestone list status follows the visitor's date
{
  const today = Date.now();
  $$('.ms-list li[data-date]').forEach((li) => {
    const t = new Date(`${li.dataset.date}T23:59:59`).getTime();
    li.classList.toggle('is-done', Number.isFinite(t) && today > t);
  });
}

// pipeline + other HTML drawings that plot in with CSS
$$('[data-plot]').forEach((el) => drawer.register(el, el, { stagger: 0 }));

const measure = new Measure({
  button: $('#btn-measure'),
  hud: $('#mhud'),
  sheets,
  scaleFor(sheet, cx, cy) {
    if (sheet.id === 'sheet-4') {
      const r = act.scaleAt(cx, cy);
      return { pxPerMm: r.pxPerMm, label: `${r.view} · SCALE ${fmtScale(r.pxPerMm)}` };
    }
    return { pxPerMm: PX_PER_MM, label: 'SCALE 1:1' };
  },
  snapFor(sheet) {
    const r = sheet.getBoundingClientRect();
    const pts = frames.snapPoints(sheet).map(([x, y]) => [r.left + x, r.top + y]);
    if (sheet.id === 'sheet-4') for (const p of act.snapPoints()) pts.push(p);
    return pts;
  },
  zoneAt: (sheet, x, y) => frames.zoneAt(sheet, x, y),
  onToggle(on) { if (on) tip.hide(); },
});

// ---------------------------------------------------------------- title blocks
const mod = new Date(document.lastModified);
if (!Number.isNaN(mod.getTime())) {
  const ds = `${mod.getFullYear()}-${String(mod.getMonth() + 1).padStart(2, '0')}-${String(mod.getDate()).padStart(2, '0')}`;
  $$('[data-tb="date"]').forEach((el) => { el.textContent = ds; });
}

// ------------------------------------------------------------------ layout
const L = { headerH: 0, anchors: [0, 0, 0, 0, 0], maxScroll: 1, vh: 800, active: -1, ready: false };
const stickyMQ = window.matchMedia('(min-width: 900px) and (min-height: 600px)');

function stickyAllowed() { return motion.ok && stickyMQ.matches; }

function layout() {
  L.vh = window.innerHeight || 800;
  root.classList.toggle('ex-sticky', stickyAllowed());
  L.headerH = strip.offsetHeight;
  root.style.setProperty('--strip-h', `${L.headerH}px`);

  const isoOn = isoFig && getComputedStyle(isoFig).display !== 'none';
  const lr = lane.getBoundingClientRect(), ir = isoBox.getBoundingClientRect();
  walker.layout(lr.width, lr.height, isoOn ? { w: ir.width, h: ir.height } : null);
  stationLinks.forEach((a, i) => { a.style.left = `${walker.stationsPx[i].toFixed(1)}px`; });

  charts.forEach((c) => c.render());
  timeline.render();
  milestones.render();
  act.layout(stickyAllowed());
  frames.render();
  measure.layout();

  L.maxScroll = Math.max(1, root.scrollHeight - L.vh);
  const sy = window.scrollY;
  L.anchors = sheets.map((s) => s.getBoundingClientRect().top + sy - L.headerH);
  for (let i = 0; i < L.anchors.length; i++) {
    L.anchors[i] = clamp(L.anchors[i], 0, L.maxScroll);
    if (i > 0 && L.anchors[i] <= L.anchors[i - 1]) L.anchors[i] = L.anchors[i - 1] + 1;
  }
  act.measureTrack();
  L.ready = true;
  updateScroll(true);
  walker.render();   // draw now; do not wait for the first animation frame
}

/** Scroll position -> walker target (mm). The robot dwells at a station while
 *  its sheet is being read, then walks to the next one, arriving as that sheet
 *  reaches the strip. */
function targetForScroll(y) {
  const A = L.anchors, st = walker.stations;
  if (y <= A[0]) return st[0];
  for (let i = 0; i < A.length - 1; i++) {
    if (y < A[i + 1]) {
      const u = (y - A[i]) / Math.max(1, A[i + 1] - A[i]);
      return lerp(st[i], st[i + 1], sstep(0.4, 1, u));
    }
  }
  return st[st.length - 1];
}

function activeIndex(y) {
  if (y >= L.maxScroll - 2) return sheets.length - 1;
  const line = y + (L.vh - L.headerH) * 0.35;
  let ai = 0;
  L.anchors.forEach((a, i) => { if (a <= line) ai = i; });
  return ai;
}

const nowSheet = $('#now-sheet'), nowTitle = $('#now-title');
function updateScroll(initial = false) {
  if (!L.ready) return;
  const y = window.scrollY;
  const ai = activeIndex(y);
  if (ai !== L.active) {
    L.active = ai;
    nowSheet.textContent = `SHEET ${ai + 1} OF ${sheets.length}`;
    nowTitle.textContent = sheets[ai].dataset.title || '';
    stationLinks.forEach((a, i) => (i === ai ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
  }
  if (walker.s.reduced) {
    walker.setTarget(walker.stations[ai], walker.s.t);
    walker.step(1 / 60);
    walker.render();
  } else {
    const tgt = targetForScroll(y);
    if (initial && !walker.s.placed) walker.place(tgt);
    walker.setTarget(tgt, walker.s.t);
    kick();
  }
  act.setFromScroll(act.progressFor(y, L.headerH, L.vh));
  drawer.check(L.headerH);
}

// -------------------------------------------------------------------- loop
let raf = 0, lastT = 0, paused = false;
function frame(t) {
  raf = 0;
  const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 1 / 60;
  lastT = t;
  if (paused) return;
  walker.step(dt);
  walker.render();
  if (laneHot && lastPointer) showLaneTip(lastPointer);
  // keep animating while walking or idling; rest after a long idle, head neutral
  const s = walker.s;
  const resting = s.idleT > 30 && Math.abs(s.yaw) < 0.004 && Math.abs(s.tilt) < 0.004;
  if (motion.ok && !resting) raf = requestAnimationFrame(frame);
}
function kick() {
  if (raf || !motion.ok) return;
  lastT = 0;
  raf = requestAnimationFrame(frame);
}

walker.onArrive = (i) => {
  if (!L.ready || i !== L.active) return;
  frames.flash(sheets[i]);
};

// ------------------------------------------------------------ lane hover
let laneHot = null, lastPointer = null;
function setLaneHot(part) {
  if (part === laneHot) return;
  laneHot = part;
  lane.querySelectorAll('.is-hot').forEach((el) => el.classList.remove('is-hot'));
  if (part) lane.querySelectorAll(`[data-part="${part}"]`).forEach((el) => el.classList.add('is-hot'));
}
function showLaneTip(ev) {
  const d = laneHot ? walker.describe(laneHot) : null;
  if (d) tip.show(ev.clientX, ev.clientY, d.title, d.body); else tip.hide();
}
lane.addEventListener('pointermove', (ev) => {
  const t = ev.target.closest ? ev.target.closest('[data-part]') : null;
  lastPointer = { clientX: ev.clientX, clientY: ev.clientY };
  setLaneHot(t ? t.dataset.part : null);
  showLaneTip(lastPointer);
  kick();
});
lane.addEventListener('pointerleave', () => { setLaneHot(null); lastPointer = null; tip.hide(); });

// ------------------------------------------------------------------ events
let scrollQueued = false;
window.addEventListener('scroll', () => {
  if (scrollQueued) return;
  scrollQueued = true;
  requestAnimationFrame(() => { scrollQueued = false; updateScroll(); });
  // also handle it now when frames are not being produced (background tabs)
  if (document.visibilityState !== 'visible') { scrollQueued = false; updateScroll(); }
}, { passive: true });

let resizeT = 0;
function queueLayout() {
  clearTimeout(resizeT);
  resizeT = setTimeout(layout, 80);
}
window.addEventListener('resize', queueLayout);
if (window.ResizeObserver) {
  let lastH = 0, lastW = 0;
  new ResizeObserver(() => {
    const h = root.scrollHeight, w = root.clientWidth;
    if (Math.abs(h - lastH) > 2 || w !== lastW) { lastH = h; lastW = w; queueLayout(); }
  }).observe($('#set'));
}
motion.onChange(() => {
  root.classList.toggle('motion-ok', motion.ok);
  walker.s.reduced = !motion.ok;
  if (!motion.ok) { drawer.disable(); act.manual = true; act.updateMode(); }
  layout();
});
stickyMQ.addEventListener && stickyMQ.addEventListener('change', queueLayout);

// station links: honour reduced motion for the jump
stationLinks.forEach((a) => a.addEventListener('click', (ev) => {
  const target = document.querySelector(a.getAttribute('href'));
  if (!target) return;
  ev.preventDefault();
  target.scrollIntoView({ behavior: motion.ok ? 'smooth' : 'auto', block: 'start' });
  history.replaceState(null, '', a.getAttribute('href'));
}));

// first layout, then again once the fonts are in (text metrics change)
layout();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => layout());
window.addEventListener('load', () => layout());

// -------------------------------------------------------------- debug hooks
if (flags.debug) {
  const state = () => {
    const s = walker.s;
    const st = walker.stationIndex();
    return {
      scrollY: window.scrollY, maxScroll: L.maxScroll, anchors: L.anchors.map((v) => Math.round(v)),
      activeSheet: L.active + 1, reduced: s.reduced,
      x: +s.x.toFixed(3), target: +s.target.toFixed(3), rawTarget: +s.rawTarget.toFixed(3), v: +s.v.toFixed(3),
      stations: walker.stations.map((v) => +v.toFixed(3)), nearestStation: st.i + 1, stationDistMm: +st.d.toFixed(3),
      phase: +(((walker.pose.phi % 1) + 1) % 1).toFixed(4), cycleMm: +walker.gait.D.toFixed(3), pxPerMm: +walker.k.toFixed(5),
      idleT: +s.idleT.toFixed(3), headYawDeg: +(s.yaw * 57.2958).toFixed(2), settleMm: +s.settle.toFixed(3),
      feet: walker.legs.map((l) => ({ id: l.id, stance: l.tgt.stance, x: +l.foot.x.toFixed(3), y: +l.foot.y.toFixed(3) })),
      stats: { ...walker.stats }, nan: nanCount(),
    };
  };
  window.__bp = {
    walker, act, measure, drawer, frames, Q, L,
    state,
    layout,
    setProgress(p) {
      const y = clamp(fin(p, 0), 0, 1) * L.maxScroll;
      window.scrollTo({ top: y, behavior: 'instant' });
      updateScroll();
      return state();
    },
    scrollToSheet(i, frac = 0) {
      const a = L.anchors[i - 1] ?? 0, b = L.anchors[i] ?? L.maxScroll;
      window.scrollTo({ top: lerp(a, b, frac), behavior: 'instant' });
      updateScroll();
      return state();
    },
    tick(frames = 1, dt = 1 / 60) {
      for (let i = 0; i < frames; i++) walker.step(dt);
      walker.render();
      return state();
    },
    /** Walk between two positions and report what the drawing did. */
    gaitTest({ from = walker.stations[0], to = walker.stations[4], frames = 1200, dt = 1 / 60, jitter = 0 } = {}) {
      walker.place(from);
      walker.resetStats();
      let t = from;
      walker.setTarget(to, walker.s.t);
      for (let i = 0; i < frames; i++) {
        if (jitter && i % jitter === 0) {
          t = lerp(walker.stations[0], walker.stations[4], Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1);
          walker.setTarget(t, walker.s.t);
        }
        walker.step(dt);
      }
      walker.render();
      return { ...walker.stats, x: +walker.s.x.toFixed(3), target: +walker.s.target.toFixed(3), allStance: walker.legs.every((l) => l.tgt.stance) };
    },
    setExplode(e) { act.manual = true; act.updateMode(); act.set(e); return act.state(); },
    relinkExplode() { act.manual = false; act.updateMode(); updateScroll(); return act.state(); },
    theme(t) { if (t) setTheme(t, false); return root.dataset.theme; },
    measureAt(p1, p2, shift = false) {
      if (!measure.active) measure.toggle(true);
      measure.pick(p1[0], p1[1], false);
      return measure.pick(p2[0], p2[1], shift);
    },
    drawAll() { drawer.finishAll(); },
    /** Freeze the real animation loop so tick() fully controls the walker. */
    pause(on = true) { paused = !!on; if (!on) kick(); return paused; },
    /** Magnified clone of part of an element, for close visual checks. */
    inspect(sel, x, y, w, h, scale = 4) {
      document.getElementById('bp-inspect')?.remove();
      if (!sel) return null;
      const src = document.querySelector(sel);
      const r = src.getBoundingClientRect();
      const c = src.cloneNode(true);
      c.removeAttribute('id');
      c.style.cssText = `position:absolute;left:${-x}px;top:${-y}px;width:${r.width}px;height:${r.height}px;`;
      const box = document.createElement('div');
      box.id = 'bp-inspect';
      box.style.cssText = `position:fixed;left:0;top:0;z-index:9999;width:${w}px;height:${h}px;overflow:hidden;transform-origin:0 0;transform:scale(${scale});background:var(--strip-bg);outline:1px solid red`;
      box.appendChild(c);
      document.body.appendChild(box);
      return [r.width, r.height];
    },
    nan: nanCount,
  };
}
