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
    adj: { exposure: 0, brightness: 0, contrast: 0, shadows: 0, temperature: 0, saturation: 0, posterize: 0, rgbShift: 0, shadowsInverted: false },
    grain: { amount: 0, size: 100, rough: 45, bias: 20, speckle: 0, mono: true },
    pixel: { size: 1, scale: 100 },
    dither: { mode: 'none', scale: 1, intensity: 100, opacity: 100, midOnly: false },
    edge: { size: 0, color: '#1A1A1A', opacity: 100 },
    fx: { id: 'none', mix: 100 },
    fxParams: {},                       // { efeito: { uniform: valor } } — texturas e filmes clássicos
    color: { sel: 'all', mode: 'original', invert: false, base: [], ref: [], hue: 0, sat: 0, light: 0, duo: ['#0A1A2F', '#5A82A5', '#F2EFE9'] },
    grad: { on: false, colors: ['#FF00FF', '#00FFFF'], type: 'linear', angle: 90, steps: 0, pos: 50, smooth: 100, blend: 'source-atop', cx: 50, cy: 50, scale: 100, repeat: 1, mirror: false, noise: 0, opacity: 100 },
    film: {
        look: 'none', mix: 100, temp: 0, grainAmt: 100, frame: 'auto', frameColor: '#f5f2eb', stamp: 'auto', stampColor: '#ff8c1f',
        vignette: 0, halation: 0, bloom: 0, soft: 0, distort: 0, chroma: 0, leak: 0, dust: 0, flash: 0,
        vigColor: '#000000', leakColor: '#ff7319', vencido: 0, lumiereHue: 280,
    },
    bg: { fill: false, color: '#F0F0F0' },
    crop: { aspect: 'original', rot: 0, flipH: false, flipV: false, zoom: 100, x: 0, y: 0 },
    anim: Object.assign({}, ANIM_DEFAULTS),
};

const deepClone = (o) => JSON.parse(JSON.stringify(o));
function freshState() { return deepClone(DEFAULT_STATE); }

