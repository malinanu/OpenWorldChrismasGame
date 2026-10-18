import * as THREE from 'three';
import { assets } from '../core/AssetLoader';
import { audio } from '../core/Audio';
import { changeCharacter, serverConfig, signInAgain, signOut } from '../net/session';
import { Multiplayer } from '../net/Multiplayer';
import { showProfile, type HubTab } from '../ui/profile';
import { SnowballFight } from './SnowballFight';
import type { Engine, Quality } from '../core/Engine';
import { isTouchDevice, type Input } from '../core/Input';
import type { Overworld as OverworldContract, SceneManager } from '../core/SceneManager';
import { MINI_GAME_IDS, type MiniGameId } from '../minigames/MiniGame';
import { MINI_GAMES } from '../minigames/registry';
import type { Hud } from '../ui/hud';
import type { TouchControls } from '../ui/touch';
import { Burst } from '../vfx/Burst';
import { Snowfall } from '../vfx/Snowfall';
import { SnowTrail } from '../vfx/SnowTrail';
import { World } from '../world/World';
import { FollowCamera } from './FollowCamera';
import { GameZone } from './GameZone';
import { gameState } from './GameState';
import { t } from '../i18n/ui';
import type { Lang } from '../i18n';
import { api } from '../net/api';
import { switchLanguage } from '../ui/language';
import { Player } from './Player';

/** Seconds for a full day and night in the village. */
const DAY_LENGTH = 480;
/** Each visit starts mid-afternoon, so the lanterns come on within the first minute or two. */
const START_TIME = 0.6;

/** Ornament hook positions on the Great Tree (tree is ~14 m tall at its scale). */
const ORNAMENT_SPOTS: [number, number, number][] = [
  [2.6, 4.2, 1.2], [-2.4, 5.6, 1.4], [1.6, 7.4, -1.8], [-1.8, 3.4, -2.6], [0.4, 9.2, 1.4], [-1.2, 8.2, -0.6],
];

/** The explorable village: world + player + camera + zones. */
export class Overworld implements OverworldContract {
  readonly world = new World();
  readonly player = new Player();
  readonly cam = new FollowCamera();
  private zones: GameZone[] = [];
  private snow!: Snowfall;
  private trail!: SnowTrail;
  private fireworks!: Burst;
  private ornaments = new THREE.Group();
  private ornamentMat = new THREE.MeshStandardMaterial({ color: '#ffcc33', emissive: '#a86b00', emissiveIntensity: 0.6, metalness: 0.8, roughness: 0.25 });
  private paused = true;
  private saveTimer = 0;
  /** Time of day, 0..1 (0 = midnight, 0.5 = noon). */
  dayTime = START_TIME;
  fight!: SnowballFight;
  multiplayer: Multiplayer | null = null;
  private finaleTime = -1;
  private touchShown = false;
  sceneManager!: SceneManager;
  /** On-screen controls; shown only on touch devices while exploring. */
  touch?: TouchControls;

  constructor(
    private readonly engine: Engine,
    private readonly input: Input,
    private readonly hud: Hud,
  ) {
    hud.onPromptTap = () => input.tap('interact');
  }

  async load(onStep: (label: string) => void) {
    const q = this.engine.settings;
    await Promise.all([this.world.load({ forest: q.forest, shadowSize: q.shadows }, onStep), this.player.load()]);
    const [snowflake, sparkle, glow] = await Promise.all([
      assets.texture('vfx/snowflake.png'),
      assets.texture('vfx/sparkle.png'),
      assets.texture('vfx/glow.png'),
    ]);

    const d = this.world.data;
    const saved = gameState.data.playerPosition;
    const spawn = new THREE.Vector3(...(saved ?? d.spawn));
    spawn.y = this.world.groundY(spawn.x, spawn.z);
    this.player.attach(this.world.physics.world, spawn);
    this.world.scene.add(this.player.object);
    this.fight = new SnowballFight(this.player, this.hud, (x, z) => this.world.groundY(x, z), (x, z) => this.world.onSnow(x, z));
    await this.fight.load();
    this.world.scene.add(this.fight.group);
    if (!saved) this.player.faceTowards(Math.PI);
    this.cam.snapBehind(saved ? 0 : Math.PI);
    const s = gameState.data.settings;
    this.cam.sensitivity = s.sensitivity;
    this.cam.invertY = s.invertY;

    for (const z of d.zones) {
      const pos = new THREE.Vector3(z.position[0], 0, z.position[2]);
      pos.y = this.world.groundY(pos.x, pos.z);
      const zone = new GameZone(z.id, pos, z.radius, sparkle, glow);
      zone.beacon.setCompleted(gameState.hasOrnament(z.id));
      this.zones.push(zone);
      this.world.scene.add(zone.beacon.group);
    }

    this.snow = new Snowfall(snowflake, q.snow);
    this.fireworks = new Burst(sparkle, 1500, true, -5);
    this.trail = new SnowTrail((x, z) => this.world.groundY(x, z));
    this.world.scene.add(this.snow.points, this.fireworks.points, this.ornaments, this.trail.mesh);
    this.refreshOrnaments();
    this.engine.track(this.cam.camera);
  }

