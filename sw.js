const CACHE_NAME = '2048-ai-pwa-v1';
const WASM_PATH = '/wasm/engine.a528e904.wasm';
const PRECACHE_URLS = [
  '/',
  '/style.css',
  '/js/game.js',
  '/js/ui.js',
  '/js/ai.js',
  '/js/main.js',
  WASM_PATH,
  '/high-score-1.webp',
  '/high-score-2.webp',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // serve content-hashed wasm binaries cache-first once downloaded
  if (/^\/wasm\/engine\.[0-9a-f]+\.wasm$/.test(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => {});
          }
          return res;
        });
      })
    );
    return;
  }

  // network-first for html and runtime assets so online updates apply cleanly while offline falls back to cache
  event.respondWith(
    fetch(event.request).then(res => {
      if (res && res.ok && PRECACHE_URLS.includes(url.pathname)) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => {});
      }
      return res;
    }).catch(() =>
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('/');
        return Response.error();
      })
    )
  );
});