/* Pixelar Studio — Service Worker (v6.0.0)
 * - Rede primeiro (cache: 'no-store') para index.html, garantindo atualização imediata em todos os dispositivos.
 * - Limpa automaticamente todos os caches antigos (pixelar-5.x e anteriores) ao ativar.
 * - Mantém funcionamento 100% offline como PWA no iPhone, iPad, Android e Desktop.
 */
const VERSION = 'pixelar-6.0.1';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((cache) => Promise.all(CORE.map((u) => fetch(new Request(u, { cache: 'reload' })).then((r) => { if (r.ok) return cache.put(u, r); }).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html')) {
    e.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put('./', copy));
          }
          return res;
        })
        .catch(() => caches.match('./').then((m) => m || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
