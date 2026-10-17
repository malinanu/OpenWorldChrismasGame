import * as THREE from 'three';
import { assets } from '../../core/AssetLoader';
import { haptic, isTouchDevice } from '../../core/Input';
import { WorldLabels } from '../../ui/worldLabels';
import { Burst } from '../../vfx/Burst';
import { Lighting } from '../../world/Lighting';
import type { MiniGame, MiniGameContext, MiniGameResult } from '../MiniGame';

type Item = 'milk' | 'dough' | 'cookie' | 'gingerbread' | 'mug' | 'cocoa' | 'burnt';
type Product = 'milk' | 'cookie' | 'gingerbread' | 'cocoa';
type StationId = 'fridge' | 'dough' | 'oven' | 'decorate' | 'mugs' | 'stove' | 'bin' | 'serve';

const ROUND = 150;
const EMOJI: Record<Item, string> = { milk: '🥛', dough: '🥣', cookie: '🍪', gingerbread: '🧑‍🎄', mug: '🫖', cocoa: '☕', burnt: '💨' };
const NAME: Record<Item, string> = { milk: 'Milk', dough: 'Dough', cookie: 'Cookie', gingerbread: 'Gingerbread', mug: 'Mug', cocoa: 'Cocoa', burnt: 'Burnt' };
const BAKE = 3.5;
const BURN_AFTER = 7;
const DECORATE = 1.6;
const HEAT = 2.6;

interface Station {
  id: StationId;
  pos: THREE.Vector3;
  /** Timed stations: what's inside and how long it has been cooking. */
  content: Item | null;
  t: number;
  display?: THREE.Object3D;
}

interface Order {
  id: number;
  item: Product;
  patience: number;
  max: number;
  slot: number;
}

/** Game 2 — tap stations to fetch, bake, decorate and serve gingerbread customers before they lose patience. */
export class GingerbreadBakery implements MiniGame {
  readonly id = 'gingerbread-bakery' as const;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  readonly finished: Promise<MiniGameResult>;
  private resolve!: (r: MiniGameResult) => void;

  private m: Record<string, THREE.Object3D> = {};
  private stations = new Map<StationId, Station>();
  private labels!: WorldLabels;
  private puffs!: Burst;
  private sparkles!: Burst;
  private owned: { dispose(): void }[] = [];
  private customers: THREE.Object3D[] = [];
  private raycaster = new THREE.Raycaster();

  private held: Item | null = null;
  private orders: Order[] = [];
  private nextOrderId = 1;
  private spawnTimer = 1;
  private time = -2;
  private served = 0;
  private tips = 0;
  private missed = 0;
  private over = false;
  private framedAspect = 0;

  constructor(private readonly ctx: MiniGameContext) {
    this.finished = new Promise((r) => (this.resolve = r));
  }

