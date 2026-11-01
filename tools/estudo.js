#!/usr/bin/env node
/* Gera o estudo de filmes e câmeras (candidatos de tools/estudo-filmes.js) e os estilos pedidos,
 * aplicados a duas fotos, para escolher o que entra no app.
 * Uso: python3 -m http.server 8765 &   (na raiz do projeto)
 *      node tools/estudo.js foto1.jpg foto2.jpg saida.html
 * Precisa do Playwright com Chromium. As fotos não vão para o repositório. */
'use strict';
const fs = require('fs');
const { chromium } = require('playwright');
const [, , A, B, OUT = 'estudo.html'] = process.argv;
if (!A || !B) { console.error('uso: node tools/estudo.js foto1 foto2 saida.html'); process.exit(1); }
const URL = process.env.PIXELAR_URL || 'http://localhost:8765/';

(async () => {
    const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage();
    page.on('pageerror', e => console.error('ERRO', e.message));
    await page.goto(URL + '?galeria=' + Date.now());
    await page.addScriptTag({ url: URL + 'tools/estudo-filmes.js' });
    await page.waitForTimeout(800);
    const photos = [];
    for (const f of [A, B]) {
        await page.setInputFiles('#fileInput', f);
        await page.waitForTimeout(2500);
        photos.push(await page.evaluate(async () => {
            const media = Pixelar.media.el, an = analyzeMedia(media);
            const big = document.createElement('canvas'), out = { canvas: big, ctx: big.getContext('2d') };
            const small = (H = 360) => {   // redução em etapas (sem serrilhado), saída em WebP
                let s = big, w = big.width, h = big.height;
                while (h / 2 >= H) { const t = document.createElement('canvas'); t.width = Math.round(w / 2); t.height = Math.round(h / 2); const c = t.getContext('2d'); c.imageSmoothingQuality = 'high'; c.drawImage(s, 0, 0, w, h, 0, 0, t.width, t.height); s = t; w = t.width; h = t.height; }
                const o = document.createElement('canvas'); o.height = H; o.width = Math.round(H * w / h); const c = o.getContext('2d'); c.imageSmoothingQuality = 'high'; c.drawImage(s, 0, 0, w, h, 0, 0, o.width, o.height);
                return o.toDataURL('image/webp', 0.74);
            };
            const shot = (mod) => { const s = freshState(); mod(s); Engine.render(s, { media, key: 'g' + Pixelar.media.serial, out, maxDim: 1200 }); return small(); };
            const items = [];
            const add = (sec, id, nome, mod, extra = {}) => items.push(Object.assign({ sec, id, nome, img: shot(mod) }, extra));
            add('ref', 'original', 'Foto original', () => {});
            ESTUDO_FILMES.forEach(([g, l]) => l.forEach(([id, n, d, u]) => { FILM_LOOKS[id] = { id, nome: n, desc: d, group: g, u }; }));
            const long = Math.max(an.W, an.H);
            add('pedido', 'style.16bit', '16-bit', s => { s.pixel.size = Math.max(1, Math.round(long / 240)); s.color.sel = '24'; s.dither.mode = 'bayer8'; s.dither.scale = 1; s.dither.intensity = 70; s.adj.saturation = 35; s.adj.contrast = 15; }, { desc: 'Pixel + 24 cores da foto + pontilhado Bayer entre as cores.' });
            add('pedido', 'fx.oil', 'Pintura a óleo', s => { s.fx.id = 'oil'; s.adj.saturation = 10; }, { desc: 'Textura nova: pincel, relevo da tinta, marcas do pincel e saturação ajustáveis.' });
            add('pedido', 'fx.watercolor', 'Aquarela', s => { s.fx.id = 'watercolor'; s.adj.brightness = 8; }, { desc: 'Textura nova: aguada, escorrido, traço, granulado e papel ajustáveis.' });
            ['celular2010', 'flash_noturno', 'vencido_verde'].forEach(id => add('pedido', 'film.' + id, FILM_LOOKS[id].nome, s => { s.film.look = id; }, { desc: FILM_LOOKS[id].desc }));
            ESTUDO_FILMES.forEach(([g, l]) => l.forEach(([id, n, d]) => add('estudo', 'film.' + id, n, s => { s.film.look = id; }, { grupo: g, desc: d })));
            return items;
        }));
    }
    await browser.close();
    // junta as duas fotos por efeito (os exemplos do dado são sorteios diferentes em cada foto)
    const byId = new Map();
    photos.forEach((list, k) => list.forEach(it => { const e = byId.get(it.id) || Object.assign({}, it, { imgs: [], descs: [], nomes: [] }); e.imgs[k] = it.img; e.nomes[k] = it.nome; e.descs[k] = it.desc || ''; delete e.img; byId.set(it.id, e); }));
    const data = [...byId.values()];
    const tpl = fs.readFileSync(__dirname + '/estudo.template.html', 'utf8');
    const font = fs.readFileSync(__dirname + '/../DepartureMono-Regular.woff2').toString('base64');
    const logo = fs.readFileSync(__dirname + '/../icons/logo.svg', 'utf8').replace(/<title>.*?<\/title>/, '').replace(/fill="#141414"/, 'fill="currentColor"').replace(/width="\d+" height="\d+"/, '');
    fs.writeFileSync(OUT, tpl.replace('/*FONT*/', font).replace('<!--LOGO-->', logo).replace('/*DATA*/null', JSON.stringify(data)));
    console.log('galeria:', OUT, data.length, 'efeitos', Math.round(fs.statSync(OUT).size / 1024) + ' KB');
})();
