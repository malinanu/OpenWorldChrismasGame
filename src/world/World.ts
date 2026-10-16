import * as THREE from 'three';
import { assets } from '../core/AssetLoader';
import { Physics, RAPIER } from '../core/Physics';
import type { MiniGameId } from '../minigames/MiniGame';
import { buildInstanced, modelBounds, type Placement } from './Instancing';
import { Lighting } from './Lighting';
import { Terrain, type FlatSpot } from './Terrain';

type Vec3 = [number, number, number];
type ColliderKind = 'trunk' | 'box';

interface ScatterDef {
  models: string[];
  count: number;
  minRadius: number;
  maxRadius: number;
  clearance: number;
  pathClearance: number;
  scale: [number, number];
  snow?: number;
  collider?: ColliderKind;
  seed: number;
  /** Split instances into square chunks of this size so off-screen chunks are culled. */
  chunk?: number;
}

interface PropDef {
  model: string;
  at?: Vec3[];
  line?: { from: Vec3; to: Vec3; step: number };
  scale?: number;
  rotY?: number[];
  randomRotY?: boolean;
  collider?: ColliderKind;
  snow?: number;
  light?: string;
}

export interface ZoneDef {
  id: MiniGameId;
  position: Vec3;
  radius: number;
}

export interface WorldData {
  half: number;
  spawn: Vec3;
  lake?: { x: number; z: number; r: number };
  paths: [number, number][][];
  flats: FlatSpot[];
  zones: ZoneDef[];
  scatter: ScatterDef[];
  props: PropDef[];
}

/** Deterministic PRNG so the forest is the same every visit. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distToSegment(px: number, pz: number, [ax, az]: [number, number], [bx, bz]: [number, number]) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/** Builds the overworld scene + static physics from `public/world/frostvale.json`. */
export class World {
  readonly scene = new THREE.Scene();
  readonly physics = new Physics();
  terrain!: Terrain;
  lighting!: Lighting;
  data!: WorldData;
  /** Positions that want a warm light; the nearest few get a real PointLight. */
  readonly lightSpots: { pos: THREE.Vector3; color: THREE.Color }[] = [];
  private readonly lightPool: THREE.PointLight[] = [];
  private readonly glowSprites: THREE.Sprite[] = [];

