import * as THREE from 'three';
import { assets } from '../../core/AssetLoader';
import { audio } from '../../core/Audio';
import { haptic, isTouchDevice } from '../../core/Input';
import { Physics, RAPIER } from '../../core/Physics';
import { buildInstanced, modelBounds, type Placement } from '../../world/Instancing';
import { Lighting } from '../../world/Lighting';
import { createSnowGroundMaterial, setWorldUvs } from '../../world/SnowGround';
import { Burst } from '../../vfx/Burst';
import { Snowfall } from '../../vfx/Snowfall';
import { starsFor, type MiniGame, type MiniGameContext, type MiniGameResult } from '../MiniGame';

type Kind = 'snowman' | 'golden' | 'present';
type State = 'rising' | 'up' | 'sinking' | 'hit' | 'gone';

interface Target {
  kind: Kind;
  obj: THREE.Object3D;
  state: State;
  t: number;
  life: number;
  height: number;
  radius: number;
}

interface Ball {
  body: RAPIER.RigidBody;
  mesh: THREE.Object3D;
  age: number;
}

const ROUND = 60;
const COUNTDOWN = 3;
const POINTS: Record<Kind, number> = { snowman: 1, golden: 3, present: -2 };
const PRESENTS = ['holiday/present_A_red', 'holiday/present_B_green', 'holiday/present_C_blue', 'holiday/present_sphere_A_yellow'];
const TREES = ['forest/Tree_1_A_Color1', 'forest/Tree_2_C_Color1', 'forest/Tree_3_A_Color1', 'forest/Tree_4_B_Color1'];

/** On touch screens the crosshair floats this far above the finger, so the finger never hides the target. */
const AIM_LIFT_PX = 90;
/** Touch aim assist: a target this close to the crosshair (CSS px) gets locked on. */
const ASSIST_PX = 40;
/** The cannon faces the lake (-z); it may turn this far either side, never towards the camera. */
const MAX_TURN = 1.35;
const ARC_DOTS = 18;

/** Game 1 — knock down pop-up snowmen on the frozen lake with a snowball cannon. */
export class SnowballShowdown implements MiniGame {
  readonly id = 'snowball-showdown' as const;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
  readonly finished: Promise<MiniGameResult>;
  private resolve!: (r: MiniGameResult) => void;

  private physics = new Physics(-20);
  private models: Record<string, THREE.Object3D> = {};
  private goldenModel!: THREE.Object3D;
  private ownedMaterials: THREE.Material[] = [];
  private ownedGeometries: THREE.BufferGeometry[] = [];
  private cannon!: THREE.Object3D;
  private reticle!: THREE.Sprite;
  private arc!: THREE.Points;
  /** Touch: a finger is down and aiming; lifting it throws. */
  private aiming = false;
  private locked: Target | null = null;
  private puffs!: Burst;
  private sparkles!: Burst;
  private snow!: Snowfall;
  private targets: Target[] = [];
  private balls: Ball[] = [];
  private raycaster = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private time = 0;
  private spawnTimer = 0;
  private cooldown = 0;
  private score = 0;
  private hits = 0;
  private golden = 0;
  private oops = 0;
  private throws = 0;
  private over = false;
  private framedAspect = 0;
  /** Targets spawn within ±halfWidth on x; narrower on portrait screens so they stay big enough to tap. */
  private halfWidth = 14;

  constructor(private readonly ctx: MiniGameContext) {
    this.finished = new Promise((r) => (this.resolve = r));
  }

