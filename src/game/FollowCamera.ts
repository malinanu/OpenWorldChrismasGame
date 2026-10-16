import * as THREE from 'three';
import type { Input } from '../core/Input';
import { RAPIER } from '../core/Physics';

/** Orbit-follow camera with mouse look, wheel zoom and collision pull-in. */
export class FollowCamera {
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 600);
  yaw = 0;
  pitch = 0.32;
  private distance = 9;
  private current = 9;
  private readonly target = new THREE.Vector3();
  sensitivity = 1;
  invertY = false;

  update(dt: number, input: Input, focus: THREE.Vector3, world: RAPIER.World, exclude: RAPIER.Collider, groundY: (x: number, z: number) => number, speed = 0) {
    const k = 0.0025 * this.sensitivity;
    this.yaw -= input.look.x * k;
    this.pitch += input.look.y * k * (this.invertY ? -1 : 1);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -0.25, 1.2);
    this.distance = THREE.MathUtils.clamp(this.distance + input.wheel * 1.2, 4, 16);

    this.target.lerp(new THREE.Vector3(focus.x, focus.y + 1.8, focus.z), 1 - Math.exp(-dt * 14));
    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    // Pull in when something is between the player and the camera.
    let want = this.distance;
    const hit = world.castRay(new RAPIER.Ray(this.target, dir), this.distance, true, undefined, undefined, exclude);
    if (hit) want = Math.max(1.5, hit.timeOfImpact - 0.3);
    this.current = want < this.current ? want : THREE.MathUtils.lerp(this.current, want, 1 - Math.exp(-dt * 4));

    const pos = this.target.clone().addScaledVector(dir, this.current);
    pos.y = Math.max(pos.y, groundY(pos.x, pos.z) + 0.6);
    this.camera.position.copy(pos);
    this.camera.lookAt(this.target);

    const fov = 60 + Math.min(Math.max(speed - 6, 0), 4) * 1.5;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, fov, 1 - Math.exp(-dt * 5));
      this.camera.updateProjectionMatrix();
    }
  }

  snapBehind(facing: number) {
    this.yaw = facing + Math.PI;
  }
}
