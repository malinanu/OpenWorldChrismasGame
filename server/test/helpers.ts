import type { AddressInfo } from 'node:net';
import mysql from 'mysql2/promise';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { migrate } from '../src/migrate.ts';
import { ConsoleSms } from '../src/sms.ts';

/**
 * A fresh server on a random port against an empty test database.
 * Needs MySQL/MariaDB: TEST_DB_HOST/PORT/USER/PASSWORD/NAME (defaults match the README's local setup).
 */
export async function startServer() {
  const cfg = loadConfig({
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
