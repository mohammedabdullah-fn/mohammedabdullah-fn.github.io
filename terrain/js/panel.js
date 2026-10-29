// Section overlay, waypoint index, link confirmations, toasts and deep links (#about, ...).
// Independent of three.js so every section stays reachable even without WebGL.
import { SECTION_IDS, beaconById, emit, on } from './shared.js';

const html = document.documentElement;
const sheet = document.getElementById('tl-sheet');
const panel = document.getElementById('tl-sheet-panel');
const scroller = document.getElementById('tl-sheet-scroll');
const kicker = document.getElementById('tl-sheet-kicker');
const meta = document.getElementById('tl-sheet-meta');
const prevBtn = document.getElementById('tl-prev');
const nextBtn = document.getElementById('tl-next');
const sections = new Map(SECTION_IDS.map((id) => [id, document.getElementById(id)]).filter(([, el]) => el));
const order = [...sections.keys()];
let current = null;
let returnFocus = null;
let pushed = false;      // we added a history entry for the open sheet (so Back closes it)
let pendingBack = false; // our own history.back() has not landed yet

html.classList.add('tl-panel-ready');
for (const [, s] of sections) s.hidden = true;
// If the 3D module never starts (CDN blocked, no WebGL), fall back to the index-only view.
setTimeout(() => { if (!html.classList.contains('tl-3d')) html.classList.add('tl-no3d'); }, 15000);

function setInert(v) {
  for (const el of document.querySelectorAll('[data-inert]')) {
    if (v) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }
}

const SECTION_IDS = ['about', 'projects', 'experience', 'now', 'resume'];
const visited = new Set();
function markVisited(id) {
  if (!SECTION_IDS.includes(id) || visited.has(id)) return;
  visited.add(id);
  document.querySelector(`.tl-wp-link[href="#${id}"]`)?.closest('li')?.classList.add('is-visited');
  const chip = document.querySelector('#tl-index .tl-chip');
  if (chip) chip.textContent = `Visited ${visited.size}/${SECTION_IDS.length}`;
  if (visited.size === SECTION_IDS.length) setTimeout(() => toast('Lab complete: you have visited all five sections', 4200), 400);
}

const SOURCE_NOTE = { drive: 'Reached by rover', click: 'Beacon selected', hash: 'Deep link', nav: 'From the index' };

export function openSection(id, { source = 'nav', focus = true } = {}) {
  const el = sections.get(id);
  if (!el) return false;
  const wasOpen = !!current;
  if (!wasOpen) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  for (const [k, s] of sections) s.hidden = k !== id;
  current = id;
  markVisited(id);
  const b = beaconById(id);
  kicker.textContent = `Beacon ${b.num} // ${b.label}`;
  meta.textContent = SOURCE_NOTE[source] || '';
  const i = order.indexOf(id);
  const prev = order[(i - 1 + order.length) % order.length];
  const next = order[(i + 1) % order.length];
  prevBtn.dataset.to = prev;
  nextBtn.dataset.to = next;
  prevBtn.querySelector('span').textContent = beaconById(prev).label;
  nextBtn.querySelector('span').textContent = beaconById(next).label;
  const h = el.querySelector('h2');
  if (h && h.id) panel.setAttribute('aria-labelledby', h.id);
  sheet.classList.add('is-open');
  sheet.setAttribute('aria-hidden', 'false');
  html.classList.add('tl-sheet-open');
  setInert(true);
  setDrawer(false);
  hideLinkCard();
  scroller.scrollTop = 0;
  if (id === 'resume') loadResume();
  const want = '#' + id;
  if (location.hash !== want) {
    if (!wasOpen && source !== 'hash' && !pendingBack && !pushed) { history.pushState({ tl: id }, '', want); pushed = true; }
    else history.replaceState(history.state, '', want);
  }
  if (focus) panel.focus({ preventScroll: true });
  for (const a of document.querySelectorAll('.tl-wp-link')) {
    if (a.getAttribute('href') === want) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  }
  emit('panel', { open: true, id, source });
  return true;
}

