import * as THREE from 'three';
import { audio } from '../core/Audio';
import { assets } from '../core/AssetLoader';
import type { Input } from '../core/Input';
import { RAPIER } from '../core/Physics';

/** Just the clips the game plays, merged by tools/optimize-assets.mjs. */
const ANIM_PACKS = ['animations/Frostvale_Clips.glb'];

type AnimName = 'Idle_A' | 'Walking_A' | 'Running_A' | 'Jump_Idle' | 'Jump_Start' | 'Jump_Land' | 'Cheering' | 'Waving' | 'Interact';

const WALK = 5.5;
const RUN = 10;
const JUMP = 9;
const GRAVITY = -26;
const HALF_HEIGHT = 0.55;
const RADIUS = 0.45;

/** Third-person KayKit character on a Rapier kinematic capsule. */
export class Player {
  readonly object = new THREE.Group();
  private model!: THREE.Object3D;
  private mixer!: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private current?: THREE.AnimationAction;
  private body!: RAPIER.RigidBody;
  collider!: RAPIER.Collider;
  private controller!: RAPIER.KinematicCharacterController;
  private velocityY = 0;
  private grounded = true;
  private facing = 0;
  private oneShot = false;
  private airTime = 0;
  private stepTimer = 0;
  /** Last finite body position, restored if the physics ever hands back NaN. */
  private safe = { x: 0, y: 2, z: 0 };
  /** Grounded with a little "coyote time", so tiny bumps don't count as leaving the ground. */
  get isGrounded() {
    return this.airTime < 0.2;
  }

  /** Which way the character faces (radians about Y). */
  get facingAngle() {
    return this.facing;
  }

  /** Horizontal speed this frame, used by the camera for a little FOV kick. */
  speed = 0;

  constructor(private readonly characterId = 'characters/Rogue_Hooded.glb') {}

  async load() {
    const [gltf, ...packs] = await Promise.all([assets.model(this.characterId), ...ANIM_PACKS.map((p) => assets.model(p))]);
    this.model = gltf.scene;
    this.object.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const pack of packs) {
      for (const clip of pack.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
    }
    for (const n of ['Jump_Start', 'Jump_Land', 'Cheering', 'Waving', 'Interact'] as const) {
      const a = this.actions.get(n);
      if (a) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
    }
    this.mixer.addEventListener('finished', () => {
      this.oneShot = false;
    });
    this.play('Idle_A', 0);
  }

  attach(world: RAPIER.World, spawn: THREE.Vector3) {
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + HALF_HEIGHT + RADIUS + 0.1, spawn.z),
    );
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(HALF_HEIGHT, RADIUS), this.body);
    this.controller = world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setMaxSlopeClimbAngle((55 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((40 * Math.PI) / 180);
    this.controller.enableAutostep(0.5, 0.2, true);
    this.controller.enableSnapToGround(0.6);
    const t = this.body.translation();
    this.safe = { x: t.x, y: t.y, z: t.z };
    this.syncObject();
  }

  get position(): THREE.Vector3 {
    return this.object.position;
  }

  teleport(p: THREE.Vector3) {
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + HALF_HEIGHT + RADIUS + 0.1, z: p.z });
    this.body.setTranslation({ x: p.x, y: p.y + HALF_HEIGHT + RADIUS + 0.1, z: p.z }, true);
    this.velocityY = 0;
    this.safe = { x: p.x, y: p.y + HALF_HEIGHT + RADIUS + 0.1, z: p.z };
    this.syncObject();
  }

  faceTowards(yaw: number) {
    this.facing = yaw;
    this.model.rotation.y = yaw;
  }

  play(name: AnimName, fade = 0.2) {
    const next = this.actions.get(name);
    if (!next || next === this.current) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    this.current?.fadeOut(fade);
    this.current = next;
  }

  /** Play a non-looping clip (cheer, wave) that blocks locomotion anims until it ends. */
  playOnce(name: AnimName) {
    this.oneShot = true;
    this.current = undefined;
    this.play(name, 0.15);
  }

  update(dt: number, input: Input, cameraYaw: number) {
    const move = input.move();
    const sprint = input.isDown('sprint');
    // Camera-relative movement: forward is away from the camera.
    const fwd = new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const dir = fwd.multiplyScalar(move.y).add(right.multiplyScalar(move.x));
    const moving = dir.lengthSq() > 0.01;
    const speed = (sprint ? RUN : WALK) * Math.min(1, dir.length());
    if (moving) dir.normalize();

    if (this.grounded && input.justPressed('jump')) {
      this.velocityY = JUMP;
      audio.sfx('jump');
      this.grounded = false;
      if (!this.oneShot) this.play('Jump_Start', 0.1);
    }
    this.velocityY += GRAVITY * dt;

    const desired = { x: dir.x * speed * dt, y: this.velocityY * dt, z: dir.z * speed * dt };
    this.controller.computeColliderMovement(this.collider, desired);
    const m = this.controller.computedMovement();
    const t = this.body.translation();
    if (!Number.isFinite(m.x + m.y + m.z + t.x + t.y + t.z)) {
      // Degenerate contact (e.g. spawned inside a collider): drop this step and go back to the last good spot.
      this.body.setTranslation(this.safe, true);
      this.body.setNextKinematicTranslation(this.safe);
      this.velocityY = 0;
      this.mixer.update(dt);
      return;
    }
    this.safe = { x: t.x, y: t.y, z: t.z };
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.airTime > 0.35) audio.sfx('step', 0.6); // landing thump
    this.airTime = this.grounded ? 0 : this.airTime + dt;
    if (this.grounded && this.velocityY < 0) this.velocityY = -1;
    this.speed = Math.hypot(m.x, m.z) / Math.max(dt, 1e-4);
    // Crunchy footsteps in the snow, faster when running.
    this.stepTimer -= dt;
    if (this.grounded && moving && this.speed > 0.5 && this.stepTimer <= 0) {
      this.stepTimer = sprint ? 0.28 : 0.42;
      audio.sfx('step', 0.85 + Math.random() * 0.3);
    }

    if (moving) {
      const target = Math.atan2(dir.x, dir.z);
      let delta = target - this.facing;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      this.facing += delta * Math.min(1, dt * 12);
      this.model.rotation.y = this.facing;
    }

    if (moving && this.oneShot) this.oneShot = false;
    if (!this.oneShot) {
      if (!this.grounded && this.velocityY < 2) this.play('Jump_Idle', 0.15);
      else if (this.grounded && !wasGrounded) this.play(moving ? (sprint ? 'Running_A' : 'Walking_A') : 'Idle_A', 0.15);
      else if (this.grounded) this.play(moving ? (sprint ? 'Running_A' : 'Walking_A') : 'Idle_A');
    }
    this.mixer.update(dt);
  }

  /** Copy the physics body (which the world just stepped) onto the visual. */
  syncObject() {
    const t = this.body.translation();
    this.object.position.set(t.x, t.y - HALF_HEIGHT - RADIUS, t.z);
  }

  /** Keep the idle anim ticking while a mini-game or menu is up. */
  animate(dt: number) {
    this.mixer.update(dt);
  }
}
