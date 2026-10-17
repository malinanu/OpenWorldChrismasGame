import * as THREE from 'three';

export type Quality = 'low' | 'medium' | 'high';

/** Per-quality knobs. Phones default to 'medium', desktops to 'high' (see Save.ts). */
export const QUALITY = {
  low: { maxPixelRatio: 1, shadows: 0, snow: 2500, forest: 0.5 },
  medium: { maxPixelRatio: 1.5, shadows: 1024, snow: 3500, forest: 0.75 },
  high: { maxPixelRatio: 2, shadows: 2048, snow: 7000, forest: 1 },
} as const;

/** Owns the renderer, the canvas size and the frame loop. */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  private readonly timer = new THREE.Timer();
  private cameras = new Set<THREE.PerspectiveCamera>();
  private running = false;
  quality: Quality = 'medium';

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.setQuality('medium');
    window.addEventListener('resize', () => this.resize());
    // Stops time advancing while the tab is hidden, so we don't get a giant dt on return.
    this.timer.connect(document);
    this.resize();
  }

  /** Call before building scenes: shadow on/off is baked into materials when they compile. */
  setQuality(q: Quality) {
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY[q].maxPixelRatio));
    this.renderer.shadowMap.enabled = QUALITY[q].shadows > 0;
    this.resize();
  }

  get settings() {
    return QUALITY[this.quality];
  }

  /** Cameras registered here get their aspect ratio kept in sync with the canvas. */
  track(camera: THREE.PerspectiveCamera) {
    this.cameras.add(camera);
    this.resizeCamera(camera);
  }

  untrack(camera: THREE.PerspectiveCamera) {
    this.cameras.delete(camera);
  }

  private resizeCamera(camera: THREE.PerspectiveCamera) {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }

  private resize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.cameras.forEach((c) => this.resizeCamera(c));
  }

  start(update: (dt: number, time: number) => void) {
    if (this.running) return;
    this.running = true;
    this.renderer.setAnimationLoop((timestamp) => {
      this.timer.update(timestamp);
      if (document.hidden) return;
      const dt = Math.min(this.timer.getDelta(), 1 / 20);
      update(dt, this.timer.getElapsed());
    });
  }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer.render(scene, camera);
  }
}
