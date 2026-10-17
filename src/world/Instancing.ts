import * as THREE from 'three';
import { snowify } from '../shaders/snow';

export interface Placement {
  position: THREE.Vector3;
  rotationY: number;
  scale: number;
  /** Extra vertical squash/stretch (e.g. low dungeon walls); defaults to 1. */
  scaleY?: number;
}

/**
 * Turns one model + N placements into one InstancedMesh per sub-mesh,
 * so a whole forest of the same tree costs a single draw call.
 */
export function buildInstanced(source: THREE.Object3D, placements: Placement[], snow = 0, sway = 0): THREE.Group {
  const group = new THREE.Group();
  source.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  source.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });

  const tmp = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const s = new THREE.Vector3();
  const placeMatrices = placements.map((p) =>
    new THREE.Matrix4().compose(p.position, q.setFromAxisAngle(up, p.rotationY), s.set(p.scale, p.scale * (p.scaleY ?? 1), p.scale)),
  );

  for (const mesh of meshes) {
    const mat = Array.isArray(mesh.material)
      ? mesh.material.map((m) => (snow > 0 || sway > 0 ? snowify(m, snow, sway) : m))
      : snow > 0 || sway > 0
        ? snowify(mesh.material, snow, sway)
        : mesh.material;
    const inst = new THREE.InstancedMesh(mesh.geometry, mat, placements.length);
    inst.castShadow = true;
    inst.receiveShadow = true;
    placeMatrices.forEach((pm, i) => inst.setMatrixAt(i, tmp.multiplyMatrices(pm, mesh.matrixWorld)));
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    group.add(inst);
  }
  return group;
}

/** Bounding box of a model in its own space (used to size colliders). */
export function modelBounds(source: THREE.Object3D): THREE.Box3 {
  source.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(source);
}
