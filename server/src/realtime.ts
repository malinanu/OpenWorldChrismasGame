import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Auth, User } from './auth.ts';
import type { Progress } from './progress.ts';

/**
 * The shared village over WebSocket (`/ws?token=…`).
 *
 * Players are grouped into rooms of up to ROOM_SIZE. Each client sends its state ~10×/s; the
 * server broadcasts a snapshot of the room 10×/s. Snowballs are simulated here (same ballistic
 * maths as the client) and only the server decides hits, so a modified client can't fake them.
 *
 * Client → server: {t:'state',x,y,z,yaw,a,busy} · {t:'throw',o:[x,y,z],v:[x,y,z]}
 * Server → client: welcome · join · leave · snap · throw · hit
 */

export const ROOM_SIZE = 30;
const SNAP_HZ = 10;
const SIM_HZ = 30;
export const GRAVITY = 20;
const BALL_LIFE = 1.6;
const BALL_RADIUS = 0.25;
/** Player hit capsule: from the feet + 0.2 m to + 1.7 m, this thick. */
const BODY_RADIUS = 0.5;
const MAX_THROW_SPEED = 36;
const THROW_COOLDOWN = 0.45;
const MAX_RUN_SPEED = 30;
const ANIMS = new Set(['idle', 'walk', 'run', 'jump', 'scoop', 'throw', 'cheer']);

interface PlayerState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  a: string;
  /** In a mini-game: shown as busy and can't be hit. */
  busy: boolean;
  at: number;
}

interface Conn {
  ws: WebSocket;
  user: User;
  room: Room;
  state: PlayerState | null;
  lastThrow: number;
  alive: boolean;
}

interface Ball {
  k: number;
  from: Conn;
  p: [number, number, number];
  v: [number, number, number];
  age: number;
}

interface Room {
  id: number;
  players: Map<number, Conn>;
  balls: Ball[];
}

const finite = (...n: unknown[]) => n.every((v) => typeof v === 'number' && Number.isFinite(v));
const r2 = (n: number) => Math.round(n * 100) / 100;
const profile = (u: User) => ({ id: u.id, name: u.username, char: u.characterId });

export class Realtime {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
  private readonly rooms: Room[] = [];
  private readonly byUser = new Map<number, Conn>();
  private nextRoom = 1;
  private nextBall = 1;
  private timers: NodeJS.Timeout[] = [];
  private readonly auth: Auth;
  private readonly progress: Progress;

  constructor(auth: Auth, progress: Progress) {
    this.auth = auth;
    this.progress = progress;
  }

