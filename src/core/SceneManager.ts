import type { Engine } from './Engine';
import type { Input } from './Input';
import type { Hud } from '../ui/hud';
import { gameState } from '../game/GameState';
import { api } from '../net/api';
import { audio } from './Audio';
import { starsFor, type MiniGame, type MiniGameContext, type MiniGameId } from '../minigames/MiniGame';
import { t } from '../i18n/ui';
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
  private confirming = false;
  busy = false;

  constructor(
    private readonly engine: Engine,
    private readonly input: Input,
    private readonly hud: Hud,
    private readonly world: Overworld,
  ) {
    hud.onQuit = () => void this.confirmQuit();
  }

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

    audio.sfx('enter');
    audio.music('none');
    await this.hud.fadeOut();
    const ctx: MiniGameContext = { input: this.input, hud: this.hud, engine: this.engine, thresholds: info.thresholds };
    let game: MiniGame;
    try {
      game = await info.create(ctx);
      await game.load();
    } catch (e) {
      console.error(e);
      this.hud.toast(t('loadFail'));
      await this.hud.fadeIn();
      this.world.resume();
      this.busy = false;
      return;
    }
    this.engine.track(game.camera);
    this.hud.setWorldHudVisible(false);
    game.start();
    audio.music(id === 'krampus-cellar' ? 'cellar' : 'game');
    this.active = game;
    this.hud.setQuitVisible(true);
    await this.hud.fadeIn();

    const result = await game.finished;
    this.hud.setQuitVisible(false);
    const stars = result.quit ? 0 : starsFor(result.score, info.thresholds);
    const newOrnament = gameState.recordResult(id, result.score, stars);
    if (!result.quit) void api.saveProgress({ [id]: { score: result.score } });
    this.input.unlockPointer();
    audio.music('none');
    if (!result.quit) audio.sfx(newOrnament ? 'ornament' : stars > 0 ? 'fanfare' : 'fail');
    await this.hud.showResults(id, result, stars, newOrnament);

    await this.hud.fadeOut();
    this.active = null;
    this.hud.setGameBar(null);
    this.engine.untrack(game.camera);
    game.dispose();
    this.hud.setWorldHudVisible(true);
    this.world.resume();
    audio.music('village');
    this.world.onReturn(id, newOrnament);
    await this.hud.fadeIn();
    this.busy = false;
  }

  /** Esc or the ✕ button: ask first, since a misplaced tap shouldn't throw a round away. */
  private async confirmQuit() {
    if (!this.active || this.confirming || this.hud.cardOpen) return;
    this.confirming = true;
    const leave = await this.hud
      .showCard(
        `<h2>${t('leaveTitle')}</h2><p>${t('leaveText')}</p>
         <div class="row"><button data-cancel class="ghost" autofocus>${t('keepPlaying')}</button><button data-ok>${t('leave')}</button></div>`,
      )
      .then(() => true, () => false);
    this.confirming = false;
    if (leave) this.active?.quit();
  }

  update(dt: number, time: number) {
    if (this.active) {
      if (this.input.justPressed('pause')) void this.confirmQuit();
      // The game is frozen while a card (quit confirm, results) is open.
      if (!this.hud.cardOpen) this.active.update(dt);
      this.engine.render(this.active.scene, this.active.camera);
    } else {
      this.world.update(dt, time);
      this.world.render(this.engine);
    }
  }
}