export function closeSection({ fromHistory = false } = {}) {
  if (!current) return;
  const id = current;
  current = null;
  sheet.classList.remove('is-open');
  sheet.setAttribute('aria-hidden', 'true');
  html.classList.remove('tl-sheet-open');
  setInert(false);
  for (const a of document.querySelectorAll('.tl-wp-link[aria-current]')) a.removeAttribute('aria-current');
  if (!fromHistory) {
    if (pushed) { pushed = false; pendingBack = true; history.back(); }
    else if (location.hash) history.replaceState(history.state, '', location.pathname + location.search);
  } else pushed = false;
  const f = returnFocus;
  returnFocus = null;
  if (f && document.contains(f) && !f.closest('[inert]')) f.focus({ preventScroll: true });
  emit('panel', { open: false, id });
}

export function currentSection() {
  return current;
}

function syncHash() {
  if (pendingBack) {
    // Our own history.back() landed. Make the URL match whatever is on screen now.
    pendingBack = false;
    const want = current ? '#' + current : '';
    if (location.hash !== want) history.replaceState(history.state, '', want || location.pathname + location.search);
    return;
  }
  const id = decodeURIComponent(location.hash.slice(1));
  if (sections.has(id)) {
    if (current !== id) openSection(id, { source: 'hash' });
  } else if (current && !id) closeSection({ fromHistory: true });
}

let resumeLoaded = false;
function loadResume() {
  if (resumeLoaded) return;
  const frame = document.getElementById('tl-resume-frame');
  if (!frame) return;
  // Phones often download a PDF iframe instead of showing it, so preview on desktop only.
  if (window.matchMedia('(min-width: 761px) and (pointer: fine)').matches && frame.dataset.src) {
    frame.src = frame.dataset.src;
    resumeLoaded = true;
  } else {
    frame.closest('.tl-pdf')?.classList.add('is-off');
  }
}

// ---- Index drawer (mobile) and help --------------------------------------------------------
const btnIndex = document.getElementById('tl-btn-index');
const left = document.getElementById('tl-left');
function setDrawer(v) {
  if (!left || !btnIndex) return;
  left.classList.toggle('is-open', v);
  btnIndex.setAttribute('aria-expanded', String(v));
}
btnIndex?.addEventListener('click', () => {
  const v = !left.classList.contains('is-open');
  setDrawer(v);
  if (v) left.querySelector('.tl-wp-link')?.focus({ preventScroll: true });
});

const btnHelp = document.getElementById('tl-btn-help');
const help = document.getElementById('tl-help');
function setHelp(v) {
  if (!help || !btnHelp) return;
  help.hidden = !v;
  btnHelp.setAttribute('aria-expanded', String(v));
}
btnHelp?.addEventListener('click', () => setHelp(help.hidden));
help?.querySelector('[data-close-help]')?.addEventListener('click', () => setHelp(false));

const brief = document.getElementById('tl-brief');
function hideBrief() {
  if (brief && !brief.hidden) {
    brief.classList.add('is-gone');
    setTimeout(() => { brief.hidden = true; }, 260);
  }
}
brief?.querySelector('[data-brief-close]')?.addEventListener('click', hideBrief);
on('first-input', hideBrief);

