/* Pixelar Studio — interface.
 * Uma única fonte de verdade: `st` (estado). Controles leem e escrevem nele por
 * caminho ('adj.exposure'), e toda mudança passa por change() → novo quadro,
 * histórico e miniaturas. Os painéis são descritos como dados (TABS) e montados
 * sob demanda, então mudar o layout nunca mexe no processamento.
 */
'use strict';
(() => {
const $ = (id) => document.getElementById(id);
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
const store = {
    get(k, d) { try { const v = localStorage.getItem('pixelar.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('pixelar.' + k, JSON.stringify(v)); } catch (e) {} },
};

// ============================================================
// ESTADO DO APP
// ============================================================
let st = freshState();
const app = $('app'), stage = $('stage'), viewport = $('viewport'), wrap = $('canvasWrap');
const outCanvas = $('outCanvas'), outCtx = outCanvas.getContext('2d');
const origCanvas = $('origCanvas'), origCtx = origCanvas.getContext('2d');
const video = $('sourceVideo');
const M = { type: null, el: null, serial: 0, name: '', blob: null, url: null, duration: 0, trim: [0, 0], analysis: null };
const prefs = {
    locks: new Set(store.get('locks', [])),
    groups: new Set(store.get('randGroups', Object.keys(RANDOM_GROUPS))),
    presets: store.get('presets', {}),
    palettes: store.get('palettes', {}),
    muted: store.get('muted', false),
};
const ui = { tab: 'estilos', group: {}, active: {}, presetFilter: 'Todos', surprise: [], busy: false };

// ============================================================
// AVISOS
// ============================================================
function toast(msg, action, ms = 3200) {
    const box = $('toasts');
    box.querySelectorAll('.toast').forEach(o => o.remove());          // um aviso por vez
    // fica dentro da área da imagem, logo abaixo da barra de botões (nunca por cima deles)
    const r = $('viewport').getBoundingClientRect(), sheetOpen = !$('sheet').hidden;
    box.style.top = (sheetOpen ? 16 : Math.max(8, r.top + 10)) + 'px';
    box.style.left = (sheetOpen ? innerWidth / 2 : r.left + r.width / 2) + 'px';
    const t = h('div', 'toast'); t.append(h('span', '', '')); t.firstChild.textContent = msg;
    if (action) { const b = h('button', '', action.label); b.type = 'button'; b.onclick = () => { action.run(); t.remove(); }; t.append(b); }
    box.append(t); void t.offsetWidth; t.classList.add('show');
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

// ============================================================
// CAMINHOS NO ESTADO
// ============================================================
function getP(path, obj = st) {
    if (path.startsWith('fxcolor.')) { const [, id, pre] = path.split('.'); const def = PixelarFX.getEffectDef(id).uniforms, p = (obj.fxParams[id] || {}); const g = (c) => p[pre + '_' + c] !== undefined ? p[pre + '_' + c] : def[pre + '_' + c]; return arrHex([g('r'), g('g'), g('b')]); }
    if (path.startsWith('fxParams.')) { const [, id, u] = path.split('.'); const p = obj.fxParams[id] || {}; return p[u] !== undefined ? p[u] : PixelarFX.getEffectDef(id).uniforms[u]; }
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setP(path, v, obj = st) {
    if (path.startsWith('fxcolor.')) { const [, id, pre] = path.split('.'); const c = rgbArr(v); const p = obj.fxParams[id] = obj.fxParams[id] || {}; p[pre + '_r'] = c[0]; p[pre + '_g'] = c[1]; p[pre + '_b'] = c[2]; return; }
    if (path.startsWith('fxParams.')) { const [, id, u] = path.split('.'); (obj.fxParams[id] = obj.fxParams[id] || {})[u] = v; return; }
    const ks = path.split('.'), last = ks.pop(); const o = ks.reduce((a, k) => a[k], obj); o[last] = v;
}
function defP(path) {
    if (path.startsWith('fxcolor.') || path.startsWith('fxParams.')) { const [, id, u] = path.split('.'); const def = PixelarFX.getEffectDef(id).uniforms; if (path.startsWith('fxcolor.')) return arrHex([def[u + '_r'], def[u + '_g'], def[u + '_b']]); return def[u]; }
    return getP(path, DEFAULT_STATE);
}

// ============================================================
// RENDER PRINCIPAL
// ============================================================
let renderQueued = false, lastRender = null;
const view = { zoom: 1, x: 0, y: 0, fitW: 0, fitH: 0 };
const anim = { playing: false, t0: 0, raf: 0 };
const compare = { split: false, pos: 0.5, hold: false };

function requestRender() {
    if (renderQueued || !M.el) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; renderMain(); });
}
function mainFrameOptions() {
    const s = Engine.readSettings(st);
    if (M.type === 'image' && anim.playing) {
        const cfg = readAnim(st); const i = Math.floor(((performance.now() - anim.t0) / 1000) * cfg.fps) % cfg.frames;
        return animFrameOptions(i, cfg, s);
    }
    if (M.type === 'video' && st.anim.videoSync) {
        const cfg = readAnim(st);
        if (describeAnimation(s, cfg).length) { const i = Math.floor(Math.max(0, video.currentTime - M.trim[0]) * cfg.fps); return Object.assign(animFrameOptions(i, cfg, s), { grainSeed: video.currentTime }); }
        return { grainSeed: video.currentTime };
    }
    return {};
}
let renderFailures = 0;
function renderMain() {
    try { renderMainUnsafe(); renderFailures = 0; }
    catch (e) {
        console.error('[Pixelar] falha ao desenhar:', e);
        // não deixa um erro travar o app: avisa uma vez e continua respondendo
        if (++renderFailures === 1) toast('Algo falhou ao desenhar. Tente de novo ou recarregue a página.');
    }
}
function renderMainUnsafe() {
    if (!M.el) return;
    if (M.type === 'video' && !video.videoWidth) return;
    const showOrig = compare.split || compare.hold;
    const r = Engine.render(st, Object.assign({ media: M.el, key: M.type === 'image' ? 'main' + M.serial : null, out: { canvas: outCanvas, ctx: outCtx }, compare: showOrig ? { canvas: origCanvas, ctx: origCtx } : null, maxDim: 2000 }, mainFrameOptions()));
    if (!r) return;
    const sizeChanged = !lastRender || lastRender.W !== r.W || lastRender.H !== r.H;
    lastRender = r;
    if (sizeChanged) fitView();
    outCanvas.classList.toggle('smooth', st.pixel.size <= 1 && r.W < view.fitW * devicePixelRatio);
    if (!anim.playing && (M.type !== 'video' || video.paused)) Accent.schedule(outCanvas);
}
let gpuLost = false;
window.onGpuLost = () => { gpuLost = true; toast('O processador gráfico foi reiniciado pelo sistema. Recuperando…', null, 4000); };
window.onGpuRestored = () => { gpuLost = false; Engine.invalidate(); requestRender(); Thumbs.refreshAll(); };

// ============================================================
// COR DE DESTAQUE: vem da cor dominante (mais viva) da imagem editada
// ============================================================
const Accent = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 40; const x = c.getContext('2d', { willReadFrequently: true });
    let timer = 0, last = '';
    function pickFrom(src) {
        if (!src || !src.width) return null;
        x.clearRect(0, 0, 40, 40); x.drawImage(src, 0, 0, 40, 40);
        const d = x.getImageData(0, 0, 40, 40).data;
        const bins = new Array(24).fill(0).map(() => ({ w: 0, r: 0, g: 0, b: 0 }));
        let gray = { w: 0, l: 0 };
        for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] < 128) continue;
            const { h: hh, s: ss, l } = rgbToHsl(d[i], d[i + 1], d[i + 2]);
            gray.w++; gray.l += l;
            if (ss < 0.18 || l < 0.12 || l > 0.92) continue;
            // peso: quantidade × saturação² × preferência por meios-tons
            const w = ss * ss * (1 - Math.abs(l - 0.55) * 1.2);
            const bn = bins[Math.floor(hh * 24) % 24]; bn.w += w; bn.r += d[i] * w; bn.g += d[i + 1] * w; bn.b += d[i + 2] * w;
        }
        // soma cada faixa com as vizinhas para achar a família de cor dominante
        let best = -1, bw = 0;
        for (let k = 0; k < 24; k++) { const w = bins[k].w + 0.5 * (bins[(k + 23) % 24].w + bins[(k + 1) % 24].w); if (w > bw) { bw = w; best = k; } }
        if (best < 0 || bw < 1.5) return { h: 0, s: 0, l: gray.w ? gray.l / gray.w : 0.5 };   // imagem sem cor
        const bn = bins[best]; return rgbToHsl(bn.r / bn.w, bn.g / bn.w, bn.b / bn.w);
    }
    function apply(hsl) {
        if (!hsl) return;
        const root = document.documentElement.style;
        const chroma = hsl.s > 0.05;
        const s = chroma ? Math.max(0.55, Math.min(1, hsl.s * 1.15)) : 0;
        const fill = hslToRgb(hsl.h, s, chroma ? 0.58 : 0.82);
        const lum = (0.2126 * fill.r + 0.7152 * fill.g + 0.0722 * fill.b) / 255;
        const txtD = hslToRgb(hsl.h, s, chroma ? 0.7 : 0.85), txtL = hslToRgb(hsl.h, Math.min(1, s * 1.05), chroma ? 0.38 : 0.3);
        const key = rgbHex(fill); if (key === last) return; last = key;
        root.setProperty('--acc', rgbHex(fill));
        root.setProperty('--acc-ink', lum > 0.55 ? '#111111' : '#FFFFFF');
        root.setProperty('--acc-text-d', rgbHex(txtD));
        root.setProperty('--acc-text-l', rgbHex(txtL));
        // reflexo do vidro acompanha o destaque: o próprio matiz e dois vizinhos (análogos), sempre juntos
        const t1 = hslToRgb(hsl.h, s, chroma ? 0.55 : 0.7), t2 = hslToRgb((hsl.h + 0.09) % 1, s * 0.9, chroma ? 0.45 : 0.6), t3 = hslToRgb((hsl.h + 0.93) % 1, s * 0.85, chroma ? 0.65 : 0.8);
        root.setProperty('--tint-1', rgbHex(t1)); root.setProperty('--tint-2', rgbHex(t2)); root.setProperty('--tint-3', rgbHex(t3));
    }
    // chamado depois de cada render; mede com calma (a cor segue a imagem, não cada quadro)
    function schedule(src, delay = 250) { clearTimeout(timer); timer = setTimeout(() => { try { apply(pickFrom(src)); } catch (e) {} }, delay); }
    return { schedule, apply, pickFrom };
})();

// ============================================================
// VISUALIZAÇÃO: encaixe, zoom e deslocamento
// ============================================================
function fitView(resetZoom) {
    if (!lastRender) return;
    const pad = innerWidth < 600 ? 12 : 24;   // no celular a imagem vai quase até a borda
    const vw = viewport.clientWidth - pad, vh = viewport.clientHeight - pad;
    const k = Math.min(vw / lastRender.W, vh / lastRender.H);
    view.fitW = Math.max(1, Math.floor(lastRender.W * k)); view.fitH = Math.max(1, Math.floor(lastRender.H * k));
    outCanvas.style.width = view.fitW + 'px'; outCanvas.style.height = view.fitH + 'px';
    if (resetZoom) { view.zoom = 1; view.x = 0; view.y = 0; }
    applyView();
}
function applyView() {
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    const w = view.fitW * view.zoom, hh = view.fitH * view.zoom;
    // mantém a imagem cobrindo o centro quando ampliada
    const maxX = Math.max(0, (w - vw) / 2 + 40), maxY = Math.max(0, (hh - vh) / 2 + 40);
    view.x = clampN(view.x, -maxX, maxX); view.y = clampN(view.y, -maxY, maxY);
    wrap.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
    wrap.style.transformOrigin = 'center center';
}
function zoomAt(factor, cx, cy) {
    const r = viewport.getBoundingClientRect();
    const px = (cx !== undefined ? cx - r.left : r.width / 2) - r.width / 2, py = (cy !== undefined ? cy - r.top : r.height / 2) - r.height / 2;
    const nz = clampN(view.zoom * factor, 1, 12), f = nz / view.zoom;
    view.x = px - (px - view.x) * f; view.y = py - (py - view.y) * f; view.zoom = nz;
    if (nz === 1) { view.x = 0; view.y = 0; }
    applyView();
}
new ResizeObserver(() => fitView()).observe(viewport);

// gestos no palco: pinça, arrastar, segurar para ver o original, divisor do comparar
(() => {
    const pts = new Map(); let pinch = null, holdTimer = 0, moved = false, lastTap = 0, dragSplit = false, start = null;
    viewport.addEventListener('pointerdown', (e) => {
        if (!M.el) return;
        if (e.isPrimary && pts.size) { pts.clear(); pinch = null; }   // um novo 1º toque descarta restos de toques perdidos
        viewport.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        moved = false; start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
        if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: view.zoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; clearTimeout(holdTimer); return; }
        if (compare.split) { const rc = outCanvas.getBoundingClientRect(); if (Math.abs(e.clientX - (rc.left + rc.width * compare.pos)) < 40 || view.zoom === 1) { dragSplit = true; setSplit((e.clientX - rc.left) / rc.width); return; } }
        clearTimeout(holdTimer);
        holdTimer = setTimeout(() => { if (!moved && !compare.split) { compare.hold = true; showOriginal(true); } }, 220);
    });
    viewport.addEventListener('pointermove', (e) => {
        if (!pts.has(e.pointerId)) return;
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch && pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); zoomAt((pinch.z * d / pinch.d) / view.zoom, pinch.cx, pinch.cy); return; }
        if (!start) return;
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) { moved = true; clearTimeout(holdTimer); }
        if (dragSplit) { const rc = outCanvas.getBoundingClientRect(); setSplit((e.clientX - rc.left) / rc.width); return; }
        if (view.zoom > 1 && moved) { view.x = start.vx + dx; view.y = start.vy + dy; applyView(); }
        else if (currentGroup().id === 'crop' && moved && !isCropIdentity(st.crop)) { cropDrag(dx, dy, e); }
    });
    const end = (e) => {
        if (!pts.has(e.pointerId)) return;
        pts.delete(e.pointerId); clearTimeout(holdTimer);
        if (pts.size < 2) pinch = null;
        if (compare.hold) { compare.hold = false; showOriginal(false); }
        if (cropDragState) { cropDragState = null; commit(); }
        if (!moved && !dragSplit && pts.size === 0 && e.type === 'pointerup') {
            const now = performance.now();
            if (now - lastTap < 300) { zoomAt(view.zoom > 1 ? 1 / view.zoom : 2.5, e.clientX, e.clientY); lastTap = 0; } else lastTap = now;
        }
        dragSplit = false; start = null;
    };
    viewport.addEventListener('pointerup', end); viewport.addEventListener('pointercancel', end);
    viewport.addEventListener('lostpointercapture', (e) => { if (pts.has(e.pointerId)) end(e); });
    viewport.addEventListener('wheel', (e) => {
        if (!M.el) return; e.preventDefault();
        if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
        else if (view.zoom > 1) { view.x -= e.deltaX; view.y -= e.deltaY; applyView(); }
        else if (Math.abs(e.deltaY) > 20 && !e.deltaX) zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
    }, { passive: false });
})();
let cropDragState = null;
function cropDrag(dx, dy, e) {
    if (!cropDragState) cropDragState = { x: st.crop.x, y: st.crop.y };
    const geo = cropGeometry(M.el, st.crop), rc = outCanvas.getBoundingClientRect();
    const RW = st.crop.rot % 180 ? geo.H : geo.W, RH = st.crop.rot % 180 ? geo.W : geo.H;
    const spanX = (RW - geo.cw) / 2, spanY = (RH - geo.ch) / 2;
    const pxPerSrc = rc.width / geo.cw;
    if (spanX > 0) st.crop.x = clampN(cropDragState.x - dx / pxPerSrc / spanX, -1, 1);
    if (spanY > 0) st.crop.y = clampN(cropDragState.y - dy / pxPerSrc / spanY, -1, 1);
    Engine.invalidate(); requestRender();
}
function showOriginal(on) {
    origCanvas.hidden = !on; $('origBadge').hidden = !(on && !compare.split);
    if (on) { origCanvas.style.clipPath = compare.split ? `inset(0 ${100 - compare.pos * 100}% 0 0)` : 'none'; renderMain(); }
}
function setSplit(p) {
    compare.pos = clampN(p, 0, 1);
    origCanvas.style.clipPath = `inset(0 ${100 - compare.pos * 100}% 0 0)`;
    $('splitLine').style.left = (compare.pos * 100) + '%';
}
function toggleSplit(on = !compare.split) {
    compare.split = on; $('btnCompare').classList.toggle('on', on);
    $('splitLine').hidden = !on; setSplit(compare.pos); showOriginal(on);
}

