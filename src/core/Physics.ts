import type * as R from '@dimforge/rapier3d';

/**
 * Rapier, filled in by `initPhysics()`. The engine is a 3 MB WebAssembly module, so it is
 * imported dynamically: the loading screen shows straight away and it downloads alongside
 * the models (see the rapier-gzip plugin in vite.config.ts).
 */
export let RAPIER = {} as typeof R;
// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace RAPIER {
  type World = R.World;
  type Collider = R.Collider;
  type RigidBody = R.RigidBody;
  type KinematicCharacterController = R.KinematicCharacterController;
}

let ready: Promise<void> | null = null;

/** Must resolve once before any world is created. */
export function initPhysics(): Promise<void> {
  ready ??= import('@dimforge/rapier3d').then((m) => {
    RAPIER = m;
  });
  return ready;
}
/** Thin wrapper around a Rapier world with a fixed-timestep accumulator. */
export class Physics {
  readonly world: RAPIER.World;
  private accumulator = 0;
  private readonly step = 1 / 60;

  constructor(gravity = -20) {
    this.world = new RAPIER.World({ x: 0, y: gravity, z: 0 });
    this.world.timestep = this.step;
  }

  update(dt: number) {
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= this.step && steps < 4) {
      this.world.step();
      this.accumulator -= this.step;
      steps++;
    }
    if (steps === 4) this.accumulator = 0;
  }

  dispose() {
    this.world.free();
  }
}
