import * as THREE from 'three';

/**
 * Falling snow: one THREE.Points draw call. Particles live in a box that follows
 * the camera; the vertex shader wraps them so the box never runs out of snow.
 */
export class Snowfall {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;

  constructor(map: THREE.Texture, count = 7000, size = 60, height = 30) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = Math.random() * size;
      pos[i * 3 + 1] = Math.random() * height;
      pos[i * 3 + 2] = Math.random() * size;
      seed[i] = Math.random();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uBox: { value: new THREE.Vector3(size, height, size) },
        uMap: { value: map },
        uScale: { value: 1 },
        uWind: { value: new THREE.Vector2(0.6, 0.25) },
      },
      vertexShader: /* glsl */ `
        attribute float seed;
        uniform float uTime; uniform vec3 uCenter; uniform vec3 uBox; uniform float uScale; uniform vec2 uWind;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          float fall = 1.2 + seed * 1.4;
          p.y -= uTime * fall;
          p.x += uTime * uWind.x + sin(uTime * (0.6 + seed) + seed * 40.0) * 0.6;
          p.z += uTime * uWind.y + cos(uTime * (0.5 + seed) + seed * 17.0) * 0.6;
          // wrap into a box centred on the camera
          vec3 origin = uCenter - uBox * vec3(0.5, 0.35, 0.5);
          p = origin + mod(p - origin, uBox);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (0.14 + seed * 0.12) * uScale * 300.0 / -mv.z;
          vAlpha = smoothstep(uBox.x * 0.5, uBox.x * 0.2, length(mv.xyz)) * 0.9;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; varying float vAlpha;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
          if (a < 0.02) discard;
          gl_FragColor = vec4(1.0, 1.0, 1.0, a);
        }`,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  update(time: number, center: THREE.Vector3, pixelRatio: number) {
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uCenter.value.copy(center);
    this.material.uniforms.uScale.value = pixelRatio;
  }
}