// ============================================================
// HISTÓRICO
// ============================================================
const hist = { stack: [], i: -1 };
let commitTimer = 0;
function snapshot() { return JSON.stringify(st); }
function pushHistory() {
    const s = snapshot();
    if (hist.stack[hist.i] === s) return;
    hist.stack = hist.stack.slice(0, hist.i + 1); hist.stack.push(s);
    if (hist.stack.length > 80) hist.stack.shift(); hist.i = hist.stack.length - 1;
    updateHistoryButtons();
}
function commit(immediate) {
    clearTimeout(commitTimer);
    if (immediate) pushHistory(); else commitTimer = setTimeout(pushHistory, 300);
}
function updateHistoryButtons() { $('btnUndo').disabled = hist.i <= 0; $('btnRedo').disabled = hist.i >= hist.stack.length - 1; }
function restore(s) { st = normalizeState(JSON.parse(s)); Engine.invalidate(); afterExternalChange(); }
function undo() { if (hist.i > 0) { hist.i--; restore(hist.stack[hist.i]); updateHistoryButtons(); } }
function redo() { if (hist.i < hist.stack.length - 1) { hist.i++; restore(hist.stack[hist.i]); updateHistoryButtons(); } }

// mudança feita por um controle
function change(path, v, { rebuild = false, soft = false, dials = false } = {}) {
    if (path) setP(path, v);
    if (path && path.startsWith('crop.')) Engine.invalidate();
    requestRender(); markTabs();
    if (!soft) commit();
    if (rebuild) buildPanel(); else if (dials) rebuildDials(); else refreshDials();
    Thumbs.stateChanged();
    if (anim.playing && !canAnimate()) stopAnim();
}
// estado trocado por fora (aleatório, preset, desfazer): remonta tudo
// keepEditor: mantém a faixa tocada intacta (só a fileira de botões é refeita)
function afterExternalChange({ keepEditor = false } = {}) {
    requestRender(); markTabs(); if (keepEditor) rebuildDials(); else buildPanel(); Thumbs.stateChanged();
    if (anim.playing && !canAnimate()) stopAnim();
}

// ============================================================
// DEFINIÇÃO DOS CONTROLES
// ============================================================
const R = (key, label, ic, min, max, o = {}) => Object.assign({ kind: 'range', key, label, icon: ic, min, max, step: 1 }, o);
const T = (key, label, ic, o = {}) => Object.assign({ kind: 'toggle', key, label, icon: ic }, o);
const C = (key, label, ic, options, o = {}) => Object.assign({ kind: 'choice', key, label, icon: ic, options, view: 'chips' }, o);
const K = (key, label, o = {}) => Object.assign({ kind: 'color', key, label, icon: 'color' }, o);
const A = (label, ic, run, o = {}) => Object.assign({ kind: 'action', label, icon: ic, run }, o);
const X = (id, label, ic, editor, o = {}) => Object.assign({ kind: 'custom', id, label, icon: ic, editor }, o);
const opts = (obj) => Object.entries(obj).map(([v, l]) => [v, l]);

const DITHER_OPTS = [['none', 'Sólido'], ['nintendo_ds', 'Pontilhismo'], ['halftone', 'Retícula'], ['checkerboard', 'Xadrez'], ['scanlines', 'TV analógica'], ['noise', 'Ruído'], ['bayer8', 'Bayer fino'], ['floyd_approx', 'Difusão']];
const COLOR_OPTS = [['all', 'Original'], ['2', '2'], ['3', '3'], ['4', '4'], ['6', '6'], ['8', '8'], ['12', '12'], ['16', '16'], ['24', '24'], ['32', '32'], ['48', '48'], ['64', '64'], ['128', '128'], ['256', '256'], ['duotone', 'Duotone'], ['tritone', 'Tritone']];
const GRAD_TYPE_OPTS = [['linear', 'Linear'], ['mirror', 'Espelhado'], ['radial', 'Radial'], ['conic', 'Cônico'], ['diamond', 'Diamante'], ['box', 'Quadrado'], ['wave', 'Onda'], ['spiral', 'Espiral']];
const BLEND_OPTS = [['source-atop', 'Substituir'], ['multiply', 'Multiplicar'], ['screen', 'Clarear'], ['overlay', 'Sobrepor'], ['softlight', 'Luz suave'], ['color', 'Só cor'], ['darken', 'Escurecer'], ['lighten', 'Iluminar'], ['difference', 'Diferença']];
const FILM_OPTS = [['none', 'Nenhum'], ...Object.values(FILM_LOOKS).map(l => [l.id, l.nome])];
const FX_OPTS = () => [['none', 'Nenhum'], ...PixelarFX.listEffects().map(f => [f.id, f.nome])];
// texturas agrupadas (miniaturas com títulos de grupo, como os filmes)
const FX_GROUP_DEFS = [
    ['Gráficos', ['ascii', 'crt', 'bitmap', 'color_threshold', 'pixelate_fx', 'beads', 'knit', 'mosaic_tiles']],
    ['Impressão', ['cmyk_halftone', 'duo_halftone', 'stipple', 'woodcut', 'hatching', 'photocopy', 'edge_ink', 'paper']],
    ['Luz e vidro', ['hologram', 'starlight', 'ghost_lens', 'fluted_glass', 'water', 'bloom', 'bokeh_blur']],
    ['Arte', ['contour', 'mesh_lines', 'neon_trace', 'emboss', 'smudge', 'warp', 'gooey_merge', 'pattern_refraction', 'outlines']],
    ['Cor e vídeo', ['thermal', 'acid', 'channel_mixer', 'vhs', 'slice_shift']],
];
function FX_GROUPS() {
    const all = PixelarFX.listEffects(), byId = Object.fromEntries(all.map(f => [f.id, f.nome])), used = new Set();
    const out = FX_GROUP_DEFS.map(([g, ids]) => [g, ids.filter(id => byId[id]).map(id => { used.add(id); return [id, byId[id]]; })]).filter(([, l]) => l.length);
    const rest = all.filter(f => !used.has(f.id)).map(f => [f.id, f.nome]); if (rest.length) out.push(['Outros', rest]);
    return out;
}
const PALETTE_LIBRARY = {
    'Game Boy': ['#0F380F', '#306230', '#8BAC0F', '#9BBC0F'],
    'PICO-8': ['#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8', '#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA'],
    'CGA': ['#000000', '#55FFFF', '#FF55FF', '#FFFFFF'],
    'Cinza': ['#111111', '#555555', '#AAAAAA', '#F2F2F2'],
    'Sépia': ['#2B1B0E', '#6B4226', '#A67B5B', '#D9BF9A', '#F5EBDC'],
    'Vaporwave': ['#2D1B69', '#FF6AD5', '#C774E8', '#AD8CFF', '#94D0FF'],
    'Terra': ['#3B2F2F', '#8C5E3C', '#C98B4F', '#E3C08D', '#F4E9D8'],
    'Oceano': ['#03045E', '#0077B6', '#00B4D8', '#90E0EF', '#CAF0F8'],
    'Neon': ['#0B0019', '#FF00E6', '#00F0FF', '#FFE600'],
    'Riso': ['#1D3557', '#FF5F7E', '#F7F1E3'],
};
const DUO_LIBRARY = { 'Noite': ['#0A1A2F', '#5A82A5', '#F2EFE9'], 'Rosa': ['#2A0845', '#FF6FB5', '#FFE3F1'], 'Laranja': ['#1B1B3A', '#FF7B00', '#FFE8C2'], 'Menta': ['#0B2E2B', '#2EC4B6', '#E8FFF9'], 'Sangue': ['#140000', '#B3001B', '#FFD6D6'], 'Ouro': ['#1C1405', '#C99A2E', '#FFF4D6'] };

const animOn = () => describeAnimation(Engine.readSettings(st), readAnim(st)).length > 0;
const canAnimate = () => M.type === 'image' && animOn();

function randomOnly(groups, label) {
    return A('Sortear', 'wand', () => {
        const before = snapshot();
        const touched = randomize(st, M.analysis, prefs.groups, prefs.locks, groups);
        afterExternalChange(); commit(true);
        toast(label + (touched.length ? ': ' + touched.slice(0, 3).join(' · ') : ''), { label: 'Desfazer', run: () => { restore(before); commit(true); } });
    }, { accent: true });
}

// cada aba: grupos (sub-abas) com a lista de controles
const TABS = [
    { id: 'estilos', label: 'Estilos', icon: 'styles', groups: [
        { id: 'receitas', label: 'Receitas', controls: () => [X('presets', 'Receitas', 'styles', editPresets)] },
        { id: 'surpresa', label: 'Variações', controls: () => [X('surprise', 'Variações', 'dice', editSurprise)] },
        { id: 'meus', label: 'Meus', controls: () => [X('mine', 'Meus', 'heart', editMine)] }
    ] },
    // Ajustar: luz, cor, grão, degradê, fundo e corte
    { id: 'ajustar', label: 'Ajustar', icon: 'adjust', groups: [
        { id: 'luz', label: 'Luz', controls: () => [
            randomOnly(['luz'], 'Luz sorteada'),
            R('adj.exposure', 'Exposição', 'exposure', -100, 100), R('adj.brightness', 'Brilho', 'brightness', -100, 100), R('adj.contrast', 'Contraste', 'contrast', -100, 100),
            R('adj.shadows', 'Sombras', 'shadows', -100, 100), R('adj.temperature', 'Temperatura', 'temp', -100, 100), R('adj.saturation', 'Saturação', 'saturation', -100, 100),
            R('adj.posterize', 'Posterizar', 'posterize', 0, 100), R('adj.rgbShift', 'Aberração RGB', 'rgb', 0, 15),
            T('adj.shadowsInverted', 'Inverter sombras', 'invert'),
        ] },
        { id: 'grao', label: 'Grão', controls: () => [
            randomOnly(['grain'], 'Granulado sorteado'),
            R('grain.amount', 'Intensidade', 'grain', 0, 100),
            // o resto só aparece quando há grão (sem grão, nada disso muda a imagem)
            ...(st.grain.amount > 0 ? [R('grain.size', 'Tamanho', 'size', 10, 400, { step: 5 }), R('grain.rough', 'Aspereza', 'rough', 0, 100),
                R('grain.bias', 'Sombras ↔ luzes', 'bias', -100, 100), R('grain.speckle', 'Manchas', 'speckle', 0, 100), T('grain.mono', 'Monocromático', 'mono')] : []),
        ] },

        { id: 'paleta', label: 'Cor', controls: () => {
            const duo = st.color.sel === 'duotone' || st.color.sel === 'tritone';
            const list = [randomOnly(['palette'], 'Paleta sorteada'), C('color.sel', 'Cores', 'palette', COLOR_OPTS, { onPick: pickColorCount }), X('palette', 'Editar', 'color', editPalette, { hidden: duo || st.color.sel === 'all', lockKey: 'color.palette' })];
            if (duo) { list.push(K('color.duo.0', 'Sombras'), K('color.duo.1', st.color.sel === 'tritone' ? 'Meios-tons' : 'Luzes')); if (st.color.sel === 'tritone') list.push(K('color.duo.2', 'Luzes')); list.push(X('duolib', 'Prontos', 'styles', editDuoLibrary)); }
            else list.push(X('library', 'Prontas', 'styles', editPaletteLibrary));
            if (!duo && st.color.sel !== 'all') list.push(R('color.hue', 'Matiz', 'hue', -180, 180), R('color.sat', 'Saturação', 'saturation', -100, 100), R('color.light', 'Luz', 'light', -100, 100),
                A('Embaralhar', 'swap', paletteShuffleOrder), A('Da foto', 'photo', paletteFromPhoto), A('Salvar', 'save', savePalette));
            list.push(T('color.invert', 'Inverter', 'invert', { onPick: toggleInvert }));
            return list;
        } },
        { id: 'degrade', label: 'Degradê', controls: () => {
            const g = st.grad, list = [randomOnly(['grad'], 'Degradê sorteado'), T('grad.on', 'Degradê', 'gradient')];
            if (!g.on) return list;
            list.push(X('gradcolors', 'Cores', 'palette', editGradColors), C('grad.type', 'Forma', 'gradient', GRAD_TYPE_OPTS), C('grad.blend', 'Mistura', 'layers', BLEND_OPTS), R('grad.opacity', 'Opacidade', 'opacity', 0, 100));
            if (GRAD_ANGLE_SHAPES.has(g.type)) list.push(R('grad.angle', 'Ângulo', 'angle', 0, 360, { step: 5 }));
            if (GRAD_CENTER_SHAPES.has(g.type)) list.push(R('grad.cx', 'Centro X', 'center', 0, 100), R('grad.cy', 'Centro Y', 'center', 0, 100));
            list.push(R('grad.scale', 'Escala', 'scale', 10, 400, { step: 5 }), R('grad.repeat', 'Repetir', 'repeat', 1, 8), T('grad.mirror', 'Espelhar', 'mirror'),
                R('grad.steps', 'Faixas', 'steps', 0, 30), R('grad.pos', 'Posição', 'position', 0, 100), R('grad.smooth', 'Suavidade', 'smooth', 0, 100), R('grad.noise', 'Ruído', 'noise', 0, 100));
            return list;
        } },
        { id: 'fundo', label: 'Fundo', controls: () => [T('bg.fill', 'Preencher', 'fill'), K('bg.color', 'Cor do fundo', { ensure: () => { st.bg.fill = true; } })] },

        { id: 'crop', label: 'Cortar', controls: () => [
            C('crop.aspect', 'Proporção', 'crop', [['original', 'Original'], ['1:1', 'Quadrado'], ['4:5', '4:5'], ['5:4', '5:4'], ['3:4', '3:4'], ['4:3', '4:3'], ['2:3', '2:3'], ['3:2', '3:2'], ['9:16', '9:16 Stories'], ['16:9', '16:9'], ['21:9', 'Cinema']], { onPick: () => { st.crop.x = 0; st.crop.y = 0; } }),
            A('Girar', 'rotate', () => { st.crop.rot = (st.crop.rot + 90) % 360; change(null, null, { rebuild: true }); Engine.invalidate(); }),
            T('crop.flipH', 'Espelhar ↔', 'flipH'), T('crop.flipV', 'Espelhar ↕', 'flipV'),
            R('crop.zoom', 'Zoom', 'zoom', 100, 400, { step: 5 }), ...cropMoveControls(),
            R('pixel.scale', 'Escala', 'scale', 20, 100),
            A('Restaurar', 'reset', () => { st.crop = deepClone(DEFAULT_STATE.crop); st.pixel.scale = 100; Engine.invalidate(); afterExternalChange(); commit(true); }),
        ] }
    ] },
    // Efeitos: pixel/dither, contorno, filmes, lente e texturas
    { id: 'efeitos', label: 'Efeitos', icon: 'fx', groups: [
        { id: 'padrao', label: 'Pixel', controls: () => [
            randomOnly(['pixel', 'dither'], 'Pixel sorteado'),
            C('dither.mode', 'Padrão', 'pattern', DITHER_OPTS, { view: 'thumbs', variant: (s, v) => { s.dither.mode = v; if (v !== 'none' && s.dither.intensity < 40) s.dither.intensity = 100; }, detail: true }),
            R('pixel.size', 'Tamanho do pixel', 'pixel', 1, 64),
            // ajustes do padrão só aparecem quando há um padrão escolhido
            ...(st.dither.mode === 'none' ? [] : [R('dither.scale', 'Escala do padrão', 'scale', 1, 10), R('dither.intensity', 'Intensidade', 'intensity', 0, 200),
                R('dither.opacity', 'Opacidade', 'opacity', 0, 100), T('dither.midOnly', 'Só meios-tons', 'mid')]),
        ] },
        { id: 'contorno', label: 'Contorno', controls: () => [
            R('edge.size', 'Espessura', 'edge', 0, 10), R('edge.opacity', 'Opacidade', 'opacity', 0, 100), K('edge.color', 'Cor', { ensure: () => { if (!st.edge.size) st.edge.size = 2; if (!st.edge.opacity) st.edge.opacity = 100; } }),
        ] },

        { id: 'filmes', label: 'Filme', controls: () => {
            const look = FILM_LOOKS[st.film.look];
            const list = [
                randomOnly(['film'], 'Filme sorteado'),
                C('film.look', 'Filme', 'film', FILM_OPTS, { view: 'thumbs', groupsOf: FILM_LOOK_DEFS, variant: (s, v) => { s.film.look = v; if (v !== 'none' && s.film.mix < 30) s.film.mix = 100; } }),
            ];
            // só mostra o que tem efeito: sem filme não há intensidade; grão só existe nos filmes químicos
            if (look) list.push(R('film.mix', 'Intensidade', 'intensity', 0, 100));
            if (look && !look.fx) list.push(R('film.grainAmt', 'Grão do filme', 'grain', 0, 200, { step: 5 }));
            list.push(R('film.temp', 'Temperatura', 'temp', -100, 100));
            if (look && look.fx === 'lumiere') list.push(R('film.lumiereHue', 'Matiz', 'hue', 0, 360));
            if (look && look.fx === 'vencido') list.push(C('film.vencido', 'Variação', 'film', [[0, 'Quente'], [1, 'Névoa magenta'], [2, 'Frio'], [3, 'Desbotado']]));
            if (look && look.fx) list.push(...fxParamControls(look.fx, ['uVariant', 'uHue']));
            return list;
        } },
        { id: 'lente', label: 'Lente', controls: () => [
            R('film.vignette', 'Vinheta', 'vignette', 0, 100), K('film.vigColor', 'Cor da vinheta', { ensure: () => { if (!st.film.vignette) st.film.vignette = 50; } }), R('film.halation', 'Halação', 'halation', 0, 100), R('film.bloom', 'Brilho', 'bloom', 0, 100),
            R('film.soft', 'Suavidade', 'soft', 0, 100), R('film.distort', 'Distorção', 'distort', -100, 100), R('film.chroma', 'Aberração', 'chroma', 0, 100),
            R('film.flash', 'Flash', 'flash', 0, 100), R('film.leak', 'Vazamento', 'leak', 0, 100), K('film.leakColor', 'Cor do vazamento', { ensure: () => { if (!st.film.leak) st.film.leak = 50; } }), R('film.dust', 'Poeira', 'dust', 0, 100),
        ] },

        { id: 'fx', label: 'Texturas', controls: () => {
            const list = [randomOnly(['fx'], 'Textura sorteada'), C('fx.id', 'Textura', 'fx', FX_OPTS(), { view: 'thumbs', groupsOf: FX_GROUPS(), variant: (s, v) => { s.fx.id = v; if (s.fx.mix < 30) s.fx.mix = 100; } }), R('fx.mix', 'Intensidade', 'intensity', 0, 100)];
            if (st.fx.id !== 'none') list.push(...fxParamControls(st.fx.id, []));
            return list;
        } }
    ] },
    { id: 'movimento', label: 'Animar', icon: 'motion', groups: [
        { id: 'geral', label: 'Geral', controls: () => {
            const list = [randomOnly(['anim'], 'Movimento sorteado')];
            if (M.type === 'image') list.push(A(anim.playing ? 'Parar' : 'Tocar', anim.playing ? 'pause' : 'play', togglePlay));
            else list.push(T('anim.videoSync', 'Aplicar no vídeo', 'video'));
            list.push(C('anim.cycles', 'Velocidade', 'speed', [[1, 'Lenta'], [2, 'Média'], [3, 'Rápida'], [4, 'Muito rápida']]),
                C('anim.direction', 'Sentido', 'direction', [['forward', 'Para frente'], ['reverse', 'Para trás']]),
                C('anim.duration', 'Duração do loop', 'clock', [[1, '1 s'], [2, '2 s'], [3, '3 s'], [4, '4 s'], [6, '6 s'], [8, '8 s']]),
                C('anim.fps', 'Quadros/s', 'fps', [[12, '12'], [24, '24'], [30, '30'], [50, '50'], [60, '60']]),
                A('Restaurar', 'reset', () => { st.anim = Object.assign({}, ANIM_DEFAULTS, { videoSync: st.anim.videoSync }); afterExternalChange(); commit(true); }));
            return list;
        } },
        { id: 'apadrao', label: 'Padrão', controls: () => {
            const sig = DITHER_SIGNATURE[st.dither.mode];
            const style = st.anim.dStyle === 'auto' ? (sig ? sig.style : 'auto') : st.anim.dStyle;
            const list = [T('anim.dither', 'Animar padrão', 'pattern'),
                C('anim.dStyle', 'Movimento', 'wave', DITHER_STYLE_OPTS.map(k => [k, k === 'auto' ? 'Próprio do padrão' : DITHER_STYLES[k].nome]))];
            if (st.anim.dStyle !== 'auto' && ['drift', 'wave', 'sweep'].includes(style)) list.push(R('anim.dAngle', 'Direção', 'angle', 0, 315, { step: 45 }));
            if (['wave', 'ripple', 'sweep', 'spiral'].includes(style)) list.push(R('anim.dWave', 'Comprimento', 'wave', 8, 400, { step: 4 }));
            return list;
        } },
        { id: 'afx', label: 'Textura', controls: () => [T('anim.fx', 'Animar textura', 'fx'), C('anim.fxStyle', 'Movimento', 'wave', opts(FX_STYLE_NAMES))] },
        { id: 'agrao', label: 'Grão', controls: () => [T('anim.grain', 'Animar grão', 'grain'), C('anim.grainStyle', 'Movimento', 'wave', opts(GRAIN_ANIM_NAMES))] },
        { id: 'afilme', label: 'Filme', controls: () => [T('anim.film', 'Animar filme', 'film'), C('anim.filmStyle', 'Movimento', 'wave', opts(FILM_ANIM_NAMES))] },
    ] },
];

