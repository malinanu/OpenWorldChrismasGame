import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer } from './helpers.ts';

let s: Awaited<ReturnType<typeof startServer>>;
before(async () => (s = await startServer()));
after(async () => s.stop());

test('register, me, login, logout', async () => {
  const reg = await s.api('POST', '/api/auth/register', { email: 'Ada@Example.com', password: 'snowball123', username: 'ada' });
  assert.equal(reg.status, 200);
  assert.equal(reg.body.user.username, 'ada');
  assert.equal(reg.body.user.email, 'ada@example.com');
  assert.equal(reg.body.user.characterId, 'Rogue_Hooded');

  const me = await s.api('GET', '/api/me', undefined, reg.body.token);
  assert.equal(me.status, 200);
  assert.equal(me.body.user.id, reg.body.user.id);
  assert.ok(Math.abs(Date.parse(me.body.user.createdAt) - Date.now()) < 24 * 3600e3, 'createdAt is a recent ISO time');
  assert.deepEqual(me.body.stats, { snowballHits: 0, snowballTaken: 0 });

  const bad = await s.api('POST', '/api/auth/login', { email: 'ada@example.com', password: 'nope-nope' });
  assert.equal(bad.status, 401);
  const login = await s.api('POST', '/api/auth/login', { email: 'ADA@example.com', password: 'snowball123' });
  assert.equal(login.status, 200);

  await s.api('POST', '/api/auth/logout', undefined, login.body.token);
  assert.equal((await s.api('GET', '/api/me', undefined, login.body.token)).status, 401);
  assert.equal((await s.api('GET', '/api/me', undefined, reg.body.token)).status, 200, 'other sessions stay valid');
});

test('duplicates and validation', async () => {
  await s.api('POST', '/api/auth/register', { email: 'bo@example.com', password: 'snowball123', username: 'Bo_1' });
  assert.equal((await s.api('POST', '/api/auth/register', { email: 'bo@example.com', password: 'snowball123', username: 'other' })).body.error, 'email_taken');
  assert.equal((await s.api('POST', '/api/auth/register', { email: 'b2@example.com', password: 'snowball123', username: 'bo_1' })).body.error, 'username_taken', 'usernames are case-insensitive');
  // Each bad field has its own code, so the game can explain it in the player's language.
  const bad = async (body: object) => (await s.api('POST', '/api/auth/register', body)).body.error;
  assert.equal(await bad({ email: 'b3@example.com', password: 'short', username: 'bobo' }), 'bad_password');
  assert.equal(await bad({ email: 'b4@example.com', password: 'snowball123', username: 'no spaces' }), 'bad_username');
  assert.equal(await bad({ email: 'not-an-email', password: 'snowball123', username: 'bobo' }), 'bad_email');
  assert.equal(await bad({ email: 'b5@example.com', password: 'snowball123', username: 'bobo', language: 'fr' }), 'bad_language');
});

test('profile: username and character', async () => {
  const reg = await s.api('POST', '/api/auth/register', { email: 'cy@example.com', password: 'snowball123', username: 'cyd' });
  const t = reg.body.token;
  assert.equal((await s.api('PUT', '/api/me', { characterId: 'Knight' }, t)).body.user.characterId, 'Knight');
  assert.equal((await s.api('PUT', '/api/me', { characterId: 'Dragon' }, t)).status, 400);
  assert.equal((await s.api('PUT', '/api/me', { username: 'ada' }, t)).body.error, 'username_taken');
  assert.equal((await s.api('PUT', '/api/me', { username: 'cyrus' }, t)).body.user.username, 'cyrus');
});

test('language: chosen at sign-up, changeable, sent with the code', async () => {
  const reg = await s.api('POST', '/api/auth/register', { email: 'si@example.com', password: 'snowball123', username: 'sinha', language: 'si' });
  assert.equal(reg.body.user.language, 'si');
  assert.equal((await s.api('GET', '/api/me', undefined, reg.body.token)).body.user.language, 'si');
  assert.equal((await s.api('PUT', '/api/me', { language: 'ta' }, reg.body.token)).body.user.language, 'ta');
  assert.equal((await s.api('PUT', '/api/me', { language: 'xx' }, reg.body.token)).status, 400);
  const plain = await s.api('POST', '/api/auth/register', { email: 'en@example.com', password: 'snowball123', username: 'engl' });
  assert.equal(plain.body.user.language, 'en', 'English when not given');
  // The SMS text is in the language the player is using.
  await s.api('POST', '/api/auth/otp/request', { phone: '+94770000001', language: 'ta' });
  assert.match(s.sms.sent.at(-1)!.text, /குறியீடு \d{6}/);
  await s.api('POST', '/api/auth/otp/request', { phone: '+94770000002', language: 'si' });
  assert.match(s.sms.sent.at(-1)!.text, /කේතය \d{6}/);
  const code = /(\d{6})/.exec(s.sms.sent.at(-1)!.text)![1];
  const v = await s.api('POST', '/api/auth/otp/verify', { phone: '+94770000002', code, language: 'si' });
  assert.equal(v.body.user.language, 'si', 'new phone accounts start in that language');
});

