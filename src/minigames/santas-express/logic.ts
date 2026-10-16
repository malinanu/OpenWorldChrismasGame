/**
 * Pure puzzle logic for Santa's Express (no three.js), so it can be unit-checked.
 *
 * Grid: x to the right, y downwards. Directions: 0 = N (-y), 1 = E (+x), 2 = S (+y), 3 = W (-x).
 * Level rows are space-separated 2-char tokens:
 *   ..  empty            S<d> station, train leaves heading d
 *   s<r> fixed straight  T<r> rotatable straight   (r0 = N–S, r1 = E–W)
 *   c<r> fixed curve     C<r> rotatable curve      (r0 = N–E, r1 = E–S, r2 = S–W, r3 = W–N)
 *   +.  crossing (N–S and E–W pass straight through)
 *   H<colour> house: r red, b blue, g green, y yellow, w white
 */

export type Dir = 0 | 1 | 2 | 3;
export type Colour = 'red' | 'blue' | 'green' | 'yellow' | 'white';
export type TileKind = 'straight' | 'curve' | 'cross' | 'station' | 'house';

export interface Tile {
  x: number;
  y: number;
  kind: TileKind;
  rot: number;
  rotatable: boolean;
  colour?: Colour;
}

export interface LevelDef {
  name: string;
  rows: string[];
  presents: Colour[];
}

export interface Level {
  name: string;
  w: number;
  h: number;
  tiles: Tile[];
  station: Tile;
  stationDir: Dir;
  presents: Colour[];
}

export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];
const COLOURS: Record<string, Colour> = { r: 'red', b: 'blue', g: 'green', y: 'yellow', w: 'white' };

export function parseLevel(def: LevelDef): Level {
  const tiles: Tile[] = [];
  let station: Tile | undefined;
  let stationDir: Dir = 1;
  const grid = def.rows.map((r) => r.trim().split(/\s+/));
  grid.forEach((row, y) =>
    row.forEach((tok, x) => {
      const [a, b] = tok;
      if (tok === '..') return;
      if (a === 'S') {
        stationDir = Number(b) as Dir;
        station = { x, y, kind: 'station', rot: stationDir % 2 === 0 ? 0 : 1, rotatable: false };
        tiles.push(station);
      } else if (a === 's' || a === 'T') tiles.push({ x, y, kind: 'straight', rot: Number(b), rotatable: a === 'T' });
      else if (a === 'c' || a === 'C') tiles.push({ x, y, kind: 'curve', rot: Number(b), rotatable: a === 'C' });
      else if (a === '+') tiles.push({ x, y, kind: 'cross', rot: 0, rotatable: false });
      else if (a === 'H') tiles.push({ x, y, kind: 'house', rot: 0, rotatable: false, colour: COLOURS[b] });
      else throw new Error(`Bad token "${tok}" in ${def.name}`);
    }),
  );
  if (!station) throw new Error(`No station in ${def.name}`);
  return { name: def.name, w: Math.max(...grid.map((r) => r.length)), h: grid.length, tiles, station, stationDir, presents: def.presents };
}

/** The two directions a straight/curve/station connects. */
export function connections(t: Tile): [Dir, Dir] | null {
  if (t.kind === 'straight' || t.kind === 'station') return t.rot % 2 === 0 ? [0, 2] : [1, 3];
  if (t.kind === 'curve') {
    const r = t.rot % 4;
    return [r as Dir, ((r + 1) % 4) as Dir];
  }
  return null;
}

/** Given the side the train enters from, which side it leaves by (or null = derail). */
export function exitFor(t: Tile, entry: Dir): Dir | null {
  if (t.kind === 'cross') return ((entry + 2) % 4) as Dir;
  const c = connections(t);
  if (!c) return null;
  if (c[0] === entry) return c[1];
  if (c[1] === entry) return c[0];
  return null;
}

export interface Step {
  x: number;
  y: number;
  /** Side entered from (null for the station start). */
  entry: Dir | null;
  exit: Dir;
}

export type Outcome =
  | { type: 'house'; colour: Colour; tile: Tile }
  | { type: 'derail' }
  | { type: 'loop' };

export interface Route {
  steps: Step[];
  outcome: Outcome;
}

export function tileAt(level: Level, x: number, y: number): Tile | undefined {
  return level.tiles.find((t) => t.x === x && t.y === y);
}

/** Follow the track from the station until a house, a dead end or a loop. */
export function traceRoute(level: Level, rots: Map<Tile, number> = new Map()): Route {
  const rotOf = (t: Tile) => rots.get(t) ?? t.rot;
  const steps: Step[] = [{ x: level.station.x, y: level.station.y, entry: null, exit: level.stationDir }];
  const seen = new Set<string>();
  let { x, y } = level.station;
  let dir: Dir = level.stationDir;
  for (let guard = 0; guard < 500; guard++) {
    x += DX[dir];
    y += DY[dir];
    const entry = ((dir + 2) % 4) as Dir;
    const t = tileAt(level, x, y);
    if (!t || t.kind === 'station') return { steps, outcome: { type: 'derail' } };
    if (t.kind === 'house') return { steps, outcome: { type: 'house', colour: t.colour!, tile: t } };
    const exit = exitFor({ ...t, rot: rotOf(t) }, entry);
    if (exit === null) return { steps, outcome: { type: 'derail' } };
    const key = `${x},${y},${entry}`;
    if (seen.has(key)) return { steps, outcome: { type: 'loop' } };
    seen.add(key);
    steps.push({ x, y, entry, exit });
    dir = exit;
  }
  return { steps, outcome: { type: 'loop' } };
}

/** Number of distinct orientations a rotatable tile has. */
export function rotStates(t: Tile) {
  return t.kind === 'curve' ? 4 : 2;
}

/** Clicks needed to go from rotation a to b (rotation only goes one way). */
export function clicksBetween(t: Tile, a: number, b: number) {
  const n = rotStates(t);
  return (((b - a) % n) + n) % n;
}

/**
 * Fewest clicks to deliver every present in order, starting from the level's
 * initial rotations. Returns null if some delivery is impossible.
 */
export function solve(level: Level): number | null {
  const movable = level.tiles.filter((t) => t.rotatable);
  let current = new Map(movable.map((t) => [t, t.rot % rotStates(t)]));
  let total = 0;
  for (const colour of level.presents) {
    let best: { cost: number; rots: Map<Tile, number> } | null = null;
    const combos = movable.reduce((n, t) => n * rotStates(t), 1);
    for (let i = 0; i < combos; i++) {
      let k = i;
      const rots = new Map<Tile, number>();
      let cost = 0;
      for (const t of movable) {
        const r = k % rotStates(t);
        k = Math.floor(k / rotStates(t));
        rots.set(t, r);
        cost += clicksBetween(t, current.get(t)!, r);
      }
      const out = traceRoute(level, rots).outcome;
      if (out.type === 'house' && out.colour === colour && (!best || cost < best.cost)) best = { cost, rots };
    }
    if (!best) return null;
    total += best.cost;
    current = best.rots;
  }
  return total;
}
