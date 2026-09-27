/* Pixelar — service worker: abre instantâneo nas próximas visitas e funciona offline.
 * Estratégia "stale-while-revalidate": responde do cache e atualiza em segundo plano.
 * Ao publicar mudanças, basta aumentar VERSION. */
const VERSION = 'pixelar-2.3.0';
const CORE = ['./', 'index.html', 'css/app.css', 'js/gpu.js', 'js/engine.js', 'js/anim.js', 'js/presets.js', 'js/media.js', 'js/export.js', 'js/icons.js', 'js/sample.js', 'js/ui.js', 'DepartureMono-Regular.otf', 'manifest.webmanifest', 'icons/icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
    const req = e.request, url = new URL(req.url);
    if (req.method !== 'GET' || url.origin !== location.origin) return;
    e.respondWith(caches.open(VERSION).then(async (cache) => {
        const hit = await cache.match(req, { ignoreSearch: true });
        const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
    }));
});
