import * as THREE from 'three';
import { assets } from '../core/AssetLoader';
import { RAPIER } from '../core/Physics';
import { FONT_STACK } from '../i18n';
import { ft } from './strings';
import { ARENA_EMOJI, type ArenaDef } from './weapons';

type Vec3 = [number, number, number];

/** A prop for World to place (same shape as World's PropDef). */
export interface ArenaProp {
  model: string;
  at: Vec3[];
  scale?: number;
  rotY?: number[];
  collider?: 'trunk' | 'box';
  light?: string;
  shadow?: boolean;
  snow?: number;
}

/** One built arena: where it is and its practice snowman. */
export interface ArenaSite {
  def: ArenaDef;
  center: THREE.Vector3;
  /** Height of the fighting floor above the ground (the ring's canvas is raised). */
  floor: number;
  dummy: THREE.Group;
  /** The snowman's home spot (it wobbles about it). */
  dummyHome: THREE.Vector3;
}

/** The ring's canvas is a little higher than a step, so the character's auto-step climbs it. */
const RING_FLOOR = 0.42;
const RING_HALF = 5.5;
const POST = 5.2;
const WALL_R = 10.5;
const WALL_PIECES = 16;

/**
 * Each arena is built in its own frame: local +x points at the Great Tree, so the gate
 * (the gap in the ropes, the opening in the wall) always faces the plaza.
 */
class Frame {
  readonly yaw: number;
  constructor(
    readonly cx: number,
    readonly cz: number,
  ) {
    const len = Math.hypot(cx, cz) || 1;
    this.yaw = Math.atan2(cz / len, -cx / len); // rotation.y that turns local +x towards (0, 0)
  }
  /** Local (x, z) to world (x, z). */
  at(lx: number, lz: number): [number, number] {
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    return [this.cx + lx * c + lz * s, this.cz - lx * s + lz * c];
  }
  /** A local rotation about Y as a world rotation. */
  rot(local = 0) {
    return this.yaw + local;
  }
}

const r1 = (n: number) => +n.toFixed(2);

/** Lanterns, stools, the bell, the stone wall, pillars, banners and torches, as ordinary props. */
export function arenaProps(defs: ArenaDef[]): ArenaProp[] {
  const props: ArenaProp[] = [];
  const add = (model: string, at: Vec3, rotY: number, extra: Partial<ArenaProp> = {}) => {
    let p = props.find((q) => q.model === model && q.scale === extra.scale && q.collider === extra.collider);
    if (!p) props.push((p = { model, at: [], rotY: [], ...extra }));
    p.at.push(at.map(r1) as Vec3);
    p.rotY!.push(r1(rotY));
  };
  for (const d of defs) {
    const f = new Frame(d.x, d.z);
    if (d.id === 'boxing') {
      for (const [lx, lz] of [[7.4, 7.4], [7.4, -7.4], [-7.4, 7.4], [-7.4, -7.4]]) {
        const [x, z] = f.at(lx, lz);
        add('holiday/lantern', [x, 0, z], 0, { collider: 'trunk', light: '#ffb35a', shadow: false });
      }
      // The corner stools, outside the ropes at the back.
      for (const lz of [6.4, -6.4]) {
        const [x, z] = f.at(-6.4, lz);
        add('holiday/stool', [x, 0, z], f.rot(), { scale: 1.3, collider: 'box' });
      }
    } else {
      // A low stone wall all the way round, with one opening (the gate) towards the plaza.
      const step = (Math.PI * 2) / WALL_PIECES;
      for (let i = 1; i < WALL_PIECES; i++) {
        const a = i * step;
        const [x, z] = f.at(Math.cos(a) * WALL_R, Math.sin(a) * WALL_R);
        // Tangent to the circle, in world terms.
        const [tx, tz] = f.at(Math.cos(a) * WALL_R - Math.sin(a), Math.sin(a) * WALL_R + Math.cos(a));
        const yaw = Math.atan2(-(tz - z), tx - x);
        add('dungeon/barrier', [x, 0, z], yaw, { collider: 'box', snow: 0.5 });
        if (i % 4 === 0) add('dungeon/torch_lit', [x, 1.5, z], yaw, { light: '#ff8c3c', shadow: false });
      }
      // Pillars either side of the gate, banners facing the plaza.
      for (const side of [1, -1]) {
        const a = (step / 2 + 0.06) * side;
        const [x, z] = f.at(Math.cos(a) * WALL_R, Math.sin(a) * WALL_R);
        add('dungeon/pillar', [x, 0, z], f.rot(), { scale: 0.8, collider: 'box', snow: 0.6 });
        const [bx, bz] = f.at(Math.cos(a) * WALL_R + 0.3, Math.sin(a) * WALL_R);
        add('dungeon/banner_shield_red', [bx, 0.2, bz], f.rot(Math.PI / 2), { scale: 0.75 });
      }
      // Weapon racks and barrels inside the wall, out of the way.
      for (const a of [Math.PI * 0.8, Math.PI * 1.2]) {
        const [x, z] = f.at(Math.cos(a) * (WALL_R - 0.9), Math.sin(a) * (WALL_R - 0.9));
        add('dungeon/barrel_small', [x, 0, z], a, { collider: 'trunk' });
      }
      for (const [lx, lz] of [[12.4, 6], [12.4, -6]]) {
        const [x, z] = f.at(lx, lz);
        add('holiday/lantern', [x, 0, z], 0, { collider: 'trunk', light: '#ffb35a', shadow: false });
      }
    }
  }
  return props;
}