  refreshOrnaments() {
    this.ornaments.clear();
    const geo = new THREE.SphereGeometry(0.45, 20, 14);
    MINI_GAME_IDS.forEach((id, i) => {
      if (!gameState.hasOrnament(id)) return;
      const m = new THREE.Mesh(geo, this.ornamentMat);
      m.position.set(...ORNAMENT_SPOTS[i]);
      m.position.y += this.world.groundY(0, 0);
      this.ornaments.add(m);
    });
  }

  pause() {
    this.paused = true;
    this.setTouchVisible(false);
    this.hud.hidePrompt();
    this.zones.forEach((z) => (z.inside = false));
  }

  resume() {
    this.paused = false;
    this.input.lockPointer();
  }

  onReturn(id: MiniGameId, newOrnament: boolean) {
    this.zones.find((z) => z.id === id)?.beacon.setCompleted(gameState.hasOrnament(id));
    if (newOrnament) {
      this.refreshOrnaments();
      this.player.playOnce('Cheering');
      audio.sfx('ornament');
      this.hud.toast(t('ornamentHung', { game: MINI_GAMES[id].title, n: gameState.ornamentCount }), 4000);
      if (gameState.ornamentCount === MINI_GAME_IDS.length && !gameState.data.finaleSeen) this.startFinale();
    }
  }

  private startFinale() {
    gameState.data.finaleSeen = true;
    gameState.save();
    this.finaleTime = 0;
    this.hud.toast(t('finale'), 8000);
    audio.sfx('fanfare');
  }

  private nearestZone(): GameZone | undefined {
    return this.zones.find((z) => z.inside);
  }

