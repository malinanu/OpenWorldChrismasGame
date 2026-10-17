import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Pool, Row } from './db.ts';
import type { SmsSender } from './sms.ts';

export interface User {
  id: number;
  username: string | null;
  email: string | null;
  phone: string | null;
  characterId: string;
  role: 'player' | 'admin';
}

export class AuthError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const OTP_TTL_MIN = 5;
const OTP_MAX_ATTEMPTS = 5;

function toUser(r: Row): User {
  return { id: r.id, username: r.username, email: r.email, phone: r.phone, characterId: r.character_id, role: r.role };
}

/** Accounts, sessions and one-time codes. All SQL for auth lives here. */
export class Auth {
  private readonly db: Pool;
  private readonly sms: SmsSender;
  private readonly sessionDays: number;

  constructor(db: Pool, sms: SmsSender, sessionDays: number) {
    this.db = db;
    this.sms = sms;
    this.sessionDays = sessionDays;
  }

  // ------------------------------------------------------------- sessions

  async createSession(userId: number, userAgent?: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.db.query('INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY), ?)', [
      sha256(token),
      userId,
      this.sessionDays,
      userAgent?.slice(0, 200) ?? null,
    ]);
    return token;
  }

  /** The signed-in user for a bearer token, or null. Extends the session (sliding expiry). */
  async userForToken(token: string | undefined | null): Promise<User | null> {
    if (!token || token.length > 100) return null;
    const hash = sha256(token);
    const [rows] = await this.db.query<Row[]>(
      'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP() AND u.banned_at IS NULL',
      [hash],
    );
    if (!rows[0]) return null;
    await this.db.query('UPDATE sessions SET expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY) WHERE token_hash = ?', [this.sessionDays, hash]);
    await this.db.query('UPDATE users SET last_seen_at = UTC_TIMESTAMP() WHERE id = ?', [rows[0].id]);
    return toUser(rows[0]);
  }

  async logout(token: string) {
    await this.db.query('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
  }

  async userById(id: number): Promise<User | null> {
    const [rows] = await this.db.query<Row[]>('SELECT * FROM users WHERE id = ?', [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  // ------------------------------------------------------------- email + password

  async register(email: string, password: string, username: string): Promise<User> {
    email = email.trim().toLowerCase();
    await this.assertUsernameFree(username);
    const [dupe] = await this.db.query<Row[]>('SELECT id FROM users WHERE email = ?', [email]);
    if (dupe[0]) throw new AuthError(409, 'email_taken', 'An account with this email already exists.');
    const hash = await bcrypt.hash(password, 10);
    const [res] = await this.db.query<import('mysql2').ResultSetHeader>('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)', [username, email, hash]);
    return (await this.userById(res.insertId))!;
  }

  async login(email: string, password: string): Promise<User> {
    const [rows] = await this.db.query<Row[]>('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    const r = rows[0];
    // Compare against a dummy hash when the account doesn't exist, so timing doesn't reveal it.
    const ok = await bcrypt.compare(password, r?.password_hash ?? '$2b$10$CwTycUXWue0Thq9StjUM0uJ8.ucR6f/4X4gBG5U5i1n2s3EorGc2e');
    if (!r || !ok) throw new AuthError(401, 'bad_credentials', 'Wrong email or password.');
    if (r.banned_at) throw new AuthError(403, 'banned', 'This account is suspended.');
    return toUser(r);
  }

  // ------------------------------------------------------------- phone + one-time code

  async requestOtp(phone: string, ip: string): Promise<void> {
    const [[recent]] = await this.db.query<Row[]>(
      `SELECT
         SUM(phone = ? AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 60 SECOND)) AS last_min,
         SUM(phone = ? AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR)) AS phone_hour,
         SUM(ip = ? AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR)) AS ip_hour
       FROM otp_codes WHERE (phone = ? OR ip = ?) AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR)`,
      [phone, phone, ip, phone, ip],
    );
    if (Number(recent?.last_min) > 0) throw new AuthError(429, 'otp_wait', 'Please wait a minute before asking for another code.');
    if (Number(recent?.phone_hour) >= 5 || Number(recent?.ip_hour) >= 10) throw new AuthError(429, 'otp_limit', 'Too many codes requested. Try again later.');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.db.query('INSERT INTO otp_codes (phone, code_hash, ip, expires_at) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE))', [
      phone,
      sha256(`${phone}:${code}`),
      ip,
      OTP_TTL_MIN,
    ]);
    await this.sms.send(phone, `Your Frostvale code is ${code}. It expires in ${OTP_TTL_MIN} minutes.`);
  }

  /** Checks the latest code for this phone; signs in (creating the account on first use). */
  async verifyOtp(phone: string, code: string): Promise<User> {
    const [rows] = await this.db.query<Row[]>(
      'SELECT * FROM otp_codes WHERE phone = ? AND consumed_at IS NULL AND expires_at > UTC_TIMESTAMP() ORDER BY id DESC LIMIT 1',
      [phone],
    );
    const otp = rows[0];
    if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) throw new AuthError(400, 'otp_expired', 'That code has expired. Ask for a new one.');
    await this.db.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', [otp.id]);
    const want = Buffer.from(otp.code_hash, 'hex');
    const got = Buffer.from(sha256(`${phone}:${code}`), 'hex');
    if (!timingSafeEqual(want, got)) throw new AuthError(400, 'otp_wrong', 'That code is not right.');
    await this.db.query('UPDATE otp_codes SET consumed_at = UTC_TIMESTAMP() WHERE id = ?', [otp.id]);
    const [users] = await this.db.query<Row[]>('SELECT * FROM users WHERE phone = ?', [phone]);
    if (users[0]) {
      if (users[0].banned_at) throw new AuthError(403, 'banned', 'This account is suspended.');
      await this.db.query('UPDATE users SET phone_verified_at = UTC_TIMESTAMP() WHERE id = ?', [users[0].id]);
      return toUser(users[0]);
    }
    const [res] = await this.db.query<import('mysql2').ResultSetHeader>('INSERT INTO users (phone, phone_verified_at) VALUES (?, UTC_TIMESTAMP())', [phone]);
    return (await this.userById(res.insertId))!;
  }

  // ------------------------------------------------------------- profile

  async assertUsernameFree(username: string, exceptUserId?: number) {
    if (!USERNAME_RE.test(username)) throw new AuthError(400, 'bad_username', 'Usernames are 3–16 letters, numbers or _.');
    const [rows] = await this.db.query<Row[]>('SELECT id FROM users WHERE username = ?', [username]);
    if (rows[0] && rows[0].id !== exceptUserId) throw new AuthError(409, 'username_taken', 'That username is taken.');
  }

  async updateProfile(userId: number, patch: { username?: string; characterId?: string }): Promise<User> {
    if (patch.username !== undefined) {
      await this.assertUsernameFree(patch.username, userId);
      await this.db.query('UPDATE users SET username = ? WHERE id = ?', [patch.username, userId]);
    }
    if (patch.characterId !== undefined) await this.db.query('UPDATE users SET character_id = ? WHERE id = ?', [patch.characterId, userId]);
    return (await this.userById(userId))!;
  }
}
