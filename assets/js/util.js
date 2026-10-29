import * as THREE from 'three';

// Minimum-jerk position profile s(τ) = 10τ³ − 15τ⁴ + 6τ⁵: zero velocity and acceleration at both ends.
export const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (10 + x * (-15 + 6 * x)));

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

let radial = null;
// Soft white dot used for glows, sprites and pooled light.
export function radialTexture() {
  if (radial) return radial;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.22, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  radial = new THREE.CanvasTexture(c);
  radial.colorSpace = THREE.SRGBColorSpace;
  return radial;
}
