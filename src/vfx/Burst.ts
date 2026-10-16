import * as THREE from 'three';

/**
 * Pooled CPU particle bursts (snow puffs, confetti, sparkles) in a single Points draw call.
 */
export class Burst {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private next = 0;

  constructor(map: THREE.Texture, private readonly capacity = 600, additive = false, private readonly gravity = -9) {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(capacity * 3).fill(-9999);
    this.col = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity).fill(1);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uMap: { value: map }, uPR: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec4 color; attribute float size; uniform float uPR; varying vec4 vColor;
        void main() { vColor = color; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv; gl_PointSize = size * uPR * 300.0 / -mv.z; }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; varying vec4 vColor;
        void main() { vec4 t = texture2D(uMap, gl_PointCoord); float a = t.a * vColor.a; if (a < 0.01) discard;
          gl_FragColor = vec4(vColor.rgb * max(t.rgb, vec3(0.6)), a); }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  emit(at: THREE.Vector3, count: number, opts: { color?: THREE.ColorRepresentation | THREE.ColorRepresentation[]; speed?: number; up?: number; size?: number; life?: number } = {}) {
    const colors = (Array.isArray(opts.color) ? opts.color : [opts.color ?? '#ffffff']).map((c) => new THREE.Color(c));
    const speed = opts.speed ?? 4;
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.capacity;
      const dir = new THREE.Vector3().randomDirection();
      this.pos.set([at.x, at.y, at.z], i * 3);
      this.vel.set([dir.x * speed * Math.random(), Math.abs(dir.y) * speed * Math.random() + (opts.up ?? 2), dir.z * speed * Math.random()], i * 3);
      const c = colors[n % colors.length];
      this.col.set([c.r, c.g, c.b, 1], i * 4);
      this.size[i] = (opts.size ?? 0.5) * (0.6 + Math.random() * 0.8);
      this.maxLife[i] = this.life[i] = (opts.life ?? 0.9) * (0.7 + Math.random() * 0.6);
    }
  }

  update(dt: number, pixelRatio: number) {
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      this.vel[k + 1] += this.gravity * dt;
      const drag = Math.exp(-dt * 1.5);
      this.vel[k] *= drag;
      this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      this.col[i * 4 + 3] = Math.max(0, this.life[i] / this.maxLife[i]);
      if (this.life[i] <= 0) this.pos[k + 1] = -9999;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    (this.points.material as THREE.ShaderMaterial).uniforms.uPR.value = pixelRatio;
  }

  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