function fxParamControls(id, hidden) {
    const def = PixelarFX.getEffectDef(id); if (!def) return [];
    const list = [], groups = {};
    Object.keys(def.uniforms).forEach(k => {
        if (hidden.includes(k)) return;
        const m = k.match(/^(.*)_(r|g|b)$/);
        if (m) { groups[m[1]] = true; return; }
        const dv = def.uniforms[k];
        const r = (FX_RANGES_BY_EFFECT[id] || {})[k] || FX_RANGES[k] || (dv < 0 ? [-Math.abs(dv * 3 + 1), Math.abs(dv * 3 + 1)] : [0, Math.max(dv * 3, dv + 1, 1)]);
        const span = r[1] - r[0];
        list.push(R('fxParams.' + id + '.' + k, FX_LABELS[k] || k.replace(/^u/, ''), 'sparkle', r[0], r[1], { step: span / 200, fmt: (v) => Math.round((v - r[0]) / span * 100) }));
    });
    Object.keys(groups).forEach(p => list.push(K('fxcolor.' + id + '.' + p, FX_COLOR_LABELS[p] || p.replace(/^u/, ''))));
    return list;
}

// ============================================================
// PAINEL
// ============================================================
function currentTab() { return TABS.find(t => t.id === ui.tab); }
function currentGroup() { const t = currentTab(); const gid = ui.group[t.id] || t.groups[0].id; return t.groups.find(g => g.id === gid) || t.groups[0]; }
let dialEls = [];

// Lente de vidro que desliza até o item escolhido (abas e seções), com mola.
// Guardamos a última posição no próprio contêiner: se ele for refeito, a lente nasce onde estava e desliza.
function placeLens(box, sel, instant) {
    if (!box) return;
    const on = box.querySelector(sel);
    let lens = box.querySelector(':scope > .lens');
    if (!on) { if (lens) lens.remove(); return; }
    // posição relativa ao contêiner somando offsets (ignora animações em andamento e já inclui a rolagem)
    let l = 0, t = 0, n = on;
    while (n && n !== box) { l += n.offsetLeft; t += n.offsetTop; n = n.offsetParent; }
    if (n !== box) return;
    const to = { l, t, w: on.offsetWidth, h: on.offsetHeight };
    if (!to.w) return;
    const fresh = !lens;
    if (fresh) { lens = h('span', 'lens'); box.prepend(lens); }
    const from = box._lens;
    const set = (r) => { lens.style.left = r.l + 'px'; lens.style.top = r.t + 'px'; lens.style.width = r.w + 'px'; lens.style.height = r.h + 'px'; };
    if ((fresh && from) && !instant) { lens.style.transition = 'none'; set(from); void lens.offsetWidth; lens.style.transition = ''; }
    else if (fresh || instant) { lens.style.transition = 'none'; set(to); void lens.offsetWidth; lens.style.transition = ''; }
    set(to); box._lens = to;
}
function buildTabbar() {
    const bar = $('tabbar'); bar.innerHTML = '';
    TABS.forEach((t, i) => {
        const TAB_IC = { estilos: 'tab-styles', ajustar: 'tab-adjust', efeitos: 'tab-fx', movimento: 'tab-motion' };
        const b = h('button', 'tab' + (t.id === ui.tab ? ' on' : ''), icon(TAB_IC[t.id] || t.icon, 'filled') + `<span>${t.label}</span>`);
        b.type = 'button'; b.dataset.tab = t.id; b.title = `${t.label} (${i + 1})`;
        b.onclick = () => { if (panelCollapsed) setPanelCollapsed(false); selectTab(t.id); };
        bar.append(b);
    });
    markTabs();
    requestAnimationFrame(() => placeLens(bar, '.tab.on', true));
    new ResizeObserver(() => placeLens(bar, '.tab.on', true)).observe(bar);
}
function selectTab(id) {
    if (!TABS.some(t => t.id === id)) id = TABS[0].id;
    ui.tab = id;
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === id));
    placeLens($('tabbar'), '.tab.on');
    $('toolTitle').textContent = M.el ? currentTab().label : '';
    buildPanel(); updateSubbarCenter();
    const on = document.querySelector('.tab.on'); if (on) on.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
}
function markTabs() {
    const D = DEFAULT_STATE, j = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
    const mod = {
        ajustar: j(st.adj, D.adj) || st.grain.amount > 0 || st.color.sel !== 'all' || st.color.invert || st.grad.on || st.bg.fill || !isCropIdentity(st.crop) || st.pixel.scale !== 100,
        efeitos: st.pixel.size > 1 || st.dither.mode !== 'none' || st.edge.size > 0 || st.fx.id !== 'none' || st.film.look !== 'none' || LENS_KEYS.some(k => st.film[k]) || (st.film.frame !== 'auto' && st.film.frame !== '0') || st.film.stamp === 'on' || !!st.film.temp,
        movimento: j(st.anim, ANIM_DEFAULTS),
    };
    // (sem marcadores nas abas: o estado aparece dentro de cada seção)
    void mod;
}

// Ao remontar o MESMO grupo (depois de um clique), tudo fica exatamente onde estava:
// fileira de botões, faixa de miniaturas/opções e a barra lateral. Só quando o
// usuário troca de aba/seção é que a rolagem volta para o item ativo.
let lastPanelKey = null;
const scrollOf = (el) => el ? el.scrollLeft : 0;
function editorScroller() { return $('editor').querySelector('.strip, .chips, .palettes, .swatches'); }
function buildPanel() {
    const tab = currentTab(), grp = currentGroup();
    const pKey = tab.id + '/' + grp.id;
    const same = pKey === lastPanelKey;
    const keep = same ? { dials: $('dials').scrollLeft, ed: scrollOf(editorScroller()), panel: $('panel').scrollTop, seg: $('segRow').scrollLeft, ctrl: ui.active[pKey] } : null;
    lastPanelKey = pKey;
    const seg = $('segRow'); seg.innerHTML = '';
    if (tab.groups.length > 1) tab.groups.forEach(g => {
        const b = h('button', 'seg' + (g === grp ? ' on' : ''), g.label); b.type = 'button';
        b.onclick = () => { ui.group[tab.id] = g.id; buildPanel(); };
        seg.append(b);
    });
    const controls = grp.controls().filter(c => !c.hidden);
    const dials = $('dials'); dials.innerHTML = ''; dialEls = [];
    const aKey = tab.id + '/' + grp.id;
    let active = controls.find(c => ctrlId(c) === ui.active[aKey]);
    if (!active) active = controls.find(c => c.kind === 'choice' || c.kind === 'custom' || c.kind === 'range') || controls[0];
    ui.active[aKey] = active && ctrlId(active);
    // aba com um único editor (Estilos) não mostra a fileira de botões
    const single = controls.length === 1 && controls[0].kind === 'custom';
    dials.hidden = single;
    $('panel').classList.toggle('single', single);   // sem fileira de botões: o editor usa esse espaço
    if (!single) controls.forEach((c, i) => { const d = makeDial(c, c === active); d.style.setProperty('--i', Math.min(i, 10)); dials.append(d); dialEls.push({ c, el: d }); });
    placeLens(seg, '.seg.on');
    if (!single) placeLens(dials, '.dial.active .face', !same);
    if (!same) enterAnim(dials, $('editor'));
    ui.keepScroll = !!(keep && keep.ctrl === ui.active[aKey]);
    buildEditor(active);
    ui.keepScroll = false;
    if (keep) {
        dials.scrollLeft = keep.dials; seg.scrollLeft = keep.seg; $('panel').scrollTop = keep.panel;
        const sc = editorScroller(); if (sc && keep.ctrl === ui.active[aKey]) sc.scrollLeft = keep.ed;
    } else {
        const a = dials.querySelector('.dial.active'); if (a && !single) requestAnimationFrame(() => centerIn(dials, a));
        const on = seg.querySelector('.seg.on'); if (on) centerIn(seg, on);
    }
}
// Refaz só a fileira de botões (ex.: escolher um filme com parâmetros próprios), sem
// tocar no editor — a faixa que o usuário está rolando continua exatamente onde está.
// conteúdo novo entra com um leve deslizar (só quando muda de seção ou de controle)
function enterAnim(...els) {
    els.forEach(el => { if (!el) return; el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); clearTimeout(el._et); el._et = setTimeout(() => el.classList.remove('enter'), 700); });
}
function rebuildDials() {
    const tab = currentTab(), grp = currentGroup(), aKey = tab.id + '/' + grp.id;
    const dials = $('dials'); if (dials.hidden) { refreshDials(); return; }
    const x = dials.scrollLeft;
    const controls = grp.controls().filter(c => !c.hidden);
    dials.innerHTML = ''; dialEls = [];
    controls.forEach(c => { const d = makeDial(c, ctrlId(c) === ui.active[aKey]); dials.append(d); dialEls.push({ c, el: d }); });
    placeLens(dials, '.dial.active .face', true);
    dials.scrollLeft = x;
}
// centraliza um item dentro da sua fileira sem rolar a página inteira
function centerIn(row, el) { if (!row || !el) return; row.scrollLeft = el.offsetLeft - row.clientWidth / 2 + el.offsetWidth / 2; }
const ctrlId = (c) => c.key || c.id || c.label;

function ctrlValue(c) { return c.get ? c.get() : c.key ? getP(c.key) : undefined; }
function isModified(c) {
    if (!c.key || c.key.startsWith('_')) return false;
    const v = ctrlValue(c), d = defP(c.key);
    return JSON.stringify(v) !== JSON.stringify(d) && !(typeof v === 'number' && Math.abs(v - d) < 1e-9);
}
function fmtVal(c, v) { if (c.fmt) return c.fmt(v); return Math.abs(v) >= 100 || Number.isInteger(v) ? Math.round(v) : (Math.round(v * 10) / 10); }

function makeDial(c, active) {
    const d = h('button', `dial kind-${c.kind}${active ? ' active' : ''}${c.accent ? ' accent' : ''}`); d.type = 'button';
    const face = h('span', 'face'); d.append(face, h('span', 'name', c.label));
    d.title = c.label;
    if (c.kind === 'range') {
        face.innerHTML = `<svg class="ring" viewBox="0 0 52 52"><circle class="track" cx="26" cy="26" r="25"/><circle class="arc" cx="26" cy="26" r="25"/></svg>${icon(c.icon)}`;
    } else if (c.kind === 'color') {
        face.innerHTML = `<span class="swatch"></span>`;
    } else face.innerHTML = icon(c.icon);
    updateDial(d, c);
    const lockKey = c.lockKey || c.key;
    // segurar trava o controle para o aleatório
    let lp = 0, longPressed = false;
    let downAt = null;
    d.addEventListener('pointerdown', (e) => { longPressed = false; downAt = { x: e.clientX, y: e.clientY }; if (!lockKey || c.kind === 'action') return; lp = setTimeout(() => { longPressed = true; toggleLock(lockKey); }, 500); });
    // arrastar a fileira não conta como segurar
    d.addEventListener('pointermove', (e) => { if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8) clearTimeout(lp); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => d.addEventListener(ev, () => { clearTimeout(lp); downAt = null; }));
    // depois de travar, o soltar do dedo não seleciona o botão
    d.addEventListener('click', (e) => { if (longPressed) { e.stopImmediatePropagation(); e.preventDefault(); longPressed = false; } }, true);
    d.addEventListener('contextmenu', (e) => { e.preventDefault(); });
    d.addEventListener('click', () => {
        if (longPressed) return;
        onDialClick(c, d);
    });
    d.addEventListener('dblclick', () => { if (c.kind === 'range' && c.key) { change(c.key, defP(c.key)); flashLabel(c.label + ' · padrão'); buildEditor(c); } });
    return d;
}
function updateDial(d, c) {
    const v = ctrlValue(c);
    if (c.kind === 'range') {
        const C0 = 2 * Math.PI * 25, arc = d.querySelector('.arc');
        const centered = c.min < 0 && c.max > 0;
        const f = centered ? Math.abs(v) / (v < 0 ? -c.min : c.max) * 0.5 : (v - c.min) / (c.max - c.min);
        arc.style.strokeDasharray = C0; arc.style.strokeDashoffset = C0 * (1 - clampN(f, 0, 1));
        d.querySelector('svg.ring').style.transform = centered && v < 0 ? 'rotate(-90deg) scaleY(-1)' : '';
    } else if (c.kind === 'toggle') d.classList.toggle('on', !!v);
    else if (c.kind === 'color') d.querySelector('.swatch').style.background = v;
    const lockKey = c.lockKey || c.key;
    let lb = d.querySelector('.lock-badge');
    if (lockKey && prefs.locks.has(lockKey)) { if (!lb) { lb = h('span', 'lock-badge', icon('lock')); d.append(lb); } } else if (lb) lb.remove();
}
function refreshDials() { dialEls.forEach(({ c, el }) => updateDial(el, c)); }
function toggleLock(key) {
    if (prefs.locks.has(key)) prefs.locks.delete(key); else prefs.locks.add(key);
    store.set('locks', [...prefs.locks]);
    refreshDials();
    toast(prefs.locks.has(key) ? 'Travado: o aleatório não muda este controle' : 'Destravado');
    if (navigator.vibrate) navigator.vibrate(10);
}
function onDialClick(c, d) {
    const tab = currentTab(), grp = currentGroup(), aKey = tab.id + '/' + grp.id;
    if (c.kind === 'action') { c.run(); return; }
    if (c.kind === 'toggle') {
        const nv = !ctrlValue(c);
        if (c.onPick) c.onPick(nv); else change(c.key, nv, { rebuild: !!c.rebuild || grpDependsOn(c.key) });
        if (!grpDependsOn(c.key)) { updateDial(d, c); }
        flashLabel(c.label + (nv ? ' · ligado' : ' · desligado'));
        return;
    }
    if (c.kind === 'color') { pickColor(ctrlValue(c), (hex, final) => { if (c.ensure) c.ensure(); change(c.key, hex, { soft: !final }); if (final && c.ensure) refreshDials(); else updateDial(d, c); }, c.label); return; }
    const changed = ui.active[aKey] !== ctrlId(c);
    ui.active[aKey] = ctrlId(c);
    dialEls.forEach(({ el }) => el.classList.toggle('active', el === d));
    placeLens($('dials'), '.dial.active .face');
    refreshDials();
    buildEditor(c);
    if (changed) enterAnim($('editor'));
    flashLabel(c.label);
}
// controles cujo valor muda quais outros controles aparecem
function grpDependsOn(key) { return ['grad.on', 'grad.type', 'color.sel', 'film.look', 'fx.id', 'anim.dStyle', 'dither.mode', 'crop.aspect', 'crop.zoom', 'crop.rot', 'grain.amount'].includes(key); }
// mover o recorte só faz sentido no eixo em que sobra imagem
function cropMoveControls() {
    const out = [];
    try {
        const g = M.el ? cropGeometry(M.el, st.crop) : null;
        const mv = (k, l) => R(k, l, 'move', -1, 1, { step: 0.01, fmt: (v) => Math.round(v * 100) });
        if (!g) return out;
        const rw = st.crop.rot % 180 ? g.H : g.W, rh = st.crop.rot % 180 ? g.W : g.H;
        if (g.cw < rw - 0.5) out.push(mv('crop.x', 'Horizontal'));
        if (g.ch < rh - 0.5) out.push(mv('crop.y', 'Vertical'));
    } catch (e) {}
    return out;
}

