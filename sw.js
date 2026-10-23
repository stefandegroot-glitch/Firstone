// Offline-Cache für die App-Dateien (die Fotos selbst liegen in IndexedDB).
const CACHE = 'zeitraffer-v2';
const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/camera.js',
  'js/db.js',
  'js/flow.js',
  'js/images.js',
  'js/morph-gl.js',
  'js/renderer.js',
  'js/vendor/mp4-muxer.mjs',
  'manifest.webmanifest',
  'icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Netzwerk zuerst (damit Updates sofort ankommen), Cache als Offline-Rückfall.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
