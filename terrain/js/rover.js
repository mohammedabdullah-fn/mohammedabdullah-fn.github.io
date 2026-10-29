// Procedural Mecabot Plus: aluminium-extrusion chassis and top plate, four mecanum wheels with
// 45-degree rollers, a laptop/electronics deck, a 2D LIDAR and a VN-100 IMU on one wheel shaft.
// Local frame: +x = left, +y = up, +z = forward. Units: metres.
import * as THREE from 'three';
import { KIN } from './drive.js';

const TAU = Math.PI * 2;
const WW = 0.08;          // wheel width
const NR = 12;            // rollers per wheel
const RL = 0.1;           // roller length
const RHO = KIN.wheelR - KIN.rollerR; // roller centre radius
const DELTA = (Math.SQRT1_2 * RL * 0.5) / RHO; // angular offset of the roller ends on the side plates

function materials() {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  return {
    alu: std({ color: 0x8f9a8b, metalness: 0.72, roughness: 0.42 }),
    aluDark: std({ color: 0x5d6759, metalness: 0.6, roughness: 0.5 }),
    plate: std({ color: 0x4f584c, metalness: 0.6, roughness: 0.5 }),
    slot: std({ color: 0x1d231c, metalness: 0.4, roughness: 0.6 }),
    black: std({ color: 0x111511, metalness: 0.3, roughness: 0.5 }),
    grey: std({ color: 0x2a302a, metalness: 0.35, roughness: 0.5 }),
    blue: std({ color: 0x24429a, metalness: 0.35, roughness: 0.42 }),
    chrome: std({ color: 0xe6eee2, metalness: 1, roughness: 0.15 }),
    rubber: std({ color: 0xffffff, vertexColors: true, metalness: 0, roughness: 0.72 }),
    estop: std({ color: 0x8c1d12, emissive: 0x300500, roughness: 0.4 }),
    tape: std({ color: 0xdfe6d8, roughness: 0.5, metalness: 0, transparent: true, opacity: 0.55 }),
    imu: std({ color: 0xff5a1f, emissive: 0xff3a0a, emissiveIntensity: 0.55, roughness: 0.38, metalness: 0.1 }),
    label: std({ color: 0xeeeee6, roughness: 0.6 }),
    wireRed: std({ color: 0x9a1c12, roughness: 0.5 }),
    wireBlack: std({ color: 0x0c0e0c, roughness: 0.5 }),
    pad: std({ color: 0x141814, metalness: 0.2, roughness: 0.55, emissive: 0xa6ff3c, emissiveIntensity: 0 }),
    glow: new THREE.MeshBasicMaterial({ color: 0xa6ff3c }),
    led: new THREE.MeshBasicMaterial({ color: 0xff8a3a }),
  };
}

function rollerGeometry() {
  const L = RL, r0 = KIN.rollerR;
  const pts = [new THREE.Vector2(0, -L / 2)];
  const K = 8;
  for (let k = 0; k <= K; k++) {
    const y = -L / 2 + (k / K) * L;
    const u = (2 * y) / L;
    pts.push(new THREE.Vector2(r0 * (1 - 0.36 * u * u), y));
  }
  pts.push(new THREE.Vector2(0, L / 2));
  const g = new THREE.LatheGeometry(pts, 12);
  // Light stripes around the circumference so roller spin reads up close.
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const phi = Math.atan2(pos.getX(i), pos.getZ(i));
    const c = Math.cos(phi * 2) > 0.8 ? 0.4 : 0.07;
    col[i * 3] = c; col[i * 3 + 1] = c * 1.06; col[i * 3 + 2] = c;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// Scalloped side plate. Lobes sit where the roller ends attach: theta_i + sigma * DELTA.
function sidePlateGeometry(sigma) {
  const shape = new THREE.Shape();
  const K = 144;
  for (let k = 0; k <= K; k++) {
    const a = (k / K) * TAU;
    let lobe = 0;
    for (let i = 0; i < NR; i++) {
      // Shape angle alpha maps to wheel angle theta via alpha = theta + PI/2 (see rotateY below).
      let d = a - ((i / NR) * TAU + sigma * DELTA + Math.PI / 2);
      d = Math.atan2(Math.sin(d), Math.cos(d));
      lobe = Math.max(lobe, Math.exp(-(d * d) / (2 * 0.085 * 0.085)));
    }
    const r = 0.064 + 0.02 * lobe;
    if (k === 0) shape.moveTo(r * Math.cos(a), r * Math.sin(a));
    else shape.lineTo(r * Math.cos(a), r * Math.sin(a));
  }
  const hole = new THREE.Path();
  hole.absarc(0, 0, 0.02, 0, TAU, true);
  shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.004, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -0.002);
  g.rotateY(Math.PI / 2); // extrusion axis -> wheel axle (x); shape (u, v) -> (y, z) plane
  return g;
}

