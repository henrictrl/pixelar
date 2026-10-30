/* Pixelar — motor de renderização guiado por estado.
 *
 * Tudo que a imagem precisa para ser desenhada vive num único objeto de estado
 * (ver DEFAULT_STATE). Nenhuma função daqui lê o DOM: a interface só altera o
 * estado e pede um novo quadro. Isso é o que permite mudar o layout inteiro sem
 * quebrar o processamento — e renderizar miniaturas de presets com estados
 * diferentes ao mesmo tempo.
 *
 * Pipeline (igual ao original): fonte → recorte/rotação → pixelização →
 * GPU (ajustes → dither → degradê → paleta → aberração → textura → filme → grão
 * → câmera/cor animadas) → contorno. Sem WebGL2, o mesmo resultado sai da CPU.
 */
'use strict';

// ============================================================
// ESTADO
// ============================================================
const ANIM_DEFAULTS = {
    amount: 100, cycles: 2, duration: 2, fps: 30, direction: 'forward', ease: 'linear',
    dither: true, dStyle: 'auto', dAngle: 0, dWave: 64, dAmt: 100,
    fx: true, fxStyle: 'auto', fxAmt: 100,
    grain: true, grainStyle: 'live', grainAmt: 100,
    film: true, filmStyle: 'live', filmAmt: 100,
    camStyle: 'none', camAmt: 100, camOffset: 0,
    colStyle: 'none', colAmt: 100, colOffset: 0, colSpeed: 1, colWave: 'sine', colTarget: 'all',
    colSweep: 'none', colSweepScale: 100, colColor: '#ff3399',
    videoSync: true,
};

const DEFAULT_STATE = {
    v: 2,
    adj: { exposure: 0, brightness: 0, contrast: 0, shadows: 0, temperature: 0, saturation: 0, shadowsInverted: false },
    grain: { amount: 0, size: 100, rough: 45, bias: 20, speckle: 0, mono: true },
    pixel: { size: 1, scale: 100, group: 0, groupRadius: 1, groupTol: 35 },   // group: agrupar pixels (0 = desligado)
    dither: { mode: 'none', scale: 1, intensity: 100, opacity: 100, midOnly: false },
    edge: { size: 0, color: '#1A1A1A', opacity: 100 },
    fx: { id: 'none', mix: 100 },
    fxParams: {},                       // { efeito: { uniform: valor } } — texturas e filmes clássicos
    color: { sel: 'all', mode: 'original', invert: false, base: [], ref: [], hue: 0, sat: 0, light: 0, duo: ['#0A1A2F', '#5A82A5', '#F2EFE9'] },
    grad: { on: false, colors: ['#FF00FF', '#00FFFF'], type: 'linear', angle: 90, steps: 0, pos: 50, smooth: 100, blend: 'source-atop', cx: 50, cy: 50, scale: 100, repeat: 1, mirror: false, noise: 0, opacity: 100 },
    film: {
        look: 'none', mix: 100, grainAmt: 100,
        vignette: 0, halation: 0, bloom: 0, soft: 0, distort: 0, chroma: 0, leak: 0, dust: 0, flash: 0,
        vigColor: '#000000', leakColor: '#ff7319', vencido: 0, lumiereHue: 280,
    },
    mix: 100,                           // intensidade do estilo (mistura com a foto original)
    // dupla exposição: segunda imagem (ou fonte gerada) misturada à foto
    dbl: { on: false, src: 'image', blend: 'screen', op: 85, pre: true, scale: 100, x: 0, y: 0, rot: 0, flip: false,
        mask: 'none', maskLo: 50, maskSoft: 20, maskInv: false, tone: 'color', tint: '#ff7a59', contrast: 0, bright: 0, sat: 0, seed: 1 },
    // camadas sobre a imagem (Paleta e Pixel vêm sempre antes): ordem, mesclagem e opacidade
    layers: { order: ['dbl', 'grad', 'fx', 'film', 'lens', 'grain', 'edge'], blend: {}, op: {} },
    crop: { aspect: 'original', rot: 0, flipH: false, flipV: false, zoom: 100, x: 0, y: 0 },
    anim: Object.assign({}, ANIM_DEFAULTS),
};

const deepClone = (o) => JSON.parse(JSON.stringify(o));
function freshState() { return deepClone(DEFAULT_STATE); }

// mescla um estado parcial/antigo sobre o padrão: só entram campos conhecidos (e do tipo certo);
// nomes que saíram do app viram o equivalente atual
const DITHER_ALIAS = { nintendo_ds: 'bayer8', floyd_approx: 'bayer8' };
const FX_ALIAS = { slice_shift: 'glitch_blocks' };
function normalizeState(p) {
    const out = freshState();
    if (!p || typeof p !== 'object') return out;
    for (const k of Object.keys(out)) {
        const v = p[k];
        if (v === undefined || v === null) continue;
        if (k === 'fxParams') { if (typeof v === 'object') out.fxParams = deepClone(v); }
        else if (k === 'layers') out.layers = normalizeLayers(v);
        else if (out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
            if (typeof v !== 'object') continue;
            for (const f of Object.keys(out[k])) if (v[f] !== undefined && v[f] !== null && typeof v[f] === typeof out[k][f]) out[k][f] = deepClone(v[f]);
        } else if (typeof v === typeof out[k]) out[k] = deepClone(v);
    }
    // versões antigas: temperatura do filme vai para Luz; deslocamento RGB vira aberração da lente
    const film = p.film || {}, adj = p.adj || {};
    if (+film.temp) out.adj.temperature = Math.max(-100, Math.min(100, Math.round(out.adj.temperature + film.temp * 0.8)));
    if (+adj.rgbShift > 0) out.film.chroma = Math.min(100, out.film.chroma + Math.round(adj.rgbShift * 6));
    // filme, padrão e textura que não existem mais
    const f = out.film; if (LOOK_ALIAS[f.look]) f.look = LOOK_ALIAS[f.look]; if (f.look !== 'none' && !FILM_LOOKS[f.look]) f.look = 'none';
    const d = out.dither; if (DITHER_ALIAS[d.mode]) d.mode = DITHER_ALIAS[d.mode]; if (!DITHER_MODES.includes(d.mode)) d.mode = 'none';
    const fx = out.fx; if (FX_ALIAS[fx.id]) { out.fxParams[FX_ALIAS[fx.id]] = {}; fx.id = FX_ALIAS[fx.id]; }
    if (fx.id !== 'none' && typeof PixelarFX !== 'undefined' && !PixelarFX.isTexture(fx.id)) fx.id = 'none';
    if (typeof PixelarFX !== 'undefined') Object.keys(out.fxParams).forEach(id => { if (!PixelarFX.getEffectDef(id)) delete out.fxParams[id]; });
    out.v = 2;
    return out;
}

// camadas: garante as seis, sem repetir, na ordem guardada
const LAYER_IDS = ['dbl', 'grad', 'fx', 'film', 'lens', 'grain', 'edge'];
function normalizeLayers(l) {
    const out = { order: [], blend: {}, op: {} };
    if (l && Array.isArray(l.order)) l.order.forEach(id => { if (LAYER_IDS.includes(id) && !out.order.includes(id)) out.order.push(id); });
    LAYER_IDS.forEach(id => { if (!out.order.includes(id)) out.order.push(id); });
    if (l && l.blend) Object.keys(l.blend).forEach(k => { if (LAYER_IDS.includes(k) && typeof l.blend[k] === 'string') out.blend[k] = l.blend[k]; });
    if (l && l.op) Object.keys(l.op).forEach(k => { if (LAYER_IDS.includes(k) && isFinite(l.op[k])) out.op[k] = Math.max(0, Math.min(100, +l.op[k])); });
    return out;
}

