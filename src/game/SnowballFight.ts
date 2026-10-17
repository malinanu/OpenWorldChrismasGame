import * as THREE from 'three';
import { assets } from '../core/AssetLoader';
import { audio } from '../core/Audio';
import { haptic, type Input } from '../core/Input';
import { SNOW_GRAVITY, type LocalState, type Multiplayer } from '../net/Multiplayer';
import type { Hud } from '../ui/hud';
import { Burst } from '../vfx/Burst';
import type { Player } from './Player';
import { RemotePlayer } from './RemotePlayer';

const SCOOP_TIME = 0.6;
const THROW_COOLDOWN = 0.45;
const BALL_LIFE = 1.6;
const AIM_CONE = (18 * Math.PI) / 180;
const AIM_RANGE = 28;

interface Ball {
  mesh: THREE.Object3D;
  p: THREE.Vector3;
  v: THREE.Vector3;
  age: number;
}

/**
 * Snowball fights in the village: scoop a snowball (button / F / right-click), then throw it
 * along the camera's aim with a gentle lock-on to the nearest player in front. Draws everyone's
 * snowballs and other players; the server decides who got hit.
 */
export class SnowballFight {
  readonly group = new THREE.Group();
  private ballModel!: THREE.Object3D;
  private inHand: THREE.Object3D | null = null;
  private puffs!: Burst;
  private balls: Ball[] = [];
  private remotes = new Map<number, RemotePlayer>();
  private clips: THREE.AnimationClip[] = [];
  private scoop = 0;
  private throwAnim = 0;
  private cooldown = 0;
  private mp: Multiplayer | null = null;
  private busy = () => false;

  constructor(
    private readonly player: Player,
    private readonly hud: Hud,
    private readonly groundY: (x: number, z: number) => number,
  ) {}

  async load() {
    const [ball, clips, smoke] = await Promise.all([
      assets.model('holiday/snowball'),
      assets.model('animations/Frostvale_Clips.glb'),
      assets.texture('vfx/smoke.png'),
    ]);
    this.ballModel = ball.scene;
    this.clips = clips.animations;
    this.puffs = new Burst(smoke, 400, false, -4);
    this.group.add(this.puffs.points);
  }

  /** Has a snowball ready to throw. */
  get holding() {
    return !!this.inHand;
  }

  /** Join the shared village; `busy` reports when a mini-game is on screen. */
  goOnline(mp: Multiplayer, busy: () => boolean) {
    this.mp = mp;
    this.busy = busy;
    mp.on('join', (p) => {
      const r = this.remotes.get(p.id);
      if (r) r.setProfile(p.name, p.char);
      else {
        const nr = new RemotePlayer(this.clips, p.name, p.char);
        this.remotes.set(p.id, nr);
        this.group.add(nr.object);
      }
    });
    mp.on('leave', (id) => {
      this.remotes.get(id)?.dispose();
      this.remotes.delete(id);
    });
    mp.on('throw', (_from, o, v) => this.spawnBall(new THREE.Vector3(...o), new THREE.Vector3(...v)));
    mp.on('hit', (from, to, at) => this.onHit(from, to, new THREE.Vector3(...at)));
  }

