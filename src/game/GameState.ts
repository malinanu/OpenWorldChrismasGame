import { EventBus } from '../core/EventBus';
import { loadSave, writeSave, type SaveData } from '../core/Save';
import { MINI_GAME_IDS, type MiniGameId, type Stars } from '../minigames/MiniGame';

type Events = {
  change: GameState;
  ornament: MiniGameId;
  discovered: MiniGameId;
  allOrnaments: void;
};

/** Progress: ornaments, stars, discovered zones. Persists after every change. */
export class GameState {
  readonly events = new EventBus<Events>();
  data: SaveData = loadSave();

  get ornamentCount() {
    return MINI_GAME_IDS.filter((id) => this.data.ornaments[id]).length;
  }

  get totalStars() {
    return MINI_GAME_IDS.reduce((n, id) => n + (this.data.bestStars[id] ?? 0), 0);
  }

  hasOrnament(id: MiniGameId) {
    return !!this.data.ornaments[id];
  }

  isDiscovered(id: MiniGameId) {
    return this.data.discovered.includes(id);
  }

  discover(id: MiniGameId) {
    if (this.isDiscovered(id)) return;
    this.data.discovered.push(id);
    this.save();
    this.events.emit('discovered', id);
  }

  /** Returns true if this result earned the ornament for the first time. */
  recordResult(id: MiniGameId, score: number, stars: Stars): boolean {
    const d = this.data;
    d.bestStars[id] = Math.max(d.bestStars[id] ?? 0, stars);
    d.bestScore[id] = Math.max(d.bestScore[id] ?? 0, score);
    const newOrnament = stars >= 1 && !d.ornaments[id];
    if (newOrnament) d.ornaments[id] = true;
    this.save();
    if (newOrnament) {
      this.events.emit('ornament', id);
      if (this.ornamentCount === MINI_GAME_IDS.length) this.events.emit('allOrnaments', undefined);
    }
    return newOrnament;
  }

  setPlayerPosition(p: [number, number, number]) {
    this.data.playerPosition = p;
    writeSave(this.data);
  }

  save() {
    writeSave(this.data);
    this.events.emit('change', this);
  }
}

export const gameState = new GameState();
