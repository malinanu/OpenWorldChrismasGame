import * as THREE from 'three';
import { assets } from '../core/AssetLoader';
import { initPhysics, Physics, RAPIER } from '../core/Physics';
import type { MiniGameId } from '../minigames/MiniGame';
import { buildInstanced, modelBounds, type Placement } from './Instancing';
import { Lighting } from './Lighting';
import { MINI_GAMES } from '../minigames/registry';
import { buildSignposts, Roads, type RoadDef } from './Roads';
import { createSnowGroundMaterial } from './SnowGround';
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
  /** Wind strength for foliage (0 = still). */
  sway?: number;
  collider?: ColliderKind;
  seed: number;
  /** Split instances into square chunks of this size so off-screen chunks are culled. */
  chunk?: number;
  /** false = never cast shadows; 'high' = only on the Pretty preset (forests are costly in the shadow pass). */
  shadow?: boolean | 'high';
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
  /** false = don't cast shadows. */
  shadow?: boolean;
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
  roads: RoadDef[];
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

/** Builds the overworld scene + static physics from `public/world/frostvale.json`. */
export class World {
  readonly scene = new THREE.Scene();
  physics!: Physics;
  terrain!: Terrain;
  lighting!: Lighting;
  data!: WorldData;
  /** Positions that want a warm light; the nearest few get a real PointLight. */
  readonly lightSpots: { pos: THREE.Vector3; color: THREE.Color }[] = [];
  private readonly lightPool: THREE.PointLight[] = [];
  private glow?: THREE.Points;
  private highShadows = false;
  roads!: Roads;

  /** `forest` scales scatter counts (quality setting); `shadowSize` 0 turns sun shadows off. */
  async load(opts: { forest: number; shadowSize: number }, onStep?: (label: string) => void) {
    this.highShadows = opts.shadowSize >= 2048;
    // The physics engine, the layout and every model download side by side.
    const physicsReady = initPhysics();
    const res = await fetch(`${import.meta.env.BASE_URL}world/frostvale.json`);
    this.data = (await res.json()) as WorldData;
    const d = this.data;
    for (const id of new Set([...d.scatter.flatMap((s) => s.models), ...d.props.map((p) => p.model), 'holiday/lantern'])) void assets.model(id).catch(() => {});
    await physicsReady;
    this.physics = new Physics();

    this.lighting = new Lighting(this.scene, opts.shadowSize);
    this.roads = new Roads(d.roads);
    // A level plot under every cottage, so none sits half in the air on a slope.
    for (const p of d.props) if (p.model.startsWith('proc/cottage_')) for (const [x, , z] of p.at ?? []) d.flats.push({ x, z, r: 5.5, local: true });
    this.terrain = new Terrain({ half: d.half, segments: 140, flats: d.flats, paths: this.roads.lines, lake: d.lake });
    this.terrain.mesh.material = await createSnowGroundMaterial({ vertexColors: true });
    this.scene.add(this.terrain.mesh);
    if (this.terrain.ice) this.scene.add(this.terrain.ice);
    this.terrain.addCollider(this.physics.world);

    // Cobblestone roads, lanterns along them and signposts at the plaza.
    this.scene.add(this.roads.build((x, z) => this.groundY(x, z)));
    d.props.push({ model: 'holiday/lantern', at: this.roads.lanterns.map((p) => [p.x, 0, p.z] as Vec3), scale: 1, light: '#ffb35a', collider: 'trunk', shadow: false });
    const signs = this.roads.signposts;
    this.scene.add(buildSignposts(signs, signs.map((s) => `${MINI_GAMES[s.to].emoji} ${MINI_GAMES[s.to].title}`), (x, z) => this.groundY(x, z)));

    onStep?.('Growing the forest…');
    await Promise.all(d.scatter.map((s) => this.scatter({ ...s, count: Math.round(s.count * opts.forest) })));
    onStep?.('Decorating the village…');
    await Promise.all(d.props.map((p) => this.prop(p)));

    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight('#ffb35a', 0, 14, 1.6);
      this.lightPool.push(l);
      this.scene.add(l);
    }
    this.glow = this.buildGlow(await assets.texture('vfx/glow.png'));
    this.scene.add(this.glow);
  }

  /** Every lantern halo in one Points draw call (dozens of sprites would be dozens of draw calls). */
  private buildGlow(map: THREE.Texture): THREE.Points {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.lightSpots.flatMap((s) => s.pos.toArray()), 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.lightSpots.flatMap((s) => s.color.toArray()), 3));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      uniforms: { uMap: { value: map }, uTime: { value: 0 }, uPR: { value: 1 } },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform float uPR; varying vec3 vColor; varying float vFlicker;
        void main() {
          vColor = color;
          vFlicker = 0.5 + 0.1 * sin(uTime * 7.0 + position.x * 1.3 + position.z);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          // Capped and faded up close, so a lantern right by the camera isn't a giant blob.
          gl_PointSize = min(1.3 * uPR * 300.0 / -mv.z, 110.0 * uPR);
          vFlicker *= smoothstep(2.5, 7.0, -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; varying vec3 vColor; varying float vFlicker;
        void main() { vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vColor * t.rgb, t.a * vFlicker); }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }

  groundY(x: number, z: number) {
    return this.terrain.heightAt(x, z);
  }

  private isClear(x: number, z: number, clearance: number, pathClearance: number) {
    const d = this.data;
    for (const f of d.flats) if (Math.hypot(x - f.x, z - f.z) < f.r + clearance * 0.5) return false;
    for (const zn of d.zones) if (Math.hypot(x - zn.position[0], z - zn.position[2]) < clearance) return false;
    if (d.lake && Math.hypot(x - d.lake.x, z - d.lake.z) < d.lake.r + 4) return false;
    if (this.terrain.pathDistance(x, z) < pathClearance) return false;
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
        const group = buildInstanced(g.scene, placements, s.snow ?? 0, s.sway ?? 0);
        const casts = s.shadow === undefined ? true : s.shadow === 'high' ? this.highShadows : s.shadow;
        if (!casts) group.traverse((o) => (o.castShadow = false));
        this.scene.add(group);
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
    // Spread-out props (village houses, road lanterns) are split into 120 m cells, so the
    // camera — and especially the sun's shadow pass — only draws the cells near the player.
    // Heavy models (the cottages) are split too, even in small numbers.
    let tris = 0;
    g.scene.traverse((o) => {
      const geo = (o as THREE.Mesh).isMesh ? (o as THREE.Mesh).geometry : null;
      if (geo) tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    });
    const split = placements.length > 6 || tris > 1500;
    const cells = new Map<string, Placement[]>();
    for (const pl of placements) {
      const key = split ? `${Math.floor(pl.position.x / 120)},${Math.floor(pl.position.z / 120)}` : 'all';
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key)!.push(pl);
    }
    for (const group of cells.values()) {
      const mesh = buildInstanced(g.scene, group, p.snow ?? 0);
      if (p.shadow === false) mesh.traverse((o) => (o.castShadow = false));
      this.scene.add(mesh);
    }
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
    if (this.glow) {
      const u = (this.glow.material as THREE.ShaderMaterial).uniforms;
      u.uTime.value = time;
      u.uPR.value = Math.min(window.devicePixelRatio, 2);
    }
  }
}
