import type { Engine } from './Engine';
import type { Input } from './Input';
import type { Hud } from '../ui/hud';
import { gameState } from '../game/GameState';
import type { MiniGame, MiniGameContext, MiniGameId } from '../minigames/MiniGame';
import { MINI_GAMES } from '../minigames/registry';

export interface Overworld {
  update(dt: number, time: number): void;
  render(engine: Engine): void;
  pause(): void;
  resume(): void;
  /** Called after results; lets the world celebrate a new ornament. */
  onReturn(id: MiniGameId, newOrnament: boolean): void;
}

/** Switches rendering + updates between the overworld and a running mini-game. */
export class SceneManager {
  private active: MiniGame | null = null;
  busy = false;

  constructor(
    private readonly engine: Engine,
    private readonly input: Input,
    private readonly hud: Hud,
    private readonly world: Overworld,
  ) {}

  get inMiniGame() {
    return this.active !== null;
  }

  async enter(id: MiniGameId) {
    if (this.busy) return;
    this.busy = true;
    const info = MINI_GAMES[id];
    this.world.pause();
    this.input.unlockPointer();
    const play = await this.hud.showIntro(id);
    if (!play || !info.create) {
      this.world.resume();
      this.busy = false;
      return;
    }

    await this.hud.fadeOut();
    const ctx: MiniGameContext = { input: this.input, hud: this.hud, engine: this.engine };
    const game = info.create(ctx);
    try {
      await game.load();
    } catch (e) {
      console.error(e);
      this.hud.toast('Could not load that game 😢');
      await this.hud.fadeIn();
      this.world.resume();
      this.busy = false;
      return;
    }
    this.engine.track(game.camera);
    this.hud.setWorldHudVisible(false);
    game.start();
    this.active = game;
    await this.hud.fadeIn();

    const result = await game.finished;
    const newOrnament = gameState.recordResult(id, result);
    this.input.unlockPointer();
    await this.hud.showResults(id, result, newOrnament);

    await this.hud.fadeOut();
    this.active = null;
    this.hud.setGameBar(null);
    this.engine.untrack(game.camera);
    game.dispose();
    this.hud.setWorldHudVisible(true);
    this.world.resume();
    this.world.onReturn(id, newOrnament);
    await this.hud.fadeIn();
    this.busy = false;
  }

  update(dt: number, time: number) {
    if (this.active) {
      if (this.input.justPressed('pause') && !this.hud.cardOpen) this.active.quit();
      this.active.update(dt);
      this.engine.render(this.active.scene, this.active.camera);
    } else {
      this.world.update(dt, time);
      this.world.render(this.engine);
    }
  }
}
