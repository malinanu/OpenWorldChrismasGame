import type * as THREE from 'three';

export type MiniGameId =
  | 'snowball-showdown'
  | 'gingerbread-bakery'
  | 'santas-express'
  | 'elf-workshop'
  | 'krampus-cellar'
  | 'advent-dice-race';

export const MINI_GAME_IDS: MiniGameId[] = [
  'snowball-showdown',
  'gingerbread-bakery',
  'santas-express',
  'elf-workshop',
  'krampus-cellar',
  'advent-dice-race',
];

export interface MiniGameResult {
  score: number;
  /** True when the player pressed Esc to leave; quitting never earns stars. */
  quit?: boolean;
  /** Optional line shown on the results screen, e.g. "24 snowmen toppled". */
  summary?: string;
}

export type Stars = 0 | 1 | 2 | 3;

/** Everything a mini-game may need from the host. */
export interface MiniGameContext {
  readonly input: import('../core/Input').Input;
  readonly hud: import('../ui/hud').Hud;
  readonly engine: import('../core/Engine').Engine;
  /** Score needed for 1, 2 and 3 stars (from the registry). */
  readonly thresholds: [number, number, number];
}

export interface MiniGame {
  readonly id: MiniGameId;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Load assets, build the scene. */
  load(): Promise<void>;
  /** Reset state and begin a round. */
  start(): void;
  update(dt: number): void;
  /** Free GPU memory and physics bodies when leaving. */
  dispose(): void;
  /** Resolves when the round ends (or the player quits, with 0 stars). */
  readonly finished: Promise<MiniGameResult>;
  /** Called when the player presses Esc inside the game; resolve `finished` with `quit: true`. */
  quit(): void;
}

export interface MiniGameInfo {
  id: MiniGameId;
  title: string;
  emoji: string;
  /** One friendly sentence: what's going on. */
  blurb: string;
  /** Numbered steps on the intro card; a [touch, desktop] pair when the wording differs. */
  howTo: (string | [string, string])[];
  /** Score needed for 1, 2 and 3 stars. */
  thresholds: [number, number, number];
  /** Lazy factory (the game's code is fetched on first play); omitted while in development. */
  create?: (ctx: MiniGameContext) => Promise<MiniGame>;
}

export function starsFor(score: number, t: [number, number, number]): Stars {
  return score >= t[2] ? 3 : score >= t[1] ? 2 : score >= t[0] ? 1 : 0;
}
