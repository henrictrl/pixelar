/* Pixelar — Pintura por números (efeito final inspirado em apps de "pintar a foto").
 *
 * Dois modos sobre a imagem já processada:
 *  - Regiões: a foto vira manchas de cor chapada (quantização + filtro de maioria + fusão
 *    de manchas pequenas), com contornos finos e o número de cada cor no ponto mais
 *    "folgado" da região (transformada de distância).
 *  - Pixels: grade de células com a cor média quantizada, linhas da grade e números.
 * Acabamentos: Pintado, Pela metade, Clarinho e Para pintar (molde em branco).
 *
 * Roda depois de todo o resto (é o último passo do Engine.render), na resolução final:
 * linhas e números ficam nítidos em qualquer tamanho e proporcionais à imagem
 * (a prévia e o arquivo exportado saem iguais). O último resultado fica guardado
 * para o SVG vetorial (molde imprimível).
 */
'use strict';

const PAINT_LEVELS = {
    easy: { grid: 110, cells: 28, colors: 10, minArea: 18 },
    balanced: { grid: 190, cells: 44, colors: 18, minArea: 14 },
    detailed: { grid: 300, cells: 64, colors: 28, minArea: 10 },
};

const PaintFX = (() => {
    const gridC = document.createElement('canvas'), gctx = gridC.getContext('2d', { willReadFrequently: true });
    const fillC = document.createElement('canvas'), fctx = fillC.getContext('2d');
    let cache = { key: '', res: null };
    let last = null;                                   // último desenho (para o SVG)

    // ---------- utilitários ----------
    const hash01 = (a, b) => { let x = Math.imul(a ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul(b + 0x632BE5AB, 0xC2B2AE35); x ^= x >>> 15; x = Math.imul(x, 0x2C1B3C6D); x ^= x >>> 12; return (x >>> 0) / 4294967295; };
    function quickHash(d) { let h = 2166136261; for (let i = 0; i < d.length; i += 13) h = Math.imul(h ^ d[i], 16777619); return (h >>> 0).toString(36) + d.length; }
    const lum = (c) => 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
    const mixC = (a, b, k) => ({ r: a.r + (b.r - a.r) * k, g: a.g + (b.g - a.g) * k, b: a.b + (b.b - a.b) * k });
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
    // ponto mais longe da borda em cada região (onde cabe o número)
    function labelPoints(L, w, h) {
        const n = w * h, D = new Float32Array(n), comp = L.comp;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const p = y * w + x, c = comp[p];
            const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 || comp[p - 1] !== c || comp[p + 1] !== c || comp[p - w] !== c || comp[p + w] !== c;
            D[p] = edge ? 1 : 1e9;
        }
        const S = Math.SQRT2;
        for (let y = 1; y < h; y++) for (let x = 1; x < w - 1; x++) { const p = y * w + x; if (D[p] <= 1) continue; D[p] = Math.min(D[p], D[p - 1] + 1, D[p - w] + 1, D[p - w - 1] + S, D[p - w + 1] + S); }
        for (let y = h - 2; y >= 0; y--) for (let x = w - 2; x >= 1; x--) { const p = y * w + x; if (D[p] <= 1) continue; D[p] = Math.min(D[p], D[p + 1] + 1, D[p + w] + 1, D[p + w + 1] + S, D[p + w - 1] + S); }
        const best = new Float32Array(L.count), bx = new Int32Array(L.count), by = new Int32Array(L.count);
        for (let p = 0; p < n; p++) { const c = comp[p]; if (c >= 0 && D[p] > best[c]) { best[c] = D[p]; bx[c] = p % w; by[c] = (p / w) | 0; } }
        return { best, bx, by };
    }

    // ---------- análise (cacheada pelo conteúdo) ----------
    function analyze(src, W, H, p) {
        const lv = PAINT_LEVELS[p.level] || PAINT_LEVELS.balanced, pixels = p.mode === 'pixels';
        const G = pixels ? lv.cells : lv.grid;
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
        const key = [p.mode, p.level, p.smooth, gw, gh, quickHash(d)].join('|');
        if (cache.key === key) return cache.res;
        const q = quantize(d, gw * gh, lv.colors);
        let idx = q.idx, L, pts = null;
        if (pixels) { L = { comp: null, count: 0 }; }
        else {
            idx = majority(idx, gw, gh, Math.max(0, Math.min(4, Math.round(p.smooth))));
            L = mergeSmall(idx, gw, gh, lv.minArea);
            pts = labelPoints(L, gw, gh);
        }
        const res = { gw, gh, pal: q.pal, idx, L, pts, pixels };
        cache = { key, res };
        return res;
    }

    // ---------- desenho ----------
    function apply(octx, srcCanvas, W, H, p) {
        if (!p || p.mode === 'none' || !W || !H) return;
        const A = analyze(srcCanvas, W, H, p);
        const { gw, gh, pal, idx, L, pts, pixels } = A, n = gw * gh, N = pal.length;
        const paper = hexToRgb(p.paper), ink = hexToRgb(p.ink), fill = p.fill;
        const prog = Math.max(0, Math.min(100, +p.progress)) / 100, seed = p.seed | 0;
        // o que já está pintado: por cor (do escuro ao claro) ou por região/célula, aleatório
        const filledColor = (c) => c < Math.round(prog * N);
        const isFilled = (c, unit) => fill === 'full' ? true : fill !== 'partial' ? false : p.order === 'random' ? hash01(unit, seed) < prog : filledColor(c);
        // cor de cada pixel da grade
        const img = fctx.createImageData(gw, gh), o = img.data;
        const filled = new Uint8Array(n);
        for (let q = 0; q < n; q++) {
            const c = idx[q], i = q * 4; if (c === 255) continue;
            const unit = pixels ? q : L.comp[q];
            const f = isFilled(c, unit); filled[q] = f ? 1 : 0;
            const col = f ? pal[c] : fill === 'faded' ? mixC(pal[c], paper, 0.78) : paper;
            o[i] = col.r; o[i + 1] = col.g; o[i + 2] = col.b; o[i + 3] = 255;
        }
        if (fillC.width !== gw || fillC.height !== gh) { fillC.width = gw; fillC.height = gh; }
        fctx.putImageData(img, 0, 0);
        octx.save();
        octx.globalCompositeOperation = 'source-over'; octx.globalAlpha = 1;
        octx.clearRect(0, 0, W, H); octx.imageSmoothingEnabled = false;
        octx.drawImage(fillC, 0, 0, gw, gh, 0, 0, W, H);
        const sx = W / gw, sy = H / gh;
        const lw = Math.max(0.75, Math.min(W, H) * 0.0012) * (pixels ? 0.8 : 1);
        const lineA = Math.max(0, Math.min(100, +p.lines)) / 100;
        const rects = [];
        // linhas: bordas entre regiões (ou a grade inteira, no modo pixels)
        if (lineA > 0) {
            octx.fillStyle = css(ink, lineA); octx.beginPath();
            if (pixels) {
                for (let x = 1; x < gw; x++) { octx.rect(x * sx - lw / 2, 0, lw, H); rects.push([x * sx - lw / 2, 0, lw, H]); }
                for (let y = 1; y < gh; y++) { octx.rect(0, y * sy - lw / 2, W, lw); rects.push([0, y * sy - lw / 2, W, lw]); }
            } else {
                const comp = L.comp;
                for (let y = 0; y < gh; y++) {
                    // trechos verticais (fronteira entre x-1 e x) unidos em linhas contínuas na vertical
                    for (let x = 1; x < gw; x++) { const pp = y * gw + x; if (comp[pp] !== comp[pp - 1]) { octx.rect(x * sx - lw / 2, y * sy - lw / 2, lw, sy + lw); rects.push([x * sx - lw / 2, y * sy - lw / 2, lw, sy + lw]); } }
                    if (y > 0) {
                        let x0 = -1;
                        for (let x = 0; x <= gw; x++) {
                            const diff = x < gw && comp[y * gw + x] !== comp[(y - 1) * gw + x];
                            if (diff && x0 < 0) x0 = x;
                            if (!diff && x0 >= 0) { octx.rect(x0 * sx - lw / 2, y * sy - lw / 2, (x - x0) * sx + lw, lw); rects.push([x0 * sx - lw / 2, y * sy - lw / 2, (x - x0) * sx + lw, lw]); x0 = -1; }
                        }
                    }
                }
            }
            octx.fill();
        }
        // números nas partes ainda não pintadas
        const texts = [];
        if (p.numbers && fill !== 'full') {
            const minFs = Math.min(W, H) * 0.012, maxFs = Math.min(W, H) * 0.05;
            const font = (fs) => `${Math.round(fs * 10) / 10}px "Departure Mono", ui-monospace, monospace`;
            octx.textAlign = 'center'; octx.textBaseline = 'middle';
            const put = (txt, x, y, fs, col) => { octx.font = font(fs); octx.fillStyle = col; octx.fillText(txt, x, y); texts.push([txt, x, y, fs, col]); };
            const numCol = (c) => fill === 'faded' ? css(mixC(pal[c], { r: 0, g: 0, b: 0 }, 0.35)) : css(mixC(ink, { r: 0, g: 0, b: 0 }, 0.25));
            if (pixels) {
                const fs = Math.min(sx, sy) * 0.46;
                if (fs >= minFs * 0.7) for (let q = 0; q < n; q++) { const c = idx[q]; if (c === 255 || filled[q]) continue; put(String(c + 1), (q % gw + 0.5) * sx, ((q / gw | 0) + 0.5) * sy, fs, numCol(c)); }
            } else {
                for (let k = 0; k < L.count; k++) {
                    const q = pts.by[k] * gw + pts.bx[k]; if (filled[q]) continue;
                    const c = L.colors[k], fs = Math.min(maxFs, pts.best[k] * Math.min(sx, sy) * 1.15);
                    if (fs < minFs) continue;
                    put(String(c + 1), (pts.bx[k] + 0.5) * sx, (pts.by[k] + 0.5) * sy, fs, numCol(c));
                }
            }
        }
        octx.restore();
        last = { W, H, gw, gh, data: img.data.slice(0), rects, ink: css(ink, lineA), texts };
    }

    // molde vetorial: manchas como retângulos por linha, linhas e números como texto
    function svg() {
        if (!last) return null;
        const { W, H, gw, gh, data, rects, ink, texts } = last, sx = W / gw, sy = H / gh, f = (v) => Math.round(v * 100) / 100;
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
        texts.forEach(([t, x, y, fs, col]) => out.push(`<text x="${f(x)}" y="${f(y)}" font-size="${f(fs)}" font-family="monospace" text-anchor="middle" dominant-baseline="central" fill="${col}">${t}</text>`));
        out.push('</svg>');
        return out.join('\n');
    }
    return { apply, svg, levels: PAINT_LEVELS };
})();
