// Pay Tracker lab: offline service worker, scoped to /lab/ only (the live app keeps its own).
// Network first for the app's files, so a new build arrives as soon as you are online; the saved copy is used when
// there is no signal, so the lab and its briefing map open in the air. Map tiles are saved separately by the map
// itself. Your data is never cached here: it lives in the browser's local storage on your device.

const CACHE = 'pay-tracker-lab-v1';
const SCOPE = self.registration.scope;               // .../lab/
const ROOT = new URL('../', SCOPE).href;              // .../ (for the shared PDF reader)
const PRECACHE = [
  '', 'index.html', 'lab.css', 'lab.js', 'motion.js', 'mapdata.js', 'tzdata.js', 'globedata.js', 'world3d.js', 'jet737.js',
  'brief.js', 'briefparse.js', 'rwydata.js',
  'vendor/maplibre/maplibre-gl.mjs', 'vendor/maplibre/maplibre-gl-worker.mjs', 'vendor/maplibre/maplibre-gl.css',
  'vendor/gsap/gsap.min.js', 'vendor/gsap/MotionPathPlugin.min.js', 'vendor/gsap/DrawSVGPlugin.min.js', 'vendor/three/three.module.min.js'
].map(p => SCOPE + p).concat([ROOT + 'pdfjs/pdf.min.js', ROOT + 'pdfjs/pdf.worker.min.js']);

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