// ============================================================
// CORES
// ============================================================
function hexToRgb(hex) { const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || ''); return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 0, g: 0, b: 0 }; }
function rgbToHex(r, g, b) { return '#' + (1 << 24 | Math.max(0, Math.min(255, Math.round(r))) << 16 | Math.max(0, Math.min(255, Math.round(g))) << 8 | Math.max(0, Math.min(255, Math.round(b)))).toString(16).slice(1).toUpperCase(); }
const rgbHex = (c) => rgbToHex(c.r, c.g, c.b);
function rgbToHsl(r, g, b) { r /= 255; g /= 255; b /= 255; const max = Math.max(r, g, b), min = Math.min(r, g, b); let h, s; const l = (max + min) / 2; if (max === min) { h = s = 0; } else { const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min); switch (max) { case r: h = (g - b) / d + (g < b ? 6 : 0); break; case g: h = (b - r) / d + 2; break; default: h = (r - g) / d + 4; } h /= 6; } return { h, s, l }; }
function hslToRgb(h, s, l) { let r, g, b; if (s === 0) { r = g = b = l; } else { const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; }; const q = l < 0.5 ? l * (1 + s) : l + s - l * s; const p = 2 * l - q; r = f(p, q, h + 1 / 3); g = f(p, q, h); b = f(p, q, h - 1 / 3); } return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) }; }
const rgbArr = (hex) => { const c = hexToRgb(hex); return [c.r / 255, c.g / 255, c.b / 255]; };
const arrHex = (a) => rgbToHex(a[0] * 255, a[1] * 255, a[2] * 255);
const luma = (c) => 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;

function interpolatePalette(anchors, size) {
    if (size <= anchors.length) return anchors.slice(0, size);
    const out = [];
    for (let i = 0; i < size; i++) {
        const t = (i / (size - 1)) * (anchors.length - 1), a = Math.floor(t), b = Math.min(a + 1, anchors.length - 1), k = t - a;
        out.push({ r: Math.round(anchors[a].r + (anchors[b].r - anchors[a].r) * k), g: Math.round(anchors[a].g + (anchors[b].g - anchors[a].g) * k), b: Math.round(anchors[a].b + (anchors[b].b - anchors[a].b) * k) });
    }
    return out;
}


// paleta exibida = base com os deslocamentos globais de matiz/saturação/luz
function displayPalette(c) {
    const base = c.base.map(hexToRgb);
    if (!c.hue && !c.sat && !c.light) return base;
    const h = c.hue / 360, s = c.sat / 100, l = c.light / 100;
    return base.map(col => { const x = rgbToHsl(col.r, col.g, col.b); return hslToRgb((x.h + h + 1) % 1, Math.max(0, Math.min(1, x.s + s)), Math.max(0, Math.min(1, x.l + l))); });
}

function getMedianCut(pixels, count) {
    if (!pixels.length) return [{ r: 0, g: 0, b: 0, count: 0 }];
    const buckets = [pixels];
    while (buckets.length < count) {
        let maxR = -1, target = -1, axis = 'r';
        for (let i = 0; i < buckets.length; i++) {
            const b = buckets[i]; if (b.length < 2) continue;
            let rm = 255, rx = 0, gm = 255, gx = 0, bm = 255, bx = 0;
            for (const p of b) { if (p.r < rm) rm = p.r; if (p.r > rx) rx = p.r; if (p.g < gm) gm = p.g; if (p.g > gx) gx = p.g; if (p.b < bm) bm = p.b; if (p.b > bx) bx = p.b; }
            const rng = Math.max(rx - rm, gx - gm, bx - bm);
            if (rng > maxR) { maxR = rng; target = i; axis = rx - rm === rng ? 'r' : gx - gm === rng ? 'g' : 'b'; }
        }
        if (target === -1) break;
        const b = buckets[target]; b.sort((a, c) => a[axis] - c[axis]); const mid = Math.floor(b.length / 2);
        buckets.splice(target, 1, b.slice(0, mid), b.slice(mid));
    }
    return buckets.map(b => { if (!b.length) return { r: 0, g: 0, b: 0, count: 0 }; let r = 0, g = 0, bl = 0; for (const p of b) { r += p.r; g += p.g; bl += p.b; } return { r: Math.round(r / b.length), g: Math.round(g / b.length), b: Math.round(bl / b.length), count: b.length }; });
}
function balancedPalette(mapped, size) {
    mapped.sort((a, b) => b.count - a.count);
    if (size < 2 || mapped.length <= size) return mapped.slice(0, size).map(x => x.col);
    const pool = mapped.slice(0, Math.max(size * 2, 4)); if (pool.length < 2) return mapped.slice(0, size).map(x => x.col);
    pool.sort((a, b) => a.luma - b.luma);
    const darkest = pool[0], lightest = pool[pool.length - 1], out = [darkest, lightest];
    const rest = mapped.filter(x => x !== darkest && x !== lightest).sort((a, b) => b.count - a.count);
    for (let i = 0; i < size - 2; i++) if (rest[i]) out.push(rest[i]);
    return out.map(x => x.col);
}

