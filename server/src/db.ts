import mysql from 'mysql2/promise';
import type { Config } from './config.ts';

export type Pool = mysql.Pool;
export type Row = mysql.RowDataPacket;

export function createPool(cfg: Config['db']): Pool {
  return mysql.createPool({
    ...cfg,
    connectionLimit: 10,
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: false,
    multipleStatements: false,
  });
}
