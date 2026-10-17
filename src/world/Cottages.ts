import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AssetLoader } from '../core/AssetLoader';

/**
 * Village cottages built in code, in the KayKit Holiday style: chunky rounded shapes,
 * thick modelled snow, and the pack's own atlas material. The atlas is 8×4 swatches of soft
 * vertical gradients; every part maps onto one swatch, light at the top and darker at the
 * bottom, which is what gives KayKit models their look.
 *
 * Each style is one mesh on that one material, so a street of them instances into a few
 * draw calls. The door faces +z;
 * sizes are in metres. Loaded through `assets.model('proc/cottage_<n>')` like any glTF.
 */

/** [column, row] in holiday_bits_texture.png, plus the slice of its gradient to use (0 = top). */
type Swatch = readonly [number, number, number?, number?];

const SW = {
  snow: [5, 3, 0, 0.3],
  snowShade: [5, 3, 0.1, 0.55],
  cream: [0, 2, 0, 0.55],
  icing: [3, 2, 0, 0.3],
  ginger: [5, 0, 0.1, 0.8],
  gingerDark: [6, 1, 0.2, 0.9],
  red: [6, 2, 0, 0.55],
  brick: [6, 0, 0.1, 0.8],
  green: [0, 1, 0.05, 0.6],
  teal: [4, 2, 0, 0.6],
  blue: [7, 2, 0, 0.45],
  orange: [1, 1, 0, 0.6],
  glass: [2, 2, 0, 0.25],
  bulbRed: [7, 3, 0, 0.3],
  bulbYellow: [2, 2, 0, 0.2],
  bulbGreen: [0, 3, 0, 0.3],
  bulbBlue: [7, 2, 0, 0.3],
  stone: [3, 0, 0, 0.6],
  stoneDark: [4, 0, 0, 0.7],
} as const satisfies Record<string, Swatch>;

interface Style {
  w: number;
  d: number;
  /** Wall height; > 4.5 m means two storeys. */
  h: number;
  wall: Swatch;
  trim: Swatch;
  roof: Swatch;
  door: Swatch;
  shutters?: Swatch;
  logs?: boolean;
  chimneyX: number;
}

const STYLES: Style[] = [
  { w: 6.6, d: 5.4, h: 3.3, wall: SW.cream, trim: SW.icing, roof: SW.red, door: SW.green, chimneyX: 1.6 },
  { w: 6.2, d: 5.2, h: 3.3, wall: SW.red, trim: SW.icing, roof: SW.gingerDark, door: SW.green, shutters: SW.cream, chimneyX: -1.5 },
  { w: 5.4, d: 5, h: 5.5, wall: SW.blue, trim: SW.icing, roof: SW.ginger, door: SW.red, shutters: SW.cream, chimneyX: 1.2 },
  { w: 7, d: 5.4, h: 3.2, wall: SW.green, trim: SW.icing, roof: SW.red, door: SW.red, chimneyX: -2 },
  { w: 6.2, d: 5.2, h: 3.3, wall: SW.ginger, trim: SW.gingerDark, roof: SW.green, door: SW.red, logs: true, chimneyX: -1.5 },
  { w: 6.4, d: 5.6, h: 3.4, wall: SW.stone, trim: SW.cream, roof: SW.gingerDark, door: SW.teal, shutters: SW.teal, chimneyX: 1.8 },
];

export const COTTAGE_COUNT = STYLES.length;

/** Window centres in the cottage's own space (matching `buildCottage`), for the night-time glow. */
export function cottageWindows(index: number): THREE.Vector3[] {
  const { w, d, h } = STYLES[index % STYLES.length];
  const base = 0.4;
  const out: THREE.Vector3[] = [];
  const storeys = h > 4.5 ? 2 : 1;
  for (let st = 0; st < storeys; st++) {
    const y = base + 1.45 + st * 2.4;
    for (const x of st > 0 ? [-w * 0.3, 0, w * 0.3] : [-w * 0.3, w * 0.3]) out.push(new THREE.Vector3(x, y, d / 2 + 0.25));
  }
  out.push(new THREE.Vector3(w / 2 + 0.25, base + 1.45, 0), new THREE.Vector3(-w / 2 - 0.25, base + 1.45, 0));
  return out;
}

/** Keep only position + normal and make it non-indexed, so every part merges. */
function bare(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal') out.deleteAttribute(k);
  return out;
}

/**
 * UVs onto one atlas swatch: u at the swatch's centre, v following the part's height, so
 * its top samples the light end of the gradient. glTF textures aren't flipped: v=0 is the top.
 */
