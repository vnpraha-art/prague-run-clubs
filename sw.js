/* Prague Run Clubs — service worker
   Makes the site installable and lets it open offline.

   - Page (index.html): network first, so visitors always get the latest version;
     the saved copy is used only when the network is down.
   - App icons + manifest: cache first.
   - Leaflet + Google Fonts from CDNs: served from cache, refreshed in the background.
   - Club data (Google Apps Script) and map tiles are NOT handled here:
     club data is kept by the page itself (localStorage), tiles use the normal browser cache.

   Bump VERSION when you change this file so old caches are cleared. */

const VERSION = 'prc-v2';
const CORE = [
  '/',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/favicon-32.png'
];
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 1) Page navigations: network first, fall back to the saved page
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok && url.origin === self.location.origin) {
            const copy = res.clone();
            caches.open(VERSION).then(c => c.put('/', copy));
          }
          return res;
        })
        .catch(() => caches.match('/').then(hit => hit || Response.error()))
    );
    return;
  }

  // 2) Own static files (icons, manifest): cache first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      }))
    );
    return;
  }

  // 3) CDN libraries and fonts: serve saved copy, refresh in the background
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(VERSION).then(cache =>
        cache.match(req).then(hit => {
          const network = fetch(req).then(res => {
            if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
            return res;
          }).catch(() => hit || Response.error());
          return hit || network;
        })
      )
    );
  }
  // Everything else (club data, map tiles, Google Forms) goes straight to the network.
});
