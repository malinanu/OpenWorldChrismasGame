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
  stars: 0 | 1 | 2 | 3;
  /** Optional line shown on the results screen, e.g. "24 snowmen toppled". */
  summary?: string;
}

/** Everything a mini-game may need from the host. */
export interface MiniGameContext {
  readonly input: import('../core/Input').Input;
  readonly hud: import('../ui/hud').Hud;
  readonly engine: import('../core/Engine').Engine;
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
  /** Called when the player presses pause / Esc inside the game. */
  quit(): void;
}

export interface MiniGameInfo {
  id: MiniGameId;
  title: string;
  emoji: string;
  blurb: string;
  controls: string;
  /** Score needed for 1, 2 and 3 stars. */
  thresholds: [number, number, number];
  /** Factory; omitted while the game is still in development. */
  create?: (ctx: MiniGameContext) => MiniGame;
}

export function starsFor(score: number, t: [number, number, number]): 0 | 1 | 2 | 3 {
  return score >= t[2] ? 3 : score >= t[1] ? 2 : score >= t[0] ? 1 : 0;
}
