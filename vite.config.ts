import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { defineConfig, type Plugin } from 'vite';

/**
 * Rapier's WebAssembly (3 MB) shipped as a gzip file the game unpacks itself with
 * DecompressionStream, so it stays ~1.2 MB on the wire whether or not the web server
 * compresses .wasm. It's named .bin so no server labels it `Content-Encoding: gzip`; if one
 * unpacks it anyway, the magic-number check below takes the bytes as they are. Replaces the `import * as wasm from "./rapier_wasm3d_bg.wasm"` in
 * @dimforge/rapier3d with a module that fetches, unpacks and instantiates it.
 */
function rapierGzip(): Plugin {
  const require = createRequire(import.meta.url);
  const wasmPath = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const gluePath = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.js');
  const VIRTUAL = '\0rapier-wasm-gz';
  const wasm = readFileSync(wasmPath);
  const gz = gzipSync(wasm, { level: 9 });
  const fileName = `assets/rapier3d-${createHash('sha256').update(gz).digest('hex').slice(0, 8)}.wasm.bin`;
  const rawName = fileName.replace(/\.wasm\.bin$/, '.wasm');
  const exportNames = WebAssembly.Module.exports(new WebAssembly.Module(wasm)).map((e) => e.name);
  let build = false;
  return {
    name: 'rapier-gzip',
    enforce: 'pre',
    configResolved(c) {
      build = c.command === 'build';
    },
    resolveId(id, importer) {
      if (id === './rapier_wasm3d_bg.wasm' && importer?.includes('@dimforge/rapier3d')) return VIRTUAL;
    },
    load(id) {
      if (id !== VIRTUAL) return;
      if (build) {
        this.emitFile({ type: 'asset', fileName, source: gz });
        // Uncompressed copy for browsers without DecompressionStream (iOS < 16.4).
        this.emitFile({ type: 'asset', fileName: rawName, source: wasm });
      }
      return `import * as glue from ${JSON.stringify(gluePath)};
const packed = typeof DecompressionStream !== 'undefined';
const res = await fetch(new URL(packed ? ${JSON.stringify(fileName)} : ${JSON.stringify(rawName)}, document.baseURI));
if (!res.ok) throw new Error('Physics engine failed to download (' + res.status + ')');
let bytes = await res.arrayBuffer();
const head = new Uint8Array(bytes, 0, 2);
if (head[0] === 0x1f && head[1] === 0x8b) bytes = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
const { instance } = await WebAssembly.instantiate(bytes, { './rapier_wasm3d_bg.js': glue });
export const { ${exportNames.join(', ')} } = instance.exports;`;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (!url.endsWith(fileName) && !url.endsWith(rawName)) return next();
        res.setHeader('Content-Type', url.endsWith(rawName) ? 'application/wasm' : 'application/octet-stream');
        res.end(url.endsWith(rawName) ? wasm : gz);
      });
    },
  };
}

const GAME_SERVER = {
  '/api': { target: 'http://127.0.0.1:3100', changeOrigin: false },
  '/ws': { target: 'ws://127.0.0.1:3100', ws: true },
};

export default defineConfig({
  // Relative base so the build works from a sub-folder (itch.io, GitHub Pages).
  base: './',
  plugins: [rapierGzip()],
  optimizeDeps: { exclude: ['@dimforge/rapier3d'] },
  // The game server (server/, port 3100) behind the same origin, as nginx does in production.
  server: { proxy: GAME_SERVER },
  preview: { proxy: GAME_SERVER },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
});
