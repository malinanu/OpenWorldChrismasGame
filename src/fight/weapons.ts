/**
 * The fight zones and their weapons, as the client sees them. The server (server/src/arena.ts)
 * decides every hit; it sends its own tables in the `welcome` message and `setFightTables`
 * swaps them in. This copy is for offline practice and for before the connection is up;
 * tools/check-fight.mjs keeps it identical to the server's and to public/world/frostvale.json.
 */

export type ArenaId = 'boxing' | 'sword';

export interface ArenaDef {
  id: ArenaId;
  x: number;
  z: number;
  r: number;
}

export interface WeaponDef {
  id: string;
  arena: ArenaId;
  damage: number;
  cooldown: number;
  reach: number;
  arc: number;
  knock: number;
  guard: number;
  /** Strong weapons cost an extra token to fight with. */
  premium?: boolean;
}

export let ARENAS: ArenaDef[] = [
  { id: 'boxing', x: 40, z: 0, r: 8.4 },
  { id: 'sword', x: -40, z: 0, r: 9.5 },
];

export let WEAPONS: WeaponDef[] = [
  { id: 'feather', arena: 'boxing', damage: 6, cooldown: 0.3, reach: 1.7, arc: 70, knock: 1.5, guard: 0.6 },
  { id: 'classic', arena: 'boxing', damage: 10, cooldown: 0.5, reach: 1.8, arc: 70, knock: 2.5, guard: 0.7 },
  { id: 'heavy', arena: 'boxing', damage: 18, cooldown: 0.9, reach: 1.9, arc: 70, knock: 5, guard: 0.7, premium: true },
  { id: 'dagger', arena: 'sword', damage: 7, cooldown: 0.32, reach: 1.5, arc: 80, knock: 1.5, guard: 0.5 },
  { id: 'sword', arena: 'sword', damage: 12, cooldown: 0.55, reach: 2.3, arc: 90, knock: 3, guard: 0.8 },
  { id: 'axe', arena: 'sword', damage: 20, cooldown: 0.95, reach: 2.2, arc: 100, knock: 5, guard: 0.6, premium: true },
  { id: 'greatsword', arena: 'sword', damage: 26, cooldown: 1.25, reach: 2.6, arc: 90, knock: 7, guard: 0.6, premium: true },
  { id: 'staff', arena: 'sword', damage: 14, cooldown: 0.7, reach: 3.2, arc: 30, knock: 3, guard: 0.7 },
];

export let MAX_HP = 100;
export let KO_TIME = 3;
export let FIGHT_COST = 1;
export let PREMIUM_EXTRA = 1;
export let LIVES = 3;
/** Tokens a fight with this weapon costs. */
export const fightCost = (w: WeaponDef) => FIGHT_COST + (w.premium ? PREMIUM_EXTRA : 0);
/** Must match the server's slack in swingHits (server/src/arena.ts). */
export const BODY_RADIUS = 0.5;
const REACH_SLACK = 0.4;

/** The tables from the server's welcome message (they win over the copy above). */
export function setFightTables(
  f: { arenas?: ArenaDef[]; weapons?: WeaponDef[]; maxHp?: number; koTime?: number; cost?: number; premiumExtra?: number; lives?: number } | undefined,
) {
  if (!f) return;
  if (Array.isArray(f.arenas) && f.arenas.length) ARENAS = f.arenas;
  if (Array.isArray(f.weapons) && f.weapons.length) WEAPONS = f.weapons;
  if (typeof f.maxHp === 'number') MAX_HP = f.maxHp;
  if (typeof f.koTime === 'number') KO_TIME = f.koTime;
  if (typeof f.cost === 'number') FIGHT_COST = f.cost;
  if (typeof f.premiumExtra === 'number') PREMIUM_EXTRA = f.premiumExtra;
  if (typeof f.lives === 'number') LIVES = f.lives;
}

