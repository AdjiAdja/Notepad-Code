// Network-first: selalu coba versi terbaru, jatuh ke cache bila offline. /api dan video tidak di-cache.
const CACHE = 'malude-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k); await self.clients.claim(); })());
});
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.endsWith('.mp4')) return;
  e.respondWith((async () => {
    try { const res = await fetch(r); if (res.ok) (await caches.open(CACHE)).put(r, res.clone()); return res; }
    catch { return (await caches.match(r)) || (await caches.match('index.html')) || Response.error(); }
  })());
});
