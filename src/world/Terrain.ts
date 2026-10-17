import * as THREE from 'three';
import { RAPIER } from '../core/Physics';
import { setWorldUvs } from './SnowGround';

export interface FlatSpot {
  x: number;
  z: number;
  r: number;
  /** Target height for the flattened area. */
  y?: number;
  /** A building plot: flattened to the ground's own height at its centre instead of to `y`. */
  local?: boolean;
}

export interface TerrainOptions {
  half: number;
  segments: number;
  flats: FlatSpot[];
  paths: [number, number][][];
  lake?: { x: number; z: number; r: number };
}

/** Value-noise-free height: a few layered sines are enough for gentle snowy hills. */
function baseHeight(x: number, z: number) {
  return (
    Math.sin(x * 0.045) * Math.cos(z * 0.04) * 1.6 +
    Math.sin(x * 0.11 + 1.3) * Math.sin(z * 0.09 + 0.4) * 0.6 +
    Math.sin((x + z) * 0.021) * 1.2
  );
}

function distToSegment(px: number, pz: number, a: [number, number], b: [number, number]) {
  const [ax, az] = a;
  const [bx, bz] = b;
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/** Heightmap terrain with flattened building spots, trodden paths and a rim of hills. */
/** Road segments bucketed into GRID-metre cells, so distance queries only look nearby. */
const GRID = 10;

export class Terrain {
  readonly mesh: THREE.Mesh;
  readonly ice?: THREE.Mesh;
  private readonly segGrid = new Map<string, [number, number, number, number][]>();

  constructor(private readonly opts: TerrainOptions) {
    const { half, segments } = opts;
    for (const p of opts.paths) {
      for (let i = 0; i < p.length - 1; i++) {
        const [ax, az] = p[i];
        const [bx, bz] = p[i + 1];
        const key = `${Math.floor((ax + bx) / 2 / GRID)},${Math.floor((az + bz) / 2 / GRID)}`;
        let list = this.segGrid.get(key);
        if (!list) this.segGrid.set(key, (list = []));
        list.push([ax, az, bx, bz]);
      }
    }
    // Building plots sit at the natural ground height under their centre (measured with the
    // plots themselves left out), so a house is level without digging a pit or raising a mound.
    const others = opts.flats.filter((f) => !f.local);
    for (const f of opts.flats) if (f.local) f.y = this.heightWith(f.x, f.z, others);
    const geo = new THREE.PlaneGeometry(half * 2, half * 2, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const snow = new THREE.Color('#f4f8ff');
    const blue = new THREE.Color('#cfdcf0');
    const shoulder = new THREE.Color('#aebcd0');
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, this.heightAt(x, z));
      const pd = this.pathDistance(x, z);
      const shade = 0.5 + 0.5 * Math.sin(x * 0.3) * Math.sin(z * 0.27);
      c.copy(snow).lerp(blue, shade * 0.35);
      // Snow pushed aside along the roads: a darker band that frames the cobblestones.
      if (pd < 4.6) c.lerp(shoulder, THREE.MathUtils.smoothstep(pd, 4.6, 2.4) * 0.7);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    setWorldUvs(geo);
    // Placeholder until World swaps in the textured snow material.
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';

    if (opts.lake) {
      const { x, z, r } = opts.lake;
      const iceGeo = new THREE.CircleGeometry(r, 64);
      iceGeo.rotateX(-Math.PI / 2);
      const iceMat = new THREE.MeshStandardMaterial({ color: '#a9d8f2', roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.92 });
      this.ice = new THREE.Mesh(iceGeo, iceMat);
      this.ice.position.set(x, this.heightAt(x, z) + 0.05, z);
      this.ice.receiveShadow = true;
    }
  }

  /** Distance to the nearest road centreline; exact up to GRID metres, Infinity beyond. */
  pathDistance(x: number, z: number) {
    let d = Infinity;
    const cx = Math.floor(x / GRID);
    const cz = Math.floor(z / GRID);
    for (let gx = cx - 1; gx <= cx + 1; gx++)
      for (let gz = cz - 1; gz <= cz + 1; gz++) {
        const list = this.segGrid.get(`${gx},${gz}`);
        if (list) for (const [ax, az, bx, bz] of list) d = Math.min(d, distToSegment(x, z, [ax, az], [bx, bz]));
      }
    return d;
  }

  heightAt(x: number, z: number): number {
    return this.heightWith(x, z, this.opts.flats);
  }

  private heightWith(x: number, z: number, flats: FlatSpot[]): number {
    const { half, lake } = this.opts;
    let h = baseHeight(x, z);
    // Paths are slightly smoothed.
    const pd = this.pathDistance(x, z);
    // Roads run almost level; the bumps fade back in over a few metres either side.
    if (pd < 9) h *= 0.12 + 0.88 * THREE.MathUtils.smoothstep(pd, 3, 9);
    for (const f of flats) {
      const d = Math.hypot(x - f.x, z - f.z);
      const t = THREE.MathUtils.smoothstep(d, f.r, f.r + 8);
      h = THREE.MathUtils.lerp(f.y ?? 0, h, t);
    }
    if (lake) {
      const d = Math.hypot(x - lake.x, z - lake.z);
      const t = THREE.MathUtils.smoothstep(d, lake.r - 2, lake.r + 6);
      h = THREE.MathUtils.lerp(-0.6, h, t);
    }
    // Rim of hills keeps the player inside the map.
    const edge = Math.max(Math.abs(x), Math.abs(z));
    const rim = THREE.MathUtils.smoothstep(edge, half - 45, half - 5);
    h += rim * rim * 22;
    return h;
  }

  /** Static trimesh collider matching the rendered terrain. */
  addCollider(world: RAPIER.World) {
    const geo = this.mesh.geometry;
    const verts = new Float32Array(geo.attributes.position.array);
    const idx = new Uint32Array(geo.index!.array);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx).setFriction(0.8), body);
    // Invisible walls just inside the rim, as a safety net.
    const h = this.opts.half - 8;
    const walls: [number, number, number, number][] = [
      [0, -h, h, 1], [0, h, h, 1], [-h, 0, 1, h], [h, 0, 1, h],
    ];
    for (const [x, z, hx, hz] of walls) {
      world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 40, hz).setTranslation(x, 20, z), body);
    }
  }
}