// ============================================================
// FALLBACK CPU (mesmas fórmulas dos shaders)
// ============================================================
const TAU = Math.PI * 2;
const _f32 = new Float32Array(1), _u32 = new Uint32Array(_f32.buffer);
function pcgHash(x, y, s) {
    _f32[0] = s;
    let a = (Math.imul(x >>> 0, 1664525) + 1013904223) >>> 0, b = (Math.imul(y >>> 0, 1664525) + 1013904223) >>> 0, c = (Math.imul(_u32[0], 1664525) + 1013904223) >>> 0;
    a = (a + Math.imul(b, c)) >>> 0; b = (b + Math.imul(c, a)) >>> 0; c = (c + Math.imul(a, b)) >>> 0;
    a ^= a >>> 16; b ^= b >>> 16; c ^= c >>> 16;
    a = (a + Math.imul(b, c)) >>> 0;
    return a / 4294967295;
}
const f32 = Math.fround;
const B8 = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];
// padrões de pontilhado (a ordem não importa; o GPU usa DITHER_IDS em gpu.js)
const DITHER_MODES = ['none', 'bayer8', 'halftone', 'checkerboard', 'scanlines', 'noise'];
const HT_S = Math.sin(Math.PI / 4), HT_C = Math.cos(Math.PI / 4);
function ditherAtCPU(mode, x, y, sc, T, seed, anim) {
    const sx = Math.floor(x / sc), sy = Math.floor(y / sc);
    switch (mode) {
        case 'halftone': { const size = Math.max(2, sc * 3); const rx = x * HT_C - y * HT_S, ry = x * HT_S + y * HT_C; const cx = ((Math.abs(rx) + T * size) % size) - size / 2, cy = ((Math.abs(ry) + T * size) % size) - size / 2; return ((Math.sqrt(cx * cx + cy * cy) * (1 + 0.35 * Math.sin(TAU * T)) / (size / 1.5)) - 0.5) * 1.5; }
        case 'bayer8': return (((B8[(sy % 8) * 8 + sx % 8] + Math.floor(T * 64)) % 64) / 63 - 0.5) * 0.5;
        case 'checkerboard': { const par = (sx + sy) % 2 === 0 ? 1 : -1; return anim ? -0.3 * par * Math.cos(TAU * (T - (sx + sy) / 24)) : -0.3 * par; }
        case 'scanlines': return (Math.floor((y + T * 3 * sc) / sc) % 3 === 0) ? -0.4 : 0.1;
        case 'noise': return (pcgHash(x, y, seed) - 0.5) * 0.4;
    }
    return 0;
}
function applyFilmGrainCPU(d, w, h, g) {
    const sm = f32(f32(g.seed) * f32(91.7)); const s0 = f32(sm + 1), s1 = f32(sm + 37); const cc = g.cell * 6;
    for (let y = 0; y < h; y++) {
        const gy = Math.floor(y / g.cell), cgy = Math.floor(y / cc);
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4; if (d[i + 3] === 0) continue;
            const n = (pcgHash(Math.floor(x / g.cell), gy, s0) * (1 - g.rough) + pcgHash(x, y, s1) * g.rough - 0.5) * 2;
            let clump = 1; if (g.speckle > 0 && pcgHash(Math.floor(x / cc), cgy, f32(s0 + 5)) > 1 - g.speckle * 0.5) clump = 1 + g.speckle * 2.5;
            const l = (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 255;
            let lw = 1; if (g.bias > 0) lw = 1 - l * g.bias * 0.9; else if (g.bias < 0) lw = 1 + (l - 1) * g.bias * 0.9;
            if (g.mono) { const a = n * g.strength * clump * Math.max(0.15, lw); d[i] += a; d[i + 1] += a; d[i + 2] += a; }
            else { const k = g.strength * clump * lw; d[i] += (pcgHash(x, y, f32(s1 + 11)) * 2 - 1) * k; d[i + 1] += (pcgHash(x, y, f32(s1 + 23)) * 2 - 1) * k; d[i + 2] += (pcgHash(x, y, f32(s1 + 41)) * 2 - 1) * k; }
        }
    }
    return d;
}
const colorLUTCache = new Uint8Array(32768); let lastLUTHash = '';
function updateColorLUT(pal) {
    if (!pal || !pal.length) return;
    const hash = pal.map(c => c.r + ',' + c.g + ',' + c.b).join('|'); if (hash === lastLUTHash) return;
    for (let r = 0; r < 32; r++) for (let g = 0; g < 32; g++) for (let b = 0; b < 32; b++) {
        const rr = (r << 3) | (r >> 2), gg = (g << 3) | (g >> 2), bb = (b << 3) | (b >> 2); let min = Infinity, best = 0;
        for (let i = 0; i < pal.length; i++) { const p = pal[i]; const d = (rr - p.r) ** 2 + (gg - p.g) ** 2 + (bb - p.b) ** 2; if (d < min) { min = d; best = i; } }
        colorLUTCache[(r << 10) | (g << 5) | b] = best;
    }
    lastLUTHash = hash;
}
const _clamp3 = new Uint8ClampedArray(3);
function cpuAdjust(src, dst, a, step = 4, samples = null) {
    let minL = 255, maxL = 0; const t = _clamp3;
    for (let i = 0; i < src.length; i += step) {
        if (src[i + 3] < 127) { if (dst) dst[i] = dst[i + 1] = dst[i + 2] = dst[i + 3] = 0; continue; }
        let r = src[i] * a.exp + a.br, g = src[i + 1] * a.exp + a.br, b = src[i + 2] * a.exp + a.br;
        if (a.cont !== 0) { r = a.contFactor * (r - 128) + 128; g = a.contFactor * (g - 128) + 128; b = a.contFactor * (b - 128) + 128; }
        if (a.temp !== 0) { r += a.temp; b -= a.temp; }
        r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
        if (a.invert) { r = 255 - r; g = 255 - g; b = 255 - b; }
        const l = 0.3 * r + 0.59 * g + 0.11 * b;
        if (a.sat !== 0) { const k = 1 + a.sat; r = l + (r - l) * k; g = l + (g - l) * k; b = l + (b - l) * k; }
        if (a.sh !== 0 && l < 128) { const f = a.sh * (128 - l) / 128; r += f; g += f; b += f; }
        t[0] = r; t[1] = g; t[2] = b;
        if (dst) { dst[i] = t[0]; dst[i + 1] = t[1]; dst[i + 2] = t[2]; dst[i + 3] = 255; }
        if (samples) samples.push({ r: t[0], g: t[1], b: t[2] });
        const fl = 0.3 * t[0] + 0.59 * t[1] + 0.11 * t[2]; if (fl < minL) minL = fl; if (fl > maxL) maxL = fl;
    }
    return { minL, maxL };
}
function blendCPU(bl, r, g, b, gr, gg, gb) {
    if (bl === 'multiply') return [(r * gr) / 255, (g * gg) / 255, (b * gb) / 255];
    if (bl === 'screen') return [255 - ((255 - r) * (255 - gr)) / 255, 255 - ((255 - g) * (255 - gg)) / 255, 255 - ((255 - b) * (255 - gb)) / 255];
    if (bl === 'overlay') { const o = (x, y) => x < 128 ? (2 * x * y) / 255 : 255 - (2 * (255 - x) * (255 - y)) / 255; return [o(r, gr), o(g, gg), o(b, gb)]; }
    if (bl === 'color') { const ho = rgbToHsl(r, g, b), hg = rgbToHsl(gr, gg, gb); const c = hslToRgb(hg.h, hg.s, ho.l); return [c.r, c.g, c.b]; }
    if (bl === 'darken') return [Math.min(r, gr), Math.min(g, gg), Math.min(b, gb)];
    if (bl === 'lighten') return [Math.max(r, gr), Math.max(g, gg), Math.max(b, gb)];
    if (bl === 'difference') return [Math.abs(r - gr), Math.abs(g - gg), Math.abs(b - gb)];
    if (bl === 'softlight') { const sl = (x, y) => { const a2 = x / 255, b2 = y / 255; return 255 * (b2 < 0.5 ? 2 * a2 * b2 + a2 * a2 * (1 - 2 * b2) : Math.sqrt(a2) * (2 * b2 - 1) + 2 * a2 * (1 - b2)); }; return [sl(r, gr), sl(g, gg), sl(b, gb)]; }
    return [gr, gg, gb];
}
function renderCPU(src, w, h, s, color, grad, anim, grain, mm) {
    const d = new Uint8ClampedArray(src.length);
    cpuAdjust(src, d, s.adj);
    const range = (mm.maxL - mm.minL) || 1, mode = s.dither.mode, sc = s.dither.scale, str = s.dither.strength;
    const an = anim || { T: 0, amt: 0, frame: 0 }, seedA = f32(an.frame);
    if (color.mode === 1) updateColorLUT(color.refPalette);
    const duo = color.duo;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4; if (d[i + 3] === 0) continue;
        let r = d[i], g = d[i + 1], b = d[i + 2];
        const lu = 0.3 * r + 0.59 * g + 0.11 * b, norm = (lu - mm.minL) / range;
        if (s.shadowsInverted && norm < 0.45) { r = 255 - r; g = 255 - g; b = 255 - b; }
        let factor = 0;
        if (mode !== 'none') {
            factor = ditherAtCPU(mode, x, y, sc, 0, 0, false);
            if (an.amt > 0) { const k = Math.min(an.amt, 1), boost = 1 + Math.max(an.amt - 1, 0) * 0.5; factor = factor * (1 - k) + ditherAtCPU(mode, x, y, sc, an.T, seedA, true) * boost * k; }
            factor *= str;
        }
        if (s.midDither && (norm < 0.25 || norm > 0.75)) factor = 0;
        if (factor !== 0) { const k = factor * 120; r = Math.max(0, Math.min(255, r + k)); g = Math.max(0, Math.min(255, g + k)); b = Math.max(0, Math.min(255, b + k)); }
        if (grad) {
            const pr = r, pg = g, pb = b;
            const gi = ((Math.min(grad.h - 1, (y * grad.h / h) | 0)) * grad.w + Math.min(grad.w - 1, (x * grad.w / w) | 0)) * 4;
            [r, g, b] = blendCPU(grad.b, r, g, b, grad.d[gi], grad.d[gi + 1], grad.d[gi + 2]);
            const ga = grad.a !== undefined ? grad.a : 1;
            if (ga < 1) { r = pr + (r - pr) * ga; g = pg + (g - pg) * ga; b = pb + (b - pb) * ga; }
        }
        if (color.mode === 2) {
            const t = Math.max(0, Math.min(1, lu / 255)); let c0, c1, lt;
            if (duo.length >= 3) { if (t < 0.5) { c0 = duo[0]; c1 = duo[1]; lt = t / 0.5; } else { c0 = duo[1]; c1 = duo[2]; lt = (t - 0.5) / 0.5; } } else { c0 = duo[0]; c1 = duo[1]; lt = t; }
            r = c0.r + (c1.r - c0.r) * lt; g = c0.g + (c1.g - c0.g) * lt; b = c0.b + (c1.b - c0.b) * lt;
        } else if (color.mode === 1) {
            const c = color.palette[colorLUTCache[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)]]; if (c) { r = c.r; g = c.g; b = c.b; }
        }
        d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
    if (grain) applyFilmGrainCPU(d, w, h, grain);
    return d;
}

