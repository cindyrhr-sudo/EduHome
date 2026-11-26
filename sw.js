/* EduHome Service Worker
   WICHTIG: Bei JEDEM Hochladen geänderter Dateien die VERSION erhöhen! */
const VERSION = 'v1';
const PRAEFIX = 'eduhome-';   // nur eigene Caches anfassen (GitHub Pages teilt sich den Speicher)
const CACHE = PRAEFIX + VERSION;

const DATEIEN = [
  './', './index.html', './style.css', './app.js', './qrcode.js', './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
];
// Dürfen fehlen, ohne dass die Installation scheitert
const ICONS = [
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon.ico',
  'icons/geodreieck.png', 'icons/geodreieck-dark.png',
  'icons/3line.png', 'icons/3line-dark.png', 'icons/Häuschen.png', 'icons/Häuschen-dark.png',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache:'reload' = nicht aus dem HTTP-Cache, sondern frisch vom Server
    await cache.addAll(DATEIEN.map(u => new Request(u, { cache: 'reload', mode: 'cors' })));
    await Promise.allSettled(ICONS.map(u => cache.add(new Request(u, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const namen = await caches.keys();
    await Promise.all(namen.filter(n => n.startsWith(PRAEFIX) && n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith('http')) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const treffer = await cache.match(e.request, { ignoreSearch: e.request.mode === 'navigate' });
    if (treffer) return treffer;
    const antwort = await fetch(e.request);
    // später nachgereichte Dateien (z.B. Icons) mit aufnehmen
    if (antwort.ok && new URL(e.request.url).origin === self.location.origin) {
      cache.put(e.request, antwort.clone());
    }
    return antwort;
  })());
});