  async load() {
    const ids = ['holiday/snowman_A', 'holiday/snowman_B', 'holiday/snowball', 'holiday/snowball_cannon', 'holiday/snowball_pile', ...PRESENTS];
    const [models, trees, snowflake, smoke, sparkle] = await Promise.all([
      Promise.all(ids.map((id) => assets.model(id))),
      Promise.all(TREES.map((id) => assets.model(id))),
      assets.texture('vfx/snowflake.png'),
      assets.texture('vfx/smoke.png'),
      assets.texture('vfx/sparkle.png'),
    ]);
    ids.forEach((id, i) => (this.models[id] = models[i].scene));

    // Golden snowman: snowman_B with its own shiny gold material.
    this.goldenModel = this.models['holiday/snowman_B'].clone(true);
    this.goldenModel.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.color.set('#ffcf3f');
      mat.emissive.set('#7a4b00');
      mat.metalness = 0.6;
      mat.roughness = 0.3;
      m.material = mat;
      this.ownedMaterials.push(mat);
    });

    const lighting = new Lighting(this.scene, this.ctx.engine.settings.shadows);
    lighting.follow(new THREE.Vector3(0, 0, -6));
    this.scene.fog = new THREE.FogExp2('#c6d6ec', 0.012);

    // Frozen lake + snowy bank.
    const bankGeo = new THREE.CircleGeometry(160, 48).rotateX(-Math.PI / 2);
    setWorldUvs(bankGeo);
    const bankMat = await createSnowGroundMaterial();
    const iceGeo = new THREE.CircleGeometry(34, 64).rotateX(-Math.PI / 2);
    const iceMat = new THREE.MeshStandardMaterial({ color: '#9fd3f0', roughness: 0.1, metalness: 0.15 });
    this.ownedGeometries.push(bankGeo, iceGeo);
    this.ownedMaterials.push(bankMat, iceMat);
    const bank = new THREE.Mesh(bankGeo, bankMat);
    bank.position.y = -0.02;
    bank.receiveShadow = true;
    const ice = new THREE.Mesh(iceGeo, iceMat);
    ice.position.set(0, 0, -12);
    ice.receiveShadow = true;
    this.scene.add(bank, ice);

    // A ring of snowy pines behind the lake.
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    TREES.forEach((_, ti) => {
      const placements: Placement[] = [];
      for (let i = 0; i < 26; i++) {
        const a = -Math.PI * 0.95 + rnd() * Math.PI * 1.9 + Math.PI;
        const r = 40 + rnd() * 30;
        placements.push({ position: new THREE.Vector3(Math.sin(a) * r, -0.2, -12 + Math.cos(a) * r), rotationY: rnd() * 6.28, scale: 1.3 + rnd() * 0.8 });
      }
      this.scene.add(buildInstanced(trees[ti].scene, placements, 1));
    });
    const piles = buildInstanced(this.models['holiday/snowball_pile'], [
      { position: new THREE.Vector3(-2.6, 0, 10.5), rotationY: 0.4, scale: 2.2 },
      { position: new THREE.Vector3(2.8, 0, 10.8), rotationY: 2, scale: 2 },
    ]);
    this.scene.add(piles);

    this.cannon = this.models['holiday/snowball_cannon'].clone(true);
    this.cannon.scale.setScalar(2.4);
    this.cannon.position.set(0, 0.6, 11);
    this.scene.add(this.cannon);
    this.cannon.rotation.y = Math.PI; // facing the lake
    this.buildAimGuides();

    this.puffs = new Burst(smoke, 500, false, -4);
    this.sparkles = new Burst(sparkle, 300, true, -2);
    this.snow = new Snowfall(snowflake, Math.round(this.ctx.engine.settings.snow * 0.5), 50, 25);
    this.scene.add(this.puffs.points, this.sparkles.points, this.snow.points);

    // Physics ground for bouncing snowballs.
    const ground = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(80, 0.5, 80).setTranslation(0, -0.5, 0).setFriction(0.9).setRestitution(0.2), ground);

    this.frame();
  }

  /** Landscape shows the whole lake; portrait pulls back, widens the lens and narrows the play area. */
  private frame() {
    const aspect = this.camera.aspect;
    this.framedAspect = aspect;
    const portrait = aspect < 1;
    this.halfWidth = portrait ? 8 : 14;
    this.camera.fov = portrait ? 62 : 55;
    this.camera.updateProjectionMatrix();
    if (portrait) this.camera.position.set(0, 10, 25);
    else this.camera.position.set(0, 7.5, 20);
    this.camera.lookAt(0, 0, portrait ? -11 : -9);
  }

  start() {
    this.time = -COUNTDOWN;
    this.ctx.engine.canvas.style.cursor = 'crosshair';
  }

  private get timeLeft() {
    return THREE.MathUtils.clamp(ROUND - this.time, 0, ROUND);
  }

  private spawnTarget() {
    const roll = Math.random();
    const kind: Kind = roll < 0.12 ? 'golden' : roll < 0.3 ? 'present' : 'snowman';
    const src = kind === 'golden' ? this.goldenModel : kind === 'present' ? this.models[PRESENTS[Math.floor(Math.random() * PRESENTS.length)]] : this.models[Math.random() < 0.5 ? 'holiday/snowman_A' : 'holiday/snowman_B'];
    const obj = src.clone(true);
    const scale = kind === 'present' ? 2.2 : 1;
    obj.scale.setScalar(scale);
    const box = modelBounds(src);
    const height = box.max.y * scale;
    const radius = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.42 * scale;

    // Pick a spot on the lake that doesn't overlap a live target.
    for (let tries = 0; tries < 12; tries++) {
      const x = (Math.random() * 2 - 1) * this.halfWidth;
      const z = -2 - Math.random() * 26;
      if (this.targets.some((t) => t.state !== 'gone' && Math.hypot(t.obj.position.x - x, t.obj.position.z - z) < 3.2)) continue;
      obj.position.set(x, 0, z);
      obj.rotation.y = Math.atan2(-x, 16 - z) + (Math.random() - 0.5) * 0.5;
      obj.scale.y = 0.001;
      this.scene.add(obj);
      const pace = 1 - Math.min(this.time / ROUND, 1) * 0.45;
      this.targets.push({ kind, obj, state: 'rising', t: 0, life: (2.4 + Math.random() * 1.4) * pace, height, radius });
      this.puffs.emit(obj.position.clone().setY(0.3), 10, { color: '#ffffff', speed: 3, up: 1, size: 1.4, life: 0.7 });
      return;
    }
  }

  /** Crosshair sprite (always on top, fixed screen size) and a dotted preview of the throw. */
  private buildAimGuides() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const ring = (width: number, color: string) => {
      g.lineWidth = width;
      g.strokeStyle = color;
      g.beginPath();
      g.arc(64, 64, 42, 0, Math.PI * 2);
      g.stroke();
      for (const [x0, y0, x1, y1] of [[64, 6, 64, 30], [64, 98, 64, 122], [6, 64, 30, 64], [98, 64, 122, 64]]) {
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
      }
    };
    ring(16, 'rgba(15, 25, 45, 0.55)');
    ring(7, '#ffffff');
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(64, 64, 7, 0, Math.PI * 2);
    g.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true });
    this.reticle = new THREE.Sprite(mat);
    this.reticle.scale.setScalar(0.085);
    this.reticle.renderOrder = 10;
    this.reticle.visible = false;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_DOTS * 3), 3));
    const dots = new THREE.PointsMaterial({
      color: '#ffffff',
      size: 7 * this.ctx.engine.renderer.getPixelRatio(),
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    this.arc = new THREE.Points(geo, dots);
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    this.scene.add(this.reticle, this.arc);
    this.ownedMaterials.push(mat, dots);
    this.ownedGeometries.push(geo);
  }

  private liveTargets() {
    return this.targets.filter((t) => t.state === 'rising' || t.state === 'up');
  }

  /**
   * Where a throw at screen point `ndc` would land, and the target there, if any.
   * With `assist`, a target near the crosshair on screen is locked on (touch screens).
   */
  private aimAt(ndc: THREE.Vector2, assist: boolean): { point: THREE.Vector3; target: Target | null; assisted: boolean } {
    const live = this.liveTargets();
    if (assist) {
      const canvas = this.ctx.engine.canvas;
      let best: Target | null = null;
      let bestD = ASSIST_PX;
      const c = new THREE.Vector3();
      for (const t of live) {
        c.copy(t.obj.position).setY(t.height * 0.55).project(this.camera);
        const d = Math.hypot(((c.x - ndc.x) * canvas.clientWidth) / 2, ((c.y - ndc.y) * canvas.clientHeight) / 2);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      if (best) return { point: best.obj.position.clone().setY(best.height * 0.55), target: best, assisted: true };
    }
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(live.map((t) => t.obj), true)[0];
    if (hit) {
      const target = live.find((t) => t.obj === hit.object || t.obj.getObjectById(hit.object.id)) ?? null;
      return { point: hit.point, target, assisted: false };
    }
    const p = this.raycaster.ray.intersectPlane(this.ground, new THREE.Vector3()) ?? new THREE.Vector3(0, 0, -20);
    return { point: p, target: null, assisted: false };
  }

  /** Launch point, velocity and flight time for a lob that lands on `aim` (shared by the throw and its preview). */
  private solveShot(aim: THREE.Vector3) {
    const origin = this.cannon.position.clone().add(new THREE.Vector3(0, 1.4, 0)).addScaledVector(aim.clone().sub(this.cannon.position).setY(0).normalize(), 1.6);
    const delta = aim.clone().sub(origin);
    const flight = THREE.MathUtils.clamp(delta.length() / 30, 0.3, 1.1);
    const g = this.physics.world.gravity.y;
    const v = new THREE.Vector3(delta.x / flight, (delta.y - 0.5 * g * flight * flight) / flight, delta.z / flight);
    return { origin, v, flight, g };
  }

  private showGuides(aim: THREE.Vector3, highlight: boolean) {
    this.reticle.visible = this.arc.visible = true;
    this.reticle.position.copy(aim);
    (this.reticle.material as THREE.SpriteMaterial).color.set(highlight ? '#ffd25a' : '#ffffff');
    const { origin, v, flight, g } = this.solveShot(aim);
    const pos = this.arc.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < ARC_DOTS; i++) {
      const t = (flight * (i + 1)) / (ARC_DOTS + 1);
      pos.setXYZ(i, origin.x + v.x * t, origin.y + v.y * t + 0.5 * g * t * t, origin.z + v.z * t);
    }
    pos.needsUpdate = true;
  }

  private fire(aim: THREE.Vector3) {
    const { origin, v } = this.solveShot(aim);
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(origin.x, origin.y, origin.z).setLinvel(v.x, v.y, v.z).setCcdEnabled(true).setLinearDamping(0.05),
    );
    this.physics.world.createCollider(RAPIER.ColliderDesc.ball(0.3).setRestitution(0.3).setDensity(2), body);
    const mesh = this.models['holiday/snowball'].clone(true);
    mesh.scale.setScalar(2);
    mesh.position.copy(origin);
    this.scene.add(mesh);
    this.balls.push({ body, mesh, age: 0 });
    this.throws++;
    audio.sfx('throw', 0.9 + Math.random() * 0.2);
    this.puffs.emit(origin, 8, { color: '#ffffff', speed: 2.5, up: 0.5, size: 1.2, life: 0.4 });
  }

  private hitTarget(t: Target, at: THREE.Vector3) {
    t.state = 'hit';
    t.t = 0;
    this.score = Math.max(0, this.score + POINTS[t.kind]);
    haptic(t.kind === 'present' ? [30, 40, 30] : t.kind === 'golden' ? 40 : 15);
    audio.sfx(t.kind === 'present' ? 'bad' : 'hit');
    if (t.kind === 'golden') audio.sfx('golden');
    if (t.kind === 'present') {
      this.oops++;
      this.sparkles.emit(at, 25, { color: ['#ff5a5a', '#ffffff'], speed: 5, up: 2, size: 0.8, life: 0.8 });
    } else {
      this.hits++;
      if (t.kind === 'golden') {
        this.golden++;
        this.sparkles.emit(at, 50, { color: ['#ffd25a', '#fff2b0'], speed: 7, up: 3, size: 1, life: 1.1 });
      }
      this.puffs.emit(at, 28, { color: '#ffffff', speed: 6, up: 2, size: 1.6, life: 0.9 });
    }
  }

  update(dt: number) {
    const pr = this.ctx.engine.renderer.getPixelRatio();
    if (this.camera.aspect !== this.framedAspect) this.frame();
    this.time += dt;
    this.cooldown -= dt;

    const input = this.ctx.input;
    const touch = isTouchDevice;
    // Touch: aim at a point lifted above the finger, so the finger doesn't hide the target.
    const lift = touch ? (2 * AIM_LIFT_PX) / Math.max(this.ctx.engine.canvas.clientHeight, 1) : 0;
    const { point: aim, target, assisted } = this.aimAt(new THREE.Vector2(input.pointer.x, Math.min(1, input.pointer.y + lift)), touch);

    const playing = this.time >= 0 && this.time < ROUND && !this.over;
    const free = playing && !this.ctx.hud.cardOpen;
    if (touch) this.aiming = free && (input.isDown('fire') || input.justPressed('fire'));
    const tracking = !touch || this.aiming || input.justReleased('fire');

    // Turn the cannon along the shortest way round, within its forward arc. (A plain lerp of
    // atan2 swung it right round towards the camera whenever the aim crossed the centre line.)
    if (tracking) {
      const raw = Math.atan2(aim.x - this.cannon.position.x, aim.z - this.cannon.position.z);
      const rel = THREE.MathUtils.clamp(Math.atan2(Math.sin(raw - Math.PI), Math.cos(raw - Math.PI)), -MAX_TURN, MAX_TURN);
      const cur = this.cannon.rotation.y;
      const d = Math.atan2(Math.sin(Math.PI + rel - cur), Math.cos(Math.PI + rel - cur));
      this.cannon.rotation.y = cur + d * (1 - Math.exp(-dt * 20));
    }

    if (free && (touch ? this.aiming : true)) this.showGuides(aim, !!target);
    else this.reticle.visible = this.arc.visible = false;
    if (touch && assisted && target !== this.locked) haptic(8);
    this.locked = assisted ? target : null;

    if (playing) {
      if (free && this.cooldown <= 0) {
        // Touch throws when the finger lifts (a quick tap counts too). With a mouse, click or hold.
        const go = touch ? input.justReleased('fire') : input.justPressed('fire') || input.isDown('fire');
        if (go) {
          this.fire(aim);
          this.cooldown = 0.28;
        }
      }
      this.spawnTimer -= dt;
      const live = this.targets.filter((t) => t.state === 'rising' || t.state === 'up').length;
      if (this.spawnTimer <= 0 && live < 7) {
        this.spawnTarget();
        this.spawnTimer = THREE.MathUtils.lerp(0.95, 0.42, Math.min(this.time / ROUND, 1));
      }
    }

    this.physics.update(dt);
    this.updateBalls(dt);
    this.updateTargets(dt);
    this.puffs.update(dt, pr);
    this.sparkles.update(dt, pr);
    this.snow.update(this.time + COUNTDOWN, this.camera.position, pr);

    const countdown = this.time < 0 ? `<span class="warn">Ready… ${Math.ceil(-this.time)}</span>` : '';
    const clock = Math.ceil(this.timeLeft);
    const stars = starsFor(this.score, this.ctx.thresholds);
    this.ctx.hud.setGameBar(
      `${countdown}<span>⏱ <b class="${clock <= 10 ? 'warn' : ''}">${clock}</b>s</span><span>⛄ ${this.score} pts</span><span>${stars ? '★'.repeat(stars) : '☆'}</span>`,
    );

    if (this.time >= ROUND && !this.over) this.finish();
  }

  private updateBalls(dt: number) {
    for (const b of this.balls) {
      b.age += dt;
      const p = b.body.translation();
      b.mesh.position.set(p.x, p.y, p.z);
      const r = b.body.rotation();
      b.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      if (b.age > 2.5) continue;
      for (const t of this.targets) {
        if (t.state !== 'rising' && t.state !== 'up') continue;
        const tp = t.obj.position;
        const h = t.height * (t.obj.scale.y / (t.kind === 'present' ? 2.2 : 1));
        if (Math.hypot(p.x - tp.x, p.z - tp.z) < t.radius + 0.3 && p.y > -0.2 && p.y < h + 0.3) {
          this.hitTarget(t, new THREE.Vector3(p.x, p.y, p.z));
          b.age = 99;
          break;
        }
      }
      if (b.age === 99) this.puffs.emit(b.mesh.position, 12, { color: '#ffffff', speed: 4, up: 1, size: 1, life: 0.5 });
    }
    // Remove used / old snowballs.
    this.balls = this.balls.filter((b) => {
      if (b.age < 3) return true;
      this.scene.remove(b.mesh);
      this.physics.world.removeRigidBody(b.body);
      return false;
    });
  }

  private updateTargets(dt: number) {
    const baseScale = (t: Target) => (t.kind === 'present' ? 2.2 : 1);
    for (const t of this.targets) {
      t.t += dt;
      const s = baseScale(t);
      switch (t.state) {
        case 'rising': {
          const k = Math.min(t.t / 0.35, 1);
          const overshoot = 1 + Math.sin(k * Math.PI) * 0.18;
          t.obj.scale.set(s, s * Math.max(0.001, k * overshoot), s);
          if (k >= 1) {
            t.state = 'up';
            t.t = 0;
          }
          break;
        }
        case 'up':
          t.obj.rotation.z = Math.sin(t.t * 6) * 0.04;
          if (t.t > t.life) {
            t.state = 'sinking';
            t.t = 0;
          }
          break;
        case 'sinking': {
          const k = Math.min(t.t / 0.3, 1);
          t.obj.scale.set(s, s * Math.max(0.001, 1 - k), s);
          if (k >= 1) t.state = 'gone';
          break;
        }
        case 'hit': {
          const k = Math.min(t.t / 0.5, 1);
          t.obj.rotation.x = -k * k * (Math.PI / 2);
          t.obj.position.y = -k * 0.4;
          if (t.t > 0.9) {
            const f = Math.min((t.t - 0.9) / 0.3, 1);
            t.obj.scale.setScalar(s * Math.max(0.001, 1 - f));
            if (f >= 1) t.state = 'gone';
          }
          break;
        }
      }
    }
    this.targets = this.targets.filter((t) => {
      if (t.state !== 'gone') return true;
      this.scene.remove(t.obj);
      return false;
    });
  }

  private finish(quit = false) {
    if (this.over) return;
    this.over = true;
    const accuracy = this.throws ? Math.round((this.hits / this.throws) * 100) : 0;
    const parts = [`${this.hits} snowmen toppled`];
    if (this.golden) parts.push(`${this.golden} golden`);
    if (this.oops) parts.push(`${this.oops} present${this.oops > 1 ? 's' : ''} squashed`);
    parts.push(`${accuracy}% accuracy`);
    this.resolve({ score: this.score, quit, summary: quit ? 'You left the lake early.' : parts.join(' · ') });
  }

  quit() {
    this.finish(true);
  }

  dispose() {
    this.ctx.engine.canvas.style.cursor = '';
    this.physics.dispose();
    this.puffs.dispose();
    this.sparkles.dispose();
    this.snow.points.geometry.dispose();
    (this.snow.points.material as THREE.Material).dispose();
    // Model geometries/materials are shared with the asset cache, so only free what we created.
    this.ownedMaterials.forEach((m) => m.dispose());
    this.ownedGeometries.forEach((g) => g.dispose());
    (this.reticle.material as THREE.SpriteMaterial).map?.dispose();
    this.scene.clear();
  }
}
