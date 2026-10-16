import * as THREE from 'three';
import { assets } from '../../core/AssetLoader';
import { haptic, isTouchDevice } from '../../core/Input';
import { Burst } from '../../vfx/Burst';
import { Snowfall } from '../../vfx/Snowfall';
import { buildInstanced, type Placement } from '../../world/Instancing';
import { Lighting } from '../../world/Lighting';
import type { MiniGame, MiniGameContext, MiniGameResult } from '../MiniGame';
import { LEVELS } from './levels';
import { DX, DY, parseLevel, rotStates, solve, traceRoute, type Colour, type Dir, type Level, type Outcome, type Tile } from './logic';

/** Model units per grid cell: the KayKit curve is a radius-2 quarter arc, so cells are 4 wide. */
const CELL = 4;
const TRAIN_SPEED = 7;
const TRAIN_SCALE = 1.6;
const EMOJI: Record<Colour, string> = { red: '🔴', blue: '🔵', green: '🟢', yellow: '🟡', white: '⚪' };
const COLOUR_HEX: Record<Colour, string> = { red: '#e8424f', blue: '#3f7fe0', green: '#2f9e6b', yellow: '#ffd25a', white: '#ffffff' };

type Phase = 'intro' | 'plan' | 'drive' | 'result' | 'done';

interface TileView {
  tile: Tile;
  group: THREE.Group;
  base: THREE.Mesh;
  /** Visual rotation (radians) animates towards the logical one. */
  angle: number;
}

/** Game 3 — rotate track pieces so the toy train delivers each present to the right house. */
export class SantasExpress implements MiniGame {
  readonly id = 'santas-express' as const;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  readonly finished: Promise<MiniGameResult>;
  private resolve!: (r: MiniGameResult) => void;

  private m: Record<string, THREE.Object3D> = {};
  private board = new THREE.Group();
  private views: TileView[] = [];
  private houseMarkers = new Map<Tile, THREE.Object3D>();
  private delivered = new Set<Tile>();
  private train = new THREE.Group();
  private cars: THREE.Object3D[] = [];
  private cargo!: THREE.Object3D;
  private puffs!: Burst;
  private sparkles!: Burst;
  private snow!: Snowfall;
  private owned: { dispose(): void }[] = [];
  private raycaster = new THREE.Raycaster();
  private hovered: TileView | null = null;

  private levelIndex = 0;
  private level!: Level;
  private par = 0;
  private presentIndex = 0;
  private moves = 0;
  private mistakes = 0;
  private levelScores: number[] = [];
  private totalMistakes = 0;
  private phase: Phase = 'intro';
  private phaseTime = 0;
  private path: THREE.Vector3[] = [];
  private pathLen: number[] = [];
  private distance = 0;
  private outcome: Outcome | null = null;
  private message = '';
  private time = 0;
  private framedAspect = 0;

  constructor(private readonly ctx: MiniGameContext) {
    this.finished = new Promise((r) => (this.resolve = r));
  }

