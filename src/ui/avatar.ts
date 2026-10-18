import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { assets } from '../core/AssetLoader';

const clips = () => assets.model('animations/Frostvale_Clips.glb').then((g) => g.animations);

/** Soft studio light shared by the turntable and the portraits. */
function studio(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight('#e8f0ff', '#6a7a99', 2));
  const key = new THREE.DirectionalLight('#fff1dc', 2.2);
  key.position.set(2, 4, 3);
  scene.add(key);
}

async function loadCharacter(id: string) {
  const g = await assets.model(`characters/${id}.glb`).catch(() => assets.model('characters/Rogue_Hooded.glb'));
  return cloneSkinned(g.scene);
}

export interface AvatarStage {
  /** Swap to another Adventurer; the camera eases to fit them. */
  show(id: string): Promise<void>;
  /** Play a one-off clip (e.g. 'Cheering'), then return to idle. */
  play(clip: string): void;
  dispose(): void;
}

/**
 * A little live 3D stage on a canvas: an Adventurer on a snowy stand, idling and slowly
 * turning, with the camera fitted to their size. Used by character select and the passport.
 */
export function mountAvatarStage(canvas: HTMLCanvasElement, opts: { spin?: number; stand?: boolean } = {}): AvatarStage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Render at the canvas' real size and the screen's pixel ratio (sharp on phones).
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  renderer.setSize(w, h, false);
  const scene = new THREE.Scene();
  studio(scene);
  const camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 50);
  // Framing for the current character; the camera eases towards it.
  const aim = { y: 1.1, look: 1.0, dist: 5.2 };
  const cam = { ...aim };
  const place = () => {
    camera.position.set(0, cam.y, cam.dist);
    camera.lookAt(0, cam.look, 0);
  };
  place();
  const standOn = opts.stand !== false;
  if (standOn) {
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.95, 0.12, 40), new THREE.MeshStandardMaterial({ color: '#e9f1fb', roughness: 0.9 }));
    stand.position.y = -0.06;
    scene.add(stand);
  }
  const turntable = new THREE.Group();
  scene.add(turntable);

  /** Fit the whole figure (and the stand) in view, whichever way it's turned. */
  const frame = (model: THREE.Object3D) => {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const bottom = standOn ? Math.min(box.min.y, -0.12) : box.min.y;
    const tall = box.max.y - bottom;
    const mid = (box.max.y + bottom) / 2;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const across = Math.hypot(size.x, size.z) / camera.aspect;
    aim.dist = ((Math.max(tall, across) / 2) * 1.15) / tanHalf + Math.max(size.x, size.z) / 2;
    aim.look = mid;
    aim.y = mid + tall * 0.06;
  };

  let mixer: THREE.AnimationMixer | null = null;
  let actions = new Map<string, THREE.AnimationAction>();
  let token = 0;
  let raf = 0;
  let disposed = false;
  const clock = new THREE.Clock();
  const loop = () => {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    turntable.rotation.y += dt * (opts.spin ?? 0.6);
    mixer?.update(dt);
    const k = 1 - Math.exp(-dt * 8);
    cam.y += (aim.y - cam.y) * k;
    cam.look += (aim.look - cam.look) * k;
    cam.dist += (aim.dist - cam.dist) * k;
    place();
    renderer.render(scene, camera);
  };
  let started = false;

  return {
    async show(id) {
      const mine = ++token;
      const [model, all] = await Promise.all([loadCharacter(id), clips()]);
      if (mine !== token || disposed) return;
      turntable.clear();
      turntable.add(model);
      frame(model);
      mixer = new THREE.AnimationMixer(model);
      actions = new Map(all.map((c) => [c.name, mixer!.clipAction(c)]));
      actions.get('Idle_A')?.play();
      if (!started) {
        started = true;
        // First character: jump straight to its framing instead of easing in from afar.
        Object.assign(cam, aim);
        loop();
      }
    },
    play(name) {
      const once = actions.get(name);
      const idle = actions.get('Idle_A');
      if (!once || !mixer || once.isRunning()) return;
      once.reset().setLoop(THREE.LoopOnce, 1);
      once.clampWhenFinished = true;
      once.fadeIn(0.2).play();
      idle?.fadeOut(0.2);
      const m = mixer;
      const back = (e: { action: THREE.AnimationAction }) => {
        if (e.action !== once) return;
        m.removeEventListener('finished', back);
        idle?.reset().fadeIn(0.25).play();
        once.fadeOut(0.25);
      };
      m.addEventListener('finished', back);
    },
    dispose() {
      disposed = true;
      token++;
      cancelAnimationFrame(raf);
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

const portraits = new Map<string, Promise<string>>();

/**
 * A head-and-shoulders picture of an Adventurer (PNG data URL), rendered once and cached,
 * so the HUD badge can show it without keeping a WebGL canvas alive.
 */
export function portrait(id: string): Promise<string> {
  let p = portraits.get(id);
  if (!p) {
    p = renderPortrait(id).catch(() => '');
    portraits.set(id, p);
  }
  return p;
}

async function renderPortrait(id: string): Promise<string> {
  const [model, all] = await Promise.all([loadCharacter(id), clips()]);
  const size = 160;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  try {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    studio(scene);
    scene.add(model);
    // Idle's first frame, not the bind pose (arms out).
    const idle = all.find((c) => c.name === 'Idle_A');
    if (idle) {
      const mixer = new THREE.AnimationMixer(model);
      mixer.clipAction(idle).play();
      mixer.update(0.4);
    }
    model.rotation.y = 0.45; // three-quarter view
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const tall = box.max.y - box.min.y;
    // Head and shoulders: the top ~45% of the figure.
    const top = box.max.y + tall * 0.02;
    const bottom = box.max.y - tall * 0.47;
    const mid = (top + bottom) / 2;
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
    const dist = ((top - bottom) / 2) / Math.tan(THREE.MathUtils.degToRad(14)) + 0.4;
    camera.position.set(0, mid + 0.08, dist);
    camera.lookAt(0, mid, 0);
    renderer.render(scene, camera);
    return canvas.toDataURL('image/png');
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
