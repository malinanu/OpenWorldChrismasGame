import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthError, LANGS, USERNAME_RE, type Auth, type User } from './auth.ts';
import type { Config } from './config.ts';
import { CHARACTERS, isGameId } from './games.ts';
import type { Board, Progress } from './progress.ts';
import type { PayHere } from './payhere.ts';
import { PACKS, getPack, type PackId, type Tokens } from './tokens.ts';
import { FIGHT_COST, LIVES, PREMIUM_EXTRA, WEAPONS } from './arena.ts';

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(8, 'Passwords need at least 8 characters.').max(200);
const username = z.string().regex(USERNAME_RE, 'Usernames are 3–16 letters, numbers or _.');
// E.164 after stripping spaces/dashes, e.g. +94771234567.
const language = z.enum(LANGS).default('en');
const phone = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use your full number with country code, e.g. +94 77 123 4567.'));

export interface Hooks {
  /** Called when a profile changes, so connected players see the new name/character. */
  onProfile?(user: User): void;
}

export function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}

const publicUser = (u: User) => ({ id: u.id, username: u.username, email: u.email, phone: u.phone, characterId: u.characterId, language: u.language, role: u.role, createdAt: u.createdAt });

export function registerRoutes(app: FastifyInstance, cfg: Config, auth: Auth, progress: Progress, shop: { tokens: Tokens; payhere: PayHere }, hooks: Hooks = {}) {
  const { tokens, payhere } = shop;
  // PayHere's notify call is an ordinary HTML form post.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });
  const authLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };

  async function requireUser(req: FastifyRequest): Promise<User> {
    const u = await auth.userForToken(bearer(req));
    if (!u) throw new AuthError(401, 'unauthorized', 'Please sign in again.');
    return u;
  }

  async function signedIn(reply: FastifyReply, req: FastifyRequest, user: User) {
    const token = await auth.createSession(user.id, req.headers['user-agent']);
    return reply.send({ token, user: publicUser(user), needsUsername: !user.username });
  }

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AuthError) return reply.status(err.status).send({ error: err.code, message: err.message });
    // Validation errors carry the field ("bad_email", "bad_password", …) so the game can say it in the player's language.
    if (err instanceof z.ZodError) {
      const field = err.issues[0]?.path[0];
      return reply.status(400).send({ error: typeof field === 'string' ? `bad_${field}` : 'invalid', message: err.issues[0]?.message ?? 'Invalid request.' });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: 'request', message: (err as Error).message });
    app.log.error(err);
    return reply.status(500).send({ error: 'server', message: 'Something went wrong on our side.' });
  });

  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/config', async () => ({ authMode: cfg.authMode, characters: CHARACTERS, payments: payhere.enabled }));

  app.post('/api/auth/register', { config: authLimit }, async (req, reply) => {
    const body = z.object({ email, password, username, language }).parse(req.body);
    return signedIn(reply, req, await auth.register(body.email, body.password, body.username, body.language));
  });

  app.post('/api/auth/login', { config: authLimit }, async (req, reply) => {
    const body = z.object({ email, password: z.string().max(200) }).parse(req.body);
    return signedIn(reply, req, await auth.login(body.email, body.password));
  });

  app.post('/api/auth/otp/request', { config: authLimit }, async (req) => {
    const body = z.object({ phone, language }).parse(req.body);
    await auth.requestOtp(body.phone, req.ip, body.language);
    return { ok: true };
  });

  app.post('/api/auth/otp/verify', { config: authLimit }, async (req, reply) => {
    const body = z.object({ phone, code: z.string().regex(/^\d{6}$/, 'The code has 6 digits.'), language }).parse(req.body);
    return signedIn(reply, req, await auth.verifyOtp(body.phone, body.code, body.language));
  });

  app.post('/api/auth/logout', async (req) => {
    const t = bearer(req);
    if (t) await auth.logout(t);
    return { ok: true };
  });

  app.get('/api/me', async (req) => {
    const user = await requireUser(req);
    return { user: publicUser(user), progress: await progress.get(user.id), stats: await progress.stats(user.id), tokens: await tokens.balance(user.id) };
  });

  app.put('/api/me', async (req) => {
    const user = await requireUser(req);
    const body = z.object({ username: username.optional(), characterId: z.enum(CHARACTERS).optional(), language: z.enum(LANGS).optional() }).parse(req.body);
    const updated = await auth.updateProfile(user.id, body);
    hooks.onProfile?.(updated);
    return { user: publicUser(updated) };
  });

  app.put('/api/progress', async (req) => {
    const user = await requireUser(req);
    const body = z.object({ games: z.record(z.string(), z.object({ score: z.number().finite().nonnegative() })) }).parse(req.body);
    await progress.save(user.id, body.games);
    return { progress: await progress.get(user.id) };
  });

  // ---------------------------------------------------------------- fight tokens

  const price = () => ({
    packs: PACKS,
    fightCost: FIGHT_COST,
    premiumExtra: PREMIUM_EXTRA,
    lives: LIVES,
    premium: WEAPONS.filter((w) => w.premium).map((w) => w.id),
    payments: payhere.enabled,
  });

  app.get('/api/tokens', async (req) => {
    const user = await requireUser(req);
    return { tokens: await tokens.balance(user.id), ...price() };
  });

  app.post('/api/payhere/checkout', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const user = await requireUser(req);
    if (!payhere.enabled) throw new AuthError(503, 'payments_off', 'Payments are not switched on yet.');
    const name = z.string().trim().min(1).max(50);
    const body = z
      .object({
        pack: z.string().refine((p) => !!getPack(p), 'Unknown pack.'),
        firstName: name,
        lastName: name,
        email,
        phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Use a phone number like 077 123 4567.'),
      })
      .parse(req.body);
    return payhere.checkout(user.id, body.pack as PackId, body);
  });

  // Called by PayHere's servers (not the player), signed with the merchant secret.
  app.post('/api/payhere/notify', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    const r = await payhere.notify((req.body ?? {}) as Record<string, string>);
    if (!r.ok) app.log.warn({ reason: r.reason }, 'payhere notify rejected');
    return reply.status(r.ok ? 200 : 400).send(r.ok ? 'OK' : 'rejected');
  });

  app.get('/api/payhere/order/:id', async (req) => {
    const user = await requireUser(req);
    const { id } = z.object({ id: z.string().max(32) }).parse(req.params);
    const order = await payhere.order(user.id, id);
    if (!order) throw new AuthError(404, 'no_order', 'Order not found.');
    return { order, tokens: await tokens.balance(user.id) };
  });

  app.get('/api/leaderboard', async (req) => {
    const q = z.object({ board: z.string().default('stars') }).parse(req.query);
    if (q.board !== 'stars' && q.board !== 'fighters' && !isGameId(q.board)) throw new AuthError(400, 'bad_board', 'Unknown leaderboard.');
    const viewer = await auth.userForToken(bearer(req));
    return progress.leaderboard(q.board as Board, viewer?.id ?? null);
  });
}
