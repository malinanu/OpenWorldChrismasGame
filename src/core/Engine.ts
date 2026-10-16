import * as THREE from 'three';

export type Quality = 'low' | 'medium' | 'high';

/** Owns the renderer, the canvas size and the frame loop. */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  private readonly timer = new THREE.Timer();
  private cameras = new Set<THREE.PerspectiveCamera>();
  private running = false;

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

  setQuality(q: Quality) {
    const ratio = q === 'low' ? 1 : q === 'medium' ? Math.min(devicePixelRatio, 1.5) : Math.min(devicePixelRatio, 2);
    this.renderer.setPixelRatio(ratio);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.resize();
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
