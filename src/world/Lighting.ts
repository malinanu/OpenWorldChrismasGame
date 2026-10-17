import * as THREE from 'three';

/** One moment of the day; `setTime` blends between these. */
interface Key {
  t: number;
  top: string;
  bottom: string;
  fog: string;
  density: number;
  hemiSky: string;
  hemiGround: string;
  hemi: number;
  sun: string;
  sunI: number;
  /** 0 = broad daylight, 1 = full night (stars, moon, lanterns at full glow). */
  night: number;
}

// t: 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset. Day and night hold for a
// while; dawn and dusk are the short colourful blends in between.
const NIGHT: Omit<Key, 't'> = {
  top: '#060d22', bottom: '#1c2c52', fog: '#16233f', density: 0.0105,
  hemiSky: '#4a66a6', hemiGround: '#1a2236', hemi: 0.75, sun: '#a9c0ff', sunI: 0.5, night: 1,
};
const DAWN: Omit<Key, 't'> = {
  top: '#5d6fae', bottom: '#f4b9a0', fog: '#d9b9b4', density: 0.0095,
  hemiSky: '#ffd8c4', hemiGround: '#6f7593', hemi: 1.05, sun: '#ffa86e', sunI: 1.3, night: 0.35,
};
const DAY: Omit<Key, 't'> = {
  top: '#5f86c4', bottom: '#c6d6ec', fog: '#c6d6ec', density: 0.0085,
  hemiSky: '#dfeaff', hemiGround: '#8a9bb8', hemi: 1.5, sun: '#ffe2c0', sunI: 2.4, night: 0,
};
const DUSK: Omit<Key, 't'> = {
  top: '#3b3f86', bottom: '#ff9a72', fog: '#b58a98', density: 0.0095,
  hemiSky: '#ffc2a6', hemiGround: '#5d5a80', hemi: 1.0, sun: '#ff8048', sunI: 1.4, night: 0.55,
};
const KEYS: Key[] = [
  { t: 0, ...NIGHT },
  { t: 0.2, ...NIGHT },
  { t: 0.27, ...DAWN },
  { t: 0.35, ...DAY },
  { t: 0.66, ...DAY },
  { t: 0.74, ...DUSK },
  { t: 0.81, ...NIGHT },
  { t: 1, ...NIGHT },
];

const ca = new THREE.Color();
const cb = new THREE.Color();
const mixColor = (out: THREE.Color, a: string, b: string, k: number) => out.copy(ca.set(a)).lerp(cb.set(b), k);

/** Sky dome, fog, hemisphere fill and a shadow-casting sun (or moon) that follows the player. */
export class Lighting {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky: THREE.Mesh;
  /** 0 by day, 1 at night; drives lanterns and window glow. */
  night = 0;
  private readonly sunOffset = new THREE.Vector3(-40, 60, 30);
  private readonly fog: THREE.FogExp2;
  private readonly background: THREE.Color;
  private readonly uniforms: Record<string, THREE.IUniform>;

