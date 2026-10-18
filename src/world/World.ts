import * as THREE from 'three';
import { assets } from '../core/AssetLoader';
import { initPhysics, Physics, RAPIER } from '../core/Physics';
import type { MiniGameId } from '../minigames/MiniGame';
import { cottageNight, cottagePorch } from './Cottages';
import { buildInstanced, modelBounds, type Placement } from './Instancing';
import { Lighting } from './Lighting';
import { MINI_GAMES } from '../minigames/registry';
import { buildSignposts, Roads, type RoadDef } from './Roads';
import { applyNightLight, createSnowGroundMaterial, type NightLightUniforms } from './SnowGround';
import { fontsReady } from '../i18n';
import { t } from '../i18n/ui';
import { Terrain, type FlatSpot } from './Terrain';

/** Half the cobbled road's width (Roads.ts WIDTH = 5). */
const ROAD_HALF_WIDTH = 2.5;

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
  /** Ground in front of each cottage door, lit by its porch lamp at night. */
  private readonly porchSpots: THREE.Vector3[] = [];
  /** Shared by the ground and road materials: the baked lamp-light map and how strongly it shows. */
  private readonly night: NightLightUniforms = { uNightMap: { value: null }, uNight: { value: 0 }, uHalf: { value: 1 } };
  private highShadows = false;
  roads!: Roads;
  /** How many of each scatter set (by seed) found a clear spot; for tests and tuning. */
  readonly scatterPlaced = new Map<number, number>();

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
    const roadMesh = this.roads.build((x, z) => Math.max(this.groundY(x, z), this.terrain.meshHeightAt(x, z)));
    this.scene.add(roadMesh);
    const lanterns = this.roads.lanterns.map((p) => [p.x, 0, p.z] as Vec3);
    lanterns.push(...this.zoneLanterns());
    d.props.push({ model: 'holiday/lantern', at: lanterns, scale: 1, light: '#ffb35a', collider: 'trunk', shadow: false });
    const signs = this.roads.signposts;
    // The names are baked into a texture, so the Sinhala/Tamil font must be there first.
    await fontsReady();
    this.scene.add(buildSignposts(signs, signs.map((s) => `${MINI_GAMES[s.to].emoji} ${MINI_GAMES[s.to].title}`), (x, z) => this.groundY(x, z)));

    onStep?.(t('growingForest'));
    await Promise.all(d.scatter.map((s) => this.scatter({ ...s, count: Math.round(s.count * opts.forest) })));
    onStep?.(t('decorating'));
    await Promise.all(d.props.map((p) => this.prop(p)));

    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight('#ffc070', 0, 16, 2);
      this.lightPool.push(l);
      this.scene.add(l);
    }
    this.glow = this.buildGlow(this.lightSpots);
    this.scene.add(this.glow);

    // Every lamp's pool of light, baked once into a texture the ground and roads read at night.
    this.night.uHalf.value = d.half;
    this.night.uNightMap.value = this.bakeNightLight(d.half);
    applyNightLight(this.terrain.mesh.material as THREE.Material, 4, this.night);
    applyNightLight(roadMesh.material as THREE.Material, 2.5, this.night);
    this.setTime(0.5);
  }

  /** Time of day, 0..1 (0 = midnight, 0.5 = noon): sky, light, lanterns and windows follow. */
  setTime(t: number) {
    this.lighting.setTime(t);
    const night = this.lighting.night;
    // Lamps come on through dusk: brighter lamp heads, pools of light on the ground, glowing windows.
    const on = THREE.MathUtils.smoothstep(night, 0.2, 0.8);
    if (this.glow) (this.glow.material as THREE.ShaderMaterial).uniforms.uStrength.value = THREE.MathUtils.lerp(0.35, 1.5, on);
    this.night.uNight.value = on;
    cottageNight.value = on;
  }

  /** A few lanterns around each game area, clear of roads and of the zone's own props. */
  private zoneLanterns(): Vec3[] {
    const d = this.data;
    const out: Vec3[] = [];
    const taken = d.props.flatMap((p) => p.at ?? []);
    for (const z of d.zones) {
      const flat = d.flats.filter((f) => !f.local).sort((a, b) => Math.hypot(a.x - z.position[0], a.z - z.position[2]) - Math.hypot(b.x - z.position[0], b.z - z.position[2]))[0];
      const r = flat ? Math.min(10, flat.r - 2) : 9;
      let placed = 0;
      for (let k = 0; k < 8 && placed < 4; k++) {
        const a = Math.PI / 4 + (k * Math.PI) / 4;
        const x = z.position[0] + Math.cos(a) * r;
        const zz = z.position[2] + Math.sin(a) * r;
        if (this.terrain.pathDistance(x, zz) < 3.5) continue;
        if (taken.some(([px, , pz]) => Math.hypot(px - x, pz - zz) < 3)) continue;
        if (out.some(([ox, , oz]) => Math.hypot(ox - x, oz - zz) < 6)) continue;
        out.push([+x.toFixed(1), 0, +zz.toFixed(1)]);
        placed++;
      }
    }
    return out;
  }

  /** Soft warm pools under every lamp and porch, painted into one world-sized texture. */
  private bakeNightLight(half: number): THREE.CanvasTexture {
    const size = 1024;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, size, size);
    g.globalCompositeOperation = 'lighter';
    const px = (m: number) => (m / (2 * half)) * size;
    const pool = (x: number, z: number, radius: number, rgb: string, strength: number) => {
      const cx = (x / (2 * half) + 0.5) * size;
      const cy = (1 - (z / (2 * half) + 0.5)) * size; // canvas rows run opposite to the texture's v
      const r = px(radius);
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, `rgba(${rgb}, ${strength})`);
      grad.addColorStop(0.3, `rgba(${rgb}, ${strength * 0.55})`);
      grad.addColorStop(0.65, `rgba(${rgb}, ${strength * 0.18})`);
      grad.addColorStop(1, `rgba(${rgb}, 0)`);
      g.fillStyle = grad;
      g.fillRect(cx - r, cy - r, r * 2, r * 2);
    };
    for (const s of this.lightSpots) {
      const torch = s.color.r > 0.99 && s.color.g < 0.55;
      pool(s.pos.x, s.pos.z, torch ? 5 : 7.5, torch ? '255, 140, 60' : '255, 196, 120', 0.85);
    }
    for (const p of this.porchSpots) pool(p.x, p.z, 3.6, '255, 205, 130', 0.6);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /**
   * Every lamp head in one Points draw call: a small hot core with a faint falloff, drawn in the
   * shader (the light on the ground comes from the baked night map, not from a big sprite).
   */
  private buildGlow(spots: { pos: THREE.Vector3; color: THREE.Color }[]): THREE.Points {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(spots.flatMap((s) => s.pos.toArray()), 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(spots.flatMap((s) => s.color.toArray()), 3));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      uniforms: { uTime: { value: 0 }, uPR: { value: 1 }, uStrength: { value: 1 } },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform float uPR; varying vec3 vColor; varying float vFlicker;
        void main() {
          vColor = color;
          vFlicker = 0.5 + 0.1 * sin(uTime * 7.0 + position.x * 1.3 + position.z);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          // Capped and faded up close, so a lantern right by the camera isn't a giant blob.
          gl_PointSize = min(0.75 * uPR * 300.0 / -mv.z, 48.0 * uPR);
          vFlicker *= smoothstep(2.5, 7.0, -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uStrength; varying vec3 vColor; varying float vFlicker;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float r2 = dot(p, p);
          if (r2 > 1.0) discard;
          float core = exp(-r2 * 30.0);
          float halo = exp(-r2 * 6.0) * 0.3 * (1.0 - r2);
          vec3 col = mix(vColor, vec3(1.0, 0.95, 0.85), core);
          gl_FragColor = vec4(col, (core + halo) * vFlicker * 1.6 * uStrength);
        }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }

  /** Fresh snow to make a snowball from: not on the cobbled roads or the frozen lake. */
  onSnow(x: number, z: number) {
    const lake = this.data.lake;
    if (lake && Math.hypot(x - lake.x, z - lake.z) < lake.r) return false;
    return this.terrain.pathDistance(x, z) > ROAD_HALF_WIDTH + 0.1;
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
    this.scatterPlaced.set(s.seed, placed);
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
    if (p.model.startsWith('proc/cottage_')) {
      const porch = cottagePorch(Number(p.model.slice('proc/cottage_'.length)));
      for (const pl of placements) this.porchSpots.push(porch.clone().multiplyScalar(pl.scale).applyAxisAngle(new THREE.Vector3(0, 1, 0), pl.rotationY).add(pl.position));
    }
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
      // Barely noticeable in daylight; at night the lanterns pool warm light on the cobbles.
      const night = this.lighting.night;
      l.intensity = THREE.MathUtils.lerp(8, 45, night) * (0.94 + 0.06 * Math.sin(time * 9 + i * 2.1));
      l.distance = THREE.MathUtils.lerp(16, 22, night);
    });
    if (this.glow) {
      const u = (this.glow.material as THREE.ShaderMaterial).uniforms;
      u.uTime.value = time;
      u.uPR.value = Math.min(window.devicePixelRatio, 2);
    }
  }
}
