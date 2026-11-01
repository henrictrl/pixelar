/* Pixelar — Pintura (efeito final inspirado em apps de "pintar a foto": só o resultado pronto).
 *
 * Dois modos sobre a imagem já processada:
 *  - Regiões: a foto vira manchas de cor chapada (quantização + filtro de maioria + fusão
 *    de manchas pequenas), com contorno fino opcional entre elas.
 *  - Pixels: grade de células com a cor quantizada e linhas da grade opcionais.
 * Tudo ajustável: quantidade de cores, detalhe (regiões), tamanho das células (pixels),
 * manchas mínimas, arredondamento, linhas e cor do traço.
 *
 * Roda depois de todo o resto (último passo do Engine.render), na resolução final:
 * as linhas ficam nítidas e proporcionais (a prévia e o arquivo exportado saem iguais).
 * O último resultado fica guardado para o SVG vetorial.
 */
'use strict';

const PAINT_LIMITS = { colors: [2, 48], detail: [0, 100], size: [8, 200], minArea: [1, 80], smooth: [0, 4], lines: [0, 100] };
const clampP = (v, k) => Math.max(PAINT_LIMITS[k][0], Math.min(PAINT_LIMITS[k][1], Math.round(+v || 0)));

const PaintFX = (() => {
    const gridC = document.createElement('canvas'), gctx = gridC.getContext('2d', { willReadFrequently: true });
    const fillC = document.createElement('canvas'), fctx = fillC.getContext('2d');
    let cache = { key: '', res: null };
    let last = null;                                   // último desenho (para o SVG)

    // ---------- utilitários ----------
    function quickHash(d) { let h = 2166136261; for (let i = 0; i < d.length; i += 13) h = Math.imul(h ^ d[i], 16777619); return (h >>> 0).toString(36) + d.length; }
    const lum = (c) => 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
    const css = (c, a = 1) => `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${a})`;

    // paleta (do escuro ao claro) e índice de cor por pixel; 255 = transparente
    const memo = new Uint8Array(1 << 18);   // cor (6 bits por canal) → índice da paleta, refeito a cada análise
    function quantize(d, n, count) {
        const px = [], step = Math.max(1, Math.floor(n / 12000));
        for (let p = 0; p < n; p += step) { const i = p * 4; if (d[i + 3] >= 128) px.push({ r: d[i], g: d[i + 1], b: d[i + 2] }); }
        let pal = getMedianCut(px, count).filter(c => c.count > 0).map(c => ({ r: c.r, g: c.g, b: c.b }));
        // tira cores quase iguais (a mediana corta faixas vazias em fotos com poucas cores)
        const uniq = [];
        pal.forEach(c => { if (!uniq.some(u => Math.abs(u.r - c.r) + Math.abs(u.g - c.g) + Math.abs(u.b - c.b) < 10)) uniq.push(c); });
        pal = uniq.length ? uniq.sort((a, b) => lum(a) - lum(b)) : [{ r: 0, g: 0, b: 0 }];
        const idx = new Uint8Array(n); memo.fill(255);
        for (let p = 0; p < n; p++) {
            const i = p * 4; if (d[i + 3] < 128) { idx[p] = 255; continue; }
            const key = ((d[i] >> 2) << 12) | ((d[i + 1] >> 2) << 6) | (d[i + 2] >> 2);
            let best = memo[key];
            if (best === 255) {
                let min = Infinity; best = 0;
                for (let k = 0; k < pal.length; k++) { const c = pal[k], dr = d[i] - c.r, dg = d[i + 1] - c.g, db = d[i + 2] - c.b; const e = 2 * dr * dr + 4 * dg * dg + 3 * db * db; if (e < min) { min = e; best = k; } }
                memo[key] = best;
            }
            idx[p] = best;
        }
        return { pal, idx };
    }
    // filtro de maioria 3×3: some com os pontinhos e arredonda as manchas
    function majority(idx, w, h, passes) {
        let a = idx, b = new Uint8Array(idx.length);
        const cnt = new Uint8Array(256), seen = [];
        for (let p = 0; p < passes; p++) {
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                const c = a[y * w + x]; if (c === 255) { b[y * w + x] = 255; continue; }
                seen.length = 0; let best = c, bc = -1, cc = 0;
                for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; const v = a[yy * w + xx]; if (v === 255) continue; if (!cnt[v]) seen.push(v); cnt[v]++; } }
                for (const v of seen) { const k = cnt[v]; if (v === c) cc = k; if (k > bc) { bc = k; best = v; } cnt[v] = 0; }
                b[y * w + x] = cc >= bc ? c : best;   // empate: fica a cor atual
            }
            const t = a; a = b; b = t === idx ? new Uint8Array(idx.length) : t;
        }
        return a;
    }
    // regiões conectadas (4 vizinhos)
    function label(idx, w, h) {
        const n = w * h, comp = new Int32Array(n).fill(-1), stack = new Int32Array(n), areas = [], colors = [];
        let id = 0;
        for (let s = 0; s < n; s++) {
            if (comp[s] !== -1 || idx[s] === 255) continue;
            const c = idx[s]; let sp = 0, area = 0; stack[sp++] = s; comp[s] = id;
            while (sp) {
                const p = stack[--sp]; area++;
                const x = p % w;
                if (x > 0 && comp[p - 1] === -1 && idx[p - 1] === c) { comp[p - 1] = id; stack[sp++] = p - 1; }
                if (x < w - 1 && comp[p + 1] === -1 && idx[p + 1] === c) { comp[p + 1] = id; stack[sp++] = p + 1; }
                if (p >= w && comp[p - w] === -1 && idx[p - w] === c) { comp[p - w] = id; stack[sp++] = p - w; }
                if (p < n - w && comp[p + w] === -1 && idx[p + w] === c) { comp[p + w] = id; stack[sp++] = p + w; }
            }
            areas.push(area); colors.push(c); id++;
        }
        return { comp, areas, colors, count: id };
    }
    // manchas menores que minArea viram a cor vizinha mais presente
    function mergeSmall(idx, w, h, minArea) {
        for (let it = 0; it < 3; it++) {
            const L = label(idx, w, h); let changed = false;
            const nb = new Map();
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                const p = y * w + x, a = L.comp[p]; if (a < 0 || L.areas[a] >= minArea) continue;
                const check = (q) => { const b = L.comp[q]; if (b < 0 || b === a) return; let m = nb.get(a); if (!m) { m = new Map(); nb.set(a, m); } const col = idx[q]; m.set(col, (m.get(col) || 0) + 1 + (L.areas[b] >= minArea ? 2 : 0)); };
                if (x > 0) check(p - 1); if (x < w - 1) check(p + 1); if (y > 0) check(p - w); if (y < h - 1) check(p + w);
            }
            if (!nb.size) break;
            const target = new Map();
            nb.forEach((m, a) => { let best = -1, bc = -1; m.forEach((v, col) => { if (v > bc) { bc = v; best = col; } }); target.set(a, best); });
            for (let p = 0; p < idx.length; p++) { const a = L.comp[p]; if (a >= 0 && target.has(a)) { idx[p] = target.get(a); changed = true; } }
            if (!changed) break;
        }
        return label(idx, w, h);
    }
    // ---------- análise (cacheada pelo conteúdo) ----------
    function analyze(src, W, H, p) {
        const pixels = p.mode === 'pixels';
        // regiões: detalhe 0–100 → grade de 70 a 420 px no lado maior; pixels: células no lado maior
        const G = pixels ? clampP(p.size, 'size') : Math.round(70 + clampP(p.detail, 'detail') * 3.5);
        const gw = W >= H ? G : Math.max(2, Math.round(G * W / H)), gh = H >= W ? G : Math.max(2, Math.round(G * H / W));
        if (gridC.width !== gw || gridC.height !== gh) { gridC.width = gw; gridC.height = gh; }
        gctx.clearRect(0, 0, gw, gh); gctx.imageSmoothingEnabled = true; gctx.imageSmoothingQuality = 'high';
        // redução em etapas de ½: média de verdade (sem serrilhado nem moiré)
        let s = src, sw = W, sh = H;
        while (sw / 2 > gw * 2 && sh / 2 > gh * 2) {
            const t = document.createElement('canvas'); t.width = Math.round(sw / 2); t.height = Math.round(sh / 2);
            const tc = t.getContext('2d'); tc.imageSmoothingQuality = 'high'; tc.drawImage(s, 0, 0, sw, sh, 0, 0, t.width, t.height); s = t; sw = t.width; sh = t.height;
        }
        gctx.drawImage(s, 0, 0, sw, sh, 0, 0, gw, gh);
        const d = gctx.getImageData(0, 0, gw, gh).data;
        const key = [p.mode, p.colors, p.minArea, p.smooth, gw, gh, quickHash(d)].join('|');
        if (cache.key === key) return cache.res;
        const q = quantize(d, gw * gh, clampP(p.colors, 'colors'));
        let idx = q.idx, L;
        if (pixels) { L = { comp: null, count: 0 }; }
        else {
            idx = majority(idx, gw, gh, clampP(p.smooth, 'smooth'));
            L = mergeSmall(idx, gw, gh, clampP(p.minArea, 'minArea'));
        }
        const res = { gw, gh, pal: q.pal, idx, L, pixels };
        cache = { key, res };
        return res;
    }

    // ---------- desenho ----------
    function apply(octx, srcCanvas, W, H, p) {
        if (!p || p.mode === 'none' || !W || !H) return;
        const A = analyze(srcCanvas, W, H, p);
        const { gw, gh, pal, idx, L, pixels } = A, n = gw * gh;
        const ink = hexToRgb(p.ink);
        const img = fctx.createImageData(gw, gh), o = img.data;
        for (let q = 0; q < n; q++) { const c = idx[q], i = q * 4; if (c === 255) continue; const col = pal[c]; o[i] = col.r; o[i + 1] = col.g; o[i + 2] = col.b; o[i + 3] = 255; }
        if (fillC.width !== gw || fillC.height !== gh) { fillC.width = gw; fillC.height = gh; }
        fctx.putImageData(img, 0, 0);
        octx.save();
        octx.globalCompositeOperation = 'source-over'; octx.globalAlpha = 1;
        octx.clearRect(0, 0, W, H); octx.imageSmoothingEnabled = false;
        octx.drawImage(fillC, 0, 0, gw, gh, 0, 0, W, H);
        const sx = W / gw, sy = H / gh;
        const lw = Math.max(0.75, Math.min(W, H) * 0.0012) * (pixels ? 0.8 : 1);
        const lineA = clampP(p.lines, 'lines') / 100;
        const rects = [];
        const R = (x, y, w, h) => { octx.rect(x, y, w, h); rects.push([x, y, w, h]); };
        if (lineA > 0) {
            octx.fillStyle = css(ink, lineA); octx.beginPath();
            if (pixels) {
                for (let x = 1; x < gw; x++) R(x * sx - lw / 2, 0, lw, H);
                for (let y = 1; y < gh; y++) R(0, y * sy - lw / 2, W, lw);
            } else {
                const comp = L.comp;
                for (let y = 0; y < gh; y++) {
                    for (let x = 1; x < gw; x++) { const pp = y * gw + x; if (comp[pp] !== comp[pp - 1]) R(x * sx - lw / 2, y * sy - lw / 2, lw, sy + lw); }
                    if (y > 0) {
                        let x0 = -1;
                        for (let x = 0; x <= gw; x++) {
                            const diff = x < gw && comp[y * gw + x] !== comp[(y - 1) * gw + x];
                            if (diff && x0 < 0) x0 = x;
                            if (!diff && x0 >= 0) { R(x0 * sx - lw / 2, y * sy - lw / 2, (x - x0) * sx + lw, lw); x0 = -1; }
                        }
                    }
                }
            }
            octx.fill();
        }
        octx.restore();
        last = { W, H, gw, gh, data: img.data.slice(0), rects, ink: css(ink, lineA) };
    }

    // vetor: manchas como retângulos por linha e as linhas como um caminho só
    function svg() {
        if (!last) return null;
        const { W, H, gw, gh, data, rects, ink } = last, sx = W / gw, sy = H / gh, f = (v) => Math.round(v * 100) / 100;
        const out = [`<?xml version="1.0" encoding="utf-8"?>\n<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">`];
        for (let y = 0; y < gh; y++) {
            let start = 0, cur = null;
            for (let x = 0; x <= gw; x++) {
                const i = (y * gw + x) * 4, hex = x < gw && data[i + 3] ? rgbToHex(data[i], data[i + 1], data[i + 2]) : null;
                if (x === 0) { cur = hex; continue; }
                if (hex !== cur || x === gw) { if (cur) out.push(`<rect x="${f(start * sx)}" y="${f(y * sy)}" width="${f((x - start) * sx + 0.5)}" height="${f(sy + 0.5)}" fill="${cur}"/>`); start = x; cur = hex; }
            }
        }
        if (rects.length) out.push(`<path fill="${ink}" d="${rects.map(r => `M${f(r[0])} ${f(r[1])}h${f(r[2])}v${f(r[3])}h${f(-r[2])}z`).join('')}"/>`);
        out.push('</svg>');
        return out.join('\n');
    }
    return { apply, svg };
})();
