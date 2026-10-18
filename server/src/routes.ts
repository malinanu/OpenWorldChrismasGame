import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthError, USERNAME_RE, type Auth, type User } from './auth.ts';
import type { Config } from './config.ts';
import { CHARACTERS, isGameId } from './games.ts';
import type { Progress } from './progress.ts';

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(8, 'Passwords need at least 8 characters.').max(200);
const username = z.string().regex(USERNAME_RE, 'Usernames are 3–16 letters, numbers or _.');
// E.164 after stripping spaces/dashes, e.g. +94771234567.
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

const publicUser = (u: User) => ({ id: u.id, username: u.username, email: u.email, phone: u.phone, characterId: u.characterId, role: u.role, createdAt: u.createdAt });

export function registerRoutes(app: FastifyInstance, cfg: Config, auth: Auth, progress: Progress, hooks: Hooks = {}) {
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
    if (err instanceof z.ZodError) return reply.status(400).send({ error: 'invalid', message: err.issues[0]?.message ?? 'Invalid request.' });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: 'request', message: (err as Error).message });
    app.log.error(err);
    return reply.status(500).send({ error: 'server', message: 'Something went wrong on our side.' });
  });

  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/config', async () => ({ authMode: cfg.authMode, characters: CHARACTERS }));

  app.post('/api/auth/register', { config: authLimit }, async (req, reply) => {
    const body = z.object({ email, password, username }).parse(req.body);
    return signedIn(reply, req, await auth.register(body.email, body.password, body.username));
  });

  app.post('/api/auth/login', { config: authLimit }, async (req, reply) => {
    const body = z.object({ email, password: z.string().max(200) }).parse(req.body);
    return signedIn(reply, req, await auth.login(body.email, body.password));
  });

  app.post('/api/auth/otp/request', { config: authLimit }, async (req) => {
    const body = z.object({ phone }).parse(req.body);
    await auth.requestOtp(body.phone, req.ip);
    return { ok: true };
  });

  app.post('/api/auth/otp/verify', { config: authLimit }, async (req, reply) => {
    const body = z.object({ phone, code: z.string().regex(/^\d{6}$/, 'The code has 6 digits.') }).parse(req.body);
    return signedIn(reply, req, await auth.verifyOtp(body.phone, body.code));
  });

  app.post('/api/auth/logout', async (req) => {
    const t = bearer(req);
    if (t) await auth.logout(t);
    return { ok: true };
  });

  app.get('/api/me', async (req) => {
    const user = await requireUser(req);
    return { user: publicUser(user), progress: await progress.get(user.id), stats: await progress.stats(user.id) };
  });

  app.put('/api/me', async (req) => {
    const user = await requireUser(req);
    const body = z.object({ username: username.optional(), characterId: z.enum(CHARACTERS).optional() }).parse(req.body);
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

  app.get('/api/leaderboard', async (req) => {
    const q = z.object({ board: z.string().default('stars') }).parse(req.query);
    if (q.board !== 'stars' && !isGameId(q.board)) throw new AuthError(400, 'bad_board', 'Unknown leaderboard.');
    const viewer = await auth.userForToken(bearer(req));
    return progress.leaderboard(q.board as 'stars', viewer?.id ?? null);
  });
}