  async load() {
    const ids = [
      'holiday/tracks_straight', 'holiday/tracks_curve', 'holiday/tracks_crossing', 'holiday/tracks_straight_station',
      'holiday/train_locomotive', 'holiday/train_tender_empty', 'holiday/train_wagon', 'holiday/gingerbread_house_decorated',
      'holiday/lantern', 'holiday/snowman_A', 'holiday/christmas_tree',
      ...(['red', 'blue', 'green', 'yellow', 'white'] as Colour[]).map((c) => `holiday/present_A_${c}`),
    ];
    const trees = ['forest/Tree_1_A_Color1', 'forest/Tree_2_C_Color1', 'forest/Tree_3_A_Color1'];
    const [models, treeModels, snowflake, smoke, sparkle] = await Promise.all([
      Promise.all(ids.map((id) => assets.model(id))),
      Promise.all(trees.map((id) => assets.model(id))),
      assets.texture('vfx/snowflake.png'),
      assets.texture('vfx/smoke.png'),
      assets.texture('vfx/sparkle.png'),
    ]);
    ids.forEach((id, i) => (this.m[id.split('/')[1]] = models[i].scene));

    new Lighting(this.scene, this.ctx.engine.settings.shadows).follow(new THREE.Vector3(12, 0, 8));
    this.scene.fog = new THREE.FogExp2('#c6d6ec', 0.01);
    const groundGeo = new THREE.PlaneGeometry(300, 300).rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({ color: '#eef4fc', roughness: 0.95 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.receiveShadow = true;
    this.scene.add(ground, this.board, this.train);
    this.owned.push(groundGeo, groundMat);

    // Woods around the yard.
    let seed = 9;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    treeModels.forEach((t) => {
      const placements: Placement[] = [];
      for (let i = 0; i < 30; i++) {
        const a = rnd() * Math.PI * 2;
        const r = 30 + rnd() * 40;
        placements.push({ position: new THREE.Vector3(14 + Math.cos(a) * r, 0, 8 + Math.sin(a) * r * 0.8), rotationY: rnd() * 6, scale: 1.3 + rnd() * 0.7 });
      }
      this.scene.add(buildInstanced(t.scene, placements, 1));
    });

    // Train: locomotive, a tender carrying the current present, and a wagon.
    for (const id of ['train_locomotive', 'train_tender_empty', 'train_wagon']) {
      const car = this.m[id].clone(true);
      car.scale.setScalar(TRAIN_SCALE);
      this.cars.push(car);
      this.train.add(car);
    }
    this.cargo = new THREE.Group();
    this.cars[1].add(this.cargo);

    this.puffs = new Burst(smoke, 400, false, -3);
    this.sparkles = new Burst(sparkle, 300, true, -2);
    this.snow = new Snowfall(snowflake, Math.round(this.ctx.engine.settings.snow * 0.4), 60, 30);
    this.scene.add(this.puffs.points, this.sparkles.points, this.snow.points);
    this.owned.push(this.puffs, this.sparkles, this.snow.points.geometry, this.snow.points.material as THREE.Material);
  }

  start() {
    this.ctx.hud.onGameAction = (a) => {
      if (a === 'go') this.sendTrain();
    };
    this.buildLevel(0);
  }

  // ---------------------------------------------------------------- level building

  private cellCenter(x: number, y: number) {
    return new THREE.Vector3(x * CELL, 0, y * CELL);
  }

  private clearBoard() {
    this.board.clear();
    this.views = [];
    this.houseMarkers.clear();
    this.delivered.clear();
  }

  private buildLevel(index: number) {
    this.clearBoard();
    this.levelIndex = index;
    this.level = parseLevel(LEVELS[index]);
    this.par = solve(this.level) ?? 0;
    this.presentIndex = 0;
    this.moves = 0;
    this.mistakes = 0;

    const baseGeo = new THREE.BoxGeometry(CELL - 0.15, 0.2, CELL - 0.15);
    this.owned.push(baseGeo);
    const plain = new THREE.MeshStandardMaterial({ color: '#d9e4f2', roughness: 0.9 });
    const empty = new THREE.MeshStandardMaterial({ color: '#e9f0f8', roughness: 1, transparent: true, opacity: 0.55 });
    this.owned.push(plain, empty);

    for (let y = 0; y < this.level.h; y++) {
      for (let x = 0; x < this.level.w; x++) {
        if (this.level.tiles.some((t) => t.x === x && t.y === y)) continue;
        const b = new THREE.Mesh(baseGeo, empty);
        b.position.copy(this.cellCenter(x, y)).setY(-0.08);
        b.receiveShadow = true;
        this.board.add(b);
      }
    }

    for (const tile of this.level.tiles) {
      const group = new THREE.Group();
      group.position.copy(this.cellCenter(tile.x, tile.y));
      this.board.add(group);
      if (tile.kind === 'house') {
        this.buildHouse(tile, group);
        continue;
      }
      const mat = tile.rotatable
        ? new THREE.MeshStandardMaterial({ color: '#ffd25a', emissive: '#7a5200', emissiveIntensity: 0.25, roughness: 0.6 })
        : plain;
      if (tile.rotatable) this.owned.push(mat);
      const base = new THREE.Mesh(baseGeo, mat);
      base.position.y = -0.08;
      base.receiveShadow = true;
      this.board.add(base);
      base.position.add(group.position);
      const tracks = this.buildTrack(tile);
      group.add(tracks);
      const angle = -tile.rot * (Math.PI / 2);
      group.rotation.y = angle;
      this.views.push({ tile, group, base, angle });
    }

    // A few decorations off the board.
    const deco = (id: string, x: number, z: number, s: number, r = 0) => {
      const o = this.m[id].clone(true);
      o.position.set(x, 0, z);
      o.scale.setScalar(s);
      o.rotation.y = r;
      this.board.add(o);
    };
    const right = this.level.w * CELL;
    deco('christmas_tree', right + 2, -4, 1.4);
    deco('snowman_A', -6, this.level.h * CELL - 2, 1.2, 0.6);
    deco('lantern', -5, -3, 1);

    this.frameCamera();
    this.resetTrain();
    this.setPhase('plan');
    this.ctx.hud.toast(`🚂 Level ${index + 1}/${LEVELS.length}: ${this.level.name}`, 2600);
    if (index === 0) {
      const tip = isTouchDevice ? 'Tap the glowing track to turn it, then tap 🚂 Go!' : 'Click the glowing track to turn it, then press Space or 🚂 Go!';
      this.ctx.hud.toast(tip, 4500);
    }
  }

  /** Track meshes for a tile in its rot-0 orientation (the group rotation does the rest). */
  private buildTrack(tile: Tile): THREE.Object3D {
    const g = new THREE.Group();
    const straight = (x: number, z: number, along: 'z' | 'x') => {
      const s = this.m.tracks_straight.clone(true);
      s.position.set(x, 0, z);
      if (along === 'x') s.rotation.y = Math.PI / 2;
      g.add(s);
    };
    switch (tile.kind) {
      case 'straight':
        for (const z of [-1.5, -0.5, 0.5, 1.5]) straight(0, z, 'z');
        break;
      case 'station': {
        const st = this.m.tracks_straight_station.clone(true);
        st.position.z = -0.5;
        g.add(st);
        straight(0, 1.5, 'z');
        break;
      }
      case 'curve': {
        // Model arc joins (2,0) and (0,2) around its origin; place it on the N–E corner.
        const c = this.m.tracks_curve.clone(true);
        c.position.set(2, 0, -2);
        c.rotation.y = -Math.PI / 2;
        g.add(c);
        break;
      }
      case 'cross': {
        g.add(this.m.tracks_crossing.clone(true));
        straight(0, -1.5, 'z');
        straight(0, 1.5, 'z');
        straight(-1.5, 0, 'x');
        straight(1.5, 0, 'x');
        break;
      }
    }
    return g;
  }

  private buildHouse(tile: Tile, group: THREE.Group) {
    const house = this.m.gingerbread_house_decorated.clone(true);
    house.scale.setScalar(2.2);
    // Face the house towards the track that leads into it.
    const neighbour = [0, 1, 2, 3].find((d) => this.level.tiles.some((t) => t.kind !== 'house' && t.x === tile.x + DX[d] && t.y === tile.y + DY[d])) ?? 2;
    house.rotation.y = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][neighbour];
    group.add(house);
    const marker = this.m[`present_A_${tile.colour}`].clone(true);
    marker.scale.setScalar(2);
    marker.position.y = 4.6;
    group.add(marker);
    this.houseMarkers.set(tile, marker);
  }

  /**
   * Fit the board to the screen. Levels are wider than tall, so on a portrait phone
   * the camera looks from the station's side and the board runs up the screen.
   */
  private frameCamera() {
    const w = this.level.w * CELL;
    const h = this.level.h * CELL;
    const center = new THREE.Vector3((w - CELL) / 2, 0, (h - CELL) / 2);
    const aspect = this.camera.aspect;
    this.framedAspect = aspect;
    const portrait = aspect < 1;
    // Board extent across and along the screen for this orientation.
    const across = portrait ? h : w;
    const along = portrait ? w : h;
    const size = Math.max(across / Math.min(aspect, 1.9), along * 1.25) + (portrait ? 3 : 6);
    if (portrait) {
      this.camera.position.set(center.x - size * 0.5, size * 1.12, center.z);
      this.camera.lookAt(center.x + 1, 0, center.z);
    } else {
      this.camera.position.set(center.x, size * 1.05, center.z + size * 0.62);
      this.camera.lookAt(center.x, 0, center.z + 1);
    }
  }

  // ---------------------------------------------------------------- train

  private resetTrain() {
    const { station, stationDir } = this.level;
    this.path = [];
    const start = this.cellCenter(station.x, station.y);
    const dir = new THREE.Vector3(DX[stationDir], 0, DY[stationDir]);
    // Park the train on the station, nose pointing out.
    this.path = [start.clone().addScaledVector(dir, -1.6), start.clone().addScaledVector(dir, 0.6)];
    this.measurePath();
    this.distance = this.pathLen[this.pathLen.length - 1];
    this.train.rotation.set(0, 0, 0);
    this.train.position.set(0, 0, 0);
    this.cars.forEach((c) => c.rotation.set(0, 0, 0));
    this.placeTrain();
    this.cargo.clear();
    const colour = this.level.presents[this.presentIndex];
    if (colour) {
      const p = this.m[`present_A_${colour}`].clone(true);
      p.scale.setScalar(0.55);
      p.position.y = 0.42;
      this.cargo.add(p);
    }
  }

  private measurePath() {
    this.pathLen = [0];
    for (let i = 1; i < this.path.length; i++) this.pathLen.push(this.pathLen[i - 1] + this.path[i].distanceTo(this.path[i - 1]));
  }

  private pointAt(d: number, out = new THREE.Vector3()) {
    const L = this.pathLen;
    if (d <= 0) return out.copy(this.path[0]);
    if (d >= L[L.length - 1]) return out.copy(this.path[this.path.length - 1]);
    let i = 1;
    while (L[i] < d) i++;
    const t = (d - L[i - 1]) / (L[i] - L[i - 1] || 1);
    return out.copy(this.path[i - 1]).lerp(this.path[i], t);
  }

  private placeTrain() {
    const gaps = [0, 1.45, 2.85];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    this.cars.forEach((car, i) => {
      const d = this.distance - gaps[i] * (TRAIN_SCALE / 1.6);
      this.pointAt(d, a);
      this.pointAt(d - 0.4, b);
      car.position.copy(a);
      if (a.distanceToSquared(b) > 1e-6) car.rotation.y = Math.atan2(a.x - b.x, a.z - b.z);
    });
  }

  /** Turn the traced grid route into a dense polyline through tile edges and arcs. */
  private buildPath(steps: ReturnType<typeof traceRoute>['steps'], outcome: Outcome) {
    const pts: THREE.Vector3[] = [];
    const dirVec = (d: Dir) => new THREE.Vector3(DX[d], 0, DY[d]);
    const station = this.cellCenter(steps[0].x, steps[0].y);
    pts.push(station.clone().addScaledVector(dirVec(steps[0].exit), -1.6));
    for (const s of steps) {
      const c = this.cellCenter(s.x, s.y);
      const end = c.clone().addScaledVector(dirVec(s.exit), CELL / 2);
      if (s.entry === null || (s.entry + 2) % 4 === s.exit) {
        pts.push(end);
        continue;
      }
      // Curve: quarter arc around the corner shared by the entry and exit edges.
      const corner = c.clone().addScaledVector(dirVec(s.entry), CELL / 2).addScaledVector(dirVec(s.exit), CELL / 2);
      const start = c.clone().addScaledVector(dirVec(s.entry), CELL / 2);
      const a0 = Math.atan2(start.z - corner.z, start.x - corner.x);
      let a1 = Math.atan2(end.z - corner.z, end.x - corner.x);
      if (a1 - a0 > Math.PI) a1 -= Math.PI * 2;
      if (a0 - a1 > Math.PI) a1 += Math.PI * 2;
      for (let i = 1; i <= 10; i++) {
        const a = a0 + ((a1 - a0) * i) / 10;
        pts.push(new THREE.Vector3(corner.x + Math.cos(a) * (CELL / 2), 0, corner.z + Math.sin(a) * (CELL / 2)));
      }
    }
    const last = steps[steps.length - 1];
    const edge = this.cellCenter(last.x, last.y).addScaledVector(dirVec(last.exit), CELL / 2);
    if (outcome.type === 'house') pts.push(edge.clone().addScaledVector(dirVec(last.exit), 0.4));
    if (outcome.type === 'derail') pts.push(edge.clone().addScaledVector(dirVec(last.exit), 1.4));
    this.path = pts;
    this.measurePath();
  }

  private sendTrain() {
    if (this.phase !== 'plan') return;
    const route = traceRoute(this.level);
    this.outcome = route.outcome;
    this.buildPath(route.steps, route.outcome);
    this.distance = 0;
    this.setPhase('drive');
    this.puffs.emit(this.cars[0].position.clone().setY(1.6), 10, { color: '#ffffff', speed: 1.5, up: 2, size: 1.6, life: 1 });
  }

  // ---------------------------------------------------------------- input + update

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseTime = 0;
  }

