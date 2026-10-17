import * as THREE from 'three';

/** How many footprint samples are remembered (≈ CAPACITY × STEP metres of trail). */
const CAPACITY = 220;
/** Distance between samples; one texture repeat covers two samples (a left + a right boot). */
const STEP = 0.36;
const WIDTH = 0.9;
/** Seconds a print stays crisp, then how long it takes to fill back in with snow. */
const HOLD = 45;
const FADE = 25;

interface Sample {
  x: number;
  z: number;
  y: number;
  t: number;
  /** 0 marks a break in the trail (jump, teleport) so the ribbon doesn't bridge it. */
  a: number;
}

/** Two boot prints on a transparent canvas: left in the upper half, right in the lower, one stride long. */
function footprintTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  // Soft-edged prints: blur the shapes so they read as pressed snow, not stickers.
  g.filter = 'blur(3px)';
  g.fillStyle = 'rgba(255,255,255,0.95)';
  const boot = (cx: number, cy: number) => {
    g.beginPath(); // sole
    g.ellipse(cx + 12, cy, 34, 21, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath(); // heel
    g.ellipse(cx - 34, cy, 19, 17, 0, 0, Math.PI * 2);
    g.fill();
  };
  boot(64, 40);
  boot(192, 88);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Footprints in the snow behind the player.
 *
 * The idea comes from Bruno Simon's wheel tracks (a fixed-size history of recent
 * contact points turned into a ribbon), but instead of rendering the ribbon into a
 * ground render target we draw it straight onto the terrain: one small draw call
 * and no extra render pass, which matters on phones.
 */
export class SnowTrail {
  readonly mesh: THREE.Mesh;
  private samples: Sample[] = [];
  private readonly positions = new Float32Array(CAPACITY * 2 * 3);
  private readonly colors = new Float32Array(CAPACITY * 2 * 4);
  private readonly uvs = new Float32Array(CAPACITY * 2 * 2);
  private readonly geometry = new THREE.BufferGeometry();
  private last: THREE.Vector3 | null = null;
  private distance = 0;
  private fadeTimer = 0;
  private airborne = false;

  constructor(private readonly groundY: (x: number, z: number) => number) {
    const g = this.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2).setUsage(THREE.DynamicDrawUsage));
    const index: number[] = [];
    for (let i = 0; i < CAPACITY - 1; i++) {
      const a = i * 2;
      // Counter-clockwise seen from above, so the ribbon faces up.
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    g.setIndex(index);
    const normals = new Float32Array(CAPACITY * 2 * 3);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setDrawRange(0, 0);
    const mat = new THREE.MeshLambertMaterial({
      color: '#7489ad',
      map: footprintTexture(),
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Call every frame with the player's feet position. */
  update(dt: number, time: number, feet: THREE.Vector3, grounded: boolean) {
    if (!this.last || feet.distanceTo(this.last) > 6) {
      // First frame or a teleport: start a fresh segment.
      this.breakTrail(feet, time);
      this.last = feet.clone();
    }
    if (!grounded) {
      // Jumping: close the trail at take-off and reopen it where we land, so the ribbon doesn't bridge the gap.
      if (!this.airborne) this.breakTrail(this.last, time);
      this.airborne = true;
      this.last.copy(feet);
      return;
    }
    if (this.airborne) {
      this.airborne = false;
      this.breakTrail(feet, time);
    }
    const moved = Math.hypot(feet.x - this.last.x, feet.z - this.last.z);
    if (moved >= STEP) {
      this.distance += moved;
      this.push({ x: feet.x, z: feet.z, y: this.groundY(feet.x, feet.z) + 0.05, t: time, a: 1 });
      this.last.copy(feet);
      this.rebuild(time);
    }
    this.fadeTimer += dt;
    if (this.fadeTimer > 1) {
      this.fadeTimer = 0;
      this.rebuild(time);
    }
  }

  private breakTrail(at: THREE.Vector3, time: number) {
    const s = { x: at.x, z: at.z, y: this.groundY(at.x, at.z) + 0.05, t: time, a: 0 };
    this.push(s);
    this.push({ ...s });
  }

  private push(s: Sample) {
    this.samples.push(s);
    if (this.samples.length > CAPACITY) this.samples.shift();
  }

  private rebuild(time: number) {
    const n = this.samples.length;
    let u = this.distance / (STEP * 2);
    for (let i = n - 1; i >= 0; i--) {
      const s = this.samples[i];
      // Direction from the neighbouring samples gives the ribbon's sideways axis.
      const prev = this.samples[Math.max(0, i - 1)];
      const next = this.samples[Math.min(n - 1, i + 1)];
      let dx = next.x - prev.x;
      let dz = next.z - prev.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const sx = -dz * (WIDTH / 2);
      const sz = dx * (WIDTH / 2);
      const k = i * 2;
      this.positions.set([s.x + sx, s.y, s.z + sz, s.x - sx, s.y, s.z - sz], k * 3);
      const age = time - s.t;
      const alpha = s.a * THREE.MathUtils.clamp(1 - (age - HOLD) / FADE, 0, 1);
      this.colors.set([1, 1, 1, alpha, 1, 1, 1, alpha], k * 4);
      this.uvs.set([u, 1, u, 0], k * 2);
      if (i > 0) u -= Math.hypot(s.x - this.samples[i - 1].x, s.z - this.samples[i - 1].z) / (STEP * 2);
    }
    const g = this.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.uv.needsUpdate = true;
    g.setDrawRange(0, Math.max(0, n - 1) * 6);
  }

  dispose() {
    this.geometry.dispose();
    const m = this.mesh.material as THREE.MeshLambertMaterial;
    m.map?.dispose();
    m.dispose();
  }
}
