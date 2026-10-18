import * as THREE from 'three';
import { assets } from '../../core/AssetLoader';
import { audio } from '../../core/Audio';
import { haptic, isTouchDevice } from '../../core/Input';
import { WorldLabels } from '../../ui/worldLabels';
import { Burst } from '../../vfx/Burst';
import { Lighting } from '../../world/Lighting';
import type { MiniGame, MiniGameContext, MiniGameResult } from '../MiniGame';
import { t, toys } from './strings';

type Part = 'wood' | 'stone' | 'iron' | 'copper' | 'gold' | 'fabric' | 'hammer' | 'saw' | 'wrench';

interface PartDef {
  id: Part;
  emoji: string;
  model: string;
  scale: number;
  tool: boolean;
}

const PARTS: PartDef[] = [
  { id: 'wood', emoji: '🪵', model: 'resources/Wood_Plank_A', scale: 1.6, tool: false },
  { id: 'stone', emoji: '🪨', model: 'resources/Stone_Brick', scale: 1.8, tool: false },
  { id: 'iron', emoji: '🔩', model: 'resources/Iron_Bar', scale: 1.8, tool: false },
  { id: 'copper', emoji: '🟠', model: 'resources/Copper_Bar', scale: 1.8, tool: false },
  { id: 'gold', emoji: '🟡', model: 'resources/Gold_Bar', scale: 1.8, tool: false },
  { id: 'fabric', emoji: '🧶', model: 'resources/Textiles_A', scale: 1.4, tool: false },
  { id: 'hammer', emoji: '🔨', model: 'rpg_tools/hammer', scale: 1.6, tool: true },
  { id: 'saw', emoji: '🪚', model: 'rpg_tools/saw', scale: 1.1, tool: true },
  { id: 'wrench', emoji: '🔧', model: 'rpg_tools/wrench_A', scale: 1.8, tool: true },
];
const BY_ID = new Map(PARTS.map((p) => [p.id, p]));
const SHIFT = 150;
const BLUEPRINTS = 9;
const COLOURS = ['red', 'green', 'blue', 'yellow'];

type Phase = 'intro' | 'memorise' | 'build' | 'result' | 'done';

/** Game 4 — memorise each toy's blueprint, pick its parts and tool from the bench, and build it. */
export class ElfWorkshop implements MiniGame {
  readonly id = 'elf-workshop' as const;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
  readonly finished: Promise<MiniGameResult>;
  private resolve!: (r: MiniGameResult) => void;

  private m: Record<string, THREE.Object3D> = {};
  private partPos = new Map<Part, THREE.Vector3>();
  private labels!: WorldLabels;
  private card = document.createElement('div');
  private sparkles!: Burst;
  private puffs!: Burst;
  private owned: { dispose(): void }[] = [];
  private raycaster = new THREE.Raycaster();
  private anvilTop = new THREE.Vector3(0, 1.75, -2.2);
  private builtToys: THREE.Object3D[] = [];

  private phase: Phase = 'intro';
  private phaseTime = 0;
  private time = 0;
  private index = 0;
  private recipe: Part[] = [];
  private toy = '';
  private tray: Part[] = [];
  private made = 0;
  private framedAspect = 0;

  constructor(private readonly ctx: MiniGameContext) {
    this.finished = new Promise((r) => (this.resolve = r));
  }

