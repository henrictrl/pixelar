/* Pixelar — interface.
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
    groups: new Set(store.get('dice2', Object.keys(RANDOM_GROUPS)).filter(k => RANDOM_GROUPS[k])),   // ferramentas livres para o dado (as outras ficam travadas)
    presets: store.get('presets', {}),
    palettes: store.get('palettes', {}),
    muted: store.get('muted', false),
};
const ui = { tab: 'editar', group: {}, active: {}, view: {}, open: { estilos: true, editar: false, exportar: true }, busy: false };

// ============================================================
// AVISOS
// ============================================================
function toast(msg, action, ms = 3200) {
    const box = $('toasts');
    box.querySelectorAll('.toast').forEach(o => o.remove());          // um aviso por vez
    // fica dentro da área da imagem, logo abaixo da barra de botões (nunca por cima deles)
    const u = uiInsets, sheetOpen = !$('sheet').hidden;
    box.style.top = Math.max(8, u.t + 10) + 'px';
    box.style.left = (sheetOpen ? innerWidth / 2 : u.l + (innerWidth - u.l - u.r) / 2) + 'px';
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
const compare = { hold: false };   // segurar a foto mostra o original

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
// durante o gesto, sem pixel grande e sem zoom: saída menor (a tela do celular não mostra a diferença)
function previewDim() {
    const lite = Interact.on && st.pixel.size <= 1 && view.zoom <= 1 && !anim.playing && M.type === 'image';
    if (lite) Interact.lowRes = true;
    return lite ? 1280 : 2000;
}
function renderMainUnsafe() {
    if (!M.el) return;
    if (M.type === 'video' && !video.videoWidth) return;
    const showOrig = compare.hold;
    const r = Engine.render(st, Object.assign({ media: M.el, key: M.type === 'image' ? 'main' + M.serial : null, out: { canvas: outCanvas, ctx: outCtx }, compare: showOrig ? { canvas: origCanvas, ctx: origCtx } : null, maxDim: previewDim() }, mainFrameOptions()));
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
        const txtD = hslToRgb(hsl.h, s, chroma ? 0.78 : 0.88), txtL = hslToRgb(hsl.h, Math.min(1, s * 1.05), chroma ? 0.38 : 0.3);
        const key = rgbHex(fill); if (key === last) return; last = key;
        root.setProperty('--acc', rgbHex(fill));
        root.setProperty('--acc-ink', lum > 0.55 ? '#111111' : '#FFFFFF');
        root.setProperty('--acc-text-d', rgbHex(txtD));
        root.setProperty('--acc-text-l', rgbHex(txtL));
    }
    // chamado depois de cada render; mede com calma (a cor segue a imagem, não cada quadro)
    // redesign “Sol”: o destaque é fixo (âmbar da marca) e não segue mais a foto
    function schedule() {}
    return { schedule };
})();

// ============================================================
// INTERAÇÃO: enquanto o dedo está na tela, a prévia sai mais leve (≤1280 px quando não há pixel grande)
// e volta à resolução cheia ao soltar
// ============================================================
const Interact = { on: false, lowRes: false };
{
    const down = (e) => { if (e.isPrimary) Interact.on = true; };
    const up = (e) => {
        if (!Interact.on || (e && e.isPrimary === false)) return;
        Interact.on = false;
        if (Interact.lowRes) { Interact.lowRes = false; requestRender(); }
    };
    addEventListener('pointerdown', down, true);
    addEventListener('pointerup', up, true); addEventListener('pointercancel', up, true);
    addEventListener('blur', up); document.addEventListener('visibilitychange', () => document.hidden && up());
}

// ============================================================
// VISUALIZAÇÃO: encaixe, zoom e deslocamento
// ============================================================
let uiInsets = { t: 60, r: 8, b: 300, l: 8 };
function fitView(resetZoom) {
    if (!lastRender) return;
    const pad = isSide() ? 56 : 24;   // respiro em volta da foto (a moldura fina fica à vista)
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
    if (lastRender) Accent.schedule(outCanvas, 300);   // a imagem mudou de lugar: recalcula o contraste
}
function zoomAt(factor, cx, cy) {
    const r = viewport.getBoundingClientRect();
    // relativo ao centro da área da imagem
    const px = cx !== undefined ? cx - r.left - r.width / 2 : 0, py = cy !== undefined ? cy - r.top - r.height / 2 : 0;
    const nz = clampN(view.zoom * factor, 1, 12), f = nz / view.zoom;
    view.x = px - (px - view.x) * f; view.y = py - (py - view.y) * f; view.zoom = nz;
    if (nz === 1) { view.x = 0; view.y = 0; }
    applyView();
}
new ResizeObserver(() => fitView()).observe(viewport);

// gestos no palco: pinça, arrastar, segurar para ver o original, divisor do comparar
(() => {
    const pts = new Map(); let pinch = null, holdTimer = 0, moved = false, start = null;
    viewport.addEventListener('pointerdown', (e) => {
        if (!M.el) return;
        if (e.isPrimary && pts.size) { pts.clear(); pinch = null; }   // um novo 1º toque descarta restos de toques perdidos
        viewport.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        moved = false; start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
        if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: view.zoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; clearTimeout(holdTimer); return; }
        clearTimeout(holdTimer);
        holdTimer = setTimeout(() => { if (!moved) { compare.hold = true; showOriginal(true); } }, 220);
    });
    viewport.addEventListener('pointermove', (e) => {
        if (!pts.has(e.pointerId)) return;
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch && pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); zoomAt((pinch.z * d / pinch.d) / view.zoom, pinch.cx, pinch.cy); return; }
        if (!start) return;
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) { moved = true; clearTimeout(holdTimer); }
        if (view.zoom > 1 && moved) { view.x = start.vx + dx; view.y = start.vy + dy; applyView(); }
        else if (ui.tab === 'editar' && ui.editTool === 'crop' && moved && !isCropIdentity(st.crop)) { cropDrag(dx, dy, e); }
    });
    const end = (e) => {
        if (!pts.has(e.pointerId)) return;
        pts.delete(e.pointerId); clearTimeout(holdTimer);
        if (pts.size < 2) pinch = null;
        if (compare.hold) { compare.hold = false; showOriginal(false); }
        if (cropDragState) { cropDragState = null; commit(); }
        start = null;
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
    origCanvas.hidden = !on; $('origBadge').hidden = !on; $('btnCompare').classList.toggle('on', !!on); $('btnCompare').setAttribute('aria-pressed', String(!!on));
    if (on) renderMain();
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
    requestRender();
    if (!soft) commit();
    if (rebuild) buildPanel(); else if (dials) rebuildDials(); else refreshDials();
    Thumbs.stateChanged();
    if (anim.playing && !canAnimate()) stopAnim();
    updateSubbarCenter();
}
// estado trocado por fora (aleatório, preset, desfazer): remonta tudo
// keepEditor: mantém a faixa tocada intacta (só a fileira de botões é refeita)
function afterExternalChange({ keepEditor = false } = {}) {
    requestRender(); if (keepEditor) rebuildDials(); else buildPanel(); Thumbs.stateChanged();
    if (anim.playing && !canAnimate()) stopAnim();
    updateSubbarCenter();
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
const D = (label) => ({ kind: 'divider', label });          // divisória com nome dentro da fileira de ajustes
const opts = (obj) => Object.entries(obj).map(([v, l]) => [v, l]);

const DITHER_OPTS = DITHER_MODES.map(m => [m, DITHER_NAMES[m]]);
const COLOR_OPTS = [['all', 'Original'], ['2', '2'], ['3', '3'], ['4', '4'], ['6', '6'], ['8', '8'], ['12', '12'], ['16', '16'], ['24', '24'], ['32', '32'], ['48', '48'], ['64', '64'], ['128', '128'], ['256', '256'], ['duotone', 'Duotone'], ['tritone', 'Tritone']];
const GRAD_TYPE_OPTS = [['linear', 'Linear'], ['mirror', 'Espelhado'], ['radial', 'Radial'], ['conic', 'Cônico'], ['diamond', 'Diamante'], ['box', 'Quadrado'], ['wave', 'Onda'], ['spiral', 'Espiral']];
// uma lista de misturas para o app inteiro (degradê, dupla exposição e camadas); 'normal' do degradê = 'source-atop' no motor
const BLEND_OPTS = [['normal', 'Normal'], ['multiply', 'Multiplicar'], ['screen', 'Clarear'], ['overlay', 'Sobrepor'], ['softlight', 'Luz suave'], ['color', 'Só cor'], ['darken', 'Escurecer'], ['lighten', 'Iluminar'], ['difference', 'Diferença']];
const DBL_BLEND_OPTS = [...BLEND_OPTS, ['add', 'Somar luz'], ['subtract', 'Subtrair']];
const FILM_OPTS = [['none', 'Nenhum'], ...Object.values(FILM_LOOKS).map(l => [l.id, l.nome])];
// texturas agrupadas (miniaturas com títulos de grupo, como os filmes)
const FX_GROUP_DEFS = [
    ['Cor e luz', ['thermal', 'channel_mixer', 'color_threshold', 'neon_trace', 'starlight', 'fluted_glass']],
    ['Tela', ['ascii', 'lcd', 'led', 'bitmap', 'blueprint', 'vhs']],
    ['Impressão', ['riso', 'cmyk_halftone', 'stipple', 'emboss']],
    ['Pintura', ['oil']],
    ['Forma e matéria', ['lego', 'stained_glass', 'smudge', 'warp', 'gooey_merge', 'pattern_refraction', 'pixel_sort']],
];
function FX_GROUPS() {
    const byId = Object.fromEntries(PixelarFX.listEffects().map(f => [f.id, f.nome]));
    return FX_GROUP_DEFS.map(([g, ids]) => [g, ids.filter(id => byId[id]).map(id => [id, byId[id]])]);
}
const PALETTE_LIBRARY = {
    'Game Boy': ['#0F380F', '#306230', '#8BAC0F', '#9BBC0F'],
    'PICO-8': ['#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8', '#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA'],
    'CGA': ['#000000', '#55FFFF', '#FF55FF', '#FFFFFF'],
    'Cinza': ['#111111', '#555555', '#AAAAAA', '#F2F2F2'],
    'Sépia': ['#2B1B0E', '#6B4226', '#A67B5B', '#D9BF9A', '#F5EBDC'],
    'Vaporwave': ['#2D1B69', '#FF6AD5', '#C774E8', '#AD8CFF', '#94D0FF'],
};
const DUO_LIBRARY = { 'Noite': ['#0A1A2F', '#5A82A5', '#F2EFE9'], 'Rosa': ['#2A0845', '#FF6FB5', '#FFE3F1'], 'Laranja': ['#1B1B3A', '#FF7B00', '#FFE8C2'], 'Menta': ['#0B2E2B', '#2EC4B6', '#E8FFF9'], 'Sangue': ['#140000', '#B3001B', '#FFD6D6'], 'Ouro': ['#1C1405', '#C99A2E', '#FFF4D6'] };
const DBL_SRC_OPTS = [['image', 'Foto escolhida'], ['self', 'A mesma foto'], ['clouds', 'Nuvens'], ['light', 'Ondas de luz'], ['leaves', 'Folhagem']];
const DBL_MASK_OPTS = [['none', 'Sem máscara'], ['base-light', 'Luzes da foto'], ['base-dark', 'Sombras da foto'], ['img-light', 'Luzes da 2ª imagem'], ['center', 'Centro'], ['bottom', 'De baixo'], ['side', 'Da esquerda']];
const DBL_TONE_OPTS = [['color', 'Cores'], ['mono', 'Preto e branco'], ['tint', 'Tingido'], ['invert', 'Negativo']];
const CROP_OPTS = [['original', 'Original'], ['1:1', 'Quadrado'], ['4:5', '4:5'], ['5:4', '5:4'], ['3:4', '3:4'], ['4:3', '4:3'], ['2:3', '2:3'], ['3:2', '3:2'], ['9:16', '9:16'], ['16:9', '16:9'], ['21:9', 'Cinema']];

const animOn = () => describeAnimation(Engine.readSettings(st), readAnim(st)).length > 0;
const canAnimate = () => M.type === 'image' && animOn();

// “Restaurar” de cada ferramenta: volta só a parte do estado que ela controla
function resetAction(label, fn) {
    return A('Restaurar', 'reset', () => {
        const before = snapshot(); fn(); Engine.invalidate(); afterExternalChange(); commit(true);
        toast(label + ' restaurado', { label: 'Desfazer', run: () => { restore(before); commit(true); } });
    });
}
const fresh = (k) => deepClone(DEFAULT_STATE[k]);

// ---------- ferramentas da aba Editar (uma fileira de ajustes cada; divisórias separam as partes) ----------
const CROP_TOOL = { id: 'crop', label: 'Cortar', controls: () => [
    C('crop.aspect', 'Proporção', 'crop', CROP_OPTS, { onPick: () => { st.crop.x = 0; st.crop.y = 0; } }),
    A('Girar', 'rotate', () => { st.crop.rot = (st.crop.rot + 90) % 360; Engine.invalidate(); change(null, null, { dials: true }); }),
    T('crop.flipH', 'Espelhar ↔', 'flipH'), T('crop.flipV', 'Espelhar ↕', 'flipV'),
    R('crop.zoom', 'Zoom', 'zoom', 100, 400, { step: 5 }), ...cropMoveControls(),
    R('pixel.scale', 'Escala', 'scale', 20, 100),
    resetAction('Corte', () => { st.crop = fresh('crop'); st.pixel.scale = 100; }),
] };
const LUZ_TOOL = { id: 'luz', label: 'Luz', controls: () => [
    R('adj.exposure', 'Exposição', 'exposure', -100, 100), R('adj.brightness', 'Brilho', 'brightness', -100, 100), R('adj.contrast', 'Contraste', 'contrast', -100, 100),
    R('adj.shadows', 'Sombras', 'shadows', -100, 100), R('adj.temperature', 'Temperatura', 'temp', -100, 100), R('adj.saturation', 'Saturação', 'saturation', -100, 100),
    T('adj.shadowsInverted', 'Inverter sombras', 'invert'),
    resetAction('Luz', () => { st.adj = fresh('adj'); }),
] };
const COR_TOOL = { id: 'cor', label: 'Cor', controls: () => {
    const c = st.color, g = st.grad, duo = c.sel === 'duotone' || c.sel === 'tritone';
    const list = [C('color.sel', 'Cores', 'palette', COLOR_OPTS, { onPick: pickColorCount })];
    if (duo) {
        list.push(K('color.duo.0', 'Sombras'), K('color.duo.1', c.sel === 'tritone' ? 'Meios-tons' : 'Luzes'));
        if (c.sel === 'tritone') list.push(K('color.duo.2', 'Luzes'));
        list.push(X('duolib', 'Prontas', 'styles', editDuoLibrary));
    } else {
        list.push(X('library', 'Prontas', 'styles', editPaletteLibrary));
        if (c.sel !== 'all') list.push(X('palette', 'Editar cores', 'color', editPalette, { lockKey: 'color.palette' }),
            R('color.hue', 'Girar cores', 'hue', -180, 180), R('color.sat', 'Cores vivas', 'saturation', -100, 100), R('color.light', 'Clarear cores', 'light', -100, 100),
            A('Embaralhar', 'swap', paletteShuffleOrder), A('Da foto', 'photo', paletteFromPhoto), A('Salvar paleta', 'save', savePalette));
    }
    list.push(T('color.invert', 'Inverter', 'invert', { onPick: toggleInvert }));
    list.push(D('Degradê'), T('grad.on', 'Ligado', 'gradient'));
    if (g.on) {
        list.push(X('gradcolors', 'Cores', 'palette', editGradColors), C('grad.type', 'Forma', 'gradient', GRAD_TYPE_OPTS),
            C('_grad.blend', 'Mistura', 'layers', BLEND_OPTS, { get: () => gradBlend(), onPick: (v) => { st.grad.blend = v === 'normal' ? 'source-atop' : v; change(null, null); } }),
            R('grad.opacity', 'Opacidade', 'opacity', 0, 100));
        if (GRAD_ANGLE_SHAPES.has(g.type)) list.push(R('grad.angle', 'Ângulo', 'angle', 0, 360, { step: 5 }));
        if (GRAD_CENTER_SHAPES.has(g.type)) list.push(R('grad.cx', 'Centro X', 'center', 0, 100), R('grad.cy', 'Centro Y', 'center', 0, 100));
        list.push(R('grad.scale', 'Escala', 'scale', 10, 400, { step: 5 }), R('grad.repeat', 'Repetir', 'repeat', 1, 8), T('grad.mirror', 'Espelhar', 'mirror'),
            R('grad.steps', 'Faixas', 'steps', 0, 30), R('grad.pos', 'Posição', 'position', 0, 100), R('grad.smooth', 'Suavidade', 'smooth', 0, 100), R('grad.noise', 'Ruído', 'noise', 0, 100));
    }
    list.push(resetAction('Cor', () => { st.color = fresh('color'); st.grad = fresh('grad'); }));
    return list;
} };
const PIXEL_TOOL = { id: 'pixel', label: 'Pixel', controls: () => {
    const list = [R('pixel.size', 'Tamanho do pixel', 'pixel', 1, 64),
        C('dither.mode', 'Padrão', 'pattern', DITHER_OPTS, { view: 'thumbs', detail: true, variant: (s, v) => { s.dither.mode = v; if (v !== 'none' && s.dither.intensity < 40) s.dither.intensity = 100; } })];
    if (st.dither.mode !== 'none') list.push(R('dither.scale', 'Escala do padrão', 'scale', 1, 10), R('dither.intensity', 'Intensidade', 'intensity', 0, 200),
        R('dither.opacity', 'Opacidade', 'opacity', 0, 100), T('dither.midOnly', 'Só meios-tons', 'mid'));
    list.push(D('Agrupar'), R('pixel.group', 'Força', 'styles', 0, 100, { step: 25, fmt: (v) => v ? Math.round(v / 25) + '×' : '0' }));
    if (st.pixel.group > 0) list.push(C('pixel.groupRadius', 'Alcance', 'scale', [[1, 'Perto'], [2, 'Longe']]), R('pixel.groupTol', 'Semelhança', 'contrast', 0, 100));
    list.push(D('Contorno'), R('edge.size', 'Espessura', 'edge', 0, 10));
    if (st.edge.size > 0) list.push(R('edge.opacity', 'Opacidade', 'opacity', 0, 100), K('edge.color', 'Cor'));
    list.push(resetAction('Pixel', () => { const sc = st.pixel.scale; st.pixel = fresh('pixel'); st.pixel.scale = sc; st.dither = fresh('dither'); st.edge = fresh('edge'); }));
    return list;
} };
const TEXTURA_TOOL = { id: 'textura', label: 'Textura', controls: () => {
    const list = [C('fx.id', 'Textura', 'fx', FX_OPTS(), { view: 'thumbs', groupsOf: FX_GROUPS(), variant: (s, v) => { s.fx.id = v; if (s.fx.mix < 30) s.fx.mix = 100; } })];
    if (st.fx.id !== 'none') list.push(R('fx.mix', 'Intensidade', 'intensity', 0, 100), ...fxParamControls(st.fx.id, []));
    list.push(resetAction('Textura', () => { if (st.fx.id !== 'none') delete st.fxParams[st.fx.id]; st.fx = fresh('fx'); }));
    return list;
} };
const FX_OPTS = () => [['none', 'Nenhum'], ...PixelarFX.listEffects().map(f => [f.id, f.nome])];
const FILME_TOOL = { id: 'filme', label: 'Filme', controls: () => {
    const look = FILM_LOOKS[st.film.look];
    const list = [C('film.look', 'Filme', 'film', FILM_OPTS, { view: 'thumbs', groupsOf: FILM_LOOK_DEFS, variant: (s, v) => { s.film.look = v; if (v !== 'none' && s.film.mix < 30) s.film.mix = 100; } })];
    if (look) list.push(R('film.mix', 'Intensidade', 'intensity', 0, 100));
    if (look && look.fx === 'lumiere') list.push(R('film.lumiereHue', 'Matiz', 'hue', 0, 360));
    if (look && look.fx === 'vencido') list.push(C('film.vencido', 'Variação', 'film', [[0, 'Quente'], [1, 'Névoa magenta'], [2, 'Frio'], [3, 'Desbotado']]));
    if (look && look.fx) list.push(...fxParamControls(look.fx, ['uVariant', 'uHue'], FILM_FX_LABELS[look.fx]));
    if (look && !look.fx) list.push(R('film.grainAmt', 'Grão do filme', 'grain', 0, 200, { step: 5 }));
    list.push(resetAction('Filme', () => { Object.assign(st.film, { look: 'none', mix: 100, grainAmt: 100 }); }));
    return list;
} };
// Lente e grão (Editar): ajustes de câmera que valem com ou sem filme
const LENTE_TOOL = { id: 'lente', label: 'Lente', controls: () => {
    const list = [R('grain.amount', 'Grão', 'grain', 0, 100)];
    if (st.grain.amount > 0) list.push(R('grain.size', 'Tamanho', 'size', 10, 400, { step: 5 }), R('grain.rough', 'Aspereza', 'rough', 0, 100),
        R('grain.bias', 'Sombras ↔ luzes', 'bias', -100, 100), R('grain.speckle', 'Manchas', 'speckle', 0, 100), T('grain.mono', 'Monocromático', 'mono'));
    list.push(D('Lente'),
        R('film.vignette', 'Vinheta', 'vignette', 0, 100), K('film.vigColor', 'Cor da vinheta', { ensure: () => { if (!st.film.vignette) st.film.vignette = 50; } }),
        R('film.bloom', 'Brilho difuso', 'bloom', 0, 100), R('film.halation', 'Halação', 'halation', 0, 100),
        R('film.soft', 'Suavidade', 'soft', 0, 100), R('film.distort', 'Distorção', 'distort', -100, 100), R('film.chroma', 'Aberração', 'chroma', 0, 100),
        R('film.leak', 'Vazamento', 'leak', 0, 100), K('film.leakColor', 'Cor do vazamento', { ensure: () => { if (!st.film.leak) st.film.leak = 50; } }),
        resetAction('Lente', () => { const f = fresh('film'); LENS_KEYS.concat(['vigColor', 'leakColor']).forEach(k => { st.film[k] = f[k]; }); st.grain = fresh('grain'); }));
    return list;
} };
const PAINT_MODE_OPTS = [['none', 'Desligado'], ['regions', 'Regiões'], ['pixels', 'Pixels']];
const PINTURA_TOOL = { id: 'pintura', label: 'Pintura', controls: () => {
    const p = st.paint, regions = p.mode === 'regions';
    const list = [C('paint.mode', 'Modo', 'brush', PAINT_MODE_OPTS, { view: 'thumbs', variant: (s, v) => { s.paint.mode = v; } })];
    if (p.mode !== 'none') {
        // quantidade de cores, detalhe/tamanho e manchas: tudo ajustável
        list.push(R('paint.colors', 'Cores', 'palette', 2, 64));
        if (regions) list.push(R('paint.detail', 'Detalhe', 'scale', 0, 100), R('paint.minArea', 'Manchas mínimas', 'size', 1, 80), R('paint.smooth', 'Arredondar', 'smooth', 0, 4));
        else list.push(R('paint.size', 'Células', 'pixel', 4, 600));
        list.push(D('Traço'), R('paint.lines', 'Linhas', 'edge', 0, 100), K('paint.ink', 'Cor do traço'));
    }
    list.push(resetAction('Pintura', () => { st.paint = fresh('paint'); }));
    return list;
} };
const DUPLA_TOOL = { id: 'dupla', label: 'Dupla', controls: () => {
    const d = st.dbl;
    const list = [T('dbl.on', 'Ligado', 'layers', { onPick: (v) => { d.on = v; if (v && d.src === 'image' && !DblImage.img) d.src = 'self'; change(null, null, { dials: true }); } }),
        A('Escolher foto', 'upload', () => $('dblInput').click()),
        C('dbl.src', 'Fonte', 'image', DBL_SRC_OPTS, { onPick: (v) => { d.on = true; if (v === 'image' && !DblImage.img) setTimeout(() => $('dblInput').click(), 50); } })];
    if (!d.on) return list;
    if (['clouds', 'light', 'leaves'].includes(d.src)) list.push(A('Outra variação', 'reset', () => { d.seed = 1 + Math.floor(Math.random() * 999); change(null, null); }));
    list.push(C('dbl.blend', 'Mistura', 'layers', DBL_BLEND_OPTS), R('dbl.op', 'Opacidade', 'opacity', 0, 100), T('dbl.pre', 'Antes da paleta', 'palette'),
        D('Posição'), R('dbl.scale', 'Tamanho', 'scale', 20, 400, { step: 5 }), R('dbl.x', 'Horizontal', 'move', -100, 100), R('dbl.y', 'Vertical', 'move', -100, 100),
        R('dbl.rot', 'Girar', 'rotate', -180, 180), T('dbl.flip', 'Espelhar', 'flipH'),
        D('Máscara'), C('dbl.mask', 'Máscara', 'contrast', DBL_MASK_OPTS));
    if (d.mask !== 'none') list.push(R('dbl.maskLo', 'Limite', 'mid', 0, 100), R('dbl.maskSoft', 'Suavidade', 'soft', 0, 100), T('dbl.maskInv', 'Inverter máscara', 'invert'));
    list.push(D('Cor'), C('dbl.tone', 'Tom', 'palette', DBL_TONE_OPTS));
    if (d.tone === 'tint') list.push(K('dbl.tint', 'Cor do tom'));
    list.push(R('dbl.contrast', 'Contraste', 'contrast', -100, 100), R('dbl.bright', 'Brilho', 'brightness', -100, 100), R('dbl.sat', 'Saturação', 'saturation', -100, 100),
        resetAction('Dupla exposição', () => { st.dbl = fresh('dbl'); }));
    return list;
} };
const MOV_TOOL = { id: 'movimento', label: 'Animar', controls: () => {
    const a = st.anim, list = [];
    if (M.type === 'video') list.push(T('anim.videoSync', 'Aplicar no vídeo', 'video'));
    list.push(C('anim.cycles', 'Velocidade', 'speed', [[1, 'Lenta'], [2, 'Média'], [3, 'Rápida'], [4, 'Muito rápida']]),
        C('anim.direction', 'Sentido', 'direction', [['forward', 'Para frente'], ['reverse', 'Para trás']]),
        C('anim.duration', 'Duração do loop', 'clock', [[1, '1 s'], [2, '2 s'], [3, '3 s'], [4, '4 s'], [6, '6 s'], [8, '8 s']]),
        C('anim.fps', 'Quadros/s', 'fps', [[12, '12'], [24, '24'], [30, '30'], [50, '50'], [60, '60']]));
    // só o que existe na imagem pode se mover
    const has = { dither: st.dither.mode !== 'none', fx: st.fx.id !== 'none', grain: st.grain.amount > 0 || !!(FILM_LOOKS[st.film.look] && !FILM_LOOKS[st.film.look].fx), film: st.film.look !== 'none' };
    if (Object.values(has).some(Boolean)) list.push(D('O que se move'));
    if (has.dither) {
        list.push(T('anim.dither', 'Padrão', 'pattern'));
        if (a.dither) {
            const sig = DITHER_SIGNATURE[st.dither.mode], style = a.dStyle === 'auto' ? (sig ? sig.style : 'auto') : a.dStyle;
            list.push(C('anim.dStyle', 'Movimento do padrão', 'wave', DITHER_STYLE_OPTS.map(k => [k, k === 'auto' ? 'Próprio do padrão' : DITHER_STYLES[k].nome])));
            if (a.dStyle !== 'auto' && ['drift', 'wave', 'sweep'].includes(style)) list.push(R('anim.dAngle', 'Direção', 'angle', 0, 315, { step: 45 }));
            if (['wave', 'ripple', 'sweep', 'spiral'].includes(style)) list.push(R('anim.dWave', 'Comprimento', 'wave', 8, 400, { step: 4 }));
        }
    }
    if (has.fx) { list.push(T('anim.fx', 'Textura', 'fx')); if (a.fx) list.push(C('anim.fxStyle', 'Movimento da textura', 'wave', opts(FX_STYLE_NAMES))); }
    if (has.grain) { list.push(T('anim.grain', 'Grão', 'grain')); if (a.grain) list.push(C('anim.grainStyle', 'Movimento do grão', 'wave', opts(GRAIN_ANIM_NAMES))); }
    if (has.film) { list.push(T('anim.film', 'Filme', 'film')); if (a.film) list.push(C('anim.filmStyle', 'Movimento do filme', 'wave', opts(FILM_ANIM_NAMES))); }
    list.push(resetAction('Movimento', () => { st.anim = Object.assign(fresh('anim'), { videoSync: a.videoSync }); }));
    return list;
} };

const TABS = [
    // Estilos: a tela inicial tem fileiras horizontais (Prontos, Texturas, Filmes, Pintura, Meus estilos);
    // tocar num efeito aplica e abre as configurações dele (com “‹ Estilos” para voltar)
    { id: 'estilos', label: 'Estilos', icon: 'tab-styles', groups: () => [{ id: 'mine', label: 'Estilos', controls: () => [X('mine', 'Estilos', 'styles', () => {})] }, TEXTURA_TOOL, FILME_TOOL, PINTURA_TOOL] },
    { id: 'editar', label: 'Editar', icon: 'tab-edit', groups: () => [CROP_TOOL, LUZ_TOOL, COR_TOOL, PIXEL_TOOL, LENTE_TOOL, DUPLA_TOOL, MOV_TOOL] },
    { id: 'exportar', label: 'Exportar', icon: 'tab-export', groups: () => [{ id: 'exp', label: 'Exportar', controls: () => [X('exp', 'Exportar', 'download', exportPanel)] }] },
];
function groupControls(g) {
    const list = g.controls();
    if (!RANDOM_GROUPS[g.id]) return list;
    return [A(ui.tab === 'editar' ? 'Sortear' : 'Sortear ' + g.label, 'dice', () => rollTool(g.id)),
        T(null, 'Travar', 'lock', { get: () => !prefs.groups.has(g.id), onPick: (v) => setToolLock(g.id, v) }), ...list];
}
const gradBlend = () => st.grad.blend === 'source-atop' ? 'normal' : st.grad.blend;


// ícone de um parâmetro de textura, pelo nome
function fxIcon(k) {
    const n = k.toLowerCase(), m = [[/angle|rot|dir/, 'angle'], [/speed|time|anim/, 'speed'], [/size|scale|cell|zoom|freq|spacing|density|count|grid|lines/, 'scale'], [/contrast|thresh|level|cut/, 'contrast'],
        [/bright|light|glow|bloom|exposure/, 'brightness'], [/sat|hue|color|tint/, 'palette'], [/noise|grain|rand|jitter/, 'noise'], [/blur|soft|smooth/, 'soft'], [/wave|amp|warp|distort|bend/, 'wave'],
        [/thick|width|edge|outline|line/, 'edge'], [/mix|amount|strength|intens|opac/, 'intensity'], [/x$|y$|pos|offset|center/, 'position']];
    for (const [re, ic] of m) if (re.test(n)) return ic;
    return 'fx';
}
// nomes próprios para parâmetros de filme que repetiriam outro ajuste da mesma fileira
const FILM_FX_LABELS = { vencido: { uIntensity: 'Desgaste', uLeak: 'Cor da mancha' }, lumiere: { uAmount: 'Tingimento' } };
function fxParamControls(id, hidden, names = {}) {
    const def = PixelarFX.getEffectDef(id); if (!def) return [];
    const list = [], groups = {};
    Object.keys(def.uniforms).forEach(k => {
        if (hidden.includes(k)) return;
        const m = k.match(/^(.*)_(r|g|b)$/);
        if (m) { groups[m[1]] = true; return; }
        const dv = def.uniforms[k];
        const r = (FX_RANGES_BY_EFFECT[id] || {})[k] || FX_RANGES[k] || (dv < 0 ? [-Math.abs(dv * 3 + 1), Math.abs(dv * 3 + 1)] : [0, Math.max(dv * 3, dv + 1, 1)]);
        const span = r[1] - r[0];
        list.push(R('fxParams.' + id + '.' + k, names[k] || FX_LABELS[k] || k.replace(/^u/, ''), fxIcon(k), r[0], r[1], { step: span / 200, fmt: (v) => Math.round((v - r[0]) / span * 100) }));
    });
    Object.keys(groups).forEach(p => list.push(K('fxcolor.' + id + '.' + p, names[p] || FX_COLOR_LABELS[p] || p.replace(/^u/, ''))));
    return list;
}

// ============================================================
// PAINEL
// ============================================================
// ícones pequenos das ferramentas
const GROUP_ICONS = { crop: 'crop', luz: 'brightness', cor: 'palette', pixel: 'pixel', lente: 'vignette', textura: 'pattern', filme: 'film', pintura: 'brush', dupla: 'layers', movimento: 'wave' };
function tabGroups(t) { return typeof t.groups === 'function' ? t.groups() : t.groups; }
function currentTab() { return TABS.find(t => t.id === ui.tab); }
function currentGroup() { const gs = tabGroups(currentTab()); const gid = ui.group[ui.tab]; return gs.find(g => g.id === gid) || gs[0]; }
let dialEls = [];
// ============================================================
// PAINEL (redesign “Sol”): Estilos, Editar e Exportar montados no mesmo contêiner (#editor)
//   Celular:     [ferramenta aberta: cabeçalho + lista] [linha das 7 ferramentas] [abas]
//   Computador:  [abas] [ferramentas empilhadas, cada uma abre e fecha]
// Cada ajuste é uma linha: nome, régua e valor. Nada de fileiras compridas na horizontal.
// ============================================================
let rows = [];            // linhas vivas: atualizam o valor sem remontar o painel
ui.sec = {}; ui.exp = {}; ui.acc = new Set(['luz']); ui.styleCat = null; ui.styleGroup = {}; ui.styleAdjust = false;
function refreshDials() { rows = rows.filter(r => r.el.isConnected); rows.forEach(r => r.sync()); }
function rebuildDials() { buildPanel(); }
function buildPanel() {
    const tab = currentTab(), panel = $('panel'), ed = $('editor'), open = !!ui.open[tab.id];
    // a remontagem nunca pula: guarda a rolagem de cada área rolável (pela chave) e do painel
    const keep = [...ed.querySelectorAll('[data-scroll]')].map(x => [x.dataset.scroll, x.scrollTop, x.scrollLeft]);
    const same = ed.dataset.tab === tab.id, top = ed.scrollTop;
    ed.innerHTML = ''; rows = []; ed.dataset.tab = tab.id; panel.dataset.tab = tab.id;
    panel.classList.toggle('closed', tab.id !== 'editar' && !open);
    if (M.el) {
        if (tab.id === 'editar') buildEditView(ed);
        else if (open) (tab.id === 'estilos' ? buildStylesView : buildExportView)(ed);
    }
    keep.forEach(([k, t, l]) => { const x = ed.querySelector(`[data-scroll="${CSS.escape(k)}"]`); if (x) { x.scrollTop = t; x.scrollLeft = l; } });
    if (same) ed.scrollTop = top;
}

// ---------- cabeçalho de uma ferramenta: nome e ações (sortear, travar, restaurar) ----------
function headBtn(ic, label, run, on) {
    const b = h('button', 'hbtn' + (on ? ' on' : ''), icon(ic)); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label);
    if (on !== undefined) b.setAttribute('aria-pressed', String(!!on));
    b.onclick = run; return b;
}
function toolHead(title, { back, dice, lock, reset } = {}) {
    const hd = h('div', 'thead');
    if (back) { const b = h('button', 'tback', icon('back') + '<span></span>'); b.type = 'button'; b.lastChild.textContent = title; b.setAttribute('aria-label', 'Voltar'); b.onclick = back; hd.append(b); }
    else if (title) { const t = h('h2', 'ttitle'); t.textContent = title; hd.append(t); }
    hd.append(h('span', 'tfill'));
    if (dice) hd.append(headBtn('dice', 'Sortear só ' + title, dice));
    if (lock) hd.append(headBtn('lock', lock.on ? title + ' travada no dado' : 'Travar ' + title + ' no dado', lock.run, lock.on));
    if (reset) hd.append(headBtn('reset', 'Restaurar ' + title, reset));
    return hd;
}
// ajustes de uma ferramenta (o “Restaurar” vai para o cabeçalho)
function splitReset(list) { const r = list.find(c => c.kind === 'action' && c.label === 'Restaurar'); return [list.filter(c => c !== r), r]; }
function toolPanel(g, withTitle = true) {
    const box = h('section', 'tool');
    const [list, reset] = splitReset(g.controls().filter(c => !c.hidden));
    const lockable = !!RANDOM_GROUPS[g.id], locked = lockable && !prefs.groups.has(g.id);
    box.append(toolHead(withTitle ? g.label : '', {
        dice: lockable ? () => rollTool(g.id) : null,
        lock: lockable ? { on: locked, run: () => setToolLock(g.id, prefs.groups.has(g.id)) } : null,
        reset: reset ? () => reset.run() : null,
    }));
    const body = h('div', 'tlist'); body.dataset.scroll = 'list:' + g.id;
    fillList(body, list, g.id);
    box.append(body);
    return box;
}
// quantos ajustes a ferramenta tem mexidos (resumo e ponto na ferramenta)
function toolCount(g) { try { return g.controls().filter(c => c.kind !== 'divider' && !c.hidden && isModified(c)).length; } catch (e) { return 0; } }

// ---------- lista: seções, linhas e ações ----------
// a primeira parte fica sempre aberta; as outras (Degradê, Agrupar, Contorno…) abrem ao tocar
function fillList(list, controls, scope) {
    const secs = [{ label: null, items: [] }];
    controls.forEach(c => { if (c.kind === 'divider') secs.push({ label: c.label, items: [] }); else secs[secs.length - 1].items.push(c); });
    let first = true;
    secs.forEach(s => {
        if (s.label) {
            const k = scope + '|' + s.label, n = s.items.filter(isModified).length + s.items.filter(c => c.kind === 'toggle' && !c.key && ctrlValue(c)).length;
            const open = ui.sec[k] !== undefined ? ui.sec[k] : n > 0;
            const hd = h('button', 'sec' + (open ? ' open' : '') + (n ? ' mod' : '')); hd.type = 'button'; hd.setAttribute('aria-expanded', String(open));
            hd.innerHTML = '<span class="sec-t"></span><span class="sec-v"></span>' + icon(open ? 'chev-d' : 'chev');
            hd.firstChild.textContent = s.label; hd.children[1].textContent = n ? n + (n > 1 ? ' ajustes' : ' ajuste') : 'desligado';
            hd.onclick = () => { ui.sec[k] = !open; fitAnim(); buildPanel(); };
            list.append(hd);
            if (!open) return;
        }
        appendItems(list, s.items, first); first = false;
    });
}
function appendItems(list, items, firstSec) {
    let acts = null;
    items.forEach((c, i) => {
        if (c.kind === 'action') {
            if (!acts) { acts = h('div', 'acts'); list.append(acts); }
            const b = h('button', 'act', smallIcon(c.icon) + '<span></span>'); b.type = 'button'; b.lastChild.textContent = c.label; b.onclick = () => c.run();
            acts.append(b); return;
        }
        acts = null;
        list.append(makeRow(c, firstSec && i === 0));
    });
}
const lockKeyOf = (c) => (c.lockKey || c.key) && !(c.lockKey || c.key).startsWith('_') ? (c.lockKey || c.key) : null;
function lockMark(el, c) {
    const k = lockKeyOf(c); if (!k) return () => {};
    const sync = () => el.classList.toggle('locked', prefs.locks.has(k));
    onHold(el, () => { toggleLock(k); refreshDials(); });
    return sync;
}
function makeRow(c, lead) {
    if (c.kind === 'range') return makeFader(c);
    if (c.kind === 'toggle') {
        const b = h('button', 'row rtog'); b.type = 'button';
        b.innerHTML = '<span class="rname"></span><span class="sw" aria-hidden="true"><i></i></span>'; b.firstChild.textContent = c.label;
        const lk = lockMark(b, c);
        const sync = () => { const on = !!ctrlValue(c); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); lk(); };
        b.onclick = () => { const nv = !ctrlValue(c); if (c.onPick) c.onPick(nv); else change(c.key, nv, { dials: grpDependsOn(c.key) }); sync(); };
        rows.push({ el: b, sync }); sync(); return b;
    }
    if (c.kind === 'color') {
        const b = h('button', 'row rcolor'); b.type = 'button';
        b.innerHTML = '<span class="rname"></span><span class="rval"></span><span class="swatch" aria-hidden="true"></span>'; b.firstChild.textContent = c.label;
        const lk = lockMark(b, c);
        const sync = () => { const v = ctrlValue(c) || '#000000'; b.querySelector('.swatch').style.background = v; b.children[1].textContent = String(v).toUpperCase(); lk(); };
        b.onclick = () => pickColor(ctrlValue(c), (hex, final) => { if (c.ensure) c.ensure(); change(c.key, hex, { soft: !final }); sync(); if (final && c.ensure) buildPanel(); }, c.label);
        rows.push({ el: b, sync }); sync(); return b;
    }
    // escolhas e editores próprios: a linha abre e fecha o conteúdo logo abaixo
    const thumbs = c.kind === 'choice' && c.view === 'thumbs';
    const k = 'x:' + ctrlId(c), open = ui.exp[k] !== undefined ? ui.exp[k] : (thumbs || (lead && c.kind === 'choice'));
    const wrap = h('div', 'rgroup' + (open ? ' open' : ''));
    const b = h('button', 'row rpick'); b.type = 'button'; b.setAttribute('aria-expanded', String(open));
    b.innerHTML = '<span class="rname"></span><span class="rval"></span>' + icon(open ? 'chev-d' : 'chev'); b.firstChild.textContent = c.label;
    const lk = lockMark(b, c);
    const sync = () => { b.children[1].textContent = c.kind === 'choice' ? valText(c, ctrlValue(c)) : ''; b.classList.toggle('mod', isModified(c)); lk(); };
    b.onclick = () => { ui.exp[k] = !open; fitAnim(); buildPanel(); };
    wrap.append(b);
    if (open) {
        const body = h('div', 'rbody');
        if (thumbs) body.append(makeThumbChoice(c, true));
        else if (c.kind === 'choice') body.append(makeChips(c));
        else if (M.el) c.editor(body, c);
        const n = c.kind === 'choice' ? choiceNote(c) : ''; if (n) body.append(h('div', 'editor-note', n));
        wrap.append(body);
    }
    rows.push({ el: b, sync }); sync();
    return wrap;
}

// ---------- régua de uma linha: arrastar na horizontal, tocar para pular, toque duplo volta ao padrão ----------
function makeFader(c, opts = {}) {
    const row = h('div', 'row fader'), name = h('span', 'rname'), track = h('span', 'ftrack'), val = h('span', 'fval');
    const fill = h('i', 'ffill'), knob = h('i', 'fknob'), mid = h('i', 'fmid');
    name.textContent = opts.label || c.label; track.append(fill, mid, knob); row.append(name, track, val);
    track.tabIndex = 0; track.setAttribute('role', 'slider'); track.setAttribute('aria-label', c.label);
    track.setAttribute('aria-valuemin', c.min); track.setAttribute('aria-valuemax', c.max);
    const def = c.def !== undefined ? c.def : (c.key ? defP(c.key) : undefined);
    const range = c.max - c.min || 1, step = c.step || 1;
    const hasDef = typeof def === 'number' && def >= c.min && def <= c.max;
    const get = () => { const x = c.get ? c.get() : getP(c.key); return typeof x === 'number' && isFinite(x) ? x : c.min; };
    const q = (x) => clampN(+(Math.round((x - c.min) / step) * step + c.min).toFixed(6), c.min, c.max);
    const fr = (x) => clampN((x - c.min) / range, 0, 1);
    let v = get();
    if (hasDef && def > c.min && def < c.max) mid.style.left = (fr(def) * 100) + '%'; else mid.remove();
    const paint = () => {
        const f = fr(v), d = hasDef ? fr(def) : 0, a = Math.min(f, d), b = Math.max(f, d);
        knob.style.left = (f * 100) + '%'; fill.style.left = (a * 100) + '%'; fill.style.width = ((b - a) * 100) + '%';
        row.classList.toggle('mod', hasDef ? Math.abs(v - def) > 1e-9 : true);
        val.textContent = valText(c, v); track.setAttribute('aria-valuenow', v); track.setAttribute('aria-valuetext', val.textContent);
    };
    const lk = lockMark(name, c);
    const emit = (final) => {
        if (c.set) c.set(v, final);
        else if (v !== getP(c.key)) { setP(c.key, v); if (c.key.startsWith('crop.')) Engine.invalidate(); requestRender(); Thumbs.stateChanged(); }
        if (final && !c.set) { commit(); updateSubbarCenter(); if (grpDependsOn(c.key)) buildPanel(); else refreshDials(); }
    };
    const setTo = (nv) => {
        nv = q(nv);
        if (hasDef && nv !== def && Math.abs(nv - def) <= range * 0.012) nv = def;   // ímã no padrão
        if (nv === v) return;
        if (hasDef && Math.sign(v - def) !== Math.sign(nv - def) && navigator.vibrate) navigator.vibrate(4);
        v = nv; paint(); emit(false);
    };
    const fromX = (x) => { const r = track.getBoundingClientRect(); return c.min + clampN((x - r.left) / r.width, 0, 1) * range; };
    // gesto: horizontal arrasta; vertical rola a lista (o navegador cancela o toque)
    let drag = null;
    track.addEventListener('pointerdown', (e) => { if (e.button > 0) return; v = get(); drag = { x: e.clientX, y: e.clientY, id: e.pointerId, on: e.pointerType === 'mouse' }; if (drag.on) { try { track.setPointerCapture(e.pointerId); } catch (_) {} row.classList.add('drag'); setTo(fromX(e.clientX)); } });
    track.addEventListener('pointermove', (e) => {
        if (!drag) return;
        if (!drag.on) {
            const dx = Math.abs(e.clientX - drag.x), dy = Math.abs(e.clientY - drag.y);
            if (dx < 5 && dy < 5) return;
            if (dy > dx) { drag = null; return; }
            drag.on = true; try { track.setPointerCapture(drag.id); } catch (_) {} row.classList.add('drag');
        }
        setTo(fromX(e.clientX));
    });
    track.addEventListener('pointerup', (e) => { if (!drag) return; const d = drag; drag = null; row.classList.remove('drag'); if (!d.on) setTo(fromX(e.clientX)); emit(true); });
    track.addEventListener('pointercancel', () => { if (!drag) return; const d = drag; drag = null; row.classList.remove('drag'); if (d.on) emit(true); });
    track.addEventListener('keydown', (e) => {
        const big = e.shiftKey ? 10 : 1, m = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
        if (m) { e.preventDefault(); setTo(v + m * step * big); emit(true); }
        else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); setTo(e.key === 'Home' ? c.min : c.max); emit(true); }
    });
    const reset = () => { if (!hasDef) return; v = def; paint(); emit(true); };
    track.addEventListener('dblclick', reset); name.addEventListener('dblclick', reset);
    const sync = () => { if (!drag) { v = get(); paint(); } lk(); };
    rows.push({ el: row, sync }); paint(); lk();
    return row;
}

// ---------- Editar ----------
function buildEditView(ed) {
    const tools = tabGroups(TABS.find(t => t.id === 'editar'));
    if (isSide()) {
        // computador: todas as ferramentas empilhadas; cada uma abre e fecha
        tools.forEach(g => {
            const open = ui.acc.has(g.id), n = toolCount(g);
            const box = h('section', 'acc' + (open ? ' open' : ''));
            const hd = h('button', 'acc-h' + (n ? ' mod' : '')); hd.type = 'button'; hd.setAttribute('aria-expanded', String(open));
            hd.innerHTML = icon('t-' + g.id) + '<span class="acc-t"></span><span class="acc-s"></span>' + icon(open ? 'chev-d' : 'chev');
            hd.children[1].textContent = g.label; hd.children[2].textContent = n ? n + (n > 1 ? ' ajustes' : ' ajuste') : '';
            if (RANDOM_GROUPS[g.id] && !prefs.groups.has(g.id)) hd.children[2].textContent = (n ? hd.children[2].textContent + ' · ' : '') + 'travada';
            hd.onclick = () => { if (open) ui.acc.delete(g.id); else { ui.acc.add(g.id); ui.editTool = g.id; } buildPanel(); };
            if (RANDOM_GROUPS[g.id]) onHold(hd, () => setToolLock(g.id, prefs.groups.has(g.id)));
            box.append(hd);
            if (open) box.append(toolPanel(g, false));
            ed.append(box);
        });
        return;
    }
    const grp = tools.find(g => g.id === ui.editTool) || null;
    ui.group.editar = grp ? grp.id : '';
    if (grp) ed.append(toolPanel(grp));
    const row = h('div', 'tool-row');
    tools.forEach(g => {
        const on = !!grp && grp.id === g.id;
        const b = h('button', 'tool-btn' + (on ? ' on' : '')); b.type = 'button'; b.title = g.label; b.setAttribute('aria-pressed', String(on));
        b.innerHTML = icon('t-' + g.id) + '<span class="t"></span>'; b.lastChild.textContent = g.label;
        if (toolCount(g)) b.append(h('span', 'dot'));
        if (RANDOM_GROUPS[g.id]) { if (!prefs.groups.has(g.id)) b.append(h('span', 'tlock', icon('lock'))); onHold(b, () => setToolLock(g.id, prefs.groups.has(g.id))); }
        b.onclick = () => { ui.editTool = on ? null : g.id; fitAnim(); buildPanel(); };
        row.append(b);
    });
    ed.append(row);
}

// ---------- segmentado (uma escolha entre poucas) ----------
function segmented(options, cur, onPick, label) {
    const box = h('div', 'segm'); box.setAttribute('role', 'group'); if (label) box.setAttribute('aria-label', label);
    box.style.setProperty('--n', options.length);
    options.forEach(([v, l]) => {
        const on = String(v) === String(cur), b = h('button', on ? 'on' : ''); b.type = 'button'; b.textContent = l; b.setAttribute('aria-pressed', String(on));
        b.onclick = () => { box.querySelectorAll('button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); }); onPick(v); };
        box.append(b);
    });
    return box;
}

// ---------- Estilos: categoria, grupo e grade; o escolhido ganha a barra de intensidade ----------
const STYLE_CATS = [['preset', 'Prontos'], ['fx', 'Texturas'], ['film', 'Filmes'], ['paint', 'Pintura'], ['mine', 'Meus']];
const styleCatOf = (kind) => kind;
function styleCatalog(cat) {
    const all = styleItems();
    const of = (kind) => all.filter(it => it.kind === kind);
    if (cat === 'fx') { const items = of('fx'); return FX_GROUPS().map(([g, list]) => ({ name: g, items: list.map(([id]) => items.find(it => it.id === id)).filter(Boolean) })); }
    if (cat === 'film') { const items = of('film'); return FILM_LOOK_DEFS.map(([g, list]) => ({ name: g, items: list.map(([id]) => items.find(it => it.id === id)).filter(Boolean) })); }
    if (cat === 'mine') return [{ name: null, items: [{ kind: 'add' }, ...of('mine')] }];
    return [{ name: null, items: of(cat) }];
}
function findStyleItem(sel) { return sel ? styleItems().find(it => it.kind === sel.kind && it.id === sel.id) : null; }
function selectStyle(it) {
    if (isSel(it)) { ui.styleSel = null; ui.styleAdjust = false; buildPanel(); return; }   // toque de novo: fecha
    if (!it.on()) {
        if (it.kind === 'preset' || it.kind === 'mine') applyPreset(it.label, it.kind === 'preset' ? builtinState(it.id) : prefs.presets[it.id]);
        else { const s = it.state(); if (it.kind === 'fx') st.fx = s.fx; else if (it.kind === 'film') st.film = s.film; else st.paint = s.paint; change(null, null); }
        flashLabel(it.label);
    }
    ui.styleSel = { kind: it.kind, id: it.id }; ui.styleAdjust = false; buildPanel();
}
function buildStylesView(ed) {
    const selIt = findStyleItem(ui.styleSel);
    if (ui.styleSel && (!selIt || !selIt.on())) { ui.styleSel = null; ui.styleAdjust = false; }
    if (ui.styleSel && ui.styleAdjust) {
        ed.append(toolHead(selIt.label, { back: () => { ui.styleAdjust = false; buildPanel(); } }));
        const body = h('div', 'tlist'); body.dataset.scroll = 'adj:' + selIt.kind + ':' + selIt.id;
        fillList(body, styleControls(ui.styleSel), 'style:' + selIt.kind);
        ed.append(body); return;
    }
    const cat = ui.styleCat || (ui.styleSel ? styleCatOf(ui.styleSel.kind) : (Object.keys(prefs.presets).length ? 'mine' : 'fx'));
    ui.styleCat = cat;
    const top = h('div', 'shead');
    top.append(segmented(STYLE_CATS, cat, (v) => { ui.styleCat = v; buildPanel(); }, 'Categoria'));
    ed.append(top);
    const groups = styleCatalog(cat);
    let gi = 0;
    if (groups.length > 1) {
        const want = ui.styleGroup[cat];
        gi = groups.findIndex(g => g.name === want);
        if (gi < 0) gi = Math.max(0, groups.findIndex(g => g.items.some(it => it.on())));
        const chips = h('div', 'sfilter');
        groups.forEach((g, i) => {
            const on = i === gi, b = h('button', 'fchip' + (on ? ' on' : '') + (g.items.some(it => it.on()) ? ' has' : '')); b.type = 'button'; b.setAttribute('aria-pressed', String(on));
            b.textContent = g.name; b.onclick = () => { ui.styleGroup[cat] = g.name; buildPanel(); };
            chips.append(b);
        });
        ed.append(chips);
    }
    const grid = h('div', 'sgrid'); grid.dataset.scroll = 'grid:' + cat + ':' + gi;
    const items = (groups[gi] || { items: [] }).items;
    items.forEach(it => {
        if (it.kind === 'add') {
            const a = h('button', 'thumb add'); a.type = 'button'; a.innerHTML = `<span class="pic">${icon('plus')}</span><span class="t">Salvar atual</span>`; a.onclick = saveUserPreset; grid.append(a); return;
        }
        const el = h('button', 'thumb' + (it.on() ? ' on' : '') + (isSel(it) ? ' sel' : '')); el.type = 'button'; el.title = it.label;
        el.setAttribute('aria-pressed', String(it.on()));
        const pic = h('span', 'pic'); el.append(pic, h('span', 't', '')); el.lastChild.textContent = it.label;
        Thumbs.attach(pic, 'bar:' + it.kind + ':' + it.id, it.state, it.kind !== 'preset' && it.kind !== 'mine');
        el.onclick = () => selectStyle(it);
        grid.append(el);
    });
    if (cat === 'mine' && items.length === 1) grid.append(h('p', 'empty', 'Ajuste a foto como quiser e toque em “Salvar atual” para guardar a combinação aqui.'));
    ed.append(grid);
    // barra do escolhido: intensidade e “Ajustar”
    if (selIt) {
        const main = styleControls(ui.styleSel).find(c => c.kind === 'range');
        const bar = h('div', 'sbar');
        if (main) bar.append(makeFader(main, { label: selIt.label })); else { const n = h('span', 'rname'); n.textContent = selIt.label; bar.append(n); }
        const adj = h('button', 'adjust', '<span>Ajustar</span>' + icon('chev')); adj.type = 'button';
        adj.onclick = () => { ui.styleAdjust = true; fitAnim(); buildPanel(); };
        bar.append(adj); ed.append(bar);
    }
}

// ---------- Exportar ----------
const rebuildExport = () => buildPanel();
function expBlock(label, el) { const b = h('div', 'xblock'); const l = h('span', 'xlabel'); l.textContent = label; b.append(l, el); return b; }
function exportPanel(ed) { buildExportView(ed); }
function buildExportView(ed) {
    const box = h('div', 'export'); ed.append(box);
    const isVid = M.type === 'video', fk = isVid ? 'vFormat' : 'format', fmts = exportFormats();
    if (!fmts.some(f => f[0] === exp[fk])) exp[fk] = fmts[0][0];
    const f = exp[fk];
    box.append(expBlock('Formato', segmented(fmts, f, (v) => { exp[fk] = v; saveExp(); buildPanel(); }, 'Formato')));
    let label = 'Salvar vídeo', run, info = '', infoSub = '', extra = [];
    if (!isVid && STILL.includes(f)) {
        if (anim.playing) stopAnim();
        const sizes = exportSizes(); if (!sizes.some(s => s.id === exp.size)) exp.size = 'orig';
        const cur = sizes.find(s => s.id === exp.size) || sizes[0];
        box.append(expBlock('Tamanho', segmented(sizes.map(s => [s.id, s.label]), exp.size, (v) => { exp.size = v; saveExp(); buildPanel(); }, 'Tamanho')));
        info = sizeText(cur.res); infoSub = 'px · ' + f.toUpperCase();
        label = 'Salvar imagem'; run = saveStill;
        if (navigator.clipboard && window.ClipboardItem) extra.push(['Copiar imagem', 'photo', copyImage]);
        extra.push(['Salvar ajustes', 'save', () => { Exporter.config(st); toast('Ajustes salvos num arquivo .txt'); }]);
    } else if (f === 'gif') {
        if (!isVid) ensureAnimPreview();
        box.append(expBlock('Tamanho', segmented([[360, 'Pequeno'], [480, 'Médio'], [720, 'Grande']], exp.gifSize, (v) => { exp.gifSize = +v; saveExp(); buildPanel(); }, 'Tamanho')));
        info = exp.gifSize + ' px'; infoSub = 'lado maior · GIF';
        label = 'Salvar GIF';
        run = () => isVid
            ? (pauseVideo(), runExport('GIF', (job) => Exporter.video(st, M.blob, Object.assign(job, { format: 'gif', res: exp.gifSize, fps: 15, mute: true, withAnim: st.anim.videoSync, trim: trimOf() })), 'gif'))
            : runExport('GIF', (job) => Exporter.animation(st, M.el, Object.assign(job, { format: 'gif', res: exp.gifSize, repeat: 1, key: 'main' + M.serial })), 'gif');
    } else if (isVid) {
        const H = video.videoHeight || 1080, vs = { screen: Math.min(720, H), orig: H, '2x': Math.min(2160, H * 2) };
        const opts = [['screen', 'Tela'], ['orig', 'Original'], ...(reRendered() && H < 2160 ? [['2x', '2×']] : [])];
        if (!opts.some(o => o[0] === exp.vSize)) exp.vSize = 'orig';
        box.append(expBlock('Tamanho', segmented(opts, exp.vSize, (v) => { exp.vSize = v; saveExp(); buildPanel(); }, 'Tamanho')),
            expBlock('Quadros por segundo', segmented([[24, '24'], [30, '30'], [60, '60']], exp.vFps, (v) => { exp.vFps = +v; saveExp(); }, 'Quadros por segundo')),
            expBlock('Som', segmented([['on', 'Com som'], ['off', 'Sem som']], exp.audio ? 'on' : 'off', (v) => { exp.audio = v === 'on'; saveExp(); }, 'Som')));
        info = (vs[exp.vSize] || H) + 'p'; infoSub = f.toUpperCase() + (trimOf() ? ' · trecho' : '');
        run = () => { pauseVideo(); runExport('Vídeo', (job) => Exporter.video(st, M.blob, Object.assign(job, { format: f, res: vs[exp.vSize] || H, fps: exp.vFps, mute: !exp.audio, withAnim: st.anim.videoSync, trim: trimOf() })), f); };
    } else {
        ensureAnimPreview();
        box.append(expBlock('Tamanho', segmented([['screen', 'Tela'], ['max', 'Máxima']], exp.aSize, (v) => { exp.aSize = v; saveExp(); buildPanel(); }, 'Tamanho')),
            expBlock('Repetir o loop', segmented([[1, '1×'], [3, '3×'], [5, '5×'], [10, '10×']], exp.aRepeat, (v) => { exp.aRepeat = +v; saveExp(); }, 'Repetir o loop')));
        info = (exp.aSize === 'screen' ? 720 : 2160) + ' px'; infoSub = 'lado maior · ' + f.toUpperCase();
        run = () => runExport('Vídeo', (job) => Exporter.animation(st, M.el, Object.assign(job, { format: f, res: exp.aSize === 'screen' ? 720 : 2160, repeat: exp.aRepeat, key: 'main' + M.serial })), f);
    }
    const inf = h('div', 'xinfo'); inf.innerHTML = '<span class="xbig"></span><span class="xsub"></span>'; inf.firstChild.textContent = info; inf.lastChild.textContent = infoSub; box.append(inf);
    const go = h('button', 'btn primary', icon('download') + '<span></span>'); go.type = 'button'; go.lastChild.textContent = label; go.onclick = run; box.append(go);
    if (extra.length) { const two = h('div', 'xtwo'); extra.forEach(([l, ic, fn]) => { const b = h('button', 'btn', smallIcon(ic) + '<span></span>'); b.type = 'button'; b.lastChild.textContent = l; b.onclick = fn; two.append(b); }); box.append(two); }
    if (!isVid && !animOn()) {
        const n = h('p', 'xnote'); n.append('Para GIF ou vídeo, ligue algo em ');
        const a = h('button', 'link', 'Animar'); a.type = 'button'; a.onclick = () => goTo('movimento'); n.append(a, '.');
        box.append(n);
    }
}

// ---------- progresso: o sol do logo acende linha a linha, de baixo para cima ----------
function sunMeter() {
    const bars = [[4, 1, 4], [2, 2, 8], [1, 3, 10], [1, 4, 10], [0, 5, 12], [0, 7, 12], [1, 9, 10], [3, 11, 6]];
    const el = h('div', 'sun-meter');
    el.innerHTML = `<svg viewBox="0 1 12 11" shape-rendering="crispEdges" aria-hidden="true">${bars.map(([x, y, w]) => `<rect x="${x}" y="${y}" width="${w}" height="1"/>`).join('')}</svg><span class="pct">0%</span>`;
    const rs = [...el.querySelectorAll('rect')].reverse(), pct = el.querySelector('.pct');
    return { el, set(p) { p = clampN(p || 0, 0, 1); const n = Math.round(p * rs.length); rs.forEach((r, i) => r.classList.toggle('on', i < n)); pct.textContent = Math.round(p * 100) + '%'; } };
}


// Abas embaixo, com o dado entre Editar e Exportar. Tocar na aba aberta fecha o painel dela.
function buildTabbar() {
    const bar = $('tabbar'), dice = $('btnDice'); bar.innerHTML = '';
    dice.innerHTML = '<span class="key">' + icon('dice') + '</span><span>Sortear</span>';
    TABS.forEach(t => {
        const b = h('button', 'tab' + (t.id === ui.tab ? ' on' : ''), icon(t.icon) + `<span>${t.label}</span>`);
        b.type = 'button'; b.dataset.tab = t.id; b.title = t.label;
        b.onclick = () => {
            if (panelCollapsed) setPanelCollapsed(false);
            if (ui.tab !== t.id) { selectTab(t.id); return; }
            if (t.id === 'editar') { if (!isSide()) { ui.editTool = null; fitAnim(); buildPanel(); } return; }
            setOpen(!ui.open[t.id]);
        };
        bar.append(b);
        if (t.id === 'editar') bar.append(dice);
    });
}
// painel da aba aberto ou fechado; a imagem acompanha o espaço que sobra
function setOpen(on) { ui.open[ui.tab] = !!on; fitAnim(); buildPanel(); }
// a foto acompanha suavemente quando o painel muda de altura
function fitAnim() { app.classList.add('fit-anim'); clearTimeout(app._fa); app._fa = setTimeout(() => app.classList.remove('fit-anim'), 400); }
// abre uma ferramenta de Editar já com um ajuste escolhido (usado pelas Camadas e pela dupla exposição)
const STYLE_KIND = { textura: 'fx', filme: 'film', pintura: 'paint' };
function goTo(groupId, key) {
    if (panelCollapsed) setPanelCollapsed(false);
    if (STYLE_KIND[groupId]) {
        const kind = STYLE_KIND[groupId], id = kind === 'fx' ? st.fx.id : kind === 'film' ? st.film.look : st.paint.mode;
        ui.styleSel = id !== 'none' ? { kind, id } : null; ui.styleAdjust = !!ui.styleSel; ui.styleCat = kind; ui.open.estilos = true;
        selectTab('estilos'); return;
    }
    ui.editTool = groupId; ui.acc.add(groupId); ui.open.editar = true;
    if (key) ui.exp['x:' + key] = true;
    selectTab('editar');
}
function selectTab(id) {
    if (!TABS.some(t => t.id === id)) id = TABS[0].id;
    const was = ui.tab; ui.tab = id;
    if (id !== 'editar') ui.open[id] = true;      // Estilos e Exportar abrem ao entrar; Editar lembra se havia ferramenta aberta
    document.querySelectorAll('#tabbar .tab[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === id));
    $('panel').dataset.tab = id;
    if (was === 'exportar' && id !== 'exportar') stopAnim();
    buildPanel(); updateSubbarCenter();
}

// Ao remontar a MESMA ferramenta (depois de um toque), tudo fica exatamente onde estava:
// fileira de ajustes, faixa de miniaturas e ferramentas. Ao trocar, o ajuste ativo fica à vista.
let lastPanelKey = null;
function panelKey() { return ui.tab + '/' + currentGroup().id; }
const isCtrl = (c) => c.kind !== 'divider';
function pickActive(controls, key) {
    return controls.find(c => isCtrl(c) && ctrlId(c) === ui.active[key])
        || controls.find(c => c.kind === 'choice' || c.kind === 'custom' || c.kind === 'range') || controls.find(isCtrl);
}
// Ferramenta aberta tem duas telas: a LISTA (todos os ajustes, em seções, com o valor de cada um)
// e o DETALHE (um ajuste com o seu controle e um “voltar”). Nada de fileiras compridas na horizontal.
const isThumbs = (c) => c && c.kind === 'choice' && c.view === 'thumbs';
const isEditable = (c) => c && !isThumbs(c) && (c.kind === 'range' || c.kind === 'choice' || c.kind === 'custom');
const listScroll = {};
// centraliza um item dentro da sua fileira sem rolar a página inteira
function centerIn(row, el) { if (!row || !el) return; row.scrollLeft = el.offsetLeft - row.clientWidth / 2 + el.offsetWidth / 2; }
// a opção escolhida fica à vista dentro do editor (as opções agora quebram em linhas e rolam na vertical)
function revealInEditor(el) {
    const ed = $('editor'); if (!el || ed.scrollHeight <= ed.clientHeight) return;
    const r = el.getBoundingClientRect(), er = ed.getBoundingClientRect();
    if (r.top < er.top || r.bottom > er.bottom) ed.scrollTop += r.top - er.top - (er.height - r.height) / 2;
}
const ctrlId = (c) => c.key || c.id || c.label;

function ctrlValue(c) { return c.get ? c.get() : c.key ? getP(c.key) : undefined; }
function isModified(c) {
    if (!c.key || c.key.startsWith('_')) return false;
    const v = ctrlValue(c), d = defP(c.key);
    return JSON.stringify(v) !== JSON.stringify(d) && !(typeof v === 'number' && Math.abs(v - d) < 1e-9);
}
function fmtVal(c, v) { if (c.fmt) return c.fmt(v); return Math.abs(v) >= 100 || Number.isInteger(v) ? Math.round(v) : (Math.round(v * 10) / 10); }

// valor como aparece na lista
function valText(c, v) {
    if (c.kind === 'choice') { const o = c.options.find(x => String(x[0]) === String(v)); return o ? o[1] : ''; }
    if (typeof v !== 'number') return '';
    const f = fmtVal(c, v); return c.min < 0 && c.max > 0 && v > 0 ? '+' + f : String(f);
}
// controles cujo valor muda quais outros controles aparecem
const DEPENDS = new Set(['paint.mode', 'dbl.src', 'dbl.mask', 'dbl.tone', 'dbl.on', 'grad.on', 'grad.type', 'color.sel', 'film.look', 'fx.id', 'dither.mode', 'crop.aspect', 'crop.zoom', 'crop.rot',
    'grain.amount', 'pixel.group', 'edge.size', 'anim.dStyle', 'anim.dither', 'anim.fx', 'anim.grain', 'anim.film']);
function grpDependsOn(key) { return DEPENDS.has(key); }
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
    if (c && c.kind === 'custom' && ui.tab === 'editar') { buildPanel(); return; }
    const ed = $('editor');
    // refazer o MESMO editor nunca volta a faixa para o começo: guarda e devolve a rolagem
    const key = c ? (c.key || c.id || (c.editor && c.editor.name) || c.label) + '|' + ui.tab : null;
    const prev = key && key === lastEditorKey ? ed.scrollTop : null;
    lastEditorKey = key;
    ed.innerHTML = ''; ed.scrollTop = 0;
    if (!c) return;
    if (prev !== null) { ui.keepScroll = true; buildEditorInner(ed, c); ui.keepScroll = false; ed.scrollTop = prev; return; }
    buildEditorInner(ed, c);
}
function buildEditorInner(ed, c) {
    if (c.kind === 'range') { ed.append(makeRuler(c)); return; }
    // nota só abaixo dos chips (as miniaturas já ocupam a altura toda do editor)
    if (c.kind === 'choice') { if (c.view === 'thumbs') { ed.append(makeThumbChoice(c)); return; } ed.append(makeChips(c)); const n = choiceNote(c); if (n) ed.append(h('div', 'editor-note', n)); return; }
    if (c.kind === 'custom') { if (M.el) c.editor(ed, c); return; }
    ed.append(h('div', 'editor-note', c.kind === 'toggle' ? 'Toque para ligar ou desligar.' : ''));
}
function choiceNote(c) {
    if (c.key === 'film.look') { const l = FILM_LOOKS[st.film.look]; return l ? l.desc : 'Escolha um filme: a prévia usa a sua foto com os ajustes atuais.'; }
    if (c.key.startsWith('anim.')) { const parts = describeAnimation(Engine.readSettings(st), readAnim(st)); return parts.length ? 'Movimento: ' + parts.join(' + ') : 'Nada se move ainda: use um padrão, textura, grão ou filme.'; }
    return '';
}

// ---------- régua (como a do Fotos da Apple) ----------
// A agulha fica parada no centro e a régua corre por baixo do dedo, 1:1. Ao soltar, segue com
// inércia e para sozinha; nas pontas, estica como elástico e volta. Nada prende no zero:
// passar pelo valor padrão só dá um toque de vibração. Traços desenhados num canvas (leve no Android).
function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x))), m = x / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; }
function makeRuler(c, o = {}) {
    const box = h('div', 'rl-wrap'), head = h('div', 'rl-head'), valEl = h('span', 'rl-val');
    if (o.label) { const n = h('span', 'rl-name'); n.textContent = o.label === true ? c.label : o.label; head.append(n); }
    head.append(valEl);
    const el = h('div', 'ruler'); el.tabIndex = 0; el.setAttribute('role', 'slider'); el.setAttribute('aria-label', c.label);
    el.setAttribute('aria-valuemin', c.min); el.setAttribute('aria-valuemax', c.max);
    const cv = h('canvas'), cx2 = cv.getContext('2d'), needle = h('span', 'rl-needle');
    el.append(cv, needle);
    const getV = () => { const x = c.get ? c.get() : getP(c.key); return typeof x === 'number' && isFinite(x) ? x : c.min; };
    const def = c.def !== undefined ? c.def : defP(c.key);
    const range = c.max - c.min, step = c.step || 1;
    const ppu = clampN(range / step * 6, 320, 1100) / range;            // px por unidade
    const tick = niceStep(7 / ppu), major = tick * 5;                     // um traço a cada ~7 px
    const hasDef = typeof def === 'number' && def >= c.min && def <= c.max;
    const q = (x) => { const s = Math.round((x - c.min) / step) * step + c.min; return clampN(+s.toFixed(6), c.min, c.max); };
    const centered = c.min < 0 && c.max > 0;
    const fmtShow = (x) => { const f = fmtVal(c, x); return centered && x > 0 ? '+' + f : String(f); };
    let v = getV(), vis = v;            // v: valor; vis: posição desenhada (inclui o elástico)
    // cores do tema (lidas de vez em quando: o destaque muda com a foto)
    let col = null, colAt = 0;
    const colors = () => { const now = performance.now(); if (!col || now - colAt > 400) { const cs = getComputedStyle(el); col = { t: cs.getPropertyValue('--tick').trim() || '#888', m: cs.getPropertyValue('--tick-major').trim() || '#bbb', a: cs.getPropertyValue('--accent').trim() || '#fc0' }; colAt = now; } return col; };
    let drawQ = 0;
    const draw = () => {
        drawQ = 0;
        const W = el.clientWidth, H = el.clientHeight; if (!W || !H) return;
        const dpr = Math.min(3, window.devicePixelRatio || 1);
        if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
        cx2.setTransform(dpr, 0, 0, dpr, 0, 0); cx2.clearRect(0, 0, W, H);
        const k = colors(), mid = W / 2, lo = Math.min(def, v), hi = Math.max(def, v), fillOn = hasDef && Math.abs(v - def) > 1e-9;
        const t0 = Math.max(c.min, Math.ceil((vis - mid / ppu) / tick) * tick), t1 = Math.min(c.max, vis + mid / ppu);
        const px = (x) => Math.round(x * dpr) / dpr;
        for (let t = t0, i = 0; t <= t1 + 1e-9 && i < 2000; t = t0 + (++i) * tick) {
            const x = px(mid + (t - vis) * ppu);
            const isMaj = Math.abs(t / major - Math.round(t / major)) < 1e-6;
            const inFill = fillOn && t >= lo - 1e-9 && t <= hi + 1e-9;
            const hh = isMaj ? 14 : 8;
            cx2.fillStyle = inFill ? k.a : isMaj ? k.m : k.t;
            cx2.fillRect(x - (isMaj ? 1 : 0.5), Math.round((H - hh) / 2), isMaj ? 2 : 1, hh);
        }
        // valor padrão: um pixel quadrado acima do traço
        if (hasDef) { const x = px(mid + (def - vis) * ppu); if (x > -4 && x < W + 4) { cx2.fillStyle = fillOn ? k.a : k.m; cx2.fillRect(x - 1.5, Math.round(H / 2 - 13), 3, 3); } }
    };
    const redraw = () => { if (!drawQ) drawQ = requestAnimationFrame(draw); };
    const show = () => { const qv = q(v); valEl.textContent = fmtShow(qv); el.setAttribute('aria-valuenow', qv); valEl.classList.toggle('def', hasDef && Math.abs(qv - def) < 1e-9); redraw(); };
    let lastSent = q(v);
    const emit = (final) => {
        const qv = q(v);
        if (qv !== lastSent || final) {
            lastSent = qv;
            if (c.set) c.set(qv, final);
            else if (qv !== getP(c.key)) { setP(c.key, qv); requestRender(); Thumbs.stateChanged(); }
            const d = dialEls.find(x => x.c === c); if (d) updateDial(d.el, c);
        }
        if (final && !c.set) { commit(); if (grpDependsOn(c.key)) rebuildDials(); }
    };
    // vibração leve ao passar pelo padrão (sem prender) e ao bater nas pontas
    let side = Math.sign(v - def);
    const haptic = () => { const s2 = Math.sign(q(v) - def); if (hasDef && s2 !== side && navigator.vibrate) navigator.vibrate(4); side = s2; };
    let raf = 0;
    const stopAnim = () => { cancelAnimationFrame(raf); raf = 0; };
    // animação até um valor (toque duplo, teclado, volta do elástico)
    const glideTo = (target, done) => {
        stopAnim(); const from = vis, fromV = v, t0 = performance.now(), dur = 340;
        const f = (now) => {
            const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
            vis = from + (target - from) * e; v = clampN(fromV + (target - fromV) * e, c.min, c.max);
            show(); emit(false);
            if (p < 1) raf = requestAnimationFrame(f); else { raf = 0; vis = v = target; show(); emit(true); if (done) done(); }
        };
        raf = requestAnimationFrame(f);
    };
    // elástico: além das pontas a régua anda só um terço do dedo
    const setFromRaw = (raw) => {
        if (raw < c.min) { v = c.min; vis = c.min - (c.min - raw) * 0.33; }
        else if (raw > c.max) { v = c.max; vis = c.max + (raw - c.max) * 0.33; }
        else { v = raw; vis = raw; }
    };
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        stopAnim(); col = null;
        drag = { x: e.clientX, raw: vis < c.min ? c.min - (c.min - vis) / 0.33 : vis > c.max ? c.max + (vis - c.max) / 0.33 : vis, samples: [{ t: e.timeStamp || performance.now(), x: e.clientX }], moved: false };
        el.classList.add('drag');
    });
    el.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.x; if (Math.abs(dx) > 2) drag.moved = true;
        const now = e.timeStamp || performance.now();
        drag.samples.push({ t: now, x: e.clientX }); while (drag.samples.length > 2 && now - drag.samples[0].t > 90) drag.samples.shift();
        setFromRaw(drag.raw - dx / ppu); show(); haptic(); emit(false);
        if (o.onDrag) o.onDrag(q(v));
        flashLabel(c.label + '  ' + fmtShow(q(v)), 900);
    });
    const up = (e) => {
        if (!drag) return;
        const sm = drag.samples, a = sm[0], b = sm[sm.length - 1], dt = Math.max(1, b.t - a.t);
        let vel = drag.moved && (performance.now() - b.t) < 80 ? clampN((b.x - a.x) / dt, -2.2, 2.2) : 0;   // px/ms
        drag = null; el.classList.remove('drag');
        if (vis !== v) { glideTo(q(v)); return; }                 // volta do elástico
        if (Math.abs(vel) < 0.12) { v = vis = q(v); show(); emit(true); return; }
        // inércia: desacelera como uma régua de verdade
        let last = performance.now();
        const f = (now) => {
            const dtt = Math.min(40, now - last); last = now;
            vel *= Math.pow(0.993, dtt);
            let nv = v - vel * dtt / ppu;
            if (nv <= c.min || nv >= c.max) { nv = clampN(nv, c.min, c.max); vel = 0; if (navigator.vibrate) navigator.vibrate(6); }
            v = vis = nv; show(); haptic(); emit(false);
            if (Math.abs(vel) > 0.01) raf = requestAnimationFrame(f);
            else { raf = 0; glideTo(q(v)); }
        };
        raf = requestAnimationFrame(f);
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => {
        e.preventDefault(); stopAnim();
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        v = vis = clampN(v + d / ppu, c.min, c.max); show(); emit(false);
        clearTimeout(el._wt); el._wt = setTimeout(() => { v = vis = q(v); show(); emit(true); }, 220);
    }, { passive: false });
    el.addEventListener('keydown', (e) => {
        const big = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); glideTo(clampN(q(v) + step * big, c.min, c.max)); }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); glideTo(clampN(q(v) - step * big, c.min, c.max)); }
    });
    el.addEventListener('dblclick', () => { if (hasDef) { glideTo(def); flashLabel(c.label + ' · padrão'); } });
    new ResizeObserver(() => draw()).observe(el);
    box.append(head, el);
    box._sync = () => { if (!drag && !raf) { v = vis = getV(); show(); } };
    show(); requestAnimationFrame(draw);
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
    if (!ui.keepScroll) requestAnimationFrame(() => revealInEditor(row.querySelector('.chip.on')));
    return row;
}

// ---------- miniaturas ao vivo ----------
function makeThumbChoice(c, grid) {
    const strip = h('div', grid ? 'tgrid' : 'strip'), cur = String(ctrlValue(c));
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
            strip.querySelectorAll('.strip-fold').forEach(x => x._sync && x._sync());
            flashLabel(label);
            const n = $('editor').querySelector('.editor-note'); if (n) n.textContent = choiceNote(c);
        };
        strip.append(t); items.push(t);
    };
    if (c.groupsOf) {
        // grupos recolhidos por padrão (abertos só na sessão); “Nenhum” fica sempre à vista
        const open = (ui.fold = ui.fold || {});
        add('none', 'Nenhum');
        c.groupsOf.forEach(([g, list]) => {
            const k = c.key + '|' + g, hd = h('button', 'strip-fold'); hd.type = 'button';
            const nm = h('span'); nm.textContent = g;
            hd.append(nm, h('span', 'n', String(list.length))); strip.append(hd);
            const first = items.length; list.forEach(([id, nome]) => add(id, nome));
            const mine = items.slice(first);
            hd._sync = () => {
                const o = !!open[k];
                hd.classList.toggle('open', o); hd.setAttribute('aria-expanded', String(o));
                hd.classList.toggle('has', mine.some(t => t.classList.contains('on')));   // ponto = escolha dentro do grupo
                mine.forEach(t => t.classList.toggle('fold', !o));
            };
            hd.onclick = () => { open[k] = !open[k]; hd._sync(); Thumbs.pump(); if (open[k]) requestAnimationFrame(() => centerIn(strip, mine[0])); };
            hd._sync();
        });
    } else c.options.forEach(([v, l]) => add(v, l));
    requestAnimationFrame(() => centerIn(strip, strip.querySelector('.thumb.on:not(.fold)')));
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
    const src = document.createElement('canvas'), sctx = src.getContext('2d', { willReadFrequently: true });
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
            catch (e) { console.warn('[Pixelar] miniatura falhou:', e); continue; }
            if (r) { try { drawThumb(it, r.W, r.H); it.canvas.classList.add('ready'); } catch (e) { console.warn('[Pixelar] miniatura falhou:', e); } }
        }
        if (queue.length) pump();
    }
    function refreshAll() { live = live.filter(it => it.pic.isConnected); queue = live.slice(); pump(); }
    function stateChanged() { clearTimeout(dirtyTimer); dirtyTimer = setTimeout(() => { live = live.filter(it => it.pic.isConnected); queue = [...new Set([...queue, ...live.filter(it => it.liveState)])]; pump(); }, 260); }   // as que ainda esperavam continuam na fila
    // (testes) processa a fila inteira agora, sem esperar quadros de tela
    function flush() { let n = 0; while (queue.length && n++ < 1000) { raf = 0; pointerDown = false; lastInput = 0; work(); } }
    return { setSource, attach, stateChanged, refreshAll, flush, pump, get pending() { return queue.length; }, get src() { return src; } };
})();

// ---------- Meus estilos: as combinações que a pessoa salvou ----------
// aplicar um estilo nunca mexe no recorte nem na animação
function presetApplyState(ps) { const s = normalizeState(ps); s.crop = deepClone(st.crop); s.anim = deepClone(st.anim); return s; }
function applyPreset(name, ps) {
    const before = snapshot();
    ui.lastPreset = name;
    stopAnim();
    st = presetApplyState(ps); Engine.invalidate(); afterExternalChange({ keepEditor: true }); commit(true);
    syncStyleRuler(); flashLabel(name);
    return before;
}
// favoritos da versão anterior que guardavam uma combinação inteira viram estilos salvos (uma vez)
(() => {
    const favs = store.get('favs', null); if (!favs) return;
    Object.entries(favs).forEach(([name, ms]) => { if (ms && typeof ms === 'object' && !prefs.presets[name]) prefs.presets[name] = ms; });
    store.set('presets', prefs.presets); try { localStorage.removeItem('pixelar.favs'); } catch (e) {}
})();
// estilos prontos: combinações das ferramentas normais (tudo continua editável depois de aplicar)
const longSide = () => { const A = M.analysis || {}; return Math.max(A.W || 1600, A.H || 1200); };
const BUILTIN_STYLES = {
    '16-bit': (s) => { s.pixel.size = Math.max(1, Math.round(longSide() / 240)); s.color.sel = '24'; s.dither.mode = 'bayer8'; s.dither.scale = 1; s.dither.intensity = 70; s.adj.saturation = 35; s.adj.contrast = 15; },
    'Óleo': (s) => { s.fx.id = 'oil'; s.adj.saturation = 10; },
    'Celular 2010': (s) => { s.film.look = 'celular2010'; },
    'Webcam 2000': (s) => { s.film.look = 'webcam'; },
};
const builtinState = (name) => { const s = freshState(); BUILTIN_STYLES[name](s); return s; };
function styleThumb(strip, name, stateFn, del) {
    const t = h('button', 'thumb' + (ui.lastPreset === name ? ' on' : '')); t.type = 'button';
    const pic = h('span', 'pic'), lab = h('span', 't'); lab.textContent = name;
    t.append(pic, lab); t.title = name;
    Thumbs.attach(pic, 'style:' + name, () => presetApplyState(stateFn()), false);
    const x = h('span', 'del', icon('close')); x.setAttribute('role', 'button'); x.setAttribute('aria-label', 'Apagar ' + name);
    if (del) { x.onclick = (e) => { e.stopPropagation(); del(); }; pic.append(x); }
    t.onclick = () => { applyPreset(name, stateFn()); strip.querySelectorAll('.thumb').forEach(o => o.classList.toggle('on', o === t)); };
    strip.append(t);
}
// intensidade do estilo (mistura com a foto original): sempre logo abaixo da faixa
let styleRuler = null;
function styleMixRuler(ed) {
    const c = { key: 'mix', label: 'Intensidade', min: 0, max: 100, step: 1, def: 100,
        get: () => st.mix, set: (v, final) => { st.mix = v; requestRender(); if (final) commit(); } };
    styleRuler = makeRuler(c, { label: true });
    styleRuler.classList.add('compact');
    ed.append(styleRuler);
}
function syncStyleRuler() { if (styleRuler && styleRuler.isConnected && styleRuler._sync) styleRuler._sync(); }
// ============================================================
// EDITAR EM BARRA: ferramentas numa linha; tocar abre os ajustes dela acima; tocar num ajuste abre o controle
// ============================================================
ui.editTool = null; ui.editParam = {};
// ============================================================
// ESTILOS EM BARRA: tudo em fileiras horizontais, empilhadas de baixo para cima
//   [régua do ajuste]        ← abre ao tocar num ajuste (toque de novo fecha)
//   [ajustes do efeito]      ← botões com ícone e nome; abre ao selecionar um efeito
//   [todos os efeitos]       ← Prontos · Texturas · Filmes · Pintura · Meus estilos, numa linha só
//   [Estilos Editar Sortear Exportar]
// ============================================================
ui.styleSel = null; ui.styleParam = null; ui.styleScroll = 0;
function styleItems() {
    const items = [], G = (label) => items.push({ group: label });
    G('Prontos');
    Object.keys(BUILTIN_STYLES).forEach(n => items.push({ kind: 'preset', id: n, label: n, state: () => presetApplyState(builtinState(n)), on: () => ui.lastPreset === n }));
    G('Texturas');
    FX_GROUPS().forEach(([, list]) => list.forEach(([id, nome]) => items.push({ kind: 'fx', id, label: nome, state: () => { const s = deepClone(st); s.fx.id = id; if (s.fx.mix < 30) s.fx.mix = 100; return s; }, on: () => st.fx.id === id })));
    G('Filmes');
    FILM_LOOK_DEFS.forEach(([, list]) => list.forEach(([id, nome]) => items.push({ kind: 'film', id, label: nome, state: () => { const s = deepClone(st); s.film.look = id; if (s.film.mix < 30) s.film.mix = 100; return s; }, on: () => st.film.look === id })));
    G('Pintura');
    PAINT_MODE_OPTS.slice(1).forEach(([id, nome]) => items.push({ kind: 'paint', id, label: nome, state: () => { const s = deepClone(st); s.paint.mode = id; return s; }, on: () => st.paint.mode === id }));
    G('Meus estilos');
    items.push({ kind: 'add' });
    Object.keys(prefs.presets).forEach(n => items.push({ kind: 'mine', id: n, label: n, state: () => presetApplyState(prefs.presets[n]), on: () => ui.lastPreset === n }));
    return items;
}
const isSel = (it) => ui.styleSel && ui.styleSel.kind === it.kind && ui.styleSel.id === it.id;
// ajustes do efeito selecionado (os mesmos das ferramentas, sem a escolha do efeito)
function styleControls(sel) {
    const mixC = { kind: 'range', key: '_mix', label: 'Intensidade', icon: 'intensity', min: 0, max: 100, step: 1, def: 100, get: () => st.mix, set: (v, final) => { st.mix = v; requestRender(); if (final) commit(); } };
    const rm = (label, fn) => A('Remover', 'reset', () => { const before = snapshot(); fn(); ui.styleSel = null; ui.styleParam = null; Engine.invalidate(); afterExternalChange(); commit(true); toast(label + ' removido', { label: 'Desfazer', run: () => { restore(before); commit(true); } }); });
    const clean = (list) => list.filter(c => c.kind !== 'divider' && !(c.kind === 'choice' && c.view === 'thumbs') && !(c.kind === 'action' && c.label === 'Restaurar') && !/^Sortear/.test(c.label) && c.label !== 'Travar');
    // o dado de um efeito troca o efeito: a seleção acompanha o novo
    const roll = (g, kind, cur) => A('Sortear', 'dice', () => { rollTool(g); const id = cur(); ui.styleSel = id !== 'none' ? { kind, id } : null; ui.styleParam = null; buildPanel(); });
    if (sel.kind === 'fx') return [...clean(TEXTURA_TOOL.controls()), roll('textura', 'fx', () => st.fx.id), rm('Textura', () => { delete st.fxParams[st.fx.id]; st.fx = fresh('fx'); })];
    if (sel.kind === 'film') return [...clean(FILME_TOOL.controls()), roll('filme', 'film', () => st.film.look), rm('Filme', () => { Object.assign(st.film, { look: 'none', mix: 100 }); })];
    if (sel.kind === 'paint') return [...clean(PINTURA_TOOL.controls()), roll('pintura', 'paint', () => st.paint.mode), rm('Pintura', () => { st.paint = fresh('paint'); })];
    const list = [mixC];
    if (sel.kind === 'mine') list.push(A('Apagar', 'close', () => { const name = sel.id, bak = prefs.presets[name]; delete prefs.presets[name]; store.set('presets', prefs.presets); ui.styleSel = null; buildPanel();
        toast('Estilo apagado', { label: 'Desfazer', run: () => { prefs.presets[name] = bak; store.set('presets', prefs.presets); buildPanel(); } }); }));
    return list;
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
// fecha só com um toque que COMEÇOU no fundo: o dedo que segurou um botão e abriu a folha não a fecha ao soltar
{
    const bd = $('sheetBackdrop'); let downOnBd = false;
    bd.addEventListener('pointerdown', () => { downOnBd = true; });
    bd.addEventListener('click', () => { if (downOnBd) closeSheet(); downOnBd = false; });
}
function sheetHead(sh, title) {
    const hd = h('div', 'head'); hd.append(h('h2', '', title));
    const x = h('button', 'icon-btn round', icon('close')); x.type = 'button'; x.setAttribute('aria-label', 'Fechar'); x.onclick = closeSheet; hd.append(x);
    sh.append(hd);
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
        toast('Salvo em Meus estilos', { label: 'Ver', run: () => selectTab('estilos') });
        if (ui.tab === 'estilos') { lastEditorKey = null; buildPanel(); }
    });
}

function openMore() {
    openSheet((sh) => {
        const list = h('div', 'menu-list');
        const item = (ic, label, fn, sub) => { const b = h('button', 'menu-item', icon(ic) + `<span>${label}</span>` + (sub ? `<span class="sub">${sub}</span>` : '')); b.type = 'button'; b.onclick = () => { closeSheet(); setTimeout(fn, 200); }; list.append(b); };
        item('plus', 'Salvar estilo', saveUserPreset);
        item('file', 'Importar configurações', () => $('configInput').click(), 'PNG ou TXT');
        item('dice', 'Dado: travar e sortear', openRandomSettings);
        item('reset', 'Restaurar tudo', () => { const before = snapshot(); st = freshState(); Engine.invalidate(); afterExternalChange(); commit(true); toast('Tudo restaurado', { label: 'Desfazer', run: () => { restore(before); commit(true); } }); });
        // tema: Diurno ou Noturno (até escolher, segue o aparelho)
        const th = h('div', 'theme-switch'), dark = isDark();
        [['light', 'Diurno', 'sun'], ['dark', 'Noturno', 'moon']].forEach(([v, l, ic]) => {
            const b = h('button', (v === 'dark') === dark ? 'on' : '', icon(ic) + `<span>${l}</span>`); b.type = 'button';
            b.onclick = () => { setTheme(v); th.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
            th.append(b);
        });
        const about = h('div', 'about', logoSvg('mini')); about.append(h('p', 'note', 'As fotos e vídeos ficam no seu aparelho.'));
        sh.append(list, th, about);
    });
}
function isDark() { const t = document.documentElement.dataset.theme; return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; }
function setTheme(t) { if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t; store.set('theme', t); try { localStorage.setItem('pixelar.theme', t); } catch (e) {} }
// segurar um botão (sem disparar o toque)
function onHold(el, fn, ms = 550) {
    let t = 0, held = false, at = null;
    el.addEventListener('pointerdown', (e) => { held = false; at = { x: e.clientX, y: e.clientY }; clearTimeout(t); t = setTimeout(() => { held = true; fn(); if (navigator.vibrate) navigator.vibrate(10); }, ms); });
    el.addEventListener('pointermove', (e) => { if (at && Math.hypot(e.clientX - at.x, e.clientY - at.y) > 8) clearTimeout(t); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => el.addEventListener(ev, () => { clearTimeout(t); at = null; }));
    el.addEventListener('click', (e) => { if (held) { e.stopImmediatePropagation(); e.preventDefault(); held = false; } }, true);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
}
// travar uma ferramenta inteira: o dado geral passa a deixá-la como está
function setToolLock(id, locked, quiet) {
    if (locked) prefs.groups.delete(id); else prefs.groups.add(id);
    store.set('dice2', [...prefs.groups]);
    if (!quiet) { toast(locked ? RANDOM_GROUPS[id] + ' travada: o dado não mexe nela' : RANDOM_GROUPS[id] + ' livre para o dado'); buildPanel(); }
}
// o dado de uma ferramenta só (funciona mesmo com ela travada: foi a pessoa que pediu)
function rollTool(id) {
    if (!M.el) return;
    const before = snapshot();
    try {
        const touched = randomizeTool(st, M.analysis, id, prefs.locks);
        Engine.invalidate(); afterExternalChange(); commit(true);
        if (M.type === 'image' && anim.playing && !animOn()) stopAnim();
        toast(touched.length ? touched.join(' · ') : RANDOM_GROUPS[id], { label: 'Desfazer', run: () => { restore(before); commit(true); } });
    } catch (e) { console.error('[Pixelar] dado falhou:', e); restore(before); toast('Não foi possível sortear agora. Tente de novo.'); }
}
// segurar o dado: cada ferramenta com cadeado (fica como está) e o próprio dado
function openRandomSettings() {
    openSheet((sh) => {
        sheetHead(sh, 'Dado');
        sh.append(h('p', 'note', 'O dado sorteia uma receita (Pixel art, Analógico, Impressão, Pintura…) usando só as ferramentas livres. Trave o que quer manter; o dado ao lado sorteia só aquela ferramenta.'));
        const list = h('div', 'menu-list dice-list'); list.style.marginTop = '12px';
        Object.entries(RANDOM_GROUPS).forEach(([k, label]) => {
            const row = h('div', 'menu-item dice-row');
            row.innerHTML = icon('t-' + k) + `<span>${label}</span>`;
            const lk = h('button', 'dice-lock' + (prefs.groups.has(k) ? '' : ' on'), icon('lock') + '<span></span>'); lk.type = 'button';
            const sync = () => { const locked = !prefs.groups.has(k); lk.classList.toggle('on', locked); lk.lastChild.textContent = locked ? 'Travada' : 'Livre'; lk.setAttribute('aria-pressed', String(locked)); };
            lk.onclick = () => { setToolLock(k, prefs.groups.has(k), true); sync(); };
            const dz = h('button', 'dice-one', icon('dice')); dz.type = 'button'; dz.title = 'Sortear só ' + label; dz.setAttribute('aria-label', dz.title);
            dz.onclick = () => rollTool(k);
            sync(); row.append(lk, dz); list.append(row);
        });
        sh.append(list);
        const acts = h('div', 'actions');
        const all = h('button', 'pill', 'Sortear o que está livre'); all.type = 'button'; all.onclick = () => { closeSheet(); setTimeout(rollDice, 150); };
        acts.append(all);
        if (prefs.locks.size) { const b = h('button', 'pill', `Destravar ajustes (${prefs.locks.size})`); b.type = 'button'; b.onclick = () => { prefs.locks.clear(); store.set('locks', []); refreshDials(); b.remove(); toast('Ajustes destravados'); }; acts.append(b); }
        sh.append(acts);
        sh.append(h('p', 'note', 'Dica: segure uma ferramenta em Editar para travá-la, ou segure um ajuste para travar só ele.'));
    }, () => buildPanel());
}
// ============================================================
// CAMADAS: a ordem dos efeitos sobre a imagem, com mesclagem e opacidade
// ============================================================
// de onde vem cada camada, onde ela é editada ([ferramenta, ajuste]), e onde ficam a mesclagem e a opacidade
const LAYER_DEFS = {
    dbl: { label: 'Dupla exposição', on: () => st.dbl.on && !st.dbl.pre && (st.dbl.src !== 'image' || !!DblImage.img), sub: () => (DBL_SRC_OPTS.find(o => o[0] === st.dbl.src) || [, ''])[1], go: ['dupla', 'dbl.blend'],
        getB: () => st.dbl.blend, setB: (v) => { st.dbl.blend = v; }, getO: () => st.dbl.op, setO: (v) => { st.dbl.op = v; } },
    grad: { label: 'Degradê', on: () => st.grad.on, sub: () => (GRAD_TYPE_OPTS.find(o => o[0] === st.grad.type) || [, ''])[1], go: ['cor', 'grad.on'],
        getB: gradBlend, setB: (v) => { st.grad.blend = v === 'normal' ? 'source-atop' : v; }, getO: () => st.grad.opacity, setO: (v) => { st.grad.opacity = v; } },
    fx: { label: 'Textura', on: () => st.fx.id !== 'none', sub: () => (PixelarFX.getEffectDef(st.fx.id) || {}).nome || '', go: ['textura', 'fx.id'],
        getO: () => st.fx.mix, setO: (v) => { st.fx.mix = v; } },
    film: { label: 'Filme', on: () => st.film.look !== 'none', sub: () => (FILM_LOOKS[st.film.look] || {}).nome || '', go: ['filme', 'film.look'],
        getO: () => st.film.mix, setO: (v) => { st.film.mix = v; } },
    lens: { label: 'Lente', on: () => LENS_KEYS.some(k => st.film[k]), sub: () => LENS_KEYS.filter(k => st.film[k]).length > 1 ? 'Vários ajustes' : '', go: ['lente', 'film.vignette'] },
    grain: { label: 'Grão', on: () => st.grain.amount > 0, sub: () => '', go: ['lente', 'grain.amount'] },
    edge: { label: 'Contorno', on: () => st.edge.size > 0, sub: () => '', go: ['pixel', 'edge.size'],
        getO: () => st.edge.opacity, setO: (v) => { st.edge.opacity = v; } },
};
// excluir uma camada: desliga o efeito dela (a parte do estado volta ao padrão)
const LAYER_OFF = {
    dbl: () => { st.dbl = fresh('dbl'); }, grad: () => { st.grad = fresh('grad'); },
    fx: () => { if (st.fx.id !== 'none') delete st.fxParams[st.fx.id]; st.fx = fresh('fx'); },
    film: () => { st.film.look = 'none'; st.film.mix = 100; }, lens: () => { LENS_KEYS.forEach(k => { st.film[k] = 0; }); },
    grain: () => { st.grain = fresh('grain'); }, edge: () => { st.edge = fresh('edge'); },
    paint: () => { st.paint = fresh('paint'); },
};
function deleteLayer(id, label, after) {
    const before = snapshot();
    LAYER_OFF[id](); delete st.layers.blend[id]; delete st.layers.op[id];
    Engine.invalidate(); afterExternalChange(); commit(true);
    if (after) after();
    toast(label + ' excluída', { label: 'Desfazer', run: () => { restore(before); commit(true); if (after) after(); } });
}
const layerBlend = (id) => { const d = LAYER_DEFS[id]; return d.getB ? d.getB() : (st.layers.blend[id] || 'normal'); };
const setLayerBlend = (id, v) => { const d = LAYER_DEFS[id]; if (d.setB) d.setB(v); else if (v === 'normal') delete st.layers.blend[id]; else st.layers.blend[id] = v; };
const layerOp = (id) => { const d = LAYER_DEFS[id]; return d.getO ? d.getO() : (st.layers.op[id] === undefined ? 100 : st.layers.op[id]); };
const setLayerOp = (id, v) => { const d = LAYER_DEFS[id]; if (d.setO) d.setO(v); else if (v >= 100) delete st.layers.op[id]; else st.layers.op[id] = v; };
let layersOpen = null;
function openLayers() {
    if (!M.el) return;
    st.layers = normalizeLayers(st.layers);
    openSheet((sh) => {
        sh.classList.add('layers-sheet');
        sheetHead(sh, 'Camadas');
        const list = h('div', 'layer-list');
        const draw = () => {
            list.innerHTML = '';
            // a ordem de aplicação é de cima para baixo: a de baixo fica por cima na imagem
            const active = st.layers.order.filter(id => LAYER_DEFS[id].on());
            const base = h('div', 'layer base'); base.innerHTML = `<span class="lname">Foto, paleta e pixel</span>`; list.append(base);
            if (!active.length && st.paint.mode === 'none') list.append(h('p', 'note', 'Nenhum efeito por cima da foto ainda. Textura, filme, lente, grão, contorno, degradê e pintura aparecem aqui.'));
            active.forEach((id) => {
                const d = LAYER_DEFS[id], row = h('div', 'layer' + (layersOpen === id ? ' open' : '')); row.dataset.id = id;
                const grip = h('span', 'grip', icon('grip')); grip.setAttribute('aria-label', 'Arrastar para reordenar');
                const nm = h('button', 'lmain'); nm.type = 'button';
                const bl = layerBlend(id), op = layerOp(id);
                nm.innerHTML = `<span class="lname"></span><span class="lsub"></span>`;
                nm.querySelector('.lname').textContent = d.label;
                nm.querySelector('.lsub').textContent = [d.sub(), bl !== 'normal' ? BLEND_OPTS.find(b => b[0] === bl)[1] : '', op < 100 ? Math.round(op) + '%' : ''].filter(Boolean).join(' · ');
                nm.onclick = () => { layersOpen = layersOpen === id ? null : id; draw(); };
                const del = h('button', 'ldel', icon('close')); del.type = 'button'; del.title = 'Excluir ' + d.label; del.setAttribute('aria-label', del.title);
                del.onclick = () => { if (layersOpen === id) layersOpen = null; deleteLayer(id, d.label, draw); };
                row.append(grip, nm, del);
                if (layersOpen === id) {
                    const det = h('div', 'ldetail');
                    const chips = h('div', 'chips');
                    BLEND_OPTS.forEach(([v, l]) => { const b = h('button', 'chip' + (v === bl ? ' on' : ''), l); b.type = 'button'; b.onclick = () => { setLayerBlend(id, v); change(null, null, { soft: false }); chips.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b)); updateSub(); }; chips.append(b); });
                    const updateSub = () => { const b2 = layerBlend(id), o2 = layerOp(id); nm.querySelector('.lsub').textContent = [d.sub(), b2 !== 'normal' ? BLEND_OPTS.find(b => b[0] === b2)[1] : '', o2 < 100 ? Math.round(o2) + '%' : ''].filter(Boolean).join(' · '); };
                    const ruler = makeRuler({ key: '_layer.' + id, label: 'Opacidade', min: 0, max: 100, step: 1, def: 100, get: () => layerOp(id), set: (v, final) => { setLayerOp(id, v); requestRender(); updateSub(); if (final) { commit(); Thumbs.stateChanged(); } } }, { label: 'Opacidade' });
                    ruler.classList.add('compact');
                    const go = h('button', 'link', 'Editar'); go.type = 'button';
                    go.onclick = () => { const [g, key] = d.go; closeSheet(); goTo(g, key); };
                    const foot = h('div', 'lfoot'); foot.append(go);
                    det.append(chips, ruler, foot);
                    row.append(det);
                }
                list.append(row);
                dragRow(grip, row, list);
            });
            // Pintura: sempre por último (sobre tudo), sem mistura; só dá para excluir
            if (st.paint.mode !== 'none') {
                const row = h('div', 'layer fixed'), nm = h('div', 'lmain');
                nm.innerHTML = '<span class="lname">Pintura</span><span class="lsub"></span>';
                nm.querySelector('.lsub').textContent = (st.paint.mode === 'pixels' ? 'Pixels' : 'Regiões') + ' · sempre por cima';
                const del = h('button', 'ldel', icon('close')); del.type = 'button'; del.title = 'Excluir Pintura'; del.setAttribute('aria-label', del.title);
                del.onclick = () => deleteLayer('paint', 'Pintura', draw);
                row.append(h('span', 'grip', smallIcon('brush')), nm, del); list.append(row);
            }
        };
        // arrastar pela alça: a fila se reorganiza ao vivo; ao soltar, a nova ordem vale
        const dragRow = (grip, row, box) => {
            grip.addEventListener('pointerdown', (e) => {
                e.preventDefault(); try { grip.setPointerCapture(e.pointerId); } catch (_) {}
                const rows = () => [...box.querySelectorAll('.layer:not(.base)')];
                const y0 = e.clientY; row.classList.add('dragging');
                const move = (ev) => {
                    row.style.transform = `translateY(${ev.clientY - y0}px)`;
                    const r = row.getBoundingClientRect(), mid = r.top + r.height / 2;
                    const others = rows().filter(x => x !== row);
                    const after = others.find(x => { const q = x.getBoundingClientRect(); return mid < q.top + q.height / 2; });
                    const before = row.getBoundingClientRect().top;
                    if (after) { if (row.nextElementSibling !== after) box.insertBefore(row, after); } else if (box.lastElementChild !== row) box.append(row);
                    const shift = row.getBoundingClientRect().top - before; if (shift) { const cur = parseFloat(row.style.transform.replace(/[^-\d.]/g, '')) || 0; row.style.transform = `translateY(${cur - shift}px)`; }
                };
                const up = () => {
                    grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
                    row.classList.remove('dragging'); row.style.transform = '';
                    // nova ordem das ativas; as desligadas guardam o lugar que tinham
                    const act = rows().map(x => x.dataset.id), old = st.layers.order;
                    let k = 0; const next = old.map(id => LAYER_DEFS[id].on() ? act[k++] : id);
                    if (JSON.stringify(next) !== JSON.stringify(old)) { st.layers.order = next; change(null, null); if (navigator.vibrate) navigator.vibrate(6); }
                    draw();
                };
                grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
            });
        };
        draw();
        sh.append(list);
    });
    $('sheetBackdrop').classList.add('clear');
}

// ============================================================
// EXPORTAR (aba): um painel só — formato, tamanho e salvar. A folha só aparece durante a exportação.
// GIF e vídeo de uma foto só aparecem quando algo se move (nada de 60 quadros iguais).
// ============================================================
const exp = Object.assign({ format: 'png', size: 'orig', gifSize: 480, aSize: 'max', aRepeat: 1, vFormat: 'mp4', vSize: 'orig', vFps: 30, audio: true }, store.get('export', {}));
if (exp.size === 'max') exp.size = 'orig';      // nomes da versão anterior
if (exp.vSize !== 'screen' && exp.vSize !== '2x') exp.vSize = 'orig';
const saveExp = () => store.set('export', exp);
// a imagem é toda redesenhada (pixel, paleta, padrão, textura)? então pode crescer além do original sem perder nada
const reRendered = () => st.pixel.size > 1 || st.color.sel !== 'all' || st.dither.mode !== 'none' || st.fx.id !== 'none';
const IS_IOS = /^Apple/.test(navigator.vendor || '') && navigator.maxTouchPoints > 1;
const STILL = ['png', 'jpeg', 'webp', 'svg'];
// tamanhos de imagem: Tela, Original e (só quando a imagem é redesenhada) 2×, 4K e 8K
function exportSizes() {
    const g = cropGeometry(M.el, st.crop), rot = st.crop.rot % 180;
    const cw = (rot ? g.ch : g.cw) * st.pixel.scale / 100, ch = (rot ? g.cw : g.ch) * st.pixel.scale / 100;
    const long = Math.max(cw, ch), ar = ch / long;   // altura = lado maior × ar
    const maxArea = IS_IOS ? 16.7e6 : 64e6, lim = Math.min(PixelarGPU.maxTex || 4096, 8192, Math.floor(Math.sqrt(maxArea * long / Math.min(cw, ch))));
    const hOf = (L) => Math.max(1, Math.round(Math.min(L, lim) * ar));
    const out = [{ id: 'screen', label: 'Tela', res: lastRender ? lastRender.H : hOf(Math.min(long, 2000)) }, { id: 'orig', label: 'Original', res: hOf(long) }];
    if (reRendered()) [['2x', '2×', long * 2], ['4k', '4K', 3840], ['8k', '8K', 7680]].forEach(([id, label, L]) => { if (L > long * 1.2 && L <= lim) out.push({ id, label, res: hOf(L) }); });
    // sem repetidos (fotos pequenas ou aparelho no limite): fica o maior nome
    const list = out.filter(o => !(o.id === 'screen' && o.res >= out[1].res));   // foto pequena: Tela = Original
    return list.filter((o, i) => !list.slice(i + 1).some(p => p.res === o.res));
}
function exportFormats() {
    if (M.type === 'video') return [['mp4', 'MP4'], ['webm', 'WebM'], ['gif', 'GIF']];
    return [['png', 'PNG'], ['jpeg', 'JPEG'], ['webp', 'WebP'], ['svg', 'SVG'], ...(animOn() ? [['gif', 'GIF'], ['mp4', 'MP4'], ['webm', 'WebM']] : [])];
}
// chips de um grupo dentro de uma fileira compartilhada
function chipGroupInline(options, cur, onPick) {
    const frag = h('div'); const btns = [];
    options.forEach(([v, l]) => { const b = h('button', 'chip' + (String(v) === String(cur) ? ' on' : ''), l); b.type = 'button'; b.onclick = () => { btns.forEach(x => x.classList.toggle('on', x === b)); onPick(v); }; btns.push(b); frag.append(b); });
    return frag;
}
const trimOf = () => { const [a, b] = M.trim; return b - a >= M.duration - 0.05 ? null : [a, b]; };
async function saveStill() {
    const s = exportSizes().find(x => x.id === exp.size) || exportSizes().find(x => x.id === 'orig');
    try {
        ui.busy = true; flashLabel('Salvando…', 4000);
        await new Promise(r => setTimeout(r, 30));
        const blob = exp.format === 'svg' ? await Exporter.svg(st, M.el, { res: s.res, key: 'main' + M.serial }) : await Exporter.image(st, M.el, { res: s.res, format: exp.format, key: 'main' + M.serial });
        doneToast(blob, exp.format);
    } catch (e) { toast(e.message || 'Não foi possível exportar'); }
    finally { ui.busy = false; Engine.invalidate(); requestRender(); }
}
const sizeText = (hh) => { const { W, H } = lastRender ? { W: lastRender.W, H: lastRender.H } : { W: hh, H: hh }; return Math.round(hh * W / H) + ' × ' + hh; };
async function copyImage() {
    try { const c = document.createElement('canvas'); Engine.render(st, { media: M.el, key: 'main' + M.serial, out: { canvas: c, ctx: c.getContext('2d') }, maxDim: 2000 }); const blob = await new Promise(r => c.toBlob(r, 'image/png')); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); toast('Imagem copiada'); }
    catch (e) { toast('O navegador não deixou copiar'); }
    requestRender();
}
// animações a partir da foto: a prévia toca na própria imagem enquanto a aba está aberta
function ensureAnimPreview() { if (canAnimate() && !anim.playing) startAnim(); }
function closeSheetFast() { const sh = $('sheet'); sh.classList.remove('show'); sh.hidden = true; $('sheetBackdrop').hidden = true; $('sheetBackdrop').classList.remove('show'); }

function runExport(title, fn, ext) {
    closeSheetFast();
    const job = { cancelled: false, progress: () => {} };
    openSheet((sh) => {
        const sun = sunMeter();
        const sub = h('div', 'busy-sub', 'Preparando…');
        const cancel = h('button', 'btn', 'Cancelar'); cancel.type = 'button'; cancel.style.cssText = 'display:flex;margin:16px auto 0;padding:0 24px';
        cancel.onclick = () => { job.cancelled = true; sub.textContent = 'Cancelando…'; };
        sh.append(sun.el, h('div', 'busy-title', `Exportando ${title.toLowerCase()}`), sub, cancel);
        const t0 = performance.now();
        job.progress = (p, frame) => {
            sun.set(p);
            const el = (performance.now() - t0) / 1000; if (p > 0.03) sub.textContent = `faltam ~${Math.max(1, Math.round(el / p - el))} s`;
        };
    });
    ui.busy = true;
    Promise.resolve().then(() => fn(job)).then((res) => {
        ui.busy = false; closeSheet();
        const blob = res && res.blob ? res.blob : res;
        doneToast(blob, ext);
        if (res && res.blob && !res.hasAudio && exp.audio) setTimeout(() => toast(res.audioDropped ? 'Vídeo exportado sem som: este navegador não conseguiu ler o áudio do arquivo.' : 'Este vídeo foi exportado sem som (o original não tem áudio).'), 1200);
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
    app.classList.remove('is-welcome');
    M.analysis = analyzeMedia(el);
    Thumbs.setSource(el, true);
    lastRender = null; view.zoom = 1; view.x = view.y = 0;
    hist.stack = []; hist.i = -1;
    stage.classList.remove('developing'); void stage.offsetWidth; stage.classList.add('developing');
    renderMain(); fitView(true); pushHistory();
    buildPanel(); updateSubbarCenter();
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
        const sun = sunMeter(), s = h('div', 'busy-sub', sub || '');
        sh.append(sun.el, h('div', 'busy-title', title), s);
        busyEls = { sun, s };
    });
    ui.busy = true;
}
function updateBusy(p) { if (busyEls) busyEls.sun.set(p); }
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
    if (M.type !== 'image' || anim.playing || !animOn()) return;
    anim.playing = true; anim.t0 = performance.now();
    const tick = () => { if (!anim.playing) return; renderMain(); anim.raf = requestAnimationFrame(tick); };
    anim.raf = requestAnimationFrame(tick);
    updateSubbarCenter();
}
function stopAnim() {
    if (!anim.playing) return;
    anim.playing = false; cancelAnimationFrame(anim.raf); requestRender();
    updateSubbarCenter();
}
// botão Tocar no topo: só existe quando há algo para animar na foto
let subbarKey = null;
function updateSubbarCenter() {
    const show = M.type === 'image' && (anim.playing || animOn()), key = show ? (anim.playing ? 'pause' : 'play') : '';
    if (key === subbarKey) return; subbarKey = key;
    // o logo fica sempre no centro do topo; o tocar aparece à esquerda do desfazer
    const c = $('subbarCenter'); if (!c.firstChild) c.innerHTML = logoSvg('top');
    const slot = $('playSlot'); slot.innerHTML = '';
    if (!show) return;
    const b = h('button', 'icon-btn' + (anim.playing ? ' on' : ''), icon(key)); b.type = 'button';
    b.title = anim.playing ? 'Parar animação' : 'Ver animação'; b.setAttribute('aria-label', b.title);
    b.onclick = togglePlay; slot.append(b);
}

// ============================================================
// DADO: sorteia os ajustes manuais (o que a pessoa deixou ligado e não travou)
// ============================================================
function rollDice() {
    if (!M.el) return;
    const before = snapshot();
    try {
        const touched = randomize(st, M.analysis, prefs.groups, prefs.locks);
        Engine.invalidate(); afterExternalChange(); commit(true);
        if (M.type === 'image' && anim.playing && !animOn()) stopAnim();
        toast(touched.length ? touched.slice(0, 3).join(' · ') : 'Nova combinação', { label: 'Desfazer', run: () => { restore(before); commit(true); } });
    } catch (e) { console.error('[Pixelar] dado falhou:', e); restore(before); toast('Não foi possível sortear agora. Tente de novo.'); }
}

// ============================================================
// ENTRADAS: botões, arquivo, arrastar, colar, teclado
// ============================================================
$('btnUndo').innerHTML = icon('undo'); $('btnRedo').innerHTML = icon('redo');
$('btnOpen').innerHTML = icon('open'); $('btnCompare').innerHTML = icon('compare'); $('btnPanel').innerHTML = icon('sidebar'); $('btnLayers').innerHTML = icon('layers');
// ---------- coluna lateral recolhível (só no computador e tablet deitado) ----------
let panelCollapsed = false;
const isSide = () => matchMedia('(min-width: 900px), (orientation: landscape) and (max-height: 540px) and (min-width: 560px)').matches;
// ---------- área livre para a imagem: entre o topo e a base (celular) ou ao lado da coluna. Medido, nunca estimado. ----------
function updateInsets() {
    const W = app.clientWidth, H = app.clientHeight, side = isSide();
    if (panelCollapsed && !side) { panelCollapsed = false; app.classList.remove('panel-collapsed'); }
    const top = $('topbar').offsetHeight;
    const vb = $('videoBar'), vbOn = !vb.hidden && !app.classList.contains('is-welcome');
    let r = 0, b = 0;
    if (side) { if (!panelCollapsed) r = W - $('dock').offsetLeft; if (vbOn) b = H - vb.getBoundingClientRect().top; }
    else b = H - $('dock').offsetTop;
    uiInsets = { t: top, r, b, l: 0 };
    const st = app.style, px = (v) => Math.round(v) + 'px';
    // --ui-*: área livre (avisos, rótulos, boas-vindas); --vp-*: onde a imagem fica
    [['t', top], ['r', r], ['b', b], ['l', 0]].forEach(([k, v]) => { st.setProperty('--ui-' + k, px(v)); st.setProperty('--vp-' + k, px(v)); });
    fitView(); Accent.schedule(outCanvas, 300);
}
{
    const ro = new ResizeObserver(() => updateInsets());
    ['topbar', 'dock', 'videoBar'].forEach(id => ro.observe($(id)));
    addEventListener('resize', updateInsets);
    new MutationObserver(updateInsets).observe($('videoBar'), { attributes: true, attributeFilter: ['hidden'] });
}
function setPanelCollapsed(on, save = true) {
    panelCollapsed = !!on && isSide();
    app.classList.toggle('panel-collapsed', panelCollapsed);
    $('btnPanel').classList.toggle('on', !panelCollapsed);
    if (save) store.set('panelCollapsed', panelCollapsed);
    app.classList.add('fit-anim'); clearTimeout(app._fa); app._fa = setTimeout(() => app.classList.remove('fit-anim'), 400);
    updateInsets();
}
$('btnPanel').onclick = () => setPanelCollapsed(!panelCollapsed);
setPanelCollapsed(store.get('panelCollapsed', false), false);
$('btnMore').innerHTML = icon('more');
$('btnOpen').onclick = () => $('fileInput').click();
$('btnWelcomeOpen').onclick = () => $('fileInput').click();
// foto de exemplo (para experimentar sem escolher nada)
$('btnSample').onclick = async () => {
    try { const r = await fetch('exemplo.jpg'); if (!r.ok) throw 0; const b = await r.blob(); await openFile(new File([b], 'exemplo.jpg', { type: 'image/jpeg' })); }
    catch (e) { toast('Não foi possível abrir a foto de exemplo'); }
};
// comparar: toque mostra o original, toque de novo volta
$('btnCompare').onclick = () => { if (!M.el) return; compare.hold = !compare.hold; showOriginal(compare.hold); };
$('btnLayers').onclick = openLayers;
$('btnUndo').onclick = undo; $('btnRedo').onclick = redo;
$('btnDice').onclick = rollDice;
// segurar o dado: o que ele muda
(() => {
    const b = $('btnDice'); let t = 0, held = false;
    b.addEventListener('pointerdown', () => { held = false; clearTimeout(t); t = setTimeout(() => { held = true; openRandomSettings(); }, 550); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, () => clearTimeout(t)));
    b.addEventListener('click', (e) => { if (held) { e.stopImmediatePropagation(); held = false; } }, true);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
})();
$('btnMore').onclick = openMore;
$('fileInput').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; openFile(f); };
// dupla exposição: a segunda foto é reduzida (até 2048 px) e fica no motor, não no estado
$('dblInput').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    let img; try { img = await loadImage(f); } catch (err) { toast('Não foi possível abrir esta imagem'); return; }
    const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height, k = Math.min(1, 2048 / Math.max(W, H));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(W * k)); c.height = Math.max(1, Math.round(H * k));
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, c.width, c.height);
    DblImage.img = c; DblImage.key++; DblImage.aspect = c.width / c.height; DblImage.name = f.name;
    st.dbl.on = true; st.dbl.src = 'image';
    if (M.el) goTo('dupla', 'dbl.src');
    afterExternalChange(); commit(true); Thumbs.refreshAll();
    toast('Segunda foto na dupla exposição');
};
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
// atalhos de teclado saíram do app (curadoria): só o Esc, que fecha folhas e janelas
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { stopAnim(); pauseVideo(); } });

// ============================================================
// INÍCIO
// ============================================================
// modo leve: prévia processada numa base menor (a exportação sempre usa a resolução cheia)
if (document.documentElement.dataset.lite) Engine.workCap = 1280;
buildTabbar(); selectTab(Object.keys(prefs.presets).length ? 'estilos' : 'editar'); updateHistoryButtons();
$('btnWelcomeOpen').innerHTML = icon('open') + '<span>Abrir foto ou vídeo</span>';
updateSubbarCenter();
if (!PixelarGPU.isAvailable()) console.warn('WebGL2 indisponível: usando o processador (mais lento).');
// para o console e os testes
window.Pixelar = { openMore, get state() { return st; }, set state(v) { st = normalizeState(v); Engine.invalidate(); afterExternalChange(); commit(true); }, openFile, media: M, ui, selectTab, goTo, flushThumbs: () => Thumbs.flush() };
})();