// ============================================================
// DEGRADÊ (motor próprio, cacheado por configuração)
// ============================================================
const GRAD_SHAPES = ['linear', 'mirror', 'radial', 'conic', 'diamond', 'box', 'wave', 'spiral'];
const GRAD_BLENDS = ['source-atop', 'multiply', 'screen', 'overlay', 'color', 'darken', 'lighten', 'difference', 'softlight'];
const GRAD_ANGLE_SHAPES = new Set(['linear', 'mirror', 'conic', 'wave', 'spiral']);
const GRAD_CENTER_SHAPES = new Set(['radial', 'conic', 'diamond', 'box', 'spiral']);
function buildGradLUT(colors, steps, pos, smooth) {
    const cols = colors.map(hexToRgb), n = cols.length, lut = new Uint8Array(256 * 3);
    const shift = (pos - 50) / 100, ease = smooth >= 100 ? 1 : 1 + (100 - smooth) / 50;
    for (let i = 0; i < 256; i++) {
        let p = i / 255; if (steps > 0) p = Math.round(p * steps) / steps;
        p = Math.max(0, Math.min(1, p - shift));
        const raw = p * (n - 1), idx = Math.min(n - 2, Math.max(0, Math.floor(raw))); let lp = Math.max(0, Math.min(1, raw - idx)); if (ease !== 1) lp = Math.pow(lp, ease);
        const a = cols[idx], b = cols[Math.min(idx + 1, n - 1)];
        lut[i * 3] = a.r + (b.r - a.r) * lp; lut[i * 3 + 1] = a.g + (b.g - a.g) * lp; lut[i * 3 + 2] = a.b + (b.b - a.b) * lp;
    }
    return lut;
}
const gradHash2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const gradCache = new Map();
function getGradientData(g, w, h) {
    const key = `${w}x${h}|${g.type}|${g.angle}|${g.steps}|${g.pos}|${g.smooth}|${g.cx}|${g.cy}|${g.scale}|${g.repeat}|${g.mirror}|${g.noise}|${g.colors.join('-')}`;
    let d = gradCache.get(key);
    if (!d) {
        const lut = buildGradLUT(g.colors, g.steps, g.pos, g.smooth);
        d = new Uint8ClampedArray(w * h * 4);
        const M = Math.max(w, h), a0 = (g.angle - 90) * Math.PI / 180, ca = Math.cos(a0), sa = Math.sin(a0);
        const scale = Math.max(0.05, g.scale / 100), span = 1.3333 * scale, half = 0.6667 * scale;
        const rep = Math.max(1, Math.round(g.repeat)), mirror = !!g.mirror, noise = g.noise / 100, shape = g.type;
        const px = g.cx / 100 * w, py = g.cy / 100 * h;
        for (let y = 0; y < h; y++) {
            const Y = (y - py) / M;
            for (let x = 0; x < w; x++) {
                const X = (x - px) / M, proj = X * ca + Y * sa; let t;
                if (shape === 'radial') t = Math.sqrt(X * X + Y * Y) / half;
                else if (shape === 'mirror') t = Math.abs(proj) / half;
                else if (shape === 'diamond') t = (Math.abs(X) + Math.abs(Y)) / half;
                else if (shape === 'box') t = Math.max(Math.abs(X), Math.abs(Y)) / half;
                else if (shape === 'conic') t = ((Math.atan2(Y, X) - a0) / TAU % 1 + 1) % 1;
                else if (shape === 'spiral') t = ((Math.atan2(Y, X) - a0) / TAU + Math.sqrt(X * X + Y * Y) / half % 1 + 1) % 1;
                else if (shape === 'wave') t = 0.5 + (proj + 0.09 * Math.sin(TAU * 3 * (-X * sa + Y * ca) / Math.max(0.15, scale))) / span;
                else t = 0.5 + proj / span;
                t *= rep;
                if (rep > 1 || mirror || shape === 'conic' || shape === 'spiral') { if (mirror) { t = Math.abs(t) % 2; if (t > 1) t = 2 - t; } else { t = t % 1; if (t < 0) t += 1; } }
                let idx = t * 255; if (noise > 0) idx += (gradHash2(x, y) - 0.5) * noise * 40;
                idx = Math.max(0, Math.min(255, Math.round(idx))) * 3;
                const i = (y * w + x) * 4; d[i] = lut[idx]; d[i + 1] = lut[idx + 1]; d[i + 2] = lut[idx + 2]; d[i + 3] = 255;
            }
        }
        if (gradCache.size > 2) gradCache.delete(gradCache.keys().next().value);   // cada degradê ocupa w×h×4 bytes: guarda só os últimos
        gradCache.set(key, d);
    }
    return { d, b: g.blend, key, a: g.opacity / 100 };
}

