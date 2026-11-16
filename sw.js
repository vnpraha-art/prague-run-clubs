/* Prague Run Clubs — service worker
   Makes the app installable and lets it open offline after the first visit.

   - App shell (page, app.css, app.js): network first with a short timeout, so you always
     get the latest version; the saved copy is used when the network is down or slow.
   - Fonts, map library, icons, manifest, bundled club snapshot: cache first.
   - Map tiles and map label fonts (tiles.openfreemap.org): saved as you view them, so the
     parts of Prague you have looked at keep working offline. Capped, oldest dropped first.
   - Club data (Google Apps Script) and the weather forecast are NOT handled here:
     the page keeps its own copy of both in localStorage.

   Bump VERSION when you change this file or add files to SHELL, so old caches are cleared. */

const VERSION = 'prc-v3';
const SHELL_CACHE = VERSION + '-shell';
const MAP_CACHE = 'prc-map-v1';           // kept across app versions so tiles are not re-downloaded
const MAP_HOST = 'tiles.openfreemap.org';
const MAX_TILES = 700;
const TILE_MAX_AGE = 45 * 24 * 60 * 60 * 1000;

const NETWORK_FIRST = ['/', '/index.html', '/app.css', '/app.js'];
const SHELL = [
  '/', '/app.css', '/app.js',
  '/manifest.webmanifest', '/clubs-snapshot.json',
  '/fonts/archivo-latin.woff2', '/fonts/archivo-latin-ext.woff2',
  '/vendor/maplibre-gl.js', '/vendor/maplibre-gl.css',
  '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png', '/favicon-32.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL_CACHE && k !== MAP_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function timeout(ms) { return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)); }

// Latest from the network, saved for later; the saved copy if the network fails or takes too long.
async function networkFirst(request, cacheKey, cacheName, ms) {
  const cache = await caches.open(cacheName);
  const fromNetwork = fetch(request).then(res => {
    if (res.ok) cache.put(cacheKey, res.clone());
    return res;
  });
  try {
    return await Promise.race([fromNetwork, timeout(ms)]);
  } catch (err) {
    const hit = await cache.match(cacheKey);
    if (hit) { fromNetwork.catch(() => {}); return hit; }
    return fromNetwork;                     // nothing saved yet: wait for the network after all
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

// Tile URLs carry a data version (/planet/20261101_080013_pt/z/x/y.pbf) that changes about weekly.
// Tiles are saved under a version-free key so an older copy still serves offline.
function tileKey(url) {
  return url.origin + url.pathname.replace(/^\/planet\/[^/]+\//, '/planet/_/');
}
let tilePuts = 0;
async function saveTile(cache, key, res) {
  const body = await res.arrayBuffer();
  await cache.put(key, new Response(body, {
    headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/x-protobuf', 'X-Saved-At': String(Date.now()) }
  }));
  if (++tilePuts % 40 === 0) {
    const keys = await cache.keys();
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_TILES))) await cache.delete(k);
  }
}
async function mapAsset(request, url) {
  const cache = await caches.open(MAP_CACHE);
  const key = tileKey(url);
  const hit = await cache.match(key);
  if (hit) {
    const age = Date.now() - Number(hit.headers.get('X-Saved-At') || 0);
    if (age > TILE_MAX_AGE) fetch(request).then(res => res.ok && saveTile(cache, key, res)).catch(() => {});
    return hit;
  }
  const res = await fetch(request);
  if (res.ok) saveTile(cache, key, res.clone()).catch(() => {});
  return res;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 1) Opening the app: latest page, or the saved one when offline
  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, '/', SHELL_CACHE, 4000).catch(() => caches.match('/')));
    return;
  }

  if (url.origin === self.location.origin) {
    // 2) App code: network first, so a deploy shows up on the next open
    if (NETWORK_FIRST.includes(url.pathname)) {
      event.respondWith(networkFirst(req, url.pathname, SHELL_CACHE, 4000));
      return;
    }
    // 3) Everything else we ship (fonts, map library, icons, snapshot): cache first
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }

  // 4) Map: the tile index is network first (it names the current tile version),
  //    tiles and label fonts are cache first
  if (url.hostname === MAP_HOST) {
    if (url.pathname === '/planet') event.respondWith(networkFirst(req, req.url, MAP_CACHE, 4000));
    else event.respondWith(mapAsset(req, url));
  }
  // Everything else (club data, weather, Google Forms) goes straight to the network.
});
