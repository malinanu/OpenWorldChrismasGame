import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { loadConfig } from './config.ts';
import type { Pool } from './db.ts';

const DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

/** Applies every `migrations/NNN_*.sql` not yet recorded in `schema_migrations`, in order. */
export async function migrate(pool: Pool, log: (m: string) => void = () => {}) {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(100) PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const [rows] = await pool.query<mysql.RowDataPacket[]>('SELECT name FROM schema_migrations');
  const done = new Set(rows.map((r) => r.name as string));
  const files = (await readdir(DIR)).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await readFile(DIR + f, 'utf8');
    const conn = await pool.getConnection();
    try {
      // Statements one at a time (no multipleStatements on the pool). MySQL DDL isn't transactional.
      for (const stmt of sql.split(/;\s*(?:\n|$)/).map((s) => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean)) await conn.query(stmt);
      await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [f]);
      log(`migrated ${f}`);
    } finally {
      conn.release();
    }
  }
}

// `node dist/migrate.js`: run against the configured database and exit.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cfg = loadConfig();
  const pool = mysql.createPool({ ...cfg.db, connectionLimit: 1 });
  migrate(pool, console.log)
    .then(() => pool.end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
