// NovaStream service worker — conservative caching.
// - Navigations: network-first (so updates show), offline fallback to cached shell.
// - Hashed /assets/: stale-while-revalidate (safe, filenames change per build).
// - Icons/manifest: cache-first.
// - API and Plex proxy/video: never intercepted (dynamic + auth + streaming).
const CACHE = 'nova-v14';   // v14 : purge forcee apres la panne du 2026-08-23

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/plex')) return;

  // App navigations
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(request);
        // On ne met en cache qu'une reponse SAINE : pendant la panne du
        // 2026-08-23, une page servie alors que dist/assets etait vide se
        // serait figee ici et aurait survecu a la reparation du serveur.
        if (res.ok) cache.put('/', res.clone());
        return res;
      } catch {
        return (await cache.match('/')) || Response.error();
      }
    })());
    return;
  }

  // Hashed build assets
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      const network = fetch(request)
        .then(res => { if (res.ok) cache.put(request, res.clone()); return res; })
        .catch(() => cached);
      return cached || network;
    })());
    return;
  }

  // Icones, manifeste, ecrans de demarrage : mis en cache une fois pour toutes
  if (/\.(png|svg|webmanifest|ico)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      } catch {
        return cached || Response.error();
      }
    })());
  }
});


/* ── Notifications push ───────────────────────────────────────────────
   Le serveur envoie { title, body, url, tag }. Un clic ouvre l'onglet
   NovaStream déjà ouvert s'il y en a un, sinon en ouvre un sur `url`. */
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data && event.data.text() }; }
  const title = d.title || 'NovaStream';
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || 'nova',
    data: { url: d.url || '/' },
    renotify: !!d.tag,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes(self.location.origin)) { await c.focus(); return c.navigate(target); }
    }
    return self.clients.openWindow(target);
  })());
});
