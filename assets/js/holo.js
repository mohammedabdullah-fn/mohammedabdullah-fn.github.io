import * as THREE from 'three';
import { smooth, radialTexture } from './util.js';

/* Holographic projector: wireframe models of my projects, swapped with a clipping-plane scan. */

const TAU = Math.PI * 2;
const CYAN = new THREE.Color(0x4fd8ff);
const hdr = (k) => CYAN.clone().multiplyScalar(k);
const X = (geo) => geo.rotateZ(Math.PI / 2);   // cylinder axis → X

class Model {
  constructor(id, title, sub, height) {
    Object.assign(this, { id, title, sub, height });
    this.group = new THREE.Group();
    this.plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e3);   // keeps y ≤ constant
    const common = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, clippingPlanes: [this.plane] };
    this.line = new THREE.LineBasicMaterial({ color: hdr(1.6), opacity: 0.9, ...common });
    this.fill = new THREE.MeshBasicMaterial({ color: hdr(0.55), opacity: 0.1, side: THREE.DoubleSide, ...common });
    this.glow = new THREE.MeshBasicMaterial({ color: hdr(2.6), opacity: 0.95, ...common });
    this.tick = () => {};
  }

  part(geo, parent = this.group, o = {}) {
    const g = new THREE.Group();
    g.position.set(o.x ?? 0, o.y ?? 0, o.z ?? 0);
    g.rotation.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
    if (o.fill !== false) g.add(new THREE.Mesh(geo, o.glow ? this.glow : this.fill));
    if (o.edges !== false && !o.glow) g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, o.angle ?? 20), this.line));
    parent.add(g);
    return g;
  }

  // Circle in the YZ plane (axis X) — seams, seals and dimension rings.
  circle(r, parent, x = 0, seg = 56) {
    const pts = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU;
      pts.push(new THREE.Vector3(0, Math.cos(a) * r, Math.sin(a) * r));
    }
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this.line);
    l.position.x = x;
    parent.add(l);
    return l;
  }

  setAlpha(k) {
    this.line.opacity = 0.9 * k;
    this.fill.opacity = 0.1 * k;
    this.glow.opacity = 0.95 * k;
  }
}

function quadruped() {
  const m = new Model('quadruped', 'QUADRUPED', 'CONCEPT MODEL', 1.2);
  const body = new THREE.Group();
  body.position.y = 0.8;
  m.group.add(body);
  m.part(new THREE.BoxGeometry(1.12, 0.26, 0.46), body);
  m.part(new THREE.BoxGeometry(0.78, 0.06, 0.34), body, { y: 0.16 });
  m.part(new THREE.BoxGeometry(0.24, 0.2, 0.36), body, { x: 0.66, y: 0.02 });
  for (const z of [-0.09, 0.09]) m.part(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 12), body, { x: 0.79, y: 0.05, z, rz: Math.PI / 2, glow: true });
  m.part(new THREE.BoxGeometry(0.16, 0.12, 0.3), body, { x: -0.64, y: 0.04 });
  const legs = [];
  for (const [x, z, ph] of [[0.4, 0.28, 0], [0.4, -0.28, Math.PI], [-0.4, 0.28, Math.PI], [-0.4, -0.28, 0]]) {
    const hip = new THREE.Group();
    hip.position.set(x, -0.1, z);
    body.add(hip);
    m.part(new THREE.SphereGeometry(0.07, 10, 6), hip, { angle: 35 });
    m.part(new THREE.BoxGeometry(0.085, 0.36, 0.085), hip, { y: -0.18 });
    const knee = new THREE.Group();
    knee.position.y = -0.36;
    hip.add(knee);
    m.part(new THREE.SphereGeometry(0.055, 10, 6), knee, { angle: 35 });
    m.part(new THREE.BoxGeometry(0.06, 0.36, 0.06), knee, { y: -0.18 });
    m.part(new THREE.SphereGeometry(0.045, 10, 6), knee, { y: -0.37, glow: true });
    legs.push({ hip, knee, ph });
  }
  m.tick = (t) => {
    const s = t * 2.3;
    for (const L of legs) {
      const p = s + L.ph;
      L.hip.rotation.z = -0.42 + Math.cos(p) * 0.2;
      L.knee.rotation.z = 0.86 + Math.max(0, Math.sin(p)) * 0.42;
    }
    body.position.y = 0.8 + Math.sin(s * 2) * 0.012;
  };
  return m;
}