  async load() {
    const ids = [
      'restaurant/fridge_A', 'restaurant/kitchentable_A', 'restaurant/oven', 'restaurant/kitchencounter_straight_A',
      'restaurant/stove_single', 'restaurant/pot_A', 'restaurant/bowl', 'restaurant/wall', 'restaurant/wall_orderwindow',
      'restaurant/floor_kitchen', 'restaurant/crate', 'restaurant/jar_A_medium', 'restaurant/shelf_papertowel_decorated',
      'holiday/cookie', 'holiday/gingerbread_man', 'holiday/milk', 'holiday/hot_chocolate', 'holiday/hot_chocolate_decorated',
      'holiday/candycane_small', 'holiday/plate_red', 'holiday/wreath', 'holiday/lantern_mini', 'holiday/christmas_tree',
    ];
    const [models, smoke, sparkle] = await Promise.all([
      Promise.all(ids.map((id) => assets.model(id))),
      assets.texture('vfx/smoke.png'),
      assets.texture('vfx/sparkle.png'),
    ]);
    ids.forEach((id, i) => (this.m[id.split('/')[1]] = models[i].scene));

    new Lighting(this.scene, this.ctx.engine.settings.shadows).follow(new THREE.Vector3(0, 0, 0));
    this.scene.fog = new THREE.Fog('#2a1d1a', 30, 60);
    this.scene.background = new THREE.Color('#2a1d1a');
    const warm = new THREE.PointLight('#ffc27a', 30, 30, 1.4);
    warm.position.set(0, 7, 3);
    this.scene.add(warm);

    // Kitchen floor and back wall.
    for (let x = -8; x <= 8; x += 4) for (let z = -4; z <= 4; z += 4) this.put('floor_kitchen', x, -0.5, z);
    for (let x = -6; x <= 6; x += 4) this.put(x === 6 ? 'wall_orderwindow' : 'wall', x, 0, -4.3);
    this.put('wreath', -2, 2.8, -4, 1.5);
    this.put('christmas_tree', -9, 0, -3, 0.7);
    this.put('shelf_papertowel_decorated', 2, 3, -4.05, 1);

    // Back row: fridge, oven, stove, serving window. Front row: dough, decorating, mugs, bin.
    this.addStation('fridge', -6, -2.4, () => this.put('fridge_A', -5.4, 0, -2.6));
    this.addStation('oven', -2, -2.4, () => this.put('oven', -2, 0, -2.6));
    this.addStation('stove', 2, -2.4, () => {
      this.put('stove_single', 2, 0, -2.6);
      this.put('pot_A', 2, 1.21, -2.6, 0.9);
    });
    this.addStation('serve', 6, -3.2, () => {});
    this.addStation('dough', -6, 1.6, () => {
      this.put('kitchentable_A', -6, 0, 1.6);
      this.put('bowl', -6.3, 1, 1.4, 1.2);
      this.put('bowl', -5.6, 1, 1.9, 1);
    });
    this.addStation('decorate', -2, 1.6, () => {
      this.put('kitchentable_A', -2, 0, 1.6);
      this.put('plate_red', -2, 1, 1.6, 1.4);
      this.put('candycane_small', -1.3, 1.35, 1.2, 1.4);
    });
    this.addStation('mugs', 2, 1.6, () => {
      this.put('kitchencounter_straight_A', 2, 0, 1.6);
      this.put('hot_chocolate', 1.6, 1, 1.5, 1.4);
      this.put('hot_chocolate', 2.4, 1, 1.8, 1.4, 1);
    });
    this.addStation('bin', 6, 1.6, () => this.put('crate', 6, 0, 1.6, 1, 0.3));

    // Three customer spots behind the order window.
    for (let i = 0; i < 3; i++) {
      const c = this.m.gingerbread_man.clone(true);
      c.rotation.x = -Math.PI / 2;
      c.scale.setScalar(4.2);
      c.position.set(4.9 + i * 1.1, 0.4, -5.6);
      c.visible = false;
      this.scene.add(c);
      this.customers.push(c);
    }

    this.puffs = new Burst(smoke, 200, false, -1);
    this.sparkles = new Burst(sparkle, 200, true, -2);
    this.scene.add(this.puffs.points, this.sparkles.points);
    this.owned.push(this.puffs, this.sparkles);
    this.frame();
  }

  private put(id: string, x: number, y: number, z: number, s = 1, r = 0): THREE.Object3D {
    const o = this.m[id].clone(true);
    o.position.set(x, y, z);
    o.scale.setScalar(s);
    o.rotation.y = r;
    this.scene.add(o);
    return o;
  }

  /** A station is a tap target at (x, z); `build` places its props. */
  private addStation(id: StationId, x: number, z: number, build: () => void) {
    build();
    this.stations.set(id, { id, pos: new THREE.Vector3(x, 0, z), content: null, t: 0 });
  }

  private frame() {
    const aspect = this.camera.aspect;
    this.framedAspect = aspect;
    const portrait = aspect < 1;
    this.camera.fov = portrait ? 50 : 46;
    this.camera.updateProjectionMatrix();
    // Fit the stations (x = ±6) plus their labels; portrait looks more top-down so the two rows separate.
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const dist = Math.max(14, 7.6 / (aspect * tanHalf));
    const dir = portrait ? new THREE.Vector3(0, 1.5, 0.75).normalize() : new THREE.Vector3(0, 1.05, 0.95).normalize();
    this.camera.position.copy(dir.multiplyScalar(dist)).add(new THREE.Vector3(0, 0, 1));
    this.camera.lookAt(0, 0.5, -0.6);
  }