// ============================================================
// FILME & CÂMERA + LENTE
// ============================================================
const FILM_NEUTRAL = {
    uLookOn: 1, uMix: 1, uExposure: 0, uContrast: 1, uFade: 0, uRoll: 0, uSat: 1, uTemp: 0, uTint: 0, uHue: 0,
    uSplit: 0, uCross: 0, uBleach: 0, uBW: 0, uTone: 0, uSwap: 0, uSwapAmt: 0,
    uShadowTint: [0.5, 0.5, 0.5], uHighTint: [0.5, 0.5, 0.5], uBase: [0, 0, 0], uBWMix: [0.3, 0.59, 0.11], uToneColor: [0.5, 0.5, 0.5],
    uHalation: 0, uHalColor: [1, 0.35, 0.1], uBloom: 0, uSoft: 0, uBlur: 0, uSharpen: 0, uVignette: 0, uVigColor: [0, 0, 0],
    uDistort: 0, uChroma: 0, uFlash: 0, uLeak: 0, uLeakPos: 0.1, uLeakColor: [1, 0.45, 0.1],
    uDust: 0, uScratch: 0, uBurn: 0, uGrain: 0, uGrainSize: 1.5, uJpeg: 0, uChromaNoise: 0, uInterlace: 0, uAutochrome: 0,
    uWeave: 0, uFlicker: 0, uLeakDrift: 0, uBurnAnim: 0, uAnim: 0, uAnimFrame: 0,
};
const FILM_SCALE_KEYS = ['uHalation', 'uBloom', 'uSoft', 'uBlur', 'uSharpen', 'uVignette', 'uDistort', 'uChroma', 'uFlash', 'uLeak', 'uDust', 'uScratch', 'uBurn', 'uGrain', 'uJpeg', 'uChromaNoise', 'uInterlace', 'uAutochrome'];
// Emulações sutis de filmes e câmeras reais, em 4 grupos de 5.
// [grupo, [id, nome, descrição, uniforms do FILM_FS, extras]] — extras.fx: filme feito por shader próprio (gpu.js)
const FILM_LOOK_DEFS = [
    ['Cor natural', [
        ['ektachrome', 'Ektachrome E100', 'Slide neutro e limpo: cores fiéis, levemente frio, grão quase invisível.', { uSat: 1.12, uContrast: 1.14, uTemp: -0.06, uSplit: 0.15, uShadowTint: [0.46, 0.49, 0.55], uGrain: 0.04, uSharpen: 0.15 }],
        ['gold200', 'Gold 200', 'O filme das férias: dourado, quente e alegre.', { uTemp: 0.3, uSat: 1.1, uContrast: 1.05, uSplit: 0.3, uShadowTint: [0.46, 0.47, 0.5], uHighTint: [0.6, 0.55, 0.42], uFade: 0.04, uBase: [0.04, 0.03, 0.02], uGrain: 0.2 }],
        ['portra', 'Portra 400', 'Negativo de retrato: pele suave, luzes macias e baixo contraste.', { uContrast: 0.9, uRoll: 0.4, uSat: 0.9, uTemp: 0.15, uTint: 0.05, uFade: 0.06, uBase: [0.05, 0.04, 0.04], uSplit: 0.25, uShadowTint: [0.47, 0.5, 0.53], uHighTint: [0.55, 0.51, 0.47], uGrain: 0.15, uGrainSize: 1.2, uHalation: 0.05 }],
        ['ae1', 'Canon AE-1', 'Reflex dos anos 70: suave, levemente quente e desbotado.', { uContrast: 1.02, uSat: 1.02, uTemp: 0.12, uSoft: 0.12, uVignette: 0.2, uFade: 0.04, uBase: [0.04, 0.035, 0.03], uGrain: 0.2 }],
        ['descartavel', 'Descartável', 'Câmera descartável: flash no centro e lente simples.', { uFlash: 0.45, uTemp: 0.12, uSat: 1.08, uContrast: 1.1, uVignette: 0.4, uSoft: 0.2, uChroma: 0.4, uGrain: 0.3 }],
    ]],
    ['Cinema e P&B', [
        ['trix', 'Tri-X 400', 'O P&B do fotojornalismo: contraste marcante e grão vigoroso.', { uBW: 1, uBWMix: [0.3, 0.6, 0.1], uContrast: 1.3, uRoll: 0.1, uGrain: 0.4, uGrainSize: 1.3 }],
        ['noir', 'Film noir', 'P&B de estúdio: pretos fundos e luz dura.', { uBW: 1, uContrast: 1.5, uExposure: -0.15, uVignette: 0.5, uBloom: 0.15, uGrain: 0.25 }],
        ['kodak_pb', 'Kodak P&B', 'Preto e branco contrastado com microgrão.', {}, { fx: 'kodak_pb' }],
        ['cinestill', 'CineStill 800T', 'Tungstênio: frio, com brilho vermelho ao redor das luzes.', { uTemp: -0.4, uTint: 0.05, uHalation: 0.8, uHalColor: [1, 0.18, 0.08], uContrast: 1.05, uSat: 1.05, uRoll: 0.3, uGrain: 0.3, uGrainSize: 1.3, uSplit: 0.3, uShadowTint: [0.44, 0.5, 0.56], uHighTint: [0.56, 0.5, 0.46] }],
        ['techni3', 'Technicolor', 'Cores cheias e vermelhos profundos dos musicais clássicos.', { uSwap: 3, uSwapAmt: 0.8, uSat: 1.25, uContrast: 1.15, uRoll: 0.3, uSplit: 0.25, uShadowTint: [0.45, 0.5, 0.55], uHighTint: [0.58, 0.52, 0.42], uGrain: 0.12 }],
    ]],
    ['Cores loucas', [
        ['cross', 'Processo cruzado', 'Slide revelado como negativo: amarelos e verdes ácidos.', { uCross: 0.8, uSat: 1.2, uContrast: 1.15, uSplit: 0.25, uShadowTint: [0.45, 0.55, 0.5], uHighTint: [0.6, 0.58, 0.4] }],
        ['lomopurple', 'LomoChrome Purple', 'Troca de cores: verdes viram roxo e azuis viram verde.', { uSwap: 2, uSwapAmt: 1, uSat: 1.15, uContrast: 1.1, uGrain: 0.25 }],
        ['aerochrome', 'Aerochrome', 'Infravermelho colorido: vegetação vira vermelho e rosa.', { uSwap: 1, uSwapAmt: 1, uSat: 1.2, uContrast: 1.15, uGrain: 0.15 }],
        ['lomo', 'Lomo LC-A', 'Cores fortes e bordas escuras da lomografia.', { uVignette: 0.9, uSat: 1.3, uContrast: 1.25, uCross: 0.15, uGrain: 0.25 }],
        ['holga', 'Holga 120', 'Câmera de plástico: foco macio nas bordas e vinheta.', { uVignette: 0.8, uSoft: 0.4, uBlur: 0.5, uSat: 1.1, uContrast: 1.08, uGrain: 0.2 }],
    ]],
    ['Vintage e vídeo', [
        ['super8', 'Super 8', 'Filme caseiro dos anos 70: quente, suave e granulado.', { uTemp: 0.22, uSat: 1.12, uContrast: 1.08, uFade: 0.07, uBase: [0.05, 0.03, 0.02], uGrain: 0.35, uGrainSize: 1.5, uSoft: 0.3, uVignette: 0.35, uHalation: 0.15 }],
        ['ccd', 'Digital CCD', 'Compacta digital dos anos 2000: nítida, fria e com flash.', { uSharpen: 0.5, uSat: 1.15, uContrast: 1.12, uTemp: -0.1, uBloom: 0.2, uFlash: 0.3, uJpeg: 0.2, uChromaNoise: 0.25, uExposure: 0.08 }],
        ['kodak_verde', 'Kodak desbotado', 'Filme antigo desbotado com dominante esverdeada.', {}, { fx: 'kodak_verde' }],
        ['lumiere', 'Lumiere', 'Tingimento monocromático (matiz ajustável).', {}, { fx: 'lumiere' }],
        ['vencido', 'Filme vencido', 'Filme fora da validade (4 variações).', {}, { fx: 'vencido' }],
    ]],
];
const FILM_LOOKS = {};
FILM_LOOK_DEFS.forEach(([group, list]) => list.forEach(([id, nome, desc, u, x]) => { FILM_LOOKS[id] = Object.assign({ id, nome, desc, group, u }, x || {}); }));
// filmes que saíram (out/2026) → o visível mais parecido (medido): arquivos antigos continuam abrindo
const LOOK_ALIAS = { kodachrome64: 'ektachrome', kodachrome25: 'ektachrome', portra160: 'portra', portra800: 'portra', ultramax: 'gold200', colorplus: 'gold200', ektar: 'ektachrome', tmax: 'trix', velvia: 'ektachrome', provia: 'ektachrome', astia: 'portra', pro400h: 'portra', superia: 'ektachrome', c200: 'gold200', natura: 'kodak_verde', acros: 'trix', hp5: 'trix', delta3200: 'trix', xp2: 'trix', agfavista: 'ektachrome', agfaapx: 'trix', lomo800: 'super8', vision250d: 'portra', vision500t: 'portra', cinestill50: 'gold200', bleach: 'trix', contaxt2: 'ae1', mju2: 'super8', leica: 'ae1', hasselblad: 'kodak_verde', compacta: 'super8', polaroid: 'kodak_verde', instax: 'gold200', vhscam: 'kodak_verde', hi8: 'kodak_verde' };
const LENS_KEYS = ['vignette', 'halation', 'bloom', 'soft', 'distort', 'chroma', 'leak', 'dust', 'flash'];

function fxParamsFor(st, effectId) {
    const p = Object.assign({}, (st.fxParams && st.fxParams[effectId]) || {});
    if (effectId === 'vencido') p.uVariant = st.film.vencido || 0;
    if (effectId === 'lumiere') p.uHue = ((st.film.lumiereHue || 0) % 360) / 360;
    return p;
}

