import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Arm, L1, L2, SHOULDER_Y, REACH, DOWN, FOLDED, LIMITS, CYAN, wrapQuarter } from './arm.js';
import { Program } from './motion.js';
import { Holo } from './holo.js';
import { buildRoom, FollowSpot } from './room.js';
import { smooth, clamp, radialTexture } from './util.js';
import { Sound } from './audio.js';
import * as ui from './ui.js';

const DEBUG = new URLSearchParams(location.search).has('debug');
const canvas = document.getElementById('scene');
const $ = (id) => document.getElementById(id);
const small = () => innerWidth <= 820;
const deg = THREE.MathUtils.radToDeg;
const rad = THREE.MathUtils.degToRad;
const now = () => performance.now();

/* ---------- workcell layout (metres; the HUD shows millimetres) ---------- */
const FLOOR_Y = -1;
const TABLE = { x: -0.15, z: 1.75, w: 5.3, d: 1.7, top: 0 };
const BASE = new THREE.Vector3(0.35, 0, 1.3);
const SHOULDER = new THREE.Vector3(BASE.x, BASE.y + SHOULDER_Y, BASE.z);
const TARGET = new THREE.Vector3(1.05, 0, 2.22);   // front right of the bench, clear of the Now card
const SAFE_Y = 0.78;            // tool height while carrying a part
const TRACK_Z = BASE.z + 0.75;  // preferred depth when the tool follows the cursor
const VCART = 3.4;              // Cartesian speed cap of the servo-tracking filter (m/s)
const DWELL = 0.45;             // contact time before a hand-guided touch opens a section
const HOME = { yaw: 0.9, sh: 0.62, el: -1.5, wr: 0.15, roll: 0 };
const HOLO_LOOK = new THREE.Vector3(1.4, 1.05, 0.25);

/* ---------- renderer ---------- */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (err) {
  document.body.classList.add('no-webgl');
  throw err;
}
document.body.classList.add('webgl');
let dpr = Math.min(window.devicePixelRatio || 1, ui.coarse ? 1.5 : 1.75);
renderer.setPixelRatio(dpr);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0708);
scene.fog = new THREE.FogExp2(0x0a0708, 0.042);
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}
scene.environmentIntensity = 0.3;

const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
const LOOK = new THREE.Vector3();
const VIEW_DIR = new THREE.Vector3(0, 0.36, 1).normalize();
const camBase = new THREE.Vector3();
let introK = ui.reducedMotion ? 1 : 0;

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: ui.coarse ? 0 : 4 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.55, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ---------- lights + room ---------- */
scene.add(new THREE.HemisphereLight(0x6b5862, 0x140a0b, 0.5));
const rim = new THREE.PointLight(0xff2a2a, 20, 14, 2);
rim.position.set(-3.6, 1.9, 0.5);
const low = new THREE.PointLight(0xff1e1e, 6, 6, 2);
low.position.set(-0.6, 0.5, 3.2);
const cyanFill = new THREE.PointLight(0x4fd8ff, 6, 7, 2);
cyanFill.position.set(0.4, 0.9, -1.4);
const front = new THREE.DirectionalLight(0xc4cbe0, 0.45);
front.position.set(-2, 3.5, 8);
scene.add(rim, low, cyanFill, front);
const room = buildRoom(scene, { floorY: FLOOR_Y, base: BASE });
const spot = new FollowSpot(scene);

