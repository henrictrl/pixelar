#!/usr/bin/env node
/* Gera a galeria de efeitos (todas as texturas, filmes, padrões, lente, cor, dupla, pintura
 * e exemplos do dado) aplicados a duas fotos, para escolher o que fica e o que sai.
 * Uso: python3 -m http.server 8765 &   (na raiz do projeto)
 *      node tools/galeria.js foto1.jpg foto2.jpg saida.html
 * Precisa do Playwright com Chromium. As fotos não vão para o repositório. */
'use strict';
const fs = require('fs');
const { chromium } = require('playwright');
const [, , A, B, OUT = 'galeria.html'] = process.argv;
if (!A || !B) { console.error('uso: node tools/galeria.js foto1 foto2 saida.html'); process.exit(1); }
const URL = process.env.PIXELAR_URL || 'http://localhost:8765/';

(async () => {
    const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage();
    page.on('pageerror', e => console.error('ERRO', e.message));
    await page.goto(URL + '?galeria=' + Date.now());
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
            // Padrões (Pixel)
            DITHER_MODES.filter(m => m !== 'none').forEach(m => add('padrao', 'dither.' + m, DITHER_NAMES[m], s => { s.dither.mode = m; s.dither.scale = 2; }));
            // Pixel
            const long = Math.max(an.W, an.H);
            add('pixel', 'pixel.size', 'Tamanho do pixel', s => { s.pixel.size = Math.round(long / 90); });
            add('pixel', 'pixel.group', 'Agrupar', s => { s.pixel.size = Math.round(long / 360); s.pixel.group = 75; s.pixel.groupTol = 50; });
            add('pixel', 'edge', 'Contorno', s => { s.pixel.size = Math.round(long / 90); s.edge.size = 1; });
            // Cor
            add('cor', 'color.auto8', 'Cores da foto (8)', s => { s.color.sel = '8'; });
            add('cor', 'color.duotone', 'Duotone', s => { s.color.sel = 'duotone'; });
            add('cor', 'color.tritone', 'Tritone', s => { s.color.sel = 'tritone'; });
            add('cor', 'color.invert', 'Inverter', s => { s.color.invert = true; });
            add('cor', 'grad', 'Degradê', s => { s.grad.on = true; s.grad.blend = 'overlay'; s.grad.opacity = 70; });
            const PALS = { 'Game Boy': ['#0F380F', '#306230', '#8BAC0F', '#9BBC0F'], 'PICO-8': ['#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8', '#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA'], 'CGA': ['#000000', '#55FFFF', '#FF55FF', '#FFFFFF'], 'Cinza': ['#111111', '#555555', '#AAAAAA', '#F2F2F2'], 'Sépia': ['#2B1B0E', '#6B4226', '#A67B5B', '#D9BF9A', '#F5EBDC'], 'Vaporwave': ['#2D1B69', '#FF6AD5', '#C774E8', '#AD8CFF', '#94D0FF'], 'Terra': ['#3B2F2F', '#8C5E3C', '#C98B4F', '#E3C08D', '#F4E9D8'], 'Oceano': ['#03045E', '#0077B6', '#00B4D8', '#90E0EF', '#CAF0F8'], 'Neon': ['#0B0019', '#FF00E6', '#00F0FF', '#FFE600'], 'Riso': ['#1D3557', '#FF5F7E', '#F7F1E3'] };
            Object.entries(PALS).forEach(([n, l]) => add('paleta', 'palette.' + n, n, s => { s.color.base = l.slice(); s.color.ref = l.slice(); s.color.sel = String(l.length); s.color.mode = 'preset'; }));
            // Texturas
            const fams = [['Cor e luz', FX_FAMILIES.color], ['Tela', FX_FAMILIES.screen], ['Impressão', FX_FAMILIES.print], ['Forma e matéria', FX_FAMILIES.matter]];
            fams.forEach(([g, ids]) => ids.forEach(id => { const d = PixelarFX.getEffectDef(id); if (d) add('textura', 'fx.' + id, d.nome, s => { s.fx.id = id; }, { grupo: g }); }));
            // Filmes
            FILM_LOOK_DEFS.forEach(([g, list]) => list.forEach(([id, nome, desc]) => add('filme', 'film.' + id, nome, s => { s.film.look = id; }, { grupo: g, desc })));
            // Lente e grão
            const LN = { vignette: 'Vinheta', halation: 'Halação', bloom: 'Brilho difuso', soft: 'Suavidade', distort: 'Distorção', chroma: 'Aberração', leak: 'Vazamento' };
            Object.entries(LN).forEach(([k, n]) => add('lente', 'film.' + k, n, s => { s.film[k] = 70; }));
            add('lente', 'grain', 'Grão', s => { s.grain.amount = 45; });
            // Dupla exposição
            [['self', 'A mesma foto'], ['clouds', 'Nuvens'], ['light', 'Ondas de luz'], ['leaves', 'Folhagem']].forEach(([v, n]) => add('dupla', 'dbl.' + v, n, s => { s.dbl.on = true; s.dbl.src = v; }));
            // Pintura por números (nova)
            [['regions', 'Regiões'], ['pixels', 'Pixels']].forEach(([m, n]) => [[8, 'poucas cores'], [24, 'muitas cores']].forEach(([c, cn]) => add('pintura', 'paint.' + m + '.' + c, n + ' · ' + cn, s => { s.paint.mode = m; s.paint.colors = c; }, { novo: true })));
            // exemplos do dado novo
            const groups = new Set(Object.keys(RANDOM_GROUPS).filter(g => g !== 'movimento'));
            for (let i = 0; i < 10; i++) {
                const s = freshState(); const t = randomize(s, an, groups, new Set());
                Engine.render(s, { media, key: 'g' + Pixelar.media.serial, out, maxDim: 1200 });
                items.push({ sec: 'dado', id: 'dado.' + i, nome: t[0], desc: t.slice(1).join(' · '), img: small() });
            }
            return items;
        }));
    }
    await browser.close();
    // junta as duas fotos por efeito (os exemplos do dado são sorteios diferentes em cada foto)
    const byId = new Map();
    photos.forEach((list, k) => list.forEach(it => { const e = byId.get(it.id) || Object.assign({}, it, { imgs: [], descs: [], nomes: [] }); e.imgs[k] = it.img; e.nomes[k] = it.nome; e.descs[k] = it.desc || ''; delete e.img; byId.set(it.id, e); }));
    const data = [...byId.values()];
    const tpl = fs.readFileSync(__dirname + '/galeria.template.html', 'utf8');
    const font = fs.readFileSync(__dirname + '/../DepartureMono-Regular.woff2').toString('base64');
    const logo = fs.readFileSync(__dirname + '/../icons/logo.svg', 'utf8').replace(/<title>.*?<\/title>/, '').replace(/fill="#141414"/, 'fill="currentColor"').replace(/width="\d+" height="\d+"/, '');
    fs.writeFileSync(OUT, tpl.replace('/*FONT*/', font).replace('<!--LOGO-->', logo).replace('/*DATA*/null', JSON.stringify(data)));
    console.log('galeria:', OUT, data.length, 'efeitos', Math.round(fs.statSync(OUT).size / 1024) + ' KB');
})();
