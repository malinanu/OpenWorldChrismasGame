import * as THREE from 'three';
import { assets } from '../core/AssetLoader';
import { LOOKS } from './weapons';

/**
 * Puts a fighter's weapon in their hands: KayKit's weapons (made for this skeleton) go on the
 * hand-slot bones; boxing gloves are built from a few simple shapes.
 * three.js strips the dot from bone names, so "handslot.r" is found as "handslotr".
 */
const TAG = 'frostvaleWeapon';
const tokens = new WeakMap<THREE.Object3D, number>();

function slot(rig: THREE.Object3D, side: 'r' | 'l') {
  return rig.getObjectByName(`handslot${side}`) ?? rig.getObjectByName(`handslot.${side}`) ?? rig.getObjectByName(`hand${side}`);
}

const gloveCache = new Map<string, THREE.Group>();
function glove(color: string, size: number): THREE.Group {
  const key = `${color}|${size}`;
  let g = gloveCache.get(key);
  if (!g) {
    g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.05 });
    const cuffMat = new THREE.MeshStandardMaterial({ color: '#f7f3ea', roughness: 0.7 });
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.15, 18, 14), mat);
    fist.scale.set(1, 1.15, 1.05);
    fist.position.y = 0.04;
    const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), mat);
    thumb.position.set(0.1, 0.02, 0.06);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.12, 14), cuffMat);
    cuff.position.y = -0.12;
    for (const m of [fist, thumb, cuff]) m.castShadow = true;
    g.add(fist, thumb, cuff);
    g.scale.setScalar(size);
    gloveCache.set(key, g);
  }
  return g.clone(true);
}

/** Removes whatever the fighter held. */
export function unequip(rig: THREE.Object3D) {
  tokens.set(rig, (tokens.get(rig) ?? 0) + 1);
  const old: THREE.Object3D[] = [];
  rig.traverse((o) => o.userData[TAG] && old.push(o));
  old.forEach((o) => o.removeFromParent());
}

/** Gives the fighter this weapon (or nothing, for `null`). Safe to call again while loading. */
export async function equip(rig: THREE.Object3D, weaponId: string | null) {
  unequip(rig);
  const look = weaponId ? LOOKS[weaponId] : undefined;
  if (!look) return;
  const mine = tokens.get(rig);
  const parts: [THREE.Object3D | undefined, THREE.Object3D][] = [];
  if (look.gloves) {
    for (const side of ['r', 'l'] as const) parts.push([slot(rig, side), glove(look.gloves.color, look.gloves.size)]);
  } else {
    const load = async (name: string) => (await assets.model(`weapons/${name}`)).scene.clone(true);
    const [right, left] = await Promise.all([look.right ? load(look.right) : null, look.left ? load(look.left) : null]).catch(() => [null, null]);
    if (tokens.get(rig) !== mine) return; // changed weapon while this one was loading
    // KayKit's own grip (from the Adventurers 1.0 Knight, whose hand bones match ours): right-hand
    // weapons sit a little up the slot, turned half round about it; shields sit out on the forearm.
    if (right) {
      const hold = new THREE.Group().add(right);
      hold.position.set(0, 0.033, 0);
      hold.rotation.y = Math.PI;
      parts.push([slot(rig, 'r'), hold]);
    }
    if (left) {
      const hold = new THREE.Group().add(left);
      hold.position.set(0, 0.017, look.left?.startsWith('shield') ? 0.156 : 0);
      parts.push([slot(rig, 'l'), hold]);
    }
  }
  for (const [bone, obj] of parts) {
    if (!bone) continue;
    obj.userData[TAG] = true;
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    bone.add(obj);
  }
}

let combat: Promise<THREE.AnimationClip[]> | null = null;
/** The melee, guard, hit and knock-down clips (animations/Frostvale_Combat.glb), loaded once on demand. */
export function combatClips(): Promise<THREE.AnimationClip[]> {
  combat ??= assets.model('animations/Frostvale_Combat.glb').then(
    (g) => g.animations,
    () => {
      combat = null;
      return [];
    },
  );
  return combat;
}

/** Clips that play once and hold their last frame (swings, hits, the knock-down). */
export const ONCE_CLIPS = /Attack|^Hit_|Block_Hit|^Death_A$|Lie_StandUp/;

export function prepareAction(name: string, action: THREE.AnimationAction) {
  if (ONCE_CLIPS.test(name)) {
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
  }
}