// ------------------------------------------------------------------ textures

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat !== 1) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
  }
  return tex;
}

function snowflake(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.save();
  g.translate(x, y);
  for (let i = 0; i < 6; i++) {
    g.rotate(Math.PI / 3);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, -r);
    g.moveTo(0, -r * 0.55);
    g.lineTo(r * 0.22, -r * 0.75);
    g.moveTo(0, -r * 0.55);
    g.lineTo(-r * 0.22, -r * 0.75);
    g.stroke();
  }
  g.restore();
}

/** Red-and-white canvas with a big snowflake in the middle. */
const ringCanvas = () =>
  canvasTexture(1024, (g, s) => {
    g.fillStyle = '#c8263a';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#e8eef7';
    g.fillRect(40, 40, s - 80, s - 80);
    g.strokeStyle = '#c8263a';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.3, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = '#2b6fd6';
    g.lineWidth = 22;
    g.lineCap = 'round';
    snowflake(g, s / 2, s / 2, s * 0.22);
    g.fillStyle = 'rgba(200, 38, 58, 0.85)';
    g.font = `bold 64px ${FONT_STACK}`;
    g.textAlign = 'center';
    g.fillText('FROSTVALE', s / 2, s - 90);
  });

/** Candy-cane stripes for the ring posts. */
const stripes = () =>
  canvasTexture(128, (g, s) => {
    g.fillStyle = '#fff6f0';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#d6203a';
    for (let i = -s; i < s * 2; i += 32) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + 16, 0);
      g.lineTo(i + 16 - s, s);
      g.lineTo(i - s, s);
      g.closePath();
      g.fill();
    }
  });

/** Packed sand with a few flagstones, for the sword arena's floor. */
const pitFloor = () =>
  canvasTexture(
    512,
    (g, s) => {
      g.fillStyle = '#b9b2a6';
      g.fillRect(0, 0, s, s);
      let seed = 3;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 2200; i++) {
        g.fillStyle = `rgba(${90 + rand() * 60}, ${85 + rand() * 55}, ${80 + rand() * 50}, ${0.15 + rand() * 0.2})`;
        g.fillRect(rand() * s, rand() * s, 2 + rand() * 5, 2 + rand() * 5);
      }
      g.strokeStyle = 'rgba(70, 64, 58, 0.35)';
      g.lineWidth = 3;
      for (let y = 0; y < s; y += 64) for (let x = (y / 64) % 2 ? 32 : 0; x < s; x += 64) g.strokeRect(x + 2, y + 2, 60, 60);
    },
    4,
  );

/** A wooden board with the arena's name, for the arch over its gate. */
function signTexture(text: string) {
  return canvasTexture(512, (g, s) => {
    g.clearRect(0, 0, s, s);
    const y0 = s * 0.3;
    const h = s * 0.4;
    g.fillStyle = '#8a5a33';
    g.beginPath();
    g.roundRect(10, y0, s - 20, h, 28);
    g.fill();
    g.strokeStyle = '#4d301a';
    g.lineWidth = 10;
    g.stroke();
    g.fillStyle = '#fff4dc';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 70;
    g.font = `bold ${size}px ${FONT_STACK}`;
    while (size > 30 && g.measureText(text).width > s - 70) g.font = `bold ${(size -= 2)}px ${FONT_STACK}`;
    g.fillText(text, s / 2, y0 + h / 2 + 4, s - 60);
  });
}

