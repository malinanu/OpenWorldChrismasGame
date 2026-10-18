import { t } from '../i18n/ui';

const title = (stars: number, key: Parameters<typeof t>[0], icon: string) => ({
  stars,
  icon,
  get name() {
    return t(key);
  },
});

/** Festive ranks earned by total stars (0–18), shown on the profile badge and the passport. */
export const TITLES = [
  title(0, 'title_newcomer', '❄️'),
  title(3, 'title_apprentice', '☕'),
  title(6, 'title_keeper', '🏮'),
  title(10, 'title_captain', '🛷'),
  title(14, 'title_legend', '🌟'),
  title(18, 'title_spirit', '🎄'),
];

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