  async load() {
    const ids = [
      ...PARTS.map((p) => p.model),
      'dungeon/table_long_tablecloth', 'dungeon/floor_wood_large', 'dungeon/wall', 'dungeon/banner_patternA_red', 'dungeon/shelf_small_candles',
      'rpg_tools/anvil', 'rpg_tools/blueprint', 'rpg_tools/lantern', 'resources/Wood_Log_Stack', 'holiday/christmas_tree_decorated',
      ...COLOURS.map((c) => `holiday/present_A_${c}`),
    ];
    const [models, sparkle, smoke] = await Promise.all([
      Promise.all(ids.map((id) => assets.model(id))),
      assets.texture('vfx/sparkle.png'),
      assets.texture('vfx/smoke.png'),
    ]);
    ids.forEach((id, i) => (this.m[id] = models[i].scene));

    new Lighting(this.scene, this.ctx.engine.settings.shadows).follow(new THREE.Vector3(0, 0, 0));
    this.scene.background = new THREE.Color('#2b2030');
    this.scene.fog = new THREE.Fog('#2b2030', 25, 50);
    const lamp = new THREE.PointLight('#ffcf8a', 40, 25, 1.4);
    lamp.position.set(0, 6, 1);
    this.scene.add(lamp);

    for (let x = -8; x <= 8; x += 4) for (let z = -6; z <= 6; z += 4) this.put('dungeon/floor_wood_large', x, 0, z);
    for (let x = -8; x <= 8; x += 4) this.put('dungeon/wall', x, 0, -5);
    this.put('dungeon/banner_patternA_red', -4, 0, -4.4, 1.2);
    this.put('dungeon/banner_patternA_red', 4, 0, -4.4, 1.2);
    this.put('dungeon/shelf_small_candles', 0, 2.6, -4.4, 1.3);
    this.put('holiday/christmas_tree_decorated', -7.5, 0, -3, 0.9);
    this.put('resources/Wood_Log_Stack', 7, 0, -3, 2);
    this.put('rpg_tools/anvil', 0, 0.9, -2.2, 1.6);
    this.put('rpg_tools/lantern', 2.6, 0.95, -2.4, 1.6);
    // Long workbench across the room; parts laid out in a 3×3 grid on it.
    const bench = this.put('dungeon/table_long_tablecloth', 0, 0, 1, 1.6);
    bench.rotation.y = Math.PI / 2;
    PARTS.forEach((p, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const pos = new THREE.Vector3((col - 1) * 2.5, 1.62, row * 1.45 - 0.5);
      const o = this.put(p.model, pos.x, pos.y, pos.z, p.scale);
      o.rotation.y = p.tool ? 0.4 : Math.PI / 2 + (i % 2 ? 0.2 : -0.2);
      if (p.tool) o.position.y += 0.25;
      this.partPos.set(p.id, pos);
    });

    this.sparkles = new Burst(sparkle, 300, true, -2);
    this.puffs = new Burst(smoke, 200, false, -1);
    this.scene.add(this.sparkles.points, this.puffs.points);
    this.owned.push(this.sparkles, this.puffs);
    this.frame();
  }

  private put(id: string, x: number, y: number, z: number, s = 1): THREE.Object3D {
    const o = this.m[id].clone(true);
    o.position.set(x, y, z);
    o.scale.setScalar(s);
    this.scene.add(o);
    return o;
  }

  private frame() {
    const aspect = this.camera.aspect;
    this.framedAspect = aspect;
    const portrait = aspect < 1;
    this.camera.fov = portrait ? 50 : 46;
    this.camera.updateProjectionMatrix();
    // Steeper in portrait so the three rows of parts spread out vertically.
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const dist = Math.max(11, 4.4 / (aspect * tanHalf));
    const dir = portrait ? new THREE.Vector3(0, 1.7, 0.7).normalize() : new THREE.Vector3(0, 1.15, 0.85).normalize();
    this.camera.position.copy(dir.multiplyScalar(dist)).add(new THREE.Vector3(0, 0, 0.6));
    this.camera.lookAt(0, 1, -0.4);
  }

  start() {
    this.labels = new WorldLabels(this.ctx.hud.root);
    for (const p of PARTS) this.labels.add(p.id, this.partPos.get(p.id)!.clone().setY(2.35), this.partLabel(p), () => this.pick(p.id));
    this.card.className = 'blueprint hidden';
    this.ctx.hud.root.append(this.card);
    this.ctx.hud.onGameAction = (a) => {
      if (a === 'build') this.build();
      if (a === 'next') this.nextBlueprint();
    };
    this.ctx.hud.toast(isTouchDevice ? t('tipTouch') : t('tipDesktop'), 3500);
    this.phase = 'intro';
    this.phaseTime = 0;
  }