export function buildRover() {
  const M = materials();
  const root = new THREE.Group();
  root.name = 'rover';
  const body = new THREE.Group(); // sprung mass: bobs and tilts
  root.add(body);
  const edgeVerts = [];

  const tmpM = new THREE.Matrix4();
  function addEdges(geo, mesh) {
    mesh.updateMatrix();
    const e = new THREE.EdgesGeometry(geo, 25);
    const p = e.attributes.position;
    const v = new THREE.Vector3();
    tmpM.copy(mesh.matrix);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(tmpM);
      edgeVerts.push(v.x, v.y, v.z);
    }
    e.dispose();
  }
  function box(parent, w, h, d, mat, x, y, z, edge = false) {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    parent.add(m);
    if (edge && parent === body) addEdges(g, m);
    return m;
  }
  function cylX(parent, r, len, mat, x, y, z, seg = 20) {
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    g.rotateZ(Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  function cylY(parent, r, h, mat, x, y, z, seg = 20) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  function tube(parent, pts, r, mat) {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, r, 6, false), mat);
    parent.add(m);
    return m;
  }

  // ---- Chassis: extrusion frame -----------------------------------------------------------
  const ext = 0.022, fx = 0.25, fz = 0.32, yT = 0.3, yB = 0.15;
  for (const y of [yT, yB]) {
    box(body, 2 * fx + ext, ext, ext, M.alu, 0, y, fz, true);
    box(body, 2 * fx + ext, ext, ext, M.alu, 0, y, -fz, true);
    box(body, ext, ext, 2 * fz - ext, M.alu, fx, y, 0, true);
    box(body, ext, ext, 2 * fz - ext, M.alu, -fx, y, 0, true);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      box(body, ext, yT - yB, ext, M.alu, sx * fx, (yT + yB) / 2, sz * fz, true);
      box(body, ext, yT - yB + 0.04, ext, M.alu, sx * fx, (yT + yB) / 2 - 0.02, sz * 0.17, true);
    }
    // slot grooves on the outer faces of the side rails
    box(body, 0.003, 0.006, 2 * fz - 0.03, M.slot, sx * (fx + ext / 2 + 0.0008), yT, 0);
    box(body, 0.003, 0.006, 2 * fz - 0.03, M.slot, sx * (fx + ext / 2 + 0.0008), yB, 0);
  }
  for (const sz of [-1, 1]) box(body, 2 * fx - 0.03, 0.006, 0.003, M.slot, 0, yT, sz * (fz + ext / 2 + 0.0008));
  box(body, 2 * fx - 0.02, 0.005, 2 * fz - 0.02, M.aluDark, 0, yB - 0.012, 0);
  box(body, 2 * fx, 0.02, 0.02, M.alu, 0, yB, 0);

  // Aluminium top plate with a perimeter trim.
  const plateY = yT + ext / 2 + 0.0035;
  box(body, 0.54, 0.007, 0.74, M.plate, 0, plateY, 0, true);
  const deckY = plateY + 0.0035;
  for (const bx of [-0.25, 0.25]) {
    for (const bz of [-0.35, -0.12, 0.12, 0.35]) cylY(body, 0.006, 0.004, M.chrome, bx, deckY + 0.002, bz, 8);
  }
  for (const bz of [-0.35, 0.35]) for (const bx of [-0.1, 0.1]) cylY(body, 0.006, 0.004, M.chrome, bx, deckY + 0.002, bz, 8);
  box(body, 0.16, 0.002, 0.014, M.black, 0.07, deckY + 0.001, 0.02);
  box(body, 0.012, 0.002, 0.12, M.black, -0.2, deckY + 0.001, 0.15);

  // ---- Under the plate: battery, drivers, wiring --------------------------------------------
  box(body, 0.2, 0.08, 0.26, M.blue, 0, 0.19, -0.03);
  box(body, 0.09, 0.03, 0.07, M.grey, 0.13, 0.172, 0.17);
  box(body, 0.09, 0.03, 0.07, M.grey, -0.13, 0.172, 0.17);
  box(body, 0.1, 0.04, 0.06, M.black, 0, 0.18, 0.2);
  tube(body, [[0.13, 0.19, 0.17], [0.07, 0.24, 0.12], [0.02, 0.22, 0.05], [0, 0.235, -0.02]], 0.004, M.wireRed);
  tube(body, [[-0.13, 0.19, 0.17], [-0.08, 0.25, 0.1], [-0.03, 0.23, 0.04], [0.01, 0.235, -0.03]], 0.004, M.wireBlack);
  tube(body, [[0.04, 0.2, 0.2], [0.1, 0.26, 0.24], [0.17, 0.22, 0.27], [0.2, 0.16, 0.26]], 0.003, M.wireRed);

  // ---- Deck: LIDAR, depth camera, e-stops, laptop, gamepad ----------------------------------
  const lidar = new THREE.Group();
  lidar.position.set(0.02, deckY, 0.17);
  body.add(lidar);
  for (const [px, pz] of [[-0.035, -0.035], [0.035, -0.035], [-0.035, 0.035], [0.035, 0.035]]) cylY(lidar, 0.004, 0.04, M.chrome, px, 0.02, pz, 8);
  box(lidar, 0.095, 0.004, 0.095, M.black, 0, 0.042, 0);
  cylY(lidar, 0.043, 0.03, M.black, 0, 0.059, 0, 28);
  const lidarHead = new THREE.Group();
  lidarHead.position.y = 0.083;
  lidar.add(lidarHead);
  cylY(lidarHead, 0.039, 0.02, M.grey, 0, 0, 0, 28);
  box(lidarHead, 0.024, 0.011, 0.004, M.glow, 0, 0, 0.038);
  cylY(lidarHead, 0.03, 0.004, M.black, 0, 0.012, 0, 24);

  const cam = new THREE.Group();
  cam.position.set(0.16, deckY, 0.335);
  body.add(cam);
  box(cam, 0.03, 0.028, 0.02, M.alu, 0, 0.014, -0.005);
  box(cam, 0.11, 0.028, 0.028, M.black, 0, 0.042, 0);
  for (const lx of [-0.034, 0, 0.034]) {
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, 0.003, 16), lx === 0 ? M.glow : M.grey);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(lx, 0.042, 0.0148);
    cam.add(lens);
  }

  for (const [ex, ez] of [[-0.02, 0.3], [-0.215, 0.02]]) {
    cylY(body, 0.022, 0.02, M.grey, ex, deckY + 0.01, ez);
    cylY(body, 0.027, 0.013, M.estop, ex, deckY + 0.026, ez);
  }

  // Laptop at the rear, screen facing backwards (towards the operator behind the robot).
  const laptop = new THREE.Group();
  laptop.position.set(-0.1, deckY, -0.2);
  body.add(laptop);
  box(laptop, 0.24, 0.012, 0.16, M.grey, 0, 0.006, 0);
  box(laptop, 0.21, 0.002, 0.085, M.black, 0, 0.0125, -0.02);
  const lid = new THREE.Group();
  lid.position.set(0, 0.012, 0.08);
  lid.rotation.x = 0.28;
  laptop.add(lid);
  const lidMesh = box(lid, 0.24, 0.16, 0.006, M.grey, 0, 0.08, 0);
  lidMesh.position.z = 0.003;
  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = 256;
  screenCanvas.height = 168;
  const screenTex = new THREE.CanvasTexture(screenCanvas);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.142), new THREE.MeshBasicMaterial({ map: screenTex }));
  screen.rotation.y = Math.PI;
  screen.position.set(0, 0.08, -0.0005);
  lid.add(screen);

  const pad = new THREE.Group();
  pad.position.set(0.15, deckY, -0.07);
  pad.rotation.y = 0.35;
  body.add(pad);
  box(pad, 0.1, 0.024, 0.055, M.pad, 0, 0.012, 0);
  for (const gx of [-1, 1]) {
    const grip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 14, 10), M.pad);
    grip.scale.set(1, 0.55, 1.35);
    grip.position.set(gx * 0.052, 0.012, -0.018);
    pad.add(grip);
    cylY(pad, 0.008, 0.012, M.grey, gx * 0.026, 0.028, gx * 0.008, 12);
  }

  // ---- Wheel modules ------------------------------------------------------------------------
  const rollerGeo = rollerGeometry();
  const plateGeo = { 1: sidePlateGeometry(1), '-1': sidePlateGeometry(-1) };
  const yAxis = new THREE.Vector3(0, 1, 0);
  const springCurve = new THREE.Curve();
  springCurve.getPoint = (t, target = new THREE.Vector3()) => {
    const a = t * TAU * 7;
    return target.set(Math.cos(a) * 0.012, -0.07 + t * 0.14, Math.sin(a) * 0.012);
  };
  const springGeo = new THREE.TubeGeometry(springCurve, 140, 0.0022, 5, false);
  const springs = [];
  const wheels = [];

  for (let wi = 0; wi < 4; wi++) {
    const W = KIN.wheels[wi];
    const out = Math.sign(W.l); // +1: wheel faces +x (left side)
    const fsg = Math.sign(W.f);
    const g = new THREE.Group();
    g.position.set(W.l, KIN.wheelR, W.f);
    root.add(g);
    const spin = new THREE.Group();
    g.add(spin);
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(plateGeo[String(W.s * side)], M.chrome);
      p.position.x = side * (WW / 2 - 0.004);
      spin.add(p);
    }
    cylX(spin, 0.037, WW - 0.012, M.alu, 0, 0, 0, 24);
    cylX(spin, 0.031, 0.008, M.chrome, out * (WW / 2 + 0.002), 0, 0, 24);
    cylX(spin, 0.015, 0.012, M.black, out * (WW / 2 + 0.007), 0, 0, 6);
    for (let b = 0; b < 5; b++) {
      const a = (b / 5) * TAU;
      cylX(spin, 0.003, 0.006, M.grey, out * (WW / 2 + 0.006), Math.cos(a) * 0.023, Math.sin(a) * 0.023, 6);
    }
    box(spin, 0.003, 0.005, 0.014, M.glow, out * (WW / 2 + 0.0065), 0.042, 0);
    const rollers = [];
    for (let i = 0; i < NR; i++) {
      const th = (i / NR) * TAU;
      const rh = new THREE.Vector3(0, Math.cos(th), Math.sin(th));
      const th3 = new THREE.Vector3(0, -Math.sin(th), Math.cos(th));
      const axis = new THREE.Vector3(Math.SQRT1_2, 0, 0).addScaledVector(th3, W.s * Math.SQRT1_2).normalize();
      const pivot = new THREE.Object3D();
      pivot.position.copy(rh).multiplyScalar(RHO);
      pivot.quaternion.setFromUnitVectors(yAxis, axis);
      const r = new THREE.Mesh(rollerGeo, M.rubber);
      pivot.add(r);
      spin.add(pivot);
      rollers.push(r);
    }
    // Drive train: gearbox, motor, swing arm (unsprung, so attached to root).
    const hx = W.l - out * (WW / 2 + 0.018);
    cylX(root, 0.034, 0.034, M.alu, hx, KIN.wheelR, W.f, 24);
    cylX(root, 0.03, 0.12, M.blue, W.l - out * (WW / 2 + 0.095), KIN.wheelR, W.f, 24);
    cylX(root, 0.026, 0.012, M.grey, W.l - out * (WW / 2 + 0.161), KIN.wheelR, W.f, 20);
    const arm = box(root, 0.006, 0.04, 0.2, M.alu, W.l - out * 0.062, 0.1, W.f - fsg * 0.08);
    arm.rotation.x = fsg * 0.12;
    // Coil-over shock between the arm and the frame (sprung, so attached to body).
    const shock = new THREE.Group();
    shock.position.set(W.l - out * 0.075, 0.205, W.f - fsg * 0.075);
    body.add(shock);
    cylY(shock, 0.0045, 0.16, M.chrome, 0, 0, 0, 8);
    cylY(shock, 0.009, 0.03, M.alu, 0, 0.065, 0, 12);
    const spring = new THREE.Mesh(springGeo, M.black);
    shock.add(spring);
    springs.push(spring);
    wheels.push({ group: g, spin, rollers });
  }

  // ---- VN-100 IMU clamped on the front-left wheel shaft housing ---------------------------
  const W0 = KIN.wheels[0];
  const imu = new THREE.Group();
  imu.position.set(W0.l - (WW / 2 + 0.018), KIN.wheelR, W0.f);
  root.add(imu);
  const imuBox = box(imu, 0.04, 0.016, 0.038, M.imu, 0, 0.034 + 0.008, 0);
  const imuEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(imuBox.geometry),
    new THREE.LineBasicMaterial({ color: 0xff8a4a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  imuEdges.position.copy(imuBox.position);
  imu.add(imuEdges);
  box(imu, 0.026, 0.0012, 0.018, M.label, -0.002, 0.034 + 0.0166, 0.002);
  box(imu, 0.03, 0.026, 0.046, M.tape, 0, 0.034 + 0.006, 0);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.0355, 0.0028, 6, 28), M.chrome);
  band.rotation.y = Math.PI / 2;
  band.position.x = 0.012;
  imu.add(band);
  const imuLed = new THREE.Mesh(new THREE.SphereGeometry(0.0032, 8, 6), M.led);
  imuLed.position.set(0.016, 0.034 + 0.017, 0.014);
  imu.add(imuLed);
  tube(body, [[W0.l - 0.07, 0.15, W0.f], [W0.l - 0.075, 0.22, W0.f - 0.04], [0.25, deckY + 0.012, 0.12], [0.12, deckY + 0.012, -0.02], [0.0, deckY + 0.02, -0.16]], 0.0028, M.wireBlack);

  // Merged glowing outline of the chassis (CAD-scan look).
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.Float32BufferAttribute(edgeVerts, 3));
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xa6ff3c, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const edges = new THREE.LineSegments(eg, edgeMat);
  body.add(edges);

  const sctx = screenCanvas.getContext('2d');
  function drawScreen(t, surface, rms) {
    const w = screenCanvas.width, h = screenCanvas.height;
    sctx.fillStyle = '#041004';
    sctx.fillRect(0, 0, w, h);
    sctx.fillStyle = '#a6ff3c';
    sctx.font = '15px "IBM Plex Mono", monospace';
    sctx.fillText('$ ros2 bag record /imu', 10, 22);
    sctx.fillStyle = '#7fbf3a';
    sctx.fillText('vn100  VNYMR  40 Hz', 10, 44);
    sctx.fillText('surface: ' + surface, 10, 64);
    sctx.fillText('rms ' + rms.toFixed(3) + ' g', 10, 84);
    sctx.strokeStyle = '#a6ff3c';
    sctx.lineWidth = 2;
    sctx.beginPath();
    for (let x = 0; x <= w - 20; x += 4) {
      const y = 128 + Math.sin(x * 0.18 + t * 6) * 10 * Math.min(1, rms * 6 + 0.15) * Math.sin(x * 0.05 + 1);
      if (x === 0) sctx.moveTo(10 + x, y); else sctx.lineTo(10 + x, y);
    }
    sctx.stroke();
    screenTex.needsUpdate = true;
  }
  drawScreen(0, 'tile', 0);

  const state = { padGlow: 0, screenT: 0 };
  function update(o) {
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      w.spin.rotation.x = o.wheelAngle[i];
      const ra = o.rollerAngle[i];
      for (const r of w.rollers) r.rotation.y = ra;
    }
    lidarHead.rotation.y = o.lidar;
    body.position.y = o.bob;
    body.rotation.x = o.pitch;
    body.rotation.z = o.roll;
    const sc = 1 - o.bob / 0.14;
    for (const s of springs) s.scale.y = sc;
    imuLed.visible = Math.floor(o.t * 4) % 2 === 0;
    state.padGlow = Math.max(o.padPulse || 0, state.padGlow * Math.exp(-(o.dt || 0) * 3));
    M.pad.emissiveIntensity = 0.6 * state.padGlow;
    state.screenT += o.dt || 0;
    if (state.screenT > 0.25) {
      state.screenT = 0;
      drawScreen(o.t, o.surface, o.rms);
    }
  }

  const imuWorld = (target) => imuBox.getWorldPosition(target);
  return { root, body, wheels, lidarHead, imu, imuBox, update, imuWorld, drawScreen };
}
