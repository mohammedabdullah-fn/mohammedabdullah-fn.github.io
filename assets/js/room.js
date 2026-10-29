import * as THREE from 'three';
import { radialTexture } from './util.js';

/* The workcell around the robot: blueprint floor, walls, shelving, indicator lights,
   dust motes, and a motorised follow-spot that keeps its beam on the tool tip. */

const NEG_Y = new THREE.Vector3(0, -1, 0);
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();

export function buildRoom(scene, { floorY, base }) {
  // Floor: CAD-style major/minor grid with a radar pulse spreading from the robot base.
  const floorMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uBase: { value: new THREE.Vector2(base.x, base.z) } },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec2 uBase; varying vec3 vW;
      float grid(vec2 p, float w) {
        vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
        return 1.0 - min(min(g.x, g.y) / w, 1.0);
      }
      void main() {
        vec2 p = vW.xz;
        float d = length(p - vec2(0.3, 0.0));
        float fade = smoothstep(16.0, 1.5, d);
        float major = grid(p * 0.5, 1.25);
        float minor = grid(p * 2.0, 0.9);
        vec3 col = vec3(0.0045, 0.0030, 0.0034);
        col += vec3(0.9, 0.075, 0.085) * (major * 0.12 + minor * 0.02) * fade;
        col += vec3(0.05, 0.006, 0.008) * smoothstep(9.0, 0.0, d);
        float rb = length(p - uBase);
        float wave = fract(uTime * 0.1);
        float ring = smoothstep(0.4, 0.0, abs(rb - wave * 13.0)) * (1.0 - wave);
        col += vec3(1.0, 0.1, 0.12) * ring * (0.035 + major * 0.25 + minor * 0.08) * fade;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = floorY;
  scene.add(floor);
  const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.45 }));
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.y = floorY + 0.002;
  shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);

  // Walls
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x0f0b0c, roughness: 0.95, metalness: 0.05 });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(34, 16), wallMat);
  back.position.set(0, floorY + 8, -7.5);
  back.receiveShadow = true;
  scene.add(back);
  const side = new THREE.Mesh(new THREE.PlaneGeometry(20, 16), wallMat);
  side.position.set(8.5, floorY + 8, -1);
  side.rotation.y = -Math.PI / 2;
  scene.add(side);

  // Shelving at the back right
  const shelfMat = new THREE.MeshStandardMaterial({ color: 0x241b1c, roughness: 0.75, metalness: 0.3 });
  const shelf = new THREE.Group();
  shelf.position.set(5.6, floorY, -3.2);
  shelf.rotation.y = -0.45;
  scene.add(shelf);
  for (const x of [-1.1, 1.1]) for (const z of [-0.35, 0.35]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 3.2, 0.06), shelfMat);
    post.position.set(x, 1.6, z);
    shelf.add(post);
  }
  const rnd = mulberry(7);
  for (const y of [0.5, 1.45, 2.4]) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.05, 0.8), shelfMat);
    board.position.y = y;
    board.receiveShadow = true;
    shelf.add(board);
    for (let i = 0; i < 3; i++) {
      const w = 0.3 + rnd() * 0.35;
      const h = 0.18 + rnd() * 0.3;
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.4 + rnd() * 0.25), shelfMat);
      box.position.set(-0.8 + i * 0.75 + rnd() * 0.1, y + 0.025 + h / 2, rnd() * 0.1);
      shelf.add(box);
    }
  }
  const warm = new THREE.PointLight(0xffa060, 5, 4, 2);
  warm.position.set(5.2, floorY + 0.9, -2.6);
  scene.add(warm);

  // Wall vents and a small status panel
  const ventMat = new THREE.MeshStandardMaterial({ color: 0x3a3236, roughness: 0.6, metalness: 0.4, emissive: 0x140f11 });
  const vent = (x, y, z, n, ry) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = ry;
    for (let i = 0; i < n; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.028, 0.03), ventMat);
      bar.position.y = -i * 0.085;
      g.add(bar);
    }
    scene.add(g);
  };
  vent(-5.4, 3.3, -4.2, 7, 0.35);
  vent(5.2, 3.7, -3.9, 9, -0.35);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.3, 0.05), new THREE.MeshStandardMaterial({ color: 0xcfcac4, roughness: 0.5, emissive: 0x2a2626 }));
  panel.position.set(-3.6, 1.55, -3.4);
  panel.rotation.y = 0.3;
  scene.add(panel);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.02), new THREE.MeshBasicMaterial({ color: 0x0b0b0d }));
  slot.position.set(0, 0, 0.03);
  panel.add(slot);

  // Indicator lights
  const leds = [];
  const ledGeo = new THREE.SphereGeometry(0.035, 12, 8);
  for (const [x, y, z, c, rate] of [
    [0.9, 2.8, -3.6, 'r', 1.1], [3.4, 1.6, -2.4, 'r', 0.7], [3.75, 1.6, -2.4, 'r', 0.9], [4.1, 1.6, -2.4, 'w', 0.5],
    [4.45, 1.6, -2.4, 'w', 1.3], [6.4, 2.3, -2.0, 'r', 0.6], [6.75, 2.3, -2.0, 'w', 0.8], [-2.4, 2.2, -3.8, 'r', 0.4],
  ]) {
    const col = c === 'r' ? new THREE.Color(2.4, 0.18, 0.2) : new THREE.Color(1.6, 1.6, 1.7);
    const m = new THREE.Mesh(ledGeo, new THREE.MeshBasicMaterial({ color: col.clone(), toneMapped: false }));
    m.position.set(x, y, z);
    scene.add(m);
    leds.push({ m, col, rate, ph: x * 3.1 });
  }

  // Dust motes: dim everywhere, bright where the follow-spot beam passes through them.
  const N = 700;
  const pos = new Float32Array(N * 3);
  const seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = -6 + rnd() * 12;
    pos[i * 3 + 1] = floorY + rnd() * 9;
    pos[i * 3 + 2] = -4 + rnd() * 8;
    seed[i] = rnd();
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const dustMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uScale: { value: 1 },
      uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() }, uR: { value: 0.4 },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed; uniform float uTime; uniform float uScale;
      uniform vec3 uA; uniform vec3 uB; uniform float uR; varying float vA;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.11 + aSeed * 30.0) * 0.4;
        p.y = ${floorY.toFixed(2)} + mod(p.y - ${floorY.toFixed(2)} + uTime * (0.02 + 0.05 * aSeed), 9.0);
        p.z += cos(uTime * 0.09 + aSeed * 17.0) * 0.3;
        vec3 ab = uB - uA;
        float t = clamp(dot(p - uA, ab) / dot(ab, ab), 0.0, 1.0);
        float r = mix(0.05, uR, t) + 0.05;
        float inBeam = smoothstep(r, r * 0.25, length(p - (uA + ab * t)));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uScale * (1.0 + 1.6 * aSeed) * (9.0 / -mv.z) * (1.0 + inBeam);
        vA = 0.05 + inBeam * 0.9 * (0.6 + 0.4 * sin(uTime * 2.0 + aSeed * 50.0));
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vA;
        gl_FragColor = vec4(vec3(0.85, 0.92, 1.0) * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);

  return {
    update(dt, t, beam, pixelRatio) {
      floorMat.uniforms.uTime.value = t;
      dustMat.uniforms.uTime.value = t;
      dustMat.uniforms.uScale.value = pixelRatio;
      dustMat.uniforms.uA.value.copy(beam.source);
      dustMat.uniforms.uB.value.copy(beam.aim);
      dustMat.uniforms.uR.value = beam.radius;
      for (const l of leds) {
        const k = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * l.rate * 3 + l.ph)) ** 6;
        l.m.material.color.copy(l.col).multiplyScalar(k);
      }
    },
  };
}

