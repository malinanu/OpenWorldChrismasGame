import * as THREE from 'three';
import { assets } from '../core/AssetLoader';
import { audio } from '../core/Audio';
import type { Engine, Quality } from '../core/Engine';
import { isTouchDevice, type Input } from '../core/Input';
import type { Overworld as OverworldContract, SceneManager } from '../core/SceneManager';
import { MINI_GAME_IDS, type MiniGameId } from '../minigames/MiniGame';
import { MINI_GAMES } from '../minigames/registry';
import { canFullscreen, setFullscreen, type Hud } from '../ui/hud';
import type { TouchControls } from '../ui/touch';
import { Burst } from '../vfx/Burst';
import { Snowfall } from '../vfx/Snowfall';
import { SnowTrail } from '../vfx/SnowTrail';
import { World } from '../world/World';
import { FollowCamera } from './FollowCamera';
import { GameZone } from './GameZone';
import { gameState } from './GameState';
import { Player } from './Player';

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
    await this.world.load({ forest: q.forest, shadowSize: q.shadows }, onStep);
    onStep('Waking up the villagers…');
    await this.player.load();
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

  private refreshOrnaments() {
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
      this.hud.toast(`🟡 ${MINI_GAMES[id].title} ornament hung on the Great Tree! (${gameState.ornamentCount}/6)`, 4000);
      if (gameState.ornamentCount === MINI_GAME_IDS.length && !gameState.data.finaleSeen) this.startFinale();
    }
  }

  private startFinale() {
    gameState.data.finaleSeen = true;
    gameState.save();
    this.finaleTime = 0;
    this.hud.toast('🎄 The Great Tree is lit! Merry Christmas, Frostvale! 🎆', 8000);
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
        this.openPause();
      }
    }

    const active = !this.paused && !this.hud.cardOpen && !this.hud.mapOpen;
    this.setTouchVisible(isTouchDevice && active && this.hud.worldHud);
    if (active) {
      this.player.update(dt, input, this.cam.yaw);
    } else {
      this.player.animate(dt);
    }
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
          this.hud.toast(`✨ Discovered: ${info.emoji} ${info.title}`);
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

  private openPause() {
    this.paused = true;
    this.input.unlockPointer();
    const s = gameState.data.settings;
    const current = s.quality;
    const toggle = (k: 'music' | 'sfx', label: string) => `<button class="chip ${s[k] ? 'on' : ''}" data-sound="${k}">${label}</button>`;
    const chip = (q: Quality, label: string) => `<button class="chip ${q === current ? 'on' : ''}" data-quality="${q}">${label}</button>`;
    const fs = canFullscreen()
      ? `<div class="row"><button class="chip" data-fullscreen>${document.fullscreenElement ? '🗗 Exit fullscreen' : '⛶ Fullscreen'}</button></div>`
      : '';
    this.hud
      .showCard(
        `<h2>⏸ Paused</h2>
         <p>Ornaments: ${gameState.ornamentCount}/6 · ⭐ ${gameState.totalStars}/18</p>
         <div class="settings">
           <div class="row"><span class="small">Graphics</span>${chip('low', 'Fast')}${chip('medium', 'Balanced')}${chip('high', 'Pretty')}</div>
           <div class="row"><span class="small">Sound</span>${toggle('music', '🎵 Music')}${toggle('sfx', '🔔 Effects')}</div>
           <div class="row"><span class="small">Volume</span><input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-volume aria-label="Volume"></div>
           ${fs}
         </div>
         <div class="row"><button data-ok autofocus>Resume</button></div>`,
        (card) => {
          card.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach((b) =>
            b.addEventListener('click', () => this.changeQuality(b.dataset.quality as Quality)),
          );
          card.querySelectorAll<HTMLButtonElement>('[data-sound]').forEach((b) =>
            b.addEventListener('click', () => {
              const k = b.dataset.sound as 'music' | 'sfx';
              s[k] = !s[k];
              b.classList.toggle('on', s[k]);
              audio.configure({ [k]: s[k] });
              gameState.save();
            }),
          );
          const vol = card.querySelector<HTMLInputElement>('[data-volume]')!;
          vol.addEventListener('input', () => audio.configure({ volume: (s.volume = Number(vol.value)) }));
          vol.addEventListener('change', () => {
            gameState.save();
            audio.sfx('catch');
          });
          card.querySelector('[data-fullscreen]')?.addEventListener('click', (e) => {
            const on = !document.fullscreenElement;
            void setFullscreen(on);
            (e.currentTarget as HTMLElement).textContent = on ? '🗗 Exit fullscreen' : '⛶ Fullscreen';
          });
        },
      )
      .catch(() => {})
      .finally(() => this.resume());
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