  attach(server: Server) {
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname !== '/ws') return socket.destroy();
      void this.auth.userForToken(url.searchParams.get('token')).then(
        (user) => {
          if (!user || !user.username) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            return socket.destroy();
          }
          this.wss.handleUpgrade(req, socket, head, (ws) => this.join(ws, user, req));
        },
        () => socket.destroy(),
      );
    });
    this.timers.push(
      setInterval(() => this.snapshot(), 1000 / SNAP_HZ),
      setInterval(() => this.simulate(1 / SIM_HZ), 1000 / SIM_HZ),
      setInterval(() => this.heartbeat(), 20_000),
    );
  }

  close() {
    this.timers.forEach(clearInterval);
    for (const c of this.byUser.values()) c.ws.close(1001, 'server shutting down');
    this.wss.close();
  }

  /** Counts for health checks and the future admin panel. */
  get info() {
    return { players: this.byUser.size, rooms: this.rooms.map((r) => ({ id: r.id, players: r.players.size })) };
  }

  /** A player renamed or picked another character: refresh them for everyone in their room. */
  updateProfile(user: User) {
    const c = this.byUser.get(user.id);
    if (!c) return;
    c.user = user;
    this.broadcast(c.room, { t: 'join', p: profile(user) });
  }

  // ---------------------------------------------------------------- connections

  private join(ws: WebSocket, user: User, _req: IncomingMessage) {
    // One connection per account: a new tab or device replaces the old one.
    const old = this.byUser.get(user.id);
    if (old) {
      this.leave(old);
      old.ws.close(4000, 'replaced');
    }
    const room = this.rooms.find((r) => r.players.size < ROOM_SIZE) ?? this.newRoom();
    const conn: Conn = { ws, user, room, state: null, lastThrow: 0, alive: true };
    room.players.set(user.id, conn);
    this.byUser.set(user.id, conn);
    this.send(conn, { t: 'welcome', id: user.id, room: room.id, players: [...room.players.values()].map((c) => profile(c.user)) });
    this.broadcast(room, { t: 'join', p: profile(user) }, user.id);

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg.t === 'state') this.onState(conn, msg);
      else if (msg.t === 'throw') this.onThrow(conn, msg);
    });
    ws.on('pong', () => (conn.alive = true));
    ws.on('close', () => this.byUser.get(user.id) === conn && this.leave(conn));
    ws.on('error', () => ws.terminate());
  }

  private leave(conn: Conn) {
    const { room, user } = conn;
    if (room.players.get(user.id) !== conn) return;
    room.players.delete(user.id);
    this.byUser.delete(user.id);
    this.broadcast(room, { t: 'leave', id: user.id });
    if (room.players.size === 0) this.rooms.splice(this.rooms.indexOf(room), 1);
  }

  private newRoom(): Room {
    const room: Room = { id: this.nextRoom++, players: new Map(), balls: [] };
    this.rooms.push(room);
    return room;
  }

  private heartbeat() {
    for (const c of this.byUser.values()) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }

  // ---------------------------------------------------------------- messages

  private onState(c: Conn, m: Record<string, unknown>) {
    const { x, y, z, yaw } = m;
    if (!finite(x, y, z, yaw)) return;
    const [px, py, pz] = [x as number, y as number, z as number];
    if (Math.abs(px) > 300 || Math.abs(pz) > 300 || py < -30 || py > 120) return;
    const now = performance.now() / 1000;
    const prev = c.state;
    // Faster than anyone can run means a modified client; ignore it (a long gap allows a respawn).
    if (prev && now - prev.at < 3 && Math.hypot(px - prev.x, pz - prev.z) > MAX_RUN_SPEED * (now - prev.at) + 4) return;
    const a = typeof m.a === 'string' && ANIMS.has(m.a) ? m.a : 'idle';
    c.state = { x: px, y: py, z: pz, yaw: yaw as number, a, busy: m.busy === true, at: now };
  }

  private onThrow(c: Conn, m: Record<string, unknown>) {
    const o = m.o as number[];
    const v = m.v as number[];
    if (!Array.isArray(o) || !Array.isArray(v) || o.length !== 3 || v.length !== 3 || !finite(...o, ...v)) return;
    const s = c.state;
    const now = performance.now() / 1000;
    if (!s || s.busy || now - c.lastThrow < THROW_COOLDOWN) return;
    // The ball must start at the thrower's hand and not be faster than an arm can throw.
    if (Math.hypot(o[0] - s.x, o[2] - s.z) > 2.5 || o[1] - s.y < -0.5 || o[1] - s.y > 3) return;
    if (Math.hypot(v[0], v[1], v[2]) > MAX_THROW_SPEED) return;
    c.lastThrow = now;
    const ball: Ball = { k: this.nextBall++, from: c, p: [o[0], o[1], o[2]], v: [v[0], v[1], v[2]], age: 0 };
    c.room.balls.push(ball);
    this.broadcast(c.room, { t: 'throw', id: c.user.id, k: ball.k, o: o.map(r2), v: v.map(r2) }, c.user.id);
  }

  // ---------------------------------------------------------------- simulation

  private simulate(dt: number) {
    for (const room of this.rooms) {
      if (!room.balls.length) continue;
      const floor = Math.min(...[...room.players.values()].map((c) => c.state?.y ?? 0)) - 2;
      room.balls = room.balls.filter((b) => {
        b.age += dt;
        b.v[1] -= GRAVITY * dt;
        for (let i = 0; i < 3; i++) b.p[i] += b.v[i] * dt;
        if (b.age > BALL_LIFE || b.p[1] < floor) return false;
        for (const target of room.players.values()) {
          const s = target.state;
          if (target === b.from || !s || s.busy) continue;
          // Distance from the ball to the player's vertical capsule.
          const cy = Math.min(Math.max(b.p[1], s.y + 0.2), s.y + 1.7);
          if (Math.hypot(b.p[0] - s.x, b.p[1] - cy, b.p[2] - s.z) < BODY_RADIUS + BALL_RADIUS) {
            this.broadcast(room, { t: 'hit', from: b.from.user.id, to: target.user.id, k: b.k, at: b.p.map(r2) });
            void this.progress.recordHit(b.from.user.id, target.user.id).catch(() => {});
            return false;
          }
        }
        return true;
      });
    }
  }

  private snapshot() {
    for (const room of this.rooms) {
      const p = [...room.players.values()]
        .filter((c) => c.state)
        .map((c) => {
          const s = c.state!;
          return [c.user.id, r2(s.x), r2(s.y), r2(s.z), r2(s.yaw), s.a, s.busy ? 1 : 0];
        });
      if (p.length) this.broadcast(room, { t: 'snap', p });
    }
  }

  private send(c: Conn, msg: unknown) {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
  }

  private broadcast(room: Room, msg: unknown, except?: number) {
    const data = JSON.stringify(msg);
    for (const c of room.players.values()) if (c.user.id !== except && c.ws.readyState === c.ws.OPEN) c.ws.send(data);
  }
}
