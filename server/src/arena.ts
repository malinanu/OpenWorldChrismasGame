/**
 * The two fight zones (a boxing ring and a sword arena) and the weapons used in them.
 * The server decides every hit with these numbers; the game client gets the same tables in the
 * `welcome` message (and keeps a copy for offline practice: tools/check-fight.mjs keeps the
 * copies in step, and with public/world/frostvale.json where the arenas are built).
 */

export const ARENA_IDS = ['boxing', 'sword'] as const;
export type ArenaId = (typeof ARENA_IDS)[number];

export interface Arena {
  id: ArenaId;
  /** Centre on the ground (metres). */
  x: number;
  z: number;
  /** Everyone inside this radius is in the arena. */
  r: number;
}

export const ARENAS: readonly Arena[] = [
  { id: 'boxing', x: 40, z: 0, r: 8.4 },
  { id: 'sword', x: -40, z: 0, r: 9.5 },
];

export interface Weapon {
  id: string;
  arena: ArenaId;
  /** Hit points taken off. Everyone has MAX_HP. */
  damage: number;
  /** Seconds between swings. */
  cooldown: number;
  /** How far the weapon reaches in front of the fighter, in metres. */
  reach: number;
  /** Width of the swing in degrees, centred on where the fighter faces. */
  arc: number;
  /** Shove speed (m/s) the target gets; decays in about 0.3 s. */
  knock: number;
  /** Share of the damage a guarding fighter holding this weapon blocks (0–1). */
  guard: number;
}

/**
 * Roughly equal damage per second, different trade-offs: fast and light, balanced, or slow and
 * heavy; wide swings or long, narrow reach.
 */
export const WEAPONS: readonly Weapon[] = [
  { id: 'feather', arena: 'boxing', damage: 6, cooldown: 0.3, reach: 1.7, arc: 70, knock: 1.5, guard: 0.6 },
  { id: 'classic', arena: 'boxing', damage: 10, cooldown: 0.5, reach: 1.8, arc: 70, knock: 2.5, guard: 0.7 },
  { id: 'heavy', arena: 'boxing', damage: 18, cooldown: 0.9, reach: 1.9, arc: 70, knock: 5, guard: 0.7 },
  { id: 'dagger', arena: 'sword', damage: 7, cooldown: 0.32, reach: 1.5, arc: 80, knock: 1.5, guard: 0.5 },
  { id: 'sword', arena: 'sword', damage: 12, cooldown: 0.55, reach: 2.3, arc: 90, knock: 3, guard: 0.8 },
  { id: 'axe', arena: 'sword', damage: 20, cooldown: 0.95, reach: 2.2, arc: 100, knock: 5, guard: 0.6 },
  { id: 'greatsword', arena: 'sword', damage: 26, cooldown: 1.25, reach: 2.6, arc: 90, knock: 7, guard: 0.6 },
  { id: 'staff', arena: 'sword', damage: 14, cooldown: 0.7, reach: 3.2, arc: 30, knock: 3, guard: 0.7 },
];

export const MAX_HP = 100;
/** Seconds a knocked-out fighter lies down before getting back up. */
export const KO_TIME = 3;
/** Seconds of protection after getting back up. */
export const SHIELD_TIME = 2;
/** Seconds without being hit before health starts coming back, and how fast (HP per second). */
export const REGEN_DELAY = 5;
export const REGEN_RATE = 3;
/** A fighter this far outside the arena's edge has left it. */
export const LEAVE_MARGIN = 1.5;
/** A fighter who has stopped sending their position for this long has left it. */
export const AFK_SECONDS = 6;
/** The server allows a little more reach than shown, for lag and the 10 Hz position updates. */
export const REACH_SLACK = 0.4;
/** A fighter's body is this thick (matches the snowball hit capsule). */
export const BODY_RADIUS = 0.5;

const byId = new Map(WEAPONS.map((w) => [w.id, w]));
export const getWeapon = (id: unknown): Weapon | undefined => (typeof id === 'string' ? byId.get(id) : undefined);
export const getArena = (id: unknown): Arena | undefined => ARENAS.find((a) => a.id === id);
/** 1-based so 0 can mean "none" in snapshots. */
export const arenaIndex = (id: ArenaId | null) => (id ? ARENA_IDS.indexOf(id) + 1 : 0);
export const weaponIndex = (w: Weapon | null) => (w ? WEAPONS.indexOf(w) + 1 : 0);

/** Where a knocked-out fighter gets back up: four spots near the edge. */
export function spawnPoints(a: Arena): [number, number][] {
  return [45, 135, 225, 315].map((deg) => {
    const t = (deg * Math.PI) / 180;
    return [a.x + Math.sin(t) * a.r * 0.7, a.z + Math.cos(t) * a.r * 0.7];
  });
}

export const insideArena = (a: Arena, x: number, z: number, margin = 0) => Math.hypot(x - a.x, z - a.z) <= a.r + margin;

interface Pose {
  x: number;
  z: number;
  yaw: number;
}

/**
 * Whether a swing from `from` lands on `to`: within the weapon's reach (plus body and lag
 * allowance) and inside its arc around where the attacker faces. Facing is (sin yaw, cos yaw).
 */
export function swingHits(from: Pose, to: { x: number; z: number }, w: Weapon): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  if (dist > w.reach + BODY_RADIUS + REACH_SLACK) return false;
  if (dist < 0.4) return true; // standing on top of each other
  const diff = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - from.yaw), Math.cos(Math.atan2(dx, dz) - from.yaw)));
  // A little extra arc: the target is a body, not a point, and the aim lags by up to 100 ms.
  return diff <= (w.arc / 2) * (Math.PI / 180) + 0.17;
}

/** Whether `defender` faces `attacker` closely enough for a guard to count (front 200°). */
export function facing(defender: Pose, attacker: { x: number; z: number }): boolean {
  const a = Math.atan2(attacker.x - defender.x, attacker.z - defender.z);
  const diff = Math.abs(Math.atan2(Math.sin(a - defender.yaw), Math.cos(a - defender.yaw)));
  return diff <= (100 * Math.PI) / 180;
}

/** The tables sent to the client in the welcome message. */
export const fightTables = () => ({ arenas: ARENAS, weapons: WEAPONS, maxHp: MAX_HP, koTime: KO_TIME });