/* ---------- materials ---------- */
const red = (k) => new THREE.Color(k, k * 0.07, k * 0.085);
const cyanMat = (k, opacity = 0.9) => new THREE.MeshBasicMaterial({ color: CYAN.clone().multiplyScalar(k), toneMapped: false, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
const ringMat = new THREE.MeshBasicMaterial({ color: red(1.5), toneMapped: false, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide });
const discMat = new THREE.MeshBasicMaterial({ map: radialTexture(), color: red(0.9), transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
const flat = (geo, mat, parent = scene) => {
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  parent.add(m);
  return m;
};

/* ---------- workbench ---------- */
function tableTexture() {
  const W = 2048;
  const H = Math.round((W * TABLE.d) / TABLE.w);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const draw = () => {
    const g = c.getContext('2d');
    const ppu = W / TABLE.w;
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,60,60,0.09)';
    g.lineWidth = 1.5;
    for (let x = 0; x <= TABLE.w + 1e-6; x += 0.25) { g.beginPath(); g.moveTo(x * ppu, 0); g.lineTo(x * ppu, H); g.stroke(); }
    for (let z = 0; z <= TABLE.d + 1e-6; z += 0.25) { g.beginPath(); g.moveTo(0, z * ppu); g.lineTo(W, z * ppu); g.stroke(); }
    g.strokeStyle = 'rgba(255,60,60,0.32)';
    g.lineWidth = 3;
    g.strokeRect(16, 16, W - 32, H - 32);
    g.strokeStyle = 'rgba(255,80,80,0.55)';
    g.lineWidth = 2;
    for (const [x, y] of [[44, 44], [W - 44, 44], [44, H - 44], [W - 44, H - 44]]) {
      g.beginPath(); g.moveTo(x - 18, y); g.lineTo(x + 18, y); g.moveTo(x, y - 18); g.lineTo(x, y + 18); g.stroke();
    }
    g.fillStyle = 'rgba(255,70,70,0.6)';
    g.font = '600 28px "JetBrains Mono", monospace';
    g.textAlign = 'center';
    g.fillText('WORKSPACE 01 · MA-01', W / 2, H - 40);
    tex.needsUpdate = true;
  };
  draw();
  document.fonts?.ready.then(draw);
  return tex;
}

{
  const top = new THREE.Mesh(new RoundedBoxGeometry(TABLE.w, 0.12, TABLE.d, 2, 0.025), new THREE.MeshStandardMaterial({ color: 0x3b1014, roughness: 0.5, metalness: 0.35 }));
  top.position.set(TABLE.x, TABLE.top - 0.06, TABLE.z);
  top.receiveShadow = true;
  scene.add(top);
  const body = new THREE.Mesh(new THREE.BoxGeometry(TABLE.w - 0.3, TABLE.top - 0.12 - FLOOR_Y, TABLE.d - 0.3), new THREE.MeshStandardMaterial({ color: 0x120c0d, roughness: 0.8, metalness: 0.2 }));
  body.position.set(TABLE.x, (TABLE.top - 0.12 + FLOOR_Y) / 2, TABLE.z);
  body.castShadow = true;
  body.receiveShadow = true;
  scene.add(body);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(TABLE.w - 0.04, 0.01, 0.01), new THREE.MeshBasicMaterial({ color: red(1.8), toneMapped: false }));
  lip.position.set(TABLE.x, TABLE.top - 0.004, TABLE.z + TABLE.d / 2 + 0.004);
  scene.add(lip);
  const decal = flat(new THREE.PlaneGeometry(TABLE.w, TABLE.d), new THREE.MeshBasicMaterial({ map: tableTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  decal.position.set(TABLE.x, TABLE.top + 0.0015, TABLE.z);
}

/* ---------- parts on the bench (front left of the base, where no card covers them) ---------- */
const PART_DEFS = [
  { kind: 'cube', name: 'Cube', geo: new RoundedBoxGeometry(0.24, 0.24, 0.24, 4, 0.025), mat: new THREE.MeshPhysicalMaterial({ color: 0xd0181f, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2 }), halfH: 0.12, r: 0.14, grip: 0.69, home: [-0.85, 2.0], yaw: 0.55 },
  { kind: 'cylinder', name: 'Cylinder', geo: new THREE.CylinderGeometry(0.115, 0.115, 0.32, 48), mat: new THREE.MeshPhysicalMaterial({ color: 0x0d0d10, roughness: 0.28, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.15 }), halfH: 0.16, r: 0.115, grip: 0.66, home: [-0.45, 2.38], yaw: 0 },
  { kind: 'sphere', name: 'Sphere', geo: new THREE.SphereGeometry(0.13, 48, 32), mat: new THREE.MeshPhysicalMaterial({ color: 0xf1ede8, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.1 }), halfH: 0.13, r: 0.13, grip: 0.76, home: [0.0, 2.25], yaw: 0 },
];
const props = PART_DEFS.map((def) => {
  const mesh = new THREE.Mesh(def.geo, def.mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(def.home[0], TABLE.top + def.halfH, def.home[1]);
  mesh.rotation.y = def.yaw;
  scene.add(mesh);
  const ring = flat(new THREE.RingGeometry(def.r + 0.05, def.r + 0.072, 64), ringMat.clone());
  const glow = flat(new THREE.CircleGeometry(def.r + 0.22, 48), discMat.clone());
  const p = { ...def, mesh, ring, glow, vy: 0, held: false, hover: 0, hoverGoal: 0 };
  mesh.userData.prop = p;
  return p;
});

const target = (() => {
  const g = new THREE.Group();
  g.position.set(TARGET.x, TABLE.top + 0.003, TARGET.z);
  scene.add(g);
  const mat = new THREE.MeshBasicMaterial({ color: red(1.5), toneMapped: false, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
  const outer = flat(new THREE.RingGeometry(0.33, 0.35, 96), mat, g);
  flat(new THREE.RingGeometry(0.2, 0.21, 96), mat, g);
  flat(new THREE.PlaneGeometry(0.3, 0.012), mat, g);
  flat(new THREE.PlaneGeometry(0.012, 0.3), mat, g);
  const disc = flat(new THREE.CircleGeometry(0.7, 64), discMat.clone(), g);
  disc.material.opacity = 0.35;
  return { g, mat, outer, pulse: 0 };
})();

/* ---------- guides: drop marker, ground marker, plumb line, trail, path, envelope ---------- */
const dropMarker = new THREE.Group();
const dropRingMat = cyanMat(1.8);
flat(new THREE.RingGeometry(0.16, 0.175, 64), dropRingMat, dropMarker);
{
  const a = flat(new THREE.PlaneGeometry(0.42, 0.008), cyanMat(1.4, 0.7), dropMarker);
  const b = flat(new THREE.PlaneGeometry(0.008, 0.42), a.material, dropMarker);
  b.position.y = a.position.y;
}
dropMarker.visible = false;
scene.add(dropMarker);

const groundMarker = new THREE.Group();
flat(new THREE.RingGeometry(0.075, 0.085, 48), cyanMat(1.4, 0.55), groundMarker);
flat(new THREE.CircleGeometry(0.012, 16), cyanMat(2, 0.9), groundMarker);
scene.add(groundMarker);

const plumbMat = new THREE.LineDashedMaterial({ color: CYAN.clone().multiplyScalar(1.5), dashSize: 0.035, gapSize: 0.03, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false });
const plumb = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]), plumbMat);
plumb.frustumCulled = false;
scene.add(plumb);

const TRAIL_N = 90;
const trailPos = new Float32Array(TRAIL_N * 3);
const trailCol = new Float32Array(TRAIL_N * 3);
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
trail.frustumCulled = false;
scene.add(trail);
const trailPts = [];

const pathMat = new THREE.LineDashedMaterial({ color: CYAN.clone().multiplyScalar(1.6), dashSize: 0.07, gapSize: 0.05, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
const pathLine = new THREE.Line(new THREE.BufferGeometry(), pathMat);
pathLine.frustumCulled = false;
scene.add(pathLine);
const wpMat = cyanMat(2.2, 0);
const wpGeo = new THREE.OctahedronGeometry(0.035);
const waypoints = Array.from({ length: 12 }, () => {
  const m = new THREE.Mesh(wpGeo, wpMat);
  m.visible = false;
  scene.add(m);
  return m;
});
let pathAlpha = 0;
let pathGoal = 0;

const envelope = (() => {
  const pts = [];
  const seg = 72;
  for (let lat = -10; lat <= 80; lat += 15) {
    const ph = rad(lat);
    const y = REACH * Math.sin(ph);
    const rr = REACH * Math.cos(ph);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      pts.push(rr * Math.cos(a0), y, rr * Math.sin(a0), rr * Math.cos(a1), y, rr * Math.sin(a1));
    }
  }
  for (let lon = 0; lon < 360; lon += 30) {
    const a = rad(lon);
    for (let lat = -10; lat < 90; lat += 5) {
      const p0 = rad(lat);
      const p1 = rad(lat + 5);
      pts.push(REACH * Math.cos(p0) * Math.cos(a), REACH * Math.sin(p0), REACH * Math.cos(p0) * Math.sin(a), REACH * Math.cos(p1) * Math.cos(a), REACH * Math.sin(p1), REACH * Math.cos(p1) * Math.sin(a));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const env = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: CYAN.clone().multiplyScalar(1.2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  env.position.copy(SHOULDER);
  env.frustumCulled = false;
  scene.add(env);
  return env;
})();

/* ---------- sparks ---------- */
class Sparks {
  constructor(n = 240) {
    this.n = n;
    this.i = 0;
    this.pos = new Float32Array(n * 3).fill(-999);
    this.vel = new Float32Array(n * 3);
    this.base = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo = geo;
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.05, map: radialTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    pts.frustumCulled = false;
    scene.add(pts);
  }

  burst(p, count, speed, color) {
    for (let k = 0; k < count; k++) {
      const i = this.i;
      this.i = (this.i + 1) % this.n;
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.vel[i * 3] = s * Math.cos(th) * sp;
      this.vel[i * 3 + 1] = Math.abs(u) * sp + speed * 0.35;
      this.vel[i * 3 + 2] = s * Math.sin(th) * sp;
      this.base[i * 3] = color.r; this.base[i * 3 + 1] = color.g; this.base[i * 3 + 2] = color.b;
      this.life[i] = 1;
    }
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] = Math.max(0, this.life[i] - dt * 1.5);
      this.vel[i * 3 + 1] -= 5 * dt;
      for (let a = 0; a < 3; a++) {
        this.vel[i * 3 + a] *= 1 - dt * 1.2;
        this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt;
        this.col[i * 3 + a] = this.base[i * 3 + a] * this.life[i];
      }
    }
    if (any || this._dirty) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
    }
    this._dirty = any;
  }
}
const sparks = new Sparks();
const SPARK_CYAN = new THREE.Color(0.5, 1.6, 2.2);
const SPARK_RED = new THREE.Color(2.4, 0.3, 0.3);

/* ---------- robot, hologram, sound ---------- */
const arm = new Arm();
arm.root.position.copy(BASE);
scene.add(arm.root);
const holo = new Holo();
holo.group.position.set(1.75, FLOOR_Y, -2.2);   // quadruped hologram stands to the right of the arm
holo.group.scale.setScalar(1.18);
scene.add(holo.group);
const sound = new Sound();
const pickList = [...arm.pickables, ...props.map((p) => p.mesh), holo.collider];

/* ---------- controller state ----------
   `ref` is the commanded reference (tool pose + joint values). Every mode writes it, the
   servos follow it, and every hand-off starts from it, so switching modes never jumps. */
const ref = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), pitch: 0, q: { ...FOLDED } };
arm.fk(ref.q, ref.pos);
ref.pitch = ref.q.sh + ref.q.el + ref.q.wr;

const state = {
  mode: 'boot',          // boot · track · drag · prog · jog · explode
  held: null,
  prog: null,
  progKind: '',
  drag: null,
  demo: false,
  align: null,           // world yaw the fingers should square up to (cubes)
  holdRoll: false,
  placeSpot: null,
  lookUntil: 0,
  hits: 0,
  design: false,
  explode: 0, explodeFrom: 0, explodeTo: 0, explodeT: 1,
  contact: null, contactT: 0, cooldown: 0,
  hoverCard: null,
  firstPick: true,
  speed: 1,
};
const ctx = { ref, arm, speed: () => state.speed };

const pointer = { seen: false, last: -1e9, inCanvas: false, x: 0, y: 0 };
const ndc = new THREE.Vector2(0.45, 0.05);
const raycaster = new THREE.Raycaster();
const carryPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SAFE_Y);
let canvasRect = canvas.getBoundingClientRect();
let hoverDirty = true;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _goal = new THREE.Vector3();
const _tcp = new THREE.Vector3();
const _acc = new THREE.Vector3();
const _oc = new THREE.Vector3();
const _proj = new THREE.Vector3();
const ZERO = new THREE.Vector3();

/* ---------- geometry helpers ---------- */
function setNdc(x, y) {
  ndc.set(((x - canvasRect.left) / canvasRect.width) * 2 - 1, -((y - canvasRect.top) / canvasRect.height) * 2 + 1);
}

function rayFrom(nx, ny) {
  raycaster.setFromCamera(_c.set(nx, ny, 0), camera);
  return raycaster.ray;
}

function prefT(r, z) {
  if (Math.abs(r.direction.z) < 1e-4) return 6;
  const t = (z - r.origin.z) / r.direction.z;
  return t > 0 ? t : 6;
}

const COLUMN_R = 0.7;   // keep-out radius around the base yaw axis (wrist singularity)

function inColumn(r, t) {
  const x = r.origin.x + r.direction.x * t - BASE.x;
  const z = r.origin.z + r.direction.z * t - BASE.z;
  return x * x + z * z < (COLUMN_R + 0.02) ** 2;
}

/* Point on the cursor ray that the tool can actually reach: inside the soft reach sphere, above
   `minY` and outside the base column, as close as possible to the preferred depth.
   Because it stays on the ray, the tool tip lands exactly under the cursor whenever it can. */
function reachOnRay(r, pref, minY, out) {
  _oc.subVectors(r.origin, SHOULDER);
  const b = _oc.dot(r.direction);
  const disc = b * b - (_oc.lengthSq() - REACH * REACH);
  if (disc < 0) return out.copy(r.origin).addScaledVector(r.direction, Math.max(0.5, -b));
  const sq = Math.sqrt(disc);
  let lo = Math.max(0.5, -b - sq);
  let hi = -b + sq;
  if (r.direction.y < -1e-4) hi = Math.min(hi, (minY - r.origin.y) / r.direction.y);
  else if (r.direction.y > 1e-4) lo = Math.max(lo, (minY - r.origin.y) / r.direction.y);
  if (lo > hi) return out.copy(r.origin).addScaledVector(r.direction, clamp(pref, Math.max(0.5, -b - sq), -b + sq));
  let t = clamp(pref, lo, hi);
  if (inColumn(r, t)) {
    // leave the column on the near (camera) side, or the far side if the near one is out of
    // reach. Always the same side for a given ray, so the target never flips between them.
    const [t0, t1] = columnSpan(r);
    if (t0 - 0.02 >= lo) t = t0 - 0.02;
    else if (t1 + 0.02 <= hi) t = t1 + 0.02;
  }
  return out.copy(r.origin).addScaledVector(r.direction, t);
}

// Where the ray enters and leaves the vertical keep-out cylinder around the base axis.
function columnSpan(r) {
  const px = r.origin.x - BASE.x;
  const pz = r.origin.z - BASE.z;
  const a = r.direction.x * r.direction.x + r.direction.z * r.direction.z;
  if (a < 1e-8) return [Infinity, -Infinity];
  const b = 2 * (r.direction.x * px + r.direction.z * pz);
  const c = px * px + pz * pz - (COLUMN_R + 0.02) ** 2;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [Infinity, -Infinity];
  const s = Math.sqrt(disc);
  return [(-b - s) / (2 * a), (-b + s) / (2 * a)];
}

// Keep a tool target inside the work envelope, above `minY` and out of the base column.
function clampWorkspace(p, minY) {
  if (p.y < minY) p.y = minY;
  _oc.subVectors(p, SHOULDER);
  const d = _oc.length();
  if (d > REACH) p.copy(SHOULDER).addScaledVector(_oc, REACH / d);
  const dx = p.x - BASE.x;
  const dz = p.z - BASE.z;
  const hr = Math.hypot(dx, dz);
  if (hr < 0.7) {
    if (hr < 1e-4) { p.x = BASE.x; p.z = BASE.z + 0.7; }
    else { p.x = BASE.x + (dx * 0.7) / hr; p.z = BASE.z + (dz * 0.7) / hr; }
  }
  if (p.y < minY) p.y = minY;
  return p;
}

function clampToTable(p, margin) {
  p.x = clamp(p.x, TABLE.x - TABLE.w / 2 + margin, TABLE.x + TABLE.w / 2 - margin);
  p.z = clamp(p.z, TABLE.z - TABLE.d / 2 + margin, TABLE.z + TABLE.d / 2 - margin);
  return p;
}

function clampRadius(p, rMin, rMax) {
  const dx = p.x - BASE.x;
  const dz = p.z - BASE.z;
  const r = Math.hypot(dx, dz) || 1e-4;
  const k = clamp(r, rMin, rMax) / r;
  p.x = BASE.x + dx * k;
  p.z = BASE.z + dz * k;
  return p;
}

// Tool pitch for tracking: aim along the reach direction, bowing down when the arm is relaxed.
function pitchFor(p) {
  const dr = Math.hypot(p.x - BASE.x, p.z - BASE.z);
  const dy = p.y - SHOULDER.y;
  const ext = Math.min(1, Math.hypot(dr, dy) / REACH);
  return clamp(Math.atan2(dy, dr) - 0.55 * (1 - THREE.MathUtils.smoothstep(ext, 0.7, 0.95)), -1.45, 1.2);
}

function pitchToward(p) {
  return clamp(Math.atan2(p.y - SHOULDER.y, Math.hypot(p.x - BASE.x, p.z - BASE.z)), -1.2, 1.2);
}

function idleWeight() {
  if (!pointer.seen) return 1;
  return THREE.MathUtils.smoothstep((now() - pointer.last) / 1000, 5, 7.5);
}

function wander(t, out) {
  return out.set(BASE.x + 1.0 + Math.sin(t * 0.33) * 1.05, 0.95 + Math.sin(t * 0.51 + 1.3) * 0.32, BASE.z + 0.65 + Math.cos(t * 0.27) * 0.35);
}

const toScreen = (v, out) => {
  _proj.copy(v).project(camera);
  out.x = canvasRect.left + (_proj.x * 0.5 + 0.5) * canvasRect.width;
  out.y = canvasRect.top + (-_proj.y * 0.5 + 0.5) * canvasRect.height;
  out.visible = _proj.z > -1 && _proj.z < 1;
  return out;
};

const yawOf = (mesh) => new THREE.Euler().setFromQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;

/* ---------- servo filtering ----------
   Two cascaded critically damped stages: a fast pre-filter smooths the raw cursor target, and the
   follower tracks the pre-filtered point. A sudden cursor jump therefore produces an S-curve:
   velocity and acceleration both start from zero, there is no overshoot, and speed is capped. */
const filt = { p: new THREE.Vector3(), v: new THREE.Vector3(), pitch: 0, pv: 0, valid: false };

function filterPose(dt, goal, pitchGoal, w) {
  if (!Number.isFinite(goal.x + goal.y + goal.z + pitchGoal)) return;   // never let a bad ray poison the reference
  if (!filt.valid) {
    filt.p.copy(ref.pos);
    filt.v.copy(ref.vel);
    filt.pitch = ref.pitch;
    filt.pv = 0;
    filt.valid = true;
  }
  const w1 = w * 1.8;
  const n = Math.max(1, Math.ceil(dt / 0.008));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    _acc.subVectors(goal, filt.p).multiplyScalar(w1 * w1).addScaledVector(filt.v, -2 * w1);
    filt.v.addScaledVector(_acc, h);
    filt.p.addScaledVector(filt.v, h);
    _acc.subVectors(filt.p, ref.pos).multiplyScalar(w * w).addScaledVector(ref.vel, -2 * w);
    ref.vel.addScaledVector(_acc, h);
    const sp = ref.vel.length();
    if (sp > VCART) ref.vel.multiplyScalar(VCART / sp);
    ref.pos.addScaledVector(ref.vel, h);
    filt.pv += ((pitchGoal - filt.pitch) * w1 * w1 - 2 * w1 * filt.pv) * h;
    filt.pitch += filt.pv * h;
    ref.pitch += (filt.pitch - ref.pitch) * (1 - Math.exp(-h * w));
  }
}

function trackGoal(t, out) {
  const r = rayFrom(ndc.x, ndc.y);
  reachOnRay(r, prefT(r, TRACK_Z), TABLE.top + 0.3, out);
  const idle = idleWeight();
  if (idle > 0) out.lerp(wander(t, _b), idle);
  if (now() < state.lookUntil) out.lerp(HOLO_LOOK, 0.85);
  return clampWorkspace(out, TABLE.top + 0.3);
}

function carryPoint(out) {
  const r = rayFrom(ndc.x, ndc.y);
  carryPlane.constant = -SAFE_Y;
  if (!r.intersectPlane(carryPlane, out)) out.copy(ref.pos);
  clampToTable(out, 0.22);
  clampRadius(out, 0.85, 2.05);
  out.y = SAFE_Y;
  return out;
}

function dragGoal(out) {
  const d = state.drag;
  const r = rayFrom(ndc.x, ndc.y);
  let tp = prefT(r, TRACK_Z);
  if (r.intersectPlane(d.plane, _a)) tp = _a.distanceTo(r.origin);
  const minY = state.held ? TABLE.top + state.held.halfH + 0.05 : TABLE.top + 0.12;
  reachOnRay(r, tp, minY, out);
  out.addScaledVector(d.offset, Math.exp(-(simT - d.s0) / 0.22));   // grab offset melts away: the tool ends up under the cursor
  return clampWorkspace(out, minY);
}

/* ---------- parts: support, placement, attach ---------- */
function supportTop(prop, x, z, maxY = Infinity) {
  let top = TABLE.top;
  for (const o of props) {
    if (o === prop || o.held) continue;
    const oTop = o.mesh.position.y + o.halfH;
    if (oTop > maxY + 0.02) continue;
    if (Math.hypot(x - o.mesh.position.x, z - o.mesh.position.z) < (prop.r + o.r) * 0.6) top = Math.max(top, oTop);
  }
  return top;
}

const loadOn = (o) => props.find((p) => p !== o && !p.held && p.mesh.position.y > o.mesh.position.y + 0.01 && Math.hypot(p.mesh.position.x - o.mesh.position.x, p.mesh.position.z - o.mesh.position.z) < (p.r + o.r) * 0.6);

function topOf(prop) {
  let p = prop;
  for (let i = 0; i < 3; i++) {
    const up = loadOn(p);
    if (!up) break;
    p = up;
  }
  return p;
}

// Where a part would land if released over (x, z): snaps into the target, stacks neatly, never clips.
function computeSpot(prop, x, z) {
  if (Math.hypot(x - TARGET.x, z - TARGET.z) < 0.36) { x = TARGET.x; z = TARGET.z; }
  for (let it = 0; it < 3; it++) {
    for (const o of props) {
      if (o === prop || o.held) continue;
      const ox = o.mesh.position.x;
      const oz = o.mesh.position.z;
      let dx = x - ox;
      let dz = z - oz;
      let d = Math.hypot(dx, dz);
      const clear = prop.r + o.r + 0.03;
      if (d >= clear) continue;
      if (o.kind !== 'sphere' && d < o.r * 0.9 && !loadOn(o)) { x = ox; z = oz; continue; }
      if (d < 1e-3) { dx = 1; dz = 0; d = 1; }
      x = ox + (dx / d) * clear;
      z = oz + (dz / d) * clear;
    }
    const p = clampRadius(clampToTable(_b.set(x, 0, z), 0.22), 0.85, 2.05);
    x = p.x;
    z = p.z;
  }
  return new THREE.Vector3(x, supportTop(prop, x, z) + prop.halfH, z);
}

function attach(prop) {
  arm.tcp.attach(prop.mesh);
  prop.held = true;
  prop.vy = 0;
  state.held = prop;
  sparks.burst(arm.tcpWorld(_a), 14, 0.9, SPARK_CYAN);
}

function release(prop) {
  scene.attach(prop.mesh);
  const e = new THREE.Euler().setFromQuaternion(prop.mesh.quaternion, 'YXZ');
  prop.mesh.rotation.set(0, e.y, 0);
  prop.held = false;
  prop.vy = 0;
  if (state.held === prop) state.held = null;
}

function detach(prop, spot) {
  release(prop);
  prop.mesh.position.copy(spot);
  if (Math.hypot(spot.x - TARGET.x, spot.z - TARGET.z) < 0.05) {
    target.pulse = 1;
    state.hits++;
    sound.chime();
    sparks.burst(_a.set(TARGET.x, spot.y, TARGET.z), 60, 2.2, SPARK_RED);
    if (!state.demo) ui.toast(`Target acquired · ${prop.name} · ${state.hits} placed`);
  }
}

function dropHeld() {
  const prop = state.held;
  if (!prop) return;
  const p = prop.mesh.getWorldPosition(_a);
  const s = computeSpot(prop, p.x, p.z);
  release(prop);
  prop.mesh.position.set(s.x, Math.max(p.y, s.y), s.z);
}

function resetParts() {
  props.forEach((p, i) => {
    if (p.held) release(p);
    const atHome = Math.hypot(p.mesh.position.x - p.home[0], p.mesh.position.z - p.home[1]) < 0.02 && Math.abs(p.mesh.position.y - (TABLE.top + p.halfH)) < 0.01;
    if (atHome) return;
    p.mesh.position.set(p.home[0], TABLE.top + p.halfH + 0.8 + i * 0.15, p.home[1]);
    p.mesh.rotation.set(0, p.yaw, 0);
    p.vy = 0;
  });
}

/* ---------- motion programs ---------- */
const above = (p, y) => new THREE.Vector3(p.x, y, p.z);
const TAG = { cube: 'Cube', cylinder: 'Cyl', sphere: 'Sphere' };

function pickSteps(prop) {
  const n = TAG[prop.kind];
  const p0 = prop.mesh.position.clone();
  p0.y = supportTop(prop, p0.x, p0.z, p0.y - prop.halfH) + prop.halfH;   // where it will rest (it may still be falling)
  return [
    { kind: 'movej', label: `Approach ${prop.name}`, code: `MoveJ p${n}Above, v1000, z50, tGripper;`, v: 1.35, at: above(p0, Math.max(SAFE_Y, p0.y + 0.45)),
      to: () => ({ pos: above(prop.mesh.position, Math.max(SAFE_Y, prop.mesh.position.y + 0.45)), pitch: DOWN }),
      enter: () => { arm.grip = 1; state.holdRoll = false; state.align = prop.kind === 'cube' ? yawOf(prop.mesh) : null; } },
    { kind: 'movel', label: `Descend to ${prop.name}`, code: `MoveL p${n}Grasp, v200, fine, tGripper;`, v: 1.1, tol: 0.008, at: p0.clone(),
      to: () => ({ pos: prop.mesh.position.clone(), pitch: DOWN }) },
    { kind: 'grip', label: `Grasp ${prop.name}`, code: 'SetDO doGrip, 1;', value: prop.grip, dur: 0.34,
      enter: () => sound.grip(), exit: () => attach(prop) },
    { kind: 'movel', label: `Lift ${prop.name}`, code: `MoveL p${n}Lift, v500, z10, tGripper;`, v: 1.5, at: above(p0, SAFE_Y),
      to: () => ({ pos: above(ref.pos, SAFE_Y), pitch: DOWN }),
      enter: () => { state.align = null; state.holdRoll = true; } },
  ];
}

function placeSteps(prop, spotFn, preview) {
  let spot = null;
  const est = preview ?? spotFn();
  const clearY = (p) => Math.max(SAFE_Y, p.y + 0.4);
  return [
    { kind: 'movej', label: `Transfer ${prop.name}`, code: 'MoveJ pPlaceAbove, v1000, z50, tGripper;', v: 1.35, at: above(est, clearY(est)),
      to: () => { spot = spotFn(); state.placeSpot = spot; return { pos: above(spot, clearY(spot)), pitch: DOWN }; } },
    { kind: 'movel', label: `Place ${prop.name}`, code: 'MoveL pPlace, v150, fine, tGripper;', v: 1.0, tol: 0.008, at: est.clone(),
      to: () => ({ pos: spot.clone(), pitch: DOWN }) },
    { kind: 'grip', label: `Release ${prop.name}`, code: 'SetDO doGrip, 0;', value: 1, dur: 0.3,
      enter: () => { detach(prop, spot); sound.release(); } },
    { kind: 'movel', label: 'Retract', code: 'MoveL pRetract, v500, z10, tGripper;', v: 1.5, at: above(est, clearY(est)),
      to: () => ({ pos: above(ref.pos, clearY(spot)), pitch: DOWN }),
      enter: () => { state.holdRoll = false; state.placeSpot = null; } },
  ];
}

function waveSteps() {
  const camYaw = Math.atan2(camera.position.x - BASE.x, camera.position.z - BASE.z);
  const pose = { yaw: camYaw, sh: 1.25, el: -0.72, wr: 0.3, roll: 0 };
  const D = 2.4;
  let b = null;
  return [
    { kind: 'movej', label: 'Raise to wave', code: 'MoveAbsJ jWave, v1500, z50, tGripper;', v: 1.5, toJ: () => pose,
      enter: () => { state.align = null; state.holdRoll = false; } },
    { kind: 'joints', label: 'Hello!', code: 'Wave \\Cycles:=4;', dur: D,
      enter: () => { b = { ...ref.q }; },
      fn: (t, q) => {
        const env = smooth(Math.min(1, t / 0.5)) * smooth(Math.min(1, (D - t) / 0.5));
        // 1.1 Hz wave sized so yaw/wrist/roll stay inside their servo acceleration limits
        const s = Math.sin(t * 7);
        q.yaw = b.yaw + 0.17 * s * env;
        q.wr = b.wr + 0.32 * Math.sin(t * 7 + 0.9) * env;
        q.roll = 0.42 * s * env;
        arm.grip = 0.55 + 0.45 * Math.cos(t * 14) * env;
      },
      exit: () => { arm.grip = 1; } },
  ];
}

function showPath(steps) {
  const pts = [ref.pos.clone()];
  for (const s of steps) if (s.at) pts.push(s.at.clone());
  waypoints.forEach((m, i) => {
    m.visible = i < pts.length - 1;
    if (m.visible) m.position.copy(pts[i + 1]);
  });
  if (pts.length < 2) { pathGoal = 0; return; }
  pathLine.geometry.dispose();
  pathLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  pathLine.computeLineDistances();
  pathGoal = 0.9;
}

function runProgram(steps, kind, onDone) {
  state.prog?.cancel();
  state.mode = 'prog';
  state.progKind = kind;
  showPath(steps);
  state.prog = new Program(steps, ctx, () => {
    state.prog = null;
    pathGoal = 0;
    onDone?.();
    if (state.mode === 'prog' && !state.prog) state.mode = 'track';
  });
}

function startPick(prop) {
  prop = topOf(prop);
  sound.click();
  runProgram(pickSteps(prop), 'pick', () => {
    if (!state.firstPick) return;
    state.firstPick = false;
    ui.toast(`${ui.coarse ? 'Tap' : 'Click'} the bench to set it down, or drop it on the target ◎`, { ms: 3800 });
  });
}

function startPlace() {
  const prop = state.held;
  if (!prop) return;
  const p = carryPoint(_a);
  const spot = computeSpot(prop, p.x, p.z);
  sound.click();
  runProgram(placeSteps(prop, () => spot, spot), 'place');
}

function startWave() {
  if (state.mode !== 'track') return;
  if (state.held) { ui.toast('Set the part down first, then wave', { tone: 'red' }); return; }
  sound.click();
  runProgram(waveSteps(), 'wave');
}

function goHome() {
  if (state.mode === 'prog' || state.mode === 'explode' || state.mode === 'boot') return;
  runProgram([{ kind: 'movej', label: 'Home', code: 'MoveAbsJ jHome, v1000, fine, tGripper;', v: 1.1, toJ: () => HOME }], 'home');
}

// The arm reaches over and physically presses a card or dock button.
function startPress(id, sx, sy, open) {
  if (state.mode === 'jog') state.mode = 'track';
  const r = rayFrom(((sx - canvasRect.left) / canvasRect.width) * 2 - 1, -((sy - canvasRect.top) / canvasRect.height) * 2 + 1);
  const point = clampWorkspace(reachOnRay(r, prefT(r, TRACK_Z), TABLE.top + 0.3, new THREE.Vector3()), TABLE.top + 0.3);
  const dir = point.clone().sub(camera.position).normalize();
  const pitch = pitchToward(point);
  const approach = clampWorkspace(point.clone().addScaledVector(dir, -0.22), TABLE.top + 0.3);
  const poke = point.clone().addScaledVector(dir, 0.04);
  const n = id.charAt(0).toUpperCase() + id.slice(1);
  runProgram([
    { kind: 'movej', label: `Reach ${n}`, code: `MoveJ p${n}, v2000, z20, tProbe;`, v: 2.5, at: approach, to: () => ({ pos: approach, pitch }) },
    { kind: 'movel', label: `Touch ${n}`, code: `MoveL p${n}Touch, v400, fine, tProbe;`, v: 1.6, at: poke, to: () => ({ pos: poke, pitch }) },
    { kind: 'call', fn: () => {
      sparks.burst(arm.tcpWorld(_a), 26, 1.5, SPARK_CYAN);
      if (open) activate(id);
      else { ui.pulse(id); sound.press(); }
    } },
    { kind: 'movel', label: 'Withdraw', code: 'MoveL pClear, v800, z10, tProbe;', v: 1.5, to: () => ({ pos: approach, pitch }) },
  ], 'press');
}

function activate(id, { gesture = false } = {}) {
  state.cooldown = simT + 1.2;
  state.contactT = 0;
  ui.pulse(id);
  sound.press();
  if (ui.SHEETS.includes(id)) { ui.openSection(id); return; }
  const link = ui.LINKS[id];
  if (!link) return;
  if (id === 'email') {
    if (gesture) location.href = link.href;
    else ui.toast('Email', { href: link.href, label: 'mohammedabdullah.fn@northeastern.edu' });
    return;
  }
  const w = window.open(link.href, '_blank');
  if (w) w.opener = null;
  else ui.toast('Pop-up blocked', { href: link.href, label: `Open ${link.label} ↗` });
}

/* ---------- demo ---------- */
function startDemo() {
  if (state.mode === 'boot' || state.mode === 'explode' || state.demo) return;
  if (state.drag) endDrag(null, true);
  if (state.prog) { state.prog.cancel(); state.prog = null; }
  if (state.held) dropHeld();
  resetParts();
  state.demo = true;
  state.hits = 0;
  setDemoButton(true);
  const [cube, cyl] = props;
  const onTarget = (p) => () => computeSpot(p, TARGET.x, TARGET.z);
  const cubeSpot = new THREE.Vector3(TARGET.x, TABLE.top + cube.halfH, TARGET.z);
  const cylSpot = new THREE.Vector3(TARGET.x, TABLE.top + cube.halfH * 2 + cyl.halfH, TARGET.z);
  const steps = [
    { kind: 'wait', label: 'Initialize', code: 'PROC main()', dur: 0.7, enter: () => { arm.grip = 1; } },
    ...pickSteps(cube),
    ...placeSteps(cube, onTarget(cube), cubeSpot),
    ...pickSteps(cyl),
    ...placeSteps(cyl, onTarget(cyl), cylSpot),
    ...waveSteps(),
    { kind: 'movej', label: 'Home', code: 'MoveAbsJ jHome, v1000, fine, tGripper;', v: 1.1, toJ: () => HOME },
    { kind: 'wait', label: 'Done', code: 'ENDPROC', dur: 0.4 },
  ];
  sound.chime();
  runProgram(steps, 'demo', () => endDemo(true));
}

function stopDemo() {
  if (!state.demo) return;
  state.prog?.cancel();
  state.prog = null;
  pathGoal = 0;
  if (state.mode === 'prog') state.mode = 'track';
  endDemo(false);
}

function endDemo(done) {
  state.demo = false;
  state.align = null;
  if (!state.held) { state.holdRoll = false; arm.grip = 1; }
  ui.demoStatus(false);
  setDemoButton(false);
  if (done) ui.toast(`Demo complete · ${state.hits} parts on target`);
  else if (state.held) ui.toast(`Holding the ${state.held.name.toLowerCase()} · click the bench to place it`);
}

function demoInfo() {
  const p = state.prog;
  if (!p || !p.step) return {};
  const lines = [];
  let line = -1;
  p.steps.forEach((s, i) => {
    if (!s.code) return;
    if (i <= p.i) line = lines.length;
    lines.push(s.code);
  });
  return { label: p.step.label, step: Math.min(p.i + 1, p.steps.length), total: p.steps.length, progress: p.progress, lines, line };
}

/* ---------- explode view + jog ---------- */
function toggleExplode() {
  if (state.mode === 'explode') {
    if (state.explodeTo === 0) return;
    state.explodeFrom = state.explode;
    state.explodeTo = 0;
    state.explodeT = 0;
    setText($('pd-explode'), 'Explode');
    sound.sweep();
    return;
  }
  if (state.mode !== 'track' && state.mode !== 'jog') return;
  if (state.held) { ui.toast('Set the part down before exploding the assembly', { tone: 'red' }); return; }
  state.mode = 'explode';
  state.explodeFrom = state.explode;
  state.explodeTo = 1;
  state.explodeT = 0;
  setText($('pd-explode'), 'Collapse');
  sound.sweep();
}

function updateExplode(dt) {
  if (state.explodeT >= 1) return;
  state.explodeT = Math.min(1, state.explodeT + dt / 1.3);
  state.explode = state.explodeFrom + (state.explodeTo - state.explodeFrom) * smooth(state.explodeT);
  arm.explode(state.explode);
  if (state.explodeT >= 1 && state.explodeTo === 0 && state.mode === 'explode') state.mode = 'track';
}

function jog(j, v) {
  if (state.mode === 'prog' || state.mode === 'explode' || state.mode === 'boot' || state.drag) return;
  state.mode = 'jog';
  ref.q[j] = clamp(v, LIMITS[j][0], LIMITS[j][1]);
  arm.fk(ref.q, ref.pos);
  ref.pitch = ref.q.sh + ref.q.el + ref.q.wr;
  ref.vel.set(0, 0, 0);
}

/* ---------- hand-guiding (drag) ---------- */
function startDrag(hit, e) {
  if (state.mode === 'jog') state.mode = 'track';
  const n = camera.getWorldDirection(new THREE.Vector3()).negate();
  const tcp = arm.tcpWorld(new THREE.Vector3());
  state.drag = {
    plane: new THREE.Plane().setFromNormalAndCoplanarPoint(n, tcp),
    offset: tcp.clone().sub(hit.point),
    t0: now(), s0: simT, x0: e.clientX, y0: e.clientY, moved: false, id: e.pointerId,
  };
  state.mode = 'drag';
  try { canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  document.body.classList.add('dragging');
  sound.click();
}

function endDrag(e, silent = false) {
  const d = state.drag;
  if (!d) return;
  state.drag = null;
  document.body.classList.remove('dragging');
  try { canvas.releasePointerCapture(d.id); } catch { /* already released */ }
  if (state.mode === 'drag') state.mode = 'track';
  if (silent) return;
  if (state.contact && simT > state.cooldown) { activate(state.contact, { gesture: true }); return; }
  if (!d.moved && now() - d.t0 < 320) startWave();
}

const canPress = () => !small() && (state.mode === 'track' || state.mode === 'jog') && !state.held && !state.drag;

/* ---------- input ---------- */
function pick() {
  raycaster.setFromCamera(ndc, camera);
  for (const h of raycaster.intersectObjects(pickList, false)) {
    const prop = h.object.userData.prop;
    if (prop?.held) continue;   // the carried part rides under the cursor: clicking it means "place"
    if (prop) return { type: 'prop', prop, hit: h };
    if (h.object.userData.holo) return { type: 'holo', hit: h };
    return { type: 'arm', hit: h };
  }
  return null;
}

addEventListener('pointermove', (e) => {
  pointer.seen = true;
  pointer.last = now();
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.inCanvas = e.target === canvas;
  setNdc(e.clientX, e.clientY);
  hoverDirty = true;
  if (state.drag && Math.hypot(e.clientX - state.drag.x0, e.clientY - state.drag.y0) > 5) state.drag.moved = true;
  reticle.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
}, { passive: true });

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || ui.isModalOpen()) return;
  pointer.seen = true;
  pointer.last = now();
  setNdc(e.clientX, e.clientY);
  if (state.mode === 'boot' || state.mode === 'explode') return;
  if (state.mode === 'prog') {
    if (state.demo) ui.toast('Demo running · press Stop Demo or Esc', { tone: 'red' });
    return;
  }
  if (state.mode === 'jog') state.mode = 'track';
  const hit = pick();
  if (hit?.type === 'arm') { startDrag(hit.hit, e); return; }
  if (state.held) { startPlace(); return; }
  if (hit?.type === 'prop') { startPick(hit.prop); return; }
  if (hit?.type === 'holo') transform();
});
addEventListener('pointerup', (e) => { if (state.drag) endDrag(e); });
addEventListener('pointercancel', () => { if (state.drag) endDrag(null, true); });

