// The lab floor: a dark survey grid plus four point-cloud surface zones, LIDAR sweep,
// waypoint beacons, the planned path and the mecanum force vectors.
import * as THREE from 'three';
import { MAP_HALF, BEACONS, CLASSES, T2H, ZONES } from './shared.js';
import { mulberry32 } from './sense.js';
import { KIN } from './drive.js';

const TAU = Math.PI * 2;
export const ZONE_COLORS = { carpet: 0x6cc82c, hardwood: 0xffa62a, grass: 0xa6ff3c, tile: 0xbaff8e };
const ACID = 0xa6ff3c, AMBER = 0xffb02e;

const hash2 = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
const hash1 = (n) => { const s = Math.sin(n * 91.7 + 17.3) * 43758.5453; return s - Math.floor(s); };

// ---------------------------------------------------------------------------------------------
// Procedural surfaces as point patterns. Zone index follows CLASSES: 0 carpet, 1 hardwood,
// 2 grass, 3 tile.
function generateFloor(budget, seed) {
  const rand = mulberry32(seed);
  const per = Math.floor(budget / 4);
  const total = per * 4;
  const P = new Float32Array(total * 3), I = new Float32Array(total), Zn = new Float32Array(total), Sd = new Float32Array(total);
  let n = 0;
  const H = MAP_HALF;
  const put = (x, y, z, int, zone) => {
    P[n * 3] = x; P[n * 3 + 1] = y; P[n * 3 + 2] = z;
    I[n] = int; Zn[n] = zone; Sd[n] = rand(); n++;
  };

  // Tile (x<0, z<0): 0.45 m ceramic grid. Bright grout lines, glazed faces with a diagonal sheen.
  {
    const T = 0.45, lines = Math.floor(H / T);
    for (let i = 0; i < per; i++) {
      let x, z, int;
      if (rand() < 0.4) {
        const line = -Math.floor(rand() * (lines + 1)) * T + (rand() - 0.5) * 0.008;
        const along = -rand() * H;
        if (rand() < 0.5) { x = line; z = along; } else { x = along; z = line; }
        int = 0.62 + 0.3 * rand();
      } else {
        x = -rand() * H; z = -rand() * H;
        const ti = Math.floor(x / T), tj = Math.floor(z / T);
        const u = x / T - ti, v = z / T - tj;
        const sheen = Math.max(0, 1 - Math.abs(u - v) * 4) * 0.22;
        int = 0.13 + 0.16 * hash2(ti, tj) + sheen + 0.06 * rand();
      }
      put(Math.min(x, 0), 0, Math.min(z, 0), int, 3);
    }
  }
  // Hardwood (x>0, z<0): 0.16 m planks running east-west, staggered joints, wavy grain.
  {
    const Wp = 0.16, Lp = 1.5;
    const off = (j) => hash1(j * 7.13) * Lp;
    for (let i = 0; i < per; i++) {
      let x = 0, z = 0, int = 0;
      const r = rand();
      if (r < 0.14) {
        z = -Math.floor(rand() * (H / Wp)) * Wp + (rand() - 0.5) * 0.005;
        x = rand() * H;
        int = 0.48 + 0.25 * rand();
      } else if (r < 0.2) {
        z = -rand() * H;
        const j = Math.floor(-z / Wp);
        x = Math.floor(rand() * (H / Lp + 2)) * Lp - off(j) + (rand() - 0.5) * 0.005;
        if (x < 0 || x > H) x = rand() * H;
        int = 0.7 + 0.25 * rand();
      } else {
        for (let tries = 0; tries < 8; tries++) {
          x = rand() * H; z = -rand() * H;
          const j = Math.floor(-z / Wp), o = off(j);
          const pi = Math.floor((x + o) / Lp);
          const ph = hash2(pi, j);
          const u = (x + o) / Lp - pi, v = -z / Wp - j;
          const wave = Math.sin(u * TAU * (1.2 + ph) + ph * 9) * 0.35 + Math.sin(u * TAU * 3.1 + ph * 4) * 0.08;
          let g = 0.5 + 0.5 * Math.sin((v * 3.2 + wave) * TAU + ph * 17);
          g *= g; g *= g;
          int = 0.1 + 0.36 * g + 0.12 * ph;
          if (rand() < 0.22 + 0.78 * g) break;
        }
      }
      put(x, 0, z, int, 1);
    }
  }
  // Carpet (x<0, z>0): 0.5 m carpet tiles with alternating diagonal pile, slight fuzz height.
  {
    const T = 0.5, lines = Math.floor(H / T);
    for (let i = 0; i < per; i++) {
      let x = 0, z = 0, int = 0;
      if (rand() < 0.05) {
        const line = Math.floor(rand() * (lines + 1)) * T;
        if (rand() < 0.5) { x = -line; z = rand() * H; } else { x = -rand() * H; z = line; }
        int = 0.3 + 0.1 * rand();
      } else {
        for (let tries = 0; tries < 6; tries++) {
          x = -rand() * H; z = rand() * H;
          const dir = (Math.floor(x / T) + Math.floor(z / T)) & 1 ? 1 : -1;
          const s = 0.5 + 0.5 * Math.sin(((x * dir + z) / 0.085) * TAU);
          const st = s * s;
          int = 0.1 + 0.2 * st + 0.05 * rand();
          if (rand() < 0.4 + 0.6 * st) break;
        }
      }
      put(Math.min(x, 0), rand() * 0.012, Math.max(z, 0), int, 0);
    }
  }
  // Short grass (x>0, z>0): clumped blades, each a short leaning column of 4 points.
  {
    const clump = (x, z) => 0.5 + 0.25 * Math.sin(x * 2.3 + Math.sin(z * 1.7) * 1.5) + 0.25 * Math.sin(z * 2.9 + Math.sin(x * 1.3) * 1.2);
    const blades = Math.floor(per / 4);
    for (let b = 0; b < blades; b++) {
      let x = 0, z = 0, c = 0;
      for (let tries = 0; tries < 6; tries++) {
        x = rand() * H; z = rand() * H; c = clump(x, z);
        if (rand() < 0.3 + 0.7 * c) break;
      }
      const h = 0.02 + 0.05 * rand() * (0.55 + 0.45 * c);
      const a = rand() * TAU, lean = (0.2 + 0.5 * rand()) * h;
      const lx = Math.cos(a) * lean, lz = Math.sin(a) * lean;
      for (let k = 0; k < 4; k++) {
        const t = k / 3;
        put(x + lx * t * t, t * h, z + lz * t * t, 0.12 + 0.42 * t + 0.08 * rand(), 2);
      }
    }
    for (let k = blades * 4; k < per; k++) put(rand() * H, 0, rand() * H, 0.12, 2);
  }

  // Shuffle so any prefix is a uniform subsample (adaptive quality just shortens the draw range).
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    for (let c = 0; c < 3; c++) { const t = P[i * 3 + c]; P[i * 3 + c] = P[j * 3 + c]; P[j * 3 + c] = t; }
    let t = I[i]; I[i] = I[j]; I[j] = t;
    t = Zn[i]; Zn[i] = Zn[j]; Zn[j] = t;
    t = Sd[i]; Sd[i] = Sd[j]; Sd[j] = t;
  }
  return { P, I, Zn, Sd, n };
}

