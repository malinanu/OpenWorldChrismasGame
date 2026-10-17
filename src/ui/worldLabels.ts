import * as THREE from 'three';

interface Label {
  el: HTMLButtonElement;
  pos: THREE.Vector3;
  html: string;
}

/**
 * Tappable HTML labels pinned to 3D positions (station names, progress, materials).
 * Big DOM buttons are far easier to hit with a thumb than small meshes, and they
 * double as the tap targets on desktop. One layer per mini-game; call `dispose()`.
 */
export class WorldLabels {
  private readonly layer = document.createElement('div');
  private readonly labels = new Map<string, Label>();
  private readonly v = new THREE.Vector3();

  constructor(parent: HTMLElement) {
    this.layer.className = 'world-labels';
    parent.prepend(this.layer);
  }

  add(id: string, pos: THREE.Vector3, html: string, onTap?: () => void, cls = '') {
    const el = document.createElement('button');
    el.className = `wl ${cls}`;
    el.innerHTML = html;
    if (onTap) el.addEventListener('click', (e) => {
      e.stopPropagation();
      onTap();
    });
    else el.disabled = true;
    this.layer.append(el);
    this.labels.set(id, { el, pos: pos.clone(), html });
    return el;
  }

  /** Update content only when it changed (keeps taps reliable). */
  set(id: string, html: string, cls?: string) {
    const l = this.labels.get(id);
    if (!l) return;
    if (l.html !== html) {
      l.el.innerHTML = html;
      l.html = html;
    }
    if (cls !== undefined) l.el.className = `wl ${cls}`;
  }

  move(id: string, pos: THREE.Vector3) {
    this.labels.get(id)?.pos.copy(pos);
  }

  remove(id: string) {
    this.labels.get(id)?.el.remove();
    this.labels.delete(id);
  }

  setVisible(v: boolean) {
    this.layer.style.display = v ? '' : 'none';
  }

  update(camera: THREE.Camera) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.updateMatrixWorld();
    for (const l of this.labels.values()) {
      this.v.copy(l.pos).project(camera);
      const behind = this.v.z > 1;
      l.el.style.display = behind ? 'none' : '';
      l.el.style.transform = `translate(-50%, -50%) translate(${((this.v.x + 1) / 2) * w}px, ${((1 - this.v.y) / 2) * h}px)`;
    }
  }

  dispose() {
    this.layer.remove();
    this.labels.clear();
  }
}
