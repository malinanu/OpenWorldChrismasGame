import { Engine } from './core/Engine';
import { Input } from './core/Input';
import { initPhysics } from './core/Physics';
import { assets } from './core/AssetLoader';
import { SceneManager } from './core/SceneManager';
import { gameState } from './game/GameState';
import { Overworld } from './game/Overworld';
import { Hud } from './ui/hud';

async function boot() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hud = new Hud(document.getElementById('ui')!);
  const engine = new Engine(canvas);
  engine.setQuality(gameState.data.settings.quality);
  const input = new Input(canvas);

  assets.onProgress = (loaded, total) => hud.setLoading(loaded / Math.max(total, 1));
  const label = hud.root.querySelector('.loading p');
  await initPhysics();

  const overworld = new Overworld(engine, input, hud);
  await overworld.load((text) => label && (label.textContent = text));
  const scenes = new SceneManager(engine, input, hud, overworld);
  overworld.sceneManager = scenes;

  // Render one frame behind the title card so the village is visible.
  engine.start((dt, time) => {
    input.beginFrame();
    scenes.update(dt, time);
    input.endFrame();
  });
  hud.hideLoading();
  await hud.showTitle();
  overworld.resume();

  // Browsers only allow pointer lock from a user gesture.
  canvas.addEventListener('click', () => {
    if (!scenes.inMiniGame && !hud.cardOpen && !hud.mapOpen) input.lockPointer();
  });

  // Debug handle for the console / automated tests.
  (window as unknown as { frostvale: unknown }).frostvale = { engine, overworld, scenes, gameState, hud };
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:auto 0 0 0;color:#fff;background:#a00;padding:8px;margin:0">${String(e?.stack ?? e)}</pre>`);
});