// mescla um estado parcial/antigo sobre o padrão (campos novos ganham o valor padrão)
function normalizeState(p) {
    const out = freshState();
    if (!p || typeof p !== 'object') return out;
    for (const k of Object.keys(out)) {
        if (p[k] === undefined) continue;
        if (out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
            if (k === 'fxParams') out[k] = deepClone(p[k] || {});
            else Object.assign(out[k], deepClone(p[k]));
        } else out[k] = deepClone(p[k]);
    }
    out.v = 2;
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

// paleta harmônica aleatória (mesmo algoritmo do original)
function generateHarmonyPalette(qty) {
    const baseHue = Math.random(), saturation = 0.65 + Math.random() * 0.35;
    const modes = ['dark', 'bright', 'mixed', 'pastel', 'vibrant', 'pop', 'random'];
    const lMode = modes[Math.floor(Math.random() * modes.length)];
    const getL = (i, n) => { if (lMode === 'dark') return 0.15 + (i / n) * 0.35; if (lMode === 'bright') return 0.5 + (i / n) * 0.4; if (lMode === 'pastel') return 0.7 + Math.random() * 0.2; if (lMode === 'vibrant') return 0.4 + Math.random() * 0.3; if (lMode === 'pop') return i % 2 === 0 ? 0.2 + Math.random() * 0.15 : 0.7 + Math.random() * 0.2; if (lMode === 'random') return 0.15 + Math.random() * 0.7; return 0.1 + (i / n) * 0.8; };
    const getS = () => { if (lMode === 'pastel') return 0.4 + Math.random() * 0.4; if (lMode === 'vibrant' || lMode === 'pop') return 0.8 + Math.random() * 0.2; if (lMode === 'random') return 0.5 + Math.random() * 0.5; return saturation; };
    const H = [[0], [0, 1 / 12, -1 / 12, 2 / 12], [0, 0.5], [0, 5 / 12, 7 / 12], [0, 1 / 3, 2 / 3], [0, 0.25, 0.5, 0.75], [0, 0.2, 0.4, 0.6, 0.8], Array.from({ length: Math.max(qty, 3) }, (_, i) => i / Math.max(qty, 3)), Array.from({ length: Math.max(qty, 4) }, () => Math.random())];
    const pool = qty > 2 ? [H[1], H[3], H[4], H[4], H[5], H[5], H[6], H[7], H[8], H[8]] : H;
    const harmony = pool[Math.floor(Math.random() * pool.length)];
    const anchors = [];
    for (let i = 0; i < qty; i++) {
        const shift = lMode === 'random' ? Math.random() * 0.05 - 0.025 : 0;
        anchors.push(hslToRgb((baseHue + harmony[i % harmony.length] + shift + 1) % 1, getS(), getL(i, qty)));
    }
    return anchors.sort((a, b) => luma(a) - luma(b));
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
const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const B8 = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];
const FS4 = [0, 0, 7, 3, 5, 1, 0, 0, 3, 7, 0, 0, 0, 0, 1, 5];
const HT_S = Math.sin(Math.PI / 4), HT_C = Math.cos(Math.PI / 4);
function ditherAtCPU(mode, x, y, sc, T, seed, anim) {
    const sx = Math.floor(x / sc), sy = Math.floor(y / sc);
    switch (mode) {
        case 'halftone': { const size = Math.max(2, sc * 3); const rx = x * HT_C - y * HT_S, ry = x * HT_S + y * HT_C; const cx = ((Math.abs(rx) + T * size) % size) - size / 2, cy = ((Math.abs(ry) + T * size) % size) - size / 2; return ((Math.sqrt(cx * cx + cy * cy) * (1 + 0.35 * Math.sin(TAU * T)) / (size / 1.5)) - 0.5) * 1.5; }
        case 'nintendo_ds': return (((B4[(sy % 4) * 4 + sx % 4] + Math.floor(T * 16)) % 16) / 15 - 0.5) * 0.5;
        case 'bayer8': return (((B8[(sy % 8) * 8 + sx % 8] + Math.floor(T * 64)) % 64) / 63 - 0.5) * 0.5;
        case 'floyd_approx': { const o = Math.floor(T * 4); return (FS4[((sy + o) % 4) * 4 + (sx + o) % 4] / 16 - 0.5) * 0.6; }
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
        if (a.poster > 0) { const n = a.poster - 1, q = 255 / n; r = Math.round((r / 255) * n) * q; g = Math.round((g / 255) * n) * q; b = Math.round((b / 255) * n) * q; }
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
            [r, g, b] = blendCPU(grad.b, r, g, b, grad.d[i], grad.d[i + 1], grad.d[i + 2]);
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
    if (s.rgbShift > 0) { const copy = new Uint8ClampedArray(d), sh = s.rgbShift; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (x + sh < w) d[i] = copy[i + sh * 4]; if (x - sh >= 0) d[i + 2] = copy[i - sh * 4 + 2]; } }
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
        if (gradCache.size > 24) gradCache.delete(gradCache.keys().next().value);
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
    uFrame: 0, uFrameColor: [0.96, 0.95, 0.92], uStamp: 0, uStampA: [0, 0, 0, 0], uStampB: [0, 0], uStampColor: [1, 0.55, 0.12],
    uWeave: 0, uFlicker: 0, uLeakDrift: 0, uBurnAnim: 0, uAnim: 0, uAnimFrame: 0,
};
const FILM_SCALE_KEYS = ['uHalation', 'uBloom', 'uSoft', 'uBlur', 'uSharpen', 'uVignette', 'uDistort', 'uChroma', 'uFlash', 'uLeak', 'uDust', 'uScratch', 'uBurn', 'uGrain', 'uJpeg', 'uChromaNoise', 'uInterlace', 'uAutochrome'];
const FRAME_NAMES = { 1: 'Polaroid', 2: 'Instax', 3: 'Filme 35 mm', 4: 'Super 8', 5: 'Médio formato', 6: 'Cinemascope', 7: 'Slide', 8: 'Papel antigo', 9: 'Placa de metal', 10: 'Cantos redondos' };
const FRAME_COLORS = { 1: [0.96, 0.95, 0.92], 2: [0.98, 0.98, 0.97], 3: [0.06, 0.05, 0.04], 4: [0.03, 0.03, 0.03], 5: [0.02, 0.02, 0.02], 6: [0, 0, 0], 7: [0.94, 0.93, 0.9], 8: [0.9, 0.86, 0.76], 9: [0.12, 0.1, 0.08], 10: [0.97, 0.96, 0.93] };
const FILM_LOOK_DEFS = [
    ['Pioneiros', [
        ['nitrato', 'Nitrato 1910', 'Rolo de cinema mudo em nitrato: bordas queimadas, riscos e poeira.', { uBW: 1, uTone: 0.5, uToneColor: [0.6, 0.5, 0.35], uContrast: 1.3, uBurn: 0.8, uDust: 1, uScratch: 1, uVignette: 0.8, uSoft: 0.4, uGrain: 0.5, uGrainSize: 1.8 }],
    ]],
    ['Cor antiga', [
        ['techni2', 'Technicolor 2', 'Só vermelho-alaranjado e ciano-esverdeado: os primeiros filmes coloridos.', { uSwap: 4, uSwapAmt: 1, uSat: 1.2, uContrast: 1.1, uTemp: 0.1, uFade: 0.1, uBase: [0.05, 0.04, 0.03], uSoft: 0.3, uGrain: 0.2, uDust: 0.3, uScratch: 0.2 }],
        ['techni3', 'Technicolor 3', 'Corantes separados: cores cheias e vermelhos profundos dos musicais clássicos.', { uSwap: 3, uSwapAmt: 1, uSat: 1.35, uContrast: 1.2, uRoll: 0.3, uSplit: 0.3, uShadowTint: [0.45, 0.5, 0.55], uHighTint: [0.58, 0.52, 0.42], uSoft: 0.2, uHalation: 0.15, uGrain: 0.15 }],
        ['noir', 'Film noir', 'P&B de estúdio: pretos fundos, luz dura e brilho nas lâmpadas.', { uBW: 1, uContrast: 1.7, uExposure: -0.25, uVignette: 1.2, uBloom: 0.25, uGrain: 0.35, uSoft: 0.2 }],
    ]],
    ['Anos 50–70', [
        ['cine16', 'Cine 16 mm', 'Documentário e filme caseiro: cores gastas, grão grosso e riscos.', { uSat: 0.95, uContrast: 1.1, uTemp: 0.15, uFade: 0.1, uBase: [0.05, 0.04, 0.03], uGrain: 0.45, uGrainSize: 1.6, uDust: 0.4, uScratch: 0.5, uSoft: 0.3, uVignette: 0.5 }],
        ['hp5', 'Ilford HP5', 'P&B versátil: meios-tons suaves e grão fino.', { uBW: 1, uBWMix: [0.25, 0.6, 0.15], uContrast: 1.2, uRoll: 0.2, uGrain: 0.5, uGrainSize: 1.4, uFade: 0.03, uBase: [0.03, 0.03, 0.03] }],
        ['cross', 'Processo cruzado', 'Diapositivo revelado como negativo: amarelos e verdes ácidos.', { uCross: 1, uSat: 1.3, uContrast: 1.2, uSplit: 0.3, uShadowTint: [0.45, 0.55, 0.5], uHighTint: [0.6, 0.58, 0.4], uVignette: 0.5 }],
        ['bleach', 'Bleach bypass', 'Revelação sem branqueamento: prata sobre a cor, dessaturado e duro.', { uBleach: 1, uSat: 0.8, uContrast: 1.15, uTemp: -0.05, uGrain: 0.3 }],
    ]],
    ['Anos 80–90', [
        ['gold200', 'Kodak Gold 200', 'O filme das férias: dourado, quente e alegre.', { uTemp: 0.35, uSat: 1.1, uContrast: 1.05, uSplit: 0.35, uShadowTint: [0.45, 0.47, 0.5], uHighTint: [0.62, 0.55, 0.4], uFade: 0.05, uBase: [0.04, 0.03, 0.02], uGrain: 0.25 }],
        ['superia', 'Fuji Superia 400', 'Negativo do dia a dia: verdes marcantes e tons frios.', { uTemp: -0.1, uTint: -0.2, uSat: 1.1, uContrast: 1.1, uSplit: 0.35, uShadowTint: [0.44, 0.54, 0.52], uHighTint: [0.53, 0.53, 0.47], uGrain: 0.25 }],
        ['portra', 'Kodak Portra 400', 'Negativo de retrato: pele suave, luzes macias e baixo contraste.', { uContrast: 0.9, uRoll: 0.4, uSat: 0.9, uTemp: 0.15, uTint: 0.05, uFade: 0.06, uBase: [0.05, 0.04, 0.04], uSplit: 0.25, uShadowTint: [0.47, 0.5, 0.53], uHighTint: [0.55, 0.51, 0.47], uGrain: 0.15, uGrainSize: 1.2, uHalation: 0.05 }],
        ['descartavel', 'Descartável', 'Flash estourado no centro, lente de plástico.', { uFlash: 0.7, uTemp: 0.15, uSat: 1.1, uContrast: 1.15, uVignette: 0.6, uSoft: 0.35, uDistort: 0.15, uChroma: 0.6, uGrain: 0.35 }],
        ['compacta', 'Compacta', 'Câmera de bolso com flash embutido.', { uTemp: 0.2, uSat: 1.05, uContrast: 1.1, uSplit: 0.2, uShadowTint: [0.46, 0.5, 0.52], uHighTint: [0.56, 0.52, 0.45], uFlash: 0.35, uVignette: 0.35, uGrain: 0.25 }],
        ['vhscam', 'Filmadora VHS', 'Cor borrada, entrelaçamento e ruído nas sombras.', { uSoft: 0.8, uSharpen: 0.4, uSat: 1.25, uChroma: 1.2, uChromaNoise: 0.6, uInterlace: 0.6, uContrast: 0.95, uFade: 0.08, uBase: [0.04, 0.04, 0.05], uTemp: 0.1, uVignette: 0.2 }],
        ['hi8', 'Hi8', 'Filmadora de mão mais nítida: cor limpa, leve ruído e entrelaçamento.', { uSoft: 0.4, uSharpen: 0.5, uSat: 1.1, uChroma: 0.6, uChromaNoise: 0.35, uInterlace: 0.4, uTemp: -0.05, uSplit: 0.2, uShadowTint: [0.46, 0.5, 0.54], uHighTint: [0.54, 0.51, 0.48] }],
    ]],
    ['Instantâneas', [
        ['lomo', 'Lomo LC-A', 'Cores explosivas e túnel escuro nas bordas.', { uVignette: 1.5, uSat: 1.45, uContrast: 1.4, uCross: 0.25, uDistort: 0.1, uBlur: 0.6, uGrain: 0.3 }],
        ['pinhole', 'Pinhole', 'Sem lente: tudo levemente fora de foco e escurecido nas bordas.', { uSoft: 1.6, uVignette: 1.4, uContrast: 0.9, uSat: 0.8, uFade: 0.15, uBase: [0.06, 0.05, 0.04], uTemp: 0.2, uGrain: 0.3 }],
        ['polaroid', 'Polaroid', 'Instantânea clássica: cores lavadas, sombras esverdeadas e moldura branca.', { uContrast: 0.92, uFade: 0.12, uBase: [0.06, 0.07, 0.05], uSat: 0.9, uTemp: 0.12, uSplit: 0.3, uShadowTint: [0.45, 0.53, 0.5], uHighTint: [0.57, 0.53, 0.45], uVignette: 0.3, uSoft: 0.25, uGrain: 0.15 }, { frame: 1 }],
        ['instax', 'Instax', 'Instantânea moderna: nítida, fria e com borda larga embaixo.', { uContrast: 1.05, uSat: 1.08, uTemp: -0.08, uFade: 0.05, uBase: [0.03, 0.04, 0.05], uFlash: 0.2, uGrain: 0.08 }, { frame: 2 }],
    ]],
    ['Atuais', [
        ['agfavista', 'Agfa Vista 200', 'Negativo de supermercado: vermelhos fortes e céu ciano.', { uSat: 1.25, uContrast: 1.15, uTemp: 0.05, uHue: -0.04, uSplit: 0.35, uShadowTint: [0.44, 0.48, 0.56], uHighTint: [0.58, 0.5, 0.46], uGrain: 0.2 }],
        ['ektar', 'Kodak Ektar 100', 'Grão finíssimo: cores puras e nitidez alta.', { uSat: 1.35, uContrast: 1.2, uTemp: 0.05, uGrain: 0.06, uSharpen: 0.3 }],
        ['cinestill', 'CineStill 800T', 'Filme de cinema: frio (tungstênio) e brilho vermelho ao redor das luzes.', { uTemp: -0.45, uTint: 0.05, uHalation: 1, uHalColor: [1, 0.18, 0.08], uContrast: 1.05, uSat: 1.05, uRoll: 0.3, uGrain: 0.35, uGrainSize: 1.3, uSplit: 0.3, uShadowTint: [0.44, 0.5, 0.56], uHighTint: [0.56, 0.5, 0.46] }],
        ['lomopurple', 'LomoChrome Purple', 'Verdes viram roxo e azuis viram verde.', { uSwap: 2, uSwapAmt: 1, uSat: 1.2, uContrast: 1.15, uGrain: 0.3, uVignette: 0.5 }],
        ['aerochrome', 'Aerochrome', 'Infravermelho: vegetação vira vermelho e rosa.', { uSwap: 1, uSwapAmt: 1, uSat: 1.25, uContrast: 1.2, uGrain: 0.2 }],
        ['super8', 'Super 8', 'Filme caseiro dos anos 70: quente, granulado, cantos arredondados e data.', { uTemp: 0.25, uSat: 1.15, uContrast: 1.1, uFade: 0.08, uBase: [0.05, 0.03, 0.02], uGrain: 0.5, uGrainSize: 1.7, uSoft: 0.45, uVignette: 0.7, uDust: 0.3, uScratch: 0.2, uHalation: 0.2 }, { frame: 4, stamp: true, year: 1978 }],
    ]],
    ['Digital', [
        ['ccd', 'Digital CCD', 'Câmera digital de bolso dos anos 2000: flash e nitidez dura.', { uSharpen: 0.6, uSat: 1.2, uContrast: 1.15, uTemp: -0.12, uBloom: 0.3, uFlash: 0.45, uJpeg: 0.35, uChromaNoise: 0.4, uExposure: 0.1 }, { stamp: true, year: 2004 }],
        ['webcam', 'Webcam', 'Chamada de vídeo: blocos de compressão, ruído e cor lavada.', { uJpeg: 0.8, uChromaNoise: 0.8, uSoft: 0.5, uSat: 0.8, uContrast: 0.9, uTemp: 0.15, uTint: -0.15, uExposure: -0.1, uVignette: 0.7 }],
        ['vga', 'Celular VGA', 'Primeiras câmeras de celular: pouca resolução, ruído e luzes estouradas.', { uJpeg: 1, uChromaNoise: 1, uSat: 0.85, uContrast: 1.2, uSharpen: 0.8, uTemp: -0.2, uSoft: 0.3, uExposure: 0.15, uBloom: 0.35 }],
    ]],
    ['Clássicos', [
        ['kodak_verde', 'Kodak desbotado', 'Filme antigo desbotado com dominante esverdeada.', {}, { fx: 'kodak_verde' }],
        ['kodak_pb', 'Kodak P&B', 'Preto e branco contrastado com microgrão.', {}, { fx: 'kodak_pb' }],
        ['lumiere', 'Lumiere', 'Tingimento monocromático de cinema mudo (matiz ajustável).', {}, { fx: 'lumiere' }],
        ['vencido', 'Filme vencido', 'Filme fora da validade com vazamentos (4 variações).', {}, { fx: 'vencido' }],
    ]],
];
const FILM_LOOKS = {};
FILM_LOOK_DEFS.forEach(([group, list]) => list.forEach(([id, nome, desc, u, x]) => { FILM_LOOKS[id] = Object.assign({ id, nome, desc, group, u }, x || {}); }));
const LENS_KEYS = ['vignette', 'halation', 'bloom', 'soft', 'distort', 'chroma', 'leak', 'dust', 'flash'];

function stampDigits(year) {
    const d = new Date(), y = (year || d.getFullYear()) % 100, mo = d.getMonth() + 1, da = d.getDate();
    return { A: [Math.floor(y / 10), y % 10, Math.floor(mo / 10), mo % 10], B: [Math.floor(da / 10), da % 10] };
}

function fxParamsFor(st, effectId) {
    const p = Object.assign({}, (st.fxParams && st.fxParams[effectId]) || {});
    if (effectId === 'vencido') p.uVariant = st.film.vencido || 0;
    if (effectId === 'lumiere') p.uHue = ((st.film.lumiereHue || 0) % 360) / 360;
    return p;
}

function readFilm(st) {
    const f = st.film, look = FILM_LOOKS[f.look] || null;
    const mix = f.mix / 100, temp = +f.temp || 0, grainK = f.grainAmt / 100;
    const frame = f.frame === 'auto' ? (look && look.frame) || 0 : parseInt(f.frame, 10) || 0;
    const stamp = f.stamp === 'on' || (f.stamp === 'auto' && look && look.stamp);
    const lens = {}; let lensOn = false;
    LENS_KEYS.forEach(k => { lens[k] = (+f[k] || 0) / 100; if (lens[k]) lensOn = true; });
    if (!look && !lensOn && !frame && !stamp && !temp) return null;
    const chem = look && !look.fx;
    const u = Object.assign({}, FILM_NEUTRAL, chem ? look.u : {});
    u.uLookOn = (chem || temp) ? 1 : 0;
    u.uMix = chem ? mix : 1;
    if (chem) FILM_SCALE_KEYS.forEach(k => { u[k] *= mix; });
    ['uGrain', 'uDust', 'uScratch', 'uChromaNoise'].forEach(k => { u[k] *= grainK; });
    u.uTemp += temp / 100 * 0.6;
    u.uVignette += lens.vignette * 1.5; u.uHalation += lens.halation; u.uBloom += lens.bloom;
    u.uSoft += lens.soft * 2.5; u.uDistort += lens.distort * 0.8; u.uChroma += lens.chroma * 1.5;
    u.uLeak += lens.leak; u.uDust += lens.dust; u.uFlash += lens.flash;
    u.uVigColor = rgbArr(f.vigColor); u.uLeakColor = rgbArr(f.leakColor);
    u.uFrame = frame; u.uFrameColor = rgbArr(f.frameColor);
    u.uStamp = stamp ? 1 : 0;
    if (stamp) { const sd = stampDigits(look && look.year); u.uStampA = sd.A; u.uStampB = sd.B; }
    u.uStampColor = rgbArr(f.stampColor);
    const active = u.uLookOn || frame || stamp || FILM_SCALE_KEYS.some(k => u[k] !== 0);
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
    const a = st.adj, cont = +a.contrast, post = +a.posterize, g = st.grain;
    return {
        px: Math.max(1, Math.round(st.pixel.size)),
        imageScale: st.pixel.scale / 100,
        colorSel: st.color.sel,
        adj: {
            exp: Math.pow(2, a.exposure / 50), br: +a.brightness, sh: +a.shadows, sat: a.saturation / 100,
            cont, contFactor: (259 * (cont + 255)) / (255 * (259 - cont)), temp: +a.temperature,
            poster: post > 0 ? Math.max(2, Math.round(16 - (post / 100) * 14)) : 0, invert: !!st.color.invert,
        },
        dither: { mode: st.dither.mode, scale: Math.max(1, Math.round(st.dither.scale)), strength: (st.dither.intensity / 100) * (st.dither.opacity / 100) },
        shadowsInverted: !!a.shadowsInverted, midDither: !!st.dither.midOnly,
        rgbShift: Math.round(a.rgbShift),
        fx: st.fx.id !== 'none' ? { id: st.fx.id, mix: st.fx.mix / 100, params: fxParamsFor(st, st.fx.id) } : null,
        grain: g.amount ? { strength: (g.amount / 100) * 60, cell: Math.max(1, g.size / 100), rough: g.rough / 100, bias: g.bias / 100, speckle: g.speckle / 100, mono: !!g.mono } : null,
        edge: { size: +st.edge.size, color: st.edge.color, opacity: st.edge.opacity / 100 },
        fillBg: st.bg.fill ? st.bg.color : null,
        grad: !!st.grad.on,
        film: readFilm(st),
    };
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
        const cap = o.maxWork !== undefined ? o.maxWork : workCap;
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
        const grad = st.grad.on ? getGradientData(st.grad, w, h) : null;
        const gpuReady = PixelarGPU.isAvailable() && PixelarGPU.fits(w, h);
        const needMinMax = s.shadowsInverted || s.midDither;
        const mm = (needMinMax || !gpuReady) ? cpuAdjust(getSmallData(w, h), null, s.adj) : { minL: 0, maxL: 255 };
        const an = o.anim || null;
        const fx = s.fx ? { id: s.fx.id, mix: (an && an.fxMix != null) ? an.fxMix : s.fx.mix, params: (an && an.fxParams) || s.fx.params } : null;
        let film = s.film;
        if (film && an && an.film) {
            const af = an.film;
            if (film.u) film.u = Object.assign({}, film.u, { uAnim: af.T, uAnimFrame: af.frame, uWeave: af.weave, uFlicker: af.flicker, uLeakDrift: af.leak, uBurnAnim: af.burn });
            if (film.fx) film.fx = Object.assign({}, film.fx, { params: af.fxParams || film.fx.params, animT: af.fxT, animFrame: af.frame });
        }
        const grain = s.grain ? Object.assign({}, s.grain, { seed: o.grainSeed || 0, strength: s.grain.strength * (o.grainScale !== undefined ? o.grainScale : 1), cell: Math.max(1, s.grain.cell * (o.grainCell || 1)) }) : null;

        let d = null;
        const usedGPU = gpuReady && PixelarGPU.render({
            w, h, srcCanvas: small, srcKey: key, adj: s.adj, dither: s.dither, anim: an,
            minL: mm.minL, maxL: mm.maxL, shadowsInverted: s.shadowsInverted, midDither: s.midDither,
            grad, color, rgbShift: s.rgbShift, fx, film, grain,
        });
        if (!usedGPU) {
            d = renderCPU(getSmallData(w, h), w, h, s, color, grad, an, grain, mm);
            if (cpuCanvas.width !== w || cpuCanvas.height !== h) { cpuCanvas.width = w; cpuCanvas.height = h; }
            cCtx.putImageData(new ImageData(d, w, h), 0, 0);
        }
        const octx = out.ctx;
        octx.imageSmoothingEnabled = !!o.smooth; if (o.smooth) octx.imageSmoothingQuality = 'high';
        if (s.fillBg) { octx.fillStyle = s.fillBg; octx.fillRect(0, 0, W, H); } else octx.clearRect(0, 0, W, H);
        if (usedGPU) { const g = PixelarGPU.region(); octx.drawImage(PixelarGPU.canvas, g.x, g.y, w, h, 0, 0, W, H); }
        else octx.drawImage(cpuCanvas, 0, 0, w, h, 0, 0, W, H);
        // contorno medido em pixels da arte: mesma espessura relativa na tela, nas miniaturas e em qualquer tamanho exportado
        if (s.edge.size > 0) { if (!d) d = PixelarGPU.readPixels(); drawEdges(octx, d, w, h, px * displayScale, Object.assign({}, s.edge, { size: s.edge.size * displayScale * (o.edgeScale || 1) })); }
        return { w, h, W, H, usedGPU, settings: s };
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