// ---- Link confirmation card ---------------------------------------------------------------
const card = document.getElementById('tl-linkcard');
const cardKicker = document.getElementById('tl-lc-kicker');
const cardTitle = document.getElementById('tl-lc-title');
const cardUrl = document.getElementById('tl-lc-url');
const cardOpen = document.getElementById('tl-lc-open');
const cardCopy = document.getElementById('tl-lc-copy');
function showLinkCard(b) {
  if (!card) return;
  cardKicker.textContent = `Link beacon ${b.num}`;
  cardTitle.textContent = b.label;
  cardUrl.textContent = b.display;
  cardOpen.href = b.href;
  if (b.id === 'email') {
    cardOpen.textContent = 'Write an email ↗';
    cardOpen.removeAttribute('target');
    cardOpen.removeAttribute('rel');
  } else {
    cardOpen.textContent = `Open ${b.label} ↗`;
    cardOpen.target = '_blank';
    cardOpen.rel = 'noopener';
  }
  cardCopy.hidden = b.id !== 'email';
  card.dataset.id = b.id;
  card.hidden = false;
  card.classList.add('is-open');
  cardOpen.focus({ preventScroll: true });
}
function hideLinkCard() {
  if (!card || card.hidden) return;
  card.classList.remove('is-open');
  card.hidden = true;
  card.dataset.id = '';
}
cardOpen?.addEventListener('click', () => setTimeout(hideLinkCard, 50));
card?.querySelector('[data-lc-close]')?.addEventListener('click', hideLinkCard);
cardCopy?.addEventListener('click', async () => {
  const addr = 'mohammedabdullah.fn@northeastern.edu';
  try {
    await navigator.clipboard.writeText(addr);
    toast('Email address copied');
  } catch {
    const r = document.createRange();
    r.selectNodeContents(cardUrl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    toast('Address selected: press Ctrl+C or Cmd+C to copy');
  }
});

function openExternal(href) {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

on('beacon', ({ id, via }) => {
  const b = beaconById(id);
  if (!b) return;
  if (b.kind === 'section') { openSection(id, { source: via }); return; }
  if (via === 'click' && b.id !== 'email') {
    // Clicked directly: we are inside the user's gesture, so a new tab is allowed.
    openExternal(b.href);
    toast(`Opening ${b.label} in a new tab`);
    return;
  }
  showLinkCard(b);
});
on('beacon-exit', ({ id }) => { if (card && card.dataset.id === id) hideLinkCard(); });

// ---- Toasts and announcements -------------------------------------------------------------
const toastEl = document.getElementById('tl-toast');
let toastTimer = 0;
export function toast(text, ms = 3200) {
  if (!toastEl) return;
  toastEl.textContent = text;
  toastEl.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), ms);
}
on('toast', ({ text, ms }) => toast(text, ms));
const announcer = document.getElementById('tl-announce');
on('announce', ({ text }) => { if (announcer) announcer.textContent = text; });

// ---- Global wiring --------------------------------------------------------------------------
document.addEventListener('click', (e) => {
  const t = e.target instanceof Element ? e.target : null;
  if (!t) return;
  const a = t.closest('a[href^="#"]');
  if (a) {
    const id = a.getAttribute('href').slice(1);
    if (id === 'tl-index') {
      e.preventDefault();
      setDrawer(true);
      left?.querySelector('.tl-wp-link')?.focus({ preventScroll: true });
      return;
    }
    if (sections.has(id)) {
      e.preventDefault();
      openSection(id, { source: a.classList.contains('tl-bl') ? 'click' : 'nav' });
      return;
    }
  }
  if (t.closest('[data-close]')) { e.preventDefault(); closeSection(); return; }
  const go = t.closest('[data-go]');
  if (go) { setDrawer(false); emit('goto', { id: go.dataset.go }); return; }
  const zone = t.closest('[data-zone]');
  if (zone) { closeSection(); emit('goto-zone', { surface: zone.dataset.zone }); return; }
  const nav = t.closest('[data-to]');
  if (nav && nav.dataset.to) openSection(nav.dataset.to, { source: 'nav' });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (current) { e.preventDefault(); closeSection(); }
    else if (card && !card.hidden) hideLinkCard();
    else if (help && !help.hidden) setHelp(false);
    else if (left && left.classList.contains('is-open')) setDrawer(false);
    return;
  }
  // Keep Tab inside the open sheet (backup for browsers without `inert`).
  if (e.key === 'Tab' && current) {
    const f = [...panel.querySelectorAll('a[href], button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.closest('[hidden]') && el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

// Milestones: mark done / next relative to today.
(() => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let nextSet = false;
  for (const li of document.querySelectorAll('.tl-ms li[data-date]')) {
    const d = new Date(li.dataset.date + 'T00:00:00');
    if (d < today) li.classList.add('is-done');
    else if (!nextSet) { li.classList.add('is-next'); nextSet = true; }
  }
})();

window.addEventListener('hashchange', syncHash);
syncHash();