addEventListener('keydown', (e) => {
  if (ui.isModalOpen()) return;
  const tag = document.activeElement?.tagName;
  const onControl = tag === 'BUTTON' || tag === 'A' || tag === 'INPUT';
  if (e.code === 'Space' && !onControl) { e.preventDefault(); startWave(); }
  else if (e.key === 'Escape') {
    if (state.demo) stopDemo();
    else if (state.mode === 'explode') toggleExplode();
    else if (state.design) setDesign(false);
  }
});

ui.bus.addEventListener('card-hover', (e) => { state.hoverCard = e.detail; });
ui.bus.addEventListener('touch-request', (e) => {
  if (!canPress()) return;
  e.preventDefault();
  startPress(e.detail.id, e.detail.x, e.detail.y, true);
});
ui.bus.addEventListener('touch-show', (e) => { if (canPress()) startPress(e.detail.id, e.detail.x, e.detail.y, false); });
ui.bus.addEventListener('holo', (e) => { transform(e.detail); state.lookUntil = now() + 1600; });
ui.bus.addEventListener('section', (e) => { if (e.detail && state.drag) endDrag(null, true); });

/* ---------- toolbar + pendant ---------- */
const btnTransform = $('btn-transform');
const btnDemo = $('btn-demo');
const btnAudio = $('btn-audio');
const btnDesign = $('btn-design');
const flashEl = $('flash');

