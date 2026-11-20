import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { WebSocket } from 'ws';
import { GRAVITY } from '../src/realtime.ts';
import { connectPlayer, startServer } from './helpers.ts';

let s: Awaited<ReturnType<typeof startServer>>;
before(async () => (s = await startServer()));
after(async () => s.stop());

const player = (name: string, characterId = 'Knight') => connectPlayer(s, name, characterId);

/** Launch velocity for a lob from `o` landing at `target` after `t` seconds (what the client sends). */
const lob = (o: number[], target: number[], t: number) => [(target[0] - o[0]) / t, (target[1] - o[1] + 0.5 * GRAVITY * t * t) / t, (target[2] - o[2]) / t];

test('players see each other, snowballs hit server-side, leaving cleans up', async () => {
  const a = await player('alice', 'Knight');
  const b = await player('bob', 'Mage');
  const welcome = await b.wait((m) => m.t === 'welcome');
  assert.deepEqual(welcome.players.map((p: any) => p.name).sort(), ['alice', 'bob']);
  const joined = await a.wait((m) => m.t === 'join' && m.p.name === 'bob');
  assert.equal(joined.p.char, 'Mage');

  a.state(0, 0);
  b.state(0, -10);
  const snap = await a.wait((m) => m.t === 'snap' && m.p.length === 2);
  const bob = snap.p.find((p: any[]) => p[0] === b.id);
  assert.deepEqual(bob.slice(1, 4), [0, 0, -10]);

  // Alice lobs a snowball at Bob's chest; the server simulates it and reports the hit to both.
  const o = [0, 1.5, -0.5];
  a.send({ t: 'throw', o, v: lob(o, [0, 1.1, -10], 0.5) });
  await b.wait((m) => m.t === 'throw' && m.id === a.id);
  const hitA = await a.wait((m) => m.t === 'hit');
  const hitB = await b.wait((m) => m.t === 'hit');
  assert.deepEqual([hitA.from, hitA.to], [a.id, b.id]);
  assert.equal(hitB.k, hitA.k);
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual((await s.api('GET', '/api/me', undefined, a.token)).body.stats, { snowballHits: 1, snowballTaken: 0, kos: 0, knockedOut: 0 });
  assert.deepEqual((await s.api('GET', '/api/me', undefined, b.token)).body.stats, { snowballHits: 0, snowballTaken: 1, kos: 0, knockedOut: 0 });

  // A miss, a too-fast throw and a throw from far away don't count.
  const before = a.msgs.filter((m) => m.t === 'hit').length;
  await new Promise((r) => setTimeout(r, 500));
  a.send({ t: 'throw', o, v: lob(o, [8, 1.1, -10], 0.5) });
  await new Promise((r) => setTimeout(r, 500));
  a.send({ t: 'throw', o, v: [0, 0, -200] });
  await new Promise((r) => setTimeout(r, 500));
  a.send({ t: 'throw', o: [0, 1.5, -9], v: [0, 0, -5] });
  await new Promise((r) => setTimeout(r, 1800));
  assert.equal(a.msgs.filter((m) => m.t === 'hit').length, before);

  // Busy players (in a mini-game) can't be hit.
  b.state(0, -10, { busy: true });
  await new Promise((r) => setTimeout(r, 150));
  a.send({ t: 'throw', o, v: lob(o, [0, 1.1, -10], 0.5) });
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(a.msgs.filter((m) => m.t === 'hit').length, before);

  b.ws.close();
  await a.wait((m) => m.t === 'leave' && m.id === b.id);
  a.ws.close();
});

test('teleport-speed moves are ignored; renames reach the room; one connection per account', async () => {
  const c = await player('carol');
  const d = await player('dave');
  c.state(0, 0);
  await new Promise((r) => setTimeout(r, 150));
  c.state(200, 0); // 200 m in a moment: rejected
  await new Promise((r) => setTimeout(r, 250));
  const snap = d.msgs.filter((m) => m.t === 'snap').at(-1);
  assert.equal(snap.p.find((p: any[]) => p[0] === c.id)[1], 0);

  await s.api('PUT', '/api/me', { username: 'carolyn', characterId: 'Ranger' }, c.token);
  const upd = await d.wait((m) => m.t === 'join' && m.p.name === 'carolyn');
  assert.equal(upd.p.char, 'Ranger');

  const c2 = new WebSocket(`ws://127.0.0.1:${s.port}/ws?token=${c.token}`);
  const closed = new Promise<number>((r) => c.ws.once('close', (code) => r(code)));
  await new Promise((r) => c2.once('open', r));
  assert.equal(await closed, 4000, 'the old connection is replaced');
  c2.close();
  d.ws.close();
});

test('bad tokens are refused', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws?token=nope`);
  await assert.rejects(new Promise((r, j) => (ws.once('open', r), ws.once('error', j))));
});
