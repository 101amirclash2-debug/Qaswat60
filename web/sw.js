/* عامل الخدمة للنسخة المستضافة على الشبكة المحلية (لا يُستخدم داخل APK) */
const CACHE = 'tijara-v2';
const ASSETS = [
  './', './index.html', './css/style.css', './manifest.webmanifest',
  './js/engine.js', './js/store.js', './js/audio.js', './js/fx.js',
  './js/net.js', './js/ui.js', './js/app.js',
  './icons/icon-192.png', './icons/icon-512.png'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.pathname.endsWith('/ws') || url.protocol === 'ws:' || url.protocol === 'wss:') return;
  if (e.request.method !== 'GET') return;
  // صفحات HTML: الشبكة أولاً كي لا تُعرض نسخة قديمة في المعاينة الحيّة،
  // مع الرجوع للكاش عند انقطاع الاتصال.
  if (e.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/') {
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(e.request).then(h => h || caches.match('./index.html')))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
