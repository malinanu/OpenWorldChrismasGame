import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { ARENAS, KO_TIME, MAX_HP, WEAPONS, facing, getWeapon, spawnPoints, swingHits } from '../src/arena.ts';
import { connectPlayer, startServer } from './helpers.ts';

let s: Awaited<ReturnType<typeof startServer>>;
before(async () => (s = await startServer()));
after(async () => s.stop());

const player = (name: string, characterId = 'Knight') => connectPlayer(s, name, characterId);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BOX = ARENAS.find((a) => a.id === 'boxing')!;
const SWORD = ARENAS.find((a) => a.id === 'sword')!;
const w = (id: string) => getWeapon(id)!;

type P = Awaited<ReturnType<typeof player>>;
/** Put a player at a spot facing `yaw` (the server's facing is (sin yaw, cos yaw)). */
const at = async (p: P, x: number, z: number, yaw = 0, extra: object = {}) => {
  p.send({ t: 'state', x, y: 0, z, yaw, a: 'idle', ...extra });
  await wait(60);
};

test('the swing maths: reach, arc and guard direction', () => {
  const sword = w('sword'); // reach 2.3, arc 90°
  assert.ok(swingHits({ x: 0, z: 0, yaw: 0 }, { x: 0, z: 2 }, sword), 'straight ahead, inside reach');
  assert.ok(!swingHits({ x: 0, z: 0, yaw: 0 }, { x: 0, z: 4.5 }, sword), 'out of reach');
  assert.ok(!swingHits({ x: 0, z: 0, yaw: 0 }, { x: 0, z: -2 }, sword), 'behind the swinger');
  assert.ok(swingHits({ x: 0, z: 0, yaw: Math.PI / 2 }, { x: 2, z: 0 }, sword), 'facing +x hits +x');
  assert.ok(!swingHits({ x: 0, z: 0, yaw: 0 }, { x: 2, z: 0.2 }, sword), 'a quarter turn away is outside a 90° swing');
  const staff = w('staff'); // long and narrow
  assert.ok(swingHits({ x: 0, z: 0, yaw: 0 }, { x: 0, z: 3.5 }, staff));
  assert.ok(!swingHits({ x: 0, z: 0, yaw: 0 }, { x: 1.8, z: 2 }, staff), 'too far to the side for a narrow swing');
  assert.ok(facing({ x: 0, z: 0, yaw: 0 }, { x: 0, z: 2 }), 'guard faces the attacker');
  assert.ok(!facing({ x: 0, z: 0, yaw: 0 }, { x: 0, z: -2 }), 'a guard does not cover the back');
  // The weapon table is fair: every weapon belongs to a real arena and roughly the same damage per second.
  for (const weapon of WEAPONS) {
    assert.ok(ARENAS.some((a) => a.id === weapon.arena));
    const dps = weapon.damage / weapon.cooldown;
    assert.ok(dps > 18 && dps < 24, `${weapon.id} damage per second ${dps.toFixed(1)}`);
  }
  for (const a of ARENAS) for (const [x, z] of spawnPoints(a)) assert.ok(Math.hypot(x - a.x, z - a.z) < a.r, 'spawn points are inside the arena');
});

test('joining: only inside an arena, only with that arena\'s weapon', async () => {
  const a = await player('ann');
  const welcome = await a.wait((m) => m.t === 'welcome');
  assert.equal(welcome.fight.weapons.length, WEAPONS.length, 'the client gets the weapon table');
  assert.equal(welcome.fight.arenas.length, ARENAS.length);

  await at(a, BOX.x + BOX.r + 3, BOX.z); // just outside the ropes
  a.send({ t: 'arena', a: 'boxing', w: 'classic' });
  await wait(150);
  assert.ok(!a.msgs.some((m) => m.t === 'fighter'), 'not inside the ring: refused');

  await at(a, BOX.x + BOX.r - 1, BOX.z); // a few steps in
  a.send({ t: 'arena', a: 'boxing', w: 'sword' }); // a sword in the boxing ring
  await wait(150);
  assert.ok(!a.msgs.some((m) => m.t === 'fighter'), 'wrong weapon for the arena: refused');
  a.send({ t: 'arena', a: 'boxing', w: 'nonsense' });
  a.send({ t: 'arena', a: 'moon', w: 'classic' });
  await wait(150);
  assert.ok(!a.msgs.some((m) => m.t === 'fighter'), 'unknown names: refused');

  a.send({ t: 'arena', a: 'boxing', w: 'classic' });
  const joined = await a.wait((m) => m.t === 'fighter' && m.a === 'boxing');
  assert.deepEqual([joined.id, joined.w, joined.hp], [a.id, 'classic', MAX_HP]);
  await wait(150);
  const snap = a.msgs.filter((m) => m.t === 'snap').at(-1);
  const mine = snap.p.find((p: any[]) => p[0] === a.id);
  assert.deepEqual(mine.slice(7), [1, WEAPONS.indexOf(w('classic')) + 1, MAX_HP], 'snapshots carry arena, weapon and health');

  // Walking out of the ring leaves the fight by itself.
  await at(a, BOX.x + BOX.r + 3, BOX.z);
  const left = await a.wait((m) => m.t === 'fighter' && m.a === null);
  assert.equal(left.id, a.id);
  a.ws.close();
});

