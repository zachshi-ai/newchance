/* sw.js — 极简离线缓存：缓存应用壳，命中失败回退网络 */
const CACHE = 'foodsentry-v2';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './css/style.css', './css/print.css',
  './js/app.js', './js/core.js', './js/store.js', './js/ui.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request))
  );
});
