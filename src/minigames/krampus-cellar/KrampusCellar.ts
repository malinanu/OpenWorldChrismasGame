import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { assets } from '../../core/AssetLoader';
import { haptic, isTouchDevice } from '../../core/Input';
import { Burst } from '../../vfx/Burst';
import { buildInstanced, type Placement } from '../../world/Instancing';
import type { MiniGame, MiniGameContext, MiniGameResult } from '../MiniGame';

/**
 * '#' wall · '.' floor · 'S' start · 'E' exit stairs · 'C' chest with a present · '^' spike trap.
 * Reachability of every chest and the exit is checked when the level loads.
 */
const MAP = [
  '#############',
  '#S..#...C...#',
  '#.#.#.#####.#',
  '#.#...#C..^.#',
  '#.###.#.###.#',
  '#C..^.....#.#',
  '###.###.#.#.#',
  '#C..#...#...#',
  '#.#.#.#####.#',
  '#.#...C#C..E#',
  '#############',
];
/** Each guard walks back and forth between two cells on a straight corridor. */
const GUARDS: [[number, number], [number, number]][] = [
  [[5, 5], [9, 5]],
  [[11, 1], [11, 7]],
  [[5, 1], [10, 1]],
];
const CELL = 4;
const TIME_LIMIT = 180;
const PLAYER_SPEED = 7;
const GUARD_SPEED = 3.4;
const VISION = 4;
const SPIKE_PERIOD = 2.4;