let labelTimer = 0;
function flashLabel(text, ms = 1100) {
    const l = $('paramLabel'); l.textContent = text; l.classList.add('show');
    clearTimeout(labelTimer); labelTimer = setTimeout(() => l.classList.remove('show'), ms);
}

// ============================================================
// EDITORES
// ============================================================
let lastEditorKey = null;
function buildEditor(c) {
    const ed = $('editor');
    // refazer o MESMO editor nunca volta a faixa para o começo: guarda e devolve a rolagem
    const key = c ? (c.key || c.id || (c.editor && c.editor.name) || c.label) + '|' + ui.tab + '|' + (ui.presetFilter || '') : null;
    const prev = key && key === lastEditorKey ? [...ed.querySelectorAll('.strip, .chips, .palettes, .swatches')].map(x => x.scrollLeft) : null;
    lastEditorKey = key;
    ed.innerHTML = '';
    if (!c) return;
    if (prev) { const keep = ui.keepScroll; ui.keepScroll = true; buildEditorInner(ed, c); ui.keepScroll = keep; [...ed.querySelectorAll('.strip, .chips, .palettes, .swatches')].forEach((x, i) => { if (prev[i] !== undefined) x.scrollLeft = prev[i]; }); return; }
    buildEditorInner(ed, c);
}
function buildEditorInner(ed, c) {
    if (c.kind === 'range') { ed.append(makeRuler(c)); return; }
    if (c.kind === 'choice') { ed.append(c.view === 'thumbs' ? makeThumbChoice(c) : makeChips(c)); const n = choiceNote(c); if (n) ed.append(h('div', 'editor-note', n)); return; }
    if (c.kind === 'custom') { c.editor(ed, c); return; }
    ed.append(h('div', 'editor-note', c.kind === 'toggle' ? 'Toque para ligar ou desligar.' : ''));
}
function choiceNote(c) {
    if (c.key === 'film.look') { const l = FILM_LOOKS[st.film.look]; return l ? l.desc : 'Escolha um filme: a prévia usa a sua foto com os ajustes atuais.'; }
    if (c.key === 'anim.colStyle' || c.key === 'anim.camStyle' || c.key.startsWith('anim.')) { const parts = describeAnimation(Engine.readSettings(st), readAnim(st)); return parts.length ? 'Movimento: ' + parts.join(' + ') : 'Nada se move ainda: escolha um padrão, filme, grão, câmera ou cor.'; }
    return '';
}

// ---------- régua (estilo Apple) ----------
// Slider de vidro (iOS 27): trilho fino com preenchimento na cor de destaque; ao arrastar, o botão
// vira uma lente de vidro. Arrasto relativo (o valor não salta ao tocar no botão), toque no trilho
// leva o botão até ali com mola, detente no valor padrão e precisão fina ao afastar o dedo na vertical.
function makeRuler(c) {
    const box = h('div', 'gs-wrap'), head = h('div', 'gs-head');
    const nameEl = h('span', 'gs-name', ''), valEl = h('span', 'gs-val', '');
    nameEl.textContent = c.label; head.append(nameEl, valEl);
    const el = h('div', 'gslider'); el.tabIndex = 0; el.setAttribute('role', 'slider'); el.setAttribute('aria-label', c.label);
    el.setAttribute('aria-valuemin', c.min); el.setAttribute('aria-valuemax', c.max);
    const track = h('div', 'gs-track'), fill = h('div', 'gs-fill'), thumb = h('div', 'gs-thumb');
    track.append(fill); el.append(track);
    const def = defP(c.key), range = c.max - c.min;
    const hasMark = typeof def === 'number' && def > c.min && def < c.max;
    let mark = null; if (hasMark) { mark = h('div', 'gs-mark'); el.append(mark); }
    el.append(thumb);
    let v = ctrlValue(c);
    const q = (x) => { const s = Math.round((x - c.min) / c.step) * c.step + c.min; return clampN(+s.toFixed(6), c.min, c.max); };
    const centered = c.min < 0 && c.max > 0;
    const fmtShow = (x) => { const f = fmtVal(c, x); return centered && x > 0 ? '+' + f : String(f); };
    const T = 38;
    const geo = () => { const W = el.clientWidth || 300; return { W, u: Math.max(1, W - T) }; };
    const xOf = (val) => { const { u } = geo(); return T / 2 + (val - c.min) / range * u; };
    const place = () => {
        const x = xOf(v), from = hasMark ? xOf(def) : 0;
        thumb.style.left = x + 'px';
        fill.style.left = Math.min(from, x) + 'px'; fill.style.width = Math.abs(x - from) + 'px';
        if (mark) mark.style.left = xOf(def) + 'px';
        el.setAttribute('aria-valuenow', q(v)); valEl.textContent = fmtShow(q(v));
    };
    const emit = (final) => {
        const qv = q(v);
        if (qv !== getP(c.key)) { setP(c.key, qv); requestRender(); Thumbs.stateChanged(); markTabs(); }
        const d = dialEls.find(x => x.c === c); if (d) updateDial(d.el, c);
        $('paramLabel').textContent = c.label + '  ' + fmtShow(qv);
        if (final) { commit(); if (grpDependsOn(c.key)) rebuildDials(); }
    };
    let snapped = false;
    const setV = (nv) => {
        // detente no valor padrão (como o zero da régua da Apple)
        if (hasMark) {
            const near = Math.abs(xOf(nv) - xOf(def)) < 7;
            if (near) { if (!snapped && navigator.vibrate) navigator.vibrate(4); snapped = true; nv = def; } else snapped = false;
        }
        v = clampN(nv, c.min, c.max); place(); emit(false);
    };
    const anim = (on) => { el.classList.toggle('anim', on); if (on) { clearTimeout(el._at); el._at = setTimeout(() => el.classList.remove('anim'), 480); } };
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        const r = el.getBoundingClientRect(), x = e.clientX - r.left, onThumb = Math.abs(x - xOf(v)) <= T / 2 + 8;
        if (!onThumb) { anim(true); snapped = false; setV(c.min + clampN((x - T / 2) / geo().u, 0, 1) * range); }
        drag = { x: e.clientX, y: e.clientY };
        el.classList.add('drag'); box.classList.add('drag');
        flashLabel(c.label + '  ' + fmtShow(q(v)), 100000);
    });
    el.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = Math.abs(e.clientY - drag.y);
        drag.x = e.clientX;
        const fine = dy > 120 ? 0.1 : dy > 60 ? 0.25 : 1;   // afastar o dedo na vertical = ajuste fino
        if (dx) { el.classList.remove('anim'); setV(v + dx / geo().u * range * fine); }
    });
    const up = () => {
        if (!drag) return; drag = null;
        el.classList.remove('drag'); box.classList.remove('drag');
        flashLabel(c.label + '  ' + fmtShow(q(v)));
        v = q(v); place(); emit(true);
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => { e.preventDefault(); const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : -e.deltaY; setV(v + d / geo().u * range * 0.3); clearTimeout(el._wt); el._wt = setTimeout(() => emit(true), 250); }, { passive: false });
    el.addEventListener('keydown', (e) => {
        const big = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); anim(true); v = clampN(q(v) + c.step * big, c.min, c.max); place(); emit(true); }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); anim(true); v = clampN(q(v) - c.step * big, c.min, c.max); place(); emit(true); }
    });
    el.addEventListener('dblclick', () => { anim(true); v = def; place(); emit(true); flashLabel(c.label + ' · padrão'); });
    new ResizeObserver(() => place()).observe(el);
    box.append(head, el, h('div', 'gs-hint', 'toque duplo volta ao padrão · afaste o dedo para ajuste fino'));
    requestAnimationFrame(place);
    return box;
}

// ---------- chips ----------
function makeChips(c) {
    const row = h('div', 'chips'), cur = String(ctrlValue(c));
    c.options.forEach(([val, label]) => {
        const b = h('button', 'chip' + (String(val) === cur ? ' on' : ''), label); b.type = 'button';
        b.onclick = () => {
            const v = typeof defP(c.key) === 'number' ? +val : val;
            if (c.onPick) c.onPick(v);
            if (c.key && !c.key.startsWith('_')) change(c.key, v, { dials: grpDependsOn(c.key) || !!c.onPick });
            row.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b));
            const n = $('editor').querySelector('.editor-note'); if (n) n.textContent = choiceNote(c);
            flashLabel(label);
        };
        row.append(b);
    });
    if (!ui.keepScroll) requestAnimationFrame(() => centerIn(row, row.querySelector('.chip.on')));
    return row;
}

// ---------- miniaturas ao vivo ----------
function makeThumbChoice(c) {
    const strip = h('div', 'strip'), cur = String(ctrlValue(c));
    const items = [];
    const add = (val, label) => {
        const t = h('button', 'thumb' + (String(val) === cur ? ' on' : '')); t.type = 'button';
        const pic = h('span', 'pic'); t.append(pic, h('span', 't', label));
        const variant = () => { const s = deepClone(st); c.variant(s, val); return s; };
        Thumbs.attach(pic, c.key + ':' + val, variant, true, !!c.detail);
        t.onclick = () => {
            if (c.onPick) c.onPick(val);
            change(c.key, val, { dials: grpDependsOn(c.key) || !!c.onPick });
            strip.querySelectorAll('.thumb').forEach(x => x.classList.toggle('on', x === t));
            flashLabel(label);
            const n = $('editor').querySelector('.editor-note'); if (n) n.textContent = choiceNote(c);
        };
        strip.append(t); items.push(t);
    };
    if (c.groupsOf) {
        add('none', 'Nenhum');
        c.groupsOf.forEach(([g, list]) => { strip.append(h('span', 'strip-group', g)); list.forEach(([id, nome]) => add(id, nome)); });
    } else c.options.forEach(([v, l]) => add(v, l));
    if (!ui.keepScroll) requestAnimationFrame(() => centerIn(strip, strip.querySelector('.thumb.on')));
    return strip;
}

// Renderizador de miniaturas: fila por quadro, com esqueleto nas cores da própria foto
let lastInput = 0, pointerDown = false;
addEventListener('pointerdown', () => { pointerDown = true; lastInput = performance.now(); }, true);
addEventListener('pointerup', () => { pointerDown = false; lastInput = performance.now(); }, true);
addEventListener('pointercancel', () => { pointerDown = false; }, true);
['touchend', 'touchcancel', 'blur'].forEach(ev => addEventListener(ev, () => { pointerDown = false; }, true));
document.addEventListener('visibilitychange', () => { pointerDown = false; });
let scrollPumpT = 0;
addEventListener('scroll', () => { lastInput = performance.now(); clearTimeout(scrollPumpT); scrollPumpT = setTimeout(() => Thumbs.pump(), 160); }, true);
const Thumbs = (() => {
    const src = document.createElement('canvas'), sctx = src.getContext('2d');
    let serial = 0, dominant = ['#888', '#aaa', '#666'];
    let live = [];             // { pic, canvas, id, variant, hash, liveState }
    let queue = [], raf = 0, dirtyTimer = 0;
    function setSource(el, force) {
        if (!el) return;
        const { W, H } = mediaSize(el); if (!W || !H) return;
        const k = 480 / Math.max(W, H); src.width = Math.max(1, Math.round(W * k)); src.height = Math.max(1, Math.round(H * k));
        sctx.drawImage(el, 0, 0, src.width, src.height); serial++;
        try {
            const d = sctx.getImageData(0, 0, src.width, src.height).data, px = [];
            for (let i = 0; i < d.length; i += 4 * 37) px.push({ r: d[i], g: d[i + 1], b: d[i + 2] });
            dominant = getMedianCut(px, 3).map(rgbHex);
        } catch (e) {}
        if (force) refreshAll();
    }
    // Miniatura fiel: renderiza com o MESMO processo e resolução da imagem principal
    // (pixel, dither, grão e contorno ficam na escala real) e só depois reduz.
    const full = document.createElement('canvas'), fullCtx = full.getContext('2d');
    const halfA = document.createElement('canvas'), halfB = document.createElement('canvas'); let step = 0;
    function drawThumb(it, W, H) {
        const T = it.canvas, side = Math.round(Math.min(220, (it.pic.clientWidth || 66) * (window.devicePixelRatio || 1)));
        if (T.width !== side) { T.width = side; T.height = side; }
        const tctx = T.getContext('2d');
        let sw, sh;
        if (it.detail) { sw = sh = Math.max(24, Math.round(Math.min(W, H) / 4)); }   // detalhe 1:1 do centro (padrões)
        else { sw = sh = Math.min(W, H); }                                             // quadrado central da imagem inteira
        const sx = Math.round((W - sw) / 2), sy = Math.round((H - sh) / 2);
        tctx.clearRect(0, 0, side, side);
        if (it.detail) { tctx.imageSmoothingEnabled = false; tctx.drawImage(full, sx, sy, sw, sh, 0, 0, side, side); return; }
        // redução em etapas de ½ (média de verdade, sem moiré em retículas e hachuras)
        let src = full, x = sx, y = sy, w = sw, hh = sh;
        while (w / 2 >= side) {
            const nw = Math.round(w / 2), nh = Math.round(hh / 2);
            const buf = step % 2 ? halfA : halfB; step++;
            if (buf.width < nw || buf.height < nh) { buf.width = nw; buf.height = nh; }
            const bx = buf.getContext('2d'); bx.imageSmoothingEnabled = true; bx.imageSmoothingQuality = 'high';
            bx.clearRect(0, 0, nw, nh); bx.drawImage(src, x, y, w, hh, 0, 0, nw, nh);
            src = buf; x = 0; y = 0; w = nw; hh = nh;
        }
        tctx.imageSmoothingEnabled = true; tctx.imageSmoothingQuality = 'high';
        tctx.drawImage(src, x, y, w, hh, 0, 0, side, side);
    }
    function placeholder(cv, pic) {
        if (!src.width) return;
        const side = Math.round(Math.min(220, 66 * (window.devicePixelRatio || 1)));
        if (cv.width !== side) { cv.width = side; cv.height = side; }
        const c = cv.getContext('2d'), sw = Math.min(src.width, src.height);
        c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
        c.drawImage(src, (src.width - sw) / 2, (src.height - sw) / 2, sw, sw, 0, 0, side, side);
    }
    const cache = new Map();   // id → { canvas, hash }: miniaturas sobrevivem à remontagem do painel
    function attach(pic, id, variant, liveState, detail) {
        const old = cache.get(id);
        const cv = old ? old.canvas : document.createElement('canvas');
        pic.append(cv);
        // enquanto o efeito não fica pronto, a miniatura mostra a própria foto enviada
        // (nada de degradê ou esmaecer): depois o efeito entra no lugar, na hora
        if (!cv.classList.contains('ready')) placeholder(cv, pic);
        const item = { pic, canvas: cv, id, variant, liveState, detail: !!detail, hash: old ? old.hash : null };
        cache.set(id, item); if (cache.size > 100) cache.delete(cache.keys().next().value);
        // só remove repetidos do mesmo item — as outras miniaturas desta faixa ainda não
        // estão na página neste momento (a faixa é inserida depois), então não podem ser filtradas aqui
        live = live.filter(x => x.id !== id); queue = queue.filter(x => x.id !== id);
        live.push(item); queue.push(item); pump();
    }
    function pump() { if (!raf) raf = requestAnimationFrame(work); }
    function work() {
        raf = 0; live = live.filter(it => it.pic.isConnected);
        // fila sempre limpa: sem itens de faixas que já saíram da tela e sem repetidos
        queue = [...new Set(queue.filter(it => it.pic.isConnected))];
        // enquanto o dedo está na tela (régua, rolagem), as miniaturas esperam: o gesto tem prioridade
        if (pointerDown || performance.now() - lastInput < 250) { setTimeout(pump, 150); return; }
        if (gpuLost || !PixelarGPU.isAvailable()) { setTimeout(pump, 800); return; }   // sem GPU, miniaturas esperam
        if (!M.el) { queue = []; return; }
        const t0 = performance.now();
        // Só as miniaturas visíveis (com uma de folga) são renderizadas. As outras esperam na
        // fila até a faixa ser rolada até elas — é o que mantém o celular leve e responsivo.
        const vis = (it) => { const r = it.pic.getBoundingClientRect(); const m = r.width || 60; return r.width && r.right > -m && r.left < innerWidth + m && r.bottom > 0 && r.top < innerHeight; };
        while (queue.length && performance.now() - t0 < 8) {
            const k = queue.findIndex(vis); if (k < 0) return;   // nada visível pendente: para até rolar
            const it = queue.splice(k, 1)[0]; if (!it.pic.isConnected) continue;
            let s; try { s = it.variant(); } catch (e) { continue; }
            const hash = M.serial + '|' + (M.type === 'video' ? video.currentTime : '') + '|' + it.detail + '|' + JSON.stringify(s);
            if (hash === it.hash) continue;
            it.hash = hash;
            // mesma base e mesma saída da imagem principal: a miniatura é o resultado real, reduzido
            let r = null;
            try { r = Engine.render(s, { media: M.el, key: M.type === 'image' ? 'main' + M.serial : null, out: { canvas: full, ctx: fullCtx }, maxDim: 2000 }); }
            catch (e) { console.warn('[Pixelar] miniatura falhou:', e); if (window.__diagErrs) window.__diagErrs.push('thumb: ' + (e && e.message) + ' @ ' + String(e && e.stack).split('\n').slice(0, 3).join(' | ')); continue; }
            if (r) { try { drawThumb(it, r.W, r.H); it.canvas.classList.add('ready'); } catch (e) { if (window.__diagErrs) window.__diagErrs.push('drawThumb: ' + e.message + ' @ ' + String(e.stack).split('\n').slice(0, 3).join(' | ')); } }
            else if (window.__diagErrs) window.__diagErrs.push('render devolveu null: ' + it.id);
        }
        if (queue.length) pump();
    }
    function refreshAll() { live = live.filter(it => it.pic.isConnected); queue = live.slice(); pump(); }
    function stateChanged() { clearTimeout(dirtyTimer); dirtyTimer = setTimeout(() => { live = live.filter(it => it.pic.isConnected); queue = live.filter(it => it.liveState); pump(); }, 260); }
    // (testes) processa a fila inteira agora, sem esperar quadros de tela
    function flush() { let n = 0; while (queue.length && n++ < 1000) { raf = 0; pointerDown = false; lastInput = 0; work(); } }
    return { setSource, attach, stateChanged, refreshAll, flush, pump, get pending() { return queue.length; }, get src() { return src; } };
})();