export const weapon = (id: string | null | undefined) => WEAPONS.find((w) => w.id === id);
export const arena = (id: string | null | undefined) => ARENAS.find((a) => a.id === id);
export const weaponsFor = (a: ArenaId) => WEAPONS.filter((w) => w.arena === a);
/** Snapshot indices are 1-based; 0 is "none". */
export const arenaAt = (i: number) => (i > 0 ? ARENAS[i - 1] : undefined);
export const weaponAt = (i: number) => (i > 0 ? WEAPONS[i - 1] : undefined);

/** How each weapon looks and moves. */
export interface WeaponLook {
  emoji: string;
  /** Model in the right hand (weapons/<id>), or gloves on both hands. */
  right?: string;
  left?: string;
  gloves?: { color: string; size: number };
  /** Swing clips, used in turn. */
  swings: string[];
  /** Fighting stance (falls back to the normal idle). */
  idle?: string;
  /** Sound when a hit lands. */
  hitSfx: 'punch' | 'slash';
}

export const LOOKS: Record<string, WeaponLook> = {
  feather: { emoji: '🥊', gloves: { color: '#4fb3ff', size: 0.85 }, swings: ['Unarmed_Melee_Attack_Punch_A', 'Unarmed_Melee_Attack_Punch_B'], idle: 'Unarmed_Idle', hitSfx: 'punch' },
  classic: { emoji: '🥊', gloves: { color: '#e23b3b', size: 1 }, swings: ['Unarmed_Melee_Attack_Punch_A', 'Unarmed_Melee_Attack_Punch_B'], idle: 'Unarmed_Idle', hitSfx: 'punch' },
  heavy: { emoji: '🥊', gloves: { color: '#f2b81f', size: 1.25 }, swings: ['Unarmed_Melee_Attack_Punch_B', 'Unarmed_Melee_Attack_Punch_A'], idle: 'Unarmed_Idle', hitSfx: 'punch' },
  dagger: { emoji: '🗡️', right: 'dagger', swings: ['1H_Melee_Attack_Stab', '1H_Melee_Attack_Slice_Diagonal'], hitSfx: 'slash' },
  sword: { emoji: '⚔️', right: 'sword_1handed', left: 'shield_round', swings: ['1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Chop'], hitSfx: 'slash' },
  axe: { emoji: '🪓', right: 'axe_1handed', swings: ['1H_Melee_Attack_Chop'], hitSfx: 'slash' },
  greatsword: { emoji: '🗡️', right: 'sword_2handed', swings: ['2H_Melee_Attack_Slice', '2H_Melee_Attack_Chop'], idle: '2H_Melee_Idle', hitSfx: 'slash' },
  staff: { emoji: '🪄', right: 'staff', swings: ['2H_Melee_Attack_Stab'], idle: '2H_Melee_Idle', hitSfx: 'punch' },
};

export const ARENA_EMOJI: Record<ArenaId, string> = { boxing: '🥊', sword: '⚔️' };

interface Pose {
  x: number;
  z: number;
  yaw: number;
}

/** Same test as the server's swingHits: reach (plus body and lag allowance) and arc around the facing. */
export function swingHits(from: Pose, to: { x: number; z: number }, w: WeaponDef): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  if (dist > w.reach + BODY_RADIUS + REACH_SLACK) return false;
  if (dist < 0.4) return true;
  const a = Math.atan2(dx, dz) - from.yaw;
  return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) <= (w.arc / 2) * (Math.PI / 180) + 0.17;
}

/** Stat pips (1–5) for the weapon picker, relative to the other weapons. */
export function pips(w: WeaponDef) {
  const all = WEAPONS;
  const scale = (v: number, lo: number, hi: number) => Math.max(1, Math.min(5, Math.round(1 + ((v - lo) / (hi - lo || 1)) * 4)));
  const range = (f: (w: WeaponDef) => number) => [Math.min(...all.map(f)), Math.max(...all.map(f))] as const;
  const [d0, d1] = range((x) => x.damage);
  const [s0, s1] = range((x) => 1 / x.cooldown);
  const [r0, r1] = range((x) => x.reach);
  const [k0, k1] = range((x) => x.knock);
  return { damage: scale(w.damage, d0, d1), speed: scale(1 / w.cooldown, s0, s1), reach: scale(w.reach, r0, r1), knock: scale(w.knock, k0, k1) };
}
