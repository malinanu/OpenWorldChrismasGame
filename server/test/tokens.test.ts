import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, test } from 'node:test';
import { ARENAS, LIVES } from '../src/arena.ts';
import { connectPlayer, startServer } from './helpers.ts';

const MERCHANT = '1211149';
const SECRET = 'test-merchant-secret';
let s: Awaited<ReturnType<typeof startServer>>;
before(async () => (s = await startServer({ PAYHERE_MERCHANT_ID: MERCHANT, PAYHERE_MERCHANT_SECRET: SECRET, PUBLIC_URL: 'https://game.example/' })));
after(async () => s.stop());

const BOX = ARENAS.find((a) => a.id === 'boxing')!;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const md5 = (x: string) => createHash('md5').update(x).digest('hex').toUpperCase();
const setTokens = (id: number, n: number) => s.pool.query('UPDATE users SET tokens = ? WHERE id = ?', [n, id]);
const balance = async (id: number) => Number(((await s.pool.query('SELECT tokens FROM users WHERE id = ?', [id])) as any)[0][0].tokens);

/** PayHere's notify call: a plain form post, signed the way PayHere signs it. */
async function notify(f: Record<string, string>, sign = true) {
  const body = { merchant_id: MERCHANT, payhere_currency: 'LKR', payment_id: '320025071278', method: 'VISA', ...f };
  if (sign) body.md5sig = md5(body.merchant_id + body.order_id + body.payhere_amount + body.payhere_currency + body.status_code + md5(SECRET));
  const res = await fetch(`${s.base}/api/payhere/notify`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  return res.status;
}

const customer = { firstName: 'Kandy', lastName: 'Kid', email: 'kandy@example.com', phone: '0771234567' };

test('every account starts with 3 free tokens; prices and packs come from the server', async () => {
  const p = await connectPlayer(s, 'tess');
  const t = await s.api('GET', '/api/tokens', undefined, p.token);
  assert.equal(t.body.tokens, 3);
  assert.deepEqual(
    t.body.packs.map((x: any) => [x.id, x.amount, x.tokens]),
    [['p100', 100, 10], ['p200', 200, 22], ['p500', 500, 60]],
  );
  assert.deepEqual(t.body.premium, ['heavy', 'axe', 'greatsword']);
  assert.equal((await s.api('GET', '/api/me', undefined, p.token)).body.tokens, 3);
  assert.equal((await s.api('GET', '/api/config')).body.payments, true);
  const welcome = await p.wait((m) => m.t === 'welcome');
  assert.deepEqual([welcome.fight.cost, welcome.fight.premiumExtra, welcome.fight.lives], [1, 1, LIVES]);
  p.ws.close();
});

test('a fight costs a token, a premium weapon two; without enough tokens there is no fight', async () => {
  const a = await player('ugo', BOX.x, BOX.z);
  a.send({ t: 'arena', a: 'boxing', w: 'classic' });
  const joined = await a.wait((m) => m.t === 'fighter' && m.id === a.id && m.a === 'boxing');
  assert.equal(joined.lives, LIVES);
  assert.equal((await a.wait((m) => m.t === 'tokens')).n, 2);
  assert.equal(await balance(a.id), 2);

  // Already fighting: asking for another weapon is refused (leave and pay again).
  a.send({ t: 'arena', a: 'boxing', w: 'feather' });
  await wait(200);
  assert.equal(await balance(a.id), 2, 'no second charge');

  a.send({ t: 'arena', a: null });
  await a.wait((m) => m.t === 'fighter' && m.id === a.id && m.a === null);
  a.send({ t: 'arena', a: 'boxing', w: 'heavy' }); // premium: 2 tokens
  await a.wait((m) => m.t === 'fighter' && m.id === a.id && m.w === 'heavy');
  assert.equal(await balance(a.id), 0);
  a.send({ t: 'arena', a: null });
  await wait(150);

  const before = a.msgs.filter((m) => m.t === 'fighter' && m.a).length;
  a.send({ t: 'arena', a: 'boxing', w: 'classic' });
  const err = await a.wait((m) => m.t === 'arena_err');
  assert.deepEqual([err.code, err.need, err.have], ['no_tokens', 1, 0]);
  await wait(150);
  assert.equal(a.msgs.filter((m) => m.t === 'fighter' && m.a).length, before, 'not let in');
  const ledger = ((await s.pool.query('SELECT delta, reason FROM token_ledger WHERE user_id = ? ORDER BY id', [a.id])) as any)[0];
  assert.deepEqual(ledger.map((r: any) => [r.delta, r.reason]), [[-1, 'fight'], [-2, 'fight']]);
  a.ws.close();
});

async function player(name: string, x: number, z: number, yaw = 0) {
  const p = await connectPlayer(s, name);
  p.send({ t: 'state', x, y: 0, z, yaw, a: 'idle' });
  await wait(80);
  return p;
}

test('a paid entry lasts three knock-outs, then the fighter is out', async () => {
  const k = await player('kim', BOX.x, BOX.z, 0);
  const l = await player('lou', BOX.x, BOX.z + 1.5, Math.PI);
  k.send({ t: 'arena', a: 'boxing', w: 'classic' });
  l.send({ t: 'arena', a: 'boxing', w: 'classic' });
  await k.wait((m) => m.t === 'fighter' && m.id === l.id && m.a);
  const conn = (s.realtime as any).byUser.get(l.id);
  for (let round = 1; round <= LIVES; round++) {
    await wait(1100); // protection after joining / getting up
    // Keep both in place (the server drops quiet fighters, and getting up moves lou).
    k.state(BOX.x, BOX.z);
    l.state(BOX.x, BOX.z + 1.5, { yaw: Math.PI });
    await wait(60);
    conn.hp = 5; // skip to the last punch
    k.send({ t: 'attack' });
    await l.wait(() => l.msgs.filter((x) => x.t === 'ko').length >= round);
    const ko = l.msgs.filter((x) => x.t === 'ko')[round - 1];
    assert.equal(ko.lives, LIVES - round);
    if (round < LIVES) {
      await l.wait(() => l.msgs.filter((x) => x.t === 'respawn').length >= round, 6000);
      await wait(1100);
    }
  }
  const out = await l.wait((m) => m.t === 'fighter' && m.id === l.id && m.a === null, 6000);
  assert.equal(out.why, 'out');
  assert.equal(l.msgs.filter((m) => m.t === 'respawn').length, LIVES - 1, 'no getting up after the last life');
  k.ws.close();
  l.ws.close();
});

test('PayHere checkout: our price, our order, a correct hash', async () => {
  const p = await connectPlayer(s, 'pia');
  const r = await s.api('POST', '/api/payhere/checkout', { pack: 'p200', ...customer }, p.token);
  assert.equal(r.status, 200);
  assert.equal(r.body.action, 'https://sandbox.payhere.lk/pay/checkout');
  const f = r.body.fields;
  assert.equal(f.merchant_id, MERCHANT);
  assert.equal(f.amount, '200.00');
  assert.equal(f.currency, 'LKR');
  assert.equal(f.notify_url, 'https://game.example/api/payhere/notify');
  assert.equal(f.return_url, `https://game.example/?paid=${f.order_id}`);
  assert.equal(f.hash, md5(MERCHANT + f.order_id + '200.00' + 'LKR' + md5(SECRET)));
  assert.equal((await s.api('POST', '/api/payhere/checkout', { pack: 'p999', ...customer }, p.token)).body.error, 'bad_pack');
  assert.equal((await s.api('POST', '/api/payhere/checkout', { pack: 'p100', ...customer })).status, 401);
  p.ws.close();
});

test('PayHere notify credits a pack exactly once, only when genuine; a chargeback takes it back', async () => {
  const p = await connectPlayer(s, 'quin');
  const other = await connectPlayer(s, 'rex');
  const { body } = await s.api('POST', '/api/payhere/checkout', { pack: 'p200', ...customer }, p.token);
  const order = body.fields.order_id;
  const paid = { order_id: order, payhere_amount: '200.00', status_code: '2' };

  assert.equal(await notify({ ...paid, md5sig: 'BAD' }, false), 400, 'bad signature');
  assert.equal(await notify({ ...paid, payhere_amount: '2.00' }), 400, 'wrong amount');
  assert.equal(await notify({ ...paid, order_id: 'FVNOPE' }), 400, 'unknown order');
  assert.equal(await notify({ ...paid, merchant_id: '999' }), 400, 'another merchant');
  assert.equal(await balance(p.id), 3, 'nothing credited yet');
  assert.equal((await s.api('GET', `/api/payhere/order/${order}`, undefined, p.token)).body.order.status, 'pending');

  assert.equal(await notify(paid), 200);
  assert.equal(await balance(p.id), 25);
  assert.equal((await p.wait((m) => m.t === 'tokens')).n, 25, 'the game hears about it straight away');
  assert.equal(await notify(paid), 200, 'PayHere may call again');
  assert.equal(await balance(p.id), 25, 'credited once');
  const o = await s.api('GET', `/api/payhere/order/${order}`, undefined, p.token);
  assert.deepEqual([o.body.order.status, o.body.order.tokens, o.body.tokens], ['paid', 22, 25]);
  assert.equal((await s.api('GET', `/api/payhere/order/${order}`, undefined, other.token)).status, 404, "someone else's order");

  // Spend some, then a chargeback: what's left of the pack is taken back, never below zero.
  await setTokens(p.id, 10);
  assert.equal(await notify({ ...paid, status_code: '-3' }), 200);
  assert.equal(await balance(p.id), 0);

  // A cancelled payment changes nothing but the status.
  const c = (await s.api('POST', '/api/payhere/checkout', { pack: 'p100', ...customer }, p.token)).body.fields.order_id;
  assert.equal(await notify({ order_id: c, payhere_amount: '100.00', status_code: '-1' }), 200);
  assert.equal((await s.api('GET', `/api/payhere/order/${c}`, undefined, p.token)).body.order.status, 'cancelled');
  assert.equal(await notify({ order_id: c, payhere_amount: '100.00', status_code: '2' }), 200);
  assert.equal(await balance(p.id), 10, 'a late success after a cancel still pays out');
  p.ws.close();
  other.ws.close();
});