// ---------- editores personalizados ----------
function presetApplyState(ps) { const s = deepClone(ps); s.crop = deepClone(st.crop); s.anim = deepClone(st.anim); return s; }  // estilos nunca mexem na animação
function applyPreset(name, ps) {
    const before = snapshot();
    ui.lastPreset = name;
    stopAnim();
    st = normalizeState(presetApplyState(ps)); Engine.invalidate(); afterExternalChange({ keepEditor: true }); commit(true);
    flashLabel(name);
    return before;
}
function editPresets(ed) {
    const groups = ['Todos', ...PRESET_GROUPS.map(g => g[0])];
    const chips = h('div', 'chips');
    groups.forEach(g => { const b = h('button', 'chip' + (ui.presetFilter === g ? ' on' : ''), g); b.type = 'button'; b.onclick = () => { ui.presetFilter = g; buildEditor({ kind: 'custom', editor: editPresets }); }; chips.append(b); });
    const strip = h('div', 'strip');
    const addThumb = (name, stateFn) => {
        const t = h('button', 'thumb' + (ui.lastPreset === name ? ' on' : '')); t.type = 'button';
        const pic = h('span', 'pic'); t.append(pic, h('span', 't', name));
        Thumbs.attach(pic, 'preset:' + name, () => presetApplyState(stateFn()), false);
        t.onclick = () => { applyPreset(name, stateFn()); strip.querySelectorAll('.thumb').forEach(x => x.classList.toggle('on', x === t)); };
        strip.append(t);
    };
    PRESET_GROUPS.forEach(([g, names]) => {
        if (ui.presetFilter !== 'Todos' && ui.presetFilter !== g) return;
        if (ui.presetFilter === 'Todos') strip.append(h('span', 'strip-group', g));
        names.forEach(n => addThumb(n, () => presetState(n)));
    });
    ed.append(chips, strip);
}
// ---------- Variações (Muse): feitas para esta foto, evoluem com as escolhas ----------
let museCache = { serial: -1, A: null };
function museAnalysis() {
    if (museCache.serial !== M.serial || !museCache.A) museCache = { serial: M.serial, A: Muse.analyze(Thumbs.src) };
    return museCache.A;
}
function museLong() { const { W, H } = mediaSize(M.el); return Math.min(Math.max(W, H), Engine.workCap || 2048); }
function makeSurprises(parent) {
    const A = museAnalysis(); if (!A) { ui.surprise = []; return; }
    // 8 pensadas para a foto + 4 ousadas (cores e texturas fora da caixa), intercaladas
    const calm = Muse.generate(A, st, { n: parent ? 12 : 8, parent: parent || null, long: museLong(), locks: prefs.locks });
    const wild = parent ? [] : Muse.generate(A, st, { n: 4, pool: 48, wild: true, long: museLong(), locks: prefs.locks });
    ui.surprise = []; calm.forEach((v, i) => { ui.surprise.push(v); if (i % 2 === 1 && wild.length) ui.surprise.push(wild.shift()); }); ui.surprise.push(...wild);
    ui.museParent = parent || null;
}
function editSurprise(ed) {
    if (!ui.surprise.length) makeSurprises();
    const strip = h('div', 'strip');
    const roll = h('button', 'thumb add'); roll.type = 'button'; roll.innerHTML = `<span class="pic">${icon('dice')}</span><span class="t">Novas</span>`;
    roll.onclick = () => { makeSurprises(); lastEditorKey = null; buildEditor({ kind: 'custom', editor: editSurprise }); enterAnim($('editor')); };
    strip.append(roll);
    // sempre no mesmo lugar (apagado até escolher uma): nada se desloca quando ele passa a valer
    const more = h('button', 'thumb add more'); more.type = 'button'; more.innerHTML = `<span class="pic">${icon('sparkle')}</span><span class="t">Parecidas</span>`;
    more.disabled = !ui.musePick;
    more.onclick = () => { if (!ui.musePick) return; makeSurprises(ui.musePick); lastEditorKey = null; buildEditor({ kind: 'custom', editor: editSurprise }); enterAnim($('editor')); };
    strip.append(more);
    ui.surprise.forEach((v, i) => {
        const t = h('button', 'thumb' + (ui.musePick === v.genome ? ' on' : '')); t.type = 'button';
        const pic = h('span', 'pic'), lab = h('span', 't'); lab.textContent = v.name;
        t.append(pic, lab); t.title = v.name;
        Thumbs.attach(pic, 'muse:' + i + ':' + v.name, () => v.state, false);
        t.onclick = () => {
            const before = snapshot();
            st = normalizeState(deepClone(v.state)); Engine.invalidate(); afterExternalChange({ keepEditor: true }); commit(true);
            Muse.learn(v.genome, ui.surprise.map(x => x.genome)); ui.musePick = v.genome;
            strip.querySelectorAll('.thumb').forEach(x => x.classList.toggle('on', x === t));
            more.disabled = false;
            toast(v.name, { label: 'Desfazer', run: () => { restore(before); commit(true); } });
        };
        strip.append(t);
    });
    ed.append(strip, h('div', 'editor-note', ui.museParent ? 'Explorando a partir da que você escolheu.' : 'Feitas para esta foto. Escolha uma e toque em “Parecidas” para explorar.'));
}
function editMine(ed) {
    const strip = h('div', 'strip');
    const add = h('button', 'thumb add'); add.type = 'button'; add.innerHTML = `<span class="pic">${icon('plus')}</span><span class="t">Salvar atual</span>`;
    add.onclick = saveUserPreset; strip.append(add);
    Object.keys(prefs.presets).forEach(name => {
        const t = h('button', 'thumb'); t.type = 'button';
        const pic = h('span', 'pic'); t.append(pic, h('span', 't', name));
        Thumbs.attach(pic, 'mine:' + name, () => presetApplyState(normalizeState(prefs.presets[name])), false);
        const del = h('span', 'del', icon('close')); del.title = 'Apagar';
        del.onclick = (e) => { e.stopPropagation(); const bak = prefs.presets[name]; delete prefs.presets[name]; store.set('presets', prefs.presets); buildEditor({ kind: 'custom', editor: editMine }); toast('Estilo apagado', { label: 'Desfazer', run: () => { prefs.presets[name] = bak; store.set('presets', prefs.presets); buildEditor({ kind: 'custom', editor: editMine }); } }); };
        pic.append(del);
        t.onclick = () => applyPreset(name, normalizeState(prefs.presets[name]));
        strip.append(t);
    });
    ed.append(strip, h('div', 'editor-note', Object.keys(prefs.presets).length ? 'Seus estilos ficam salvos neste navegador.' : 'Salve a combinação atual para reutilizar em outras fotos e vídeos.'));
}