  // ---------------------------------------------------------------- flow

  private makeRecipe(n: number): Part[] {
    const mats = PARTS.filter((p) => !p.tool);
    const tools = PARTS.filter((p) => p.tool);
    const r: Part[] = [tools[Math.floor(Math.random() * tools.length)].id];
    // Later blueprints use more distinct materials and some doubles.
    while (r.length < n) r.push(mats[Math.floor(Math.random() * mats.length)].id);
    return r.sort((a, b) => PARTS.findIndex((p) => p.id === a) - PARTS.findIndex((p) => p.id === b));
  }

  private nextBlueprint() {
    if (this.index >= BLUEPRINTS || this.time >= SHIFT) return this.finish();
    const size = this.index < 3 ? 3 : this.index < 6 ? 4 : 5;
    this.recipe = this.makeRecipe(size);
    audio.sfx('blueprint');
    const names = toys();
    this.toy = names[this.index % names.length];
    this.tray = [];
    this.index++;
    this.phase = 'memorise';
    this.phaseTime = 0;
    this.showCard(true);
  }

  private get memoriseTime() {
    return Math.max(2.2, 4.2 - this.index * 0.25) + this.recipe.length * 0.25;
  }

  private showCard(visible: boolean, extra = '') {
    if (!visible) {
      this.card.classList.add('hidden');
      return;
    }
    const items = this.recipe.map((p) => BY_ID.get(p)!.emoji).join('');
    this.card.innerHTML = `<div class="small muted">${t('blueprint', { i: this.index, n: BLUEPRINTS })}</div><h3>${this.toy}</h3><div class="items">${items}</div>${extra || '<div class="timer"><i></i></div>'}`;
    this.card.classList.remove('hidden');
  }

  private partLabel(p: PartDef) {
    return `<span class="big">${p.emoji}</span><span class="nm">${t(`part_${p.id}`)}</span>`;
  }

  private pick(id: Part) {
    if (this.phase !== 'build' || this.ctx.hud.cardOpen) return;
    if (this.tray.length >= 6) return this.ctx.hud.toast(t('trayFull'), 1400);
    this.tray.push(id);
    const pos = this.partPos.get(id)!;
    this.sparkles.emit(pos.clone().setY(2), 6, { color: ['#ffffff', '#ffd25a'], speed: 1.5, up: 1.5, size: 0.4, life: 0.5 });
    haptic(10);
    audio.sfx('pick', 1 + this.tray.length * 0.08);
  }

  private unpick(i: number) {
    if (this.phase !== 'build') return;
    this.tray.splice(i, 1);
  }

  private build() {
    if (this.phase !== 'build' || this.tray.length === 0) return;
    const a = [...this.tray].sort().join(',');
    const b = [...this.recipe].sort().join(',');
    const ok = a === b;
    this.phase = 'result';
    this.phaseTime = 0;
    if (ok) {
      this.made++;
      const present = this.m[`holiday/present_A_${COLOURS[this.made % COLOURS.length]}`].clone(true);
      present.scale.setScalar(0.01);
      present.position.copy(this.anvilTop);
      this.scene.add(present);
      this.builtToys.push(present);
      this.sparkles.emit(this.anvilTop.clone().add(new THREE.Vector3(0, 0.6, 0)), 60, { color: ['#ffd25a', '#ff5a5a', '#5affb0'], speed: 5, up: 3, size: 0.6, life: 1.1 });
      haptic(30);
      audio.sfx('build');
      this.showCard(true, `<div class="ornament">${t('built')}</div>`);
    } else {
      this.puffs.emit(this.anvilTop.clone(), 30, { color: '#888888', speed: 3, up: 2, size: 1.2, life: 1 });
      haptic([40, 50, 40]);
      audio.sfx('crash');
      const got = this.tray.map((p) => BY_ID.get(p)!.emoji).join('');
      this.showCard(true, `<div>${t('wobbly', { got })}</div>`);
    }
  }

