/**
 * sw.js — 离线缓存（版本化 + 更新可靠到达）
 * 版本号必须随任何静态资源变更递增，否则老用户拿不到更新。
 */
const CACHE = 'garageledger-v3';
const ASSETS = [
  './index.html',
  './manifest.webmanifest',
  './css/style.css?v=2',
  './js/core.js?v=2',
  './js/store.js?v=2',
  './js/ui.js?v=2',
  './js/app.js?v=2',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (ev) => {
  if (ev.request.method !== 'GET') return;
  ev.respondWith(
    caches.match(ev.request, { cacheName: CACHE })
      .then((hit) => hit ?? fetch(ev.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(ev.request, copy));
        return res;
      }).catch(() => caches.match('./index.html'))),
  );
});
