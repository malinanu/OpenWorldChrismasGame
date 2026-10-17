import { assets } from './core/AssetLoader';
import { maybeShowStats } from './core/DebugStats';
import { Engine } from './core/Engine';
import { Input, isTouchDevice } from './core/Input';
import { initPhysics } from './core/Physics';
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

  assets.onProgress = (loaded, total) => hud.setLoading(loaded / Math.max(total, 1));
  await initPhysics();

  const overworld = new Overworld(engine, input, hud);
  overworld.touch = touch;
  await overworld.load((text) => hud.setLoadingText(text));
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
  await hud.showTitle();
  // Still inside the tap's user activation: phones get the whole screen where the browser allows it.
  if (isTouchDevice && canFullscreen()) void setFullscreen(true);
  overworld.resume();

  // Desktop mouse-look needs pointer lock, which browsers only grant from a click.
  canvas.addEventListener('click', () => {
    if (!scenes.inMiniGame && !hud.cardOpen && !hud.mapOpen) input.lockPointer();
  });

  // Debug handle for the console / automated tests.
  (window as unknown as { frostvale: unknown }).frostvale = { engine, overworld, scenes, gameState, hud, input };
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:auto 0 0 0;color:#fff;background:#a00;padding:8px;margin:0;white-space:pre-wrap">${String(e?.stack ?? e)}</pre>`);
});
