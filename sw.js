/* Pixelar — service worker.
 * - A página (index.html) vem SEMPRE da rede; o cache só serve quando está offline.
 * - Os arquivos têm a versão no endereço (?v=...): cada versão é um conjunto fechado,
 *   então nunca se mistura um arquivo novo com um antigo.
 * - Ao instalar, baixa tudo ignorando o cache HTTP (cache: 'reload').
 * Para publicar: python3 tools/versao.py X.Y.Z */
const VERSION = 'pixelar-3.2.1';
const V = VERSION.replace('pixelar-', '');
const CORE = ['css/app.css', 'js/gpu.js', 'js/engine.js', 'js/anim.js', 'js/presets.js', 'js/media.js', 'js/export.js', 'js/icons.js', 'js/sample.js', 'js/muse.js', 'js/ui.js'].map(f => f + '?v=' + V)
    .concat(['./', 'DepartureMono-Regular.otf', 'manifest.webmanifest', 'icons/icon-192.png']);
self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(VERSION).then(c => Promise.all(CORE.map(u => fetch(new Request(u, { cache: 'reload' })).then(r => { if (r.ok) return c.put(u, r); })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
    const req = e.request, url = new URL(req.url);
    if (req.method !== 'GET' || url.origin !== location.origin) return;
    // página: rede primeiro (sem cache HTTP), cache só offline
    if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html')) {
        e.respondWith(fetch(req, { cache: 'no-store' }).then(r => { const c = r.clone(); caches.open(VERSION).then(k => k.put('./', c)); return r; }).catch(() => caches.match('./')));
        return;
    }
    // arquivos versionados: cache primeiro (o endereço muda a cada versão)
    e.respondWith(caches.open(VERSION).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const r = await fetch(req, { cache: url.search.includes('v=') ? 'reload' : 'default' });
        if (r.ok) cache.put(req, r.clone());
        return r;
    }));
});