test('phone sign-in with a one-time code', async () => {
  const phone = '+94 77 123 4567';
  assert.equal((await s.api('POST', '/api/auth/otp/request', { phone: '0771234567' })).status, 400, 'needs country code');
  assert.equal((await s.api('POST', '/api/auth/otp/request', { phone })).status, 200);
  assert.equal((await s.api('POST', '/api/auth/otp/request', { phone })).body.error, 'otp_wait', 'one per minute');
  const code = /(\d{6})/.exec(s.sms.sent.at(-1)!.text)![1];
  assert.equal(s.sms.sent.at(-1)!.phone, '+94771234567');
  const wrong = code === '000000' ? '111111' : '000000';
  assert.equal((await s.api('POST', '/api/auth/otp/verify', { phone, code: wrong })).body.error, 'otp_wrong');
  const ok = await s.api('POST', '/api/auth/otp/verify', { phone, code });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.needsUsername, true);
  assert.equal((await s.api('POST', '/api/auth/otp/verify', { phone, code })).body.error, 'otp_expired', 'codes are single-use');
  const named = await s.api('PUT', '/api/me', { username: 'phoneuser' }, ok.body.token);
  assert.equal(named.body.user.username, 'phoneuser');
  assert.equal(named.body.user.phone, '+94771234567');
});

test('one-time codes lock after 5 wrong attempts', async () => {
  const phone = '+94770000001';
  await s.api('POST', '/api/auth/otp/request', { phone });
  const code = /(\d{6})/.exec(s.sms.sent.at(-1)!.text)![1];
  const wrong = code === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) await s.api('POST', '/api/auth/otp/verify', { phone, code: wrong });
  assert.equal((await s.api('POST', '/api/auth/otp/verify', { phone, code })).body.error, 'otp_expired');
});

test('progress keeps the best, clamps scores, derives stars; leaderboards rank', async () => {
  const a = (await s.api('POST', '/api/auth/register', { email: 'lb1@example.com', password: 'snowball123', username: 'lb1' })).body.token;
  const b = (await s.api('POST', '/api/auth/register', { email: 'lb2@example.com', password: 'snowball123', username: 'lb2' })).body.token;
  await s.api('PUT', '/api/progress', { games: { 'snowball-showdown': { score: 25 }, 'elf-workshop': { score: 9 } } }, a);
  const p = await s.api('PUT', '/api/progress', { games: { 'snowball-showdown': { score: 12 }, 'not-a-game': { score: 5 } } }, a);
  assert.deepEqual(p.body.progress['snowball-showdown'], { score: 25, stars: 2 }, 'best kept, stars derived');
  const clamped = await s.api('PUT', '/api/progress', { games: { 'elf-workshop': { score: 9999 } } }, b);
  assert.deepEqual(clamped.body.progress['elf-workshop'], { score: 9, stars: 3 }, 'clamped to the maximum');

  const stars = await s.api('GET', '/api/leaderboard?board=stars', undefined, b);
  assert.equal(stars.body.rows[0].username, 'lb1');
  assert.equal(stars.body.rows[0].value, 5);
  assert.equal(stars.body.rows[0].ornaments, 2);
  assert.equal(stars.body.me.username, 'lb2');
  assert.equal(stars.body.me.rank, 2);

  const elf = await s.api('GET', '/api/leaderboard?board=elf-workshop');
  assert.equal(elf.body.rows.length, 2);
  assert.equal(elf.body.rows[0].rank, 1);
  assert.equal(elf.body.rows[1].rank, 1, 'ties share a rank');
  assert.equal((await s.api('GET', '/api/leaderboard?board=nope')).status, 400);
});