/* Moving-head follow-spot mounted above the cell. Pan/tilt follow the tool tip through a
   critically damped loop, so the beam lands on the gripper and glides with it. */
export class FollowSpot {
  constructor(scene) {
    this.source = new THREE.Vector3(0.35, 9.5, 1.7);   // overhead, centred: the beam drops through the gap between the cards
    this.aim = new THREE.Vector3(0.9, 0.8, 1.9);
    this.aimV = new THREE.Vector3();
    this.radius = 0.34;

    const light = (this.light = new THREE.SpotLight(0xeef6ff, 300, 0, 0.1, 0.55, 2));
    light.position.copy(this.source);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.bias = -0.0002;
    light.shadow.normalBias = 0.025;
    light.shadow.camera.near = 4;
    light.shadow.camera.far = 16;
    scene.add(light, light.target);

    const geo = new THREE.CylinderGeometry(0.03, 1, 1, 64, 24, true);
    geo.translate(0, -0.5, 0);   // apex at the lamp, base one unit down the beam axis
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0.75, 0.92, 1.0) }, uTime: { value: 0 }, uTip: { value: 0.9 }, uGain: { value: 0.1 } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV; varying float vAlong;
        void main() {
          vAlong = -position.y;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uTime; uniform float uTip; uniform float uGain;
        varying vec3 vN; varying vec3 vV; varying float vAlong;
        void main() {
          float core = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
          float head = smoothstep(0.0, 0.08, vAlong);
          float tail = 1.0 - smoothstep(uTip, 1.0, vAlong);
          float shimmer = 0.82 + 0.18 * sin(vAlong * 70.0 - uTime * 5.0);
          float a = core * head * tail * shimmer * uGain * mix(0.55, 1.25, vAlong);
          gl_FragColor = vec4(uColor * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.beam = new THREE.Mesh(geo, this.mat);
    this.beam.frustumCulled = false;
    this.beam.renderOrder = 5;
    scene.add(this.beam);
    // a tighter, brighter core so the beam reads as "pointing at the tool"
    this.coreMat = this.mat.clone();
    this.coreMat.uniforms.uGain.value = 0.2;
    this.coreMat.uniforms.uColor.value = new THREE.Color(0.45, 0.95, 1.1);
    this.core = new THREE.Mesh(geo, this.coreMat);
    this.core.frustumCulled = false;
    this.core.renderOrder = 6;
    scene.add(this.core);

    // Hot spot where the beam lands on the tool
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture(), color: new THREE.Color(0.22, 0.6, 0.8), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, fog: false }));
    this.glow.scale.setScalar(0.32);
    scene.add(this.glow);
  }

  update(dt, t, tip) {
    const w = 16;
    const n = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      _a.subVectors(tip, this.aim).multiplyScalar(w * w).addScaledVector(this.aimV, -2 * w);
      this.aimV.addScaledVector(_a, h);
      this.aim.addScaledVector(this.aimV, h);
    }
    this.light.target.position.copy(this.aim);
    this.light.target.updateMatrixWorld();

    const dir = _v.subVectors(this.aim, this.source);
    const dist = dir.length();
    dir.divideScalar(dist);
    const len = dist + 0.55;
    const s = (this.radius * len) / dist;
    this.beam.position.copy(this.source);
    this.beam.quaternion.setFromUnitVectors(NEG_Y, dir);
    this.beam.scale.set(s, len, s);
    this.mat.uniforms.uTip.value = dist / len;
    this.mat.uniforms.uTime.value = t;
    this.core.position.copy(this.source);
    this.core.quaternion.copy(this.beam.quaternion);
    this.core.scale.set(s * 0.3, len, s * 0.3);
    this.coreMat.uniforms.uTip.value = dist / len;
    this.coreMat.uniforms.uTime.value = t * 1.3;
    this.light.angle = Math.atan((this.radius * 1.5) / dist);

    this.glow.position.copy(tip);
    this.glow.material.opacity = 0.6 + 0.25 * Math.sin(t * 6);
  }
}

function mulberry(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
