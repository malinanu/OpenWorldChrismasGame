/** Festive ranks earned by total stars (0–18), shown on the profile badge and the passport. */
export const TITLES = [
  { stars: 0, name: 'Snowflake Newcomer', icon: '❄️' },
  { stars: 3, name: 'Cocoa Apprentice', icon: '☕' },
  { stars: 6, name: 'Lantern Keeper', icon: '🏮' },
  { stars: 10, name: 'Sleigh Captain', icon: '🛷' },
  { stars: 14, name: 'Frost Legend', icon: '🌟' },
  { stars: 18, name: 'Spirit of Frostvale', icon: '🎄' },
] as const;

export type Title = (typeof TITLES)[number];

/** The title for a star total, the next one (if any) and progress towards it (0–1). */
export function titleFor(stars: number): { title: Title; next: Title | null; progress: number } {
  let i = 0;
  while (i + 1 < TITLES.length && stars >= TITLES[i + 1].stars) i++;
  const title = TITLES[i];
  const next = TITLES[i + 1] ?? null;
  const progress = next ? (stars - title.stars) / (next.stars - title.stars) : 1;
  return { title, next, progress };
}
