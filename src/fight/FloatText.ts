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

  spawn(at: THREE.Vector3, text: string, color = '#ffffff', big = false) {
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
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true }));
    const scale = (big ? 0.05 : 0.038) / (size + 24);
    sprite.scale.set(c.width * scale, c.height * scale, 1);
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
        it.sprite.material.map?.dispose();
        it.sprite.material.dispose();
        return false;
      }
      return true;
    });
  }
}
