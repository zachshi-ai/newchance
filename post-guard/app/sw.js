/* 岗卫账 PostGuard — Service Worker：install 时以 reload 语义拉取全部资产，activate 清理旧缓存 */
const CACHE = 'postguard-v1';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './css/style.css', './css/print.css',
  './js/core.js', './js/store.js', './js/ui.js', './js/app.js',
  './icons/icon-192.png', './icons/icon-512.png',
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

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match('./index.html'))),
  );
});
