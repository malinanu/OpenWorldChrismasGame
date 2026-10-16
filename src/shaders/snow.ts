import * as THREE from 'three';

const cache = new WeakMap<THREE.Material, THREE.Material>();
export const snowUniforms = { uSnowAmount: { value: 1 } };

/**
 * Returns a copy of `mat` that blends towards snow white wherever the world-space
 * normal faces up. Works with InstancedMesh and SkinnedMesh because it reads the
 * final view-space normal from three's `defaultnormal_vertex` chunk.
 */
export function snowify(mat: THREE.Material, strength = 1): THREE.Material {
  const hit = cache.get(mat);
  if (hit) return hit;
  const m = mat.clone();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSnowAmount = snowUniforms.uSnowAmount;
    shader.uniforms.uSnowStrength = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vSnowUp;\nvarying vec3 vSnowWorld;')
      .replace(
        '#include <defaultnormal_vertex>',
        `#include <defaultnormal_vertex>
        // view-space normal -> world space (viewMatrix is orthonormal, so transpose == inverse)
        vSnowUp = normalize((vec4(transformedNormal, 0.0) * viewMatrix).xyz).y;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vec4 snowWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          snowWp = instanceMatrix * snowWp;
        #endif
        vSnowWorld = (modelMatrix * snowWp).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSnowAmount;\nuniform float uSnowStrength;\nvarying float vSnowUp;\nvarying vec3 vSnowWorld;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float snowNoise = sin(vSnowWorld.x * 3.1) * sin(vSnowWorld.z * 2.7) * 0.08;
        float snowMask = smoothstep(0.45, 0.8, vSnowUp + snowNoise) * uSnowAmount * uSnowStrength;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.96, 1.0), snowMask);`,
      );
  };
  m.customProgramCacheKey = () => `snow-${strength}`;
  cache.set(mat, m);
  return m;
}
