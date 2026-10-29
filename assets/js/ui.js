/* UI layer: boot screen, section sheets, cards and quick-link dock, toasts, demo status,
   the haptic demo and small text effects. No three.js here, so the content still works
   when WebGL is unavailable. */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

document.documentElement.classList.add('js');

export const bus = new EventTarget();
const emit = (type, detail, cancelable = false) => bus.dispatchEvent(new CustomEvent(type, { detail, cancelable }));
export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const coarse = matchMedia('(pointer: coarse)').matches;

export const SHEETS = ['about', 'projects', 'experience', 'now', 'resume'];
export const LINKS = {
  linkedin: { href: 'https://www.linkedin.com/in/abd-mohdd', label: 'LinkedIn' },
  github: { href: 'https://github.com/mohammedabdullah-fn', label: 'GitHub' },
  email: { href: 'mailto:mohammedabdullah.fn@northeastern.edu', label: 'Email' },
};
const pad2 = (n) => String(n).padStart(2, '0');

/* ---------- text decode effect ---------- */
const GLYPHS = '▚▞▖▗▘▝<>/\\|=+*#%01';
export function scramble(el, dur = 420) {
  if (!el || reducedMotion) return;
  const final = el.dataset.text ?? (el.dataset.text = el.textContent);
  const start = performance.now();
  cancelAnimationFrame(el._scr);
  const tick = (now) => {
    const p = Math.min(1, (now - start) / dur);
    const n = Math.floor(final.length * p);
    let out = final.slice(0, n);
    for (let i = n; i < final.length; i++) out += final[i] === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0];
    el.textContent = out;
    if (p < 1) el._scr = requestAnimationFrame(tick);
  };
  el._scr = requestAnimationFrame(tick);
}

/* ---------- boot ---------- */
let bootResolve;
export const bootDone = new Promise((r) => (bootResolve = r));

function finishBoot() {
  document.body.classList.remove('is-booting');
  document.body.classList.add('ready');
  bootResolve();
}

function runBoot() {
  const boot = $('#boot');
  let seen = false;
  try {
    seen = sessionStorage.getItem('ma-boot') === '1';
    sessionStorage.setItem('ma-boot', '1');
  } catch { /* storage blocked: just play the boot */ }
  if (!boot || seen) { boot?.remove(); finishBoot(); return; }
  const lines = $$('.boot-line', boot);
  const step = 260;
  const total = 200 + lines.length * step + 420;
  boot.style.setProperty('--boot-dur', `${total}ms`);
  boot.classList.add('run');
  lines.forEach((l, i) => setTimeout(() => l.classList.add('on'), 200 + i * step));
  setTimeout(() => {
    boot.classList.add('done');
    finishBoot();
    setTimeout(() => boot.remove(), 800);
  }, total);
}

/* ---------- section sheets ---------- */
const modal = $('#modal');
const panel = $('.modal-panel', modal);
const scroller = $('#modal-scroll');
let current = -1;
let returnFocus = null;

export const isModalOpen = () => current >= 0;

export function openSection(id) {
  const idx = SHEETS.indexOf(id);
  if (idx < 0) return;
  if (current < 0) returnFocus = document.activeElement;
  current = idx;
  for (const s of $$('.sheet', modal)) s.classList.toggle('is-active', s.id === id);
  const sheet = $(`#${id}`);
  const kicker = $('#modal-kicker');
  kicker.textContent = sheet.dataset.kicker;
  delete kicker.dataset.text;
  scramble(kicker);
  $('#modal-count').textContent = `${pad2(idx + 1)} / ${pad2(SHEETS.length)}`;
  $('#modal-prev span').textContent = $(`#${SHEETS[(idx + SHEETS.length - 1) % SHEETS.length]}`).dataset.kicker;
  $('#modal-next span').textContent = $(`#${SHEETS[(idx + 1) % SHEETS.length]}`).dataset.kicker;
  panel.setAttribute('aria-labelledby', `${id}-title`);
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  scroller.scrollTop = 0;
  if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
  for (const el of $$('.bars, .cm', sheet)) {
    el.classList.remove('play');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('play')));
  }
  if (id === 'resume') {
    const f = $('#resume-frame');
    if (f && !f.getAttribute('src')) f.setAttribute('src', f.dataset.src);
  }
  $('.modal-close', modal).focus({ preventScroll: true });
  emit('section', id);
}

