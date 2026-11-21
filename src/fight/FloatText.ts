import * as THREE from 'three';
import { FONT_STACK } from '../i18n';

interface Item {
  sprite: THREE.Sprite;
  age: number;
  life: number;
  vy: number;
  scale: number;
}

/** Floating numbers and words over fighters ("-12", "Blocked!"), rising and fading out. */
export class FloatText {
  readonly group = new THREE.Group();
  private items: Item[] = [];

  /** Rendered words and numbers, reused: the same "-12" or "Blocked!" is drawn only once. */
  private textures = new Map<string, { tex: THREE.CanvasTexture; w: number; h: number }>();
  /** Finished sprites, ready to show the next number (no new material per hit). */
  private spare: THREE.Sprite[] = [];

  private texture(text: string, color: string, big: boolean) {
    const key = `${text}|${color}|${big}`;
    let t = this.textures.get(key);
    if (!t) {
      const c = document.createElement('canvas');
      const g = c.getContext('2d')!;
      const size = big ? 64 : 48;
      const font = `900 ${size}px ${FONT_STACK}`;
      g.font = font;
      c.width = Math.ceil(g.measureText(text).width) + 24;
      c.height = size + 24;
      g.font = font;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 8;
      g.strokeStyle = 'rgba(20, 28, 48, 0.9)';
      g.strokeText(text, c.width / 2, c.height / 2);
      g.fillStyle = color;
      g.fillText(text, c.width / 2, c.height / 2);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      t = { tex, w: c.width, h: c.height };
      // A fight only ever shows a few dozen different numbers; keep the cache from growing forever.
      if (this.textures.size > 80) {
        const [oldKey, old] = this.textures.entries().next().value!;
        if (!this.items.some((it) => it.sprite.material.map === old.tex)) {
          old.tex.dispose();
          this.textures.delete(oldKey);
        }
      }
      this.textures.set(key, t);
    }
    return t;
  }

  spawn(at: THREE.Vector3, text: string, color = '#ffffff', big = false) {
    const t = this.texture(text, color, big);
    const sprite = this.spare.pop() ?? new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true }));
    sprite.material.map = t.tex;
    sprite.material.opacity = 1;
    const scale = (big ? 0.05 : 0.038) / t.h;
    sprite.scale.set(t.w * scale, t.h * scale, 1);
    sprite.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4));
    sprite.renderOrder = 10;
    this.group.add(sprite);
    this.items.push({ sprite, age: 0, life: big ? 1.3 : 0.95, vy: 1.6, scale: 1 });
  }

  update(dt: number) {
    this.items = this.items.filter((it) => {
      it.age += dt;
      const k = it.age / it.life;
      it.sprite.position.y += it.vy * dt;
      it.vy *= Math.exp(-dt * 2.5);
      // A quick pop at the start, then fade.
      const pop = k < 0.12 ? 1 + (0.12 - k) * 4 : 1;
      it.sprite.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      if (pop !== it.scale) {
        it.sprite.scale.multiplyScalar(pop / it.scale);
        it.scale = pop;
      }
      if (k >= 1) {
        this.group.remove(it.sprite);
        this.spare.push(it.sprite);
        return false;
      }
      return true;
    });
  }
}
