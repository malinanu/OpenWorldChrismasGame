import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { assets } from '../core/AssetLoader';
import { FONT_STACK } from '../i18n';
import type { Snapshot } from '../net/Multiplayer';
import { equip, prepareAction } from '../fight/WeaponModels';

/** Rendered this far behind the newest snapshot, so there are always two to interpolate between. */
const DELAY_MS = 110;
/** Level of detail by distance from the camera's player (metres). */
const HIDE_BEYOND = 60;
const TAGS_WITHIN = 40;
const HALF_RATE_BEYOND = 25;
const SHADOW_WITHIN = 20;
const ANIM: Record<string, string> = {
  idle: 'Idle_A',
  walk: 'Walking_A',
  run: 'Running_A',
  jump: 'Jump_Idle',
  scoop: 'Interact',
  throw: 'Interact',
  cheer: 'Cheering',
  guard: 'Blocking',
  ko: 'Death_A',
};

/** A small health bar that floats above a fighter's name. */
function hpBar(): { sprite: THREE.Sprite; draw: (hp: number, max: number) => void } {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 20;
  const g = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, sizeAttenuation: false, transparent: true }));
  sprite.scale.set(0.09, 0.014, 1);
  sprite.renderOrder = 5;
  const draw = (hp: number, max: number) => {
    const f = Math.max(0, Math.min(1, hp / max));
    g.clearRect(0, 0, 128, 20);
    g.fillStyle = 'rgba(20, 34, 58, 0.85)';
    g.beginPath();
    g.roundRect(1, 1, 126, 18, 9);
    g.fill();
    g.fillStyle = f > 0.5 ? '#5fd35f' : f > 0.25 ? '#ffc23a' : '#ff4d4d';
    g.beginPath();
    g.roundRect(4, 4, Math.max(0.01, 120 * f), 12, 6);
    g.fill();
    tex.needsUpdate = true;
  };
  return { sprite, draw };
}

/** A name tag that always faces the camera and stays readable at any distance. */
function nameTag(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const font = `bold 44px ${FONT_STACK}`;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 44;
  c.width = w;
  c.height = 72;
  g.font = font;
  g.fillStyle = 'rgba(20, 34, 58, 0.82)';
  g.beginPath();
  g.roundRect(2, 2, w - 4, 68, 30);
  g.fill();
  g.strokeStyle = 'rgba(255, 210, 90, 0.9)';
  g.lineWidth = 4;
  g.stroke();
  g.fillStyle = '#fffaf2';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, 38);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, sizeAttenuation: false, transparent: true }));
  const h = 0.045;
  s.scale.set((h * w) / 72, h, 1);
  s.renderOrder = 5;
  return s;
}

/** Another player in the village: interpolated movement, their Adventurer, animations and a name tag. */
export class RemotePlayer {
  readonly object = new THREE.Group();
  private model: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private current?: THREE.AnimationAction;
  private tag: THREE.Sprite | null = null;
  private loadToken = 0;
  private flinch = 0;
  private char = '';
  private tagY = 2.35;
  private oneShot = false;
  private weaponId: string | null = null;
  private bar: ReturnType<typeof hpBar> | null = null;
  private barHp = -1;
  /** Fight zones: standing still plays this (a fighting stance). */
  idleClip = 'Idle_A';
  private shadows = true;
  private skipFrame = false;
  private animDt = 0;
  name = '';

  constructor(
    private readonly clips: THREE.AnimationClip[],
    name: string,
    char: string,
  ) {
    this.setProfile(name, char);
    this.object.visible = false;
  }

  setProfile(name: string, char: string) {
    if (name !== this.name) {
      this.name = name;
      if (this.tag) {
        this.object.remove(this.tag);
        this.tag.material.map?.dispose();
        this.tag.material.dispose();
      }
      this.tag = nameTag(name);
      this.tag.position.y = this.tagY;
      this.object.add(this.tag);
    }
    if (char !== this.char) {
      this.char = char;
      void this.loadModel(char);
    }
  }

  private async loadModel(char: string) {
    const mine = ++this.loadToken;
    const g = await assets.model(`characters/${char}.glb`).catch(() => assets.model('characters/Rogue_Hooded.glb'));
    if (mine !== this.loadToken) return;
    if (this.model) this.object.remove(this.model);
    this.model = cloneSkinned(g.scene);
    // Name tag just above the head, helmet or hat (measured before it's placed in the world).
    this.tagY = new THREE.Box3().setFromObject(this.model).max.y + 0.35;
    if (this.tag) this.tag.position.y = this.tagY;
    this.object.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.shadows = true; // a fresh model casts shadows until the distance check says otherwise
    this.actions.clear();
    this.current = undefined;
    this.oneShot = false;
    this.mixer.addEventListener('finished', (e) => {
      if (e.action === this.current) this.oneShot = false;
    });
    this.refreshClips();
    this.play('Idle_A');
    if (this.weaponId) void equip(this.model, this.weaponId);
  }

