/**
 * Talks to the Frostvale server (same origin: /api, /ws). Keeps the session token in
 * localStorage. Every call fails soft: if the server isn't there, the game plays offline.
 */

import { lang, type Lang } from '../i18n';
import { t } from '../i18n/ui';

export interface User {
  id: number;
  username: string | null;
  email: string | null;
  phone: string | null;
  characterId: string;
  role: 'player' | 'admin';
  language: Lang;
  /** ISO time the account was made. */
  createdAt: string | null;
}

export interface ServerConfig {
  authMode: 'email' | 'phone';
  characters: string[];
}

export interface LeaderRow {
  rank: number;
  userId: number;
  username: string;
  characterId: string;
  value: number;
  ornaments?: number;
  stars?: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** The message is shown in the player's language when the code is known. */
  constructor(status: number, code: string, message: string) {
    const key = `err_${code}`;
    super(t.has(key) ? t(key) : message);
    this.status = status;
    this.code = code;
  }
}

const TOKEN_KEY = 'frostvale.token';
const BASE = `${import.meta.env.BASE_URL}api`;

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

class Api {
  token: string | null = readToken();
  user: User | null = null;

  get online() {
    return !!this.user;
  }

  private setToken(t: string | null) {
    this.token = t;
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* private mode: the session lasts for this visit only */
    }
  }

  private async call<T>(method: string, path: string, body?: unknown, timeoutMs = 8000): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(BASE + path, {
        method,
        signal: ctrl.signal,
        headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, 'offline', "Can't reach the Frostvale server.");
    } finally {
      clearTimeout(timer);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      if (res.status === 401) {
        this.setToken(null);
        this.user = null;
      }
      throw new ApiError(res.status, data?.error ?? 'offline', data?.message ?? "Can't reach the Frostvale server.");
    }
    return data as T;
  }

  /** Server settings, or null when there is no server (plain static hosting / offline). */
  async config(): Promise<ServerConfig | null> {
    try {
      return await this.call<ServerConfig>('GET', '/config', undefined, 4000);
    } catch {
      return null;
    }
  }

  private signedIn(r: { token: string; user: User }) {
    this.setToken(r.token);
    this.user = r.user;
    return r.user;
  }

  async register(email: string, password: string, username: string) {
    return this.signedIn(await this.call('POST', '/auth/register', { email, password, username, language: lang() }));
  }

  async login(email: string, password: string) {
    return this.signedIn(await this.call('POST', '/auth/login', { email, password }));
  }

  async requestCode(phone: string) {
    await this.call('POST', '/auth/otp/request', { phone, language: lang() });
  }

  async verifyCode(phone: string, code: string) {
    return this.signedIn(await this.call('POST', '/auth/otp/verify', { phone, code, language: lang() }));
  }

  async logout() {
    await this.call('POST', '/auth/logout').catch(() => {});
    this.setToken(null);
    this.user = null;
  }

  /** Restores a saved session. Null if there's none or it expired. */
  async me(): Promise<{ user: User; progress: Record<string, { score: number; stars: number }>; stats: { snowballHits: number; snowballTaken: number } } | null> {
    if (!this.token) return null;
    try {
      const r = await this.call<{ user: User; progress: Record<string, { score: number; stars: number }>; stats: { snowballHits: number; snowballTaken: number } }>('GET', '/me');
      this.user = r.user;
      return r;
    } catch {
      return null;
    }
  }

  async updateMe(patch: { username?: string; characterId?: string; language?: Lang }) {
    const r = await this.call<{ user: User }>('PUT', '/me', patch);
    this.user = r.user;
    return r.user;
  }

  /** Best results per mini-game; the server keeps the max. Silently skipped when offline. */
  async saveProgress(games: Record<string, { score: number }>) {
    if (!this.online) return null;
    try {
      return (await this.call<{ progress: Record<string, { score: number; stars: number }> }>('PUT', '/progress', { games })).progress;
    } catch {
      return null;
    }
  }

  async leaderboard(board: string) {
    return this.call<{ rows: LeaderRow[]; me: LeaderRow | null }>('GET', `/leaderboard?board=${encodeURIComponent(board)}`);
  }

  /** WebSocket URL for the shared village. */
  socketUrl() {
    const url = new URL('ws', new URL(import.meta.env.BASE_URL, location.href));
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('token', this.token ?? '');
    return url.toString();
  }
}

export const api = new Api();

/** The Adventurers' names in the current language (`CHARACTER_NAMES[id]`). */
export const CHARACTER_NAMES: Record<string, string> = new Proxy({} as Record<string, string>, {
  get: (_, id) => {
    const key = `char_${String(id)}`;
    return t.has(key) ? t(key) : undefined;
  },
});
