// Pay Tracker lab: offline service worker, scoped to /lab/ only (the live app keeps its own).
// Network first for the app's files, so a new build arrives as soon as you are online; the saved copy is used when
// there is no signal, so the lab and its briefing map open in the air. Map tiles are saved separately by the map
// itself. Your data is never cached here: it lives in the browser's local storage on your device.

const CACHE = 'pay-tracker-lab-v3';
const SCOPE = self.registration.scope;               // .../lab/
const ROOT = new URL('../', SCOPE).href;              // .../ (for the shared PDF reader)
const PRECACHE = [
  '',
  'brief.js',
  'briefparse.js',
  'globedata.js',
  'index.html',
  'intro.js',
  'jet737.js',
  'lab.css',
  'lab.js',
  'manifest.json',
  'mapdata.js',
  'motion.js',
  'osint.css',
  'osint.js',
  'rwydata.js',
  'tzdata.js',
  'world3d.js',
  'fonts/b612-mono-latin-400.woff2',
  'fonts/b612-mono-latin-700.woff2',
  'fonts/corinthia-latin-400.woff2',
  'fonts/fraunces-latin-opsz-normal.woff2',
  'fonts/inter-latin-wght-normal.woff2',
  'fonts/newsreader-latin-400.woff2',
  'fonts/newsreader-latin-500.woff2',
  'intro/wall_log.jpg',
  'intro/wall_map.jpg',
  'intro/wall_month.jpg',
  'intro/wall_more.jpg',
  'intro/wall_pay.jpg',
  'vendor/gsap/DrawSVGPlugin.min.js',
  'vendor/gsap/MotionPathPlugin.min.js',
  'vendor/gsap/gsap.min.js',
  'vendor/lenis/lenis.min.js',
  'vendor/maplibre/maplibre-gl-worker.mjs',
  'vendor/maplibre/maplibre-gl.css',
  'vendor/maplibre/maplibre-gl.mjs',
  'vendor/satellite/satellite.min.js',
  'vendor/three/three.module.min.js',
].map(p => SCOPE + p).concat([
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
  'pdfjs/pdf.min.js',
  'pdfjs/pdf.worker.min.js',
].map(p => ROOT + p));

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(c => Promise.all(PRECACHE.map(u =>
    fetch(u, {cache: 'no-cache'}).then(r => r.ok ? c.put(u, r) : null).catch(() => null)))));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('pay-tracker-lab-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(fetch(req).then(res => {
    if(res.ok){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)) }
    return res;
  }).catch(() => caches.match(req, {ignoreSearch: true}).then(hit => {
    if(hit) return hit;
    if(req.mode === 'navigate') return caches.match(SCOPE + 'index.html').then(f => f || caches.match(SCOPE));
    return Response.error();
  })));
});