  update(dt: number) {
    if (this.camera.aspect !== this.framedAspect) this.frame();
    const pr = this.ctx.engine.renderer.getPixelRatio();
    this.phaseTime += dt;
    if (this.phase !== 'intro' && this.phase !== 'done') this.time += dt;

    switch (this.phase) {
      case 'intro':
        if (this.phaseTime > 1.2) this.nextBlueprint();
        break;
      case 'memorise': {
        const f = 1 - this.phaseTime / this.memoriseTime;
        const bar = this.card.querySelector<HTMLElement>('.timer > i');
        if (bar) bar.style.width = `${Math.max(0, f) * 100}%`;
        if (f <= 0) {
          this.showCard(false);
          this.phase = 'build';
          this.phaseTime = 0;
        }
        break;
      }
      case 'build':
        if (this.ctx.input.justPressed('fire')) this.tapScene();
        if (this.ctx.input.justPressed('jump') || this.ctx.input.justPressed('interact')) this.build();
        break;
      case 'result':
        if (this.phaseTime > 1.8) {
          this.showCard(false);
          this.nextBlueprint();
        }
        break;
    }
    if (this.time >= SHIFT && this.phase !== 'done') this.finish();

    // Finished toys pop in on the anvil, then slide to the shelf behind it.
    this.builtToys.forEach((t, i) => {
      t.scale.setScalar(Math.min(1.2, t.scale.x + dt * 4));
      const shelf = new THREE.Vector3(-3.2 + (i % 5) * 1.6, 0, -3.6 - Math.floor(i / 5) * 0.9);
      if (t.scale.x >= 1.2) t.position.lerp(shelf, 1 - Math.exp(-dt * 3));
    });

    this.renderUi();
    this.labels?.update(this.camera);
    this.sparkles.update(dt, pr);
    this.puffs.update(dt, pr);
  }

  private tapScene() {
    const { pointer } = this.ctx.input;
    this.raycaster.setFromCamera(new THREE.Vector2(pointer.x, pointer.y), this.camera);
    let best: Part | null = null;
    let bestD = 0.9;
    for (const [id, pos] of this.partPos) {
      const d = this.raycaster.ray.distanceToPoint(pos);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    if (best) this.pick(best);
  }

  private renderUi() {
    const left = Math.max(0, Math.ceil(SHIFT - this.time));
    const tray = this.tray.map((p, i) => `<button class="order" data-i="${i}">${BY_ID.get(p)!.emoji}</button>`).join('');
    const status = this.phase === 'memorise' ? t('memorise') : this.phase === 'build' ? (tray ? '' : t('tapParts')) : '';
    this.ctx.hud.setGameBar(
      `<span>${t('timer', { cls: left <= 15 ? 'warn' : '', left })}</span><span>🎁 ${this.made}/${BLUEPRINTS}</span>` +
        `<span class="chips">${tray}${status ? `<span class="chip">${status}</span>` : ''}</span>`,
    );
    document.querySelectorAll<HTMLButtonElement>('.gamebar button.order').forEach((b) => {
      if (b.dataset.bound) return;
      b.dataset.bound = '1';
      b.addEventListener('click', () => this.unpick(Number(b.dataset.i)));
    });
    for (const p of PARTS) this.labels?.set(p.id, this.partLabel(p), this.tray.includes(p.id) ? 'picked' : '');
    this.labels?.setVisible(this.phase === 'build' || this.phase === 'result');
    this.ctx.hud.setAction({ id: 'build', label: t('build'), enabled: this.phase === 'build' && this.tray.length > 0 });
  }

  private finish(quit = false) {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.showCard(false);
    this.resolve({
      score: this.made,
      quit,
      summary: quit ? t('summaryQuit') : t(this.time >= SHIFT ? 'summaryBell' : 'summary', { made: this.made, n: BLUEPRINTS }),
    });
  }

  quit() {
    this.finish(true);
  }

  dispose() {
    this.labels?.dispose();
    this.card.remove();
    this.owned.forEach((o) => o.dispose());
    this.scene.clear();
  }
}