type Cell = [number, number];
const key = (c: Cell) => `${c[0]},${c[1]}`;
const DIRS: Cell[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

interface Walker {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  walk: THREE.AnimationAction;
  idle: THREE.AnimationAction;
  moving: boolean;
}

interface Guard extends Walker {
  a: Cell;
  b: Cell;
  towardsB: boolean;
  pause: number;
  facing: Cell;
  light: THREE.PointLight;
  vision: Set<string>;
}

/** Game 5 — sneak through Krampus' cellar: open chests, dodge lantern light and spikes, escape up the stairs. */
export class KrampusCellar implements MiniGame {
  readonly id = 'krampus-cellar' as const;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
  readonly finished: Promise<MiniGameResult>;
  private resolve!: (r: MiniGameResult) => void;

  private m: Record<string, THREE.Object3D> = {};
  private clips: THREE.AnimationClip[] = [];
  private owned: { dispose(): void }[] = [];
  private player!: Walker;
  private playerCell: Cell = [1, 1];
  private path: Cell[] = [];
  private guards: Guard[] = [];
  private chests = new Map<string, { obj: THREE.Object3D; open: boolean; cell: Cell }>();
  private spikes: { obj: THREE.Object3D; cell: Cell }[] = [];
  private visionMesh!: THREE.InstancedMesh;
  private flying: { obj: THREE.Object3D; t: number; from: THREE.Vector3 }[] = [];
  private sparkles!: Burst;
  private puffs!: Burst;
  private raycaster = new THREE.Raycaster();
  private floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private startCell: Cell = [1, 1];
  private exit: Cell = [11, 9];

  private time = -1.5;
  private presents = 0;
  private caught = 0;
  private safeTime = 0;
  private spikesUp = false;
  private overview = false;
  private over = false;
  private camTarget = new THREE.Vector3();
  private stepCooldown = 0;

  constructor(private readonly ctx: MiniGameContext) {
    this.finished = new Promise((r) => (this.resolve = r));
  }

  private walkable(c: Cell) {
    return MAP[c[1]]?.[c[0]] !== undefined && MAP[c[1]][c[0]] !== '#';
  }

  private world(c: Cell, y = 0) {
    return new THREE.Vector3(c[0] * CELL, y, c[1] * CELL);
  }

  private cellOf(p: THREE.Vector3): Cell {
    return [Math.round(p.x / CELL), Math.round(p.z / CELL)];
  }

  async load() {
    const ids = [
      'dungeon/floor_tile_large', 'dungeon/floor_dirt_large', 'dungeon/wall', 'dungeon/floor_tile_big_spikes', 'dungeon/chest', 'dungeon/chest_gold',
      'dungeon/stairs', 'dungeon/torch_mounted', 'dungeon/barrel_small', 'dungeon/box_small', 'dungeon/candle_lit', 'dungeon/banner_red',
      'holiday/present_A_red', 'holiday/present_B_green', 'holiday/present_C_yellow',
      'characters/Rogue_Hooded.glb', 'characters/Barbarian.glb',
      'animations/Rig_Medium_MovementBasic.glb', 'animations/Rig_Medium_General.glb',
    ];
    const [models, sparkle, smoke, glow] = await Promise.all([
      Promise.all(ids.map((id) => assets.model(id))),
      assets.texture('vfx/sparkle.png'),
      assets.texture('vfx/smoke.png'),
      assets.texture('vfx/glow.png'),
    ]);
    ids.forEach((id, i) => (this.m[id] = models[i].scene));
    this.clips = [...models[ids.indexOf('animations/Rig_Medium_MovementBasic.glb')].animations, ...models[ids.indexOf('animations/Rig_Medium_General.glb')].animations];

    // Dark cellar: dim fill light, warm torches, the player's lantern, red guard lanterns.
    this.scene.background = new THREE.Color('#0c0a12');
    this.scene.fog = new THREE.Fog('#0c0a12', 26, 60);
    this.scene.add(new THREE.HemisphereLight('#7a7aa8', '#201828', 1.1));
    const moon = new THREE.DirectionalLight('#c9b8ff', 0.6);
    moon.position.set(10, 30, 20);
    this.scene.add(moon);

    // Floors, low walls on every edge between floor and rock, and props.
    const floors: Placement[] = [];
    const dirt: Placement[] = [];
    const walls: Placement[] = [];
    MAP.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        const c: Cell = [x, y];
        if (ch === '#') return;
        if (ch === 'S') this.startCell = c;
        if (ch === 'E') this.exit = c;
        ((x + y) % 3 === 0 ? dirt : floors).push({ position: this.world(c), rotationY: 0, scale: 1 });
        DIRS.forEach(([dx, dy]) => {
          if (this.walkable([x + dx, y + dy])) return;
          const p = this.world(c).add(new THREE.Vector3(dx * CELL * 0.5, 0, dy * CELL * 0.5));
          walls.push({ position: p, rotationY: dx !== 0 ? Math.PI / 2 : 0, scale: 1, scaleY: 0.55 });
        });
        if (ch === 'C') {
          const chest = this.m['dungeon/chest'].clone(true);
          chest.position.copy(this.world(c));
          chest.scale.setScalar(1.3);
          this.scene.add(chest);
          this.chests.set(key(c), { obj: chest, open: false, cell: c });
        }
        if (ch === '^') {
          const s = this.m['dungeon/floor_tile_big_spikes'].clone(true);
          s.position.copy(this.world(c, -1.9));
          this.scene.add(s);
          this.spikes.push({ obj: s, cell: c });
        }
      }),
    );
    this.scene.add(buildInstanced(this.m['dungeon/floor_tile_large'], floors));
    this.scene.add(buildInstanced(this.m['dungeon/floor_dirt_large'], dirt));
    this.scene.add(buildInstanced(this.m['dungeon/wall'], walls));

    const stairs = this.m['dungeon/stairs'].clone(true);
    stairs.position.copy(this.world(this.exit)).add(new THREE.Vector3(0, 0, -1.6));
    stairs.scale.setScalar(0.7);
    stairs.rotation.y = Math.PI;
    this.scene.add(stairs);
    const exitGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: '#9cf5ff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 }));
    exitGlow.position.copy(this.world(this.exit, 2));
    exitGlow.scale.setScalar(5);
    this.scene.add(exitGlow);
    this.owned.push(exitGlow.material);

    // A few props and torches for atmosphere.
    const props: [string, Cell, number][] = [['dungeon/barrel_small', [3, 1], 0.4], ['dungeon/box_small', [1, 9], 0.6], ['dungeon/barrel_small', [9, 7], 0.2], ['dungeon/candle_lit', [7, 3], 0.6], ['dungeon/box_small', [3, 7], 0.3]];
    for (const [id, c, r] of props) {
      const o = this.m[id].clone(true);
      o.position.copy(this.world(c)).add(new THREE.Vector3(1.3, 0, -1.3));
      o.rotation.y = r * 6;
      this.scene.add(o);
    }
    const torchCells: Cell[] = [[2, 1], [7, 5], [1, 7], [10, 9], [11, 3]];
    for (const c of torchCells) {
      const t = this.m['dungeon/torch_mounted'].clone(true);
      t.position.copy(this.world(c)).add(new THREE.Vector3(0, 1.4, -CELL / 2 + 0.55));
      this.scene.add(t);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: '#ff9a3c', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 }));
      s.position.copy(t.position).add(new THREE.Vector3(0, 0.7, 0.3));
      s.scale.setScalar(2.4);
      this.scene.add(s);
      this.owned.push(s.material);
      const l = new THREE.PointLight('#ff9a3c', 14, 10, 1.6);
      l.position.copy(s.position);
      this.scene.add(l);
    }

    // Characters.
    this.player = this.makeWalker('characters/Rogue_Hooded.glb', 'Walking_A');
    this.player.root.position.copy(this.world(this.startCell));
    this.playerCell = [...this.startCell] as Cell;
    const lantern = new THREE.PointLight('#ffd9a0', 30, 14, 1.5);
    lantern.position.set(0, 3, 0);
    this.player.root.add(lantern);

    for (const [a, b] of GUARDS) {
      const w = this.makeWalker('characters/Barbarian.glb', 'Walking_B', '#8a1f2b');
      w.root.position.copy(this.world(a));
      const light = new THREE.PointLight('#ff3b3b', 18, 10, 1.5);
      light.position.set(0, 2.6, 0.8);
      w.root.add(light);
      this.guards.push({ ...w, a, b, towardsB: true, pause: 0, facing: [Math.sign(b[0] - a[0]), Math.sign(b[1] - a[1])] as Cell, light, vision: new Set() });
    }

    // Red tiles show exactly what each lantern can see.
    const visGeo = new THREE.PlaneGeometry(CELL * 0.94, CELL * 0.94).rotateX(-Math.PI / 2);
    const visMat = new THREE.MeshBasicMaterial({ color: '#ff3040', transparent: true, opacity: 0.32, depthWrite: false });
    this.visionMesh = new THREE.InstancedMesh(visGeo, visMat, 80);
    this.visionMesh.count = 0;
    this.visionMesh.renderOrder = 2;
    this.scene.add(this.visionMesh);
    this.owned.push(visGeo, visMat);

    this.sparkles = new Burst(sparkle, 300, true, -2);
    this.puffs = new Burst(smoke, 200, false, -1);
    this.scene.add(this.sparkles.points, this.puffs.points);
    this.owned.push(this.sparkles, this.puffs);

    this.camTarget.copy(this.player.root.position);
    this.placeCamera(1);
  }

  private makeWalker(id: string, walkClip: string, tint?: string): Walker {
    const root = cloneSkinned(this.m[id]);
    if (tint) {
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
        mat.color.multiply(new THREE.Color(tint)).multiplyScalar(1.6);
        mat.emissive = new THREE.Color('#2a0006');
        mesh.material = mat;
        this.owned.push(mat);
      });
    }
    this.scene.add(root);
    const mixer = new THREE.AnimationMixer(root);
    const clip = (name: string) => this.clips.find((c) => c.name === name)!;
    const walk = mixer.clipAction(clip(walkClip));
    const idle = mixer.clipAction(clip('Idle_A'));
    idle.play();
    return { root, mixer, walk, idle, moving: false };
  }

  private setMoving(w: Walker, moving: boolean) {
    if (w.moving === moving) return;
    w.moving = moving;
    const [from, to] = moving ? [w.idle, w.walk] : [w.walk, w.idle];
    to.reset().fadeIn(0.15).play();
    from.fadeOut(0.15);
  }

  private placeCamera(lerp: number) {
    const aspect = this.camera.aspect;
    const portrait = aspect < 1;
    this.camera.fov = portrait ? 62 : 50;
    this.camera.updateProjectionMatrix();
    let target: THREE.Vector3;
    let offset: THREE.Vector3;
    if (this.overview) {
      const w = (MAP[0].length - 1) * CELL;
      const h = (MAP.length - 1) * CELL;
      target = new THREE.Vector3(w / 2, 0, h / 2);
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      const dist = Math.max((h * 0.62) / tanHalf, (w * 0.6) / (aspect * tanHalf));
      offset = new THREE.Vector3(0, dist * 0.95, dist * 0.3);
    } else {
      target = this.player.root.position;
      offset = portrait ? new THREE.Vector3(0, 22, 9) : new THREE.Vector3(0, 17, 10);
    }
    // The cellar's fog would swallow the far-away overview camera, so push it back while zoomed out.
    const fog = this.scene.fog as THREE.Fog;
    fog.near = this.overview ? 300 : 26;
    fog.far = this.overview ? 600 : 60;
    this.camTarget.lerp(target, lerp);
    this.camera.position.lerp(this.camTarget.clone().add(offset), lerp);
    this.camera.lookAt(this.camTarget);
  }

  start() {
    this.ctx.hud.onGameAction = (a) => {
      if (a === 'overview') this.overview = !this.overview;
    };
    this.ctx.hud.toast(isTouchDevice ? 'Tap a tile to walk there · stay out of the red lantern light!' : 'Click a tile (or use WASD) · stay out of the red lantern light!', 4000);
  }

  // ---------------------------------------------------------------- movement

  private bfs(from: Cell, to: Cell): Cell[] {
    if (!this.walkable(to)) return [];
    const prev = new Map<string, Cell | null>([[key(from), null]]);
    const q: Cell[] = [from];
    while (q.length) {
      const c = q.shift()!;
      if (c[0] === to[0] && c[1] === to[1]) break;
      for (const [dx, dy] of DIRS) {
        const n: Cell = [c[0] + dx, c[1] + dy];
        if (!this.walkable(n) || prev.has(key(n))) continue;
        prev.set(key(n), c);
        q.push(n);
      }
    }
    if (!prev.has(key(to))) return [];
    const path: Cell[] = [];
    for (let c: Cell | null = to; c && key(c) !== key(from); c = prev.get(key(c)) ?? null) path.unshift(c);
    return path;
  }

  private handleInput(dt: number) {
    const input = this.ctx.input;
    if (input.justPressed('fire') && !this.ctx.hud.cardOpen) {
      this.raycaster.setFromCamera(new THREE.Vector2(input.pointer.x, input.pointer.y), this.camera);
      const hit = this.raycaster.ray.intersectPlane(this.floorPlane, new THREE.Vector3());
      if (hit) {
        const to = this.cellOf(hit);
        // Plan from the cell we're heading into, so the route never doubles back.
        const from = this.path[0] ?? this.playerCell;
        const route = this.bfs(from, to);
        if (route.length || key(to) === key(from)) this.path = this.path.length ? [this.path[0], ...route] : route;
        if (this.overview) this.overview = false;
      }
    }
    // Keyboard / gamepad: step one cell at a time in the pressed direction.
    this.stepCooldown -= dt;
    const mv = input.move();
    if (this.path.length === 0 && this.stepCooldown <= 0 && Math.hypot(mv.x, mv.y) > 0.5) {
      const d: Cell = Math.abs(mv.x) > Math.abs(mv.y) ? [Math.sign(mv.x), 0] : [0, -Math.sign(mv.y)];
      const n: Cell = [this.playerCell[0] + d[0], this.playerCell[1] + d[1]];
      if (this.walkable(n)) this.path = [n];
      this.stepCooldown = 0.05;
    }
  }

  private movePlayer(dt: number) {
    const p = this.player.root.position;
    const next = this.path[0];
    if (!next) {
      this.setMoving(this.player, false);
      return;
    }
    const target = this.world(next);
    const d = target.clone().sub(p);
    const step = PLAYER_SPEED * dt;
    this.player.root.rotation.y = Math.atan2(d.x, d.z);
    if (d.length() <= step) {
      p.copy(target);
      this.playerCell = next;
      this.path.shift();
      this.onEnterCell(next);
    } else p.addScaledVector(d.normalize(), step);
    this.setMoving(this.player, true);
  }

  private onEnterCell(c: Cell) {
    const chest = this.chests.get(key(c));
    if (chest && !chest.open) {
      chest.open = true;
      const gold = this.m['dungeon/chest_gold'].clone(true);
      gold.position.copy(chest.obj.position);
      gold.scale.copy(chest.obj.scale);
      this.scene.remove(chest.obj);
      this.scene.add(gold);
      chest.obj = gold;
      this.presents++;
      const ids = ['holiday/present_A_red', 'holiday/present_B_green', 'holiday/present_C_yellow'];
      const present = this.m[ids[this.presents % 3]].clone(true);
      present.scale.setScalar(1.6);
      this.scene.add(present);
      this.flying.push({ obj: present, t: 0, from: this.world(c, 1) });
      this.sparkles.emit(this.world(c, 1.5), 40, { color: ['#ffd25a', '#ffffff'], speed: 4, up: 3, size: 0.7, life: 1 });
      haptic(25);
      this.ctx.hud.toast(`🎁 Present rescued! (${this.presents}/${this.chests.size})`, 1500);
    }
    if (key(c) === key(this.exit)) this.finish();
  }

  private sendBack(reason: string) {
    this.caught++;
    this.time += 5;
    this.puffs.emit(this.player.root.position.clone().setY(1), 30, { color: '#ff6b6b', speed: 4, up: 2, size: 1.2, life: 0.8 });
    haptic([60, 40, 60]);
    this.ctx.hud.toast(`${reason} Back to the entrance (+5 s)`, 2000);
    this.player.root.position.copy(this.world(this.startCell));
    this.playerCell = [...this.startCell] as Cell;
    this.path = [];
    this.safeTime = 1.5;
  }

  // ---------------------------------------------------------------- guards

  private updateGuards(dt: number) {
    for (const g of this.guards) {
      const target = this.world(g.towardsB ? g.b : g.a);
      const d = target.clone().sub(g.root.position);
      if (g.pause > 0) {
        g.pause -= dt;
        this.setMoving(g, false);
        if (g.pause <= 0) g.towardsB = !g.towardsB;
      } else if (d.length() < 0.05) {
        g.pause = 1.4;
      } else {
        const step = GUARD_SPEED * dt;
        if (d.length() <= step) g.root.position.copy(target);
        else g.root.position.addScaledVector(d.normalize(), step);
        g.facing = [Math.sign(Math.round(d.x * 10)), Math.sign(Math.round(d.z * 10))] as Cell;
        this.setMoving(g, true);
      }
      // During the pause at each end, the guard turns to face back down the corridor.
      const look: Cell = g.pause > 0 && g.pause < 0.7 ? [-g.facing[0], -g.facing[1]] as Cell : g.facing;
      const yaw = Math.atan2(look[0], look[1]);
      let delta = yaw - g.root.rotation.y;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      g.root.rotation.y += delta * Math.min(1, dt * 10);
      g.vision = this.visionFrom(this.cellOf(g.root.position), look);
      g.mixer.update(dt);
    }
  }

  /** Cells a lantern lights: a straight beam that widens after the first cell, blocked by walls. */
  private visionFrom(c: Cell, dir: Cell): Set<string> {
    const out = new Set<string>([key(c)]);
    const side: Cell = [dir[1], -dir[0]];
    let blocked = false;
    for (let i = 1; i <= VISION && !blocked; i++) {
      const f: Cell = [c[0] + dir[0] * i, c[1] + dir[1] * i];
      if (!this.walkable(f)) {
        blocked = true;
        break;
      }
      out.add(key(f));
      if (i >= 2) {
        for (const s of [1, -1]) {
          const l: Cell = [f[0] + side[0] * s, f[1] + side[1] * s];
          const lPrev: Cell = [l[0] - dir[0], l[1] - dir[1]];
          if (this.walkable(l) && (this.walkable(lPrev) || i === 2)) out.add(key(l));
        }
      }
    }
    return out;
  }

  private drawVision() {
    const m = new THREE.Matrix4();
    let n = 0;
    const seen = new Set<string>();
    for (const g of this.guards)
      for (const k of g.vision) {
        if (seen.has(k) || n >= 80) continue;
        seen.add(k);
        const [x, y] = k.split(',').map(Number);
        m.makeTranslation(x * CELL, 0.08, y * CELL);
        this.visionMesh.setMatrixAt(n++, m);
      }
    this.visionMesh.count = n;
    this.visionMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- frame

  update(dt: number) {
    const pr = this.ctx.engine.renderer.getPixelRatio();
    this.time += dt;
    const playing = this.time >= 0 && !this.over;
    if (playing) {
      this.handleInput(dt);
      this.movePlayer(dt);
      this.updateGuards(dt);
      this.safeTime -= dt;
      // Spikes cycle up and down; the warning shake gives a moment to react.
      const phase = (this.time % SPIKE_PERIOD) / SPIKE_PERIOD;
      this.spikesUp = phase > 0.55;
      for (const s of this.spikes) {
        const y = this.spikesUp ? 0 : phase > 0.4 ? -1.9 + Math.sin(this.time * 60) * 0.05 + 0.25 : -1.9;
        s.obj.position.y = THREE.MathUtils.lerp(s.obj.position.y, y, 1 - Math.exp(-dt * 25));
      }
      if (this.safeTime <= 0) {
        const here = key(this.cellOf(this.player.root.position));
        if (this.guards.some((g) => g.vision.has(here))) this.sendBack('😈 Spotted by a lantern!');
        else if (this.spikesUp && this.spikes.some((s) => key(s.cell) === here)) this.sendBack('⚠️ Ouch, spikes!');
      }
      if (this.time >= TIME_LIMIT) this.finish();
    }
    this.player.mixer.update(dt);
    this.drawVision();

    for (const f of this.flying) {
      f.t += dt;
      const to = this.player.root.position.clone().setY(3);
      f.obj.position.lerpVectors(f.from, to, Math.min(1, f.t / 0.8));
      f.obj.position.y += Math.sin(Math.min(1, f.t / 0.8) * Math.PI) * 3;
      f.obj.rotation.y += dt * 6;
      if (f.t > 0.8) this.scene.remove(f.obj);
    }
    this.flying = this.flying.filter((f) => f.t <= 0.8);

    if (this.camera.aspect > 0) this.placeCamera(1 - Math.exp(-dt * 5));
    this.sparkles.update(dt, pr);
    this.puffs.update(dt, pr);

    const left = Math.max(0, Math.ceil(TIME_LIMIT - Math.max(0, this.time)));
    this.ctx.hud.setGameBar(
      `<span>⏱ <b class="${left <= 20 ? 'warn' : ''}">${left}</b>s</span><span>🎁 ${this.presents}/${this.chests.size}</span><span>😈 ${this.caught}</span>`,
    );
    this.ctx.hud.setAction({ id: 'overview', label: this.overview ? '🔍 Zoom in' : '🗺️ Overview', enabled: !this.over });
  }

  private finish(quit = false) {
    if (this.over) return;
    this.over = true;
    const escaped = !quit && key(this.playerCell) === key(this.exit);
    const left = Math.max(0, TIME_LIMIT - this.time);
    const bonus = escaped ? Math.min(3, Math.ceil(left / 40)) : 0;
    this.resolve({
      score: this.presents + bonus,
      quit,
      summary: quit
        ? 'You crept out of the cellar early.'
        : escaped
          ? `Escaped with ${this.presents}/${this.chests.size} presents · speed bonus +${bonus} · spotted ${this.caught}×`
          : `Time ran out with ${this.presents}/${this.chests.size} presents · spotted ${this.caught}×`,
    });
  }

  quit() {
    this.finish(true);
  }

  dispose() {
    this.owned.forEach((o) => o.dispose());
    this.scene.clear();
  }
}
