import * as THREE from 'three';
import { assets } from '../../core/AssetLoader';
import { haptic, isTouchDevice } from '../../core/Input';
import { Physics, RAPIER } from '../../core/Physics';
import { Burst } from '../../vfx/Burst';
import { Snowfall } from '../../vfx/Snowfall';
import { Lighting } from '../../world/Lighting';
import type { MiniGame, MiniGameContext, MiniGameResult } from '../MiniGame';

/** Squares 0..23 run round the edge of a 7×7 grid; 23 is the finish. */
const SQUARES = 24;
const FINISH = SQUARES - 1;
const CELL = 1.15;
// A gift's +2 never lands on another special square.
const GIFTS = new Set([3, 10, 16]); // +2 steps
const CANDY = new Set([8, 19]); // roll again
const DRIFTS = new Set([6, 14, 21]); // miss a turn
/** Which local axis of the KayKit D6 points up for each face value. */
const FACES: [THREE.Vector3, number][] = [
  [new THREE.Vector3(1, 0, 0), 2], [new THREE.Vector3(-1, 0, 0), 5],
  [new THREE.Vector3(0, 1, 0), 6], [new THREE.Vector3(0, -1, 0), 1],
  [new THREE.Vector3(0, 0, 1), 3], [new THREE.Vector3(0, 0, -1), 4],
];
const SLOT_OFFSETS = [[-0.24, -0.22], [0.24, -0.22], [-0.24, 0.24], [0.24, 0.24]];
const ORDINAL = ['1st', '2nd', '3rd', '4th'];

interface Racer {
  name: string;
  colour: 'red' | 'green' | 'blue' | 'yellow';
  emoji: string;
  human: boolean;
  square: number;
  skip: boolean;
  place: number;
  pawn: THREE.Object3D;
  die: THREE.Object3D;
}

type Phase = 'await' | 'rolling' | 'moving' | 'pause' | 'done';

/** Square index → grid cell (x right, y down), clockwise from the bottom-left corner. */
function squareCell(i: number): [number, number] {
  if (i <= 6) return [i, 6];
  if (i <= 12) return [6, 12 - i];
  if (i <= 18) return [18 - i, 0];
  return [0, i - 18];
}

