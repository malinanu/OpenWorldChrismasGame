import type { MiniGameId } from '../minigames/MiniGame';
import type { Quality } from './Engine';
import { isTouchDevice } from './Input';

export interface SaveData {
  version: 1;
  ornaments: Partial<Record<MiniGameId, boolean>>;
  bestStars: Partial<Record<MiniGameId, number>>;
  bestScore: Partial<Record<MiniGameId, number>>;
  discovered: MiniGameId[];
  playerPosition: [number, number, number] | null;
  finaleSeen: boolean;
  settings: { volume: number; music: boolean; sfx: boolean; dayNight: boolean; quality: Quality; invertY: boolean; sensitivity: number };
}

const KEY = 'frostvale.save.v1';

export function defaultSave(): SaveData {
  return {
    version: 1,
    ornaments: {},
    bestStars: {},
    bestScore: {},
    discovered: [],
    playerPosition: null,
    finaleSeen: false,
    settings: { volume: 0.8, music: true, sfx: true, dayNight: true, quality: isTouchDevice ? 'medium' : 'high', invertY: false, sensitivity: 1 },
  };
}

/** Storage can throw (private browsing, blocked cookies) — always fall back to defaults. */
export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const data = JSON.parse(raw) as Partial<SaveData>;
    if (data.version !== 1) return defaultSave();
    const d = defaultSave();
    return { ...d, ...data, settings: { ...d.settings, ...data.settings } };
  } catch {
    return defaultSave();
  }
}

export function writeSave(data: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable — progress lives for this session only */
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
