import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import mysql from 'mysql2/promise';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { migrate } from '../src/migrate.ts';
import { ConsoleSms } from '../src/sms.ts';

/**
 * A fresh server on a random port against an empty test database.
 * Needs MySQL/MariaDB: TEST_DB_HOST/PORT/USER/PASSWORD/NAME (defaults match the README's local setup).
 */
export async function startServer(extraEnv: Record<string, string> = {}) {
  const cfg = loadConfig({
    ...extraEnv,
    DB_HOST: process.env.TEST_DB_HOST ?? '127.0.0.1',
    DB_PORT: process.env.TEST_DB_PORT ?? '3307',
    DB_USER: process.env.TEST_DB_USER ?? 'frostvale',
    DB_PASSWORD: process.env.TEST_DB_PASSWORD ?? 'frostpw',
    DB_NAME: process.env.TEST_DB_NAME ?? 'frostvale_test',
    PORT: '0',
  });
  const pool = mysql.createPool({ ...cfg.db, connectionLimit: 5, timezone: 'Z' });
  const [tables] = await pool.query<mysql.RowDataPacket[]>('SHOW TABLES');
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of tables) await pool.query(`DROP TABLE \`${Object.values(t)[0]}\``);
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');
  await migrate(pool);
  const sms = new ConsoleSms();
  const built = await buildApp(cfg, pool, sms);
  await built.app.listen({ port: 0, host: '127.0.0.1' });
  const port = (built.app.server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  async function api(method: string, path: string, body?: unknown, token?: string) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: (await res.json()) as any };
  }

  return {
    ...built,
    pool,
    sms,
    base,
    port,
    api,
    async stop() {
      await built.app.close();
      await pool.end();
    },
  };
}

/** A scripted player: connects, records every message, can send state and throws. */
export async function connectPlayer(s: Awaited<ReturnType<typeof startServer>>, name: string, characterId = 'Knight') {
  const reg = await s.api('POST', '/api/auth/register', { email: `${name}@example.com`, password: 'snowball123', username: name });
  await s.api('PUT', '/api/me', { characterId }, reg.body.token);
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws?token=${reg.body.token}`);
  const msgs: any[] = [];
  ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
  await new Promise((r, j) => (ws.once('open', r), ws.once('error', j)));
  const p = {
    id: reg.body.user.id as number,
    token: reg.body.token as string,
    ws,
    msgs,
    send: (m: unknown) => ws.send(JSON.stringify(m)),
    state: (x: number, z: number, extra: object = {}) => p.send({ t: 'state', x, y: 0, z, yaw: 0, a: 'idle', ...extra }),
    wait: async (pred: (m: any) => boolean, ms = 3000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const m = msgs.find(pred);
        if (m) return m;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`${name}: timed out waiting`);
    },
  };
  return p;
}
