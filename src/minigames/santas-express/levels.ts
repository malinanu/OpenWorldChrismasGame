import type { LevelDef } from './logic';
import type { LevelKey } from './strings';

/** Hand-made levels; every one is checked solvable by `solve()` (see tools/check-levels.mjs). */
/** `name` stays English (dev tools and errors); `key` is the translated name shown in game. */
export const LEVELS: (LevelDef & { key: LevelKey })[] = [
  {
    name: 'First Delivery',
    key: 'level_firstDelivery',
    presents: ['red'],
    rows: [
      '.. .. .. .. ..',
      'S1 s1 T0 s1 Hr',
      '.. .. .. .. ..',
    ],
  },
  {
    name: 'Fork in the Snow',
    key: 'level_forkInTheSnow',
    presents: ['red', 'blue'],
    rows: [
      '.. .. c1 s1 Hb',
      'S1 s1 C0 .. ..',
      '.. .. c0 s1 Hr',
    ],
  },
  {
    name: 'Up the Hill',
    key: 'level_upTheHill',
    presents: ['green', 'red', 'yellow'],
    rows: [
      '.. Hy C0 s1 Hg',
      '.. .. s0 .. ..',
      'S1 s1 C1 .. ..',
      '.. .. s0 .. ..',
      '.. .. c0 s1 Hr',
    ],
  },
  {
    name: 'The Crossing',
    key: 'level_theCrossing',
    presents: ['red', 'green', 'blue'],
    rows: [
      '.. c1 s1 C0 s1 Hb',
      '.. s0 .. s0 .. ..',
      'S1 +. s1 C0 .. ..',
      '.. s0 .. Hr .. ..',
      '.. c0 s1 s1 s1 Hg',
    ],
  },
  {
    name: 'Christmas Eve Rush',
    key: 'level_christmasEveRush',
    presents: ['blue', 'red', 'green', 'yellow'],
    rows: [
      'Hy s1 C3 Hg c1 s1 Hb',
      '.. .. s0 .. s0 .. ..',
      'S1 s1 +. s1 C1 .. ..',
      '.. .. s0 .. s0 .. ..',
      '.. .. C2 s1 C2 s1 Hr',
    ],
  },
];