/** Game 6 — a race round the advent board against three AI elves, with physics dice. */
export class AdventDiceRace implements MiniGame {
  readonly id = 'advent-dice-race' as const;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 300);
  readonly finished: Promise<MiniGameResult>;
  private resolve!: (r: MiniGameResult) => void;

  private physics = new Physics(-30);
  private m: Record<string, THREE.Object3D> = {};
  private owned: { dispose(): void }[] = [];
  private racers: Racer[] = [];
  private turn = 0;
  private phase: Phase = 'await';
  private phaseTime = 0;
  private time = 0;
  private dieBody: RAPIER.RigidBody | null = null;
  private stillTime = 0;
  private roll = 0;
  private stepsLeft = 0;
  private hopFrom = new THREE.Vector3();
  private hopTo = new THREE.Vector3();
  private hopT = 0;
  private effectUsed = false;
  private rolledAgain = false;
  private nextPlace = 1;
  private log = '';
  private sparkles!: Burst;
  private puffs!: Burst;
  private snow!: Snowfall;
  private center = new THREE.Vector3(3 * CELL, 0, 3 * CELL);
  private framedAspect = 0;

  constructor(private readonly ctx: MiniGameContext) {
    this.finished = new Promise((r) => (this.resolve = r));
  }

  async load() {
    const colours = ['red', 'green', 'blue', 'yellow'] as const;
    const ids = [
      ...colours.map((c) => `boardgame/pawn_B_${c}`), ...colours.map((c) => `boardgame/D6_A_${c}`),
      'boardgame/tile_red', 'boardgame/tile_green', 'boardgame/tile_yellow', 'boardgame/tile_blue', 'boardgame/tile_purple',
      'holiday/present_A_red', 'holiday/present_B_green', 'holiday/snowball_pile', 'holiday/candycane_small',
      'holiday/christmas_tree_decorated', 'holiday/christmas_tree', 'holiday/present_C_blue', 'holiday/present_sphere_A_yellow',
      'holiday/lantern_decorated', 'holiday/gingerbread_man', 'holiday/hot_chocolate_decorated',
    ];
    const [models, snowflake, sparkle, smoke] = await Promise.all([
      Promise.all(ids.map((id) => assets.model(id))),
      assets.texture('vfx/snowflake.png'),
      assets.texture('vfx/sparkle.png'),
      assets.texture('vfx/smoke.png'),
    ]);
    ids.forEach((id, i) => (this.m[id.split('/')[1]] = models[i].scene));

    new Lighting(this.scene, this.ctx.engine.settings.shadows).follow(this.center);
    this.scene.fog = new THREE.FogExp2('#c6d6ec', 0.02);

    // Snowy ground, a wooden table and the board.
    const add = <T extends THREE.BufferGeometry | THREE.Material>(x: T) => (this.owned.push(x), x);
    const ground = new THREE.Mesh(add(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2)), add(new THREE.MeshStandardMaterial({ color: '#eef4fc', roughness: 0.95 })));
    ground.position.y = -1.6;
    ground.receiveShadow = true;
    const wood = add(new THREE.MeshStandardMaterial({ color: '#7a4a2b', roughness: 0.8 }));
    const table = new THREE.Mesh(add(new THREE.BoxGeometry(11, 0.4, 11)), wood);
    table.position.set(this.center.x, -0.45, this.center.z);
    const boardMat = add(new THREE.MeshStandardMaterial({ color: '#f1e2c6', roughness: 0.8 }));
    const board = new THREE.Mesh(add(new THREE.BoxGeometry(7 * CELL + 0.5, 0.25, 7 * CELL + 0.5)), boardMat);
    board.position.set(this.center.x, -0.125, this.center.z);
    const legGeo = add(new THREE.BoxGeometry(0.5, 1.2, 0.5));
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = new THREE.Mesh(legGeo, wood);
      leg.position.set(this.center.x + sx * 5, -1.05, this.center.z + sz * 5);
      this.scene.add(leg);
    }
    for (const o of [ground, table, board]) {
      o.receiveShadow = true;
      o.castShadow = o !== ground;
      this.scene.add(o);
    }

    this.buildSquares();
    this.decorate();

    const names: [string, Racer['colour'], string, boolean][] = [
      ['You', 'red', '🔴', true], ['Jingle', 'green', '🟢', false], ['Tinsel', 'blue', '🔵', false], ['Sprinkle', 'yellow', '🟡', false],
    ];
    this.racers = names.map(([name, colour, emoji, human]) => {
      const pawn = this.m[`pawn_B_${colour}`].clone(true);
      pawn.scale.setScalar(0.5);
      this.scene.add(pawn);
      const die = this.m[`D6_A_${colour}`].clone(true);
      die.scale.setScalar(1.3);
      die.visible = false;
      this.scene.add(die);
      return { name, colour, emoji, human, square: 0, skip: false, place: 0, pawn, die };
    });
    this.racers.forEach((r, i) => r.pawn.position.copy(this.squarePos(0, i)));

    // Dice tray: the board interior, fenced by invisible walls.
    const w = this.physics.world;
    const fixed = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    w.createCollider(RAPIER.ColliderDesc.cuboid(6, 0.5, 6).setTranslation(this.center.x, -0.5, this.center.z).setFriction(0.8).setRestitution(0.3), fixed);
    const half = 2.5 * CELL - 0.1;
    for (const [x, z, hx, hz] of [[0, -half, half, 0.1], [0, half, half, 0.1], [-half, 0, 0.1, half], [half, 0, 0.1, half]]) {
      w.createCollider(RAPIER.ColliderDesc.cuboid(hx, 3, hz).setTranslation(this.center.x + x, 2.5, this.center.z + z).setRestitution(0.4), fixed);
    }

    this.sparkles = new Burst(sparkle, 400, true, -3);
    this.puffs = new Burst(smoke, 200, false, -1);
    this.snow = new Snowfall(snowflake, Math.round(this.ctx.engine.settings.snow * 0.3), 30, 18);
    this.scene.add(this.sparkles.points, this.puffs.points, this.snow.points);
    this.owned.push(this.sparkles, this.puffs, this.snow.points.geometry, this.snow.points.material as THREE.Material);

    this.frame();
  }

  /** Back the camera off until the whole board fits the screen width (portrait phones need more room). */
  private frame() {
    const aspect = this.camera.aspect;
    this.framedAspect = aspect;
    const portrait = aspect < 1;
    this.camera.fov = portrait ? 50 : 45;
    this.camera.updateProjectionMatrix();
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const fitHeight = 13;
    const fitWidth = 5.4 / (aspect * tanHalf);
    const dist = Math.max(fitHeight, fitWidth);
    const dir = new THREE.Vector3(0, 9.6, 8.8).normalize();
    this.camera.position.copy(this.center).addScaledVector(dir, dist);
    this.camera.lookAt(this.center.x, -0.3, this.center.z + 0.6);
  }

  private squareCenter(i: number) {
    const [x, y] = squareCell(i);
    return new THREE.Vector3(x * CELL, 0, y * CELL);
  }

  /** Where racer `slot` stands on square `i` (four spots per square so pawns don't overlap). */
  private squarePos(i: number, slot: number) {
    const [ox, oz] = SLOT_OFFSETS[slot];
    return this.squareCenter(i).add(new THREE.Vector3(ox, 0.2, oz));
  }

  private buildSquares() {
    for (let i = 0; i < SQUARES; i++) {
      const kind = i === FINISH ? 'tile_yellow' : GIFTS.has(i) ? 'tile_yellow' : DRIFTS.has(i) ? 'tile_blue' : CANDY.has(i) ? 'tile_purple' : i % 2 ? 'tile_green' : 'tile_red';
      const tile = this.m[kind].clone(true);
      tile.position.copy(this.squareCenter(i));
      this.scene.add(tile);

      // Advent number painted in the corner.
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const g = canvas.getContext('2d')!;
      g.fillStyle = 'rgba(255,255,255,0.92)';
      g.beginPath();
      g.arc(32, 32, 28, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#8f1d29';
      g.font = 'bold 34px Fredoka, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(i === 0 ? '★' : String(i), 32, 34);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
      const geo = new THREE.PlaneGeometry(0.34, 0.34).rotateX(-Math.PI / 2);
      this.owned.push(tex, mat, geo);
      const label = new THREE.Mesh(geo, mat);
      label.position.copy(this.squareCenter(i)).add(new THREE.Vector3(0, 0.205, -0.0));
      this.scene.add(label);

      const deco = (id: string, s: number, y = 0.2) => {
        const o = this.m[id].clone(true);
        o.scale.setScalar(s);
        o.position.copy(this.squareCenter(i)).add(new THREE.Vector3(0.3, y, 0.3));
        o.rotation.y = i;
        this.scene.add(o);
      };
      if (GIFTS.has(i)) deco('present_A_red', 0.45);
      if (DRIFTS.has(i)) deco('snowball_pile', 0.3);
      if (CANDY.has(i)) deco('candycane_small', 0.9, 0.5);
      if (i === FINISH) deco('christmas_tree', 0.18);
    }
  }

  private decorate() {
    const put = (id: string, x: number, y: number, z: number, s: number, r = 0) => {
      const o = this.m[id].clone(true);
      o.position.set(x, y, z);
      o.scale.setScalar(s);
      o.rotation.y = r;
      this.scene.add(o);
    };
    const c = this.center;
    put('christmas_tree_decorated', c.x - 1, -1.6, c.z - 10, 1.6);
    put('present_C_blue', c.x - 3, -1.6, c.z - 8, 1.6, 0.4);
    put('present_B_green', c.x + 1.5, -1.6, c.z - 8.3, 1.6, -0.3);
    put('present_sphere_A_yellow', c.x - 0.3, -1.6, c.z - 7.4, 1.6);
    put('lantern_decorated', c.x + 7, -1.6, c.z - 4, 1);
    put('lantern_decorated', c.x - 7, -1.6, c.z - 4, 1);
    put('hot_chocolate_decorated', c.x + 4.6, -0.25, c.z + 3.8, 1.2, 0.5);
    put('gingerbread_man', c.x - 4.6, -0.25, c.z + 4, 1.3, -0.4);
  }

  start() {
    this.ctx.hud.onGameAction = (a) => {
      if (a === 'roll') this.tryHumanRoll();
    };
    this.ctx.hud.toast(isTouchDevice ? 'Tap 🎲 Roll to throw. First to door 23 wins!' : 'Press Space or 🎲 Roll to throw. First to door 23 wins!', 3500);
    this.beginTurn();
  }

  private get current() {
    return this.racers[this.turn];
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseTime = 0;
  }

  private beginTurn() {
    const r = this.current;
    this.effectUsed = false;
    this.rolledAgain = false;
    if (r.place) return this.endTurn();
    if (r.skip) {
      r.skip = false;
      this.say(`❄️ ${r.name} ${r.human ? 'are' : 'is'} digging out of a snow drift…`);
      this.setPhase('pause');
      return;
    }
    this.setPhase('await');
    this.say(r.human ? '🎲 Your turn — roll the die!' : `${r.emoji} ${r.name} is rolling…`);
  }

  private say(text: string) {
    this.log = text;
  }

  private tryHumanRoll() {
    if (this.phase === 'await' && this.current.human && !this.ctx.hud.cardOpen) this.throwDie();
  }

  private throwDie() {
    const r = this.current;
    const w = this.physics.world;
    if (this.dieBody) w.removeRigidBody(this.dieBody);
    this.racers.forEach((x) => (x.die.visible = false));
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28));
    const side = Math.random() < 0.5 ? -1 : 1;
    const body = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(this.center.x + side * 1.6, 2.6, this.center.z + 1.8)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setLinvel(-side * (3 + Math.random() * 2), 1 + Math.random() * 2, -(3 + Math.random() * 2))
        .setAngvel({ x: (Math.random() - 0.5) * 30, y: (Math.random() - 0.5) * 30, z: (Math.random() - 0.5) * 30 })
        .setCcdEnabled(true),
    );
    w.createCollider(RAPIER.ColliderDesc.roundCuboid(0.42, 0.42, 0.42, 0.07).setRestitution(0.35).setFriction(0.6).setDensity(1.5), body);
    this.dieBody = body;
    r.die.visible = true;
    this.stillTime = 0;
    this.setPhase('rolling');
  }

  private readDie(): number {
    const rot = this.dieBody!.rotation();
    const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    let best = 0;
    let value = 1;
    for (const [axis, v] of FACES) {
      const up = axis.clone().applyQuaternion(q).y;
      if (up > best) {
        best = up;
        value = v;
      }
    }
    return value;
  }

  private startMove(steps: number) {
    this.stepsLeft = steps;
    this.hopT = 1;
    this.setPhase('moving');
  }

  update(dt: number) {
    const pr = this.ctx.engine.renderer.getPixelRatio();
    if (this.camera.aspect !== this.framedAspect) this.frame();
    this.time += dt;
    this.phaseTime += dt;
    this.physics.update(dt);
    const r = this.current;

    switch (this.phase) {
      case 'await':
        if (r.human ? this.ctx.input.justPressed('jump') || this.ctx.input.justPressed('interact') : this.phaseTime > 0.8) {
          if (r.human) this.tryHumanRoll();
          else this.throwDie();
        }
        break;
      case 'rolling': {
        const t = this.dieBody!.translation();
        const q = this.dieBody!.rotation();
        r.die.position.set(t.x, t.y, t.z);
        r.die.quaternion.set(q.x, q.y, q.z, q.w);
        const lv = this.dieBody!.linvel();
        const av = this.dieBody!.angvel();
        const still = Math.hypot(lv.x, lv.y, lv.z) < 0.08 && Math.hypot(av.x, av.y, av.z) < 0.15;
        this.stillTime = still ? this.stillTime + dt : 0;
        if (this.stillTime > 0.3 || this.phaseTime > 4.5) {
          this.roll = this.readDie();
          if (r.human) haptic(20);
          this.sparkles.emit(new THREE.Vector3(t.x, t.y + 0.6, t.z), 20, { color: ['#ffd25a', '#ffffff'], speed: 3, up: 2, size: 0.4, life: 0.7 });
          this.say(`${r.emoji} ${r.name} rolled a ${this.roll}!`);
          this.startMove(this.roll);
        }
        break;
      }
      case 'moving':
        this.updateHop(dt);
        break;
      case 'pause':
        if (this.phaseTime > 1.3) this.endTurn();
        break;
    }

    // Idle bob for the racer whose turn it is.
    this.racers.forEach((x, i) => {
      if (this.phase === 'moving' && x === r) return;
      const base = this.squarePos(x.square, i);
      x.pawn.position.lerp(base, 1 - Math.exp(-dt * 10));
      x.pawn.position.y = base.y + (x === r && this.phase === 'await' ? Math.abs(Math.sin(this.time * 4)) * 0.12 : 0);
    });

    this.sparkles.update(dt, pr);
    this.puffs.update(dt, pr);
    this.snow.update(this.time, this.camera.position, pr);
    this.renderBar();
  }

  private updateHop(dt: number) {
    const r = this.current;
    const slot = this.turn;
    if (this.hopT >= 1) {
      if (this.stepsLeft <= 0 || r.square >= FINISH) return this.land();
      this.hopFrom.copy(r.pawn.position);
      r.square++;
      this.stepsLeft--;
      this.hopTo.copy(this.squarePos(r.square, slot));
      this.hopT = 0;
    }
    this.hopT = Math.min(1, this.hopT + dt / 0.24);
    r.pawn.position.lerpVectors(this.hopFrom, this.hopTo, this.hopT);
    r.pawn.position.y += Math.sin(this.hopT * Math.PI) * 0.45;
    if (this.hopT >= 1) this.puffs.emit(this.hopTo.clone(), 3, { color: '#ffffff', speed: 1, up: 0.5, size: 0.4, life: 0.4 });
  }

  private land() {
    const r = this.current;
    const at = this.squarePos(r.square, this.turn);
    if (r.square >= FINISH) {
      r.place = this.nextPlace++;
      this.sparkles.emit(at.clone().setY(1), 80, { color: ['#ffd25a', '#ff5a5a', '#5affb0', '#ffffff'], speed: 5, up: 3, size: 0.6, life: 1.4 });
      this.say(`🏁 ${r.name} finished ${ORDINAL[r.place - 1]}!`);
      this.setPhase('pause');
      return;
    }
    if (!this.effectUsed && GIFTS.has(r.square)) {
      this.effectUsed = true;
      this.say(`🎁 A gift! ${r.name} ${r.human ? 'hop' : 'hops'} 2 extra steps.`);
      this.sparkles.emit(at.clone().setY(0.8), 30, { color: ['#ff5a5a', '#ffd25a'], speed: 3, up: 2, size: 0.5, life: 0.9 });
      return this.startMove(2);
    }
    if (!this.effectUsed && DRIFTS.has(r.square)) {
      this.effectUsed = true;
      r.skip = true;
      this.say(`❄️ Snow drift! ${r.name} will miss the next turn.`);
      this.puffs.emit(at.clone().setY(0.4), 20, { color: '#ffffff', speed: 2, up: 1, size: 0.9, life: 0.9 });
    } else if (!this.effectUsed && !this.rolledAgain && CANDY.has(r.square)) {
      this.rolledAgain = true;
      this.say(`🍬 Candy cane! ${r.name} ${r.human ? 'roll' : 'rolls'} again.`);
      this.setPhase('await');
      this.phaseTime = -0.6;
      return;
    }
    this.setPhase('pause');
  }

  private endTurn() {
    const human = this.racers[0];
    const elvesDone = this.racers.filter((r) => !r.human && r.place).length;
    if (human.place || elvesDone === 3) return this.finish();
    this.turn = (this.turn + 1) % this.racers.length;
    this.beginTurn();
  }

  private renderBar() {
    const standings = this.racers
      .map((r, i) => `<span${i === this.turn ? ' class="now"' : ''}>${r.emoji} ${r.place ? '🏁' : r.square}</span>`)
      .join(' ');
    this.ctx.hud.setGameBar(`<span class="race">${standings}</span><span class="log">${this.log}</span>`);
    this.ctx.hud.setAction({ id: 'roll', label: '🎲 Roll', enabled: this.phase === 'await' && this.current.human });
  }

  private finish(quit = false) {
    if (this.phase === 'done') return;
    this.setPhase('done');
    const human = this.racers[0];
    const place = human.place || 4;
    const winner = this.racers.find((r) => r.place === 1);
    const summary = quit
      ? 'You left the race early.'
      : place === 1
        ? 'You beat all three elves to the finish! 🏆'
        : `You finished ${ORDINAL[place - 1]}. ${winner?.name} won the race.`;
    this.resolve({ score: Math.max(0, 4 - place), quit, summary });
  }

  quit() {
    this.finish(true);
  }

  dispose() {
    this.physics.dispose();
    this.owned.forEach((o) => o.dispose());
    this.scene.clear();
  }
}
