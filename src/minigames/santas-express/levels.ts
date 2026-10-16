import type { LevelDef } from './logic';

/** Hand-made levels; every one is checked solvable by `solve()` (see tools/check-levels.mjs). */
export const LEVELS: LevelDef[] = [
  {
    name: 'First Delivery',
    presents: ['red'],
    rows: [
      '.. .. .. .. ..',
      'S1 s1 T0 s1 Hr',
      '.. .. .. .. ..',
    ],
  },
  {
    name: 'Fork in the Snow',
    presents: ['red', 'blue'],
    rows: [
      '.. .. c1 s1 Hb',
      'S1 s1 C0 .. ..',
      '.. .. c0 s1 Hr',
    ],
  },
  {
    name: 'Up the Hill',
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
