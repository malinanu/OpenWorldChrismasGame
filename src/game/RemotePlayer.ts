import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { assets } from '../core/AssetLoader';
import type { Snapshot } from '../net/Multiplayer';

/** Rendered this far behind the newest snapshot, so there are always two to interpolate between. */
const DELAY_MS = 110;
const ANIM: Record<string, string> = {
  idle: 'Idle_A',
  walk: 'Walking_A',
  run: 'Running_A',
  jump: 'Jump_Idle',
  scoop: 'Interact',
  throw: 'Interact',
  cheer: 'Cheering',
};

/** A name tag that always faces the camera and stays readable at any distance. */
function nameTag(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const font = 'bold 44px Fredoka, system-ui, sans-serif';
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
  s.position.y = 2.35;
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
    this.object.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions.clear();
    this.current = undefined;
    for (const clip of this.clips) this.actions.set(clip.name, this.mixer.clipAction(clip));
    this.play('Idle_A');
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

  update(dt: number, snaps: Snapshot[]) {
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
    // Busy players are inside a mini-game, not in the village.
    this.object.visible = !b.busy && !!this.model;
    const k = b.t > a.t ? THREE.MathUtils.clamp((renderAt - a.t) / (b.t - a.t), 0, 1) : 1;
    this.object.position.set(THREE.MathUtils.lerp(a.x, b.x, k), THREE.MathUtils.lerp(a.y, b.y, k), THREE.MathUtils.lerp(a.z, b.z, k));
    const dyaw = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw));
    if (this.model) {
      this.model.rotation.y = a.yaw + dyaw * k;
      if (this.flinch > 0) {
        this.flinch = Math.max(0, this.flinch - dt);
        this.model.rotation.z = Math.sin(this.flinch * 40) * this.flinch * 0.5;
      } else this.model.rotation.z = 0;
    }
    this.play(ANIM[b.a] ?? 'Idle_A');
    this.mixer?.update(dt);
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