// ME 5374 elbow actuator: housing, brake, frameless motor, strain-wave gear, bearing, flange, encoder.
function elbow() {
  const m = new Model('elbow', 'ELBOW ACTUATOR', 'ME 5374 · STRAIN-WAVE · EXPLODED', 1.05);
  const g = new THREE.Group();
  g.position.y = 0.62;
  g.scale.setScalar(0.85);
  m.group.add(g);
  const parts = [];
  const add = (geo, x0, spread, o = {}) => {
    const p = m.part(geo, g, { x: x0, angle: 12, ...o });
    parts.push({ p, x0, spread });
    return p;
  };
  add(X(new THREE.CylinderGeometry(0.45, 0.45, 0.04, 40)), -0.62, -1.0);                      // rear cover
  add(X(new THREE.CylinderGeometry(0.36, 0.36, 0.03, 32)), -0.52, -0.78);                      // moteus n1 board
  add(X(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 32)), -0.4, -0.52);                         // spring-applied brake
  add(X(new THREE.CylinderGeometry(0.45, 0.45, 0.9, 48, 1, true)), 0, 0, { angle: 10 });       // 6061-T6 housing
  add(X(new THREE.CylinderGeometry(0.3, 0.3, 0.18, 32, 1, true)), -0.18, -0.22);               // motor stator
  const rotor = add(X(new THREE.CylinderGeometry(0.15, 0.15, 0.18, 12)), -0.18, -0.05);        // rotor hub
  const wave = add(X(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 40)).scale(1, 1, 0.8), 0.1, 0.25); // elliptical wave generator
  add(X(new THREE.CylinderGeometry(0.3, 0.3, 0.28, 40, 1, true)), 0.2, 0.45);                  // flexspline cup
  add(X(new THREE.CylinderGeometry(0.34, 0.34, 0.08, 48, 1, true)), 0.25, 0.66);               // circular spline
  add(new THREE.TorusGeometry(0.36, 0.035, 8, 40).rotateY(Math.PI / 2), 0.38, 0.86);           // cross-roller bearing
  add(X(new THREE.CylinderGeometry(0.38, 0.38, 0.05, 40)), 0.48, 1.05);                        // output flange
  add(new THREE.RingGeometry(0.33, 0.41, 48).rotateY(Math.PI / 2), 0.53, 1.26, { glow: true }); // AksIM-2 encoder ring
  m.tick = (t) => {
    const e = smooth(0.5 - 0.5 * Math.cos(t * 0.7));
    for (const { p, x0, spread } of parts) p.position.x = x0 + spread * e * 0.55;
    rotor.rotation.x = t * 4;
    wave.rotation.x = t * 4;
  };
  return m;
}

// Mecabot Plus with the VN-100 on its wheel shaft and a live vibration trace.
function rover() {
  const m = new Model('rover', 'TERRAIN ROVER', 'VN-100 IMU · ROS 2 · 87.3%', 1.05);
  const g = new THREE.Group();
  g.position.y = 0.3;
  m.group.add(g);
  m.part(new THREE.BoxGeometry(0.95, 0.16, 0.56), g, { y: 0.04 });
  m.part(new THREE.BoxGeometry(0.98, 0.02, 0.6), g, { y: 0.13 });
  m.part(new THREE.BoxGeometry(0.3, 0.08, 0.22), g, { x: -0.15, y: 0.18 });
  const wheels = [];
  for (const x of [-0.34, 0.34]) {
    for (const s of [-1, 1]) {
      const w = m.part(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 10), g, { x, y: -0.13, z: s * 0.36, rx: Math.PI / 2, angle: 5 });
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        pts.push(new THREE.Vector3(Math.cos(a) * 0.165, -0.06, Math.sin(a) * 0.165), new THREE.Vector3(Math.cos(a + 0.5) * 0.165, 0.06, Math.sin(a + 0.5) * 0.165));
      }
      w.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), m.line));
      wheels.push(w);
    }
  }
  const imu = m.part(new THREE.BoxGeometry(0.1, 0.06, 0.08), g, { x: 0.34, y: -0.13, z: 0.47, glow: true });
  const N = 120;
  const pos = new Float32Array(N * 3);
  const traceGeo = new THREE.BufferGeometry();
  traceGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const trace = new THREE.Line(traceGeo, m.line);
  trace.position.y = 0.66;
  trace.frustumCulled = false;
  g.add(trace);
  const AMP = [0.35, 0.25, 0.12, 0.1];   // tile, hardwood, carpet, grass — the T2H amplitudes
  m.tick = (t) => {
    for (const w of wheels) w.rotation.y = -t * 3;
    imu.scale.setScalar(1 + 0.1 * Math.sin(t * 22));
    const amp = AMP[Math.floor(t / 2.5) % 4];
    const f = Math.floor(t * 30);
    for (let i = 0; i < N; i++) {
      const n = Math.sin((i * 12.9898 + f * 78.233) * 0.5) * 43758.5453;
      const noise = n - Math.floor(n) - 0.5;
      pos[i * 3] = -0.6 + (1.2 * i) / (N - 1);
      pos[i * 3 + 1] = amp * 0.32 * (Math.sin(i * 0.9 + t * 24) * 0.5 + noise);
      pos[i * 3 + 2] = 0;
    }
    traceGeo.attributes.position.needsUpdate = true;
    trace.rotation.y = -m.group.rotation.y;   // keep the trace facing the viewer
  };
  return m;
}

