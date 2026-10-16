import * as THREE from 'three';
import type { MiniGameId } from '../minigames/MiniGame';
import { Beacon } from '../vfx/Beacon';

/**
 * A mini-game entrance: a beacon VFX plus a circular trigger area.
 * A cheap distance check stands in for a Rapier sensor — zones are few and round.
 */
export class GameZone {
  readonly beacon: Beacon;
  inside = false;

  constructor(
    readonly id: MiniGameId,
    readonly position: THREE.Vector3,
    readonly radius: number,
    sparkle: THREE.Texture,
    glow: THREE.Texture,
  ) {
    this.beacon = new Beacon(sparkle, glow);
    this.beacon.group.position.copy(position);
  }

  /** Returns 'enter' / 'exit' on the frame the player crosses the edge. */
  check(player: THREE.Vector3): 'enter' | 'exit' | null {
    const d = Math.hypot(player.x - this.position.x, player.z - this.position.z);
    const nowInside = d < this.radius;
    if (nowInside === this.inside) return null;
    this.inside = nowInside;
    return nowInside ? 'enter' : 'exit';
  }
}
