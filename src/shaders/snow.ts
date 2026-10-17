import * as THREE from 'three';

const cache = new WeakMap<THREE.Material, Map<string, THREE.Material>>();

/** Shared by every snowy material. `uSnowTime` drives the wind; main.ts updates it each frame. */
export const snowUniforms = { uSnowAmount: { value: 1 }, uSnowTime: { value: 0 } };

/**
 * Returns a copy of `mat` that blends towards snow white wherever the world-space
 * normal faces up. Works with InstancedMesh and SkinnedMesh because it reads the
 * final view-space normal from three's `defaultnormal_vertex` chunk.
 *
 * `sway` > 0 adds wind: vertices bend with the square of their height, so trunks
 * stay planted while crowns move. Each instance gets its own phase from its position.
 */
export function snowify(mat: THREE.Material, strength = 1, sway = 0): THREE.Material {
  const key = `${strength}|${sway}`;
  let variants = cache.get(mat);
  if (!variants) cache.set(mat, (variants = new Map()));
  const hit = variants.get(key);
  if (hit) return hit;

  const m = mat.clone();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSnowAmount = snowUniforms.uSnowAmount;
    shader.uniforms.uSnowTime = snowUniforms.uSnowTime;
    shader.uniforms.uSnowStrength = { value: strength };
    shader.uniforms.uSway = { value: sway };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uSnowTime;\nuniform float uSway;\nvarying float vSnowUp;\nvarying vec3 vSnowWorld;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        if (uSway > 0.0) {
          vec2 swayPhase = vec2(0.0);
          #ifdef USE_INSTANCING
            swayPhase = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
          #endif
          float swayH = max(transformed.y, 0.0);
          float gust = sin(uSnowTime * 1.1 + swayPhase.x * 0.15 + swayPhase.y * 0.11)
                     + 0.5 * sin(uSnowTime * 2.3 + swayPhase.x * 0.37 - swayPhase.y * 0.21);
          float bend = gust * swayH * swayH * 0.004 * uSway;
          transformed.x += bend;
          transformed.z += bend * 0.6;
        }`,
      )
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
  m.customProgramCacheKey = () => `snow-${strength}-${sway > 0 ? 'sway' : 'still'}`;
  variants.set(key, m);
  return m;
}