function setText(el, s) {
  if (el && el._t !== s) { el._t = s; el.textContent = s; }
}

function setDemoButton(on) {
  btnDemo.classList.toggle('on', on);
  btnDemo.querySelector('.ico').textContent = on ? '■' : '▶';
  btnDemo.querySelector('.lbl').textContent = on ? 'Stop Demo' : 'Run Demo';
}

function transform(id) {
  if (!holo.next(id)) return false;
  sound.sweep();
  flashEl.classList.remove('go');
  void flashEl.offsetWidth;
  flashEl.classList.add('go');
  state.lookUntil = now() + 1600;
  state.holoAt = simT;
  btnTransform.disabled = true;
  setTimeout(() => { btnTransform.disabled = false; }, 1600);
  return true;
}

function setDesign(on) {
  state.design = on;
  document.body.classList.toggle('design', on);
  btnDesign.classList.toggle('on', on);
  btnDesign.setAttribute('aria-pressed', String(on));
  arm.setDesign(on && $('pd-frames').getAttribute('aria-pressed') === 'true');
  if (!on && state.mode === 'explode') toggleExplode();
  if (!on && state.mode === 'jog') state.mode = 'track';
  sound.click();
}

btnTransform.addEventListener('click', () => transform());
btnDemo.addEventListener('click', () => (state.demo ? stopDemo() : startDemo()));
btnDesign.addEventListener('click', () => setDesign(!state.design));
btnAudio.addEventListener('click', async () => {
  const on = await sound.setEnabled(!sound.enabled);
  btnAudio.classList.toggle('on', on);
  btnAudio.setAttribute('aria-pressed', String(on));
  if (on) sound.chime();
});