function onSwatch(g: THREE.BufferGeometry, [c, r, from = 0, to = 0.6]: Swatch): THREE.BufferGeometry {
  const out = bare(g);
  out.computeBoundingBox();
  const { min, max } = out.boundingBox!;
  const span = Math.max(max.y - min.y, 1e-3);
  const pos = out.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const t = (max.y - pos.getY(i)) / span; // 0 at the top
    uv[i * 2] = (c + 0.5) / 8;
    uv[i * 2 + 1] = (r + 0.02 + (from + (to - from) * t) * 0.96) / 4;
  }
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, rotX = 0) => (rotX ? g.rotateX(rotX) : g).translate(x, y, z);

/** Soft-cornered box, the basic KayKit building block. */
const rbox = (w: number, h: number, d: number, radius = 0.12) =>
  new RoundedBoxGeometry(w, h, d, 1, Math.min(radius, w / 2.01, h / 2.01, d / 2.01));

let atlasMaterial: Promise<THREE.Material> | null = null;

/** The KayKit Holiday atlas material, taken from a pack model so shading matches exactly. */
function holidayMaterial(assets: AssetLoader): Promise<THREE.Material> {
  atlasMaterial ??= assets.model('holiday/gingerbread_house').then((g) => {
    let mat: THREE.Material | undefined;
    g.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!mat && m.isMesh) mat = Array.isArray(m.material) ? m.material[0] : m.material;
    });
    return mat!;
  });
  return atlasMaterial;
}