  start() {
    this.labels = new WorldLabels(this.ctx.hud.root);
    const label: Record<StationId, string> = {
      fridge: '🥛<span class="nm">Fridge</span>', dough: '🥣<span class="nm">Dough</span>', oven: '🔥<span class="nm">Oven</span>',
      decorate: '🎨<span class="nm">Decorate</span>', mugs: '🫖<span class="nm">Mugs</span>', stove: '♨️<span class="nm">Stove</span>',
      bin: '🗑️<span class="nm">Bin</span>', serve: '🛎️<span class="nm">Serve</span>',
    };
    for (const s of this.stations.values()) {
      const y = s.id === 'serve' ? 3.2 : s.id === 'fridge' || s.id === 'oven' ? 3 : 2.1;
      this.labels.add(s.id, s.pos.clone().setY(y), label[s.id], () => this.use(s.id));
    }
    this.ctx.hud.toast(isTouchDevice ? 'Tap stations to cook · tap 🛎️ Serve to hand over' : 'Click stations to cook · click 🛎️ Serve to hand over', 3500);
  }

  // ---------------------------------------------------------------- gameplay

  private say(text: string) {
    this.ctx.hud.toast(text, 1400);
  }

  private take(item: Item, from: Station) {
    this.held = item;
    this.puffs.emit(from.pos.clone().setY(1.6), 6, { color: '#ffffff', speed: 1.5, up: 1.5, size: 0.8, life: 0.5 });
    haptic(10);
  }

  private use(id: StationId) {
    if (this.over || this.time < 0 || this.ctx.hud.cardOpen) return;
    const s = this.stations.get(id)!;
    const held = this.held;
    switch (id) {
      case 'fridge':
        if (!held) this.take('milk', s);
        else this.say(`Hands full (${EMOJI[held]})`);
        break;
      case 'dough':
        if (!held) this.take('dough', s);
        else this.say(`Hands full (${EMOJI[held]})`);
        break;
      case 'mugs':
        if (!held) this.take('mug', s);
        else this.say(`Hands full (${EMOJI[held]})`);
        break;
      case 'oven':
        this.timed(s, held, 'dough', ['cookie', 'burnt']);
        break;
      case 'stove':
        this.timed(s, held, 'mug', ['cocoa']);
        break;
      case 'decorate':
        this.timed(s, held, 'cookie', ['gingerbread']);
        break;
      case 'bin':
        if (held) {
          this.held = null;
          this.puffs.emit(s.pos.clone().setY(1.2), 10, { color: '#aaaaaa', speed: 2, up: 1, size: 0.9, life: 0.6 });
        }
        break;
      case 'serve':
        this.serve();
        break;
    }
  }

  /** Put the right input into a cooking station, or take its finished output. */
  private timed(s: Station, held: Item | null, input: Item, outputs: Item[]) {
    if (s.content && s.content !== input && outputs.includes(s.content)) {
      if (held) return this.say(`Hands full (${EMOJI[held]})`);
      this.take(s.content, s);
      s.content = null;
      this.setDisplay(s, null);
      return;
    }
    if (s.content === input) return this.say('Still cooking…');
    if (held === input) {
      s.content = input;
      s.t = 0;
      this.held = null;
      this.setDisplay(s, input);
      return;
    }
    this.say(held ? `${NAME[held]} doesn't go here` : `Bring ${EMOJI[input]} ${NAME[input]}`);
  }

  private setDisplay(s: Station, item: Item | null) {
    if (s.display) this.scene.remove(s.display);
    s.display = undefined;
    if (!item) return;
    const model =
      item === 'dough' ? 'cookie' : item === 'cookie' ? 'cookie' : item === 'gingerbread' ? 'gingerbread_man'
        : item === 'mug' ? 'hot_chocolate' : item === 'cocoa' ? 'hot_chocolate_decorated' : item === 'burnt' ? 'cookie' : null;
    if (!model) return;
    const o = this.m[model].clone(true);
    o.scale.setScalar(model.startsWith('hot') ? 1.6 : 2.4);
    const top = s.id === 'oven' ? 2.05 : s.id === 'stove' ? 1.75 : 1.08;
    o.position.copy(s.pos).setY(top).add(new THREE.Vector3(0, 0, s.id === 'oven' || s.id === 'stove' ? -0.2 : 0));
    if (item === 'dough' || item === 'burnt') {
      o.traverse((c) => {
        const mesh = c as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
        mat.color.set(item === 'dough' ? '#f3d9a8' : '#3a2a20');
        mesh.material = mat;
        this.owned.push(mat);
      });
    }
    this.scene.add(o);
    s.display = o;
  }