export function closeSection() {
  if (current < 0) return;
  current = -1;
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  history.replaceState(null, '', location.pathname + location.search);
  if (returnFocus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
  emit('section', null);
}

const step = (d) => openSection(SHEETS[(current + d + SHEETS.length) % SHEETS.length]);
$('#modal-prev').addEventListener('click', () => step(-1));
$('#modal-next').addEventListener('click', () => step(1));

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) { closeSection(); return; }

  const holoBtn = e.target.closest('[data-holo]');
  if (holoBtn) { closeSection(); emit('holo', holoBtn.dataset.holo); return; }

  const a = e.target.closest('a[href^="#"]');
  if (a) {
    const id = a.getAttribute('href').slice(1);
    if (!SHEETS.includes(id)) return;
    e.preventDefault();
    if (!a.closest('.modal') && e.detail > 0) {
      // a pointer click on the page: the robot reaches over and presses it first
      const host = a.closest('[data-touch]') ?? a;
      const r = host.getBoundingClientRect();
      if (!emit('touch-request', { id, x: r.left + r.width / 2, y: r.top + r.height / 2 }, true)) return;
    }
    openSection(id);
    return;
  }

  const ext = e.target.closest('.dock-item[data-link]');
  if (ext) {
    const r = ext.getBoundingClientRect();
    emit('touch-show', { id: ext.dataset.touch, x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }
});