export async function buildCottage(index: number, assets: AssetLoader): Promise<THREE.Group> {
  const s = STYLES[index % STYLES.length];
  const body: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, sw: Swatch) => body.push(onSwatch(g, sw));
  const { w, d, h } = s;
  const hw = w / 2;
  const hd = d / 2;
  const base = 0.4;
  const top = base + h;

  // Footing and walls.
  // Footing reaches a metre below ground, so the edge of a plot never shows a gap.
  add(at(rbox(w + 0.6, base + 1, d + 0.6, 0.15), 0, (base - 1) / 2, 0), SW.stoneDark);
  add(at(rbox(w, h + 0.1, d, 0.25), 0, base + h / 2, 0), s.wall);
  if (s.logs) {
    // Round logs stacked along the front and back, ends poking out at the corners.
    for (let y = base + 0.25; y < top; y += 0.42) {
      for (const z of [hd, -hd]) add(new THREE.CylinderGeometry(0.22, 0.22, w + 0.5, 6, 1, true).rotateZ(Math.PI / 2).translate(0, y, z), s.wall);
    }
  } else {
    // Chunky icing corner posts.
    for (const [cx, cz] of [[hw, hd], [-hw, hd], [hw, -hd], [-hw, -hd]]) add(at(rbox(0.42, h + 0.1, 0.42, 0.18), cx, base + h / 2, cz), s.trim);
  }

  // Big friendly roof: steep gables, a deep overhang, a thick snow blanket with drips.
  const rise = d * 0.5;
  const over = 0.6;
  const run = hd + over;
  const slope = Math.atan2(rise, hd);
  const drop = rise * (run / hd);
  const slab = Math.hypot(run, drop);
  const roofT = 0.38;
  const snowT = 0.34;
  /** Snow covers the upper part of each slope; the roof colour shows below it. */
  const cover = 0.78;
  const gableShape = new THREE.Shape([new THREE.Vector2(-hd, 0), new THREE.Vector2(hd, 0), new THREE.Vector2(0, rise)]);
  add(new THREE.ExtrudeGeometry(gableShape, { depth: w - 0.2, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-(w - 0.2) / 2, top, 0), s.wall);
  const roofW = w + over * 2;
  for (const side of [1, -1]) {
    const nY = Math.cos(slope);
    const nZ = side * Math.sin(slope);
    const cz = (side * run) / 2;
    const cy = top + rise - drop / 2;
    add(at(rbox(roofW, roofT, slab, 0.14), 0, cy + nY * (roofT / 2), cz + nZ * (roofT / 2), side * slope), s.roof);
    // Down-slope direction, from the ridge towards the eave.
    const dY = -drop / slab;
    const dZ = (side * run) / slab;
    const ridgeY = cy + drop / 2;
    const ridgeZ = cz - (side * run) / 2;
    const len = slab * cover;
    const k = roofT + snowT / 2 - 0.06;
    add(at(rbox(roofW + 0.16, snowT, len, 0.16), 0, ridgeY + dY * (len / 2) + nY * k, ridgeZ + dZ * (len / 2) + nZ * k, side * slope), SW.snow);
    // Rounded drips along the snow's lower edge.
    const eaveY = ridgeY + dY * len + nY * (roofT + 0.08);
    const eaveZ = ridgeZ + dZ * len + nZ * (roofT + 0.08);
    const nDrips = Math.round(roofW / 1.15);
    for (let i = 0; i < nDrips; i++) {
      const x = -roofW / 2 + 0.45 + i * ((roofW - 0.9) / (nDrips - 1));
      const r = 0.2 + ((i * 7) % 3) * 0.05;
      add(new THREE.SphereGeometry(r, 6, 4).scale(1, 1.3, 1).translate(x, eaveY - r * 0.35, eaveZ), SW.snowShade);
    }
  }
  add(at(rbox(roofW + 0.2, 0.42, 0.55, 0.2), 0, top + rise + roofT + 0.12, 0), SW.snow); // ridge

  // Chimney with a snow pillow.
  const chZ = -hd * 0.3;
  const chBase = top + rise * 0.55;
  add(at(rbox(0.95, 2.1, 0.95, 0.14), s.chimneyX, chBase + 0.6, chZ), SW.brick);
  add(at(rbox(1.15, 0.28, 1.15, 0.12), s.chimneyX, chBase + 1.7, chZ), SW.stoneDark);
  add(new THREE.SphereGeometry(0.55, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1).translate(s.chimneyX, chBase + 1.82, chZ), SW.snow);

  // Arched door in a thick icing frame, a step and a wreath.
  const front = hd;
  add(at(rbox(1.7, 0.3, 1, 0.12), 0, base + 0.02, hd + 0.55), SW.stone);
  add(at(rbox(1.55, 2.35, 0.3, 0.45), 0, base + 1.12, front + 0.05), s.trim);
  add(at(rbox(1.2, 2.1, 0.34, 0.45), 0, base + 1.0, front + 0.08), s.door);
  add(new THREE.OctahedronGeometry(0.09, 0).translate(0.38, base + 1.0, front + 0.27), SW.orange); // knob
  add(new THREE.TorusGeometry(0.3, 0.12, 4, 10).translate(0, base + 1.55, front + 0.3), SW.green);
  add(at(rbox(0.3, 0.2, 0.12, 0.05), 0, base + 1.28, front + 0.38), SW.red);

  // Warm yellow windows in rounded icing frames with snowy sills. Built facing +z, then turned.
  const win = (x: number, y: number, z: number, rotY: number) => {
    const put = (geo: THREE.BufferGeometry, dx: number, dy: number, dz: number) => geo.translate(dx, dy, dz).rotateY(rotY).translate(x, y, z);
    add(put(rbox(1.35, 1.45, 0.24, 0.3), 0, 0, 0.04), s.trim);
    add(put(new THREE.BoxGeometry(0.95, 1.05, 0.2), 0, 0, 0.1), SW.glass);
    add(put(new THREE.BoxGeometry(0.12, 1.05, 0.26), 0, 0, 0.1), s.trim);
    add(put(new THREE.BoxGeometry(0.95, 0.12, 0.26), 0, 0, 0.1), s.trim);
    add(put(rbox(1.5, 0.24, 0.42, 0.11), 0, -0.78, 0.16), SW.snow);
    if (s.shutters) for (const sx of [-0.95, 0.95]) add(put(rbox(0.42, 1.35, 0.14, 0.1), sx, 0, 0.06), s.shutters);
  };
  const storeys = h > 4.5 ? 2 : 1;
  for (let st = 0; st < storeys; st++) {
    const y = base + 1.45 + st * 2.4;
    for (const x of [-w * 0.3, w * 0.3]) win(x, y, front, 0);
    if (st > 0) win(0, y, front, 0);
  }
  win(hw, base + 1.45, 0, Math.PI / 2);
  win(-hw, base + 1.45, 0, -Math.PI / 2);

  // Chunky string lights along the front eave.
  const bulbs = [SW.bulbRed, SW.bulbYellow, SW.bulbGreen, SW.bulbBlue];
  const span = roofW - 0.6;
  const n = Math.floor(span / 0.6);
  const lightY = top + rise - drop - 0.3;
  for (let i = 0; i <= n; i++) {
    const x = -span / 2 + (i * span) / n;
    const sag = Math.sin((i / n) * Math.PI * 4) ** 2 * 0.16;
    add(new THREE.OctahedronGeometry(0.14, 0).scale(1, 1.3, 1).translate(x, lightY - sag, run + 0.1), bulbs[i % bulbs.length]);
  }

  const material = await holidayMaterial(assets);
  const group = new THREE.Group();
  group.name = `cottage_${index}`;
  const bodyMesh = new THREE.Mesh(mergeGeometries(body), material);
  body.forEach((g) => g.dispose());
  bodyMesh.castShadow = bodyMesh.receiveShadow = true;
  group.add(bodyMesh);
  return group;
}
