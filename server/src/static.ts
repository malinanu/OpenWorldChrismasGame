import compress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/** Fingerprinted build output (assets/name-<hash>.ext) never changes: cache for a year. */
const HASHED = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9.]+$/;
/** Models, textures, audio and world data aren't fingerprinted: cache a day, then revalidate. */
const CONTENT = /\.(gltf|glb|bin|webp|png|jpg|json|ogg|mp3|woff2?)$/;

/**
 * Serves the built game from `dir` (CloudPanel Node.js sites send every request to the app).
 * The API and WebSocket routes are registered separately and take precedence.
 */
export async function serveGame(app: FastifyInstance, dir: string) {
  // gzip/brotli for text; already-compressed files (images, the .wasm.bin) are skipped by type.
  await app.register(compress, { global: true, threshold: 1024, encodings: ['br', 'gzip'] });
  await app.register(fastifyStatic, {
    root: dir,
    prefix: '/',
    index: ['index.html'],
    // .well-known (Let's Encrypt) and dotfiles stay private.
    dotfiles: 'deny',
    setHeaders(res, path) {
      if (path.endsWith('.webmanifest')) res.header('Content-Type', 'application/manifest+json');
      if (path.endsWith('.gltf')) res.header('Content-Type', 'model/gltf+json');
      // The Rapier .wasm.bin is gzipped at build time and unpacked by the game; labelled as gzip
      // it is sent as-is (compressing it again breaks the browser's decode).
      if (path.endsWith('.wasm.bin')) res.header('Content-Type', 'application/gzip');
      if (path.endsWith('.glb')) res.header('Content-Type', 'model/gltf-binary');
      if (HASHED.test(path)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
      else if (CONTENT.test(path)) res.header('Cache-Control', 'public, max-age=86400');
      // The page and the service worker: always check for a new deploy.
      else res.header('Cache-Control', 'no-cache');
    },
  });
}
