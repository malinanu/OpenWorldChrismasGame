import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createPool } from './db.ts';
import { migrate } from './migrate.ts';
import { createSms } from './sms.ts';

const cfg = loadConfig();
const pool = createPool(cfg.db);
await migrate(pool, (m) => console.log(m));
const { app } = await buildApp(cfg, pool, createSms(cfg.smsProvider), { logger: true });
await app.listen({ port: cfg.port, host: cfg.host });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