  private serve(orderId?: number) {
    if (this.over || this.time < 0) return;
    const held = this.held;
    if (!held) return this.say('Bring something to serve!');
    const order = orderId !== undefined ? this.orders.find((o) => o.id === orderId && o.item === held) : this.orders.find((o) => o.item === held);
    if (!order) return this.say(held === 'burnt' ? 'Nobody wants burnt cookies 💨' : `Nobody ordered ${EMOJI[held]}`);
    this.orders = this.orders.filter((o) => o !== order);
    this.held = null;
    this.served++;
    const tip = Math.ceil((order.patience / order.max) * 5);
    this.tips += tip;
    const c = this.customers[order.slot];
    this.sparkles.emit(c.position.clone().setY(2.5), 30, { color: ['#ffd25a', '#ffffff'], speed: 4, up: 2, size: 0.7, life: 0.9 });
    c.visible = false;
    haptic(25);
    this.say(`${EMOJI[order.item]} served! +${tip} 🪙`);
  }

  private spawnOrder() {
    const used = new Set(this.orders.map((o) => o.slot));
    const slot = [0, 1, 2].find((i) => !used.has(i));
    if (slot === undefined) return;
    // New recipes unlock as the shift goes on.
    const menu: Product[] = ['milk', 'cookie'];
    if (this.time > 15) menu.push('cocoa');
    if (this.time > 35) menu.push('gingerbread');
    const item = menu[Math.floor(Math.random() * menu.length)];
    const max = THREE.MathUtils.lerp(34, 22, Math.min(this.time / ROUND, 1)) + (item === 'gingerbread' ? 8 : 0);
    this.orders.push({ id: this.nextOrderId++, item, patience: max, max, slot });
    const c = this.customers[slot];
    c.visible = true;
    c.scale.setScalar(0.01);
  }

