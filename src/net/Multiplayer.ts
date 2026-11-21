import { api } from './api';
import { setFightTables } from '../fight/weapons';

/** Server physics for snowballs (server/src/realtime.ts) — the client draws the same arcs. */
export const SNOW_GRAVITY = 20;

export interface RemoteProfile {
  id: number;
  name: string;
  char: string;
}

export interface Snapshot {
  /** Local receive time (ms) — rendering interpolates 100 ms behind the newest. */
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  a: string;
  busy: boolean;
  /** Fight zones (1-based indices; 0 = not fighting) and health. */
  arena: number;
  weapon: number;
  hp: number;
}

/** A hit in a fight zone, decided by the server. */
export interface Melee {
  from: number;
  to: number;
  w: string;
  /** Damage dealt and the target's health after it. */
  d: number;
  hp: number;
  /** Shove (m/s, x and z); zero when guarded. */
  kb: [number, number];
  blk: number;
  at: [number, number, number];
}

export interface LocalState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  a: string;
  busy: boolean;
}

type Events = {
  join: (p: RemoteProfile) => void;
  leave: (id: number) => void;
  throw: (from: number, o: number[], v: number[]) => void;
  hit: (from: number, to: number, at: number[]) => void;
  status: (online: boolean) => void;
  /** Someone joined (a = arena) or left (a = null) a fight zone. `why` = 'out' when out of lives. */
  fighter: (m: { id: number; a: string | null; w: string | null; hp: number; lives?: number; why?: string }) => void;
  swing: (id: number, w: string) => void;
  melee: (m: Melee) => void;
  ko: (from: number, to: number, w: string, lives?: number) => void;
  respawn: (id: number, at: [number, number], yaw: number) => void;
  /** Our token balance changed (paid to fight, or bought more). */
  tokens: (n: number) => void;
  /** The server refused to let us fight (e.g. not enough tokens). */
  arenaError: (m: { code: string; need?: number; have?: number }) => void;
};

/**
 * The shared-village connection: reconnects with backoff, keeps a short snapshot buffer per
 * remote player, and sends our own state 10×/s from a timer (so it keeps going — as "busy" —
 * while a mini-game is on screen and the overworld isn't updating).
 */
export class Multiplayer {
  myId = 0;
  readonly players = new Map<number, RemoteProfile & { snaps: Snapshot[] }>();
  private ws: WebSocket | null = null;
  private retry = 0;
  private closed = false;
  private sendTimer = 0;
  private listeners: { [K in keyof Events]: Events[K][] } = {
    join: [], leave: [], throw: [], hit: [], status: [], fighter: [], swing: [], melee: [], ko: [], respawn: [], tokens: [], arenaError: [],
  };
  connected = false;

  constructor(private readonly state: () => LocalState | null) {}

  on<K extends keyof Events>(ev: K, fn: Events[K]) {
    this.listeners[ev].push(fn);
  }

  private emit<K extends keyof Events>(ev: K, ...args: Parameters<Events[K]>) {
    for (const fn of this.listeners[ev]) (fn as (...a: Parameters<Events[K]>) => void)(...args);
  }

  connect() {
    this.closed = false;
    const ws = new WebSocket(api.socketUrl());
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.connected = true;
      this.emit('status', true);
    };
    ws.onmessage = (e) => {
      let m: any;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      this.handle(m);
    };
    ws.onclose = (e) => {
      this.connected = false;
      this.emit('status', false);
      for (const id of [...this.players.keys()]) this.remove(id);
      // 4000: this account connected somewhere else — don't fight over it.
      if (this.closed || e.code === 4000) return;
      const wait = [1000, 2000, 5000, 10000][Math.min(this.retry++, 3)];
      setTimeout(() => !this.closed && this.connect(), wait);
    };
    if (!this.sendTimer) this.sendTimer = window.setInterval(() => this.sendState(), 100);
  }

  close() {
    this.closed = true;
    clearInterval(this.sendTimer);
    this.sendTimer = 0;
    this.ws?.close();
  }

  throw(o: number[], v: number[]) {
    this.send({ t: 'throw', o, v });
  }

  /** Join a fight zone with a weapon, or leave it (`null`). Our position goes first so the server sees us inside. */
  arena(a: string | null, w: string | null = null) {
    this.sendState();
    this.send({ t: 'arena', a, w });
  }

  /** A swing; the server decides what it hits from where we are right now. */
  attack() {
    this.sendState();
    this.send({ t: 'attack' });
  }

  /** Send our state now instead of at the next tick (guard up or down). */
  sendNow() {
    this.sendState();
  }

  private send(m: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private sendState() {
    const s = this.state();
    if (s) this.send({ t: 'state', ...s });
  }

  private remove(id: number) {
    if (this.players.delete(id)) this.emit('leave', id);
  }

  private upsert(p: RemoteProfile) {
    if (p.id === this.myId) return;
    const cur = this.players.get(p.id);
    if (cur) Object.assign(cur, p);
    else this.players.set(p.id, { ...p, snaps: [] });
    this.emit('join', p);
  }

  private handle(m: any) {
    switch (m.t) {
      case 'welcome':
        this.myId = m.id;
        setFightTables(m.fight);
        for (const p of m.players as RemoteProfile[]) this.upsert(p);
        break;
      case 'join':
        this.upsert(m.p);
        break;
      case 'leave':
        this.remove(m.id);
        break;
      case 'snap': {
        const now = performance.now();
        for (const [id, x, y, z, yaw, a, busy, arena, weapon, hp] of m.p as [number, number, number, number, number, string, number, number?, number?, number?][]) {
          const p = this.players.get(id);
          if (!p) continue;
          p.snaps.push({ t: now, x, y, z, yaw, a, busy: !!busy, arena: arena ?? 0, weapon: weapon ?? 0, hp: hp ?? 100 });
          if (p.snaps.length > 12) p.snaps.shift();
        }
        break;
      }
      case 'throw':
        this.emit('throw', m.id, m.o, m.v);
        break;
      case 'hit':
        this.emit('hit', m.from, m.to, m.at);
        break;
      case 'fighter':
        this.emit('fighter', m);
        break;
      case 'swing':
        this.emit('swing', m.id, m.w);
        break;
      case 'melee':
        this.emit('melee', m as Melee);
        break;
      case 'ko':
        this.emit('ko', m.from, m.to, m.w, m.lives);
        break;
      case 'respawn':
        this.emit('respawn', m.id, m.at, m.yaw);
        break;
      case 'tokens':
        this.emit('tokens', m.n);
        break;
      case 'arena_err':
        this.emit('arenaError', m);
        break;
    }
  }
}
