import * as THREE from 'three';

export type Quality = 'low' | 'medium' | 'high';

/** Per-quality knobs. Phones default to 'medium', desktops to 'high' (see Save.ts). */
export const QUALITY = {
  low: { maxPixelRatio: 1, shadows: 0, snow: 2500, forest: 0.5, lights: 0 },
  medium: { maxPixelRatio: 1.5, shadows: 1024, snow: 3500, forest: 0.75, lights: 2 },
  high: { maxPixelRatio: 1.75, shadows: 2048, snow: 7000, forest: 1, lights: 4 },
} as const;

/** Frame-time targets for automatic quality (seconds). */
const SLOW_FRAME = 1 / 45;
const FAST_FRAME = 1 / 80;

/** Owns the renderer, the canvas size and the frame loop. */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  private readonly timer = new THREE.Timer();
  private cameras = new Set<THREE.PerspectiveCamera>();
  private running = false;
  quality: Quality = 'medium';
  /**
   * Automatic quality: when frames are slow, render at a lower resolution (and, as a last resort,
   * without the sun's shadows); when they're fast again, sharpen back up. Never back to a
   * resolution that already proved too slow, so it settles instead of flickering.
   */
  auto = true;
  /** Shadows were switched off because the device couldn't keep up (remember it for next time). */
  onTooSlow?: () => void;
  private ratio = 1;
  private ratioCeiling = Infinity;
  private avg = 1 / 60;
  private slowFor = 0;
  private fastFor = 0;
  private warmUp = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    // Multisampling is the costliest thing on high-density screens, which are sharp enough without it.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: devicePixelRatio <= 1.5, powerPreference: 'high-performance' });
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
    this.ratio = this.maxRatio;
    this.ratioCeiling = Infinity;
    this.renderer.setPixelRatio(this.ratio);
    this.renderer.shadowMap.enabled = QUALITY[q].shadows > 0;
    this.resize();
  }

  private get maxRatio() {
    return Math.min(devicePixelRatio, QUALITY[this.quality].maxPixelRatio);
  }

  /** The current render resolution relative to CSS pixels (for the stats overlay and tests). */
  get pixelRatio() {
    return this.ratio;
  }

  /** Called every frame with the real frame time. */
  private adapt(dt: number) {
    if (!this.auto) return;
    // Skip the first seconds (shader compiles, loading) and real stalls (tab switch, a long GC);
    // a very slow device's long frames still count, capped so one doesn't swamp the average.
    this.warmUp += dt;
    if (this.warmUp < 4 || dt > 1) return;
    this.avg += (Math.min(dt, 0.25) - this.avg) * 0.1;
    if (this.avg > SLOW_FRAME) {
      this.slowFor += dt;
      this.fastFor = 0;
    } else if (this.avg < FAST_FRAME) {
      this.fastFor += dt;
      this.slowFor = 0;
    } else {
      this.slowFor = Math.max(0, this.slowFor - dt);
      this.fastFor = 0;
    }
    const floor = Math.max(this.maxRatio * 0.6, Math.min(this.maxRatio, 0.75));
    if (this.slowFor > 2) {
      this.slowFor = 0;
      this.avg = 1 / 60;
      if (this.ratio > floor + 0.01) {
        this.ratioCeiling = this.ratio;
        this.setRatio(Math.max(floor, this.ratio * 0.85));
      } else if (this.renderer.shadowMap.enabled) {
        this.renderer.shadowMap.enabled = false;
        this.shadowsChanged?.();
        this.onTooSlow?.();
      }
    } else if (this.fastFor > 8) {
      this.fastFor = 0;
      const up = Math.min(this.maxRatio, this.ratio / 0.85, this.ratioCeiling * 0.98);
      if (up > this.ratio + 0.01) this.setRatio(up);
    }
  }

  /** Start measuring afresh (after loading, a menu or a mini-game: their first frames stutter). */
  settle() {
    this.warmUp = 0;
    this.slowFor = 0;
    this.fastFor = 0;
    this.avg = 1 / 60;
  }

  /** Materials have to recompile when shadows are switched off; the overworld does that. */
  shadowsChanged?: () => void;

  private setRatio(r: number) {
    this.ratio = r;
    this.renderer.setPixelRatio(r);
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
      const raw = this.timer.getDelta();
      this.adapt(raw);
      update(Math.min(raw, 1 / 20), this.timer.getElapsed());
    });
  }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer.render(scene, camera);
  }
}