function editPalette(ed) {
    const pal = displayPalette(st.color), row = h('div', 'swatches');
    if (!pal.length) { ed.append(h('div', 'editor-note', 'A paleta aparece depois que a imagem for processada.')); requestAnimationFrame(() => { if (st.color.base.length) buildEditor({ kind: 'custom', editor: editPalette }); }); return; }
    const locked = prefs.locks.has('color.palette');
    pal.forEach((col, i) => {
        const b = h('button'); b.type = 'button'; b.style.background = rgbHex(col); b.title = rgbHex(col);
        b.onclick = () => { if (locked) { toast('Paleta travada'); return; } pickColor(rgbHex(col), (hex, final) => { const cur = displayPalette(st.color).map(rgbHex); cur[i] = hex; st.color.base = cur; st.color.hue = st.color.sat = st.color.light = 0; st.color.mode = 'manual'; b.style.background = hex; change(null, null, { soft: !final }); }, 'Cor ' + (i + 1)); };
        row.append(b);
    });
    ed.append(row, h('div', 'editor-note', 'Toque numa cor para trocá-la. As regiões da imagem continuam as mesmas.'));
}
function pickColorCount(v) {
    const c = st.color;
    if (v === 'all') { c.mode = 'original'; c.base = []; c.ref = []; }
    else if (v === 'duotone' || v === 'tritone') { c.mode = v; }
    else {
        const qty = parseInt(v, 10);
        if (c.mode === 'original' || c.mode === 'duotone' || c.mode === 'tritone' || !c.base.length) { c.mode = 'original'; c.base = []; c.ref = []; }
        else { const p = interpolatePalette(displayPalette(c), qty).map(rgbHex); c.base = p; c.ref = p.slice(); }
        c.hue = c.sat = c.light = 0;
    }
}
function toggleInvert() {
    const c = st.color; c.invert = !c.invert;
    const inv = (hx) => { const x = hexToRgb(hx); return rgbToHex(255 - x.r, 255 - x.g, 255 - x.b); };
    if (c.base.length) { c.base = displayPalette(c).map(rgbHex).map(inv); c.ref = c.ref.map(inv); c.hue = c.sat = c.light = 0; if (c.mode === 'original') c.mode = 'manual'; }
    change(null, null, { rebuild: true });
}
function paletteShuffleOrder() {
    const c = st.color; if (!c.base.length) return;
    const p = displayPalette(c).map(rgbHex); for (let i = p.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    c.base = p; c.hue = c.sat = c.light = 0; c.mode = 'manual'; change(null, null, { rebuild: true }); flashLabel('Cores embaralhadas');
}
function paletteFromPhoto() { const c = st.color; c.mode = 'original'; c.base = []; c.ref = []; c.invert = false; if (c.sel === 'all' || isNaN(+c.sel)) c.sel = '8'; change(null, null, { rebuild: true }); flashLabel('Paleta da foto'); }
function savePalette() {
    ask('Nome da paleta', 'Minha paleta', (name) => { prefs.palettes[name] = displayPalette(st.color).map(rgbHex); store.set('palettes', prefs.palettes); toast('Paleta salva'); buildPanel(); });
}
function applyPaletteList(list) { const c = st.color; c.base = list.slice(); c.ref = list.slice(); c.sel = String(list.length); c.mode = 'preset'; c.hue = c.sat = c.light = 0; change(null, null, { rebuild: true }); }
function paletteBars(ed, lib, onPick, deletable) {
    const row = h('div', 'palettes');
    Object.entries(lib).forEach(([name, cols]) => {
        const b = h('button', 'pal'); b.type = 'button';
        b.innerHTML = `<span class="bar">${cols.map(c => `<i style="background:${c}"></i>`).join('')}</span><span class="t">${name}</span>`;
        b.onclick = () => { onPick(cols); flashLabel(name); };
        if (deletable) b.oncontextmenu = (e) => { e.preventDefault(); delete prefs.palettes[name]; store.set('palettes', prefs.palettes); buildPanel(); toast('Paleta apagada'); };
        row.append(b);
    });
    ed.append(row);
}
function editPaletteLibrary(ed) {
    paletteBars(ed, PALETTE_LIBRARY, applyPaletteList);
    if (Object.keys(prefs.palettes).length) { ed.append(h('div', 'editor-note', 'Suas paletas (clique direito apaga)')); paletteBars(ed, prefs.palettes, applyPaletteList, true); }
}
function editDuoLibrary(ed) { paletteBars(ed, DUO_LIBRARY, (cols) => { st.color.duo = cols.slice(); change(null, null, { rebuild: true }); }); }
function editGradColors(ed) {
    const row = h('div', 'swatches');
    st.grad.colors.forEach((col, i) => {
        const b = h('button'); b.type = 'button'; b.style.background = col;
        b.onclick = () => pickColor(col, (hex, final) => { st.grad.colors[i] = hex; b.style.background = hex; change(null, null, { soft: !final }); }, 'Parada ' + (i + 1));
        row.append(b);
    });
    const add = h('button', 'add', icon('plus')); add.type = 'button'; add.title = 'Adicionar cor';
    add.onclick = () => { if (st.grad.colors.length < 8) { st.grad.colors.push(st.grad.colors[st.grad.colors.length - 1]); change(null, null); buildEditor({ kind: 'custom', editor: editGradColors }); } };
    const rem = h('button', 'add', icon('minus')); rem.type = 'button'; rem.title = 'Remover cor';
    rem.onclick = () => { if (st.grad.colors.length > 2) { st.grad.colors.pop(); change(null, null); buildEditor({ kind: 'custom', editor: editGradColors }); } };
    row.append(add, rem);
    ed.append(row, h('div', 'editor-note', 'Cores do degradê, da primeira à última.'));
}

// ---------- seletor de cor (próprio do app: igual em todo navegador e aparelho) ----------
const RECENT_KEY = 'pixelar.recentColors';
function recentColors() { try { const a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(a) ? a.filter(x => /^#[0-9A-F]{6}$/.test(x)).slice(0, 8) : []; } catch (e) { return []; } }
function pushRecent(hex) { try { localStorage.setItem(RECENT_KEY, JSON.stringify([hex, ...recentColors().filter(x => x !== hex)].slice(0, 8))); } catch (e) {} }
function imageColors(n) {
    const src = Thumbs.src; if (!src.width) return [];
    try {
        const d = src.getContext('2d').getImageData(0, 0, src.width, src.height).data, px = [];
        for (let i = 0; i < d.length; i += 4 * 23) px.push({ r: d[i], g: d[i + 1], b: d[i + 2] });
        return [...new Set(getMedianCut(px, n).map(c => rgbHex(c).toUpperCase()))];
    } catch (e) { return []; }
}
function hsvToHex(hh, s, v) {
    const f = n => { const k = (n + hh / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return rgbToHex(Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)).toUpperCase();
}
function hexToHsv(hex) {
    const { r, g, b } = hexToRgb(hex), R = r / 255, G = g / 255, B = b / 255;
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn;
    let hh = 0;
    if (d) hh = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
    return { h: (hh * 60 + 360) % 360, s: mx ? d / mx : 0, v: mx };
}
const BASIC_COLORS = ['#000000', '#FFFFFF', '#8E8E93', '#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#00C7BE', '#007AFF', '#5856D6', '#AF52DE', '#FF2D55'];
function pickColor(value, cb, label) {
    const start = /^#[0-9a-f]{6}$/i.test(value || '') ? value.toUpperCase() : '#000000';
    let cur = start, hsv = hexToHsv(start), raf = 0, touched = false;
    const emit = () => { touched = true; if (raf) return; raf = requestAnimationFrame(() => { raf = 0; cb(cur, false); }); };
    let sv, svKnob, hue, hueKnob, prevNew, hexIn;
    function paint(fromInput) {
        sv.style.background = `linear-gradient(to top, #000 11px, transparent calc(100% - 11px)), linear-gradient(to right, #fff 11px, transparent calc(100% - 11px)), hsl(${hsv.h} 100% 50%)`;
        svKnob.style.left = `calc(11px + ${hsv.s} * (100% - 22px))`; svKnob.style.top = `calc(11px + ${1 - hsv.v} * (100% - 22px))`; svKnob.style.background = cur;
        hueKnob.style.left = `calc(13px + ${hsv.h / 360} * (100% - 26px))`; hueKnob.style.background = `hsl(${hsv.h} 100% 50%)`;
        prevNew.style.background = cur;
        if (!fromInput) hexIn.value = cur.slice(1);
    }
    function set(hex, keepHue) {
        hex = hex.toUpperCase(); if (hex === cur && keepHue) return;
        const n = hexToHsv(hex); if (keepHue && (n.s === 0 || n.v === 0)) n.h = hsv.h;
        hsv = n; cur = hex; paint(); emit();
        sh().querySelectorAll('.cp-swatch').forEach(b => b.classList.toggle('on', b.dataset.c === cur));
    }
    const sh = () => $('sheet');
    const inset = el => el === hue ? 13 : 11;
    function drag(el, onMove) {
        el.addEventListener('pointerdown', e => {
            e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (_) {}
            const move = ev => { const r = el.getBoundingClientRect(), p = inset(el); onMove(Math.max(0, Math.min(1, (ev.clientX - r.left - p) / (r.width - 2 * p))), Math.max(0, Math.min(1, (ev.clientY - r.top - p) / (r.height - 2 * p)))); };
            const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
            el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
            move(e);
        });
    }
    function swatches(title, list) {
        const frag = [];
        list.forEach(c => { const b = h('button', 'cp-swatch' + (c === cur ? ' on' : '')); b.type = 'button'; b.dataset.c = c; b.style.background = c; b.title = title; b.setAttribute('aria-label', title + ' ' + c); b.onclick = () => set(c); frag.push(b); });
        return frag;
    }
    openSheet(s => {
        s.classList.add('color-sheet');
        sheetHead(s, label || 'Cor');
        sv = h('div', 'cp-sv'); svKnob = h('span', 'cp-knob'); sv.append(svKnob);
        sv.setAttribute('role', 'slider'); sv.setAttribute('aria-label', 'Saturação e brilho');
        drag(sv, (x, y) => { hsv.s = x; hsv.v = 1 - y; cur = hsvToHex(hsv.h, hsv.s, hsv.v); paint(); emit(); });
        hue = h('div', 'cp-hue'); hueKnob = h('span', 'cp-knob'); hue.append(hueKnob);
        hue.setAttribute('role', 'slider'); hue.setAttribute('aria-label', 'Matiz');
        drag(hue, x => { hsv.h = Math.min(359.9, x * 360); cur = hsvToHex(hsv.h, hsv.s, hsv.v); paint(); emit(); });
        const row = h('div', 'cp-row');
        const prev = h('div', 'cp-preview'), prevOld = h('button', 'cp-old'); prevNew = h('span', 'cp-new');
        prevOld.type = 'button'; prevOld.style.background = start; prevOld.title = 'Voltar à cor anterior'; prevOld.setAttribute('aria-label', 'Voltar à cor anterior'); prevOld.onclick = () => set(start);
        prev.append(prevOld, prevNew);
        const hexBox = h('label', 'cp-hex'); hexBox.append(h('span', '', '#'));
        hexIn = h('input'); hexIn.type = 'text'; hexIn.maxLength = 7; hexIn.spellcheck = false; hexIn.autocomplete = 'off'; hexIn.setAttribute('autocapitalize', 'characters'); hexIn.setAttribute('aria-label', 'Código hexadecimal');
        hexIn.oninput = () => { const v = hexIn.value.replace(/[^0-9a-f]/gi, '').slice(0, 6); if (v.length === 6) { const n = '#' + v.toUpperCase(); hsv = hexToHsv(n); cur = n; paint(true); emit(); } };
        hexIn.onblur = () => { hexIn.value = cur.slice(1); };
        hexIn.onkeydown = e => { if (e.key === 'Enter') { hexIn.blur(); closeSheet(); } };
        hexBox.append(hexIn);
        row.append(prev, hexBox);
        if (window.EyeDropper) {
            const eye = h('button', 'icon-btn round', icon('eyedropper')); eye.type = 'button'; eye.title = 'Conta-gotas'; eye.setAttribute('aria-label', 'Conta-gotas');
            eye.onclick = async () => { try { const r = await new EyeDropper().open(); if (r && r.sRGBHex) set(r.sRGBHex); } catch (e) {} };
            row.append(eye);
        }
        s.append(sv, hue, row);
        // uma única fileira: cores da imagem · recentes · básicas
        const strip = h('div', 'cp-strip');
        [swatches('Da imagem', imageColors(8)), swatches('Recente', recentColors()), swatches('Básica', BASIC_COLORS)].filter(g => g.length)
            .forEach((g, i) => { if (i) strip.append(h('span', 'cp-sep')); strip.append(...g); });
        s.append(strip);
        paint();
    }, () => {
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        setTimeout(() => $('sheetBackdrop').classList.remove('clear'), 330);
        if (cur !== start) pushRecent(cur);
        if (touched) cb(cur, true);
    });
    $('sheetBackdrop').classList.add('clear');
}
// ============================================================
// FOLHAS (sheets)
// ============================================================
let sheetClose = null;
function openSheet(build, onClose) {
    const sh = $('sheet'), bd = $('sheetBackdrop');
    sh.className = 'sheet' + (sh.classList.contains('show') ? ' show' : ''); bd.classList.remove('clear');
    sh.innerHTML = '<div class="grabber"></div>'; build(sh);
    sh.hidden = false; bd.hidden = false;
    void sh.offsetWidth; sh.classList.add('show'); bd.classList.add('show');   // reflow forçado: anima sem depender do próximo quadro
    sheetClose = onClose || null;
    const f = sh.querySelector('button, input'); if (f && matchMedia('(pointer:fine)').matches) f.focus({ preventScroll: true });
}
function closeSheet() {
    const sh = $('sheet'), bd = $('sheetBackdrop');
    if (sh.hidden) return;
    if (ui.busy) return;
    sh.classList.remove('show'); bd.classList.remove('show');
    const cb = sheetClose; sheetClose = null; if (cb) cb();
    setTimeout(() => { if (!sh.classList.contains('show')) { sh.hidden = true; bd.hidden = true; } }, 320);
}
$('sheetBackdrop').onclick = closeSheet;
function sheetHead(sh, title) {
    const hd = h('div', 'head'); hd.append(h('h2', '', title));
    const x = h('button', 'icon-btn round', icon('close')); x.type = 'button'; x.setAttribute('aria-label', 'Fechar'); x.onclick = closeSheet; hd.append(x);
    sh.append(hd);
}
function chipGroup(sh, title, options, cur, onPick) {
    if (title) sh.append(h('h3', '', title));
    const row = h('div', 'chips');
    options.forEach(([v, l]) => { const b = h('button', 'chip' + (String(v) === String(cur) ? ' on' : ''), l); b.type = 'button'; b.onclick = () => { row.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b)); onPick(v); }; row.append(b); });
    sh.append(row); return row;
}
function switchRow(label, on, cb, ic) {
    const b = h('button', 'menu-item'); b.type = 'button';
    b.innerHTML = (ic ? icon(ic) : '') + `<span>${label}</span><span class="switch${on ? ' on' : ''}"></span>`;
    b.onclick = () => { on = !on; b.querySelector('.switch').classList.toggle('on', on); cb(on); };
    return b;
}
function ask(title, def, cb) {
    openSheet((sh) => {
        sheetHead(sh, title);
        const inp = h('input'); inp.type = 'text'; inp.value = def; inp.maxLength = 40;
        inp.style.cssText = 'width:100%;height:46px;border-radius:12px;border:.5px solid var(--hair);background:var(--dial);color:var(--text);padding:0 14px;font:inherit;font-size:16px;margin-top:8px';
        const acts = h('div', 'actions'); const ok = h('button', 'pill primary', 'Salvar'); ok.type = 'button';
        const go = () => { const v = inp.value.trim(); if (!v) return; closeSheet(); cb(v); };
        ok.onclick = go; inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
        acts.append(ok); sh.append(inp, acts);
        setTimeout(() => { inp.focus(); inp.select(); }, 300);
    });
}
function saveUserPreset() {
    if (!M.el) return;
    ask('Nome do estilo', 'Meu estilo ' + (Object.keys(prefs.presets).length + 1), (name) => {
        const s = deepClone(st); delete s.crop; prefs.presets[name] = s; store.set('presets', prefs.presets);
        toast('Estilo salvo em “Meus”');
        if (ui.tab === 'estilos') buildPanel();
    });
}

function openMore() {
    openSheet((sh) => {
        sheetHead(sh, 'Mais');
        const list = h('div', 'menu-list');
        const item = (ic, label, fn, sub) => { const b = h('button', 'menu-item', icon(ic) + `<span>${label}</span>` + (sub ? `<span class="sub">${sub}</span>` : '')); b.type = 'button'; b.onclick = () => { closeSheet(); setTimeout(fn, 200); }; list.append(b); };
        item('photo', 'Abrir outra foto ou vídeo', () => $('fileInput').click());
        item('heart', 'Salvar como estilo', saveUserPreset);
        item('file', 'Importar configurações', () => $('configInput').click(), 'PNG ou TXT do Pixelar');
        item('dice', 'O que o aleatório muda', openRandomSettings);
        item('reset', 'Restaurar tudo', () => { const before = snapshot(); st = freshState(); Engine.invalidate(); afterExternalChange(); commit(true); toast('Tudo restaurado', { label: 'Desfazer', run: () => { restore(before); commit(true); } }); });
        const th = document.documentElement.dataset.theme || 'auto';
        item(th === 'dark' ? 'moon' : 'sun', 'Tema', () => { const next = th === 'auto' ? 'light' : th === 'light' ? 'dark' : 'auto'; setTheme(next); toast('Tema: ' + { auto: 'automático', light: 'claro', dark: 'escuro' }[next]); }, { auto: 'Automático', light: 'Claro', dark: 'Escuro' }[th]);
        const gl = document.documentElement.dataset.glass || 'default', GL = { default: 'Padrão', clear: 'Transparente', tinted: 'Tingido' };
        item('sparkle', 'Vidro', () => { const next = gl === 'default' ? 'clear' : gl === 'clear' ? 'tinted' : 'default'; setGlass(next); toast('Vidro: ' + GL[next].toLowerCase()); }, GL[gl]);
        item('keyboard', 'Atalhos de teclado', openShortcuts);
        sh.append(list, h('p', 'note', 'Pixelar Studio · tudo roda no seu navegador, nenhuma foto sai do aparelho.'));
    });
}
function setGlass(g) { if (g === 'default') delete document.documentElement.dataset.glass; else document.documentElement.dataset.glass = g; try { localStorage.setItem('pixelar.glass', g); } catch (e) {} }
function setTheme(t) { if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t; store.set('theme', t); try { localStorage.setItem('pixelar.theme', t); } catch (e) {} }
function openRandomSettings() {
    openSheet((sh) => {
        sheetHead(sh, 'Aleatório');
        sh.append(h('p', 'note', 'Escolha o que o dado pode mudar. Dica: segure qualquer botão de ajuste para travá-lo individualmente.'));
        const list = h('div', 'menu-list'); list.style.marginTop = '12px';
        Object.entries(RANDOM_GROUPS).forEach(([k, label]) => list.append(switchRow(label, prefs.groups.has(k), (on) => { if (on) prefs.groups.add(k); else prefs.groups.delete(k); store.set('randGroups', [...prefs.groups]); })));
        sh.append(list);
        if (prefs.locks.size) { const b = h('button', 'pill', `Destravar ${prefs.locks.size} controle${prefs.locks.size > 1 ? 's' : ''}`); b.type = 'button'; b.style.marginTop = '14px'; b.onclick = () => { prefs.locks.clear(); store.set('locks', []); refreshDials(); closeSheet(); toast('Tudo destravado'); }; sh.append(b); }
    });
}
function openShortcuts() {
    openSheet((sh) => {
        sheetHead(sh, 'Atalhos');
        const g = h('div', 'shortcuts');
        [['R', 'Aleatório'], ['Espaço', 'Tocar / parar animação ou vídeo'], ['O (segurar)', 'Ver o original'], ['C', 'Comparar lado a lado'], ['⌘Z / ⇧⌘Z', 'Desfazer / refazer'], ['⌘E', 'Exportar'], ['⌘O', 'Abrir arquivo'], ['1 – 4', 'Trocar de aba'], ['← →', 'Ajustar a régua ativa (⇧ = 10×)'], ['+ / − / 0', 'Zoom / encaixar'], ['P', 'Mostrar / esconder os controles']].forEach(([k, d]) => { g.append(h('kbd', '', k), h('span', '', d)); });
        sh.append(g);
    });
}

// ============================================================
// EXPORTAR
// ============================================================
const exp = store.get('export', { tab: 'image', format: 'png', res: 0, aFormat: 'mp4', aRes: 720, aRepeat: 1, vFormat: 'mp4', vRes: 1080, vFps: 30, audio: true, vAnim: true });
const saveExp = () => store.set('export', exp);
function openExport() {
    if (!M.el) return;
    stopAnimPreview();
    openSheet((sh) => {
        sheetHead(sh, 'Exportar');
        if (M.type === 'image') {
            const seg = h('div', 'chips'); seg.style.padding = '0';
            [['image', 'Imagem'], ['anim', 'Animação']].forEach(([v, l]) => { const b = h('button', 'chip' + (exp.tab === v ? ' on' : ''), l); b.type = 'button'; b.onclick = () => { exp.tab = v; saveExp(); closeSheetFast(); openExport(); }; seg.append(b); });
            sh.append(seg);
            if (exp.tab === 'anim') exportAnimForm(sh); else exportImageForm(sh);
        } else exportVideoForm(sh);
    }, stopAnimPreview);
}
function closeSheetFast() { const sh = $('sheet'); sh.classList.remove('show'); sh.hidden = true; $('sheetBackdrop').hidden = true; $('sheetBackdrop').classList.remove('show'); stopAnimPreview(); }
function exportImageForm(sh) {
    chipGroup(sh, 'Formato', [['png', 'PNG'], ['jpeg', 'JPEG'], ['webp', 'WebP'], ['svg', 'SVG vetor']], exp.format, (v) => { exp.format = v; saveExp(); note.textContent = fmtNote(); });
    const r = lastRender;
    chipGroup(sh, 'Tamanho', [[0, 'Original'], ['px', `Pixel real (${r ? r.h : ''}px)`], [720, '720p'], [1080, '1080p'], [1440, '1440p'], [2160, '4K']], exp.res, (v) => { exp.res = v; saveExp(); });
    const note = h('p', 'note', ''); const fmtNote = () => exp.format === 'png' ? 'O PNG leva as configurações junto: abra no Pixelar para continuar editando.' : exp.format === 'svg' ? 'SVG vira um retângulo por faixa de cor: ideal para pixel art com poucas cores.' : ''; note.textContent = fmtNote();
    sh.append(note);
    const acts = h('div', 'actions');
    const cfg = h('button', 'pill', icon('file') + 'Configurações'); cfg.type = 'button'; cfg.onclick = () => { Exporter.config(st); toast('Configurações salvas'); };
    const go = h('button', 'pill primary', icon('download') + 'Salvar imagem'); go.type = 'button';
    go.onclick = async () => {
        const res = exp.res === 'px' ? (lastRender ? lastRender.h : null) : (+exp.res || null);
        try { const blob = exp.format === 'svg' ? await Exporter.svg(st, M.el, { res, key: 'main' + M.serial }) : await Exporter.image(st, M.el, { res, format: exp.format, key: 'main' + M.serial }); closeSheet(); doneToast(blob, exp.format === 'svg' ? 'svg' : exp.format); }
        catch (e) { toast(e.message || 'Não foi possível exportar'); }
        requestRender();
    };
    acts.append(cfg, go); sh.append(acts);
    if (navigator.clipboard && window.ClipboardItem) {
        const cp = h('button', 'pill', icon('copy') + 'Copiar imagem'); cp.type = 'button'; cp.style.cssText = 'width:100%;margin-top:10px;height:44px';
        cp.onclick = async () => { try { const c = document.createElement('canvas'); Engine.render(st, { media: M.el, key: 'main' + M.serial, out: { canvas: c, ctx: c.getContext('2d') }, maxDim: 2000 }); const blob = await new Promise(r => c.toBlob(r, 'image/png')); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); toast('Imagem copiada'); } catch (e) { toast('O navegador não deixou copiar'); } requestRender(); };
        sh.append(cp);
    }
}
let previewRaf = 0;
function stopAnimPreview() { cancelAnimationFrame(previewRaf); previewRaf = 0; }
function exportAnimForm(sh) {
    const s = Engine.readSettings(st), parts = describeAnimation(s, readAnim(st, exp.aFormat));
    const pv = h('div', 'export-preview'), pc = h('canvas'); pv.append(pc); sh.append(pv);
    sh.append(h('p', 'note', parts.length ? 'Movimento: ' + parts.join(' + ') + '.' : 'Nada se move ainda. Ajuste na aba Movimento (ou ligue um padrão, filme ou grão).'));
    chipGroup(sh, 'Formato', [['mp4', 'MP4'], ['webm', 'WebM'], ['gif', 'GIF']], exp.aFormat, (v) => { exp.aFormat = v; saveExp(); });
    chipGroup(sh, 'Duração', [[1, '1 s'], [2, '2 s'], [3, '3 s'], [4, '4 s'], [6, '6 s'], [8, '8 s']], st.anim.duration, (v) => { st.anim.duration = +v; commit(); });
    chipGroup(sh, 'Repetir o loop', [[1, '1×'], [3, '3×'], [5, '5×'], [10, '10×']], exp.aRepeat, (v) => { exp.aRepeat = +v; saveExp(); });
    chipGroup(sh, 'Altura', [[360, '360p'], [480, '480p'], [720, '720p'], [1080, '1080p'], [0, 'Tela']], exp.aRes, (v) => { exp.aRes = +v; saveExp(); });
    const acts = h('div', 'actions'); const go = h('button', 'pill primary', icon('download') + 'Exportar animação'); go.type = 'button'; go.disabled = !parts.length;
    go.onclick = () => runExport('Animação', (job) => Exporter.animation(st, M.el, Object.assign(job, { format: exp.aFormat, res: exp.aRes || null, repeat: exp.aRepeat, key: 'main' + M.serial })), exp.aFormat);
    acts.append(go); sh.append(acts);
    // prévia ao vivo em baixa resolução
    if (parts.length) {
        const out = { canvas: document.createElement('canvas') }; out.ctx = out.canvas.getContext('2d'); const pctx = pc.getContext('2d'); const t0 = performance.now();
        const tick = () => {
            const cfg = readAnim(st), s2 = Engine.readSettings(st), i = Math.floor(((performance.now() - t0) / 1000) * cfg.fps) % cfg.frames;
            const r = Engine.render(st, Object.assign({ media: M.el, key: 'main' + M.serial, out, targetRes: 240 }, animFrameOptions(i, cfg, s2)));
            if (r) { const k = Math.min(420 / r.W, 220 / r.H); const w = Math.round(r.W * k), hh = Math.round(r.H * k); if (pc.width !== w || pc.height !== hh) { pc.width = w; pc.height = hh; } pctx.imageSmoothingEnabled = false; pctx.drawImage(out.canvas, 0, 0, w, hh); }
            previewRaf = requestAnimationFrame(tick);
        };
        tick();
    }
}
function exportVideoForm(sh) {
    const H = video.videoHeight || 1080;
    const resOpts = [[360, '360p'], [480, '480p'], [720, '720p'], [1080, '1080p'], [1440, '1440p'], [2160, '4K']].filter(([v]) => v <= Math.max(360, H * 2));
    if (!resOpts.some(o => o[0] === exp.vRes)) exp.vRes = resOpts.reduce((a, o) => Math.abs(o[0] - H) < Math.abs(a - H) ? o[0] : a, resOpts[0][0]);
    chipGroup(sh, 'Formato', [['mp4', 'MP4'], ['webm', 'WebM'], ['gif', 'GIF (até 15 s)']], exp.vFormat, (v) => { exp.vFormat = v; saveExp(); });
    chipGroup(sh, 'Altura', resOpts, exp.vRes, (v) => { exp.vRes = +v; saveExp(); });
    chipGroup(sh, 'Quadros por segundo', [[24, '24'], [30, '30'], [60, '60']], exp.vFps, (v) => { exp.vFps = +v; saveExp(); });
    const list = h('div', 'menu-list'); list.style.marginTop = '14px';
    list.append(switchRow('Manter o som', exp.audio, (on) => { exp.audio = on; saveExp(); }, 'volume'));
    if (animOn()) list.append(switchRow('Aplicar movimento', exp.vAnim, (on) => { exp.vAnim = on; saveExp(); }, 'motion'));
    sh.append(list);
    const [a, b] = M.trim, full = b - a >= M.duration - 0.05;
    sh.append(h('p', 'note', full ? `Vídeo inteiro · ${fmtTime(M.duration)}` : `Trecho ${fmtTime(a)} – ${fmtTime(b)} (${fmtTime(b - a)})`));
    const acts = h('div', 'actions'); const go = h('button', 'pill primary', icon('download') + 'Exportar vídeo'); go.type = 'button';
    go.onclick = () => {
        pauseVideo();
        runExport('Vídeo', (job) => Exporter.video(st, M.blob, Object.assign(job, { format: exp.vFormat, res: exp.vRes, fps: exp.vFps, mute: !exp.audio, withAnim: exp.vAnim && st.anim.videoSync, trim: full ? null : [a, b] })), exp.vFormat);
    };
    acts.append(go); sh.append(acts);
}
function runExport(title, fn, ext) {
    closeSheetFast();
    const job = { cancelled: false, progress: () => {} };
    let ringCanvas;
    openSheet((sh) => {
        const ring = h('div', 'progress-ring');
        ring.innerHTML = '<svg viewBox="0 0 132 132"><circle class="bg" cx="66" cy="66" r="60"/><circle class="fg" cx="66" cy="66" r="60"/></svg>';
        ringCanvas = h('canvas'); ring.append(ringCanvas); const pct = h('div', 'pct', '0%'); ring.append(pct);
        const fg = ring.querySelector('.fg'), Cc = 2 * Math.PI * 60; fg.style.strokeDasharray = Cc; fg.style.strokeDashoffset = Cc;
        const sub = h('div', 'busy-sub', 'Preparando…');
        const cancel = h('button', 'pill', 'Cancelar'); cancel.type = 'button'; cancel.style.cssText = 'display:flex;margin:16px auto 0';
        cancel.onclick = () => { job.cancelled = true; sub.textContent = 'Cancelando…'; };
        sh.append(ring, h('div', 'busy-title', `Exportando ${title.toLowerCase()}`), sub, cancel);
        const rctx = ringCanvas.getContext('2d'); const t0 = performance.now();
        job.progress = (p, frame) => {
            fg.style.strokeDashoffset = Cc * (1 - p); pct.textContent = Math.round(p * 100) + '%';
            if (frame && frame.width) { const s = 108; if (ringCanvas.width !== s) { ringCanvas.width = s; ringCanvas.height = s; } const k = Math.max(s / frame.width, s / frame.height); rctx.imageSmoothingEnabled = false; rctx.drawImage(frame, (s - frame.width * k) / 2, (s - frame.height * k) / 2, frame.width * k, frame.height * k); }
            const el = (performance.now() - t0) / 1000; if (p > 0.03) sub.textContent = `faltam ~${Math.max(1, Math.round(el / p - el))} s`;
        };
    });
    ui.busy = true;
    Promise.resolve().then(() => fn(job)).then((res) => {
        ui.busy = false; closeSheet();
        const blob = res && res.blob ? res.blob : res;
        doneToast(blob, ext);
        if (res && res.blob && !res.hasAudio && exp.audio) setTimeout(() => toast('Este vídeo foi exportado sem som (o original não tinha áudio ou o codec não é suportado).'), 1200);
    }).catch((e) => {
        ui.busy = false; closeSheet();
        if (e && e.message === 'cancelado') toast('Exportação cancelada'); else { console.error(e); toast((e && e.message) || 'Falha na exportação'); }
    }).finally(() => { ui.busy = false; requestRender(); });
}
function doneToast(blob, ext) {
    if (!blob) return;
    const mime = blob.type || 'application/octet-stream';
    const file = new File([blob], `pixelar.${ext === 'jpeg' ? 'jpg' : ext}`, { type: mime });
    const canShare = navigator.canShare && navigator.canShare({ files: [file] });
    toast(`Pronto! ${(blob.size / 1048576).toFixed(blob.size > 1048576 ? 1 : 2)} MB salvos`, canShare ? { label: 'Compartilhar', run: () => navigator.share({ files: [file] }).catch(() => {}) } : null, 5000);
}

// ============================================================
// MÍDIA
// ============================================================
function fmtTime(t) { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; }
let loadToken = 0;
async function openFile(file) {
    if (!file) return;
    if (ui.busy) { toast('Aguarde a exportação terminar'); return; }
    const token = ++loadToken;
    if (Media.isVideoFile(file)) return openVideo(file, token);
    // PNG exportado pelo Pixelar traz as configurações no final do arquivo
    const tail = await file.slice(Math.max(0, file.size - 60000)).text().catch(() => '');
    const meta = parseMeta(tail);
    let bmp;
    try { bmp = await loadImage(file); } catch (e) { toast('Não foi possível abrir esta imagem'); return; }
    if (token !== loadToken) return;
    setMedia('image', bmp, file.name);
    if (meta) { st = meta; afterExternalChange(); commit(true); toast('Configurações do Pixelar recuperadas desta imagem'); }
}
function loadImage(file) {
    return new Promise((res, rej) => { const url = URL.createObjectURL(file); const img = new Image(); img.decoding = 'async'; img.onload = () => { res(img); }; img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('img')); }; img.src = url; });
}
function setMedia(type, el, name) {
    stopAnim(); pauseVideo();
    M.type = type; M.el = el; M.name = name || ''; M.serial++;
    if (type === 'image') { $('videoBar').hidden = true; video.removeAttribute('src'); }
    // paleta automática é recalculada para a nova mídia; o recorte volta ao original
    if (st.color.mode === 'original') { st.color.base = []; st.color.ref = []; }
    st.crop = deepClone(DEFAULT_STATE.crop);
    Engine.invalidate();
    app.classList.remove('is-welcome'); $('btnExport').disabled = false;
    M.analysis = analyzeMedia(el);
    Thumbs.setSource(el, true);
    ui.surprise = []; ui.musePick = null; ui.museParent = null;
    lastRender = null; view.zoom = 1; view.x = view.y = 0;
    hist.stack = []; hist.i = -1;
    stage.classList.remove('developing'); void stage.offsetWidth; stage.classList.add('developing');
    renderMain(); fitView(true); pushHistory();
    buildPanel(); updateSubbarCenter(); markTabs(); $('toolTitle').textContent = currentTab().label;
    if (ui.tab === 'estilos' && type === 'image') flashLabel(name ? name.replace(/\.[^.]+$/, '') : 'Imagem', 1400);
}
async function openVideo(file, token) {
    let blob = file;
    try {
        let busySheet = false;
        const progress = (p) => { if (!busySheet) { busySheet = true; showBusy('Preparando vídeo', file.name); } updateBusy(p); };
        const note = (t) => { if (!busySheet) { busySheet = true; showBusy('Preparando vídeo', t); } else setBusySub(t); };
        blob = await Media.prepareVideoBlob(file, progress, note);
        if (busySheet) { ui.busy = false; closeSheet(); }
    } catch (e) { ui.busy = false; closeSheet(); console.error(e); toast('Não foi possível abrir este vídeo (formato ou codec não suportado)'); return; }
    if (token !== loadToken) return;
    if (M.url) URL.revokeObjectURL(M.url);
    M.blob = blob; M.url = URL.createObjectURL(blob);
    video.muted = true; video.src = M.url; video.load();
    await new Promise((res) => { video.onloadeddata = res; video.onerror = () => { toast('O navegador não conseguiu reproduzir este vídeo'); res(); }; });
    if (token !== loadToken || !video.videoWidth) return;
    M.duration = video.duration || 0; M.trim = [0, M.duration];
    video.currentTime = 0.001;
    await new Promise(r => { video.onseeked = r; setTimeout(r, 800); });
    setMedia('video', video, file.name);
    $('videoBar').hidden = false;
    buildFilmstrip();
    video.muted = prefs.muted; updateVideoButtons();
    Media.prefetch();
}
// folha de "ocupado" genérica (conversão de vídeo)
let busyEls = null;
function showBusy(title, sub) {
    openSheet((sh) => {
        const ring = h('div', 'progress-ring'); ring.innerHTML = '<svg viewBox="0 0 132 132"><circle class="bg" cx="66" cy="66" r="60"/><circle class="fg" cx="66" cy="66" r="60"/></svg>';
        const pct = h('div', 'pct', ''); pct.style.color = 'var(--text)'; pct.style.textShadow = 'none'; ring.append(pct);
        const fg = ring.querySelector('.fg'), Cc = 2 * Math.PI * 60; fg.style.strokeDasharray = Cc; fg.style.strokeDashoffset = Cc;
        const s = h('div', 'busy-sub', sub || '');
        sh.append(ring, h('div', 'busy-title', title), s);
        busyEls = { fg, Cc, pct, s };
    });
    ui.busy = true;
}
function updateBusy(p) { if (!busyEls) return; busyEls.fg.style.strokeDashoffset = busyEls.Cc * (1 - p); busyEls.pct.textContent = Math.round(p * 100) + '%'; }
function setBusySub(t) { if (busyEls) busyEls.s.textContent = t; }

