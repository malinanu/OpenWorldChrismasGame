import * as THREE from 'three';

/** A column of rising golden sparkles + a soft glow that marks a game zone. */
export class Beacon {
  readonly group = new THREE.Group();
  private readonly material: THREE.ShaderMaterial;
  private readonly glow: THREE.Sprite;

  constructor(sparkle: THREE.Texture, glow: THREE.Texture, color = new THREE.Color('#ffd25a'), count = 90) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 1.6;
      pos.set([Math.cos(a) * r, 0, Math.sin(a) * r], i * 3);
      seed[i] = Math.random();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uMap: { value: sparkle }, uColor: { value: color }, uHeight: { value: 14 }, uPR: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float seed; uniform float uTime; uniform float uHeight; uniform float uPR; varying float vA;
        void main() {
          float t = fract(uTime * (0.12 + seed * 0.1) + seed);
          vec3 p = position * (1.0 - t * 0.6);
          p.y = t * uHeight;
          float ang = uTime * 0.8 + seed * 6.28;
          p.xz += vec2(cos(ang), sin(ang)) * 0.3;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (0.18 + seed * 0.22) * uPR * 300.0 / -mv.z;
          vA = sin(t * 3.14159);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; uniform vec3 uColor; varying float vA;
        void main() { vec4 c = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(uColor * c.rgb * 1.6, c.a * vA); }`,
    });
    const pts = new THREE.Points(geo, this.material);
    pts.frustumCulled = false;
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.glow.scale.setScalar(6);
    this.glow.position.y = 1;
    this.group.add(pts, this.glow);
  }

  /** Completed zones keep a smaller, calmer beacon. */
  setCompleted(done: boolean) {
    this.material.uniforms.uHeight.value = done ? 5 : 14;
    this.glow.scale.setScalar(done ? 3 : 6);
  }

  update(time: number, pixelRatio: number) {
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uPR.value = pixelRatio;
    this.glow.material.opacity = 0.55 + 0.25 * Math.sin(time * 2.5);
  }
}
