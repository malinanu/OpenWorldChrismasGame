/*
 * Frostvale service worker: makes repeat visits load from the phone's cache.
 * - Fingerprinted build files (assets/*-<hash>.*) never change: cache first.
 * - Models, textures, world layout: served from cache, refreshed in the background.
 * - The page itself: network first, so a new deploy shows up on the next visit.
 */
const CACHE = 'frostvale-v1';

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

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req)),
    );
    return;
  }

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      const refresh = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      });
      if (hit) {
        if (!hashed.test(url.pathname)) e.waitUntil(refresh.catch(() => {}));
        return hit;
      }
      return refresh;
    })(),
  );
});
