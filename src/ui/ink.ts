import type { MiniGameId } from '../minigames/MiniGame';

/** Each mini-game's passport ink: its stamp, and its board chip on the leaderboard. */
export const INK: Record<MiniGameId, string> = {
  'snowball-showdown': '#2f6fd6',
  'gingerbread-bakery': '#b5651d',
  'santas-express': '#c62f3a',
  'elf-workshop': '#2e8b57',
  'krampus-cellar': '#6b3fa0',
  'advent-dice-race': '#d4881a',
};