const PD = ['yaw', 'sh', 'el', 'wr', 'roll'];
const pd = { active: null };
for (const j of PD) {
  const input = $(`pd-${j}`);
  input.min = deg(LIMITS[j][0]).toFixed(1);
  input.max = deg(LIMITS[j][1]).toFixed(1);
  input.step = '0.5';
  input.addEventListener('input', () => jog(j, rad(+input.value)));
  input.addEventListener('pointerdown', () => { pd.active = j; });
  input.addEventListener('focus', () => { pd.active = j; });
  input.addEventListener('blur', () => { pd.active = null; });
  pd[j] = { input, out: input.parentElement.querySelector('output') };
}
$('pd-grip').addEventListener('input', (e) => { arm.grip = +e.target.value / 100; });
$('pd-speed').addEventListener('input', (e) => {
  state.speed = +e.target.value / 100;
  setText($('pd-speed').parentElement.querySelector('output'), `${e.target.value}%`);
});
$('pd-home').addEventListener('click', goHome);
$('pd-explode').addEventListener('click', toggleExplode);
$('pd-frames').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(on));
  arm.setDesign(on && state.design);
});

/* ---------- control loop ---------- */
function control(dt, t) {
  if (state.mode !== 'track' && state.mode !== 'drag') filt.valid = false;   // re-seed the filter on hand-back
  switch (state.mode) {
    case 'track':
      if (state.held) filterPose(dt, carryPoint(_goal), DOWN, 6.5);
      else filterPose(dt, trackGoal(t, _goal), pitchFor(_goal), 7.5);
      arm.solve(ref.pos, ref.pitch, ref.q, ref.q.yaw);
      break;
    case 'drag':
      dragGoal(_goal);
      filterPose(dt, _goal, state.held ? DOWN : pitchFor(_goal), 15);
      arm.solve(ref.pos, ref.pitch, ref.q, ref.q.yaw);
      break;
    case 'prog':
      state.prog?.update(dt);
      break;
    default:
      break;
  }
  // tool roll: square the fingers to a cube while picking, hold it while carrying, else neutral
  const rollFree = state.mode === 'jog' || (state.mode === 'prog' && state.prog?.rollOverride);
  if (!rollFree) {
    // the cube's faces repeat every 90°: pick the equivalent roll nearest the current one, so the
    // fingers turn continuously while the base swings instead of flicking a quarter turn
    if (state.align !== null) ref.q.roll += wrapQuarter(ref.q.yaw - state.align - ref.q.roll);
    else if (!state.holdRoll) ref.q.roll = 0;
  }
  arm.servo = state.mode === 'drag' ? 26 : 20;
  arm.setGoals(state.mode === 'boot' ? FOLDED : ref.q);
  arm.update(dt);
}

