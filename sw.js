// Service worker de Aura Catálogo.
// IMPORTANTE: cambia CACHE_VERSION cada vez que se modifique un archivo de la app,
// así los teléfonos descargan la versión nueva.
const CACHE_VERSION = 'v1.2.0';
const SHELL = `aura-shell-${CACHE_VERSION}`;
const IMAGES = 'aura-img';
const FONTS = 'aura-fonts';
const KEEP = [SHELL, IMAGES, FONTS];
const MAX_IMAGES = 150;

const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './api.js',
  './config.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(SHELL_FILES.map((u) => new Request(u, { cache: 'reload' }))))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (!KEEP.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

async function putSafe(cacheName, req, res) {
  try {
    const c = await caches.open(cacheName);
    await c.put(req, res);
  } catch {
    // Sin espacio: vaciamos la mitad de las imágenes y seguimos.
    await trim(IMAGES, MAX_IMAGES / 2).catch(() => {});
  }
}

// App shell: primero caché, si no hay → red.
async function cacheFirst(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) putSafe(SHELL, req, res.clone());
  return res;
}

// Primero red, si falla → caché (config.js, donde va tu URL).
async function networkFirst(req) {
  try {
    const res = await fetch(req, { cache: 'no-store' });
    if (res.ok) putSafe(SHELL, req, res.clone());
    return res;
  } catch {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw new Error('offline');
  }
}

// Fotos de Drive: caché en ejecución, máximo ~150.
async function imageCache(req) {
  const c = await caches.open(IMAGES);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') {
    await putSafe(IMAGES, req, res.clone());
    trim(IMAGES, MAX_IMAGES);
  }
  return res;
}

// Fuentes de Google: usar caché y refrescar en segundo plano.
async function staleWhileRevalidate(req) {
  const c = await caches.open(FONTS);
  const hit = await c.match(req);
  const net = fetch(req).then((res) => { if (res.ok) putSafe(FONTS, req, res.clone()); return res; }).catch(() => hit || Response.error());
  return hit || net;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // las ventas (POST) nunca se guardan ni se ponen en cola
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      event.respondWith(caches.match('./index.html').then((hit) => hit || fetch(req)));
      return;
    }
    // Los datos de prueba pasan directo, igual que el catálogo real.
    if (url.pathname.includes('/mock/')) return;
    if (url.pathname.endsWith('/config.js')) {
      event.respondWith(networkFirst(req));
      return;
    }
    event.respondWith(cacheFirst(req));
    return;
  }

  if (url.hostname === 'drive.google.com' && url.pathname.startsWith('/thumbnail')) {
    event.respondWith(imageCache(req));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }
  // El catálogo de Apps Script pasa directo: la app guarda su propia copia
  // (localStorage) y avisa "Sin conexión · mostrando copia de hace X".
});