  private pickTile(): TileView | null {
    const { pointer } = this.ctx.input;
    this.raycaster.setFromCamera(new THREE.Vector2(pointer.x, pointer.y), this.camera);
    const movable = this.views.filter((v) => v.tile.rotatable);
    const hit = this.raycaster.intersectObjects(movable.flatMap((v) => [v.base, v.group]), true)[0];
    if (!hit) return null;
    return movable.find((v) => v.base === hit.object || v.group.getObjectById(hit.object.id)) ?? null;
  }

  private rotate(v: TileView) {
    v.tile.rot = (v.tile.rot + 1) % rotStates(v.tile);
    v.angle -= Math.PI / 2;
    this.moves++;
  }

  update(dt: number) {
    const pr = this.ctx.engine.renderer.getPixelRatio();
    if (this.camera.aspect !== this.framedAspect) this.frameCamera();
    this.time += dt;
    this.phaseTime += dt;
    const input = this.ctx.input;

    // Hover + click to rotate while planning.
    const hovered = this.phase === 'plan' && !this.ctx.hud.cardOpen ? this.pickTile() : null;
    if (hovered !== this.hovered) {
      if (this.hovered) (this.hovered.base.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.25;
      if (hovered) (hovered.base.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.9;
      this.hovered = hovered;
      this.ctx.engine.canvas.style.cursor = hovered ? 'pointer' : '';
    }
    if (input.justPressed('fire') && hovered) this.rotate(hovered);
    if (this.phase === 'plan' && input.justPressed('jump')) this.sendTrain();

    // Animate tile rotations and gently bob the rotatable ones.
    for (const v of this.views) {
      v.group.rotation.y = THREE.MathUtils.lerp(v.group.rotation.y, v.angle, 1 - Math.exp(-dt * 18));
    }
    for (const [tile, marker] of this.houseMarkers) {
      marker.position.y = 4.6 + Math.sin(this.time * 2 + tile.x) * 0.25;
      marker.rotation.y += dt * (this.delivered.has(tile) ? 0 : 1.2);
    }

    if (this.phase === 'drive') this.updateDrive(dt);
    if (this.phase === 'result' && this.phaseTime > 1.6) this.afterResult();

    this.puffs.update(dt, pr);
    this.sparkles.update(dt, pr);
    this.snow.update(this.time, this.camera.position, pr);
    this.renderBar();
  }

  private updateDrive(dt: number) {
    const total = this.pathLen[this.pathLen.length - 1];
    this.distance = Math.min(total, this.distance + TRAIN_SPEED * dt);
    this.placeTrain();
    if (Math.random() < dt * 6) this.puffs.emit(this.cars[0].position.clone().setY(1.5), 2, { color: '#ffffff', speed: 0.5, up: 1.5, size: 0.9, life: 0.8 });
    if (this.distance < total) return;

    const out = this.outcome!;
    if (out.type === 'house' && out.colour === this.level.presents[this.presentIndex] && !this.delivered.has(out.tile)) {
      this.delivered.add(out.tile);
      const marker = this.houseMarkers.get(out.tile)!;
      const at = marker.getWorldPosition(new THREE.Vector3());
      this.sparkles.emit(at, 50, { color: [COLOUR_HEX[out.colour], '#ffffff'], speed: 6, up: 2, size: 1.2, life: 1.2 });
      marker.scale.setScalar(1.3);
      this.cargo.clear();
      this.presentIndex++;
      this.message = `🎁 Delivered!`;
      haptic(25);
    } else {
      this.mistakes++;
      this.totalMistakes++;
      this.message = out.type === 'derail' ? '💥 Derailed!' : out.type === 'loop' ? '🔁 Going in circles!' : '🏠 Wrong chimney!';
      if (out.type === 'derail') this.cars.forEach((c, i) => (c.rotation.z = (i % 2 ? -1 : 1) * 0.5));
      this.puffs.emit(this.cars[0].position.clone().setY(0.8), 30, { color: '#ffffff', speed: 5, up: 2, size: 1.6, life: 0.9 });
      haptic([40, 50, 40]);
    }
    this.ctx.hud.toast(this.message, 1500);
    this.setPhase('result');
  }

  private afterResult() {
    if (this.presentIndex < this.level.presents.length) {
      this.resetTrain();
      this.setPhase('plan');
      return;
    }
    // Level complete.
    const score = this.mistakes === 0 && this.moves <= this.par ? 3 : this.mistakes <= 1 && this.moves <= this.par + 4 ? 2 : 1;
    this.levelScores.push(score);
    this.ctx.hud.toast(`✅ ${this.level.name} complete: ${'★'.repeat(score)}${'☆'.repeat(3 - score)} (${this.moves} clicks, par ${this.par})`, 2600);
    if (this.levelIndex + 1 < LEVELS.length) {
      this.buildLevel(this.levelIndex + 1);
    } else {
      this.setPhase('done');
      this.finish();
    }
  }

  private renderBar() {
    const queue = this.level.presents
      .map((c, i) => `<span class="${i < this.presentIndex ? 'done' : i === this.presentIndex ? 'now' : ''}">${EMOJI[c]}</span>`)
      .join('');
    const score = this.levelScores.reduce((a, b) => a + b, 0);
    this.ctx.hud.setGameBar(
      `<span>🚂 ${this.levelIndex + 1}/${LEVELS.length}</span><span class="queue">${queue}</span>` +
        `<span>🔄 ${this.moves}<small class="muted"> / par ${this.par}</small></span><span>⭐ ${score}</span>`,
    );
    this.ctx.hud.setAction({ id: 'go', label: '🚂 Go!', enabled: this.phase === 'plan' });
  }

  private finish(quit = false) {
    const score = this.levelScores.reduce((a, b) => a + b, 0);
    const summary = quit
      ? `You left the yard after ${this.levelScores.length} of ${LEVELS.length} levels.`
      : `${LEVELS.length} levels · ${this.totalMistakes} mishap${this.totalMistakes === 1 ? '' : 's'} · level stars ${this.levelScores.join(' ')}`;
    this.resolve({ score, quit, summary });
  }

  quit() {
    if (this.phase === 'done') return;
    this.setPhase('done');
    this.finish(true);
  }

  dispose() {
    this.ctx.engine.canvas.style.cursor = '';
    this.owned.forEach((o) => o.dispose());
    this.scene.clear();
  }
}
