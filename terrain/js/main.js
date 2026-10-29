// Terrain Lab: scene setup, render loop, input, adaptive quality and the ?debug test hooks.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { MAP_HALF, BEACONS, BEACON_TRIGGER, BEACON_RELEASE, T2H, CLASSES, surfaceAt, beaconById, emit, on } from './shared.js';
import { Drive, KIN, LIMITS } from './drive.js';
import { ImuSim, Classifier, Haptics, AudioRumble } from './sense.js';
import { buildRover } from './rover.js';
import { buildWorld } from './world.js';
import { Hud } from './hud.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const html = document.documentElement;
const canvas = document.getElementById('tl-canvas');
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const TIERS = [
  { id: 'low', dpr: 1, points: 0.42, bloom: false },
  { id: 'mid', dpr: 1.35, points: 0.7, bloom: true },
  { id: 'high', dpr: 1.75, points: 1, bloom: true },
];

function pickTier() {
  const byName = TIERS.findIndex((t) => t.id === params.get('q'));
  if (byName >= 0) return byName;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  if (cores <= 2 || mem <= 2) return 0;
  if (coarse || Math.min(window.innerWidth, window.innerHeight) < 560) return 1;
  return cores >= 6 ? 2 : 1;
}

function start() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x020402, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motionOverride = DEBUG ? params.get('motion') : null; // ?debug&motion=full|reduce for testing
  let reduced = motionOverride === 'full' ? false : motionOverride === 'reduce' ? true : mqReduce.matches;
  mqReduce.addEventListener?.('change', (e) => { if (!motionOverride) reduced = e.matches; });

  const startTier = pickTier();
  let tierIdx = startTier;
  let tier = TIERS[tierIdx];
  html.dataset.quality = tier.id;

  // ---- Scene ---------------------------------------------------------------------------------
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020402);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 120);

  // Environment for the metals: a dark room with green light strips (night-vision reflections).
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20), new THREE.MeshBasicMaterial({ color: 0x030803, side: THREE.BackSide })));
  const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9dff55).multiplyScalar(1.5) });
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.2), stripMat);
    s.position.set(0, 9.5, -5 + i * 5);
    s.rotation.x = Math.PI / 2;
    envScene.add(s);
  }
  const warm = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb02e).multiplyScalar(0.7) }));
  warm.position.set(-9.5, 3, 0);
  warm.rotation.y = Math.PI / 2;
  envScene.add(warm);
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;
  scene.environmentIntensity = 0.45;
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0xb6ff7a, 0x061006, 0.5));
  const key = new THREE.DirectionalLight(0xd8ffbc, 1.25);
  key.position.set(-3, 8, 4);
  const rim = new THREE.DirectionalLight(0xa6ff3c, 1.0);
  rim.position.set(4, 3, -6);
  scene.add(key, rim);

  const world = buildWorld({ budget: 100000 });
  scene.add(world.group);
  world.setPointFraction(tier.points);
  const rover = buildRover();
  scene.add(rover.root);

  // ---- Post ----------------------------------------------------------------------------------
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.38, 0.3);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---- Simulation ------------------------------------------------------------------------------
  const drive = new Drive({ half: MAP_HALF, margin: 0.45, obstacles: BEACONS.map((b) => ({ id: b.id, x: b.x, z: b.z, r: 0.8 })) });
  const cam = { az: -0.42, el: 0.84, zoom: 1, base: 11, dist: 11, target: new THREE.Vector3(), vel: new THREE.Vector3(), shake: 0 };
  const camUp = () => ({ x: -Math.sin(cam.az), z: -Math.cos(cam.az) });
  const camRight = () => ({ x: Math.cos(cam.az), z: -Math.sin(cam.az) });
  { const u = camUp(); drive.teleport(0, 0, Math.atan2(u.x, u.z)); }

  const g0 = drive.wheelGround(0);
  const startSurf = surfaceAt(g0.x, g0.z);
  const imu = new ImuSim(11);
  const cls = new Classifier(23, startSurf);
  const haptics = new Haptics();
  const audio = new AudioRumble();
  const hud = new Hud();
  hud.setSurface(startSurf);
  world.setActive(startSurf);

  const bstate = {};
  for (const b of BEACONS) {
    const d = Math.hypot(drive.x - b.x, drive.z - b.z);
    bstate[b.id] = { dist: d, prox: 0, inside: d < BEACON_TRIGGER };
  }
  const surf = { stable: startSurf, cand: startSurf, candT: 0, raw: startSurf };
  const sheetEl = document.getElementById('tl-sheet');
  let sheetOpen = sheetEl.classList.contains('is-open');
  let simT = 0, revealT = 0, lidarPhase = 0, hudAcc = 1, distAcc = 1, lastAnnounce = -10;
  let pathShown = false, firstDone = false, padPulse = 0, lastHaptic = null;
  let rect = { left: 0, top: 0, width: 1, height: 1 };
  const tmpV = new THREE.Vector3();
  const view = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const distEls = [...document.querySelectorAll('[data-dist]')];
  const leftEl = document.getElementById('tl-left');
  const rightEl = document.getElementById('tl-right');

  function firstInput() {
    if (firstDone) return;
    firstDone = true;
    html.classList.add('tl-driven');
    emit('first-input', {});
  }

  // ---- Input ---------------------------------------------------------------------------------
  const keys = new Set();
  const CODE = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', KeyQ: 'ccw', KeyE: 'cw' };
  const KEY = { w: 'up', s: 'down', a: 'left', d: 'right', q: 'ccw', e: 'cw', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  const keyOf = (e) => CODE[e.code] || KEY[e.key] || KEY[(e.key || '').toLowerCase()];
  const editable = (t) => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || sheetOpen || editable(e.target)) return;
    const k = keyOf(e);
    if (!k) return;
    keys.add(k);
    e.preventDefault();
    firstInput();
  });
  window.addEventListener('keyup', (e) => { const k = keyOf(e); if (k) keys.delete(k); });
  window.addEventListener('blur', () => keys.clear());
  document.addEventListener('visibilitychange', () => { if (document.hidden) keys.clear(); last = 0; });

  let padIndex = -1;
  const padChip = document.getElementById('tl-pad');
  window.addEventListener('gamepadconnected', (e) => {
    padIndex = e.gamepad.index;
    if (padChip) padChip.hidden = false;
    emit('toast', { text: 'Gamepad connected: left stick drives, right stick turns. Surface changes rumble it.', ms: 4200 });
  });
  window.addEventListener('gamepaddisconnected', (e) => {
    if (e.gamepad.index === padIndex) padIndex = -1;
    if (padChip) padChip.hidden = padIndex < 0;
  });
  const dz = (v) => (Math.abs(v) < 0.16 ? 0 : (v - Math.sign(v) * 0.16) / 0.84);
  function padInput() {
    if (padIndex < 0 || !navigator.getGamepads) return null;
    const gp = navigator.getGamepads()[padIndex];
    if (!gp || !gp.connected) return null;
    const a = gp.axes;
    return { u: -dz(a[1] || 0), r: dz(a[0] || 0), w: -dz(a[2] || 0) };
  }

  function manualCommand() {
    let u = 0, r = 0, w = 0;
    if (keys.has('up')) u += 1;
    if (keys.has('down')) u -= 1;
    if (keys.has('right')) r += 1;
    if (keys.has('left')) r -= 1;
    if (keys.has('ccw')) w += 1;
    if (keys.has('cw')) w -= 1;
    const p = padInput();
    if (p) {
      u += p.u; r += p.r; w += p.w;
      if (Math.abs(p.u) + Math.abs(p.r) + Math.abs(p.w) > 0) firstInput();
    }
    const U = camUp(), R = camRight();
    let x = U.x * u + R.x * r, z = U.z * u + R.z * r;
    const m = Math.hypot(x, z);
    if (m > 1) { x /= m; z /= m; }
    return { x, z, w: clamp(w, -1, 1) };
  }

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function pick(cx, cy) {
    ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(world.hitMeshes, false);
    if (hits.length) return { type: 'beacon', id: hits[0].object.userData.beacon };
    const p = raycaster.ray.intersectPlane(floorPlane, tmpV);
    if (!p) return null;
    for (const b of BEACONS) if (Math.hypot(p.x - b.x, p.z - b.z) < 0.5) return { type: 'beacon', id: b.id };
    if (Math.abs(p.x) > MAP_HALF + 0.5 || Math.abs(p.z) > MAP_HALF + 0.5) return null;
    return { type: 'floor', x: p.x, z: p.z };
  }

  function goTo(x, z, beacon = null) {
    const b = drive.bound;
    const p = drive.planTo(clamp(x, -b, b), clamp(z, -b, b), { beacon });
    world.setPath(p);
    pathShown = true;
    return p;
  }

  function fireBeacon(b, via) {
    if (!b) return;
    if (via === 'drive') { drive.cancel(); world.setPath(null); pathShown = false; }
    world.beaconHit(b.id);
    padPulse = 1;
    emit('beacon', { id: b.id, via });
  }

  function tap(cx, cy) {
    if (sheetOpen) return;
    const hit = pick(cx, cy);
    if (!hit) return;
    firstInput();
    if (hit.type === 'beacon') fireBeacon(beaconById(hit.id), 'click');
    else goTo(hit.x, hit.z);
  }

  const pointers = new Map();
  let pinch = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: 0 });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: cam.zoom };
      for (const p of pointers.values()) p.moved = 99;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') {
        const h = sheetOpen ? null : pick(e.clientX, e.clientY);
        canvas.classList.toggle('is-beacon', !!h && h.type === 'beacon');
        world.setHover(h ? h.x : 0, h ? h.z : 0, !!h && h.type === 'floor');
      }
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    p.moved = Math.max(p.moved, Math.hypot(e.clientX - p.sx, e.clientY - p.sy));
    if (pointers.size === 1 && p.moved > 8) {
      cam.az -= dx * 0.0055;
      cam.el = clamp(cam.el + dy * 0.0035, 0.62, 1.38);
      canvas.classList.add('is-drag');
      world.setHover(0, 0, false);
    } else if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      cam.zoom = clamp((pinch.zoom * pinch.d) / (Math.hypot(a.x - b.x, a.y - b.y) || 1), 0.55, 1.7);
    }
  });
  function endPointer(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    canvas.classList.remove('is-drag');
    if (e.type === 'pointerup' && p.moved <= 8 && performance.now() - p.t < 900) tap(e.clientX, e.clientY);
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => world.setHover(0, 0, false));
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.zoom = clamp(cam.zoom * Math.exp(e.deltaY * 0.0011), 0.55, 1.7);
  }, { passive: false });

  const mapC = document.getElementById('tl-minimap');
  mapC?.addEventListener('pointerdown', (e) => {
    if (sheetOpen) return;
    const r = mapC.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 * MAP_HALF - MAP_HALF;
    const z = ((e.clientY - r.top) / r.height) * 2 * MAP_HALF - MAP_HALF;
    firstInput();
    for (const b of BEACONS) if (Math.hypot(b.x - x, b.z - z) < 0.45) { fireBeacon(b, 'click'); return; }
    goTo(x, z);
  });

  // ---- Wiring to the panel and toolbar ----------------------------------------------------------
  on('panel', ({ open }) => {
    sheetOpen = open;
    if (open) keys.clear();
  });
  on('goto', ({ id }) => {
    const b = beaconById(id);
    if (!b) return;
    firstInput();
    if (bstate[id].inside) { fireBeacon(b, 'drive'); return; }
    const p = goTo(b.x, b.z, b.id);
    emit('toast', { text: `Route to ${b.label}: ${p.L.toFixed(1)} m${p.corners > 0 ? ', around other beacons' : ''}` });
  });
  const ZONE_POINTS = { tile: [-3.9, -3.4], hardwood: [3.9, -3.4], carpet: [-3.9, 3.4], grass: [3.9, 3.4] };
  on('goto-zone', ({ surface }) => {
    const p = ZONE_POINTS[surface];
    if (!p) return;
    firstInput();
    goTo(p[0], p[1]);
    emit('toast', { text: `Driving to ${T2H[surface].label.toLowerCase()}: watch the IMU trace` });
  });

  const btnAudio = document.getElementById('tl-btn-audio');
  btnAudio?.addEventListener('click', async () => {
    const want = btnAudio.getAttribute('aria-pressed') !== 'true';
    const ok = await audio.setEnabled(want);
    btnAudio.setAttribute('aria-pressed', String(want && ok));
    if (want) emit('toast', { text: ok ? 'Audio on: synthesized terrain rumble' : 'Audio is not available in this browser' });
  });
  const btnHap = document.getElementById('tl-btn-haptics');
  btnHap?.addEventListener('click', () => {
    haptics.enabled = !haptics.enabled;
    btnHap.setAttribute('aria-pressed', String(haptics.enabled));
    if (!haptics.enabled) { haptics.stop(); emit('toast', { text: 'Haptics off' }); return; }
    const r = haptics.play(surf.stable);
    emit('toast', { text: r.gamepad ? `Haptics on: ${T2H[surf.stable].feel.toLowerCase()} on the gamepad` : r.vibrate ? 'Haptics on: phone vibration' : 'Haptics on. Connect a gamepad, or open this on a phone, to feel surface changes.', ms: 4200 });
  });

  // ---- Terrain feedback ----------------------------------------------------------------------------
  function onTerrain(s) {
    hud.setSurface(s);
    world.setActive(s);
    const res = haptics.play(s);
    audio.pulse(s);
    padPulse = 1;
    if (!reduced) cam.shake = 0.01 + 0.05 * T2H[s].amp;
    lastHaptic = { surface: s, t: simT, gamepad: res.gamepad, vibrate: res.vibrate };
    if (simT - lastAnnounce > 1.5) {
      lastAnnounce = simT;
      emit('announce', { text: `IMU wheel on ${T2H[s].label.toLowerCase()}: ${T2H[s].feel.toLowerCase()}.` });
    }
  }

  // ---- Layout / quality -------------------------------------------------------------------------------
  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if (!w || !h) return false;
    const pr = Math.min(window.devicePixelRatio || 1, tier.dpr);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    camera.aspect = w / h;
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const spanW = clamp(w / 200, 4.4, 8), spanV = 4.7;
    cam.base = Math.max(spanV / (2 * t), spanW / (2 * t * camera.aspect));
    // Centre the rover in the area that the HUD chrome leaves free.
    const topEdge = document.querySelector('.tl-top')?.getBoundingClientRect().bottom || 0;
    let bottomEdge = h;
    if (w <= 760 && rightEl && rightEl.offsetParent) bottomEdge = rightEl.getBoundingClientRect().top;
    else { const f = document.querySelector('.tl-foot'); if (f) bottomEdge = f.getBoundingClientRect().top; }
    const shift = clamp((topEdge + bottomEdge) / 2 - h / 2, -h * 0.25, h * 0.25);
    let shiftX = 0;
    if (w > 760 && leftEl && rightEl) {
      const l = leftEl.getBoundingClientRect(), r = rightEl.getBoundingClientRect();
      if (l.width > 0 && r.width > 0) shiftX = clamp((l.right + r.left) / 2 - w / 2, -w * 0.2, w * 0.2);
    }
    camera.setViewOffset(w, h, -shiftX, -shift, w, h);
    camera.updateProjectionMatrix();
    world.uniforms.uScale.value = (h * pr) / (2 * t);
    const r = canvas.getBoundingClientRect();
    rect = { left: r.left, top: r.top, width: r.width || w, height: r.height || h };
    hud.resize();
    return true;
  }

  function applyTier(i) {
    tierIdx = clamp(i, 0, TIERS.length - 1);
    tier = TIERS[tierIdx];
    world.setPointFraction(tier.points);
    html.dataset.quality = tier.id;
    resize();
  }

  const perf = { t: 0, n: 0, warm: 3, ups: 0 };
  function perfSample(dt) {
    if (DEBUG || params.has('q')) return;
    if (perf.warm > 0) { perf.warm -= dt; return; }
    perf.t += dt; perf.n++;
    if (perf.t < 2) return;
    const avg = (perf.t / perf.n) * 1000;
    perf.t = 0; perf.n = 0;
    if (avg > 25 && tierIdx > 0) { applyTier(tierIdx - 1); perf.warm = 2; }
    else if (avg < 11 && tierIdx < startTier && perf.ups < 1) { applyTier(tierIdx + 1); perf.ups++; perf.warm = 2; }
  }

  // ---- Per-frame -------------------------------------------------------------------------------------
  function updateCamera(dt) {
    const wf = 4.2, T = cam.target, V = cam.vel;
    V.x += (wf * wf * (drive.x - T.x) - 2 * wf * V.x) * dt;
    V.z += (wf * wf * (drive.z - T.z) - 2 * wf * V.z) * dt;
    T.x += V.x * dt;
    T.z += V.z * dt;
    cam.dist += (cam.base * cam.zoom - cam.dist) * (1 - Math.exp(-dt * 6));
    const ce = Math.cos(cam.el);
    camera.position.set(T.x + Math.sin(cam.az) * ce * cam.dist, Math.sin(cam.el) * cam.dist, T.z + Math.cos(cam.az) * ce * cam.dist);
    if (!reduced && cam.shake > 1e-4) {
      camera.position.x += cam.shake * Math.sin(simT * 47);
      camera.position.y += cam.shake * 0.6 * Math.sin(simT * 39 + 1);
      camera.position.z += cam.shake * Math.sin(simT * 53 + 2);
      cam.shake *= Math.exp(-dt * 7);
    } else cam.shake = 0;
    camera.lookAt(T.x, 0, T.z);
  }

  function viewFootprint() {
    camera.updateMatrixWorld();
    const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < 4; i++) {
      ndc.set(c[i][0], c[i][1]);
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(floorPlane, view[i])) return null;
    }
    return view;
  }

  function step(dt) {
    dt = clamp(dt, 0, 0.05);
    simT += dt;
    const m = manualCommand();
    drive.hold = sheetOpen;
    if (sheetOpen) drive.setManual(0, 0, 0);
    else drive.setManual(m.x, m.z, m.w);
    if (drive.mode === 'manual' && pathShown) { world.setPath(null); pathShown = false; }

    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      drive.step(h);
      const g = drive.wheelGround(0);
      const s = surfaceAt(g.x, g.z);
      imu.advance(h, s, drive.contactSpeed[0] / LIMITS.vMax, drive.travel[0]);
      cls.advance(h, imu, s);
    }

    const g = drive.wheelGround(0);
    surf.raw = surfaceAt(g.x, g.z);
    if (surf.raw !== surf.cand) { surf.cand = surf.raw; surf.candT = 0; } else surf.candT += dt;
    if (surf.cand !== surf.stable && surf.candT >= 0.12) { surf.stable = surf.cand; onTerrain(surf.stable); }

    for (const b of BEACONS) {
      const st = bstate[b.id];
      st.dist = Math.hypot(drive.x - b.x, drive.z - b.z);
      st.prox = clamp(1 - (st.dist - 0.55) / 2.2, 0, 1);
      if (!st.inside && st.dist < BEACON_TRIGGER) {
        st.inside = true;
        if (!sheetOpen) fireBeacon(b, 'drive');
      } else if (st.inside && st.dist > BEACON_RELEASE) {
        st.inside = false;
        emit('beacon-exit', { id: b.id });
      }
    }

    if (drive.consumeArrival() || (!drive.path && pathShown)) { world.setPath(null); pathShown = false; }

    lidarPhase = (lidarPhase - dt * TAU * 0.75) % TAU; // clockwise seen from above, like an RPLIDAR
    let sweep = (Math.PI / 2 - (drive.psi + lidarPhase)) % TAU;
    if (sweep < 0) sweep += TAU;
    const acc = drive.bodyAcc();
    const rms = imu.rms(20);
    rover.root.position.set(drive.x, 0, drive.z);
    rover.root.rotation.y = drive.psi;
    rover.update({
      wheelAngle: drive.wheelAngle, rollerAngle: drive.rollerAngle, lidar: lidarPhase,
      bob: clamp(imu.at(0), -0.5, 0.5) * 0.004, pitch: -0.012 * acc.f, roll: 0.012 * acc.l,
      t: simT, dt, padPulse, surface: surf.stable, rms,
    });
    padPulse = 0;
    updateCamera(dt);
    revealT += dt;
    world.update({
      t: simT, dt, x: drive.x, z: drive.z, psi: drive.psi, sweep, sweepGain: 1.6,
      reveal: revealT * 7, motion: reduced ? 0 : 1, beacons: bstate, rim: drive.rim, showArrows: true,
      progress: drive.path ? drive.path.s || 0 : null,
    });
    audio.update(drive.contactSpeed[0] / LIMITS.vMax, surf.stable);

    hud.drawScope(imu, surf.stable);
    hud.drawIK(drive);
    const mobile = rect.width <= 760;
    if (!mobile || leftEl.classList.contains('is-open')) {
      hud.drawMinimap({ x: drive.x, z: drive.z, psi: drive.psi, surface: surf.stable, sweep, range: world.uniforms.uRange.value, path: drive.path, imu: g, view: viewFootprint() });
    }
    hudAcc += dt;
    if (hudAcc >= 1 / 12) {
      hudAcc = 0;
      hud.setClassifier(cls, surf.stable);
      hud.telemetry({ mode: sheetOpen ? 'Hold' : drive.mode === 'auto' ? 'Auto' : drive.mode === 'manual' ? 'Manual' : 'Idle', x: drive.x, z: drive.z, psi: drive.psi, speed: Math.hypot(drive.vx, drive.vz), w: drive.w, remaining: drive.remaining(), rms });
    }
    distAcc += dt;
    if (distAcc >= 0.25) {
      distAcc = 0;
      for (const el of distEls) {
        const st = bstate[el.dataset.dist];
        if (st) el.textContent = st.dist.toFixed(1) + ' m';
      }
    }
  }

  function renderFrame() {
    camera.updateMatrixWorld();
    if (tier.bloom) composer.render();
    else renderer.render(scene, camera);
    hud.placeLabels(camera, rect, { beacons: bstate, imuPos: rover.imuWorld(tmpV), path: drive.path, remaining: drive.remaining() });
  }

  let last = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!last) { last = now; return; }
    let dt = (now - last) / 1000;
    last = now;
    if (dt <= 0) return;
    if (dt > 0.25) dt = 1 / 60;
    step(dt);
    renderFrame();
    perfSample(dt);
  }

  // ---- Boot ----------------------------------------------------------------------------------------
  resize();
  cam.target.set(drive.x, 0, drive.z);
  cam.dist = cam.base * cam.zoom;
  step(0);
  renderFrame();
  html.classList.remove('tl-no3d');
  html.classList.add('tl-3d');
  window.addEventListener('resize', () => { if (resize()) renderFrame(); });
  document.fonts?.ready?.then(() => { world.redrawLabels(); hud.resize(); });
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); html.classList.add('tl-no3d'); });
  canvas.addEventListener('webglcontextrestored', () => { html.classList.remove('tl-no3d'); });
  requestAnimationFrame(frame);

  // ---- Test hooks (?debug) ----------------------------------------------------------------------------
  if (DEBUG) {
    const text = (id) => document.getElementById(id)?.textContent.trim();
    const api = {
      tick(frames = 1, dt = 1 / 60) {
        for (let i = 0; i < frames; i++) step(dt);
        renderFrame();
        return api.state();
      },
      state() {
        const g = drive.wheelGround(0);
        const openSec = [...document.querySelectorAll('.tl-sec')].find((s) => !s.hidden);
        return {
          t: +simT.toFixed(4), x: drive.x, z: drive.z, psi: drive.psi, vx: drive.vx, vz: drive.vz, ax: drive.ax, az: drive.az,
          speed: Math.hypot(drive.vx, drive.vz), accel: Math.hypot(drive.ax, drive.az), w: drive.w, mode: drive.mode, hold: drive.hold,
          imuWheel: g, surface: surfaceAt(g.x, g.z), surfaceStable: surf.stable, surfaceCenter: surfaceAt(drive.x, drive.z),
          wheels: KIN.wheels.map((k, i) => ({ id: k.id, rim: drive.rim[i], rate: drive.wheelRate[i], angle: drive.wheelAngle[i], roller: drive.rollerRate[i] })),
          path: drive.path ? { L: drive.path.L, remaining: drive.remaining(), n: drive.path.n, corners: drive.path.corners, gx: drive.path.gx, gz: drive.path.gz, beacon: drive.path.beacon } : null,
          classifier: Object.fromEntries(CLASSES.map((c, j) => [c, +cls.probs[j].toFixed(2)])),
          predicted: cls.predicted(), windows: cls.count, imuRms: imu.rms(), imuSamples: imu.count,
          sheetOpen: sheetEl.classList.contains('is-open'), section: sheetEl.classList.contains('is-open') && openSec ? openSec.id : null,
          linkCard: (() => { const c = document.getElementById('tl-linkcard'); return c && !c.hidden ? c.dataset.id : null; })(),
          beacons: Object.fromEntries(BEACONS.map((b) => [b.id, { ...bstate[b.id] }])),
          tier: tier.id, lastHaptic, reduced, cam: { az: cam.az, el: cam.el, dist: cam.dist },
        };
      },
      hud() {
        return {
          surface: text('tl-surf'), amp: text('tl-amp'), pattern: text('tl-pattern'), feel: text('tl-feel'),
          motorL: text('tl-ml'), motorR: text('tl-mr'), predicted: text('tl-pred'), truth: text('tl-truth'), rms: text('tl-rms'),
          bars: Object.fromEntries([...document.querySelectorAll('.tl-cls-bars li')].map((li) => [li.dataset.class, li.querySelector('em').textContent])),
          mode: text('tl-mode'), tgt: text('tl-tgt'),
        };
      },
      worldToScreen(x, z, y = 0) {
        camera.updateMatrixWorld();
        const v = new THREE.Vector3(x, y, z).project(camera);
        return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height, depth: v.z };
      },
      screenToFloor(cx, cy) { const h = pick(cx, cy); return h; },
      imuTrace(n = 80) { const out = []; for (let k = Math.min(n, imu.count) - 1; k >= 0; k--) out.push(imu.at(k)); return out; },
      teleport(x, z, psi = drive.psi) {
        drive.teleport(x, z, psi);
        cam.target.set(x, 0, z);
        cam.vel.set(0, 0, 0);
        world.setPath(null);
        pathShown = false;
        for (const b of BEACONS) {
          const st = bstate[b.id];
          st.dist = Math.hypot(x - b.x, z - b.z);
          st.inside = st.dist < BEACON_TRIGGER;
        }
        return api.state();
      },
      plan(x, z) { const p = goTo(x, z); return { L: p.L, n: p.n, corners: p.corners }; },
      setTier(i) { applyTier(i); return tier.id; },
      surfaceAt, beacons: () => BEACONS.map((b) => ({ ...b })), limits: { ...LIMITS },
      camera: () => ({ az: cam.az, el: cam.el, zoom: cam.zoom }),
      points: () => ({ total: world.count, drawn: world.points.geometry.drawRange.count }),
    };
    window.__terrain = api;
  }
}

try {
  start();
} catch (err) {
  html.classList.add('tl-no3d');
  console.error('Terrain Lab could not start the 3D view:', err);
}
