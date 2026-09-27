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
    const r = $('stage').getBoundingClientRect(), sheetOpen = !$('sheet').hidden;
    box.style.top = (sheetOpen ? 16 : Math.max(8, r.top + 10)) + 'px';
    box.style.left = (sheetOpen ? innerWidth / 2 : r.left + r.width / 2) + 'px';
    const t = h('div', 'toast'); t.append(h('span', '', '')); t.firstChild.textContent = msg;
    if (action) { const b = h('button', '', action.label); b.type = 'button'; b.onclick = () => { action.run(); t.remove(); }; t.append(b); }
    box.append(t); requestAnimationFrame(() => t.classList.add('show'));
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
function renderMain() {
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
window.onGpuRestored = requestRender;

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
    const vw = viewport.clientWidth - 24, vh = viewport.clientHeight - 24;
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
const FRAME_OPTS = [['auto', 'Do filme'], ['0', 'Nenhuma'], ...Object.entries(FRAME_NAMES)];
const FILM_OPTS = [['none', 'Nenhum'], ...Object.values(FILM_LOOKS).map(l => [l.id, l.nome])];
const FX_OPTS = () => [['none', 'Nenhum'], ...PixelarFX.listEffects().map(f => [f.id, f.nome])];
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
        { id: 'surpresa', label: 'Surpresa', controls: () => [X('surprise', 'Surpresa', 'dice', editSurprise)] },
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
            R('grain.amount', 'Intensidade', 'grain', 0, 100), R('grain.size', 'Tamanho', 'size', 10, 400, { step: 5 }), R('grain.rough', 'Aspereza', 'rough', 0, 100),
            R('grain.bias', 'Sombras ↔ luzes', 'bias', -100, 100), R('grain.speckle', 'Manchas', 'speckle', 0, 100), T('grain.mono', 'Monocromático', 'mono'),
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
        { id: 'fundo', label: 'Fundo', controls: () => [T('bg.fill', 'Preencher', 'fill'), K('bg.color', 'Cor do fundo')] },

        { id: 'crop', label: 'Cortar', controls: () => [
            C('crop.aspect', 'Proporção', 'crop', [['original', 'Original'], ['1:1', 'Quadrado'], ['4:5', '4:5'], ['5:4', '5:4'], ['3:4', '3:4'], ['4:3', '4:3'], ['2:3', '2:3'], ['3:2', '3:2'], ['9:16', '9:16 Stories'], ['16:9', '16:9'], ['21:9', 'Cinema']], { onPick: () => { st.crop.x = 0; st.crop.y = 0; } }),
            A('Girar', 'rotate', () => { st.crop.rot = (st.crop.rot + 90) % 360; change(null, null, { rebuild: true }); Engine.invalidate(); }),
            T('crop.flipH', 'Espelhar ↔', 'flipH'), T('crop.flipV', 'Espelhar ↕', 'flipV'),
            R('crop.zoom', 'Zoom', 'zoom', 100, 400, { step: 5 }), R('crop.x', 'Horizontal', 'move', -1, 1, { step: 0.01, fmt: (v) => Math.round(v * 100) }), R('crop.y', 'Vertical', 'move', -1, 1, { step: 0.01, fmt: (v) => Math.round(v * 100) }),
            R('pixel.scale', 'Escala', 'scale', 20, 100),
            A('Restaurar', 'reset', () => { st.crop = deepClone(DEFAULT_STATE.crop); st.pixel.scale = 100; Engine.invalidate(); afterExternalChange(); commit(true); }),
        ] }
    ] },
    // Efeitos: pixel/dither, contorno, filmes, lente, moldura e texturas
    { id: 'efeitos', label: 'Efeitos', icon: 'fx', groups: [
        { id: 'padrao', label: 'Pixel', controls: () => [
            randomOnly(['pixel', 'dither'], 'Pixel sorteado'),
            C('dither.mode', 'Padrão', 'pattern', DITHER_OPTS, { view: 'thumbs', variant: (s, v) => { s.dither.mode = v; if (v !== 'none' && s.dither.intensity < 40) s.dither.intensity = 100; }, detail: true }),
            R('pixel.size', 'Tamanho do pixel', 'pixel', 1, 64), R('dither.scale', 'Escala do padrão', 'scale', 1, 10), R('dither.intensity', 'Intensidade', 'intensity', 0, 200),
            R('dither.opacity', 'Opacidade', 'opacity', 0, 100), T('dither.midOnly', 'Só meios-tons', 'mid'),
        ] },
        { id: 'contorno', label: 'Contorno', controls: () => [
            R('edge.size', 'Espessura', 'edge', 0, 10), R('edge.opacity', 'Opacidade', 'opacity', 0, 100), K('edge.color', 'Cor'),
        ] },

        { id: 'filmes', label: 'Filme', controls: () => {
            const look = FILM_LOOKS[st.film.look];
            const list = [
                randomOnly(['film'], 'Filme sorteado'),
                C('film.look', 'Filme', 'film', FILM_OPTS, { view: 'thumbs', groupsOf: FILM_LOOK_DEFS, variant: (s, v) => { s.film.look = v; if (v !== 'none' && s.film.mix < 30) s.film.mix = 100; } }),
                R('film.mix', 'Intensidade', 'intensity', 0, 100), R('film.grainAmt', 'Grão do filme', 'grain', 0, 200, { step: 5 }), R('film.temp', 'Temperatura', 'temp', -100, 100),
            ];
            if (look && look.fx === 'lumiere') list.push(R('film.lumiereHue', 'Matiz', 'hue', 0, 360));
            if (look && look.fx === 'vencido') list.push(C('film.vencido', 'Variação', 'film', [[0, 'Quente'], [1, 'Névoa magenta'], [2, 'Frio'], [3, 'Desbotado']]));
            if (look && look.fx) list.push(...fxParamControls(look.fx, ['uVariant', 'uHue']));
            return list;
        } },
        { id: 'lente', label: 'Lente', controls: () => [
            R('film.vignette', 'Vinheta', 'vignette', 0, 100), K('film.vigColor', 'Cor da vinheta'), R('film.halation', 'Halação', 'halation', 0, 100), R('film.bloom', 'Brilho', 'bloom', 0, 100),
            R('film.soft', 'Suavidade', 'soft', 0, 100), R('film.distort', 'Distorção', 'distort', -100, 100), R('film.chroma', 'Aberração', 'chroma', 0, 100),
            R('film.flash', 'Flash', 'flash', 0, 100), R('film.leak', 'Vazamento', 'leak', 0, 100), K('film.leakColor', 'Cor do vazamento'), R('film.dust', 'Poeira', 'dust', 0, 100),
        ] },
        { id: 'moldura', label: 'Moldura', controls: () => [
            C('film.frame', 'Moldura', 'frame', FRAME_OPTS, { view: 'thumbs', variant: (s, v) => { s.film.frame = v; if (v !== 'auto' && v !== '0') s.film.frameColor = arrHex(FRAME_COLORS[v]); } , onPick: (v) => { if (v !== 'auto' && v !== '0') st.film.frameColor = arrHex(FRAME_COLORS[v]); } }),
            K('film.frameColor', 'Cor da moldura'),
            C('film.stamp', 'Data', 'stamp', [['off', 'Sem data'], ['auto', 'Do filme'], ['on', 'Sempre']]), K('film.stampColor', 'Cor da data'),
        ] },

        { id: 'fx', label: 'Texturas', controls: () => {
            const list = [randomOnly(['fx'], 'Textura sorteada'), C('fx.id', 'Textura', 'fx', FX_OPTS(), { view: 'thumbs', variant: (s, v) => { s.fx.id = v; if (s.fx.mix < 30) s.fx.mix = 100; } }), R('fx.mix', 'Intensidade', 'intensity', 0, 100)];
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

function buildTabbar() {
    const bar = $('tabbar'); bar.innerHTML = '';
    TABS.forEach((t, i) => {
        const b = h('button', 'tab' + (t.id === ui.tab ? ' on' : ''), icon(t.icon) + `<span>${t.label}</span>`);
        b.type = 'button'; b.dataset.tab = t.id; b.title = `${t.label} (${i + 1})`;
        b.onclick = () => selectTab(t.id);
        bar.append(b);
    });
    markTabs();
}
function selectTab(id) {
    ui.tab = id;
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === id));
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
    if (!single) controls.forEach(c => { const d = makeDial(c, c === active); dials.append(d); dialEls.push({ c, el: d }); });
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
function rebuildDials() {
    const tab = currentTab(), grp = currentGroup(), aKey = tab.id + '/' + grp.id;
    const dials = $('dials'); if (dials.hidden) { refreshDials(); return; }
    const x = dials.scrollLeft;
    const controls = grp.controls().filter(c => !c.hidden);
    dials.innerHTML = ''; dialEls = [];
    controls.forEach(c => { const d = makeDial(c, ctrlId(c) === ui.active[aKey]); dials.append(d); dialEls.push({ c, el: d }); });
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
    d.addEventListener('pointerdown', () => { longPressed = false; if (!lockKey || c.kind === 'action') return; lp = setTimeout(() => { longPressed = true; toggleLock(lockKey); }, 550); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => d.addEventListener(ev, () => clearTimeout(lp)));
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
    if (c.kind === 'color') { pickColor(ctrlValue(c), (hex, final) => { change(c.key, hex, { soft: !final }); updateDial(d, c); }, c.label); return; }
    ui.active[aKey] = ctrlId(c);
    dialEls.forEach(({ el }) => el.classList.toggle('active', el === d));
    refreshDials();
    buildEditor(c);
    flashLabel(c.label);
}
// controles cujo valor muda quais outros controles aparecem
function grpDependsOn(key) { return ['grad.on', 'grad.type', 'color.sel', 'film.look', 'fx.id', 'anim.dStyle'].includes(key); }

let labelTimer = 0;
function flashLabel(text, ms = 1100) {
    const l = $('paramLabel'); l.textContent = text; l.classList.add('show');
    clearTimeout(labelTimer); labelTimer = setTimeout(() => l.classList.remove('show'), ms);
}

// ============================================================
// EDITORES
// ============================================================
function buildEditor(c) {
    const ed = $('editor'); ed.innerHTML = '';
    if (!c) return;
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
function makeRuler(c) {
    const box = h('div'), el = h('div', 'ruler'); el.tabIndex = 0; el.setAttribute('role', 'slider'); el.setAttribute('aria-label', c.label);
    el.setAttribute('aria-valuemin', c.min); el.setAttribute('aria-valuemax', c.max);
    const ticks = h('div', 'ticks'), needle = h('div', 'needle');
    const range = c.max - c.min, nSteps = range / c.step;
    const totalW = clampN(nSteps * 8, 280, 1800), ppu = totalW / range;
    let tu = c.step; for (const m of [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000]) { tu = c.step * m; if (tu * ppu >= 7.5) break; }
    const spacing = tu * ppu, n = Math.floor(range / tu + 1e-6), def = defP(c.key);
    let html = '';
    for (let i = 0; i <= n; i++) {
        const v = c.min + i * tu;
        const isDef = typeof def === 'number' && Math.abs(v - def) < tu / 2;
        const cls = isDef ? 'zero' : (i % 5 === 0 ? 'major' : '');
        html += `<i class="${cls}" style="margin-right:${i === n ? 0 : spacing - (isDef ? 2 : 1.5)}px"></i>`;
    }
    ticks.innerHTML = html;
    el.append(ticks, needle);
    let v = ctrlValue(c);
    const q = (x) => { const s = Math.round((x - c.min) / c.step) * c.step + c.min; return clampN(+s.toFixed(6), c.min, c.max); };
    const valEl = h('div', 'ruler-val');
    const centered = c.min < 0 && c.max > 0;
    const fmtShow = (x) => { const f = fmtVal(c, x); return centered && x > 0 ? '+' + f : String(f); };
    const place = () => { ticks.style.transform = `translateX(${-(v - c.min) * ppu - 0.75}px)`; el.setAttribute('aria-valuenow', q(v)); valEl.textContent = fmtShow(q(v)); };
    place();
    let last = null, vel = 0, lastT = 0, inertia = 0, startV = 0, snapped = false;
    const emit = (final) => {
        const qv = q(v);
        if (qv !== getP(c.key)) { setP(c.key, qv); requestRender(); Thumbs.stateChanged(); markTabs(); }
        const d = dialEls.find(x => x.c === c); if (d) updateDial(d.el, c);
        $('paramLabel').textContent = c.label + '  ' + fmtShow(qv);
        if (final) { commit(); if (grpDependsOn(c.key)) buildPanel(); }
    };
    const setV = (nv) => {
        // detente no valor padrão (como o zero da régua da Apple)
        if (typeof def === 'number' && def > c.min && def < c.max) {
            const nearDef = Math.abs(nv - def) * ppu < 7;
            if (nearDef && !snapped) { snapped = true; if (navigator.vibrate) navigator.vibrate(4); }
            if (!nearDef) snapped = false;
            if (nearDef && Math.abs(startV - def) * ppu > 7) nv = def;
        }
        v = clampN(nv, c.min, c.max); place(); emit(false);
    };
    el.addEventListener('pointerdown', (e) => {
        cancelAnimationFrame(inertia); el.setPointerCapture(e.pointerId); last = e.clientX; lastT = performance.now(); vel = 0; startV = v;
        flashLabel(c.label + '  ' + fmtShow(q(v)), 100000);
    });
    el.addEventListener('pointermove', (e) => {
        if (last === null) return;
        const dx = e.clientX - last, now = performance.now();
        vel = 0.8 * vel + 0.2 * (dx / Math.max(1, now - lastT)); last = e.clientX; lastT = now;
        setV(v - dx / ppu);
    });
    const up = () => {
        if (last === null) return; last = null;
        flashLabel(c.label + '  ' + fmtShow(q(v)));
        let sp = vel * 16;
        if (Math.abs(sp) < 0.6) { emit(true); return; }
        const step = () => { sp *= 0.92; setV(v - sp / ppu); if (Math.abs(sp) > 0.3 && v > c.min && v < c.max) inertia = requestAnimationFrame(step); else emit(true); };
        inertia = requestAnimationFrame(step);
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => { e.preventDefault(); const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY; startV = v; setV(v + d / ppu * 0.5); clearTimeout(el._wt); el._wt = setTimeout(() => emit(true), 250); }, { passive: false });
    el.addEventListener('keydown', (e) => {
        const big = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); startV = v; v = clampN(q(v) + c.step * big, c.min, c.max); place(); emit(true); }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); startV = v; v = clampN(q(v) - c.step * big, c.min, c.max); place(); emit(true); }
    });
    el.addEventListener('dblclick', () => { v = def; place(); emit(true); flashLabel(c.label + ' · padrão'); });
    box.append(valEl, el, h('div', 'ruler-hint', 'arraste · toque duplo volta ao padrão · segure o botão para travar'));
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
addEventListener('scroll', () => { lastInput = performance.now(); }, true);
const Thumbs = (() => {
    const src = document.createElement('canvas'), sctx = src.getContext('2d');
    let serial = 0, dominant = ['#888', '#aaa', '#666'];
    let live = [];             // { pic, canvas, id, variant, hash, liveState }
    let queue = [], raf = 0, dirtyTimer = 0;
    function setSource(el, force) {
        if (!el) return;
        const { W, H } = mediaSize(el); if (!W || !H) return;
        const k = 200 / Math.max(W, H); src.width = Math.max(1, Math.round(W * k)); src.height = Math.max(1, Math.round(H * k));
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
    const cache = new Map();   // id → { canvas, hash }: miniaturas sobrevivem à remontagem do painel
    function attach(pic, id, variant, liveState, detail) {
        const old = cache.get(id);
        const cv = old ? old.canvas : document.createElement('canvas'); const sk = h('span', 'sk');
        const pal = (() => { try { const s = variant(); if (s.color.sel !== 'all' && s.color.base.length) return s.color.base.slice(0, 4); if (s.color.sel === 'duotone' || s.color.sel === 'tritone') return s.color.duo; } catch (e) {} return dominant; })();
        sk.style.backgroundImage = `linear-gradient(100deg, ${pal.join(', ')}, ${pal[0]})`; sk.style.opacity = '.55';
        pic.append(cv, sk);
        const item = { pic, canvas: cv, id, variant, liveState, detail: !!detail, hash: old ? old.hash : null };
        cache.set(id, item); if (cache.size > 400) cache.delete(cache.keys().next().value);
        live.push(item); queue.push(item); pump();
    }
    function pump() { if (!raf) raf = requestAnimationFrame(work); }
    function work() {
        raf = 0; live = live.filter(it => it.pic.isConnected);
        // enquanto o dedo está na tela (régua, rolagem), as miniaturas esperam: o gesto tem prioridade
        if (pointerDown || performance.now() - lastInput < 250) { setTimeout(pump, 150); return; }
        if (!M.el) { queue = []; return; }
        const t0 = performance.now();
        const vis = (it) => { const r = it.pic.getBoundingClientRect(); return r.width && r.right > -40 && r.left < innerWidth + 40 && r.bottom > 0 && r.top < innerHeight; };
        while (queue.length && performance.now() - t0 < 8) {
            // primeiro as miniaturas visíveis
            let k = queue.findIndex(vis); if (k < 0) k = 0;
            const it = queue.splice(k, 1)[0]; if (!it.pic.isConnected) continue;
            let s; try { s = it.variant(); } catch (e) { continue; }
            const hash = M.serial + '|' + (M.type === 'video' ? video.currentTime : '') + '|' + it.detail + '|' + JSON.stringify(s);
            if (hash === it.hash) continue;
            it.hash = hash;
            // mesma base e mesma saída da imagem principal: a miniatura é o resultado real, reduzido
            const r = Engine.render(s, { media: M.el, key: M.type === 'image' ? 'main' + M.serial : null, out: { canvas: full, ctx: fullCtx }, maxDim: 2000 });
            if (r) { drawThumb(it, r.W, r.H); it.canvas.classList.add('ready'); }
        }
        if (queue.length) pump();
    }
    function refreshAll() { live = live.filter(it => it.pic.isConnected); queue = live.slice(); pump(); }
    function stateChanged() { clearTimeout(dirtyTimer); dirtyTimer = setTimeout(() => { live = live.filter(it => it.pic.isConnected); queue = live.filter(it => it.liveState); pump(); }, 260); }
    return { setSource, attach, stateChanged, refreshAll, get src() { return src; } };
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
function makeSurprises() {
    ui.surprise = Array.from({ length: 12 }, () => { const s = deepClone(st); const g = new Set(prefs.groups); g.delete('anim'); g.add('palette'); randomize(s, M.analysis, g, prefs.locks, null, true); return s; });
}
function editSurprise(ed) {
    if (!ui.surprise.length) makeSurprises();
    const strip = h('div', 'strip');
    const roll = h('button', 'thumb add'); roll.type = 'button'; roll.innerHTML = `<span class="pic">${icon('dice')}</span><span class="t">Sortear de novo</span>`;
    roll.onclick = () => { makeSurprises(); buildEditor({ kind: 'custom', editor: editSurprise }); };
    strip.append(roll);
    ui.surprise.forEach((s, i) => {
        const t = h('button', 'thumb'); t.type = 'button';
        const pic = h('span', 'pic'); t.append(pic, h('span', 't', 'Variação ' + (i + 1)));
        Thumbs.attach(pic, 'surprise:' + i, () => s, false);
        t.onclick = () => { const before = snapshot(); st = normalizeState(deepClone(s)); Engine.invalidate(); afterExternalChange({ keepEditor: true }); commit(true); strip.querySelectorAll('.thumb').forEach(x => x.classList.toggle('on', x === t)); toast('Variação aplicada', { label: 'Desfazer', run: () => { restore(before); commit(true); } }); };
        strip.append(t);
    });
    ed.append(strip, h('div', 'editor-note', 'Doze combinações novas a partir da sua foto. Segure qualquer botão nas outras abas para travá-lo.'));
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

// ---------- seletor de cor nativo ----------
function pickColor(value, cb, label) {
    const inp = $('colorInput'); inp.value = /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
    const onInput = () => cb(inp.value.toUpperCase(), false);
    const onChange = () => { cb(inp.value.toUpperCase(), true); inp.removeEventListener('input', onInput); inp.removeEventListener('change', onChange); };
    inp.addEventListener('input', onInput); inp.addEventListener('change', onChange);
    if (label) flashLabel(label);
    inp.click();
}

// ============================================================
// FOLHAS (sheets)
// ============================================================
let sheetClose = null;
function openSheet(build, onClose) {
    const sh = $('sheet'), bd = $('sheetBackdrop');
    sh.innerHTML = '<div class="grabber"></div>'; build(sh);
    sh.hidden = false; bd.hidden = false;
    requestAnimationFrame(() => { sh.classList.add('show'); bd.classList.add('show'); });
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
        item('keyboard', 'Atalhos de teclado', openShortcuts);
        sh.append(list, h('p', 'note', 'Pixelar Studio · tudo roda no seu navegador, nenhuma foto sai do aparelho.'));
    });
}
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
        [['R', 'Aleatório'], ['Espaço', 'Tocar / parar animação ou vídeo'], ['O (segurar)', 'Ver o original'], ['C', 'Comparar lado a lado'], ['⌘Z / ⇧⌘Z', 'Desfazer / refazer'], ['⌘E', 'Exportar'], ['⌘O', 'Abrir arquivo'], ['1 – 4', 'Trocar de aba'], ['← →', 'Ajustar a régua ativa (⇧ = 10×)'], ['+ / − / 0', 'Zoom / encaixar']].forEach(([k, d]) => { g.append(h('kbd', '', k), h('span', '', d)); });
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
    ui.surprise = [];
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
function startAnim() {
    if (M.type !== 'image') return;
    if (!animOn()) { toast('Nada para animar ainda', { label: 'Configurar', run: () => selectTab('movimento') }); return; }
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
        const g = h('div', 'glass-group'); const b = h('button', 'icon-btn' + (anim.playing ? ' on' : ''), icon(anim.playing ? 'pause' : 'play')); b.type = 'button';
        b.title = anim.playing ? 'Parar animação (espaço)' : 'Ver animação (espaço)'; b.setAttribute('aria-label', b.title);
        b.onclick = togglePlay; g.append(b); c.append(g);
    }
}

// ============================================================
// ALEATÓRIO GLOBAL
// ============================================================
function rollDice() {
    if (!M.el) return;
    const before = snapshot();
    const dice = $('btnDice'); dice.classList.remove('rolling'); void dice.offsetWidth; dice.classList.add('rolling');
    const touched = randomize(st, M.analysis, prefs.groups, prefs.locks);
    afterExternalChange(); commit(true);
    toast(touched.length ? touched.slice(0, 4).join(' · ') : 'Nova combinação', { label: 'Desfazer', run: () => { restore(before); commit(true); } });
    if (M.type === 'image' && prefs.groups.has('anim') && anim.playing && !animOn()) stopAnim();
}

// ============================================================
// IMAGEM DE EXEMPLO (só para testes: Pixelar.openSample no console)
// ============================================================

function openSample() { const c = makeSampleImage(); setMedia('image', c, 'Exemplo'); }

// ============================================================
// ENTRADAS: botões, arquivo, arrastar, colar, teclado
// ============================================================
$('btnUndo').innerHTML = icon('undo'); $('btnRedo').innerHTML = icon('redo');
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
    if (e.code === 'Space' && !(t && (t.tagName === 'BUTTON' || (t.classList && t.classList.contains('ruler'))))) { e.preventDefault(); togglePlay(); return; }
    if (e.key === 'r' || e.key === 'R') { rollDice(); return; }
    if ((e.key === 'o' || e.key === 'O') && !e.repeat) { compare.hold = true; showOriginal(true); return; }
    if (e.key === 'c' || e.key === 'C') { toggleSplit(); return; }
    if (e.key === '+' || e.key === '=') { zoomAt(1.25); return; }
    if (e.key === '-') { zoomAt(0.8); return; }
    if (e.key === '0') { view.zoom = 1; view.x = view.y = 0; applyView(); return; }
    const n = parseInt(e.key, 10); if (n >= 1 && n <= TABS.length) { selectTab(TABS[n - 1].id); return; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { const r = document.querySelector('.ruler'); if (r) { r.focus(); r.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, shiftKey: e.shiftKey })); e.preventDefault(); } }
});
document.addEventListener('keyup', (e) => { if ((e.key === 'o' || e.key === 'O') && compare.hold) { compare.hold = false; showOriginal(false); } });
document.addEventListener('visibilitychange', () => { if (document.hidden) { stopAnim(); pauseVideo(); } });

// ============================================================
// INÍCIO
// ============================================================
buildTabbar(); selectTab('estilos'); updateHistoryButtons();
$('btnWelcomeOpen').innerHTML = icon('share') + '<span>Carregar imagem ou vídeo</span>';
if (!PixelarGPU.isAvailable()) console.warn('WebGL2 indisponível: usando o processador (mais lento).');
window.Pixelar = { get state() { return st; }, set state(v) { st = normalizeState(v); afterExternalChange(); }, openFile, openSample, render: renderMain, selectTab, media: M };
})();
