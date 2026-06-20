// ================================================================
// TALITHA CONFECCIONISTAS — Service Worker
// ================================================================
const CACHE_NAME    = 'talitha-conf-v4';
const STATIC_ASSETS = [
  '/', '/index.html', '/app.js', '/manifest.json',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS.map(url => new Request(url, { mode: 'no-cors' }))))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Cache error:', err))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'Sin conexión' }), { headers: { 'Content-Type': 'application/json' } })
      )
    );
    return;
  }

  // El "shell" de la app (HTML + app.js) siempre se busca primero en la red,
  // para que al reabrir la app con conexión SIEMPRE se cargue la versión más
  // reciente publicada, sin depender de que alguien cambie CACHE_NAME a mano.
  // Solo si no hay conexión se usa la copia guardada (modo offline).
  const esAppShell = url.origin === self.location.origin &&
    (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/app.js');

  if (esAppShell) {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request).then(cached => cached || caches.match('/index.html')))
    );
    return;
  }

  // Resto de archivos (íconos, manifest, librerías externas): primero caché,
  // ya que casi nunca cambian y así la app carga más rápido.
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        if (event.request.mode === 'navigate') return caches.match('/index.html');
      });
    })
  );
});
