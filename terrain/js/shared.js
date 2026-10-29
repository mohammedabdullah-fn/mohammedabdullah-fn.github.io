// Terrain Lab: data shared by the 3D lab and the section panel.
// Pure JS, no three.js, so the panel and index keep working even if WebGL does not.

export const MAP_HALF = 5.5; // metres; the lab floor spans [-5.5, 5.5] on x and z

// Classifier column order, as in the project's confusion matrix.
export const CLASSES = ['carpet', 'hardwood', 'grass', 'tile'];

// The project's terrain-to-haptic (T2H) table. L/R are the Xbox controller motor levels.
export const T2H = {
  tile:     { label: 'Tile',     amp: 0.35, pattern: 'continuous', patternLabel: 'Continuous', feel: 'Steady buzz',  L: 0.20, R: 0.35 },
  hardwood: { label: 'Hardwood', amp: 0.25, pattern: 'continuous', patternLabel: 'Continuous', feel: 'Medium hum',   L: 0.12, R: 0.25 },
  carpet:   { label: 'Carpet',   amp: 0.12, pattern: 'slow',       patternLabel: 'Slow pulse', feel: 'Gentle throb', L: 0.05, R: 0.12 },
  grass:    { label: 'Grass',    amp: 0.10, pattern: 'fast',       patternLabel: 'Fast pulse', feel: 'Faint taps',   L: 0.03, R: 0.10 },
};

// Rows = actual surface, columns = predicted [carpet, hardwood, grass, tile], in percent.
export const CONFUSION = {
  carpet:   [97.2, 0.7, 1.4, 0.7],
  hardwood: [2.0, 72.3, 0.0, 25.7],
  grass:    [0.0, 0.0, 99.4, 0.6],
  tile:     [2.1, 18.1, 0.7, 79.2],
};
export const SVM_ACCURACY = 87.3;

// Four surface zones, one per quadrant. North is -z.
export const ZONES = {
  tile:     { code: 'A', x0: -MAP_HALF, x1: 0, z0: -MAP_HALF, z1: 0 },
  hardwood: { code: 'B', x0: 0, x1: MAP_HALF, z0: -MAP_HALF, z1: 0 },
  carpet:   { code: 'C', x0: -MAP_HALF, x1: 0, z0: 0, z1: MAP_HALF },
  grass:    { code: 'D', x0: 0, x1: MAP_HALF, z0: 0, z1: MAP_HALF },
};

export function surfaceAt(x, z) {
  if (x < 0) return z < 0 ? 'tile' : 'carpet';
  return z < 0 ? 'hardwood' : 'grass';
}

// Waypoint beacons. Sections sit in the zone centres, links on the cardinal edges.
export const BEACONS = [
  { id: 'about',      num: '01', label: 'About',      kind: 'section', x: -2.4, z: -2.2, zone: 'Tile' },
  { id: 'projects',   num: '02', label: 'Projects',   kind: 'section', x:  2.4, z: -2.2, zone: 'Hardwood' },
  { id: 'experience', num: '03', label: 'Experience', kind: 'section', x: -2.4, z:  2.2, zone: 'Carpet' },
  { id: 'now',        num: '04', label: 'Now',        kind: 'section', x:  2.4, z:  2.2, zone: 'Grass' },
  { id: 'resume',     num: '05', label: 'Resume',     kind: 'section', x:  0.0, z: -4.2, zone: 'A/B edge' },
  { id: 'linkedin',   num: '06', label: 'LinkedIn',   kind: 'link', x: -4.2, z: 0.0, zone: 'A/C edge',
    href: 'https://www.linkedin.com/in/abd-mohdd', display: 'linkedin.com/in/abd-mohdd' },
  { id: 'github',     num: '07', label: 'GitHub',     kind: 'link', x:  4.2, z: 0.0, zone: 'B/D edge',
    href: 'https://github.com/mohammedabdullah-fn', display: 'github.com/mohammedabdullah-fn' },
  { id: 'email',      num: '08', label: 'Email',      kind: 'link', x:  0.0, z: 4.2, zone: 'C/D edge',
    href: 'mailto:mohammedabdullah.fn@northeastern.edu', display: 'mohammedabdullah.fn@northeastern.edu' },
];
export const BEACON_TRIGGER = 0.6; // rover centre within this radius = "driven into"
export const BEACON_RELEASE = 0.9; // must leave this radius before the beacon can fire again
export const SECTION_IDS = BEACONS.filter((b) => b.kind === 'section').map((b) => b.id);

export function beaconById(id) {
  return BEACONS.find((b) => b.id === id) || null;
}

// A tiny event bus so the panel and the 3D lab stay decoupled.
const bus = new EventTarget();
export function emit(type, detail = {}) {
  bus.dispatchEvent(new CustomEvent(type, { detail }));
}
export function on(type, fn) {
  const h = (e) => fn(e.detail);
  bus.addEventListener(type, h);
  return () => bus.removeEventListener(type, h);
}
