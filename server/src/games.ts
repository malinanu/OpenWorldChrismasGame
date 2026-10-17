/** The six mini-games, with the star thresholds the client uses (src/minigames/registry.ts). */
export const GAMES = {
  'snowball-showdown': { thresholds: [10, 20, 30], maxScore: 250 },
  'gingerbread-bakery': { thresholds: [15, 35, 55], maxScore: 400 },
  'santas-express': { thresholds: [5, 10, 14], maxScore: 20 },
  'elf-workshop': { thresholds: [3, 6, 9], maxScore: 9 },
  'krampus-cellar': { thresholds: [2, 4, 6], maxScore: 6 },
  'advent-dice-race': { thresholds: [1, 2, 3], maxScore: 3 },
} as const;

export type GameId = keyof typeof GAMES;
export const GAME_IDS = Object.keys(GAMES) as GameId[];
export const isGameId = (id: string): id is GameId => id in GAMES;

/** Scores are clamped to a sane maximum, and stars are derived on the server, not trusted. */
export function scoreAndStars(id: GameId, score: number): { score: number; stars: number } {
  const g = GAMES[id];
  const s = Math.max(0, Math.min(Math.floor(score), g.maxScore));
  return { score: s, stars: g.thresholds.filter((t) => s >= t).length };
}

/** The Adventurers a player can choose (public/assets/models/characters). */
export const CHARACTERS = ['Rogue_Hooded', 'Rogue', 'Knight', 'Barbarian', 'Mage', 'Ranger'] as const;
