// Pay Tracker: offline service worker.
// Network-first for the app files (so you always get the latest build when
// online), falling back to the cached copy whenever the network is
// unavailable. Your data is never cached here: it lives in the browser's
// local storage on your device.

const CACHE_VERSION = 'v1';
const CACHE_NAME = 'pay-tracker-' + CACHE_VERSION;

const APP_URL = self.registration.scope; // e.g. https://user.github.io/Pay-Tracker/
const PRECACHE_URLS = [
  APP_URL,
  APP_URL + 'index.html',
  APP_URL + 'manifest.json',
  APP_URL + 'icon-192.png',
  APP_URL + 'icon-512.png',
  APP_URL + 'apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        PRECACHE_URLS.map((url) =>
          fetch(url, { cache: 'no-cache' })
            .then((res) => (res.ok ? cache.put(url, res) : null))
            .catch(() => null)
        )
      )
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((cached) => {
          if (cached) return cached;
          if (req.mode === 'navigate') {
            return caches
              .match(APP_URL + 'index.html')
              .then((fallback) => fallback || caches.match(APP_URL));
          }
          return undefined;
        })
      )
  );
});
