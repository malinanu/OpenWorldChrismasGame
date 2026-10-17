import * as THREE from 'three';
import { assets } from '../../core/AssetLoader';
import { audio } from '../../core/Audio';
import { haptic, isTouchDevice } from '../../core/Input';
import { Burst } from '../../vfx/Burst';
import { Snowfall } from '../../vfx/Snowfall';
import { Lighting } from '../../world/Lighting';
import { createSnowGroundMaterial, setWorldUvs } from '../../world/SnowGround';
import type { MiniGame, MiniGameContext, MiniGameResult } from '../MiniGame';

type Kind = 'cookie' | 'cane' | 'ginger' | 'present' | 'coal' | 'golden';

interface KindDef {
  model: string;
  points: number;
  weight: number;
  scale: number;
  label: string;
}

const KINDS: Record<Kind, KindDef> = {
  cookie: { model: 'holiday/cookie', points: 1, weight: 40, scale: 2.4, label: '+1' },
  cane: { model: 'holiday/candycane_small', points: 1, weight: 22, scale: 2.4, label: '+1' },
  ginger: { model: 'holiday/gingerbread_man', points: 2, weight: 14, scale: 2.6, label: '+2' },
  present: { model: 'holiday/present_A_red', points: 3, weight: 7, scale: 1.4, label: '+3' },
  coal: { model: 'resources/Stone_Chunks_Small', points: -2, weight: 15, scale: 1.3, label: '−2' },
  golden: { model: 'holiday/cookie', points: 2, weight: 2, scale: 2.8, label: '✨ Magnet!' },
};
const ROUND = 60;
const COUNTDOWN = 3;
const SPAWN_Y = 13;
const BASKET_Y = 0.6;
const BASKET_HALF = 1.25;
const MAGNET_TIME = 3;

interface Falling {
  kind: Kind;
  obj: THREE.Object3D;
  vy: number;
  spin: THREE.Vector3;
  sway: number;
}

/** Cookie Catch — drag the bowl to catch falling treats, dodge the coal. (Replaces Gingerbread Bakery Rush; same zone/save id.) */
export class CookieCatch implements MiniGame {
  readonly id = 'gingerbread-bakery' as const;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  readonly finished: Promise<MiniGameResult>;
  private resolve!: (r: MiniGameResult) => void;

  private m: Record<string, THREE.Object3D> = {};
  private basket!: THREE.Object3D;
  private items: Falling[] = [];
  private owned: { dispose(): void }[] = [];
  private sparkles!: Burst;
  private puffs!: Burst;
  private snow!: Snowfall;
  private raycaster = new THREE.Raycaster();
  private playPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private popups: { el: HTMLElement; t: number }[] = [];
  private popLayer = document.createElement('div');

  private time = -COUNTDOWN;
  private spawnTimer = 0;
  private score = 0;
  private caught = 0;
  private coal = 0;
  private best = 0;
  private streak = 0;
  private magnet = 0;
  private halfWidth = 7;
  private targetX = 0;
  private framedAspect = 0;
  private over = false;

  constructor(private readonly ctx: MiniGameContext) {
    this.finished = new Promise((r) => (this.resolve = r));
  }

  async load() {
    const ids = [...new Set(Object.values(KINDS).map((k) => k.model)), 'restaurant/bowl', 'holiday/gingerbread_house_decorated', 'holiday/christmas_tree_decorated', 'holiday/lantern_decorated', 'holiday/snowman_A', 'forest/Tree_2_A_Color1'];
    const [models, sparkle, smoke, snowflake] = await Promise.all([
      Promise.all(ids.map((id) => assets.model(id))),
      assets.texture('vfx/sparkle.png'),
      assets.texture('vfx/smoke.png'),
      assets.texture('vfx/snowflake.png'),
    ]);
    ids.forEach((id, i) => (this.m[id] = models[i].scene));

    new Lighting(this.scene, this.ctx.engine.settings.shadows).follow(new THREE.Vector3(0, 0, 0));
    this.scene.fog = new THREE.FogExp2('#c6d6ec', 0.012);
    const groundGeo = new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2);
    setWorldUvs(groundGeo);
    const ground = new THREE.Mesh(groundGeo, await createSnowGroundMaterial());
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.owned.push(groundGeo, ground.material as THREE.Material);

    // Backdrop: the bakery, a tree and a few friends watching.
    const put = (id: string, x: number, z: number, s: number, r = 0) => {
      const o = this.m[id].clone(true);
      o.position.set(x, 0, z);
      o.scale.setScalar(s);
      o.rotation.y = r;
      this.scene.add(o);
    };
    put('holiday/gingerbread_house_decorated', 0, -9, 6);
    put('holiday/christmas_tree_decorated', -9, -6, 1.3);
    put('holiday/lantern_decorated', 7, -4, 1);
    put('holiday/lantern_decorated', -6, -3, 1);
    put('holiday/snowman_A', 9.5, -7, 1.2, -0.5);
    for (const [x, z] of [[-14, -14], [14, -12], [-18, -4], [18, -6], [4, -20], [-6, -22]]) put('forest/Tree_2_A_Color1', x, z, 1.6, x);

