// Shared helpers: SVG creation with NaN guards, easing, environment flags.

export const NS = 'http://www.w3.org/2000/svg';

const query = new URLSearchParams(location.search);
export const flags = {
  debug: query.has('debug'),
  forceMotion: query.has('motion'),
};

const reduceMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

// Motion is allowed unless the OS asks for reduced motion; ?motion overrides for testing.
export const motion = {
  get ok() { return flags.forceMotion || !(reduceMQ && reduceMQ.matches); },
  onChange(fn) {
    if (!reduceMQ) return;
    if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', fn);
    else if (reduceMQ.addListener) reduceMQ.addListener(fn);
  },
};

// ---- NaN-safe numbers --------------------------------------------------
let nanHits = 0;
export function nanCount() { return nanHits; }

/** Format a number for an SVG attribute. Non-finite values become 0 (and are counted). */
export function n(v, digits = 2) {
  if (typeof v !== 'number' || !Number.isFinite(v)) { nanHits++; return '0'; }
  const p = 10 ** digits;
  const r = Math.round(v * p) / p;
  return String(r === 0 ? 0 : r);
}

/** Return v if finite, otherwise the fallback. */
export function fin(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function setAttrs(el, attrs) {
  for (const k in attrs) {
    let v = attrs[k];
    if (v === null || v === undefined) { el.removeAttribute(k); continue; }
    if (typeof v === 'number') v = n(v);
    el.setAttribute(k, v);
  }
  return el;
}

export function svg(tag, attrs, parent) {
  const el = document.createElementNS(NS, tag);
  if (attrs) setAttrs(el, attrs);
  if (parent) parent.appendChild(el);
  return el;
}

export function html(tag, attrs, parent, text) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') el.className = attrs[k];
    else el.setAttribute(k, attrs[k]);
  }
  if (text !== undefined) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
}

// ---- Path builder (all numbers pass through n()) ------------------------
export class Path {
  constructor() { this.d = ''; }
  M(x, y) { this.d += `M${n(x)} ${n(y)}`; return this; }
  L(x, y) { this.d += `L${n(x)} ${n(y)}`; return this; }
  A(rx, ry, rot, large, sweep, x, y) {
    this.d += `A${n(Math.abs(rx))} ${n(Math.abs(ry))} ${n(rot)} ${large ? 1 : 0} ${sweep ? 1 : 0} ${n(x)} ${n(y)}`;
    return this;
  }
  Q(cx, cy, x, y) { this.d += `Q${n(cx)} ${n(cy)} ${n(x)} ${n(y)}`; return this; }
  Z() { this.d += 'Z'; return this; }
  poly(pts, close = true) {
    pts.forEach((p, i) => (i ? this.L(p[0], p[1]) : this.M(p[0], p[1])));
    if (close) this.Z();
    return this;
  }
  circle(cx, cy, r) {
    r = Math.max(0, fin(r));
    return this.M(cx - r, cy).A(r, r, 0, 1, 0, cx + r, cy).A(r, r, 0, 1, 0, cx - r, cy).Z();
  }
  toString() { return this.d; }
}

// ---- Math --------------------------------------------------------------
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const sstep = (a, b, x) => smooth(clamp((x - a) / (b - a), 0, 1));
export const minjerk = (t) => t * t * t * (10 + t * (-15 + 6 * t));
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const DEG = Math.PI / 180;

/** CSS pixels per millimetre at the reference 96 dpi. */
export const PX_PER_MM = 96 / 25.4;

/** Format a ratio like 2.43 as "2.4:1" or 0.25 as "1:4". */
export function fmtScale(pxPerMm) {
  const r = fin(pxPerMm, PX_PER_MM) / PX_PER_MM; // drawing mm per model mm
  if (Math.abs(r - 1) < 0.005) return '1:1';
  if (r >= 1) return `${trimNum(r)}:1`;
  return `1:${trimNum(1 / r)}`;
}
function trimNum(v) {
  return v >= 10 ? v.toFixed(0) : v.toFixed(v >= 3 ? 1 : 2).replace(/\.?0+$/, '');
}

/** Element rectangle relative to an ancestor's rectangle. */
export function relRect(el, ancestor) {
  const a = ancestor.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left - a.left, y: r.top - a.top, w: r.width, h: r.height, r: r.right - a.left, b: r.bottom - a.top };
}

/** Run fn on the next animation frame, at most once per frame. */
export function rafThrottle(fn) {
  let queued = false;
  return (...args) => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(...args); });
  };
}