  /** What we tell the server each tick. */
  localState(): LocalState {
    const p = this.player.position;
    const a = this.scoop > 0 ? 'scoop' : this.throwAnim > 0 ? 'throw' : !this.player.isGrounded ? 'jump' : this.player.speed > 7 ? 'run' : this.player.speed > 0.5 ? 'walk' : 'idle';
    return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), yaw: +this.player.facingAngle.toFixed(2), a, busy: this.busy() };
  }

  update(dt: number, input: Input | null, cameraYaw: number, pr: number) {
    this.cooldown -= dt;
    this.throwAnim = Math.max(0, this.throwAnim - dt);
    if (this.scoop > 0) {
      this.scoop -= dt;
      if (this.scoop <= 0) this.grabBall();
    } else if (input?.justPressed('throw') && this.cooldown <= 0) {
      if (this.inHand) this.throwBall(cameraYaw);
      else this.startScoop();
    }
    // The snowball rides in the right hand.
    if (this.inHand) {
      const f = this.player.facingAngle;
      this.inHand.position.set(this.player.position.x + Math.cos(f) * -0.38 + Math.sin(f) * 0.2, this.player.position.y + 1.0, this.player.position.z - Math.sin(f) * -0.38 + Math.cos(f) * 0.2);
    }
    for (const [id, r] of this.remotes) r.update(dt, this.mp?.players.get(id)?.snaps ?? []);
    this.updateBalls(dt);
    this.puffs.update(dt, pr);
  }

  private startScoop() {
    this.scoop = SCOOP_TIME;
    this.player.playOnce('Interact');
    audio.sfx('step', 0.6);
    this.puffs.emit(this.player.position.clone().setY(this.player.position.y + 0.2), 10, { color: '#ffffff', speed: 1.5, up: 1, size: 0.8, life: 0.5 });
  }

  private grabBall() {
    this.inHand = this.ballModel.clone(true);
    this.inHand.scale.setScalar(0.9);
    this.group.add(this.inHand);
    audio.sfx('pick');
    haptic(10);
  }

  /** Lock onto the nearest player in front of the camera; otherwise lob ~16 m ahead. */
  private aimTarget(cameraYaw: number): THREE.Vector3 {
    const from = this.player.position;
    const fwd = new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
    let best: THREE.Vector3 | null = null;
    let bestAngle = AIM_CONE;
    for (const r of this.remotes.values()) {
      if (!r.object.visible) continue;
      const to = r.chest.sub(from);
      const d = Math.hypot(to.x, to.z);
      if (d < 1 || d > AIM_RANGE) continue;
      const ang = Math.acos(THREE.MathUtils.clamp((to.x * fwd.x + to.z * fwd.z) / d, -1, 1));
      if (ang < bestAngle) {
        bestAngle = ang;
        best = r.chest;
      }
    }
    if (best) return best;
    const ahead = from.clone().addScaledVector(fwd, 16);
    ahead.y = this.groundY(ahead.x, ahead.z) + 0.6;
    return ahead;
  }

  private throwBall(cameraYaw: number) {
    const target = this.aimTarget(cameraYaw);
    const p = this.player.position;
    const dir = target.clone().sub(p).setY(0).normalize();
    // Face the throw, release from the shoulder.
    this.player.faceTowards(Math.atan2(dir.x, dir.z));
    const o = p.clone().addScaledVector(dir, 0.6).setY(p.y + 1.5);
    const dist = Math.hypot(target.x - o.x, target.z - o.z);
    const t = THREE.MathUtils.clamp(dist / 24, 0.3, 1);
    const v = new THREE.Vector3((target.x - o.x) / t, (target.y - o.y + 0.5 * SNOW_GRAVITY * t * t) / t, (target.z - o.z) / t);
    if (this.inHand) this.group.remove(this.inHand);
    this.inHand = null;
    this.cooldown = THROW_COOLDOWN;
    this.throwAnim = 0.4;
    this.player.playOnce('Interact');
    this.spawnBall(o, v);
    this.mp?.throw(o.toArray().map((n) => +n.toFixed(2)), v.toArray().map((n) => +n.toFixed(2)));
    audio.sfx('throw', 0.9 + Math.random() * 0.2);
    haptic(12);
  }

  private spawnBall(p: THREE.Vector3, v: THREE.Vector3) {
    const mesh = this.ballModel.clone(true);
    mesh.scale.setScalar(0.9);
    mesh.position.copy(p);
    this.group.add(mesh);
    this.balls.push({ mesh, p: p.clone(), v: v.clone(), age: 0 });
  }

  private updateBalls(dt: number) {
    this.balls = this.balls.filter((b) => {
      b.age += dt;
      b.v.y -= SNOW_GRAVITY * dt;
      b.p.addScaledVector(b.v, dt);
      b.mesh.position.copy(b.p);
      const ground = this.groundY(b.p.x, b.p.z);
      if (b.age > BALL_LIFE || b.p.y < ground) {
        if (b.p.y < ground + 0.5) this.puffs.emit(b.p.clone().setY(ground + 0.2), 14, { color: '#ffffff', speed: 2.5, up: 1.5, size: 0.9, life: 0.6 });
        this.group.remove(b.mesh);
        return false;
      }
      return true;
    });
  }

  private onHit(from: number, to: number, at: THREE.Vector3) {
    // The server confirmed a hit: drop the ball nearest to where it landed.
    let near: Ball | null = null;
    for (const b of this.balls) if (!near || b.p.distanceToSquared(at) < near.p.distanceToSquared(at)) near = b;
    if (near && near.p.distanceTo(at) < 4) {
      this.group.remove(near.mesh);
      this.balls.splice(this.balls.indexOf(near), 1);
    }
    this.puffs.emit(at, 30, { color: '#ffffff', speed: 4.5, up: 2, size: 1.3, life: 0.8 });
    const me = this.mp?.myId;
    const name = (id: number) => this.mp?.players.get(id)?.name ?? 'Someone';
    if (to === me) {
      audio.sfx('hit');
      haptic([30, 30, 60]);
      this.hud.toast(`❄️ ${name(from)} got you!`, 1800);
    } else {
      this.remotes.get(to)?.hit();
      if (from === me) {
        audio.sfx('hit');
        this.hud.toast(`🎯 You hit ${name(to)}!`, 1800);
      }
    }
  }
}