// ---------- vídeo: tocar, linha do tempo e recorte ----------
let vRaf = 0, lastVT = -1;
function playVideo() {
    if (M.type !== 'video') return;
    if (video.currentTime >= M.trim[1] - 0.05 || video.currentTime < M.trim[0]) video.currentTime = M.trim[0];
    video.muted = prefs.muted;
    video.play().catch(() => { video.muted = true; video.play().catch(() => {}); });
    const loop = () => {
        if (video.paused) { vRaf = 0; updateVideoButtons(); return; }
        if (video.currentTime >= M.trim[1]) video.currentTime = M.trim[0];
        if (video.currentTime !== lastVT) { lastVT = video.currentTime; renderMain(); updatePlayhead(); }
        vRaf = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(vRaf); vRaf = requestAnimationFrame(loop); updateVideoButtons();
}
function pauseVideo() { if (M.type === 'video' && !video.paused) video.pause(); cancelAnimationFrame(vRaf); vRaf = 0; updateVideoButtons(); }
function updateVideoButtons() {
    $('btnVideoPlay').innerHTML = icon(video.paused ? 'play' : 'pause');
    $('btnVideoMute').innerHTML = icon(prefs.muted ? 'mute' : 'volume');
    updateSubbarCenter();
}
let thumbSrcTimer = 0;
video.addEventListener('seeked', () => {
    if (M.type !== 'video' || !video.paused) return;
    renderMain(); updatePlayhead();
    clearTimeout(thumbSrcTimer); thumbSrcTimer = setTimeout(() => { if (video.paused) Thumbs.setSource(video, true); }, 500);
});
$('btnVideoPlay').onclick = () => video.paused ? playVideo() : pauseVideo();
$('btnVideoMute').onclick = () => { prefs.muted = !prefs.muted; store.set('muted', prefs.muted); video.muted = prefs.muted; updateVideoButtons(); };
function updatePlayhead() {
    const fs = $('filmstrip'); if (!M.duration) return;
    $('playhead').style.left = (video.currentTime / M.duration * fs.clientWidth) + 'px';
}
function updateTrimBox() {
    const box = $('trimBox'), w = $('filmstrip').clientWidth;
    box.style.left = (M.trim[0] / M.duration * w) + 'px'; box.style.right = ((1 - M.trim[1] / M.duration) * w) + 'px';
}
async function buildFilmstrip() {
    const frames = $('stripFrames'); frames.innerHTML = '';
    const w = $('filmstrip').clientWidth || 300, ar = video.videoWidth / video.videoHeight, n = clampN(Math.round(w / (44 * ar)), 4, 16);
    const cells = Array.from({ length: n }, () => { const s = h('span'); frames.append(s); return s; });
    updateTrimBox(); updatePlayhead();
    const v2 = document.createElement('video'); v2.muted = true; v2.src = M.url; v2.preload = 'auto';
    await new Promise(r => { v2.onloadeddata = r; v2.onerror = r; });
    const my = M.serial;
    for (let i = 0; i < n; i++) {
        if (my !== M.serial) return;
        await new Promise(r => { v2.onseeked = r; v2.currentTime = Math.min(M.duration - 0.05, (i + 0.5) / n * M.duration); setTimeout(r, 1500); });
        const c = document.createElement('canvas'); c.height = 88; c.width = Math.round(88 * ar); c.getContext('2d').drawImage(v2, 0, 0, c.width, c.height);
        cells[i].replaceWith(c);
    }
    v2.removeAttribute('src'); v2.load();
}
(() => {
    const fs = $('filmstrip'); let mode = null;
    const tAt = (x) => clampN((x - fs.getBoundingClientRect().left) / fs.clientWidth, 0, 1) * M.duration;
    fs.addEventListener('pointerdown', (e) => {
        if (M.type !== 'video') return;
        fs.setPointerCapture(e.pointerId);
        mode = e.target.id === 'trimL' ? 'l' : e.target.id === 'trimR' ? 'r' : 'seek';
        if (mode === 'seek') { pauseVideo(); video.currentTime = clampN(tAt(e.clientX), M.trim[0], M.trim[1]); }
    });
    fs.addEventListener('pointermove', (e) => {
        if (!mode) return; const t = tAt(e.clientX);
        if (mode === 'seek') video.currentTime = clampN(t, M.trim[0], M.trim[1]);
        else if (mode === 'l') { M.trim[0] = clampN(t, 0, M.trim[1] - 0.3); video.currentTime = M.trim[0]; updateTrimBox(); }
        else { M.trim[1] = clampN(t, M.trim[0] + 0.3, M.duration); video.currentTime = M.trim[1] - 0.02; updateTrimBox(); }
        updatePlayhead();
    });
    const up = () => { if (mode === 'l' || mode === 'r') flashLabel(`Trecho ${fmtTime(M.trim[0])} – ${fmtTime(M.trim[1])}`); mode = null; };
    fs.addEventListener('pointerup', up); fs.addEventListener('pointercancel', up);
    new ResizeObserver(() => { if (M.type === 'video') { updateTrimBox(); updatePlayhead(); } }).observe(fs);
})();

// ---------- animação na imagem ----------
function togglePlay() { if (M.type === 'video') { video.paused ? playVideo() : pauseVideo(); return; } anim.playing ? stopAnim() : startAnim(); }
// ▶ numa imagem sem nada que se mova: liga o movimento dos efeitos existentes
// ou, numa foto limpa, acrescenta um grão vivo discreto (com Desfazer), em vez de não fazer nada
function makeAnimatable() {
    const before = snapshot(), a = st.anim;
    if (a.amount <= 0) a.amount = 100;
    a.dither = true; a.fx = true; a.grain = true; a.film = true;
    if (!a.dAmt) a.dAmt = 100; if (!a.fxAmt) a.fxAmt = 100; if (!a.grainAmt) a.grainAmt = 100; if (!a.filmAmt) a.filmAmt = 100;
    if (a.grainStyle === 'frozen') a.grainStyle = 'live';
    let msg = 'Movimento ligado';
    if (!animOn()) { st.grain.amount = Math.max(st.grain.amount, 16); msg = 'Grão vivo adicionado para animar'; }
    if (!animOn()) { restore(before); return false; }
    afterExternalChange(); commit(true);
    toast(msg, { label: 'Desfazer', run: () => { stopAnim(); restore(before); commit(true); } });
    return true;
}
function startAnim() {
    if (M.type !== 'image') return;
    if (!animOn() && !makeAnimatable()) { toast('Nada para animar ainda', { label: 'Configurar', run: () => selectTab('movimento') }); return; }
    anim.playing = true; anim.t0 = performance.now();
    const tick = () => { if (!anim.playing) return; renderMain(); anim.raf = requestAnimationFrame(tick); };
    anim.raf = requestAnimationFrame(tick);
    updateSubbarCenter(); if (ui.tab === 'movimento') buildPanel();
}
function stopAnim() {
    if (!anim.playing) return;
    anim.playing = false; cancelAnimationFrame(anim.raf); requestRender();
    updateSubbarCenter(); if (ui.tab === 'movimento') buildPanel();
}
function updateSubbarCenter() {
    const c = $('subbarCenter'); c.innerHTML = '';
    if (!M.el) return;
    if (M.type === 'image') {
        const g = h('div', 'glass-group glass'); const b = h('button', 'icon-btn' + (anim.playing ? ' on' : ''), icon(anim.playing ? 'pause' : 'play')); b.type = 'button';
        b.title = anim.playing ? 'Parar animação (espaço)' : 'Ver animação (espaço)'; b.setAttribute('aria-label', b.title);
        b.onclick = togglePlay; g.append(b); c.append(g);
    }
}

// ============================================================
// ALEATÓRIO GLOBAL
// ============================================================
function rollDice() {
    try { rollDiceUnsafe(); } catch (e) { console.error('[Pixelar] aleatório falhou:', e); toast('Não foi possível sortear agora. Tente de novo.'); }
}
function rollDiceUnsafe() {
    if (!M.el) return;
    const before = snapshot();
    const dice = $('btnDice'); dice.classList.remove('rolling'); void dice.offsetWidth; dice.classList.add('rolling');
    // o dado usa o Muse: a melhor de um lote pensado para esta foto (e diferente das últimas)
    const A = museAnalysis(); let label = 'Nova combinação';
    if (A) {
        const [v] = Muse.generate(A, st, { n: 1, pool: 48, wild: true, long: museLong(), locks: prefs.locks });
        const next = normalizeState(deepClone(v.state));
        // o que a pessoa desligou em “O que o aleatório muda” continua como estava
        const KEEP = { luz: ['adj'], pixel: ['pixel'], dither: ['dither'], palette: ['color'], edge: ['edge'], fx: ['fx', 'fxParams'], grain: ['grain'], film: ['film'], grad: ['grad'] };
        Object.keys(KEEP).forEach(g => { if (!prefs.groups.has(g)) KEEP[g].forEach(k => { next[k] = deepClone(st[k]); }); });
        if (prefs.groups.has('anim')) randAnim(next.anim);
        st = next; Engine.invalidate(); label = v.name;
    } else randomize(st, M.analysis, prefs.groups, prefs.locks);
    afterExternalChange(); commit(true);
    toast(label, { label: 'Desfazer', run: () => { restore(before); commit(true); } });
    if (M.type === 'image' && prefs.groups.has('anim') && anim.playing && !animOn()) stopAnim();
}

// ============================================================
// IMAGEM DE EXEMPLO (só para testes: Pixelar.openSample no console)
// ============================================================

function openSample() { const c = makeSampleImage(); setMedia('image', c, 'Exemplo'); }

// ============================================================
// ENTRADAS: botões, arquivo, arrastar, colar, teclado
// ============================================================
if (typeof LiquidGlass !== 'undefined') LiquidGlass.init();
$('btnUndo').innerHTML = icon('undo'); $('btnRedo').innerHTML = icon('redo');
$('btnOpen').insertAdjacentHTML('afterbegin', icon('photo')); $('btnExport').insertAdjacentHTML('afterbegin', icon('share')); $('btnPanel').innerHTML = icon('sidebar');
// ---------- controles recolhíveis (mais espaço para a imagem) ----------
let panelCollapsed = false;
// ---------- área livre para a imagem ----------
// A imagem ocupa a tela toda por baixo do vidro; ela é encaixada no espaço que sobra entre
// a barra do topo e a base (celular) ou o cartão lateral (computador). Medido, nunca estimado.
function updateInsets() {
    const cs = getComputedStyle(app), m = parseFloat(cs.getPropertyValue('--m')) || 8;
    const W = app.clientWidth, H = app.clientHeight;
    const tb = $('topbar'), top = tb.offsetTop + tb.offsetHeight + m;   // offsets ignoram animações (transform)
    let r = m, b = m, l = m;
    const side = matchMedia('(min-width: 900px), (orientation: landscape) and (max-height: 540px) and (min-width: 560px)').matches;
    const vb = $('videoBar'), vbOn = !vb.hidden && !app.classList.contains('is-welcome');
    if (side) {
        if (!panelCollapsed) r = W - $('dock').offsetLeft + m;
        if (vbOn) b = H - vb.getBoundingClientRect().top + m;
    } else {
        b = H - (panelCollapsed ? $('btnRestore').offsetTop : $('dock').offsetTop) + m;
    }
    const st = app.style;
    st.setProperty('--vp-t', Math.round(top) + 'px'); st.setProperty('--vp-r', Math.round(r) + 'px');
    st.setProperty('--vp-b', Math.round(b) + 'px'); st.setProperty('--vp-l', Math.round(l) + 'px');
}
{
    const ro = new ResizeObserver(() => updateInsets());
    ['topbar', 'dock', 'videoBar'].forEach(id => ro.observe($(id)));
    addEventListener('resize', updateInsets);
    new MutationObserver(updateInsets).observe($('videoBar'), { attributes: true, attributeFilter: ['hidden'] });
}
function setPanelCollapsed(on, save = true) {
    panelCollapsed = !!on;
    app.classList.toggle('panel-collapsed', panelCollapsed);
    const hd = $('panelHandle'); hd.setAttribute('aria-expanded', String(!panelCollapsed)); hd.setAttribute('aria-label', panelCollapsed ? 'Mostrar controles' : 'Recolher controles');
    $('btnPanel').classList.toggle('on', !panelCollapsed);
    if (save) store.set('panelCollapsed', panelCollapsed);
    // no computador o cartão desliza para fora: a imagem acompanha com a mesma curva
    app.classList.add('fit-anim'); clearTimeout(app._fa); app._fa = setTimeout(() => app.classList.remove('fit-anim'), 600);
    updateInsets();
}
(() => {
    const hd = $('panelHandle'); let y0 = null, moved = false;
    hd.addEventListener('pointerdown', (e) => { y0 = e.clientY; moved = false; try { hd.setPointerCapture(e.pointerId); } catch (_) {} });
    hd.addEventListener('pointermove', (e) => {
        if (y0 === null) return; const dy = e.clientY - y0;
        if (Math.abs(dy) > 18) { moved = true; setPanelCollapsed(dy > 0); y0 = null; }
    });
    hd.addEventListener('pointerup', () => { if (y0 !== null && !moved) setPanelCollapsed(!panelCollapsed); y0 = null; });
    hd.addEventListener('pointercancel', () => { y0 = null; });
    hd.addEventListener('click', (e) => { if (e.detail === 0) setPanelCollapsed(!panelCollapsed); });   // teclado (Enter/Espaço)
    $('btnPanel').onclick = () => setPanelCollapsed(!panelCollapsed);
    // puxador que sobra ao recolher: toque ou deslize para cima traz os controles de volta
    const rs = $('btnRestore'); let ry = null;
    rs.insertAdjacentHTML('afterbegin', icon('chevron'));
    rs.querySelector('.ic').style.transform = 'rotate(-90deg)';
    rs.addEventListener('pointerdown', (e) => { ry = e.clientY; try { rs.setPointerCapture(e.pointerId); } catch (_) {} });
    rs.addEventListener('pointermove', (e) => { if (ry !== null && ry - e.clientY > 14) { ry = null; setPanelCollapsed(false); } });
    rs.addEventListener('pointerup', () => { if (ry !== null) setPanelCollapsed(false); ry = null; });
    rs.addEventListener('pointercancel', () => { ry = null; });
    rs.addEventListener('click', (e) => { if (e.detail === 0) setPanelCollapsed(false); });
    setPanelCollapsed(store.get('panelCollapsed', false), false);
})();
$('btnCompare').innerHTML = icon('compare'); $('btnDice').innerHTML = icon('dice'); $('btnMore').innerHTML = icon('more');
$('btnOpen').onclick = () => $('fileInput').click();
$('btnWelcomeOpen').onclick = () => $('fileInput').click();
$('btnExport').onclick = openExport;
$('btnUndo').onclick = undo; $('btnRedo').onclick = redo;
$('btnCompare').onclick = () => M.el && toggleSplit();
$('btnDice').onclick = rollDice;
$('btnMore').onclick = openMore;
$('fileInput').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; openFile(f); };
$('configInput').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const s = parseMeta(await f.slice(Math.max(0, f.size - 60000)).text().catch(() => ''));
    if (!s) { toast('Este arquivo não tem configurações do Pixelar'); return; }
    if (!M.el) { toast('Abra uma foto ou vídeo primeiro'); return; }
    const before = snapshot(); s.crop = deepClone(st.crop); st = s; afterExternalChange(); commit(true);
    toast('Configurações importadas', { label: 'Desfazer', run: () => { restore(before); commit(true); } });
};
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer.types || [])].includes('Files')) { dragDepth++; app.classList.add('dragging'); } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) app.classList.remove('dragging'); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; app.classList.remove('dragging'); const f = e.dataTransfer.files[0]; if (f) openFile(f); });
window.addEventListener('paste', (e) => { const it = [...(e.clipboardData.items || [])].find(i => i.kind === 'file'); if (it) { e.preventDefault(); openFile(it.getAsFile()); } });
document.addEventListener('keydown', (e) => {
    const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') { closeSheet(); return; }
    if (!$('sheet').hidden) return;
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); $('fileInput').click(); return; }
    if (!M.el) return;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && (e.key.toLowerCase() === 'e' || e.key.toLowerCase() === 's')) { e.preventDefault(); openExport(); return; }
    if (mod) return;
    if (e.code === 'Space' && !(t && (t.tagName === 'BUTTON' || (t.classList && t.classList.contains('gslider'))))) { e.preventDefault(); togglePlay(); return; }
    if (e.key === 'r' || e.key === 'R') { rollDice(); return; }
    if ((e.key === 'p' || e.key === 'P') && !e.metaKey && !e.ctrlKey) { setPanelCollapsed(!panelCollapsed); return; }
    if ((e.key === 'o' || e.key === 'O') && !e.repeat) { compare.hold = true; showOriginal(true); return; }
    if (e.key === 'c' || e.key === 'C') { toggleSplit(); return; }
    if (e.key === '+' || e.key === '=') { zoomAt(1.25); return; }
    if (e.key === '-') { zoomAt(0.8); return; }
    if (e.key === '0') { view.zoom = 1; view.x = view.y = 0; applyView(); return; }
    const n = parseInt(e.key, 10); if (n >= 1 && n <= TABS.length) { selectTab(TABS[n - 1].id); return; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { const r = document.querySelector('.gslider'); if (r) { r.focus(); r.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, shiftKey: e.shiftKey })); e.preventDefault(); } }
});
document.addEventListener('keyup', (e) => { if ((e.key === 'o' || e.key === 'O') && compare.hold) { compare.hold = false; showOriginal(false); } });
document.addEventListener('visibilitychange', () => { if (document.hidden) { stopAnim(); pauseVideo(); } });

