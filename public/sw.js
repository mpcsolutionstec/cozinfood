const CACHE = 'cozinfood-shell-v3';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['./', './manifest.webmanifest', './waiter-icon.svg', './logo/Logo_CozinFood.png'])));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone(); caches.open(CACHE).then(cache => cache.put('./', copy)); return response;
    }).catch(() => caches.match('./')));
    return;
  }
  if (url.pathname.includes('/assets/') || url.pathname.includes('/logo/') || url.pathname.endsWith('/waiter-icon.svg')) event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, copy)); return response;
  })));
});
