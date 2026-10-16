import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

const BASE = `${import.meta.env.BASE_URL}assets/`;

/** Resolves a model id like "holiday/christmas_tree" to its URL. */
export function modelUrl(id: string): string {
  if (/\.(glb|gltf)$/.test(id)) return `${BASE}models/${id}`;
  return `${BASE}models/${id}.gltf`;
}

export function textureUrl(path: string): string {
  return `${BASE}textures/${path}`;
}

/**
 * Cached loader for glTF models and textures. Reports progress to an optional
 * callback so the loading screen can show a bar.
 */
export class AssetLoader {
  private readonly manager = new THREE.LoadingManager();
  private readonly gltf = new GLTFLoader(this.manager);
  private readonly tex = new THREE.TextureLoader(this.manager);
  private readonly gltfCache = new Map<string, Promise<GLTF>>();
  private readonly texCache = new Map<string, Promise<THREE.Texture>>();

  onProgress?: (loaded: number, total: number) => void;

  constructor() {
    this.manager.onProgress = (_url, loaded, total) => this.onProgress?.(loaded, total);
  }

  /** Load a glTF by model id (e.g. "forest/Tree_1_A_Color1") or path ending in .glb. */
  model(id: string): Promise<GLTF> {
    const url = modelUrl(id);
    let p = this.gltfCache.get(url);
    if (!p) {
      p = this.gltf.loadAsync(url).then((g) => {
        g.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
          }
        });
        return g;
      });
      p.catch(() => this.gltfCache.delete(url));
      this.gltfCache.set(url, p);
    }
    return p;
  }

  /** A fresh clone of a (non-skinned) model's scene; geometry and materials are shared. */
  async instance(id: string): Promise<THREE.Object3D> {
    const g = await this.model(id);
    return g.scene.clone(true);
  }

  texture(path: string, srgb = true): Promise<THREE.Texture> {
    const url = textureUrl(path);
    let p = this.texCache.get(url);
    if (!p) {
      p = this.tex.loadAsync(url).then((t) => {
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        return t;
      });
      this.texCache.set(url, p);
    }
    return p;
  }
}

export const assets = new AssetLoader();