function readFilm(st, part = 'all') {
    const f = st.film, look = part === 'lens' ? null : (FILM_LOOKS[f.look] || null);
    const mix = f.mix / 100, grainK = f.grainAmt / 100;
    const lens = {}; let lensOn = false;
    if (part !== 'look') LENS_KEYS.forEach(k => { lens[k] = (+f[k] || 0) / 100; if (lens[k]) lensOn = true; });
    else LENS_KEYS.forEach(k => { lens[k] = 0; });
    if (!look && !lensOn) return null;
    const chem = look && !look.fx;
    const u = Object.assign({}, FILM_NEUTRAL, chem ? look.u : {});
    u.uLookOn = chem ? 1 : 0;
    u.uMix = chem ? mix : 1;
    if (chem) FILM_SCALE_KEYS.forEach(k => { u[k] *= mix; });
    ['uGrain', 'uDust', 'uScratch', 'uChromaNoise'].forEach(k => { u[k] *= grainK; });
    u.uVignette += lens.vignette * 1.5; u.uHalation += lens.halation; u.uBloom += lens.bloom;
    u.uSoft += lens.soft * 2.5; u.uDistort += lens.distort * 0.8; u.uChroma += lens.chroma * 1.5;
    u.uLeak += lens.leak; u.uDust += lens.dust; u.uFlash += lens.flash;
    u.uVigColor = rgbArr(f.vigColor); u.uLeakColor = rgbArr(f.leakColor);
    const active = u.uLookOn || FILM_SCALE_KEYS.some(k => u[k] !== 0);
    return {
        id: look ? look.id : 'none', legacy: !!(look && look.fx),
        fx: look && look.fx ? { id: look.fx, mix, params: fxParamsFor(st, look.fx) } : null,
        u: active ? u : null,
    };
}

// ============================================================
// LEITURA DO ESTADO → PARÂMETROS DE RENDER
// ============================================================
function readSettings(st) {
    const a = st.adj, cont = +a.contrast, g = st.grain;
    return {
        px: Math.max(1, Math.round(st.pixel.size)),
        imageScale: st.pixel.scale / 100,
        colorSel: st.color.sel,
        adj: {
            exp: Math.pow(2, a.exposure / 50), br: +a.brightness, sh: +a.shadows, sat: a.saturation / 100,
            cont, contFactor: (259 * (cont + 255)) / (255 * (259 - cont)), temp: +a.temperature,
            invert: !!st.color.invert,
        },
        dither: { mode: st.dither.mode, scale: Math.max(1, Math.round(st.dither.scale)), strength: (st.dither.intensity / 100) * (st.dither.opacity / 100) },
        shadowsInverted: !!a.shadowsInverted, midDither: !!st.dither.midOnly,
        fx: st.fx.id !== 'none' ? { id: st.fx.id, mix: st.fx.mix / 100, params: fxParamsFor(st, st.fx.id) } : null,
        grain: g.amount ? { strength: (g.amount / 100) * 60, cell: Math.max(1, g.size / 100), rough: g.rough / 100, bias: g.bias / 100, speckle: g.speckle / 100, mono: !!g.mono } : null,
        edge: { size: +st.edge.size, color: st.edge.color, opacity: st.edge.opacity / 100 },
        grad: !!st.grad.on,
        film: readFilm(st),
        filmLook: readFilm(st, 'look'), filmLens: readFilm(st, 'lens'),
        mix: st.mix === undefined ? 1 : Math.max(0, Math.min(100, +st.mix)) / 100,
        cluster: st.pixel.group > 0 ? { passes: Math.min(4, Math.ceil(st.pixel.group / 25)), radius: st.pixel.groupRadius >= 2 ? 2 : 1, tol: 0.04 + (st.pixel.groupTol / 100) * 0.55 } : null,
        dbl: readDbl(st),
        layers: st.layers ? normalizeLayers(st.layers) : normalizeLayers(null),
    };
}

// dupla exposição: a imagem escolhida fica guardada no motor (não cabe no estado)
const DBL_SRC = { image: 0, self: 1, clouds: 2, stars: 3, light: 4, leaves: 5 };
const DBL_MASK = { none: 0, 'base-light': 1, 'base-dark': 2, 'img-light': 3, center: 4, bottom: 5, side: 6 };
const DBL_TONE = { color: 0, mono: 1, tint: 2, invert: 3 };
const DblImage = { img: null, key: 0, aspect: 1, name: '' };
function readDbl(st) {
    const d = st.dbl; if (!d || !d.on) return null;
    if (d.src === 'image' && !DblImage.img) return null;          // sem imagem escolhida ainda
    return {
        src: DBL_SRC[d.src] || 0, img: d.src === 'image' ? DblImage.img : null, key: DblImage.key, aspect: DblImage.aspect,
        blend: d.blend, op: d.op / 100, pre: !!d.pre, scale: d.scale / 100, x: d.x / 100, y: d.y / 100, rot: d.rot * Math.PI / 180, flip: !!d.flip,
        mask: DBL_MASK[d.mask] || 0, maskLo: d.maskLo / 100, maskSoft: d.maskSoft / 100 * 0.5, maskInv: !!d.maskInv,
        tone: DBL_TONE[d.tone] || 0, tint: rgbArr(d.tint), contrast: d.contrast / 100, bright: d.bright / 200, sat: d.sat / 100, seed: d.seed || 1,
    };
}

// a animação do filme vale para as duas partes (filme e lente)
function animFilm(film, af) {
    if (!film || !af) return film;
    const out = Object.assign({}, film);
    if (out.u) out.u = Object.assign({}, out.u, { uAnim: af.T, uAnimFrame: af.frame, uWeave: af.weave, uFlicker: af.flicker, uLeakDrift: af.leak, uBurnAnim: af.burn });
    if (out.fx) out.fx = Object.assign({}, out.fx, { params: af.fxParams || out.fx.params, animT: af.fxT, animFrame: af.frame });
    return out;
}
// monta a cadeia de camadas na ordem escolhida (só as que estão ligadas)
const COMP_OPS = { multiply: 'multiply', screen: 'screen', overlay: 'overlay', softlight: 'soft-light', color: 'color', darken: 'darken', lighten: 'lighten', difference: 'difference' };
function buildChain(st, s, fx, grain, an) {
    const L = s.layers, chain = [], af = an && an.film;
    const op = (id) => (L.op[id] === undefined ? 100 : L.op[id]) / 100;
    const look = animFilm(s.filmLook, af), lensF = animFilm(s.filmLens, af);
    L.order.forEach(id => {
        const blend = L.blend[id] || 'normal';
        if (id === 'dbl' && s.dbl && !s.dbl.pre) chain.push({ id, kind: 'dbl', blend: 'normal', op: 1 });
        else if (id === 'grad' && st.grad.on) chain.push({ id, kind: 'grad', blend: st.grad.blend, op: st.grad.opacity / 100 });
        else if (id === 'fx' && fx) chain.push({ id, kind: 'fx', fx, blend, op: 1 });
        else if (id === 'film' && look && (look.u || look.fx)) chain.push({ id, kind: 'film', film: look, blend, op: 1 });
        else if (id === 'lens' && lensF && lensF.u) chain.push({ id, kind: 'film', film: lensF, blend, op: op('lens') });
        else if (id === 'grain' && grain) chain.push({ id, kind: 'grain', grain, blend, op: op('grain') });
        else if (id === 'edge' && s.edge.size > 0) chain.push({ id, kind: 'edge', blend, op: s.edge.opacity });
    });
    // filme seguido da lente, sem mesclagem: uma passada só (igual ao que sempre foi)
    for (let i = 0; i < chain.length - 1; i++) {
        const a = chain[i], b = chain[i + 1];
        if (a.id === 'film' && b.id === 'lens' && a.blend === 'normal' && b.blend === 'normal' && b.op >= 1) {
            chain.splice(i, 2, { id: 'film', kind: 'film', film: animFilm(s.film, af), blend: 'normal', op: 1 });
            break;
        }
    }
    // o contorno, quando é a última camada, é desenhado na resolução final (linhas finas e nítidas)
    let edgeLast = null;
    if (chain.length && chain[chain.length - 1].kind === 'edge') edgeLast = chain.pop();
    return { chain, edgeLast };
}