test('a swing hurts whoever is in reach and arc, never anyone else', async () => {
  const x = await player('xena');
  const y = await player('yuri');
  const z = await player('zed');
  // x and y fight in the sword arena; z stands next to them but hasn't joined.
  await at(x, SWORD.x, SWORD.z, 0);
  await at(y, SWORD.x, SWORD.z + 1.6, Math.PI); // 1.6 m in front of x, facing back
  await at(z, SWORD.x + 1.2, SWORD.z + 1.0, 0);
  x.send({ t: 'arena', a: 'sword', w: 'sword' });
  y.send({ t: 'arena', a: 'sword', w: 'dagger' });
  await x.wait((m) => m.t === 'fighter' && m.id === y.id && m.a === 'sword');
  await wait(1200); // the protection after joining runs out

  x.send({ t: 'attack' });
  const hit = await y.wait((m) => m.t === 'melee');
  assert.equal(hit.from, x.id);
  assert.equal(hit.to, y.id);
  assert.equal(hit.d, w('sword').damage);
  assert.equal(hit.hp, MAX_HP - w('sword').damage);
  assert.equal(hit.blk, 0);
  assert.ok(hit.kb[1] > 0 && Math.abs(hit.kb[0]) < 0.01, 'shoved away from the swinger (+z)');
  assert.ok(!z.msgs.some((m) => m.t === 'melee' && m.to === z.id), 'the bystander (not fighting) is not hurt');
  assert.ok(y.msgs.some((m) => m.t === 'swing' && m.id === x.id && m.w === 'sword'), 'everyone sees the swing');

  // Cooldown: a second swing straight away does nothing.
  x.send({ t: 'attack' });
  await wait(150);
  assert.equal(y.msgs.filter((m) => m.t === 'melee').length, 1, 'cooldown holds');

  // A swing at the wrong moment: y faces away and x is out of y's arc.
  await wait(600);
  await at(x, SWORD.x, SWORD.z - 2.5, 0); // 4.1 m from y: out of reach
  x.send({ t: 'attack' });
  await wait(200);
  assert.equal(y.msgs.filter((m) => m.t === 'melee').length, 1, 'out of reach: a miss');

  // The server reads health back through /api/me? No: fights don't change progress. Leaving heals.
  x.send({ t: 'arena', a: null });
  await x.wait((m) => m.t === 'fighter' && m.id === x.id && m.a === null);
  for (const p of [x, y, z]) p.ws.close();
});

test('guard blocks most of a swing from the front and cancels the shove, but not from behind', async () => {
  const g = await player('gina');
  const h = await player('hugo');
  await at(g, BOX.x, BOX.z, 0);
  await at(h, BOX.x, BOX.z + 1.5, Math.PI, { a: 'guard' }); // faces g and guards
  g.send({ t: 'arena', a: 'boxing', w: 'heavy' });
  h.send({ t: 'arena', a: 'boxing', w: 'classic' });
  await g.wait((m) => m.t === 'fighter' && m.id === h.id);
  await wait(1200);
  await at(h, BOX.x, BOX.z + 1.5, Math.PI, { a: 'guard' });
  g.send({ t: 'attack' });
  const blocked = await h.wait((m) => m.t === 'melee');
  assert.equal(blocked.blk, 1);
  assert.equal(blocked.d, Math.round(w('heavy').damage * (1 - w('classic').guard)));
  assert.deepEqual(blocked.kb, [0, 0], 'a guard stops the shove');

  // From behind the guard is useless.
  await wait(1000);
  await at(h, BOX.x, BOX.z + 1.5, 0, { a: 'guard' }); // now facing away from g
  g.send({ t: 'attack' });
  await h.wait((m) => m.t === 'melee' && m !== blocked);
  const second = h.msgs.filter((m) => m.t === 'melee')[1];
  assert.equal(second.blk, 0);
  assert.equal(second.d, w('heavy').damage);
  g.ws.close();
  h.ws.close();
});

