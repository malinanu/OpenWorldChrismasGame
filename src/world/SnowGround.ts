import * as THREE from 'three';
import { assets } from '../core/AssetLoader';

/** Metres covered by one repeat of the snow texture. */
export const SNOW_TILE = 4;

let cached: Promise<{ diff: THREE.Texture; nor: THREE.Texture; arm: THREE.Texture }> | null = null;

function loadMaps() {
  cached ??= Promise.all([
    assets.texture('snow/snow_diff.webp'),
    assets.texture('snow/snow_nor_gl.webp', false),
    assets.texture('snow/snow_arm.webp', false),
  ]).then(([diff, nor, arm]) => {
    for (const t of [diff, nor, arm]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 4;
    }
    return { diff, nor, arm };
  });
  return cached;
}

/** UVs from the geometry's own x/z, so the texture is SNOW_TILE metres wide however big the mesh is. */
export function setWorldUvs(geometry: THREE.BufferGeometry, tile = SNOW_TILE) {
  const pos = geometry.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / tile;
    uv[i * 2 + 1] = pos.getZ(i) / tile;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/**
 * Poly Haven "Snow 02" on a MeshStandardMaterial (diffuse + GL normal + AO/roughness from the packed ARM map).
 * Far away, a second sample at ~5× the scale is blended in so the 4 m repeat doesn't show as a grid.
 * Geometry needs world-scale UVs (see `setWorldUvs`). Vertex colours, if enabled, tint the snow (paths, shading).
 */
export async function createSnowGroundMaterial(opts: { vertexColors?: boolean; color?: THREE.ColorRepresentation } = {}) {
  const { diff, nor, arm } = await loadMaps();
  const mat = new THREE.MeshStandardMaterial({
    color: opts.color ?? '#ffffff',
    vertexColors: opts.vertexColors ?? false,
    map: diff,
    normalMap: nor,
    normalScale: new THREE.Vector2(0.9, 0.9),
    aoMap: arm, // red channel
    aoMapIntensity: 0.7,
    roughnessMap: arm, // green channel
    roughness: 1,
    metalness: 0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec4 snowNear = texture2D(map, vMapUv);
        vec4 snowFar = texture2D(map, vMapUv * 0.19 + vec2(0.31, 0.67));
        float snowDist = smoothstep(6.0, 40.0, length(vViewPosition));
        diffuseColor *= mix(snowNear, (snowNear + snowFar) * 0.5, snowDist);
      #endif`,
    );
  };
  mat.customProgramCacheKey = () => 'snow-ground';
  return mat;
}