function updateProps(dt) {
  for (const p of props) {
    if (p.held) {
      p.mesh.position.lerp(ZERO, 1 - Math.exp(-dt * 14));
      p.ring.visible = false;
      p.glow.visible = false;
      continue;
    }
    const x = p.mesh.position.x;
    const z = p.mesh.position.z;
    const rest = supportTop(p, x, z, p.mesh.position.y - p.halfH) + p.halfH;
    if (p.mesh.position.y > rest + 1e-4 || p.vy !== 0) {
      p.vy -= 9.8 * dt;
      p.mesh.position.y += p.vy * dt;
      if (p.mesh.position.y <= rest) {
        p.mesh.position.y = rest;
        if (p.vy < -1.2) { sound.thud(); p.vy = -p.vy * 0.22; } else p.vy = 0;
      }
    }
    const onBench = rest - p.halfH <= TABLE.top + 1e-3;
    p.ring.visible = onBench;
    p.glow.visible = onBench;
    p.ring.position.set(x, TABLE.top + 0.003, z);
    p.glow.position.set(x, TABLE.top + 0.002, z);
    p.hover += (p.hoverGoal - p.hover) * (1 - Math.exp(-dt * 10));
    p.ring.material.opacity = 0.55 + p.hover * 0.45;
    p.ring.scale.setScalar(1 + p.hover * 0.18);
    p.glow.material.opacity = 0.35 + p.hover * 0.45;
  }
}

function updateTrail(tcp) {
  const last = trailPts[trailPts.length - 1];
  if (!last || last.distanceToSquared(tcp) > 0.0004) {
    trailPts.push(tcp.clone());
    if (trailPts.length > TRAIL_N) trailPts.shift();
  } else if (trailPts.length > 1) {
    trailPts.shift();
  }
  const n = trailPts.length;
  for (let i = 0; i < TRAIL_N; i++) {
    const j = i - (TRAIL_N - n);
    const p = trailPts[Math.max(0, j)] ?? tcp;
    trailPos[i * 3] = p.x;
    trailPos[i * 3 + 1] = p.y;
    trailPos[i * 3 + 2] = p.z;
    const k = j < 0 ? 0 : (j / Math.max(1, n - 1)) ** 2 * 1.5;
    trailCol[i * 3] = 0.34 * k;
    trailCol[i * 3 + 1] = 0.88 * k;
    trailCol[i * 3 + 2] = 1.0 * k;
  }
  trailGeo.attributes.position.needsUpdate = true;
  trailGeo.attributes.color.needsUpdate = true;
}

function updateWorld(dt, t) {
  arm.tcpWorld(_tcp);
  spot.update(dt, t, _tcp);
  room.update(dt, t, spot, renderer.getPixelRatio());
  holo.update(dt, t, renderer.getPixelRatio());

  target.pulse = Math.max(0, target.pulse - dt * 1.1);
  const k = 1.5 + target.pulse * 3 + Math.sin(t * 2.2) * 0.15;
  target.mat.color.setRGB(k, k * 0.07, k * 0.085);
  target.outer.scale.setScalar(1 + target.pulse * 0.35);

  // where a carried part would land, or where the tool is over the bench
  let drop = null;
  if (state.held) {
    drop = state.placeSpot ?? (state.mode === 'track' ? computeSpot(state.held, ...xz(carryPoint(_a))) : null);
  }
  dropMarker.visible = !!drop;
  if (drop) {
    dropMarker.position.set(drop.x, drop.y - state.held.halfH + 0.004, drop.z);
    const onT = Math.hypot(drop.x - TARGET.x, drop.z - TARGET.z) < 0.05;
    dropMarker.scale.setScalar(onT ? 1.25 + Math.sin(t * 8) * 0.05 : 1);
    dropRingMat.color.copy(onT ? red(2.4) : CYAN.clone().multiplyScalar(1.8));
  }
  const overBench = Math.abs(_tcp.x - TABLE.x) < TABLE.w / 2 && Math.abs(_tcp.z - TABLE.z) < TABLE.d / 2;
  groundMarker.visible = !drop && overBench && state.mode !== 'boot';
  groundMarker.position.set(_tcp.x, TABLE.top + 0.004, _tcp.z);
  const plumbOn = (drop || (overBench && (state.design || state.mode === 'drag'))) && state.mode !== 'boot';
  plumb.visible = !!plumbOn;
  if (plumbOn) {
    const pa = plumb.geometry.attributes.position;
    const bottomY = drop ? drop.y - state.held.halfH : TABLE.top;
    pa.setXYZ(0, _tcp.x, _tcp.y, _tcp.z);
    pa.setXYZ(1, drop ? drop.x : _tcp.x, bottomY + 0.004, drop ? drop.z : _tcp.z);
    pa.needsUpdate = true;
    plumb.computeLineDistances();
  }

  // the quadruped is the hologram's resting model: return to it after a project has been shown
  if (holo.index !== 0 && holo.phase === 'idle' && simT - (state.holoAt ?? 0) > 14) { holo.next('quadruped'); state.holoAt = simT; }

  updateTrail(_tcp);
  pathAlpha += (pathGoal - pathAlpha) * (1 - Math.exp(-dt * 6));
  pathMat.opacity = pathAlpha;
  wpMat.opacity = pathAlpha;
  for (const w of waypoints) {
    w.rotation.y += dt * 2;
    if (pathAlpha < 0.01) w.visible = false;
  }
  sparks.update(dt);
  const envGoal = state.mode === 'drag' ? 0.3 : state.design ? 0.14 : 0;
  envelope.material.opacity += (envGoal - envelope.material.opacity) * (1 - Math.exp(-dt * 5));
  envelope.visible = envelope.material.opacity > 0.005;
}

const xz = (v) => [v.x, v.z];

/* ---------- camera ---------- */
const camOff = new THREE.Vector2();
const _look = new THREE.Vector3();

function fitCamera(w, h) {
  const aspect = w / h;
  const s = w <= 820;
  camera.fov = s ? 48 : 36;
  const tanH = Math.tan(rad(camera.fov / 2));
  const boxW = s ? 5.4 : 8.4;
  const boxH = s ? 4.3 : 4.5;
  const dist = Math.max(boxH / 2 / tanH, boxW / 2 / (tanH * aspect));
  LOOK.set(s ? 0.35 : 0.15, s ? 0.2 : 0.3, s ? 0.45 : 0.2);
  camBase.copy(LOOK).addScaledVector(VIEW_DIR, dist);
}

function updateCamera(dt) {
  if (introK < 1 && state.mode !== 'boot') introK = Math.min(1, introK + dt / 2.4);
  const e = smooth(introK);
  const k = 1 - Math.exp(-dt * 2.2);
  const allow = !ui.reducedMotion && !ui.coarse && state.mode !== 'drag' && !ui.isModalOpen();
  camOff.x += ((allow ? ndc.x : 0) - camOff.x) * k;
  camOff.y += ((allow ? ndc.y : 0) - camOff.y) * k;
  camera.position.set(camBase.x + camOff.x * 0.32, camBase.y + camOff.y * 0.16 + (1 - e) * 2.6, camBase.z + (1 - e) * 3.2);
  _look.copy(LOOK);
  _look.y += (1 - e) * 0.6;
  camera.lookAt(_look);
  camera.updateMatrixWorld();   // HUD projection and contact tests use this frame's camera, not last frame's
}