// ---------------------------------------------------------------------------------------------
const SWEEP_GLSL = /* glsl */ `
  float sweepTrail(vec2 d, float r) {
    float ang = r > 1e-4 ? atan(d.y, d.x) : 0.0;
    float since = mod(uSweep - ang, 6.2831853);
    return exp(-since * 2.0) * (1.0 - smoothstep(uRange * 0.62, uRange, r));
  }
`;

const POINT_VERT = /* glsl */ `
  uniform float uTime, uSize, uScale, uReveal, uSweep, uSweepGain, uRange, uMotion, uActive, uHeading;
  uniform vec2 uRover;
  uniform vec3 uZoneCol[4];
  attribute float aInt;
  attribute float aZone;
  attribute float aSeed;
  varying vec3 vCol;
  ${SWEEP_GLSL}
  void main() {
    vec3 p = position;
    vec2 d = p.xz - uRover;
    float r = length(d);
    float trail = sweepTrail(d, r);
    float rv = uReveal - length(p.xz) - aSeed * 0.9;
    float vis = clamp(rv * 2.5, 0.0, 1.0);
    float front = exp(-abs(rv) * 3.5) * step(0.0, rv);
    // Soft shadow under the chassis (rotated box distance).
    float c = cos(uHeading), s = sin(uHeading);
    vec2 loc = vec2(d.x * c - d.y * s, d.x * s + d.y * c);
    vec2 q = abs(loc) - vec2(0.36, 0.36);
    float bd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    float shadow = mix(0.22, 1.0, smoothstep(-0.06, 0.16, bd));
    float recall = 0.22 + 0.78 * (1.0 - smoothstep(2.2, 7.5, r));
    float shimmer = 1.0 + uMotion * 0.1 * sin(uTime * 2.1 + aSeed * 61.0);
    int zi = int(aZone + 0.5);
    float act = abs(aZone - uActive) < 0.5 ? 1.2 : 1.0;
    float inten = aInt * recall * shadow * shimmer * act * (0.13 + 0.62 * uSweepGain * trail);
    inten = (inten + front * 0.5) * vis;
    vCol = uZoneCol[zi] * inten;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = max(0.05, -mv.z);
    gl_PointSize = clamp(uSize * uScale * (0.7 + 0.55 * aInt) / depth, 1.0, 26.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const POINT_FRAG = /* glsl */ `
  varying vec3 vCol;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d2 = dot(c, c);
    if (d2 > 0.25) discard;
    float a = exp(-d2 * 12.0);
    gl_FragColor = vec4(vCol * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const FLOOR_VERT = /* glsl */ `
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const FLOOR_FRAG = /* glsl */ `
  uniform float uHalf, uTime, uSweep, uSweepGain, uRange, uReveal, uActive;
  uniform vec2 uRover;
  uniform vec3 uZoneCol[4];
  varying vec3 vW;
  ${SWEEP_GLSL}
  float grid(vec2 p, float spacing, float width) {
    vec2 q = p / spacing;
    vec2 fw = max(fwidth(q), vec2(1e-5));
    vec2 g = abs(fract(q - 0.5) - 0.5) / fw;
    return 1.0 - clamp(min(g.x, g.y) / width, 0.0, 1.0);
  }
  float line1(float v, float w) {
    float fw = max(fwidth(v), 1e-5);
    return 1.0 - clamp(abs(v) / (fw * w), 0.0, 1.0);
  }
  void main() {
    vec2 p = vW.xz;
    float H = uHalf;
    float edge = max(abs(p.x), abs(p.y));
    float inside = 1.0 - smoothstep(H - 0.01, H + 0.01, edge);
    float zi = p.x < 0.0 ? (p.y < 0.0 ? 3.0 : 0.0) : (p.y < 0.0 ? 1.0 : 2.0);
    vec3 zc = uZoneCol[int(zi)];
    vec2 d = p - uRover;
    float r = length(d);
    float trail = sweepTrail(d, r);
    float near = 1.0 - smoothstep(2.5, 8.5, r);
    float isAct = abs(zi - uActive) < 0.5 ? 1.0 : 0.0;
    // Values are linear; the sRGB output curve lifts them a lot, so keep the field very dark.
    vec3 col = vec3(0.0007, 0.0016, 0.0007);
    col += zc * (0.0012 + 0.0022 * isAct) * inside;
    float g1 = grid(p, 1.0, 1.1), g2 = grid(p, 0.25, 0.8);
    col += vec3(0.22, 0.55, 0.1) * (g1 * 0.032 + g2 * 0.007) * inside * (0.3 + 0.7 * near + 1.6 * trail * uSweepGain);
    float dash1 = step(0.5, fract(p.y * 2.0)), dash2 = step(0.5, fract(p.x * 2.0));
    col += vec3(0.5, 0.95, 0.22) * 0.12 * (line1(p.x, 1.5) * dash1 + line1(p.y, 1.5) * dash2) * inside;
    float bord = line1(edge - H, 2.0);
    col += vec3(0.6, 1.0, 0.3) * 0.25 * bord;
    // Metre ticks along the inside of the border.
    float tick = (1.0 - smoothstep(0.0, 0.012, abs(fract(p.x + 0.5) - 0.5))) * step(H - 0.18, abs(p.y))
               + (1.0 - smoothstep(0.0, 0.012, abs(fract(p.y + 0.5) - 0.5))) * step(H - 0.18, abs(p.x));
    col += vec3(0.6, 1.0, 0.3) * 0.12 * tick * inside;
    // Home pad at the origin.
    float rh = length(p);
    float seg = rh > 1e-4 ? step(0.5, fract(atan(p.y, p.x) * 8.0 / 6.2831853)) : 0.0;
    float pad = (1.0 - smoothstep(0.0, 0.012, abs(rh - 0.62))) + (1.0 - smoothstep(0.0, 0.01, abs(rh - 0.47))) * seg;
    col += vec3(0.5, 0.9, 0.2) * 0.1 * pad;
    float outside = (1.0 - inside) * (1.0 - smoothstep(H, H + 3.5, edge));
    col += vec3(0.2, 0.45, 0.1) * g1 * 0.012 * outside;
    col *= smoothstep(0.0, 0.6, uReveal - length(p));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const DECAL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime, uProx, uFlash, uInside, uMotion;
  varying vec2 vUv;
  void main() {
    vec2 q = (vUv - 0.5) * 1.6;
    float r = length(q);
    float a = r > 1e-4 ? atan(q.y, q.x) : 0.0;
    float ring = 1.0 - smoothstep(0.0, 0.014, abs(r - 0.5));
    float dash = step(0.45, fract((a + uTime * 0.35 * uMotion) * 12.0 / 6.2831853));
    float ring2 = (1.0 - smoothstep(0.0, 0.009, abs(r - 0.63))) * dash;
    float ticks = (1.0 - smoothstep(0.0, 0.012, abs(r - 0.56))) * step(0.8, fract(a * 24.0 / 6.2831853));
    float fill = (1.0 - smoothstep(0.0, 0.5, r)) * 0.16;
    float v = ring * (0.55 + 0.6 * uProx + 0.5 * uInside) + ring2 * (0.3 + 0.5 * uProx) + ticks * 0.45
            + fill * (0.35 + uProx + 1.5 * uInside) + uFlash * (ring + fill * 3.0);
    gl_FragColor = vec4(uColor * v, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
const UV_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const COLUMN_VERT = /* glsl */ `
  varying float vY;
  varying float vF;
  void main() {
    vY = uv.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vec3 v = normalize(-mv.xyz + vec3(0.0, 0.0, 1e-4));
    vF = 1.0 - abs(dot(n, v));
    gl_Position = projectionMatrix * mv;
  }
`;
const COLUMN_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime, uProx, uFlash, uScan, uMotion;
  varying float vY;
  varying float vF;
  void main() {
    float y = clamp(vY, 0.0, 1.0);
    float fade = (1.0 - y) * (1.0 - y);
    float bands = 0.78 + 0.22 * sin((y * 14.0 - uTime * 0.8 * uMotion) * 6.2831853);
    float f = clamp(vF, 0.0, 1.0);
    float rim = 0.22 + 1.5 * f * f;
    float a = fade * rim * bands * (0.45 + 0.5 * uProx + 1.1 * uScan) + uFlash * fade * 1.2;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
const FAN_VERT = /* glsl */ `
  attribute float aT;
  varying float vT;
  varying float vR;
  void main() {
    vT = aT;
    vR = length(position.xz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FAN_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uRange, uGain;
  varying float vT;
  varying float vR;
  void main() {
    float t = clamp(vT, 0.0, 1.0);
    float rr = clamp(vR, 0.0, 1.0); // fan geometry has unit radius; the mesh is scaled to uRange
    float a = (1.0 - t) * (1.0 - t) * 0.022 * (1.0 - rr * rr);
    a += (1.0 - smoothstep(0.0, 0.03, t)) * 0.13 * (1.0 - rr);
    gl_FragColor = vec4(uColor * a * uGain, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
const DOTS_VERT = /* glsl */ `
  attribute float aS;
  uniform float uProgress, uTime, uMotion, uScale;
  varying float vA;
  void main() {
    float ahead = smoothstep(uProgress - 0.05, uProgress + 0.35, aS);
    float march = 0.6 + 0.4 * sin((aS * 1.6 - uTime * 1.8 * uMotion) * 6.2831853);
    vA = ahead * march;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(0.055 * uScale / max(0.05, -mv.z), 2.0, 18.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const DOTS_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  void main() {
    vec2 c = abs(gl_PointCoord - 0.5);
    if (max(c.x, c.y) > 0.36) discard;
    gl_FragColor = vec4(uColor * vA, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function additive(o) {
  return new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, ...o });
}

function zoneLabelTexture(surface) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const draw = () => {
    const g = c.getContext('2d');
    const T = T2H[surface];
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = '#ffffff';
    g.font = '700 150px "Chakra Petch", "Arial Narrow", sans-serif';
    g.fillText(T.label.toUpperCase(), 16, 158);
    g.font = '500 38px "IBM Plex Mono", ui-monospace, monospace';
    g.fillText(`ZONE ${ZONES[surface].code}  ·  T2H ${T.amp.toFixed(2)}  ·  ${T.feel.toUpperCase()}`, 22, 226);
    g.fillRect(16, 182, 300, 4);
    tex.needsUpdate = true;
  };
  draw();
  return { tex, draw };
}

// ---------------------------------------------------------------------------------------------
export function buildWorld({ budget = 100000, seed = 1977 } = {}) {
  const group = new THREE.Group();
  const zoneCols = CLASSES.map((c) => new THREE.Color(ZONE_COLORS[c]));
  const U = {
    uTime: { value: 0 }, uRover: { value: new THREE.Vector2() }, uHeading: { value: 0 },
    uSweep: { value: 0 }, uSweepGain: { value: 1.6 }, uRange: { value: 4.6 }, uReveal: { value: 0 },
    uMotion: { value: 1 }, uActive: { value: 3 }, uScale: { value: 800 }, uSize: { value: 0.0145 },
    uZoneCol: { value: zoneCols }, uHalf: { value: MAP_HALF },
  };

  // Base floor
  const floorMat = new THREE.ShaderMaterial({
    uniforms: { uHalf: U.uHalf, uTime: U.uTime, uSweep: U.uSweep, uSweepGain: U.uSweepGain, uRange: U.uRange, uReveal: U.uReveal, uActive: U.uActive, uRover: U.uRover, uZoneCol: U.uZoneCol },
    vertexShader: FLOOR_VERT, fragmentShader: FLOOR_FRAG,
  });
  const floorGeo = new THREE.PlaneGeometry(2 * MAP_HALF + 9, 2 * MAP_HALF + 9, 1, 1);
  floorGeo.rotateX(-Math.PI / 2);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.position.y = -0.003;
  floor.renderOrder = -2;
  group.add(floor);

  // Point cloud
  const F = generateFloor(budget, seed);
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(F.P, 3));
  pg.setAttribute('aInt', new THREE.BufferAttribute(F.I, 1));
  pg.setAttribute('aZone', new THREE.BufferAttribute(F.Zn, 1));
  pg.setAttribute('aSeed', new THREE.BufferAttribute(F.Sd, 1));
  pg.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), MAP_HALF * 1.5);
  const pointMat = additive({
    uniforms: { uTime: U.uTime, uSize: U.uSize, uScale: U.uScale, uReveal: U.uReveal, uSweep: U.uSweep, uSweepGain: U.uSweepGain, uRange: U.uRange, uMotion: U.uMotion, uActive: U.uActive, uHeading: U.uHeading, uRover: U.uRover, uZoneCol: U.uZoneCol },
    vertexShader: POINT_VERT, fragmentShader: POINT_FRAG,
  });
  const points = new THREE.Points(pg, pointMat);
  points.frustumCulled = false;
  group.add(points);

  // Floor stencils
  const labels = [];
  const labelPos = { tile: [-3.55, -4.78], hardwood: [3.55, -4.78], carpet: [-3.55, 4.82], grass: [3.55, 4.82] };
  for (const s of CLASSES) {
    const { tex, draw } = zoneLabelTexture(s);
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(ZONE_COLORS[s]).multiplyScalar(0.1), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const geo = new THREE.PlaneGeometry(2.4, 0.6);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(labelPos[s][0], 0.006, labelPos[s][1]);
    group.add(m);
    labels.push({ surface: s, mesh: m, mat, draw, base: mat.color.clone() });
  }

  // Beacons
  const beacons = new Map();
  const hitMeshes = [];
  // A slim light beam reads well from above; a wider invisible cylinder is the click target.
  const beamGeo = new THREE.CylinderGeometry(0.03, 0.085, 1.9, 20, 1, true);
  beamGeo.translate(0, 0.95, 0);
  const hitGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.6, 16, 1, false);
  hitGeo.translate(0, 0.8, 0);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
  const decalGeo = new THREE.PlaneGeometry(1.6, 1.6);
  decalGeo.rotateX(-Math.PI / 2);
  const glyphGeo = new THREE.EdgesGeometry(new THREE.OctahedronGeometry(0.12, 0));
  const haloGeo = new THREE.RingGeometry(0.2, 0.215, 40);
  haloGeo.rotateX(-Math.PI / 2);
  for (const b of BEACONS) {
    const color = new THREE.Color(b.kind === 'link' ? AMBER : ACID);
    const g = new THREE.Group();
    g.position.set(b.x, 0, b.z);
    const bu = { uColor: { value: color }, uTime: U.uTime, uMotion: U.uMotion, uProx: { value: 0 }, uFlash: { value: 0 }, uInside: { value: 0 }, uScan: { value: 0 } };
    const decal = new THREE.Mesh(decalGeo, additive({ uniforms: bu, vertexShader: UV_VERT, fragmentShader: DECAL_FRAG }));
    decal.position.y = 0.005;
    const beam = new THREE.Mesh(beamGeo, additive({ uniforms: bu, vertexShader: COLUMN_VERT, fragmentShader: COLUMN_FRAG, side: THREE.DoubleSide }));
    const hit = new THREE.Mesh(hitGeo, hitMat);
    hit.userData.beacon = b.id;
    const glyphMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const glyph = new THREE.LineSegments(glyphGeo, glyphMat);
    glyph.position.y = 1.32;
    const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    halo.position.y = 1.32;
    g.add(decal, beam, hit, glyph, halo);
    group.add(g);
    hitMeshes.push(hit);
    beacons.set(b.id, { def: b, group: g, u: bu, glyph, halo, flash: 0, scan: 0 });
  }

  // LIDAR fan (floor projection of the scan plane), trailing behind the beam.
  const K = 40, width = 0.95;
  const fanPos = [0, 0, 0], fanT = [0], fanIdx = [];
  for (let k = 0; k <= K; k++) {
    const a = -(k / K) * width;
    fanPos.push(Math.cos(a), 0, Math.sin(a));
    fanT.push(k / K);
  }
  for (let k = 1; k <= K; k++) fanIdx.push(0, k, k + 1);
  const fanGeo = new THREE.BufferGeometry();
  fanGeo.setAttribute('position', new THREE.Float32BufferAttribute(fanPos, 3));
  fanGeo.setAttribute('aT', new THREE.Float32BufferAttribute(fanT, 1));
  fanGeo.setIndex(fanIdx);
  const fanU = { uColor: { value: new THREE.Color(ACID) }, uRange: U.uRange, uGain: { value: 1 } };
  const fan = new THREE.Mesh(fanGeo, additive({ uniforms: fanU, vertexShader: FAN_VERT, fragmentShader: FAN_FRAG, side: THREE.DoubleSide }));
  fan.position.y = 0.008;
  fan.frustumCulled = false;
  group.add(fan);

  // Planned path: dotted markers on the floor.
  const MAXD = 900;
  const dotPos = new Float32Array(MAXD * 3), dotS = new Float32Array(MAXD);
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.BufferAttribute(dotPos, 3).setUsage(THREE.DynamicDrawUsage));
  dg.setAttribute('aS', new THREE.BufferAttribute(dotS, 1).setUsage(THREE.DynamicDrawUsage));
  dg.setDrawRange(0, 0);
  const dotU = { uColor: { value: new THREE.Color(ACID) }, uProgress: { value: 0 }, uTime: U.uTime, uMotion: U.uMotion, uScale: U.uScale };
  const dots = new THREE.Points(dg, additive({ uniforms: dotU, vertexShader: DOTS_VERT, fragmentShader: DOTS_FRAG }));
  dots.frustumCulled = false;
  group.add(dots);

  // Target reticle
  const target = new THREE.Group();
  const tMat = new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const r1 = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.225, 48), tMat);
  const r2 = new THREE.Mesh(new THREE.RingGeometry(0.33, 0.345, 4, 1, Math.PI / 4), tMat);
  for (const r of [r1, r2]) { r.rotation.x = -Math.PI / 2; target.add(r); }
  const tl = [];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU;
    tl.push(Math.cos(a) * 0.06, 0, Math.sin(a) * 0.06, Math.cos(a) * 0.16, 0, Math.sin(a) * 0.16);
  }
  tl.push(0, 0, 0, 0, 0.9, 0);
  const tlg = new THREE.BufferGeometry();
  tlg.setAttribute('position', new THREE.Float32BufferAttribute(tl, 3));
  target.add(new THREE.LineSegments(tlg, new THREE.LineBasicMaterial({ color: AMBER, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
  target.position.y = 0.01;
  target.visible = false;
  group.add(target);
  const ringSpin = r2;

  // Hover reticle (desktop pointer)
  const hover = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.115, 32), new THREE.MeshBasicMaterial({ color: ACID, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
  hover.rotation.x = -Math.PI / 2;
  hover.position.y = 0.012;
  hover.visible = false;
  group.add(hover);

  // Mecanum traction vectors under each wheel (along the ground-contact roller axis).
  const arrowPos = new Float32Array(4 * 3 * 2 * 3);
  const ag = new THREE.BufferGeometry();
  ag.setAttribute('position', new THREE.BufferAttribute(arrowPos, 3).setUsage(THREE.DynamicDrawUsage));
  const arrows = new THREE.LineSegments(ag, new THREE.LineBasicMaterial({ color: AMBER, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
  arrows.frustumCulled = false;
  group.add(arrows);

  let pathRef = null;
  const api = {
    group, points, floor, beacons, hitMeshes, uniforms: U, labels, count: F.n,
    setPointFraction(f) { pg.setDrawRange(0, Math.max(1000, Math.floor(F.n * f))); },
    redrawLabels() { for (const l of labels) l.draw(); },
    setActive(surface) {
      U.uActive.value = CLASSES.indexOf(surface);
      for (const l of labels) l.mat.color.copy(l.base).multiplyScalar(l.surface === surface ? 2.6 : 1);
    },
    setPath(p) {
      pathRef = p;
      if (!p) { dg.setDrawRange(0, 0); target.visible = false; return; }
      let k = 0;
      let j = 0;
      for (let s = 0.16; s < p.L - 0.05 && k < MAXD; s += 0.16) {
        while (j < p.n - 1 && p.S[j + 1] < s) j++;
        const s0 = p.S[j], s1 = p.S[Math.min(p.n - 1, j + 1)];
        const t = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
        const j1 = Math.min(p.n - 1, j + 1);
        dotPos[k * 3] = p.X[j] + (p.X[j1] - p.X[j]) * t;
        dotPos[k * 3 + 1] = 0.012;
        dotPos[k * 3 + 2] = p.Z[j] + (p.Z[j1] - p.Z[j]) * t;
        dotS[k] = s;
        k++;
      }
      dg.attributes.position.needsUpdate = true;
      dg.attributes.aS.needsUpdate = true;
      dg.setDrawRange(0, k);
      dotU.uProgress.value = 0;
      target.position.set(p.X[p.n - 1], 0.01, p.Z[p.n - 1]);
      target.visible = true;
    },
    setHover(x, z, show) {
      hover.visible = !!show;
      if (show) hover.position.set(x, 0.012, z);
    },
    beaconHit(id, kind) {
      const b = beacons.get(id);
      if (b) b.flash = 1;
    },
    // Called every frame with the simulation state.
    update(o) {
      U.uTime.value = o.t;
      U.uRover.value.set(o.x, o.z);
      U.uHeading.value = o.psi;
      U.uSweep.value = o.sweep;
      U.uSweepGain.value = o.sweepGain;
      U.uReveal.value = o.reveal;
      U.uMotion.value = o.motion;
      fan.position.set(o.x, 0.008, o.z);
      fan.rotation.y = -o.sweep;
      fan.scale.set(U.uRange.value, 1, U.uRange.value);
      fanU.uGain.value = o.sweepGain / 1.6;
      if (pathRef && o.progress != null) dotU.uProgress.value = o.progress;
      if (target.visible) {
        ringSpin.rotation.z = o.motion ? o.t * 0.8 : 0;
        const s = 1 + (o.motion ? 0.06 * Math.sin(o.t * 4) : 0);
        target.scale.set(s, 1, s);
      }
      for (const [, b] of beacons) {
        const st = o.beacons[b.def.id];
        b.flash = Math.max(0, b.flash - o.dt * 1.6);
        b.u.uFlash.value = b.flash;
        b.u.uProx.value = st ? st.prox : 0;
        b.u.uInside.value = st && st.inside ? 1 : 0;
        // LIDAR "returns": columns light up as the beam passes them.
        const dx = b.def.x - o.x, dz = b.def.z - o.z;
        const r = Math.hypot(dx, dz);
        let since = (o.sweep - Math.atan2(dz, dx)) % TAU;
        if (since < 0) since += TAU;
        const hit = r < U.uRange.value + 0.5 ? Math.exp(-since * 3) : 0;
        b.scan = Math.max(hit, b.scan * Math.exp(-o.dt * 2.5));
        b.u.uScan.value = b.scan * (o.sweepGain / 1.6);
        b.glyph.rotation.y = o.motion ? o.t * 0.9 : 0.6;
        b.glyph.position.y = 1.32 + (o.motion ? Math.sin(o.t * 1.6 + b.def.x) * 0.04 : 0);
        const hs = 1 + 0.6 * b.scan + 0.4 * b.flash;
        b.halo.scale.set(hs, 1, hs);
        b.halo.material.opacity = 0.35 + 0.4 * (st ? st.prox : 0) + 0.3 * b.scan;
      }
      // Force vectors
      const sn = Math.sin(o.psi), cs = Math.cos(o.psi);
      let k = 0;
      for (let i = 0; i < 4; i++) {
        const W = KIN.wheels[i];
        const gx = o.x + W.f * sn + W.l * cs, gz = o.z + W.f * cs - W.l * sn;
        // Direction of traction for positive rim speed: (fwd 0.707, left -0.707 s).
        const df = Math.SQRT1_2, dl = -Math.SQRT1_2 * W.s;
        const len = (o.rim[i] / 1.5) * 0.32;
        const dx = (df * sn + dl * cs) * len, dz = (df * cs - dl * sn) * len;
        const ex = gx + dx, ez = gz + dz;
        const y = 0.015;
        const push = (x1, z1, x2, z2) => {
          arrowPos[k++] = x1; arrowPos[k++] = y; arrowPos[k++] = z1;
          arrowPos[k++] = x2; arrowPos[k++] = y; arrowPos[k++] = z2;
        };
        push(gx, gz, ex, ez);
        const hl = Math.min(0.06, Math.abs(len) * 0.4);
        const m = Math.hypot(dx, dz) || 1;
        const ux = dx / m, uz = dz / m;
        push(ex, ez, ex - ux * hl + uz * hl * 0.6, ez - uz * hl - ux * hl * 0.6);
        push(ex, ez, ex - ux * hl - uz * hl * 0.6, ez - uz * hl + ux * hl * 0.6);
      }
      ag.attributes.position.needsUpdate = true;
      arrows.visible = o.showArrows;
    },
  };
  return api;
}