test('knock-out: down for a few seconds, back up with full health and a moment of protection; scores recorded', async () => {
  const k = await player('kira');
  const l = await player('liam');
  await at(k, BOX.x, BOX.z, 0);
  await at(l, BOX.x, BOX.z + 1.5, Math.PI);
  k.send({ t: 'arena', a: 'boxing', w: 'heavy' }); // 18 per punch: six punches
  l.send({ t: 'arena', a: 'boxing', w: 'feather' });
  await k.wait((m) => m.t === 'fighter' && m.id === l.id);
  await wait(1200);

  const t0 = Date.now();
  while (!k.msgs.some((m) => m.t === 'ko') && Date.now() - t0 < 12000) {
    // Keep sending positions like a real client does (quiet fighters are dropped after a few seconds).
    k.state(BOX.x, BOX.z);
    l.state(BOX.x, BOX.z + 1.5, { yaw: Math.PI });
    k.send({ t: 'attack' });
    await wait(w('heavy').cooldown * 1000 + 40);
  }
  const ko = await l.wait((m) => m.t === 'ko');
  assert.deepEqual([ko.from, ko.to], [k.id, l.id]);
  await wait(200);
  const down = l.msgs.filter((m) => m.t === 'snap').at(-1).p.find((p: any[]) => p[0] === l.id);
  assert.equal(down[5], 'ko', 'a knocked-out fighter shows as ko');
  assert.equal(down[9], 0);

  // While down they can't be hit again or hit back.
  const hitsBefore = l.msgs.filter((m) => m.t === 'melee').length;
  k.send({ t: 'attack' });
  l.send({ t: 'attack' });
  await wait(300);
  assert.equal(l.msgs.filter((m) => m.t === 'melee').length, hitsBefore, 'a fighter on the floor is not hit again');
  assert.ok(!k.msgs.some((m) => m.t === 'melee' && m.to === k.id), 'and cannot hit back');

  const up = await l.wait((m) => m.t === 'respawn', (KO_TIME + 2) * 1000);
  assert.equal(up.id, l.id);
  assert.ok(Math.hypot(up.at[0] - BOX.x, up.at[1] - BOX.z) < BOX.r);
  await wait(200);
  const back = l.msgs.filter((m) => m.t === 'snap').at(-1).p.find((p: any[]) => p[0] === l.id);
  assert.equal(back[9], MAX_HP, 'full health again');
  assert.notEqual(back[5], 'ko');
  // Protected for a moment after getting up: a punch does nothing.
  const n = l.msgs.filter((m) => m.t === 'melee').length;
  await at(l, up.at[0], up.at[1]);
  await at(k, up.at[0], up.at[1] - 1.5, 0);
  k.send({ t: 'attack' });
  await wait(250);
  assert.equal(l.msgs.filter((m) => m.t === 'melee').length, n, 'protected right after getting up');

  // Scores.
  await wait(200);
  assert.deepEqual((await s.api('GET', '/api/me', undefined, k.token)).body.stats.kos, 1);
  assert.deepEqual((await s.api('GET', '/api/me', undefined, l.token)).body.stats.knockedOut, 1);
  k.ws.close();
  l.ws.close();
});

test('fighters are not hit by snowballs, and cannot throw them', async () => {
  const a = await player('abe');
  const b = await player('bea');
  await at(a, BOX.x - 3, BOX.z, 0);
  await at(b, BOX.x - 3, BOX.z + 4, Math.PI);
  b.send({ t: 'arena', a: 'boxing', w: 'classic' });
  await b.wait((m) => m.t === 'fighter' && m.id === b.id);
  const o = [BOX.x - 3, 1.5, BOX.z + 0.3];
  a.send({ t: 'throw', o, v: [0, 3.1, 8] });
  await wait(900);
  assert.ok(!a.msgs.some((m) => m.t === 'hit'), 'a snowball flies through a fighter');
  // And a fighter's own throw is refused.
  a.send({ t: 'arena', a: 'boxing', w: 'classic' });
  await a.wait((m) => m.t === 'fighter' && m.id === a.id);
  const before = b.msgs.filter((m) => m.t === 'throw').length;
  a.send({ t: 'throw', o, v: [0, 3, 8] });
  await wait(300);
  assert.equal(b.msgs.filter((m) => m.t === 'throw').length, before, 'no throw from inside a fight');
  a.ws.close();
  b.ws.close();
});

test('Fighters leaderboard ranks knock-outs', async () => {
  // The previous test left kira with one knock-out. Add a second fight for mia.
  const reg = (name: string) => s.api('POST', '/api/auth/register', { email: `${name}@example.com`, password: 'snowball123', username: name });
  const mia = (await reg('mia')).body;
  const board = await s.api('GET', '/api/leaderboard?board=fighters', undefined, mia.token);
  assert.equal(board.status, 200);
  assert.equal(board.body.rows[0].username, 'kira');
  assert.equal(board.body.rows[0].value, 1);
  assert.equal(board.body.rows[0].rank, 1);
  assert.equal(board.body.rows[0].deaths, 0);
  assert.equal(board.body.me, null, 'a player with no knock-outs has no row');
  assert.equal((await s.api('GET', '/api/leaderboard?board=nope', undefined, mia.token)).body.error, 'bad_board');
});