/* ---------- HUD: joint tag, hologram tag, live CAD dimensions, triad, contact, pendant ---------- */
const hudJoint = $('hud-joint');
const hudJointA = $('hud-joint-a');
const hudJointS = $('hud-joint-s');
const hudHolo = $('hud-holo');
const hudHoloA = $('hud-holo-a');
const hudHoloS = $('hud-holo-s');
const reticle = $('reticle');
const reticleLabel = $('reticle-label');
const contactEl = $('contact');
const contactProg = contactEl.querySelector('.c-prog');
const contactLabel = $('contact-label');
const CIRC = 2 * Math.PI * 26;
const dimsEl = $('dims');
const titleBlock = $('title-block');
const exTags = $('ex-tags');
const EX_PARTS = [
  ['yaw', 'J0 · Base yaw turret'], ['sh', 'J1 · Shoulder actuator'], ['el', 'J2 · Elbow · ME 5374 concept'],
  ['wr', 'J3 · Wrist pitch'], ['roll', 'J4 · Tool roll flange'], ['tcp', 'EOAT · Parallel gripper'],
];
const exEls = EX_PARTS.map(([, label]) => {
  const el = document.createElement('div');
  el.className = 'ex-tag';
  el.innerHTML = '<i></i><span></span>';
  el.querySelector('span').textContent = label;
  exTags.append(el);
  return el;
});

holo.onChange = (m) => {
  hudHoloA.textContent = `HOLO · ${m.title}`;
  delete hudHoloA.dataset.text;
  hudHoloS.textContent = m.sub;
  ui.scramble(hudHoloA, 500);
};
hudHoloA.textContent = `HOLO · ${holo.current.title}`;
hudHoloS.textContent = holo.current.sub;

function modeLabel() {
  switch (state.mode) {
    case 'boot': return 'BOOT';
    case 'track': return state.held ? 'HOLDING PART' : idleWeight() > 0.5 ? 'IDLE · SCAN' : 'SERVO · TRACKING';
    case 'drag': return 'HAND-GUIDING';
    case 'jog': return 'JOG · PENDANT';
    case 'explode': return 'EXPLODED VIEW';
    case 'prog': {
      const s = state.prog?.step;
      if (!s) return 'PROGRAM';
      const k = s.kind === 'movel' ? 'MOVEL' : s.kind === 'movej' ? 'MOVEJ' : s.kind === 'grip' ? 'SETDO' : 'RUN';
      return `${k} · ${s.label.toUpperCase()}`;
    }
    default: return '';
  }
}

const scr = { tcp: {}, sh: {}, el: {}, wr: {}, gnd: {}, holo: {}, tmp: {} };

function setLine(line, x1, y1, x2, y2) {
  line.setAttribute('x1', x1.toFixed(1));
  line.setAttribute('y1', y1.toFixed(1));
  line.setAttribute('x2', x2.toFixed(1));
  line.setAttribute('y2', y2.toFixed(1));
}

// Linear "smart dimension" between two projected points, offset to the upper side.
function linearDim(id, a, b, off, text) {
  const g = $(id);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 36 || !a.visible || !b.visible) { g.style.opacity = '0'; return; }
  g.style.opacity = '';
  let nx = -dy / len;
  let ny = dx / len;
  if (ny > 0) { nx = -nx; ny = -ny; }
  const [e1, e2, dl] = g.querySelectorAll('line');
  const t = g.querySelector('text');
  setLine(e1, a.x + nx * 6, a.y + ny * 6, a.x + nx * (off + 6), a.y + ny * (off + 6));
  setLine(e2, b.x + nx * 6, b.y + ny * 6, b.x + nx * (off + 6), b.y + ny * (off + 6));
  setLine(dl, a.x + nx * off, a.y + ny * off, b.x + nx * off, b.y + ny * off);
  let ang = deg(Math.atan2(dy, dx));
  if (ang > 90) ang -= 180;
  if (ang < -90) ang += 180;
  const mx = (a.x + b.x) / 2 + nx * (off + 9);
  const my = (a.y + b.y) / 2 + ny * (off + 9);
  t.setAttribute('transform', `translate(${mx.toFixed(1)} ${my.toFixed(1)}) rotate(${ang.toFixed(1)})`);
  setText(t, text);
}

function angleDim(id, c, p1, p2, r, text) {
  const g = $(id);
  if (!c.visible) { g.style.opacity = '0'; return; }
  g.style.opacity = '';
  const a1 = Math.atan2(p1.y - c.y, p1.x - c.x);
  let da = Math.atan2(p2.y - c.y, p2.x - c.x) - a1;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  const a2 = a1 + da;
  const sx = c.x + r * Math.cos(a1);
  const sy = c.y + r * Math.sin(a1);
  const ex = c.x + r * Math.cos(a2);
  const ey = c.y + r * Math.sin(a2);
  g.querySelector('path').setAttribute('d', `M ${sx.toFixed(1)} ${sy.toFixed(1)} A ${r} ${r} 0 0 ${da > 0 ? 1 : 0} ${ex.toFixed(1)} ${ey.toFixed(1)}`);
  const mid = a1 + da / 2;
  const t = g.querySelector('text');
  t.setAttribute('x', (c.x + (r + 18) * Math.cos(mid)).toFixed(1));
  t.setAttribute('y', (c.y + (r + 18) * Math.sin(mid) + 3).toFixed(1));
  setText(t, text);
}

function heightDim(id, top, bottom, text) {
  const g = $(id);
  if (!top.visible || !bottom.visible || Math.abs(bottom.y - top.y) < 30) { g.style.opacity = '0'; return; }
  g.style.opacity = '';
  const x = Math.max(top.x, bottom.x) + 34;
  const [e1, e2, dl] = g.querySelectorAll('line');
  setLine(e1, top.x + 8, top.y, x + 6, top.y);
  setLine(e2, bottom.x + 8, bottom.y, x + 6, bottom.y);
  setLine(dl, x, top.y, x, bottom.y);
  const t = g.querySelector('text');
  t.setAttribute('transform', `translate(${(x + 12).toFixed(1)} ${((top.y + bottom.y) / 2).toFixed(1)}) rotate(-90)`);
  setText(t, text);
}

const triadAxes = [['tx', 'tlx', new THREE.Vector3(1, 0, 0)], ['ty', 'tly', new THREE.Vector3(0, 1, 0)], ['tz', 'tlz', new THREE.Vector3(0, 0, 1)]];
function updateTriad() {
  for (const [lineId, labelId, axis] of triadAxes) {
    _a.copy(axis).transformDirection(camera.matrixWorldInverse);
    if (!Number.isFinite(_a.x + _a.y)) return;
    const x = 40 + _a.x * 26;
    const y = 40 - _a.y * 26;
    setLine($(lineId), 40, 40, x, y);
    const l = $(labelId);
    l.setAttribute('x', (40 + _a.x * 34).toFixed(1));
    l.setAttribute('y', (40 - _a.y * 34 + 3).toFixed(1));
  }
}

// Card / dock rectangles, cached: reading layout every frame after HUD writes forces a reflow per frame.
let touchRects = [];
let rectsAge = Infinity;
function refreshTouchRects() {
  touchRects = ui.touchTargets().map((t) => ({ id: t.id, r: t.el.getBoundingClientRect() }));
  rectsAge = 0;
}
addEventListener('resize', () => { rectsAge = Infinity; });
addEventListener('scroll', () => { rectsAge = Infinity; }, { passive: true });

function updateContact(dt) {
  let hit = null;
  const tip = scr.tcp;
  const eligible = !small() && !ui.isModalOpen() && tip.visible && (state.mode === 'track' || state.mode === 'drag' || state.mode === 'prog');
  if (eligible) {
    for (const { id, r } of touchRects) {
      if (r.width && tip.x > r.left + 6 && tip.x < r.right - 6 && tip.y > r.top + 6 && tip.y < r.bottom - 6) { hit = id; break; }
    }
  }
  if (hit !== state.contact) {
    state.contact = hit;
    state.contactT = 0;
    ui.setContact(hit);
    if (hit) { sound.tick(); sparks.burst(_tcp, 8, 0.6, SPARK_CYAN); }
  }
  const isSheet = hit && ui.SHEETS.includes(hit);
  if (hit && state.mode === 'drag' && simT > state.cooldown) {
    state.contactT += dt;
    if (isSheet && state.contactT >= DWELL) {
      endDrag(null, true);
      activate(hit);
    }
  }
  contactEl.classList.toggle('on', !!hit);
  if (hit) {
    contactEl.style.transform = `translate3d(${tip.x.toFixed(1)}px, ${tip.y.toFixed(1)}px, 0)`;
    const p = state.mode === 'drag' ? (isSheet ? clamp(state.contactT / DWELL, 0, 1) : 1) : 0;
    contactProg.style.strokeDashoffset = (CIRC * (1 - p)).toFixed(1);
    setText(contactLabel, state.mode === 'drag' ? (isSheet ? 'Opening' : 'Release to open') : 'Contact');
  }
}