  /** `shadowSize` 0 disables the sun's shadow (low quality). */
  constructor(scene: THREE.Scene, shadowSize = 2048) {
    this.fog = new THREE.FogExp2('#c6d6ec', 0.0085);
    this.background = new THREE.Color('#c6d6ec');
    scene.fog = this.fog;
    scene.background = this.background;

    this.hemi = new THREE.HemisphereLight('#dfeaff', '#8a9bb8', 1.5);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight('#ffe2c0', 2.4);
    this.sun.castShadow = shadowSize > 0;
    this.sun.shadow.mapSize.set(Math.max(shadowSize, 256), Math.max(shadowSize, 256));
    const c = this.sun.shadow.camera;
    // Smaller shadow maps cover a smaller area so shadows stay crisp.
    const half = shadowSize >= 2048 ? 45 : 30;
    c.left = -half; c.right = half; c.top = half; c.bottom = -half; c.near = 1; c.far = 200;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    this.uniforms = {
      top: { value: new THREE.Color('#5f86c4') },
      bottom: { value: new THREE.Color('#c6d6ec') },
      glow: { value: new THREE.Color('#ffd7b0') },
      sunDir: { value: new THREE.Vector3(-0.5, 0.35, 0.4).normalize() },
      moonDir: { value: new THREE.Vector3(0.45, 0.55, -0.7).normalize() },
      uNight: { value: 0 },
    };
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: this.uniforms,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 glow; uniform vec3 sunDir; uniform vec3 moonDir; uniform float uNight;
        varying vec3 vDir;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        void main(){ float h = clamp(vDir.y, 0.0, 1.0);
          vec3 c = mix(bottom, top, pow(h, 0.6));
          float sunGlow = pow(max(dot(vDir, sunDir), 0.0), 8.0);
          c += glow * sunGlow * 0.5 * (1.0 - uNight);
          // Night: twinkle-free star field (one star per cell) and a soft moon.
          vec3 cell = floor(vDir * 160.0);
          float star = step(0.9965, hash(cell)) * smoothstep(0.05, 0.3, vDir.y);
          c += vec3(0.85, 0.9, 1.0) * star * uNight * (0.5 + 0.5 * hash(cell + 7.0));
          float m = dot(vDir, moonDir);
          c += vec3(0.95, 0.97, 1.0) * smoothstep(0.9988, 0.9993, m) * uNight;
          c += vec3(0.35, 0.45, 0.7) * pow(max(m, 0.0), 60.0) * 0.6 * uNight;
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(280, 32, 16), skyMat);
    this.sky.renderOrder = -1;
    scene.add(this.sky);
  }

  /**
   * Time of day, 0..1 (0 = midnight, 0.5 = noon). Only the village calls this; mini-games
   * keep the default daylight from the constructor.
   */
  setTime(t: number) {
    t = ((t % 1) + 1) % 1;
    let i = 0;
    while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const k = THREE.MathUtils.smoothstep(t, a.t, b.t);
    const u = this.uniforms;
    mixColor(u.top.value, a.top, b.top, k);
    mixColor(u.bottom.value, a.bottom, b.bottom, k);
    mixColor(this.fog.color, a.fog, b.fog, k);
    this.background.copy(this.fog.color);
    this.fog.density = THREE.MathUtils.lerp(a.density, b.density, k);
    mixColor(this.hemi.color, a.hemiSky, b.hemiSky, k);
    mixColor(this.hemi.groundColor, a.hemiGround, b.hemiGround, k);
    this.hemi.intensity = THREE.MathUtils.lerp(a.hemi, b.hemi, k);
    mixColor(this.sun.color, a.sun, b.sun, k);
    this.sun.intensity = THREE.MathUtils.lerp(a.sunI, b.sunI, k);
    this.night = THREE.MathUtils.lerp(a.night, b.night, k);
    u.uNight.value = this.night;
    mixColor(u.glow.value, '#ffd7b0', '#ff9a60', Math.min(1, this.night * 1.6));

    // The sun arcs east to west; once it sets, the same light becomes the moon.
    const ang = (t - 0.25) * Math.PI * 2; // 0 at sunrise, π/2 at noon
    const sunUp = Math.sin(ang);
    const dir = new THREE.Vector3(Math.cos(ang), Math.max(sunUp, 0.22), 0.45).normalize();
    // Swing smoothly over to the moon as the sun goes down, so shadows don't jump.
    dir.lerp(u.moonDir.value, THREE.MathUtils.smoothstep(-sunUp, -0.2, 0.1)).normalize();
    u.sunDir.value.copy(dir);
    this.sunOffset.copy(dir).multiplyScalar(80);
  }

  follow(target: THREE.Vector3) {
    this.sun.position.copy(target).add(this.sunOffset);
    this.sun.target.position.copy(target);
    this.sky.position.copy(target);
  }
}