const palHash = (p) => p.map(c => c.r + ',' + c.g + ',' + c.b).join('|');
function resolveColor(st) {
    const c = st.color;
    if (c.sel === 'duotone' || c.sel === 'tritone') {
        const duo = (c.sel === 'tritone' ? c.duo.slice(0, 3) : c.duo.slice(0, 2)).map(hexToRgb);
        return { mode: 2, duo };
    }
    if (c.sel === 'all' || !c.ref.length) return { mode: 0 };
    const palette = c.base.length ? displayPalette(c) : c.ref.map(hexToRgb);
    const ref = c.ref.map(hexToRgb);
    return { mode: 1, palette, refPalette: ref, paletteHash: palHash(palette), refHash: palHash(ref) };
}

// ============================================================
// GEOMETRIA: recorte, rotação e espelhamento
// ============================================================
const CROP_ASPECTS = { original: null, free: null, '1:1': 1, '4:5': 4 / 5, '5:4': 5 / 4, '3:4': 3 / 4, '4:3': 4 / 3, '2:3': 2 / 3, '3:2': 3 / 2, '9:16': 9 / 16, '16:9': 16 / 9, '21:9': 21 / 9 };
function mediaSize(m) { return m.videoWidth !== undefined ? { W: m.videoWidth, H: m.videoHeight } : { W: m.naturalWidth || m.width, H: m.naturalHeight || m.height }; }
// devolve o retângulo recortado (em espaço já rotacionado) e a matriz mídia→destino
function cropGeometry(m, crop) {
    const { W, H } = mediaSize(m);
    const rot = ((crop.rot % 360) + 360) % 360;
    const RW = rot % 180 ? H : W, RH = rot % 180 ? W : H;
    let cw = RW, ch = RH;
    const ar = CROP_ASPECTS[crop.aspect];
    if (ar) { if (RW / RH > ar) cw = RH * ar; else ch = RW / ar; }
    const z = Math.max(1, (crop.zoom || 100) / 100); cw /= z; ch /= z;
    cw = Math.max(1, Math.round(cw)); ch = Math.max(1, Math.round(ch));
    const x0 = (RW - cw) / 2 * (1 + Math.max(-1, Math.min(1, crop.x || 0)));
    const y0 = (RH - ch) / 2 * (1 + Math.max(-1, Math.min(1, crop.y || 0)));
    // m → r (rotacionado): r = R·m + t
    let a = 1, b = 0, c = 0, d = 1, e = 0, f = 0;             // [a c e; b d f]
    if (rot === 90) { a = 0; b = 1; c = -1; d = 0; e = H; f = 0; }
    else if (rot === 180) { a = -1; b = 0; c = 0; d = -1; e = W; f = H; }
    else if (rot === 270) { a = 0; b = -1; c = 1; d = 0; e = 0; f = W; }
    if (crop.flipH) { a = -a; c = -c; e = RW - e; }
    if (crop.flipV) { b = -b; d = -d; f = RH - f; }
    return { W, H, cw, ch, x0, y0, M: [a, b, c, d, e, f], identity: rot === 0 && !crop.flipH && !crop.flipV && cw === W && ch === H };
}
function isCropIdentity(crop) { return (!crop || ((crop.aspect === 'original' || crop.aspect === 'free') && !crop.rot && !crop.flipH && !crop.flipV && (crop.zoom || 100) <= 100)); }
// desenha a mídia recortada no contexto (dw × dh), encolhida por 'inner' ao redor do centro
function drawCropped(ctx, m, geo, dw, dh, inner = 1) {
    const k = dw / geo.cw, ky = dh / geo.ch;
    const [a, b, c, d, e, f] = geo.M;
    // destino = inner·(k·(r − r0)) + (1−inner)·centro
    const sx = k * inner, sy = ky * inner;
    const ox = (1 - inner) * dw / 2 - sx * geo.x0, oy = (1 - inner) * dh / 2 - sy * geo.y0;
    ctx.save();
    ctx.setTransform(sx * a, sy * b, sx * c, sy * d, sx * e + ox, sy * f + oy);
    ctx.drawImage(m, 0, 0, geo.W, geo.H);
    ctx.restore();
}

// ============================================================
// RENDER
// ============================================================
function drawEdges(octx, d, w, h, pSize, e) {
    octx.fillStyle = e.color; octx.globalAlpha = e.opacity;
    const half = e.size / 2; octx.beginPath();
    for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
        const i = (y * w + x) * 4, j = i + 4, k = i + w * 4;
        if (Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]) > 40) octx.rect((x + 1) * pSize - half, y * pSize, e.size, pSize);
        if (Math.abs(d[i] - d[k]) + Math.abs(d[i + 1] - d[k + 1]) + Math.abs(d[i + 2] - d[k + 2]) > 40) octx.rect(x * pSize, (y + 1) * pSize - half, pSize, e.size);
    }
    octx.fill(); octx.globalAlpha = 1;
}

