import * as THREE from 'three';

/** Sky dome, fog, hemisphere fill and a shadow-casting sun that follows the player. */
export class Lighting {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky: THREE.Mesh;
  private readonly sunOffset = new THREE.Vector3(-40, 60, 30);

  /** `shadowSize` 0 disables the sun's shadow (low quality). */
  constructor(scene: THREE.Scene, shadowSize = 2048) {
    scene.fog = new THREE.FogExp2('#c6d6ec', 0.0085);
    scene.background = new THREE.Color('#c6d6ec');

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

    const skyGeo = new THREE.SphereGeometry(400, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: new THREE.Color('#5f86c4') }, bottom: { value: new THREE.Color('#c6d6ec') }, glow: { value: new THREE.Color('#ffd7b0') } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 glow; varying vec3 vDir;
        void main(){ float h = clamp(vDir.y, 0.0, 1.0);
          vec3 c = mix(bottom, top, pow(h, 0.6));
          float sunGlow = pow(max(dot(vDir, normalize(vec3(-0.5, 0.35, 0.4))), 0.0), 8.0);
          gl_FragColor = vec4(c + glow * sunGlow * 0.5, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.sky.renderOrder = -1;
    scene.add(this.sky);
  }

  follow(target: THREE.Vector3) {
    this.sun.position.copy(target).add(this.sunOffset);
    this.sun.target.position.copy(target);
    this.sky.position.copy(target);
  }
}
