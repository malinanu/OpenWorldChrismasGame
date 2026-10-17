import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MiniGameId } from '../minigames/MiniGame';

export interface RoadDef {
  /** Game zone this road leads to (gets a signpost at the plaza end). */
  to?: MiniGameId;
  points: [number, number][];
  loop?: boolean;
  /** Layout hint for tools/layout-world.py: line this street with houses. */
  houses?: boolean;
}

export interface Signpost {
  position: THREE.Vector3;
  /** Direction along the road (unit, XZ). */
  dir: THREE.Vector3;
  to: MiniGameId;
}

const WIDTH = 5;
const SAMPLE = 1;
/** Strips across the road's width. */
const ACROSS = 4;
const LANTERN_EVERY = 28;
/** Metres per cobblestone texture tile. UVs are world-aligned so overlapping roads match exactly. */
const TILE = 2.5;

/** A small tileable cobblestone texture, drawn once on a canvas. */
function cobblestoneTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d7dde6'; // snow packed between the stones
  g.fillRect(0, 0, size, size);
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const palette = ['#8d8478', '#7f776d', '#958b7e', '#a39a8c', '#867e74'];
  const rows = 6;
  const h = size / rows;
  for (let r = 0; r < rows; r++) {
    const cols = 4;
    const w = size / cols;
    const off = (r % 2) * (w / 2);
    for (let k = -1; k <= cols; k++) {
      const x = k * w + off + (rnd() - 0.5) * 6;
      const y = r * h + (rnd() - 0.5) * 4;
      const sw = w - 8 - rnd() * 6;
      const sh = h - 7 - rnd() * 4;
      // Draw at x and wrapped copies so the tile repeats seamlessly.
      for (const dx of [0, -size, size]) {
        g.fillStyle = palette[Math.floor(rnd() * palette.length)];
        g.beginPath();
        g.roundRect(x + dx + 4, y + 3, sw, sh, 9);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.18)'; // a little snow on top of each stone
        g.beginPath();
        g.roundRect(x + dx + 8, y + 5, sw * 0.6, sh * 0.25, 5);
        g.fill();
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Cobblestone roads from the Great Tree to every game zone.
 * Roads are Catmull-Rom curves through a few control points; the dense samples
 * drive the mesh, the terrain flattening/shoulders, lantern spacing and the map.
 */
export class Roads {
  /** Dense polylines (x, z) — used by Terrain, scatter clearance and the map. */
  readonly lines: [number, number][][] = [];
  readonly lanterns: THREE.Vector3[] = [];
  readonly signposts: Signpost[] = [];

  constructor(private readonly defs: RoadDef[]) {
    for (const d of defs) {
      const curve = new THREE.CatmullRomCurve3(d.points.map(([x, z]) => new THREE.Vector3(x, 0, z)), !!d.loop, 'centripetal');
      const n = Math.max(2, Math.ceil(curve.getLength() / SAMPLE));
      this.lines.push(curve.getSpacedPoints(n).map((p) => [p.x, p.z] as [number, number]));
    }
  }

  /** A half-disc on the end of a road, so corners and junctions join without square gaps. */
  private cap(line: [number, number][], i: number, heightAt: (x: number, z: number) => number, pos: number[], nor: number[], uv: number[], idx: number[]) {
    const [x, z] = line[i];
    const [ox, oz] = line[i === 0 ? 1 : i - 1];
    const out = Math.atan2(z - oz, x - ox); // pointing away from the road
    const base = pos.length / 3;
    const push = (px: number, pz: number) => {
      pos.push(px, heightAt(px, pz) + 0.08, pz);
      nor.push(0, 1, 0);
      uv.push(px / TILE, pz / TILE);
    };
    push(x, z);
    const steps = 10;
    for (let k = 0; k <= steps; k++) {
      const a = out - Math.PI / 2 + (Math.PI * k) / steps;
      push(x + Math.cos(a) * (WIDTH / 2), z + Math.sin(a) * (WIDTH / 2));
    }
    for (let k = 0; k < steps; k++) {
      const p1 = base + 1 + k;
      const p2 = p1 + 1;
      // Counter-clockwise seen from above, i.e. the triangle's normal points up.
      const ax = pos[p1 * 3] - x, az = pos[p1 * 3 + 2] - z;
      const bx = pos[p2 * 3] - x, bz = pos[p2 * 3 + 2] - z;
      if (az * bx - ax * bz > 0) idx.push(base, p1, p2);
      else idx.push(base, p2, p1);
    }
  }

  /** One merged mesh for every road, draped on the terrain. Also fills `lanterns` and `signposts`. */
  build(heightAt: (x: number, z: number) => number): THREE.Mesh {
    const pos: number[] = [];
    const uv: number[] = [];
    const nor: number[] = [];
    const idx: number[] = [];
    this.lines.forEach((line, li) => {
      const def = this.defs[li];
      const base = pos.length / 3;
      let along = 0;
      let nextLantern = 8;
      let side = 1;
      for (let i = 0; i < line.length; i++) {
        const [x, z] = line[i];
        const [ax, az] = line[Math.max(0, i - 1)];
        const [bx, bz] = line[Math.min(line.length - 1, i + 1)];
        let tx = bx - ax;
        let tz = bz - az;
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl;
        tz /= tl;
        if (i > 0) along += Math.hypot(x - ax, z - az);
        // ACROSS+1 vertices across the road, each lifted just above its own patch of terrain,
        // so the road drapes over bumps instead of letting snow poke through the middle.
        for (let k = 0; k <= ACROSS; k++) {
          const s = 1 - (2 * k) / ACROSS;
          const ex = x - tz * (WIDTH / 2) * s;
          const ez = z + tx * (WIDTH / 2) * s;
          pos.push(ex, heightAt(ex, ez) + 0.08, ez);
          nor.push(0, 1, 0);
          uv.push(ex / TILE, ez / TILE);
        }
        if (i > 0) {
          const row = ACROSS + 1;
          for (let k = 0; k < ACROSS; k++) {
            const a = base + (i - 1) * row + k;
            const b = a + row;
            // Counter-clockwise seen from above.
            idx.push(a, b, a + 1, a + 1, b, b + 1);
          }
        }
        if (!def.loop && along >= nextLantern && i < line.length - 6) {
          nextLantern += LANTERN_EVERY;
          side = -side;
          this.lanterns.push(new THREE.Vector3(x - tz * (WIDTH / 2 + 1.1) * side, 0, z + tx * (WIDTH / 2 + 1.1) * side));
        }
      }
      if (!def.loop) {
        this.cap(line, 0, heightAt, pos, nor, uv, idx);
        this.cap(line, line.length - 1, heightAt, pos, nor, uv, idx);
      }
      if (def.to) {
        // Signpost on the right-hand side, a few metres down the road from the plaza.
        const k = Math.min(4, line.length - 1);
        const [x, z] = line[k];
        const [x2, z2] = line[k + 1] ?? line[k];
        const dir = new THREE.Vector3(x2 - x, 0, z2 - z).normalize();
        this.signposts.push({ position: new THREE.Vector3(x + dir.z * (WIDTH / 2 + 1.4), 0, z - dir.x * (WIDTH / 2 + 1.4)), dir, to: def.to });
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({
      map: cobblestoneTexture(),
      roughness: 0.92,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      // Where roads overlap (junctions, corners) two ribbons sit a hair apart and would
      // z-fight; without depth writes the later one simply paints over with the same stones.
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 1; // after the terrain, which must already be in the depth buffer
    mesh.receiveShadow = true;
    mesh.name = 'roads';
    return mesh;
  }
}

/**
 * Every signpost in two draw calls: the posts are one InstancedMesh, and all arrow
 * boards (front and back) are one merged mesh textured from a shared canvas atlas.
 * Each board points down its road; the back face's arrow points the same way in the world.
 */
export function buildSignposts(signs: Signpost[], labels: string[], groundY: (x: number, z: number) => number): THREE.Group {
  const group = new THREE.Group();
  const rowH = 128;
  const atlas = document.createElement('canvas');
  atlas.width = 512;
  atlas.height = rowH * signs.length * 2;
  const x = atlas.getContext('2d')!;
  const drawBoard = (row: number, text: string, arrowRight: boolean) => {
    const y0 = row * rowH;
    x.fillStyle = '#a8703f';
    x.beginPath();
    if (arrowRight) {
      x.moveTo(8, y0 + 12); x.lineTo(440, y0 + 12); x.lineTo(504, y0 + 64); x.lineTo(440, y0 + 116); x.lineTo(8, y0 + 116);
    } else {
      x.moveTo(504, y0 + 12); x.lineTo(72, y0 + 12); x.lineTo(8, y0 + 64); x.lineTo(72, y0 + 116); x.lineTo(504, y0 + 116);
    }
    x.closePath();
    x.fill();
    x.strokeStyle = '#5b3a1f';
    x.lineWidth = 6;
    x.stroke();
    x.fillStyle = '#fff8ea';
    x.font = 'bold 46px Fredoka, system-ui, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(text, arrowRight ? 230 : 282, y0 + 66, 400);
  };

  const boards: THREE.BufferGeometry[] = [];
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 2.8, 0.2), new THREE.MeshStandardMaterial({ color: '#7a4a2b', roughness: 0.85 }), signs.length);
  const m = new THREE.Matrix4();
  signs.forEach((sign, i) => {
    drawBoard(i * 2, labels[i], true);
    drawBoard(i * 2 + 1, labels[i], false);
    // The sign's local +x axis points down the road.
    const base = new THREE.Matrix4().compose(
      sign.position.clone().setY(groundY(sign.position.x, sign.position.z)),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-sign.dir.z, sign.dir.x)),
      new THREE.Vector3(1, 1, 1),
    );
    posts.setMatrixAt(i, m.multiplyMatrices(base, new THREE.Matrix4().makeTranslation(0, 1.4, 0)));
    for (const back of [false, true]) {
      const g = new THREE.PlaneGeometry(2.6, 0.65);
      // Point this quad's UVs at its row of the atlas.
      const row = i * 2 + (back ? 1 : 0);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) {
        const v = uv.getY(k);
        uv.setY(k, 1 - (row + 1 - v) / (signs.length * 2));
      }
      const local = new THREE.Matrix4().makeTranslation(1.15, 2.35, 0);
      if (back) local.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(base, local));
      boards.push(g);
    }
  });
  posts.castShadow = true;
  posts.instanceMatrix.needsUpdate = true;
  posts.computeBoundingSphere();
  const tex = new THREE.CanvasTexture(atlas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const boardMesh = new THREE.Mesh(mergeGeometries(boards), new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.5, roughness: 0.8 }));
  boards.forEach((b) => b.dispose());
  group.add(posts, boardMesh);
  return group;
}
