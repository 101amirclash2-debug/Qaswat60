/**
 * QASWARA offline shell.
 *
 * Strategy
 *  - Navigations (the HTML shell): network-first so a rotated bridge token is
 *    always fresh; fall back to cache when offline.
 *  - Static assets: cache-first with background refresh.
 *  - Bridge and provider APIs: never cached (never stale, never stored).
 */

const VERSION = 'qaswara-v2.0.0';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icon.svg',
  './js/app.js',
  './js/agent.js',
  './js/config.js',
  './js/lab.js',
  './js/live.js',
  './js/markdown.js',
  './js/memory.js',
  './js/models.js',
  './js/persona.js',
  './js/privacy.js',
  './js/providers.js',
  './js/safety.js',
  './js/store.js',
  './js/studio.js',
  './js/tools.js',
  './js/voice.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isApi(url) {
  return /^\/(health|execute|files|memory|install|device|phone|capture|extract|office|media|app|audit)(\/|$)/.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin && !SHELL.includes(request.url)) return;
  if (isApi(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html').then((hit) => hit || Response.error()))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