document.addEventListener('keydown', (e) => {
  if (current < 0) return;
  if (e.key === 'Escape') { e.preventDefault(); closeSection(); return; }
  const typing = e.target.closest('input, textarea, select');
  if (!typing && e.key === 'ArrowRight') step(1);
  if (!typing && e.key === 'ArrowLeft') step(-1);
  if (e.key === 'Tab') {
    const focusables = $$('a[href], button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])', panel).filter((el) => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

addEventListener('hashchange', () => {
  const id = location.hash.slice(1);
  if (SHEETS.includes(id)) openSection(id);
});

/* ---------- cards + dock: things the robot can touch ---------- */
const touchEls = $$('[data-touch]').map((el) => ({ id: el.dataset.touch, el }));
export const touchTargets = () => touchEls;

for (const { id, el } of touchEls) {
  el.addEventListener('pointerenter', () => {
    emit('card-hover', id);
    scramble(el.querySelector('.card-kicker, .dock-label'), 360);
  });
  el.addEventListener('pointerleave', () => emit('card-hover', null));
}

export function setContact(id) {
  for (const t of touchEls) t.el.classList.toggle('contact', t.id === id);
}

export function pulse(id) {
  const t = touchEls.find((x) => x.id === id);
  if (!t) return;
  t.el.classList.remove('pressed');
  void t.el.offsetWidth;
  t.el.classList.add('pressed');
  setTimeout(() => t.el.classList.remove('pressed'), 700);
}

/* ---------- toast ---------- */
const toastEl = $('#toast');
let toastTimer = 0;
export function toast(text, { tone = 'cyan', ms = 2600, href = null, label = null } = {}) {
  toastEl.replaceChildren(document.createTextNode(text));
  toastEl.dataset.tone = tone;
  toastEl.classList.toggle('has-link', !!href);
  if (href) {
    const a = document.createElement('a');
    a.href = href;
    if (!href.startsWith('mailto:')) { a.target = '_blank'; a.rel = 'noopener'; }
    a.textContent = label ?? 'Open ↗';
    toastEl.append(' ', a);
  }
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), href ? Math.max(ms, 5000) : ms);
}

/* ---------- demo status: a robot-program listing with the active line highlighted ---------- */
const demoEl = $('#demo-status');
const codeEl = $('#demo-code');
let codeKey = '';
export function demoStatus(on, info = {}) {
  demoEl.classList.toggle('on', on);
  if (!on) return;
  $('#demo-label').textContent = info.label ?? '';
  $('#demo-step').textContent = `Step ${info.step ?? 0} / ${info.total ?? 0}`;
  demoEl.style.setProperty('--prog', `${((info.progress ?? 0) * 100).toFixed(1)}%`);
  const lines = info.lines ?? [];
  const key = lines.join('|');
  if (key !== codeKey) {
    codeKey = key;
    codeEl.replaceChildren(...lines.map((l, i) => {
      const li = document.createElement('li');
      li.textContent = l;
      li.dataset.n = String((i + 1) * 10).padStart(3, '0');
      return li;
    }));
  }
  const items = codeEl.children;
  const cur = info.line ?? -1;
  for (let i = 0; i < items.length; i++) {
    items[i].classList.toggle('cur', i === cur);
    items[i].classList.toggle('done', i < cur);
    items[i].hidden = i < cur - 2 || i > cur + 3;
  }
}

/* ---------- milestones: mark what's done and what's next ---------- */
function markMilestones() {
  const now = new Date();
  let next = false;
  for (const li of $$('#milestones li')) {
    const d = new Date(`${li.dataset.date}T23:59:59`);
    if (d < now) li.classList.add('done');
    else if (!next) { li.classList.add('next'); next = true; }
  }
}

/* ---------- "Feel the terrain": the project's terrain-to-haptic mapping ---------- */
const T2H = {
  tile: { amp: 0.35, pattern: 'continuous', left: 0.2, right: 0.35, hz: 190 },
  hardwood: { amp: 0.25, pattern: 'continuous', left: 0.12, right: 0.25, hz: 140 },
  carpet: { amp: 0.12, pattern: 'slow pulse', left: 0.05, right: 0.12, hz: 80, pulse: [300, 300] },
  grass: { amp: 0.1, pattern: 'fast pulse', left: 0.03, right: 0.1, hz: 120, pulse: [70, 110] },
};
const PLAY_MS = 1600;
let hctx = null;
let scopeRaf = 0;

function rumbleGamepad(cfg) {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const pad = pads.find((p) => p.vibrationActuator);
  if (!pad) return false;
  const strong = Math.min(1, cfg.left * 2);
  const weak = Math.min(1, cfg.right * 2);
  const act = pad.vibrationActuator;
  if (!cfg.pulse) act.playEffect('dual-rumble', { duration: PLAY_MS, strongMagnitude: strong, weakMagnitude: weak });
  else {
    const [on, off] = cfg.pulse;
    for (let t = 0; t < PLAY_MS; t += on + off) setTimeout(() => act.playEffect('dual-rumble', { duration: on, strongMagnitude: strong, weakMagnitude: weak }), t);
  }
  return true;
}

function vibratePhone(cfg) {
  if (!coarse || !navigator.vibrate) return false;
  if (!cfg.pulse) return navigator.vibrate(PLAY_MS);
  const pattern = [];
  for (let t = 0; t < PLAY_MS; t += cfg.pulse[0] + cfg.pulse[1]) pattern.push(...cfg.pulse);
  return navigator.vibrate(pattern);
}

function playHapticAudio(cfg) {
  try { hctx ??= new (window.AudioContext || window.webkitAudioContext)(); } catch { return false; }
  if (hctx.state === 'suspended') hctx.resume();
  const t0 = hctx.currentTime + 0.02;
  const dur = PLAY_MS / 1000;
  const out = hctx.createGain();
  out.gain.value = 0;
  out.connect(hctx.destination);
  const mix = hctx.createGain();
  mix.connect(out);
  const osc = hctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = cfg.hz;
  const sub = hctx.createOscillator();
  sub.type = 'triangle';
  sub.frequency.value = cfg.hz / 2;
  osc.connect(mix);
  sub.connect(mix);
  const vol = 0.1 + cfg.amp * 0.55;
  const g = out.gain;
  if (!cfg.pulse) {
    g.setValueAtTime(0, t0);
    g.linearRampToValueAtTime(vol, t0 + 0.04);
    g.setValueAtTime(vol, t0 + dur - 0.08);
    g.linearRampToValueAtTime(0, t0 + dur);
  } else {
    const [on, off] = cfg.pulse.map((v) => v / 1000);
    for (let t = 0; t < dur; t += on + off) {
      g.setValueAtTime(0, t0 + t);
      g.linearRampToValueAtTime(vol, t0 + t + Math.min(0.02, on / 3));
      g.setValueAtTime(vol, t0 + t + on - 0.015);
      g.linearRampToValueAtTime(0, t0 + t + on);
    }
  }
  osc.start(t0);
  sub.start(t0);
  osc.stop(t0 + dur + 0.05);
  sub.stop(t0 + dur + 0.05);
  return true;
}

function runScope(cfg) {
  const c = $('#haptic-scope');
  if (!c) return;
  const ctx = c.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const W = (c.width = Math.round(c.clientWidth * dpr));
  const H = (c.height = Math.round(c.clientHeight * dpr));
  const start = performance.now();
  cancelAnimationFrame(scopeRaf);
  const frame = (now) => {
    const t = (now - start) / 1000;
    const fade = t < PLAY_MS / 1000 ? 1 : Math.max(0, 1 - (t - PLAY_MS / 1000) / 0.4);
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(99,227,255,0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 32 * dpr) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
    ctx.strokeStyle = '#63e3ff';
    ctx.shadowColor = '#63e3ff';
    ctx.shadowBlur = 10 * dpr;
    ctx.lineWidth = 1.6 * dpr;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 2) {
      const ph = (x / W) * 0.5 + t;
      let env = 1;
      if (cfg.pulse) {
        const [on, off] = cfg.pulse;
        const m = (ph * 1000) % (on + off);
        env = m < on ? Math.sin((m / on) * Math.PI) : 0;
      }
      const y = H / 2 + Math.sin(ph * Math.PI * 2 * (cfg.hz / 12)) * cfg.amp * env * fade * H * 1.15;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    if (fade > 0) scopeRaf = requestAnimationFrame(frame);
  };
  scopeRaf = requestAnimationFrame(frame);
}

for (const btn of $$('.surface')) {
  btn.addEventListener('click', () => {
    const key = btn.dataset.surface;
    const cfg = T2H[key];
    for (const b of $$('.surface')) {
      b.classList.toggle('on', b === btn);
      b.setAttribute('aria-pressed', String(b === btn));
    }
    const via = [];
    if (rumbleGamepad(cfg)) via.push('gamepad');
    if (vibratePhone(cfg)) via.push('phone');
    if (!via.length && playHapticAudio(cfg)) via.push('audio');
    $('#haptic-readout').textContent = `${key} · amp ${cfg.amp.toFixed(2)} · ${cfg.pattern} · L ${cfg.left.toFixed(2)} / R ${cfg.right.toFixed(2)} · via ${via.join(' + ') || 'visual only'}`;
    runScope(cfg);
  });
}

/* ---------- drawing-sheet border with zone references (1–8 across, A–D down) ---------- */
function buildSheetFrame() {
  const f = $('#sheet-frame');
  if (!f) return;
  const add = (cls, style, text) => {
    const el = document.createElement(text ? 'span' : 'i');
    el.className = cls;
    el.style.cssText = style;
    if (text) el.textContent = text;
    f.append(el);
  };
  for (let i = 0; i < 8; i++) {
    const x = ((i + 0.5) / 8) * 100;
    add('', `left:${x}%;top:7px`, String(8 - i));
    add('', `left:${x}%;top:calc(100% - 7px)`, String(8 - i));
    if (i) {
      add('', `left:${(i / 8) * 100}%;top:0;width:1px;height:14px`);
      add('', `left:${(i / 8) * 100}%;bottom:0;width:1px;height:14px`);
    }
  }
  'DCBA'.split('').forEach((c, k) => {
    const y = ((k + 0.5) / 4) * 100;
    add('', `left:7px;top:${y}%`, c);
    add('', `left:calc(100% - 7px);top:${y}%`, c);
    if (k) {
      add('', `top:${(k / 4) * 100}%;left:0;width:14px;height:1px`);
      add('', `top:${(k / 4) * 100}%;right:0;width:14px;height:1px`);
    }
  });
}

/* ---------- misc ---------- */
buildSheetFrame();
if (coarse) {
  const hint = $('#hint');
  if (hint) hint.innerHTML = '<b>Tap</b> object · <b>Drag</b> arm · <b>Tap</b> arm to wave';
}
const tbDate = $('#tb-date');
if (tbDate) tbDate.textContent = new Date().toISOString().slice(0, 10);

markMilestones();
runBoot();
bootDone.then(() => {
  const id = location.hash.slice(1);
  if (SHEETS.includes(id)) openSection(id);
});