// ------------------------------------------------------------------ building

export interface ArenaBuildContext {
  scene: THREE.Scene;
  physics: RAPIER.World;
  groundY: (x: number, z: number) => number;
  /** Small pieces (posts, pads, the bell) cast shadows too (Pretty preset only). */
  detailShadows?: boolean;
}

/** The raised ring, ropes and posts, the arena floor, the gate arches and the practice snowmen. */
export async function buildArenas(defs: ArenaDef[], ctx: ArenaBuildContext): Promise<ArenaSite[]> {
  const snowman = await assets.model('holiday/snowman_A').catch(() => null);
  const sites: ArenaSite[] = [];
  const postTex = stripes();
  for (const d of defs) {
    const f = new Frame(d.x, d.z);
    const gy = ctx.groundY(d.x, d.z);
    const group = new THREE.Group();
    group.position.set(d.x, gy, d.z);
    group.rotation.y = f.yaw;
    ctx.scene.add(group);
    group.updateMatrixWorld(true);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.yaw);
    /** A fixed box collider, given in the arena's local frame. */
    const box = (lx: number, ly: number, lz: number, hx: number, hy: number, hz: number) => {
      const p = new THREE.Vector3(lx, ly, lz).applyMatrix4(group.matrixWorld);
      const body = ctx.physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
      ctx.physics.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz), body);
    };
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
      return m;
    };

    let floor = 0;
    if (d.id === 'boxing') {
      floor = RING_FLOOR;
      // Platform: red skirt, canvas on top.
      const skirt = new THREE.MeshStandardMaterial({ color: '#a81f33', roughness: 0.8 });
      const canvas = new THREE.MeshStandardMaterial({ map: ringCanvas(), roughness: 0.95 });
      mesh(new THREE.BoxGeometry(RING_HALF * 2, RING_FLOOR, RING_HALF * 2), [skirt, skirt, canvas, skirt, skirt, skirt] as unknown as THREE.Material, 0, RING_FLOOR / 2, 0);
      box(0, RING_FLOOR / 2, 0, RING_HALF, RING_FLOOR / 2, RING_HALF);
      // Corner posts with padded tops.
      const postMat = new THREE.MeshStandardMaterial({ map: postTex, roughness: 0.6 });
      const padMat = new THREE.MeshStandardMaterial({ color: '#2a7a3f', roughness: 0.7 });
      const postGeo = new THREE.CylinderGeometry(0.13, 0.15, 1.9, 14);
      for (const [px, pz] of [[POST, POST], [POST, -POST], [-POST, POST], [-POST, -POST]]) {
        mesh(postGeo, postMat, px, RING_FLOOR + 0.95, pz);
        mesh(new THREE.BoxGeometry(0.34, 0.5, 0.34), padMat, px, RING_FLOOR + 1.5, pz);
      }
      // Three ropes on each side; the side facing the plaza has a gap to climb through.
      const ropeColors = ['#e8202f', '#ffffff', '#1f9d4a'];
      const ropeMats = ropeColors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }));
      const GAP = 1.5;
      const rope = (x1: number, z1: number, x2: number, z2: number, h: number, mat: THREE.Material) => {
        const len = Math.hypot(x2 - x1, z2 - z1);
        const m = mesh(new THREE.CylinderGeometry(0.045, 0.045, len, 8), mat, (x1 + x2) / 2, RING_FLOOR + h, (z1 + z2) / 2);
        m.rotation.z = Math.PI / 2;
        m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
        m.castShadow = false;
      };
      const sides: [number, number, number, number][] = [
        [-POST, -POST, -POST, POST],
        [-POST, POST, POST, POST],
        [-POST, -POST, POST, -POST],
      ];
      ropeColors.forEach((_, i) => {
        const h = 0.55 + i * 0.42;
        for (const [x1, z1, x2, z2] of sides) rope(x1, z1, x2, z2, h, ropeMats[i]);
        // Plaza side: two lengths with the gap between.
        rope(POST, -POST, POST, -GAP, h, ropeMats[i]);
        rope(POST, GAP, POST, POST, h, ropeMats[i]);
      });
      // Short posts at the gap.
      for (const gz of [GAP, -GAP]) mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.5, 10), postMat, POST, RING_FLOOR + 0.75, gz);
      // The ropes are walls you can't be shoved through (the gap aside).
      const ropeH = 0.9;
      box(-POST, RING_FLOOR + ropeH, 0, 0.1, ropeH, POST);
      box(0, RING_FLOOR + ropeH, POST, POST, ropeH, 0.1);
      box(0, RING_FLOOR + ropeH, -POST, POST, ropeH, 0.1);
      const half = (POST - GAP) / 2;
      box(POST, RING_FLOOR + ropeH, GAP + half, 0.1, ropeH, half);
      box(POST, RING_FLOOR + ropeH, -GAP - half, 0.1, ropeH, half);
      // The bell on its own little gallows by the gate.
      const wood = new THREE.MeshStandardMaterial({ color: '#7a4a2b', roughness: 0.85 });
      mesh(new THREE.BoxGeometry(0.14, 2.6, 0.14), wood, POST + 1.3, 1.3, POST + 1.3);
      mesh(new THREE.BoxGeometry(0.1, 0.1, 0.8), wood, POST + 1.3, 2.55, POST + 0.95);
      box(POST + 1.3, 1.3, POST + 1.3, 0.1, 1.3, 0.1);
      const bell = await assets.model('holiday/bell_decorated').catch(() => null);
      if (bell) {
        const b = bell.scene.clone(true);
        b.position.set(POST + 1.3, 2.0, POST + 0.65);
        b.scale.setScalar(0.7);
        group.add(b);
      }
    } else {
      floor = 0.1;
      const mat = new THREE.MeshStandardMaterial({ map: pitFloor(), roughness: 0.95 });
      const disc = mesh(new THREE.CylinderGeometry(WALL_R - 0.2, WALL_R, floor, 56), mat, 0, floor / 2, 0);
      disc.castShadow = false;
      // A red circle painted round the edge of the fighting area.
      const ring = new THREE.Mesh(new THREE.RingGeometry(d.r - 0.25, d.r, 72), new THREE.MeshStandardMaterial({ color: '#b32436', roughness: 0.9 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = floor + 0.01;
      group.add(ring);
      const body = ctx.physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(d.x, gy + floor / 2, d.z));
      ctx.physics.createCollider(RAPIER.ColliderDesc.cylinder(floor / 2, WALL_R - 0.1), body);
    }

    // The arch over the way in, with the arena's name on both faces.
    const archX = d.id === 'boxing' ? 7.6 : WALL_R + 1.6;
    const archH = 3.1;
    const wood = new THREE.MeshStandardMaterial({ color: '#6e4426', roughness: 0.85 });
    for (const s of [1.9, -1.9]) {
      mesh(new THREE.BoxGeometry(0.22, archH, 0.22), wood, archX, archH / 2, s);
      box(archX, archH / 2, s, 0.12, archH / 2, 0.12);
    }
    const label = `${ARENA_EMOJI[d.id]} ${ft(`arena_${d.id}`)}`;
    const signMat = new THREE.MeshStandardMaterial({ map: signTexture(label), transparent: true, alphaTest: 0.5, roughness: 0.8, side: THREE.FrontSide });
    for (const back of [false, true]) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), signMat);
      plane.position.set(archX + (back ? -0.03 : 0.03), archH - 0.35, 0);
      plane.rotation.y = back ? -Math.PI / 2 : Math.PI / 2;
      group.add(plane);
    }

    if (!ctx.detailShadows) {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.computeBoundingSphere();
        if ((m.geometry.boundingSphere?.radius ?? 0) * m.scale.x < 1.5) m.castShadow = false;
      });
    }

    // The practice snowman, away from the gate.
    const dummy = new THREE.Group();
    const [hx, hz] = f.at(-3.2, 2.6);
    const home = new THREE.Vector3(hx, gy + floor, hz);
    dummy.position.copy(home);
    dummy.rotation.y = Math.atan2(d.x - hx, d.z - hz); // facing the middle of the arena
    if (snowman) {
      const s = snowman.scene.clone(true);
      s.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      dummy.add(s);
    }
    ctx.scene.add(dummy);
    const sb = ctx.physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(home.x, home.y + 0.9, home.z));
    ctx.physics.createCollider(RAPIER.ColliderDesc.cylinder(0.9, 0.55), sb);

    sites.push({ def: d, center: new THREE.Vector3(d.x, gy + floor, d.z), floor, dummy, dummyHome: home });
  }
  return sites;
}