// Minar Industries: tie-rod hydraulic cylinder, cycling between assembled and exploded.
function hydraulic() {
  const m = new Model('hydraulic', 'HYDRAULIC CYLINDER', 'TIE-ROD DESIGN · MINAR INDUSTRIES', 1.0);
  const g = new THREE.Group();
  g.position.y = 0.62;
  g.scale.setScalar(0.8);
  m.group.add(g);
  m.part(X(new THREE.CylinderGeometry(0.2, 0.2, 0.92, 32, 1, true)), g, { angle: 10 });
  for (const x of [-0.25, 0, 0.25]) m.circle(0.2, g, x);
  const capA = m.part(new THREE.BoxGeometry(0.1, 0.5, 0.5), g, { x: -0.51 });
  const capB = m.part(new THREE.BoxGeometry(0.1, 0.5, 0.5), g, { x: 0.51 });
  for (const [y, z] of [[0.19, 0.19], [0.19, -0.19], [-0.19, 0.19], [-0.19, -0.19]]) {
    m.part(X(new THREE.CylinderGeometry(0.016, 0.016, 1.06, 6)), g, { y, z, fill: false });
  }
  const clevis = m.part(new THREE.BoxGeometry(0.18, 0.2, 0.12), g, { x: -0.66 });
  m.part(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 16), clevis, { x: -0.06, rx: Math.PI / 2 });
  const piston = new THREE.Group();
  g.add(piston);
  m.part(X(new THREE.CylinderGeometry(0.175, 0.175, 0.09, 32)), piston, { angle: 10 });
  m.circle(0.177, piston, -0.025);
  m.circle(0.177, piston, 0.025);
  m.part(X(new THREE.CylinderGeometry(0.055, 0.055, 1.0, 16)), piston, { x: 0.52, angle: 10 });
  m.part(new THREE.TorusGeometry(0.075, 0.026, 8, 24), piston, { x: 1.08, angle: 30 });
  const gland = m.part(X(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 24)), g, { x: 0.6, angle: 10 });
  m.tick = (t) => {
    const e = smooth(0.5 - 0.5 * Math.cos(t * 0.8));
    piston.position.x = -0.32 + e * 0.42;
    capA.position.x = -0.51 - e * 0.32;
    capB.position.x = 0.51 + e * 0.32;
    clevis.position.x = -0.66 - e * 0.5;
    gland.position.x = 0.6 + e * 0.5;
  };
  return m;
}

