import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { Auth } from './auth.ts';
import type { Config } from './config.ts';
import type { Pool } from './db.ts';
import { Progress } from './progress.ts';
import { Realtime } from './realtime.ts';
import { registerRoutes } from './routes.ts';
import type { SmsSender } from './sms.ts';

/** Wires the HTTP API and the WebSocket server together (used by index.ts and the tests). */
export async function buildApp(cfg: Config, pool: Pool, sms: SmsSender, opts: { logger?: boolean } = {}) {
  // Behind CloudPanel's nginx: trust X-Forwarded-For so rate limits see the real client IP.
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true, bodyLimit: 32 * 1024 });
  await app.register(rateLimit, { global: false });
  if (cfg.origin) {
    // Only needed in development, when Vite serves the game from another port.
    app.addHook('onRequest', async (req, reply) => {
      reply.header('Access-Control-Allow-Origin', cfg.origin!);
      reply.header('Access-Control-Allow-Headers', 'authorization, content-type');
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
      if (req.method === 'OPTIONS') return reply.status(204).send();
    });
  }
  const auth = new Auth(pool, sms, cfg.sessionDays);
  const progress = new Progress(pool);
  const realtime = new Realtime(auth, progress);
  registerRoutes(app, cfg, auth, progress, { onProfile: (u) => realtime.updateProfile(u) });
  app.get('/api/online', async () => realtime.info);
  realtime.attach(app.server);
  app.addHook('onClose', async () => realtime.close());
  return { app, auth, progress, realtime };
}