let hudFrame = 0;
function updateHUD(dt) {
  if (++rectsAge > 30) refreshTouchRects();
  const show = !small() && !ui.isModalOpen() && state.mode !== 'boot';
  toScreen(_tcp, scr.tcp);
  toScreen(arm.shoulderWorld(_a), scr.sh);
  toScreen(arm.elbowWorld(_a), scr.el);
  toScreen(arm.wristWorld(_a), scr.wr);
  toScreen(_a.set(_tcp.x, TABLE.top, _tcp.z), scr.gnd);

  // joint tag: the wrist normally, the elbow when the Now card (the elbow project) is in focus
  const elbowMode = state.hoverCard === 'now' || state.contact === 'now';
  arm.elbowGoal = elbowMode ? 1 : 0;
  const an = elbowMode ? scr.el : scr.wr;
  hudJoint.style.transform = `translate3d(${an.x.toFixed(1)}px, ${an.y.toFixed(1)}px, 0)`;
  hudJoint.classList.toggle('on', show && an.visible && state.explode < 0.05);
  const inner = 180 - Math.abs(deg(elbowMode ? arm.j.el.x : arm.j.wr.x));
  setText(hudJointA, `${elbowMode ? 'ELBOW' : 'WRIST'} ${inner.toFixed(0)}°`);
  setText(hudJointS, elbowMode ? 'J2 · ME 5374 ACTUATOR' : `J3 · ${modeLabel()}`);

  toScreen(holo.anchor(_a), scr.holo);
  hudHolo.style.transform = `translate3d(${scr.holo.x.toFixed(1)}px, ${scr.holo.y.toFixed(1)}px, 0)`;
  hudHolo.classList.toggle('on', show && scr.holo.visible);

  // live dimensions only while designing or hand-guiding: keeps the default view calm
  const dimsOn = show && state.explode < 0.05 && (state.design || state.mode === 'drag');
  dimsEl.classList.toggle('on', dimsOn);
  dimsEl.classList.toggle('bright', state.design || state.mode === 'drag');
  if (dimsOn) {
    linearDim('dim-l1', scr.sh, scr.el, 30, `L1 ${(L1 * 1000).toFixed(0)}`);
    linearDim('dim-l2', scr.el, scr.wr, 30, `L2 ${(L2 * 1000).toFixed(0)}`);
    angleDim('dim-ang', scr.el, scr.sh, scr.wr, 40, `${(180 - Math.abs(deg(arm.j.el.x))).toFixed(1)}°`);
    if (state.design || state.mode === 'drag') heightDim('dim-z', scr.tcp, scr.gnd, `Z ${((_tcp.y - TABLE.top) * 1000).toFixed(0)}`);
    else $('dim-z').style.opacity = '0';
  }
  updateTriad();

  // exploded-view callouts
  const exOn = state.explode > 0.04 && show;
  exTags.classList.toggle('on', exOn);
  if (exOn) {
    EX_PARTS.forEach(([key], i) => {
      const w = key === 'tcp' ? _tcp : arm.groups[key].getWorldPosition(_a);
      toScreen(w, scr.tmp);
      exEls[i].style.transform = `translate3d(${scr.tmp.x.toFixed(1)}px, ${scr.tmp.y.toFixed(1)}px, 0)`;
      exEls[i].style.opacity = String(clamp((state.explode - 0.3) * 2, 0, 1));
    });
  }

  // reticle + contact marker
  updateContact(dt);

  // title block: sketch-state language from CAD
  let status = 'full';
  for (const k of ['yaw', 'sh', 'el', 'wr']) {
    const J = arm.j[k];
    if (J.x <= J.min + 0.01 || J.x >= J.max - 0.01) status = 'over';
  }
  if (status !== 'over' && state.mode === 'drag') status = 'under';
  titleBlock.dataset.status = status;
  setText($('tb-status'), status === 'over' ? 'Over defined · joint at limit' : status === 'under' ? 'Under defined · hand-guiding' : 'Fully defined');

  // pendant readouts (every third frame)
  if (state.design && hudFrame++ % 3 === 0) {
    for (const j of PD) {
      const x = arm.j[j].x;
      setText(pd[j].out, `${deg(x).toFixed(1)}°`);
      if (pd.active !== j) pd[j].input.value = deg(x).toFixed(1);
      pd[j].input.parentElement.classList.toggle('limit', x <= arm.j[j].min + 0.02 || x >= arm.j[j].max - 0.02);
    }
    setText($('pd-x'), `X ${((_tcp.x - BASE.x) * 1000).toFixed(0)}`);
    setText($('pd-y'), `Y ${((_tcp.z - BASE.z) * 1000).toFixed(0)}`);
    setText($('pd-z'), `Z ${((_tcp.y - BASE.y) * 1000).toFixed(0)}`);
    setText($('pd-mode'), modeLabel().split(' · ')[0]);
    if (document.activeElement !== $('pd-grip')) $('pd-grip').value = String(Math.round(arm.grip * 100));
  }

  if (state.demo && state.prog) ui.demoStatus(true, demoInfo());
}

function updateHover() {
  if (ui.coarse) return;
  let label = '';
  let hot = false;
  let hoverProp = null;
  const show = pointer.inCanvas && !ui.isModalOpen();
  if (show) {
    if (state.mode === 'drag') { label = state.contact ? 'Release to open' : 'Hand-guiding'; hot = true; }
    else if (state.mode === 'prog') label = state.demo ? 'Demo running' : 'Busy';
    else if (state.mode === 'explode') label = 'Exploded view';
    else {
      const h = pick();
      if (h?.type === 'arm') { label = 'Drag · tap to wave'; hot = true; }
      else if (state.held) { label = 'Place here'; hot = true; }
      else if (h?.type === 'prop') { label = `Pick ${h.prop.name}`; hot = true; hoverProp = h.prop; }
      else if (h?.type === 'holo') { label = 'Transform'; hot = true; }
    }
  }
  for (const p of props) p.hoverGoal = p === hoverProp ? 1 : 0;
  reticle.classList.toggle('on', show);
  reticle.classList.toggle('hot', hot);
  setText(reticleLabel, label);
  canvas.style.cursor = show ? 'none' : '';
}

/* ---------- sizing, visibility, performance ---------- */
function resize() {
  const w = canvas.clientWidth || innerWidth;
  const h = canvas.clientHeight || innerHeight;
  if (!w || !h) return;   // hidden or not laid out yet: keep the last good size
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(dpr);
  composer.setSize(w, h);
  camera.aspect = w / h;
  fitCamera(w, h);
  camera.updateProjectionMatrix();
  canvasRect = canvas.getBoundingClientRect();
}
addEventListener('resize', resize);
addEventListener('scroll', () => { canvasRect = canvas.getBoundingClientRect(); }, { passive: true });
fitCamera(1600, 900);   // sane framing even before the first real layout
resize();

let onScreen = true;
new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; }).observe(canvas);

let perfAcc = 0;
let perfN = 0;
let perfLevel = 0;
function perf(dt, t) {
  if (t < 4) return;
  perfAcc += dt;
  if (++perfN < 120) return;
  const avg = perfAcc / perfN;
  perfAcc = 0;
  perfN = 0;
  if (avg < 1 / 40 || perfLevel >= 3) return;
  perfLevel++;
  if (perfLevel === 1) { dpr = Math.max(1, dpr - 0.5); resize(); }
  else if (perfLevel === 2) {
    renderer.shadowMap.enabled = false;
    scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  } else { dpr = 1; bloom.strength *= 0.85; resize(); }
}

/* ---------- main loop ---------- */
const clock = new THREE.Clock();
let frame = 0;
let simT = 0;

function frameStep(dt, render = true) {
  simT += dt;
  const t = simT;
  control(dt, t);
  updateExplode(dt);
  updateProps(dt);
  updateWorld(dt, t);
  updateCamera(dt);
  if (hoverDirty || (frame & 3) === 0) { hoverDirty = false; updateHover(); }
  updateHUD(dt);
  sound.motion(arm.speed);
  if (render) composer.render();
  frame++;
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 1 / 20);
  if (!onScreen || !canvasRect.width || !canvasRect.height) {
    if (!canvasRect.width) resize();
    return;
  }
  frameStep(dt);
  perf(dt, simT);
}
loop();

ui.bootDone.then(() => {
  state.mode = 'track';
  document.body.classList.add('live');
});

/* ---------- debug hooks (?debug) for automated checks ---------- */
if (DEBUG) {
  window.__ma = {
    THREE, state, ref, arm, props, camera, holo, TABLE, TARGET, BASE, scene, bloom, spot, renderer, composer,
    screenOf(v) { return toScreen(v, {}); },
    tcpScreen() { return toScreen(arm.tcpWorld(new THREE.Vector3()), {}); },
    tcp() { return arm.tcpWorld(new THREE.Vector3()); },
    startDemo, stopDemo, startWave, transform, setDesign, toggleExplode, goHome, jog, pointer,
    get ndc() { return ndc.toArray(); },
    goal() { return trackGoal(simT, new THREE.Vector3()).toArray(); },
    // advance the simulation deterministically (works even when the tab is in the background)
    tick(frames = 1, dt = 1 / 60) {
      for (let i = 0; i < frames; i++) frameStep(dt, i === frames - 1);
      return simT;
    },
    step(dt = 1 / 60) { frameStep(dt, false); return simT; },
    idle: () => idleWeight(),
    // IK round-trip check over random reachable targets: returns the worst position error (m)
    ikCheck(n = 2000) {
      let worst = 0;
      let bad = 0;
      const q = {};
      const p = new THREE.Vector3();
      const out = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        p.set(BASE.x + (Math.random() * 2 - 1) * 2.2, TABLE.top + 0.1 + Math.random() * 2.2, BASE.z + (Math.random() * 2 - 1) * 2.2);
        clampWorkspace(p, TABLE.top + 0.1);
        const pitch = pitchFor(p);
        arm.solve(p, pitch, q, 0);
        if (![q.yaw, q.sh, q.el, q.wr].every(Number.isFinite)) { bad++; continue; }
        if (q.limited) continue;
        worst = Math.max(worst, arm.fk(q, out).distanceTo(p));
      }
      return { worst, bad };
    },
  };
}
