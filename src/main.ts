import { assets } from './core/AssetLoader';
import { audio } from './core/Audio';
import { maybeShowStats } from './core/DebugStats';
import { Engine } from './core/Engine';
import { Input, isTouchDevice } from './core/Input';
import { SceneManager } from './core/SceneManager';
import { gameState } from './game/GameState';
import { Overworld } from './game/Overworld';
import { canFullscreen, Hud, setFullscreen } from './ui/hud';
import { snowUniforms } from './shaders/snow';
import { TouchControls } from './ui/touch';

// iOS Safari ignores user-scalable=no; stop pinch-zoom and double-tap zoom from moving the page.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
// Long-press on a phone would open the context menu over the game.
document.addEventListener('contextmenu', (e) => e.preventDefault());

async function boot() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui')!;
  const hud = new Hud(uiRoot);
  const engine = new Engine(canvas);
  engine.setQuality(gameState.data.settings.quality);
  const input = new Input(canvas);
  const touch = new TouchControls(uiRoot, input);
  input.onTouchDetected = () => hud.refreshDeviceMode();
  const { music, sfx, volume } = gameState.data.settings;
  audio.configure({ music, sfx, volume });
  // Browsers only start audio from a user gesture; any tap or key press will do.
  const unlock = () => audio.unlock();
  for (const ev of ['pointerdown', 'keydown', 'touchend']) document.addEventListener(ev, unlock, { capture: true, passive: true });
  // A soft click for every HUD button.
  uiRoot.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button')) audio.sfx('click');
  });

  assets.onProgress = (loaded, total) => hud.setLoading(loaded / Math.max(total, 1));
  const overworld = new Overworld(engine, input, hud);
  overworld.touch = touch;
  const loaded = overworld.load((text) => hud.setLoadingText(text));
  // The title card goes up straight away; its Start button fills up while the village loads.
  const title = hud.showTitle(loaded);
  await loaded;
  const scenes = new SceneManager(engine, input, hud, overworld);
  overworld.sceneManager = scenes;

  const tickStats = await maybeShowStats(engine.renderer);
  // The village renders behind the title card.
  engine.start((dt, time) => {
    input.beginFrame();
    snowUniforms.uSnowTime.value = time; // wind for every swaying tree, world or mini-game
    scenes.update(dt, time);
    input.endFrame();
    tickStats?.();
  });
  hud.hideLoading();
  await title;
  audio.unlock();
  audio.music('village');
  // Still inside the tap's user activation: phones get the whole screen where the browser allows it.
  if (isTouchDevice && canFullscreen()) void setFullscreen(true);
  overworld.resume();

  // Desktop mouse-look needs pointer lock, which browsers only grant from a click.
  canvas.addEventListener('click', () => {
    if (!scenes.inMiniGame && !hud.cardOpen && !hud.mapOpen) input.lockPointer();
  });

  // Debug handle for the console / automated tests.
  (window as unknown as { frostvale: unknown }).frostvale = { engine, overworld, scenes, gameState, hud, input, audio };
}

// Repeat visits load from the phone's cache (production builds only; dev reloads must stay fresh).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:auto 0 0 0;color:#fff;background:#a00;padding:8px;margin:0;white-space:pre-wrap">${String(e?.stack ?? e)}</pre>`);
});