// VTU mini robotic cart chassis.
function cart() {
  const m = new Model('cart', 'ROBOTIC CART CHASSIS', 'SOLIDWORKS · VTU', 0.75);
  const g = new THREE.Group();
  g.position.y = 0.3;
  m.group.add(g);
  m.part(new THREE.BoxGeometry(1.2, 0.035, 0.62), g);
  for (const z of [-0.3, 0.3]) m.part(new THREE.BoxGeometry(1.3, 0.07, 0.05), g, { y: 0.04, z });
  for (const x of [-0.55, 0, 0.55]) m.part(new THREE.BoxGeometry(0.05, 0.07, 0.56), g, { x, y: 0.04 });
  const wheels = [];
  for (const x of [-0.42, 0.42]) {
    for (const s of [-1, 1]) {
      m.part(new THREE.BoxGeometry(0.12, 0.16, 0.04), g, { x, y: -0.06, z: s * 0.335 });
      m.part(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 16), g, { x, y: -0.08, z: s * 0.2, rx: Math.PI / 2, angle: 10 });
      wheels.push(m.part(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 20), g, { x, y: -0.12, z: s * 0.41, rx: Math.PI / 2, angle: 10 }));
    }
  }
  m.part(new THREE.BoxGeometry(0.32, 0.1, 0.2), g, { x: -0.1, y: 0.1 });
  m.part(new THREE.BoxGeometry(0.6, 0.025, 0.44), g, { y: 0.24 });
  for (const x of [-0.27, 0.27]) for (const z of [-0.19, 0.19]) m.part(new THREE.CylinderGeometry(0.012, 0.012, 0.18, 6), g, { x, y: 0.15, z, fill: false });
  m.tick = (t) => { for (const w of wheels) w.rotation.y = t * 2.2; };
  return m;
}