    // Golden cookie and coal get their own materials.
    this.m.golden = this.tinted('holiday/cookie', '#ffcf3f', '#7a4b00');
    this.m.coal = this.tinted('resources/Stone_Chunks_Small', '#2b2b30', '#000000');

    this.basket = this.tinted('restaurant/bowl', '#d08a4c', '#2a1405'); // wicker-coloured bowl
    this.basket.scale.set(2.7, 1.9, 2.7);
    this.basket.position.set(0, BASKET_Y - 0.55, 0);
    this.scene.add(this.basket);

    this.sparkles = new Burst(sparkle, 300, true, -3);
    this.puffs = new Burst(smoke, 200, false, -2);
    this.snow = new Snowfall(snowflake, Math.round(this.ctx.engine.settings.snow * 0.3), 30, 20);
    this.scene.add(this.sparkles.points, this.puffs.points, this.snow.points);
    this.owned.push(this.sparkles, this.puffs, this.snow.points.geometry, this.snow.points.material as THREE.Material);
    this.frame();
  }

  private tinted(id: string, color: string, emissive: string): THREE.Object3D {
    const o = this.m[id].clone(true);
    o.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
      mat.color.set(color);
      mat.emissive.set(emissive);
      mesh.material = mat;
      this.owned.push(mat);
    });
    return o;
  }

  /** Fit the playfield to the screen: narrower and taller on a portrait phone. */
  private frame() {
    const aspect = this.camera.aspect;
    this.framedAspect = aspect;
    const portrait = aspect < 1;
    this.camera.fov = 50;
    this.camera.updateProjectionMatrix();
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(25));
    // Keep the whole drop height (~13 m) and at least ±4.5 m of width in view.
    const distForHeight = 8.5 / tanHalf;
    const distForWidth = 5.2 / (aspect * tanHalf);
    const dist = Math.max(distForHeight, distForWidth);
    this.halfWidth = Math.min(portrait ? 4.2 : 9, dist * tanHalf * aspect - 0.8);
    this.camera.position.set(0, 6.5, dist);
    this.camera.lookAt(0, 6, 0);
  }

  start() {
    this.popLayer.className = 'world-labels';
    this.ctx.hud.root.prepend(this.popLayer);
    this.ctx.hud.toast(isTouchDevice ? '👆 Drag anywhere to move the bowl' : '🖱️ Hold the mouse button and move, or use ← →', 3500);
  }

  // ---------------------------------------------------------------- gameplay

  private pickKind(): Kind {
    const kinds = Object.keys(KINDS) as Kind[];
    // More coal later on, so the last 20 seconds feel tense.
    const weight = (k: Kind) => KINDS[k].weight * (k === 'coal' ? 1 + Math.min(this.time / ROUND, 1) : 1);
    let r = Math.random() * kinds.reduce((n, k) => n + weight(k), 0);
    for (const k of kinds) if ((r -= weight(k)) <= 0) return k;
    return 'cookie';
  }

  private spawn() {
    const kind = this.pickKind();
    const def = KINDS[kind];
    const src = kind === 'golden' || kind === 'coal' ? this.m[kind] : this.m[def.model];
    const obj = src.clone(true);
    obj.scale.setScalar(def.scale);
    obj.position.set((Math.random() * 2 - 1) * (this.halfWidth - 0.6), SPAWN_Y, (Math.random() - 0.5) * 0.6);
    obj.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    this.scene.add(obj);
    const pace = Math.min(Math.max(this.time, 0) / ROUND, 1);
    this.items.push({
      kind,
      obj,
      vy: -THREE.MathUtils.lerp(3.4, 6.6, pace) * (0.85 + Math.random() * 0.3),
      spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(4),
      sway: Math.random() * 6,
    });
  }

  private popup(text: string, at: THREE.Vector3, good: boolean) {
    const el = document.createElement('div');
    el.className = `catch-pop ${good ? 'good' : 'bad'}`;
    el.textContent = text;
    this.popLayer.append(el);
    const v = at.clone().project(this.camera);
    el.style.left = `${((v.x + 1) / 2) * window.innerWidth}px`;
    el.style.top = `${((1 - v.y) / 2) * window.innerHeight}px`;
    this.popups.push({ el, t: 0 });
  }

  private catchItem(f: Falling) {
    const def = KINDS[f.kind];
    const at = f.obj.position.clone();
    this.scene.remove(f.obj);
    if (f.kind === 'coal') {
      this.score = Math.max(0, this.score + def.points);
      this.coal++;
      this.streak = 0;
      this.puffs.emit(at, 24, { color: '#333333', speed: 3, up: 1.5, size: 1.2, life: 0.8 });
      haptic([40, 40, 40]);
      audio.sfx('bad');
      this.popup(def.label, at, false);
      return;
    }
    this.score += def.points;
    this.caught++;
    this.streak++;
    this.best = Math.max(this.best, this.streak);
    if (f.kind === 'golden') this.magnet = MAGNET_TIME;
    this.sparkles.emit(at, f.kind === 'golden' ? 50 : 16, { color: f.kind === 'golden' ? ['#ffd25a', '#fff2b0'] : ['#ffffff', '#ffd25a'], speed: 3, up: 2, size: 0.6, life: 0.7 });
    haptic(f.kind === 'golden' ? 40 : 10);
    audio.sfx(f.kind === 'golden' ? 'magic' : 'catch', Math.pow(2, (Math.min(this.streak, 12) % 13) / 12));
    this.popup(def.label, at, true);
  }

  update(dt: number) {
    if (this.camera.aspect !== this.framedAspect) this.frame();
    const pr = this.ctx.engine.renderer.getPixelRatio();
    this.time += dt;
    const input = this.ctx.input;
    const playing = this.time >= 0 && !this.over;

    // The bowl follows the finger/mouse while pressed; arrow keys / A-D also work.
    if (input.isDown('fire') || input.justPressed('fire')) {
      this.raycaster.setFromCamera(new THREE.Vector2(input.pointer.x, input.pointer.y), this.camera);
      const hit = this.raycaster.ray.intersectPlane(this.playPlane, new THREE.Vector3());
      if (hit) this.targetX = hit.x;
    }
    const mv = input.move().x;
    if (Math.abs(mv) > 0.1) this.targetX = this.basket.position.x + mv * 14 * dt;
    this.targetX = THREE.MathUtils.clamp(this.targetX, -this.halfWidth, this.halfWidth);
    const bx = THREE.MathUtils.lerp(this.basket.position.x, this.targetX, 1 - Math.exp(-dt * 18));
    this.basket.rotation.z = THREE.MathUtils.clamp((bx - this.basket.position.x) * -0.6, -0.25, 0.25);
    this.basket.position.x = bx;

    if (playing) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawn();
        this.spawnTimer = THREE.MathUtils.lerp(0.8, 0.42, Math.min(this.time / ROUND, 1));
      }
      this.magnet = Math.max(0, this.magnet - dt);
    }

    for (const f of this.items) {
      f.obj.position.y += f.vy * dt;
      f.obj.position.x += Math.sin(this.time * 2 + f.sway) * 0.4 * dt;
      f.obj.rotation.x += f.spin.x * dt;
      f.obj.rotation.y += f.spin.y * dt;
      // Magnet: good items drift towards the bowl.
      if (this.magnet > 0 && f.kind !== 'coal') f.obj.position.x = THREE.MathUtils.lerp(f.obj.position.x, bx, 1 - Math.exp(-dt * 4));
      const y = f.obj.position.y;
      if (y < BASKET_Y + 1 && y > BASKET_Y - 0.4 && Math.abs(f.obj.position.x - bx) < BASKET_HALF) {
        this.catchItem(f);
        f.vy = 0;
        f.obj.position.y = -99;
      } else if (y < 0.1 && y > -50) {
        if (f.kind !== 'coal') this.streak = 0;
        this.puffs.emit(f.obj.position.clone().setY(0.2), 8, { color: '#ffffff', speed: 2, up: 1, size: 0.8, life: 0.5 });
        this.scene.remove(f.obj);
        f.obj.position.y = -99;
      }
    }
    this.items = this.items.filter((f) => f.obj.position.y > -50);

    for (const p of this.popups) {
      p.t += dt;
      p.el.style.transform = `translate(-50%, ${-50 - p.t * 60}px)`;
      p.el.style.opacity = String(Math.max(0, 1 - p.t / 0.8));
      if (p.t > 0.8) p.el.remove();
    }
    this.popups = this.popups.filter((p) => p.t <= 0.8);

    this.sparkles.update(dt, pr);
    this.puffs.update(dt, pr);
    this.snow.update(this.time + COUNTDOWN, this.camera.position, pr);

    const left = Math.ceil(THREE.MathUtils.clamp(ROUND - this.time, 0, ROUND));
    const countdown = this.time < 0 ? `<span class="warn">Ready… ${Math.ceil(-this.time)}</span>` : '';
    this.ctx.hud.setGameBar(
      `${countdown}<span>⏱ <b class="${left <= 10 ? 'warn' : ''}">${left}</b>s</span><span>🍪 ${this.score}</span>` +
        `${this.streak >= 5 ? `<span>🔥 ×${this.streak}</span>` : ''}${this.magnet > 0 ? '<span>✨ Magnet</span>' : ''}`,
    );
    if (this.time >= ROUND && !this.over) this.finish();
  }

  private finish(quit = false) {
    if (this.over) return;
    this.over = true;
    this.resolve({
      score: this.score,
      quit,
      summary: quit ? 'You left the bakery yard early.' : `${this.caught} treats caught · best streak ${this.best} · ${this.coal} lump${this.coal === 1 ? '' : 's'} of coal`,
    });
  }

  quit() {
    this.finish(true);
  }

  dispose() {
    this.popLayer.remove();
    this.owned.forEach((o) => o.dispose());
    this.scene.clear();
  }
}