  update(dt: number, time: number) {
    const input = this.input;
    if (!this.paused && !this.hud.cardOpen) {
      if (input.justPressed('map')) {
        this.hud.toggleMap(
          this.zones.map((z) => ({ id: z.id, x: z.position.x, z: z.position.z })),
          { x: this.player.position.x, z: this.player.position.z },
          // Frame the map on the games and roads, not the empty hills at the edge.
          Math.max(...this.zones.map((z) => Math.max(Math.abs(z.position.x), Math.abs(z.position.z)))) + 30,
          this.world.roads.lines,
        );
      }
      if (input.justPressed('pause')) {
        this.openProfile('settings');
      } else if (input.justPressed('leaderboard')) {
        this.openProfile('leaders');
      } else if (input.justPressed('profile')) {
        this.openProfile('passport');
      }
    }

    const active = !this.paused && !this.hud.cardOpen && !this.hud.mapOpen;
    this.setTouchVisible(isTouchDevice && active && this.hud.worldHud);
    if (active) {
      this.player.update(dt, input, this.cam.yaw);
    } else {
      this.player.animate(dt);
    }
    // The clock only runs while you're out in the village (not on the title, in menus or mini-games).
    if (!this.paused) this.dayTime = (this.dayTime + dt / DAY_LENGTH) % 1;
    this.world.setTime(gameState.data.settings.dayNight ? this.dayTime : 0.5);
    this.world.update(dt, this.player.position, time);
    this.player.syncObject();
    this.cam.update(
      dt,
      active ? input : ({ look: { x: 0, y: 0 }, wheel: 0 } as Input),
      this.player.position,
      this.world.physics.world,
      this.player.collider,
      (x, z) => this.world.groundY(x, z),
      active ? this.player.speed : 0,
      this.player.facingAngle,
    );
    this.trail.update(dt, time, this.player.position, this.player.isGrounded);

    const pr = this.engine.renderer.getPixelRatio();
    this.fight.update(dt, active ? input : null, this.cam.yaw, pr);
    this.touch?.setThrowReady(this.fight.onSnow);
    this.snow.update(time, this.cam.camera.position, pr);
    this.fireworks.update(dt, pr);
    for (const z of this.zones) {
      z.beacon.update(time, pr);
      if (!active) continue;
      const ev = z.check(this.player.position);
      if (ev === 'enter') {
        const info = MINI_GAMES[z.id];
        const firstTime = !gameState.isDiscovered(z.id);
        gameState.discover(z.id);
        if (firstTime) {
          this.hud.toast(t('discovered', { game: `${info.emoji} ${info.title}` }));
          audio.sfx('discover');
        }
      }
    }
    const zone = active ? this.nearestZone() : undefined;
    if (zone) {
      const info = MINI_GAMES[zone.id];
      this.hud.showPlayPrompt(info.emoji, info.title);
      if (input.justPressed('interact')) {
        this.hud.hidePrompt();
        void this.sceneManager.enter(zone.id);
      }
    } else if (active) {
      this.hud.hidePrompt();
    }

    if (this.finaleTime >= 0) {
      this.finaleTime += dt;
      if (Math.random() < dt * 3) {
        const p = new THREE.Vector3((Math.random() - 0.5) * 30, 16 + Math.random() * 10, (Math.random() - 0.5) * 30);
        const palette = [['#ff4d4d', '#ffd25a'], ['#5affb0', '#ffffff'], ['#6fb6ff', '#ffd25a'], ['#ff7ad9', '#ffffff']];
        audio.sfx('firework', 0.8 + Math.random() * 0.4);
        this.fireworks.emit(p, 80, { color: palette[Math.floor(Math.random() * palette.length)], speed: 12, up: 0, size: 1.6, life: 1.6 });
      }
      if (this.finaleTime > 20) this.finaleTime = -1;
    }

    this.saveTimer += dt;
    if (active && this.saveTimer > 5) {
      this.saveTimer = 0;
      const p = this.player.position;
      gameState.setPlayerPosition([+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)]);
    }
  }

  private setTouchVisible(v: boolean) {
    if (!this.touch || v === this.touchShown) return;
    this.touchShown = v;
    this.touch.setVisible(v);
  }

  /** Join the shared village: other players appear, snowballs fly between everyone. */
  goOnline() {
    if (this.multiplayer) return;
    const busy = () => !!this.sceneManager?.inMiniGame;
    this.multiplayer = new Multiplayer(() => this.fight.localState());
    this.multiplayer.on('status', (on) => this.hud.setOnline(on));
    this.fight.goOnline(this.multiplayer, busy);
    this.multiplayer.connect();
  }

  /**
   * The passport: the one menu (profile, leaderboard, settings). Opened by the badge / C,
   * L (leaderboard tab) and Esc / ⏸ (settings tab). The game pauses while it's open.
   */
  openProfile(tab: HubTab = 'passport') {
    if (this.paused || this.hud.cardOpen) return;
    this.paused = true;
    this.input.unlockPointer();
    void this.profileFlow(tab).finally(() => this.resume());
  }

  private async profileFlow(tab: HubTab) {
    const next = await showProfile(this.hud, { server: !!serverConfig, tab, onQuality: (q) => this.changeQuality(q), onLanguage: (l) => this.changeLanguage(l) });
    if (next === 'character') await changeCharacter(this.hud, this);
    else if (next === 'signin') signInAgain();
    else if (next === 'signout') await signOut();
  }

  /** A new language rebuilds every card, label and signpost: save where we are, tell the account, reload. */
  private changeLanguage(l: Lang) {
    const p = this.player.position;
    gameState.data.playerPosition = [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)];
    void switchLanguage(l, async () => {
      if (api.user) await api.updateMe({ language: l });
    });
  }

  /** Quality is baked into shaders and the forest, so the simplest correct switch is a reload. */
  private changeQuality(q: Quality) {
    if (q === gameState.data.settings.quality) return;
    const p = this.player.position;
    gameState.data.playerPosition = [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)];
    gameState.data.settings.quality = q;
    gameState.save();
    location.reload();
  }

  render(engine: Engine) {
    engine.render(this.world.scene, this.cam.camera);
  }
}