export class Holo {
  constructor() {
    this.group = new THREE.Group();
    this.stage = new THREE.Group();
    this.stage.position.y = 0.12;
    this.group.add(this.stage);
    this.models = [quadruped(), elbow(), rover(), hydraulic(), cart()];
    for (const m of this.models) { m.group.visible = false; this.stage.add(m.group); }
    this.index = 0;
    this.models[0].group.visible = true;
    this.phase = 'idle';
    this.pt = 0;
    this.next_ = 0;
    this.onChange = null;
    this._buildPad();
    this._buildBeam();
    this._buildSparkles();

    // invisible click target around the projection volume
    this.collider = new THREE.Mesh(
      new THREE.CylinderGeometry(1.0, 1.0, 1.7, 16),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })
    );
    this.collider.position.y = 0.85;
    this.collider.userData.holo = true;
    this.group.add(this.collider);
  }

  get current() { return this.models[this.index]; }

  // Start a scan-out / scan-in swap. Returns false if busy or already showing that model.
  next(id) {
    if (this.phase !== 'idle') return false;
    const i = id ? this.models.findIndex((m) => m.id === id) : (this.index + 1) % this.models.length;
    if (i < 0 || i === this.index) return false;
    this.next_ = i;
    this.phase = 'out';
    this.pt = 0;
    return true;
  }

  anchor(out) { return out.set(1.3, 0.9, 0.2).multiplyScalar(this.group.scale.x).add(this.group.position); }   // beside the model, in the gap between the right-hand cards

  _flat(geo, color, opacity) {
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.012;
    this.group.add(mesh);
    return mesh;
  }

  _buildPad() {
    const disc = this._flat(new THREE.CircleGeometry(1.25, 64), hdr(0.7), 0.5);
    disc.material.map = radialTexture();
    this._flat(new THREE.RingGeometry(0.95, 0.975, 128), hdr(1.9), 0.9);
    this._flat(new THREE.RingGeometry(1.08, 1.088, 128), hdr(1.2), 0.55);
    this._flat(new THREE.RingGeometry(0.55, 0.56, 96), hdr(1.2), 0.45);
    // dashed outer ring
    const pos = [];
    const idx = [];
    const dashes = 32;
    for (let i = 0; i < dashes; i++) {
      const a0 = (i / dashes) * TAU;
      const a1 = a0 + (TAU / dashes) * 0.55;
      const base = pos.length / 3;
      for (let s = 0; s <= 4; s++) {
        const a = a0 + ((a1 - a0) * s) / 4;
        pos.push(Math.cos(a) * 1.16, Math.sin(a) * 1.16, 0, Math.cos(a) * 1.2, Math.sin(a) * 1.2, 0);
        if (s < 4) {
          const v = base + s * 2;
          idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
        }
      }
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    dg.setIndex(idx);
    this.dash = this._flat(dg, hdr(1.5), 0.75);
    // tick marks
    const ticks = [];
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * TAU;
      const r0 = i % 6 === 0 ? 0.8 : 0.86;
      ticks.push(Math.cos(a) * r0, Math.sin(a) * r0, 0, Math.cos(a) * 0.9, Math.sin(a) * 0.9, 0);
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3));
    this.ticks = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: hdr(1.4), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
    this.ticks.rotation.x = -Math.PI / 2;
    this.ticks.position.y = 0.014;
    this.group.add(this.ticks);
    // scan ring used for transitions and the idle sweep
    this.scan = new THREE.Mesh(
      new THREE.RingGeometry(0.86, 0.93, 96),
      new THREE.MeshBasicMaterial({ color: hdr(2.4), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false })
    );
    this.scan.rotation.x = -Math.PI / 2;
    this.group.add(this.scan);
  }

  _buildBeam() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: hdr(0.9) }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main() {
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uTime;
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main() {
          float facing = pow(abs(dot(normalize(vN), normalize(vV))), 1.4);
          float fade = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.7);   // MSAA can extrapolate uv past 1 → keep pow's base ≥ 0
          float bands = 0.75 + 0.25 * sin(vUv.y * 46.0 - uTime * 2.4);
          float a = facing * fade * bands * 0.16;
          gl_FragColor = vec4(uColor * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.beamMat = mat;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 1.02, 1.9, 64, 1, true), mat);
    beam.position.y = 0.95;
    this.group.add(beam);
  }

  _buildSparkles() {
    const N = 240;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * TAU;
      const r = Math.sqrt(Math.random()) * 0.95;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.random() * 1.9;
      pos[i * 3 + 2] = Math.sin(a) * r;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.sparkMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: hdr(2.2) }, uScale: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform float uTime; uniform float uScale; varying float vA;
        void main() {
          vec3 p = position;
          float h = mod(p.y + uTime * (0.08 + 0.12 * aSeed), 1.9);
          p.y = h;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uScale * (1.5 + 2.5 * aSeed) * (10.0 / -mv.z);
          vA = smoothstep(0.0, 0.25, h) * smoothstep(1.9, 1.1, h) * (0.45 + 0.55 * sin(uTime * 3.0 + aSeed * 40.0));
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * max(vA, 0.0);
          gl_FragColor = vec4(uColor * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, this.sparkMat);
    pts.frustumCulled = false;
    this.group.add(pts);
  }

  update(dt, t, pixelRatio = 1) {
    const m = this.current;
    m.group.rotation.y += dt * 0.32;
    m.tick(t, dt);
    const k = this.group.scale.y;   // clip planes live in world space, so scale the heights
    const baseY = this.group.position.y + this.stage.position.y * k;
    const scanAt = (y, a) => { this.scan.position.y = (y - this.group.position.y) / k; this.scan.material.opacity = a; };

    if (this.phase === 'out') {
      this.pt += dt / 0.55;
      const h = baseY + m.height * k * (1 - smooth(this.pt));
      m.plane.constant = h;
      scanAt(h, 1);
      if (this.pt >= 1) {
        m.group.visible = false;
        m.plane.constant = 1e3;
        const prevRot = m.group.rotation.y;
        this.index = this.next_;
        const n = this.current;
        n.group.visible = true;
        n.group.rotation.y = prevRot;
        n.plane.constant = baseY;
        this.phase = 'in';
        this.pt = 0;
        this.onChange?.(n);
      }
    } else if (this.phase === 'in') {
      this.pt += dt / 0.95;
      const h = baseY + (this.current.height + 0.06) * k * smooth(this.pt);
      this.current.plane.constant = h;
      scanAt(h, 1);
      if (this.pt >= 1) { this.current.plane.constant = 1e3; this.phase = 'idle'; }
    } else {
      const s = (t * 0.22) % 1;
      scanAt(baseY + s * m.height * k, 0.32 * Math.sin(s * Math.PI));
    }

    this.current.setAlpha(0.9 + 0.1 * Math.sin(t * 47) * Math.sin(t * 13.3));
    this.dash.rotation.z = t * 0.25;
    this.ticks.rotation.z = -t * 0.08;
    this.beamMat.uniforms.uTime.value = t;
    this.sparkMat.uniforms.uTime.value = t;
    this.sparkMat.uniforms.uScale.value = pixelRatio;
  }
}