  update(dt: number) {
    if (this.camera.aspect !== this.framedAspect) this.frame();
    const pr = this.ctx.engine.renderer.getPixelRatio();
    this.time += dt;
    const playing = this.time >= 0 && !this.over;
    if (playing && this.ctx.input.justPressed('fire')) this.handleCanvasTap();

    if (playing) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnOrder();
        this.spawnTimer = THREE.MathUtils.lerp(8, 5, Math.min(this.time / ROUND, 1));
      }
      for (const o of this.orders) o.patience -= dt;
      for (const o of this.orders.filter((o) => o.patience <= 0)) {
        this.missed++;
        this.customers[o.slot].visible = false;
        this.say(`${EMOJI[o.item]} order walked out 😞`);
      }
      this.orders = this.orders.filter((o) => o.patience > 0);
      this.cook(dt);
      if (this.time >= ROUND) this.finish();
    }

    // Customers pop in and bob.
    this.customers.forEach((c, i) => {
      if (!c.visible) return;
      const s = Math.min(4.2, c.scale.x + dt * 14);
      c.scale.setScalar(s);
      c.position.y = 0.4 + Math.abs(Math.sin(this.time * 3 + i)) * 0.15;
    });

    this.renderUi();
    this.labels?.update(this.camera);
    this.puffs.update(dt, pr);
    this.sparkles.update(dt, pr);
  }

  private cook(dt: number) {
    const oven = this.stations.get('oven')!;
    if (oven.content === 'dough') {
      oven.t += dt;
      if (oven.t >= BAKE) {
        oven.content = 'cookie';
        oven.t = 0;
        this.setDisplay(oven, 'cookie');
        haptic(10);
      }
    } else if (oven.content === 'cookie') {
      oven.t += dt;
      if (oven.t >= BURN_AFTER) {
        oven.content = 'burnt';
        this.setDisplay(oven, 'burnt');
        this.say('🔥 The cookies burnt!');
      }
      if (Math.random() < dt * (oven.t > BURN_AFTER - 2.5 ? 8 : 0)) this.puffs.emit(oven.pos.clone().setY(2.4), 1, { color: '#555555', speed: 0.4, up: 1.5, size: 1, life: 1 });
    }
    const stove = this.stations.get('stove')!;
    if (stove.content === 'mug') {
      stove.t += dt;
      if (Math.random() < dt * 4) this.puffs.emit(stove.pos.clone().setY(2.1), 1, { color: '#ffffff', speed: 0.3, up: 1, size: 0.7, life: 0.9 });
      if (stove.t >= HEAT) {
        stove.content = 'cocoa';
        this.setDisplay(stove, 'cocoa');
      }
    }
    const deco = this.stations.get('decorate')!;
    if (deco.content === 'cookie') {
      deco.t += dt;
      if (deco.t >= DECORATE) {
        deco.content = 'gingerbread';
        this.setDisplay(deco, 'gingerbread');
        this.sparkles.emit(deco.pos.clone().setY(1.4), 12, { color: ['#ff5a5a', '#ffffff'], speed: 2, up: 1.5, size: 0.4, life: 0.6 });
      }
    }
  }

  private renderUi() {
    const bar = (f: number) => `<span class="bar"><i style="width:${Math.round(f * 100)}%"></i></span>`;
    const st = (id: StationId) => this.stations.get(id)!;
    const oven = st('oven');
    const ovenHtml =
      oven.content === 'dough' ? `🔥 Baking${bar(oven.t / BAKE)}` : oven.content === 'cookie' ? `🍪 Ready!${bar(1 - oven.t / BURN_AFTER)}`
        : oven.content === 'burnt' ? '💨 Burnt' : '🔥<span class="nm">Oven</span>';
    this.labels?.set('oven', ovenHtml, oven.content === 'cookie' ? (oven.t > BURN_AFTER - 2.5 ? 'hot' : 'ready') : '');
    const stove = st('stove');
    this.labels?.set('stove', stove.content === 'mug' ? `♨️ Heating${bar(stove.t / HEAT)}` : stove.content === 'cocoa' ? '☕ Ready!' : '♨️<span class="nm">Stove</span>', stove.content === 'cocoa' ? 'ready' : '');
    const deco = st('decorate');
    this.labels?.set('decorate', deco.content === 'cookie' ? `🎨 Icing${bar(deco.t / DECORATE)}` : deco.content === 'gingerbread' ? '🧑‍🎄 Ready!' : '🎨<span class="nm">Decorate</span>', deco.content === 'gingerbread' ? 'ready' : '');
    this.labels?.set('serve', '🛎️<span class="nm">Serve</span>', this.held && this.orders.some((o) => o.item === this.held) ? 'ready' : '');

    const left = Math.max(0, Math.ceil(ROUND - Math.max(this.time, 0)));
    const orders = this.orders
      .map((o) => {
        // Quantised so the ticket buttons aren't rebuilt every frame (which would swallow taps).
        const f = Math.ceil((o.patience / o.max) * 10) / 10;
        const match = this.held === o.item ? ' match' : '';
        return `<button class="order${match}" data-order="${o.id}">${EMOJI[o.item]}<span class="pt${f < 0.3 ? ' low' : ''}" style="width:${Math.round(f * 100)}%"></span></button>`;
      })
      .join('');
    const countdown = this.time < 0 ? `<span class="warn">Opening… ${Math.ceil(-this.time)}</span>` : '';
    this.ctx.hud.setGameBar(
      `${countdown}<span>⏱ <b class="${left <= 15 ? 'warn' : ''}">${left}</b>s</span><span>✅ ${this.served}</span><span>🪙 ${this.tips}</span>` +
        `<span class="chips">${orders || '<span class="chip muted">No orders yet</span>'}</span>`,
    );
    this.bindOrderButtons();
    this.ctx.hud.setAction({ id: 'held', label: this.held ? `🖐 ${EMOJI[this.held]} ${NAME[this.held]}` : '🖐 Empty hands', enabled: false });
  }

  /** Ticket buttons live in the game bar; tapping one serves that customer if you hold their order. */
  private bindOrderButtons() {
    document.querySelectorAll<HTMLButtonElement>('.gamebar button.order').forEach((b) => {
      if (b.dataset.bound) return;
      b.dataset.bound = '1';
      b.addEventListener('click', () => this.serve(Number(b.dataset.order)));
    });
  }

  private finish(quit = false) {
    if (this.over) return;
    this.over = true;
    this.resolve({
      score: this.served,
      quit,
      summary: quit ? 'You closed the bakery early.' : `${this.served} orders served · ${this.tips} 🪙 in tips · ${this.missed} walked out`,
    });
  }

  quit() {
    this.finish(true);
  }

  dispose() {
    this.labels?.dispose();
    this.owned.forEach((o) => o.dispose());
    this.scene.clear();
  }

  /** Taps on the 3D scene (not just the labels) also use the nearest station. */
  private handleCanvasTap() {
    const { pointer } = this.ctx.input;
    this.raycaster.setFromCamera(new THREE.Vector2(pointer.x, pointer.y), this.camera);
    let best: Station | null = null;
    let bestD = 1.6;
    for (const s of this.stations.values()) {
      const d = this.raycaster.ray.distanceToPoint(s.pos.clone().setY(1));
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (best) this.use(best.id);
  }
}
