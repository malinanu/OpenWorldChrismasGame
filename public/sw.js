/*
 * Frostvale service worker: makes repeat visits load game files from the phone's cache.
 * - Fingerprinted build files (assets/*-<hash>.*) never change: served from cache, no network.
 * - Models, textures, world data, audio: served from cache, refreshed in the background.
 * - Everything else (the page itself, /api, /ws, other sites) is left to the browser untouched,
 *   so a failure here can never break loading the game.
 */
const CACHE = 'frostvale-v3';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

const hashed = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9.]+$/;
const gameFile = /\/(assets|world|icons)\//;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.mode === 'navigate') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !gameFile.test(url.pathname) || url.pathname.includes('/api/')) return;

  e.respondWith(
    (async () => {
      try {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(req);
        if (hit && hashed.test(url.pathname)) return hit;
        const network = fetch(req).then((res) => {
          if (res.ok) cache.put(req, res.clone()).catch(() => {});
          return res;
        });
        if (hit) {
          // Serve the cached copy now; refresh it quietly for next time.
          e.waitUntil(network.catch(() => {}));
          return hit;
        }
        return await network;
      } catch {
        // Cache unavailable or the background attempt failed: let the request go through normally.
        return fetch(req);
      }
    })(),
  );
});
