/* sw.js — 极简离线缓存（本地优先：缓存壳，数据在 localStorage） */
const CACHE = 'liftsheet-v1';
const ASSETS = ['./', './index.html', './css/style.css', './css/print.css', './js/app.js', './js/core.js', './js/store.js', './js/ui.js', './manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
