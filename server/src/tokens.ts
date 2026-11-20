import type { Pool, Row } from './db.ts';
import type mysql from 'mysql2/promise';

/** Token packs for sale (Sri Lankan rupees). Bigger packs come with bonus tokens. */
export const PACKS = [
  { id: 'p100', amount: 100, tokens: 10 },
  { id: 'p200', amount: 200, tokens: 22 },
  { id: 'p500', amount: 500, tokens: 60 },
] as const;
export type PackId = (typeof PACKS)[number]['id'];
export const getPack = (id: unknown) => PACKS.find((p) => p.id === id);

export type LedgerReason = 'signup' | 'purchase' | 'fight' | 'chargeback' | 'admin';

/** Fight tokens: balances and every change to them (the ledger). */
export class Tokens {
  private readonly db: Pool;

  constructor(db: Pool) {
    this.db = db;
  }

  async balance(userId: number): Promise<number> {
    const [rows] = await this.db.query<Row[]>('SELECT tokens FROM users WHERE id = ?', [userId]);
    return Number(rows[0]?.tokens ?? 0);
  }

  /**
   * Takes `n` tokens if the player has them (one atomic update, so two quick requests can't
   * both spend the last token). Returns the new balance, or null when there weren't enough.
   */
  async spend(userId: number, n: number, reason: LedgerReason, ref: string | null = null): Promise<number | null> {
    const conn = await this.db.getConnection();
    try {
      await conn.beginTransaction();
      const [res] = await conn.query<mysql.ResultSetHeader>('UPDATE users SET tokens = tokens - ? WHERE id = ? AND tokens >= ?', [n, userId, n]);
      if (res.affectedRows !== 1) {
        await conn.rollback();
        return null;
      }
      const balance = await this.log(conn, userId, -n, reason, ref);
      await conn.commit();
      return balance;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  /** Adds tokens inside the caller's transaction and records why. Returns the new balance. */
  async creditIn(conn: mysql.PoolConnection, userId: number, n: number, reason: LedgerReason, ref: string | null) {
    await conn.query('UPDATE users SET tokens = tokens + ? WHERE id = ?', [n, userId]);
    return this.log(conn, userId, n, reason, ref);
  }

  /** Takes tokens back (a chargeback), never below zero. Returns the new balance. */
  async debitIn(conn: mysql.PoolConnection, userId: number, n: number, reason: LedgerReason, ref: string | null) {
    const [rows] = await conn.query<Row[]>('SELECT tokens FROM users WHERE id = ? FOR UPDATE', [userId]);
    const take = Math.min(n, Number(rows[0]?.tokens ?? 0));
    await conn.query('UPDATE users SET tokens = tokens - ? WHERE id = ?', [take, userId]);
    return this.log(conn, userId, -take, reason, ref);
  }

  private async log(conn: mysql.PoolConnection, userId: number, delta: number, reason: LedgerReason, ref: string | null) {
    const [rows] = await conn.query<Row[]>('SELECT tokens FROM users WHERE id = ?', [userId]);
    const balance = Number(rows[0]?.tokens ?? 0);
    await conn.query('INSERT INTO token_ledger (user_id, delta, reason, ref, balance) VALUES (?, ?, ?, ?, ?)', [userId, delta, reason, ref, balance]);
    return balance;
  }
}