  /** `forest` scales scatter counts (quality setting); `shadowSize` 0 turns sun shadows off. */
  async load(opts: { forest: number; shadowSize: number }, onStep?: (label: string) => void) {
    const res = await fetch(`${import.meta.env.BASE_URL}world/frostvale.json`);
    this.data = (await res.json()) as WorldData;
    const d = this.data;

    this.lighting = new Lighting(this.scene, opts.shadowSize);
    this.terrain = new Terrain({ half: d.half, segments: 150, flats: d.flats, paths: d.paths, lake: d.lake });
    this.scene.add(this.terrain.mesh);
    if (this.terrain.ice) this.scene.add(this.terrain.ice);
    this.terrain.addCollider(this.physics.world);

    onStep?.('Growing the forest…');
    await Promise.all(d.scatter.map((s) => this.scatter({ ...s, count: Math.round(s.count * opts.forest) })));
    onStep?.('Decorating the village…');
    await Promise.all(d.props.map((p) => this.prop(p)));

    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight('#ffb35a', 0, 14, 1.6);
      this.lightPool.push(l);
      this.scene.add(l);
    }
    const glowTex = await assets.texture('vfx/glow.png');
    for (const s of this.lightSpots) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTex, color: s.color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }),
      );
      sprite.position.copy(s.pos);
      sprite.scale.setScalar(1.3);
      this.glowSprites.push(sprite);
      this.scene.add(sprite);
    }
  }

  groundY(x: number, z: number) {
    return this.terrain.heightAt(x, z);
  }

  private isClear(x: number, z: number, clearance: number, pathClearance: number) {
    const d = this.data;
    for (const f of d.flats) if (Math.hypot(x - f.x, z - f.z) < f.r + clearance * 0.5) return false;
    for (const zn of d.zones) if (Math.hypot(x - zn.position[0], z - zn.position[2]) < clearance) return false;
    if (d.lake && Math.hypot(x - d.lake.x, z - d.lake.z) < d.lake.r + 4) return false;
    for (const p of d.paths) for (let i = 0; i < p.length - 1; i++) if (distToSegment(x, z, p[i], p[i + 1]) < pathClearance) return false;
    return true;
  }

  private async scatter(s: ScatterDef) {
    const rand = mulberry32(s.seed);
    // Bucket by model and (optionally) by chunk; each bucket becomes one InstancedMesh.
    const buckets = new Map<string, { model: string; placements: Placement[] }>();
    let placed = 0;
    for (let tries = 0; placed < s.count && tries < s.count * 20; tries++) {
      const a = rand() * Math.PI * 2;
      const r = s.minRadius + Math.sqrt(rand()) * (s.maxRadius - s.minRadius);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (Math.abs(x) > this.data.half - 4 || Math.abs(z) > this.data.half - 4) continue;
      if (!this.isClear(x, z, s.clearance, s.pathClearance)) continue;
      const model = s.models[Math.floor(rand() * s.models.length)];
      const scale = s.scale[0] + rand() * (s.scale[1] - s.scale[0]);
      const h = this.data.half;
      const key = s.chunk ? `${model}|${Math.floor((x + h) / s.chunk)},${Math.floor((z + h) / s.chunk)}` : model;
      if (!buckets.has(key)) buckets.set(key, { model, placements: [] });
      buckets.get(key)!.placements.push({ position: new THREE.Vector3(x, this.groundY(x, z) - 0.1, z), rotationY: rand() * Math.PI * 2, scale });
      placed++;
    }
    await Promise.all(
      [...buckets.values()].map(async ({ model, placements }) => {
        const g = await assets.model(model);
        this.scene.add(buildInstanced(g.scene, placements, s.snow ?? 0));
        if (s.collider) this.addColliders(g.scene, placements, s.collider);
      }),
    );
  }

  private async prop(p: PropDef) {
    const g = await assets.model(p.model);
    const positions: Vec3[] = p.at ? [...p.at] : [];
    if (p.line) {
      const from = new THREE.Vector3(...p.line.from);
      const to = new THREE.Vector3(...p.line.to);
      const n = Math.floor(from.distanceTo(to) / p.line.step);
      for (let i = 0; i <= n; i++) positions.push(from.clone().lerp(to, i / n).toArray() as Vec3);
    }
    const placements: Placement[] = positions.map(([x, y, z], i) => ({
      position: new THREE.Vector3(x, this.groundY(x, z) + y, z),
      rotationY: p.rotY ? (p.rotY[i] ?? p.rotY[0]) : p.randomRotY ? Math.random() * Math.PI * 2 : 0,
      scale: p.scale ?? 1,
    }));
    this.scene.add(buildInstanced(g.scene, placements, p.snow ?? 0));
    if (p.collider) this.addColliders(g.scene, placements, p.collider);
    if (p.light) {
      const box = modelBounds(g.scene);
      for (const pl of placements) {
        const top = pl.position.clone();
        top.y += box.max.y * pl.scale * (p.model.includes('lantern') ? 0.88 : 0.6);
        this.lightSpots.push({ pos: top, color: new THREE.Color(p.light) });
      }
    }
  }

  /** Physics never uses visual meshes: trunks are cylinders, everything else a rotated box. */
  private addColliders(source: THREE.Object3D, placements: Placement[], kind: ColliderKind) {
    const box = modelBounds(source);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const w = this.physics.world;
    for (const p of placements) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rotationY);
      const body = w.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(p.position.x, p.position.y, p.position.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
      );
      if (kind === 'trunk') {
        const r = Math.max(0.35, Math.min(size.x, size.z) * 0.12) * p.scale;
        w.createCollider(RAPIER.ColliderDesc.cylinder((size.y * p.scale) / 2, r).setTranslation(0, (size.y * p.scale) / 2, 0), body);
      } else {
        const s = p.scale;
        w.createCollider(
          RAPIER.ColliderDesc.cuboid((size.x * s) / 2, (size.y * s) / 2, (size.z * s) / 2).setTranslation(center.x * s, center.y * s, center.z * s),
          body,
        );
      }
    }
  }

  update(dt: number, focus: THREE.Vector3, time: number) {
    this.physics.update(dt);
    this.lighting.follow(focus);
    // Hand the few real point lights to the nearest lantern spots.
    const nearest = [...this.lightSpots]
      .map((s) => ({ s, d: s.pos.distanceToSquared(focus) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, this.lightPool.length);
    this.lightPool.forEach((l, i) => {
      const n = nearest[i];
      if (!n) {
        l.intensity = 0;
        return;
      }
      l.position.copy(n.s.pos);
      l.color.copy(n.s.color);
      l.intensity = 14 * (0.9 + 0.1 * Math.sin(time * 9 + i * 2.1));
    });
    this.glowSprites.forEach((s, i) => (s.material.opacity = 0.5 + 0.1 * Math.sin(time * 7 + i)));
  }
}
