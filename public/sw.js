const CACHE = 'burger-point-v5';
const ASSETS = ['/', '/index.html'];

self.addEventListener('install', e =>
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)))
  // NOTE: no self.skipWaiting() here anymore — a freshly-downloaded version
  // now waits until the app explicitly approves it (see the SKIP_WAITING
  // message below), so a deploy can never silently interrupt someone mid
  // checkout. The app instead blocks "Place Order" and asks them to update.
);
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', e =>
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()))
);
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('supabase') || e.request.url.includes('unsplash')) return;

  // App shell (HTML/navigation) → network-first, so a redeploy is picked up
  // immediately instead of serving whatever was cached on first install.
  if (e.request.mode === 'navigate' || e.request.url.endsWith('/index.html')) {
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match(e.request).then(hit => hit || caches.match('/index.html')))
    );
    return;
  }

  // Hashed static assets (JS/CSS/images) → cache-first is safe here since
  // Vite gives them a new filename whenever content changes.
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return res;
    }).catch(() => caches.match('/index.html')))
  );
});
