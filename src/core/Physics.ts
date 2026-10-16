import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };

let ready: Promise<void> | null = null;

/** Rapier ships as WASM; it must be initialised once before any world is created. */
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init();
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