  /** Picks up clips added to the shared list since (the combat pack, loaded on demand). */
  refreshClips() {
    if (!this.mixer) return;
    for (const clip of this.clips) {
      if (this.actions.has(clip.name)) continue;
      const a = this.mixer.clipAction(clip);
      prepareAction(clip.name, a);
      this.actions.set(clip.name, a);
    }
  }

  /** Fight zones: what they hold and their health (null when not fighting). */
  setFighter(weaponId: string | null, hp: number | null, maxHp: number, idle: string) {
    if (weaponId !== this.weaponId) {
      this.weaponId = weaponId;
      if (this.model) void equip(this.model, weaponId);
    }
    this.idleClip = idle;
    if (hp === null) {
      if (this.bar) {
        this.object.remove(this.bar.sprite);
        this.bar.sprite.material.map?.dispose();
        this.bar.sprite.material.dispose();
        this.bar = null;
        this.barHp = -1;
      }
      return;
    }
    if (!this.bar) {
      this.bar = hpBar();
      this.object.add(this.bar.sprite);
    }
    this.bar.sprite.position.y = this.tagY + 0.32;
    if (Math.round(hp) !== this.barHp) {
      this.barHp = Math.round(hp);
      this.bar.draw(hp, maxHp);
    }
  }

  /** A one-off clip (a swing, a flinch) that plays over walking until it ends. */
  playOnce(name: string, timeScale = 1) {
    const a = this.actions.get(name);
    if (!a) return;
    a.timeScale = timeScale;
    const prev = this.current;
    a.reset().setEffectiveWeight(1).fadeIn(0.1).play();
    if (prev && prev !== a) prev.fadeOut(0.1);
    this.current = a;
    this.oneShot = true;
  }

  get facing() {
    return this.model?.rotation.y ?? 0;
  }

  private play(name: string) {
    const next = this.actions.get(name);
    if (!next || next === this.current) return;
    next.reset().fadeIn(0.2).play();
    this.current?.fadeOut(0.2);
    this.current = next;
  }

  /** Snowball hit: a quick wobble. */
  hit() {
    this.flinch = 0.45;
  }

  /** Where a snowball should aim (chest height). */
  get chest() {
    return this.object.position.clone().setY(this.object.position.y + 1.1);
  }

  update(dt: number, snaps: Snapshot[], viewer?: THREE.Vector3) {
    const renderAt = performance.now() - DELAY_MS;
    let a = snaps[0];
    let b = snaps[0];
    for (let i = 0; i < snaps.length - 1; i++) {
      if (snaps[i].t <= renderAt && snaps[i + 1].t >= renderAt) {
        a = snaps[i];
        b = snaps[i + 1];
        break;
      }
      if (snaps[i + 1].t < renderAt) a = b = snaps[i + 1];
    }
    if (!a) return;
    const k = b.t > a.t ? THREE.MathUtils.clamp((renderAt - a.t) / (b.t - a.t), 0, 1) : 1;
    this.object.position.set(THREE.MathUtils.lerp(a.x, b.x, k), THREE.MathUtils.lerp(a.y, b.y, k), THREE.MathUtils.lerp(a.z, b.z, k));
    // Busy players are inside a mini-game, not in the village. Far-away players aren't drawn or
    // animated at all; distant ones animate at half rate, without shadows, name tags or HP bars.
    const dist = viewer ? Math.hypot(this.object.position.x - viewer.x, this.object.position.z - viewer.z) : 0;
    this.object.visible = !b.busy && !!this.model && dist < HIDE_BEYOND;
    if (!this.object.visible) return;
    const near = dist < SHADOW_WITHIN;
    if (near !== this.shadows && this.model) {
      this.shadows = near;
      this.model.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = near;
      });
    }
    if (this.tag) this.tag.visible = dist < TAGS_WITHIN;
    if (this.bar) this.bar.sprite.visible = dist < TAGS_WITHIN;
    const dyaw = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw));
    if (this.model) {
      this.model.rotation.y = a.yaw + dyaw * k;
      if (this.flinch > 0) {
        this.flinch = Math.max(0, this.flinch - dt);
        this.model.rotation.z = Math.sin(this.flinch * 40) * this.flinch * 0.5;
      } else this.model.rotation.z = 0;
    }
    const anim = b.a === 'idle' && this.actions.has(this.idleClip) ? this.idleClip : (ANIM[b.a] ?? 'Idle_A');
    // A knock-out always shows, even over a swing that was still playing.
    if (b.a === 'ko' && this.oneShot && this.current !== this.actions.get('Death_A')) this.oneShot = false;
    if (!this.oneShot) this.play(this.actions.has(anim) ? anim : 'Idle_A');
    this.animDt += dt;
    this.skipFrame = dist > HALF_RATE_BEYOND && !this.skipFrame;
    if (this.skipFrame) return;
    this.mixer?.update(this.animDt);
    this.animDt = 0;
  }

  dispose() {
    this.loadToken++;
    if (this.tag) {
      this.tag.material.map?.dispose();
      this.tag.material.dispose();
    }
    this.object.removeFromParent();
  }
}
