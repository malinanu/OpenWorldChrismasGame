import type { Pool, Row } from './db.ts';
import { GAME_IDS, isGameId, scoreAndStars, type GameId } from './games.ts';

export interface GameProgress {
  score: number;
  stars: number;
}

export interface LeaderRow {
  rank: number;
  userId: number;
  username: string;
  characterId: string;
  /** stars board: total stars; game boards: best score. */
  value: number;
  /** stars board only: ornaments won (games with at least one star). */
  ornaments?: number;
  stars?: number;
}

/** Mini-game results and the leaderboards built from them. */
export class Progress {
  private readonly db: Pool;

  constructor(db: Pool) {
    this.db = db;
  }

  /** Keeps the best per game. Unknown games are ignored; scores are clamped and stars derived. */
  async save(userId: number, games: Record<string, { score: number }>) {
    for (const [id, g] of Object.entries(games)) {
      if (!isGameId(id) || !Number.isFinite(g.score)) continue;
      const { score, stars } = scoreAndStars(id, g.score);
      await this.db.query(
        `INSERT INTO progress (user_id, game_id, best_score, best_stars) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE best_score = GREATEST(best_score, VALUES(best_score)), best_stars = GREATEST(best_stars, VALUES(best_stars))`,
        [userId, id, score, stars],
      );
    }
  }

  async get(userId: number): Promise<Record<GameId, GameProgress>> {
    const [rows] = await this.db.query<Row[]>('SELECT game_id, best_score, best_stars FROM progress WHERE user_id = ?', [userId]);
    const out = {} as Record<GameId, GameProgress>;
    for (const r of rows) if (isGameId(r.game_id)) out[r.game_id] = { score: r.best_score, stars: r.best_stars };
    return out;
  }

  async stats(userId: number) {
    const [rows] = await this.db.query<Row[]>('SELECT snowball_hits, snowball_taken FROM stats WHERE user_id = ?', [userId]);
    return { snowballHits: rows[0]?.snowball_hits ?? 0, snowballTaken: rows[0]?.snowball_taken ?? 0 };
  }

  async recordHit(fromId: number, toId: number) {
    await this.db.query('INSERT INTO stats (user_id, snowball_hits) VALUES (?, 1) ON DUPLICATE KEY UPDATE snowball_hits = snowball_hits + 1', [fromId]);
    await this.db.query('INSERT INTO stats (user_id, snowball_taken) VALUES (?, 1) ON DUPLICATE KEY UPDATE snowball_taken = snowball_taken + 1', [toId]);
  }

  /** Top 50 for a board, plus the viewer's own row if they're further down. */
  async leaderboard(board: 'stars' | GameId, viewerId: number | null): Promise<{ rows: LeaderRow[]; me: LeaderRow | null }> {
    const ranked =
      board === 'stars'
        ? `SELECT u.id, u.username, u.character_id, SUM(p.best_stars) AS value, SUM(p.best_stars > 0) AS ornaments,
             RANK() OVER (ORDER BY SUM(p.best_stars) DESC, SUM(p.best_stars > 0) DESC) AS rnk, MAX(p.updated_at) AS t
           FROM progress p JOIN users u ON u.id = p.user_id
           WHERE u.username IS NOT NULL AND u.banned_at IS NULL
           GROUP BY u.id HAVING value > 0`
        : `SELECT u.id, u.username, u.character_id, p.best_score AS value, p.best_stars AS stars,
             RANK() OVER (ORDER BY p.best_score DESC) AS rnk, p.updated_at AS t
           FROM progress p JOIN users u ON u.id = p.user_id
           WHERE p.game_id = ? AND p.best_score > 0 AND u.username IS NOT NULL AND u.banned_at IS NULL`;
    const params: unknown[] = board === 'stars' ? [] : [board];
    const [rows] = await this.db.query<Row[]>(`WITH t AS (${ranked}) SELECT * FROM t WHERE rnk <= 50 OR id = ? ORDER BY rnk, t LIMIT 51`, [...params, viewerId ?? 0]);
    const map = (r: Row): LeaderRow => ({
      rank: Number(r.rnk),
      userId: r.id,
      username: r.username,
      characterId: r.character_id,
      value: Number(r.value),
      ...(board === 'stars' ? { ornaments: Number(r.ornaments) } : { stars: Number(r.stars) }),
    });
    const all = rows.map(map);
    return { rows: all.filter((r) => r.rank <= 50).slice(0, 50), me: all.find((r) => r.userId === viewerId) ?? null };
  }
}

export const BOARDS = ['stars', ...GAME_IDS] as const;