const Engine = (() => {
    // celular: 2048 px; computador: 3072 px (o suficiente para exportar até 4K sem perder o estilo)
    let workCap = (matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 700) ? 2048 : 3072;
    const small = document.createElement('canvas'), sCtx = small.getContext('2d', { willReadFrequently: true });
    const cpuCanvas = document.createElement('canvas'), cCtx = cpuCanvas.getContext('2d');
    let smallKey = null, smallData = null;

    function getSmallData(w, h) { if (!smallData) smallData = sCtx.getImageData(0, 0, w, h).data; return smallData; }

    // paleta automática (modo "original" com N cores): calculada uma vez e guardada no estado
    function ensureAutoPalette(st, s, w, h) {
        const c = st.color;
        if (c.mode !== 'original' || ['all', 'duotone', 'tritone'].includes(c.sel)) return;
        const target = parseInt(c.sel, 10);
        if (c.ref.length === target && c.base.length === target) return;
        const step = 4 * Math.max(1, Math.floor((w * h) / 4000)), pxs = [];
        cpuAdjust(getSmallData(w, h), null, s.adj, step, pxs);
        const baseCount = Math.max(target, 16), basePal = getMedianCut(pxs, baseCount);
        let pal;
        if (target < baseCount) pal = balancedPalette(basePal.map(x => ({ col: { r: x.r, g: x.g, b: x.b }, count: x.count, luma: luma(x) })), target);
        else pal = basePal.map(x => ({ r: x.r, g: x.g, b: x.b }));
        c.ref = pal.map(rgbHex); c.base = c.ref.slice(); c.hue = c.sat = c.light = 0;
    }

    /* o = {
     *   media (img/video/canvas), key (string estável p/ cache; null = sempre redesenha),
     *   out: {canvas, ctx}, targetRes (altura final), maxDim (limite da tela),
     *   anim, grainSeed, grainScale, grainCell, compare: {canvas, ctx}
     * } */
    function render(st, o) {
        const media = o.media; if (!media) return null;
        const geo = cropGeometry(media, st.crop);
        if (!geo.W || !geo.H) return null;
        const s = readSettings(st), px = s.px;
        let w = Math.max(1, Math.floor(geo.cw / px)), h = Math.max(1, Math.floor(geo.ch / px));
        // resolução de trabalho: fotos enormes (12–48 MP do celular) são processadas numa
        // cópia de até `cap` px — a mesma na prévia e na exportação, então o que se vê é o que sai
        let cap = o.maxWork !== undefined ? o.maxWork : workCap;
        // exportação: sem pixel grande, a imagem é processada já no tamanho final (efeitos nítidos,
        // nada ampliado depois); com pixel grande, a arte é ampliada sem suavizar (pixels perfeitos)
        // unit: px desta renderização por px da prévia. Tudo que é medido em pixels (grão, padrões, ruídos,
        // contorno, agrupar) cresce na mesma proporção: o arquivo sai igual ao que se vê na tela.
        let unit = 1;
        if (o.workRes && px === 1 && PixelarGPU.isAvailable()) {
            const lim = Math.min(PixelarGPU.maxTex || 4096, 8192), long = Math.max(w, h);
            const target = Math.min(lim, Math.round(o.workRes * long / h));
            const k = target / long; w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k)); cap = 0;
            unit = Math.max(w, h) / Math.min(long, workCap || long);   // a prévia trabalha com no máximo workCap px
        }
        // sem GPU (ou contexto perdido no celular): processa numa base menor para não travar a tela
        if (!PixelarGPU.isAvailable()) cap = Math.min(cap || 1024, 1024);
        if (cap && Math.max(w, h) > cap) { const k = cap / Math.max(w, h); w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k)); }
        const cropKey = JSON.stringify(st.crop);
        const key = o.key ? `${o.key}|${px}|${s.imageScale}|${cropKey}|${w}x${h}` : null;
        if (key === null || key !== smallKey) {
            if (small.width !== w || small.height !== h) { small.width = w; small.height = h; } else sCtx.clearRect(0, 0, w, h);
            sCtx.imageSmoothingEnabled = px > 1 ? false : true;
            drawCropped(sCtx, media, geo, w, h, s.imageScale);
            smallKey = key; smallData = null;
        }
        const maxDim = Math.max(w, h) * px, limit = o.maxDim || 2000;
        let displayScale = maxDim > limit ? limit / maxDim : 1;
        if (o.targetRes) displayScale = o.targetRes / (h * px);
        let W = Math.max(1, Math.round(w * px * displayScale)), H = Math.max(1, Math.round(h * px * displayScale));
        const out = o.out;
        if (out.canvas.width !== W || out.canvas.height !== H) { out.canvas.width = W; out.canvas.height = H; }

        if (o.compare) {
            const cc = o.compare;
            if (cc.canvas.width !== W || cc.canvas.height !== H) { cc.canvas.width = W; cc.canvas.height = H; }
            cc.ctx.clearRect(0, 0, W, H); cc.ctx.imageSmoothingEnabled = true;
            drawCropped(cc.ctx, media, geo, W, H, s.imageScale);
        }

        ensureAutoPalette(st, s, w, h);
        const color = resolveColor(st);
        // degradê numa grade de até 512 px (rápido e leve); a GPU interpola até o tamanho real
        let grad = null;
        if (st.grad.on) { const k = Math.min(1, 512 / Math.max(w, h)); const gw = Math.max(1, Math.round(w * k)), gh = Math.max(1, Math.round(h * k)); grad = Object.assign(getGradientData(st.grad, gw, gh), { w: gw, h: gh }); }
        const gpuReady = PixelarGPU.isAvailable() && PixelarGPU.fits(w, h);
        const needMinMax = s.shadowsInverted || s.midDither;
        const mm = (needMinMax || !gpuReady) ? cpuAdjust(getSmallData(w, h), null, s.adj) : { minL: 0, maxL: 255 };
        const an = o.anim || null;
        const fx = s.fx ? { id: s.fx.id, mix: (an && an.fxMix != null) ? an.fxMix : s.fx.mix, params: (an && an.fxParams) || s.fx.params } : null;
        let film = animFilm(s.film, an && an.film);
        const grain = s.grain ? Object.assign({}, s.grain, { seed: o.grainSeed || 0, strength: s.grain.strength * (o.grainScale !== undefined ? o.grainScale : 1), cell: Math.max(1, s.grain.cell * (o.grainCell || 1)) }) : null;

        let d = null;
        const { chain, edgeLast } = buildChain(st, s, fx, grain, an);
        // contorno dentro da cadeia: espessura em pixels da arte
        chain.forEach(c => { if (c.kind === 'edge') { c.half = Math.max(0.35, s.edge.size * unit / (2 * px)); c.color = rgbArr(s.edge.color); } });
        const usedGPU = gpuReady && PixelarGPU.render({
            w, h, srcCanvas: small, srcKey: key, adj: s.adj, dither: s.dither, anim: an,
            minL: mm.minL, maxL: mm.maxL, shadowsInverted: s.shadowsInverted, midDither: s.midDither,
            grad, color, chain, mix: s.mix, edgeBase: s.edge.size > 0, cluster: s.cluster, unit,
            dbl: s.dbl ? Object.assign({}, s.dbl, { t: an && an.T ? an.T : 0 }) : null,
        });
        if (!usedGPU) {
            d = renderCPU(getSmallData(w, h), w, h, s, color, grad, an, grain, mm);
            if (cpuCanvas.width !== w || cpuCanvas.height !== h) { cpuCanvas.width = w; cpuCanvas.height = h; }
            cCtx.putImageData(new ImageData(d, w, h), 0, 0);
        }
        const octx = out.ctx;
        octx.imageSmoothingEnabled = !!o.smooth; if (o.smooth) octx.imageSmoothingQuality = 'high';
        octx.clearRect(0, 0, W, H);
        if (usedGPU) { const g = PixelarGPU.region(); octx.drawImage(PixelarGPU.canvas, g.x, g.y, w, h, 0, 0, W, H); }
        else octx.drawImage(cpuCanvas, 0, 0, w, h, 0, 0, W, H);
        // contorno medido em pixels da arte: mesma espessura relativa na tela, nas miniaturas e em qualquer tamanho exportado
        if (s.edge.size > 0 && (edgeLast || !usedGPU)) {
            const thick = s.edge.size * displayScale * unit * (o.edgeScale || 1);
            const comp = COMP_OPS[(edgeLast && edgeLast.blend) || 'normal'];
            if (comp) octx.globalCompositeOperation = comp;
            const rg = usedGPU && typeof PixelarGPU.edges === 'function' && PixelarGPU.edges({ W, H, scale: W / w, half: thick / 2, color: rgbArr(s.edge.color), opacity: s.edge.opacity });
            if (rg) { octx.imageSmoothingEnabled = false; octx.drawImage(PixelarGPU.canvas, rg.x, rg.y, W, H, 0, 0, W, H); }
            else { if (!d) d = PixelarGPU.readPixels(); drawEdges(octx, d, w, h, px * displayScale, Object.assign({}, s.edge, { size: thick })); }
            octx.globalCompositeOperation = 'source-over';
        }
        return { w, h, W, H, usedGPU, settings: s, unit };
    }

    function invalidate() { smallKey = null; smallData = null; }
    return { render, invalidate, readSettings, get workCap() { return workCap; }, set workCap(v) { workCap = v; smallKey = null; } };
})();

// ============================================================
// ANÁLISE DA IMAGEM (orienta o aleatório)
// ============================================================
const _an = document.createElement('canvas'), _anCtx = _an.getContext('2d', { willReadFrequently: true });
function analyzeMedia(media) {
    try {
        const { W, H } = mediaSize(media); if (!W || !H) return null;
        const S = 64, w = W >= H ? S : Math.max(1, Math.round(S * W / H)), h = H >= W ? S : Math.max(1, Math.round(S * H / W));
        _an.width = w; _an.height = h; _anCtx.drawImage(media, 0, 0, w, h);
        const data = _anCtx.getImageData(0, 0, w, h).data, n = w * h, L = new Float32Array(n);
        let sumL = 0, sumS = 0;
        for (let i = 0, p = 0; i < data.length; i += 4, p++) { const r = data[i], g = data[i + 1], b = data[i + 2]; const l = 0.3 * r + 0.59 * g + 0.11 * b; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); L[p] = l; sumL += l; sumS += mx === 0 ? 0 : (mx - mn) / mx; }
        const meanL = sumL / n; let v = 0; for (let p = 0; p < n; p++) v += (L[p] - meanL) ** 2;
        const stdL = Math.sqrt(v / n), meanSat = sumS / n;
        let sd = 0, nd = 0; for (let y = 0; y < h; y++) for (let x = 1; x < w; x++) { sd += Math.abs(L[y * w + x] - L[y * w + x - 1]); nd++; }
        const complexity = nd ? sd / nd : 0;
        return { meanL, stdL, meanSat, complexity, isDark: meanL < 85, isBright: meanL > 170, isLowContrast: stdL < 30, isHighContrast: stdL > 70, isLowSat: meanSat < 0.15, isHighSat: meanSat > 0.55, isBusy: complexity > 18, isFlat: complexity < 6 };
    } catch (e) { return null; }
}