// ============================================================
// INÍCIO
// ============================================================
buildTabbar(); selectTab('estilos'); updateHistoryButtons();
$('btnWelcomeOpen').innerHTML = icon('share') + '<span>Carregar imagem ou vídeo</span>';
if (!PixelarGPU.isAvailable()) console.warn('WebGL2 indisponível: usando o processador (mais lento).');
// (testes) ?demo=1 abre a imagem de exemplo; ?tab=... escolhe a aba; mostra um relatório das miniaturas
if (/[?&]demo=1/.test(location.search)) { window.__diagErrs = []; addEventListener('error', (e) => window.__diagErrs.push(e.message)); }
if (/[?&]demo=1/.test(location.search)) setTimeout(() => {
    openSample(); const m = location.search.match(/[?&]tab=(\w+)/); if (m) selectTab(m[1]);
    const gq = location.search.match(/[?&]grp=(\w+)/); if (gq) { ui.group[ui.tab] = gq[1]; buildPanel(); }
    if (/[?&]nodiag=1/.test(location.search)) return;
    setTimeout(() => {
        const all = document.querySelectorAll('.thumb canvas'), ok = document.querySelectorAll('.thumb canvas.ready');
        const d = document.createElement('div'); d.id = 'diag';
        d.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9999;background:#000;color:#0f0;font:12px monospace;padding:6px;border-radius:6px';
        d.textContent = `miniaturas prontas ${ok.length}/${all.length} · gpu ${PixelarGPU.isAvailable()} · ${navigator.userAgent.includes('Safari') && !navigator.userAgent.includes('Chrome') ? 'WebKit' : 'outro'}`;
        document.body.append(d);
        if (/[?&]report=1/.test(location.search)) {
            // amostra de pixels das miniaturas para confirmar que não estão em branco
            const readyBefore = ok.length, hidden = document.hidden, focus = document.hasFocus();
            if (/[?&]scroll=1/.test(location.search)) {
                // rola a faixa até o fim (como o dedo faria) e conta as miniaturas visíveis prontas depois
                const sc = document.querySelector('#editor .strip') || document.querySelector('#panel');
                sc.scrollLeft = sc.scrollWidth; if (sc === document.querySelector('#panel')) sc.scrollTop = sc.scrollHeight;
                setTimeout(() => {
                    const vis = [...document.querySelectorAll('.thumb canvas')].filter(c => { const r = c.getBoundingClientRect(); return r.width && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight; });
                    fetch('/result', { method: 'POST', body: JSON.stringify({ afterScroll: true, visible: vis.length, visibleReady: vis.filter(c => c.classList.contains('ready')).length, errors: window.__diagErrs || [] }) });
                }, 2500);
                return;
            }
            let rafs = 0; const t0 = performance.now(); const count = () => { rafs++; if (performance.now() - t0 < 1000) requestAnimationFrame(count); };
            requestAnimationFrame(count);
            setTimeout(() => {
                Thumbs.flush();
                const ok2 = document.querySelectorAll('.thumb canvas.ready');
                const px = [...ok2].slice(0, 8).map(c => { const x = c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data; return x[0] + x[1] + x[2] + x[3]; });
                fetch('/result', { method: 'POST', body: JSON.stringify({ readyBefore, readyAfterFlush: ok2.length, total: all.length, rafsPerSecond: rafs, hidden, focus, gpu: PixelarGPU.isAvailable(), centerSums: px, errors: window.__diagErrs || [] }) });
            }, 1100);
        }
    }, 4000);
}, 300);
window.Pixelar = { thumbs: Thumbs, get state() { return st; }, set state(v) { st = normalizeState(v); afterExternalChange(); }, openFile, openSample, render: renderMain, selectTab, media: M };
})();
