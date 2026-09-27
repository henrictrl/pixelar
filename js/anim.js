/* Pixelar — animação em loop e modo aleatório.
 * A fase T percorre um número inteiro de ciclos e todos os movimentos têm
 * período 1: o quadro seguinte ao último é exatamente o primeiro (loop sem emenda).
 */
'use strict';

const DITHER_ANIM = { halftone: 'retícula pulsando', nintendo_ds: 'pontilhismo cintilante', bayer8: 'Bayer cintilante', floyd_approx: 'difusão deslizando', checkerboard: 'onda no xadrez', scanlines: 'linhas de TV rolando', noise: 'ruído vivo' };
const sinT = (T, ph = 0) => Math.sin(TAU * T + ph);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
function rotateMixer(p, T, a) {
    const names = [['uRR', 'uRG', 'uRB'], ['uGR', 'uGG', 'uGB'], ['uBR', 'uBG', 'uBB']];
    const rows = names.map(r => r.map(k => p[k]));
    const s = 3 * (T % 1), k = Math.floor(s), f = s - k, e = f * f * (3 - 2 * f), out = {};
    for (let r = 0; r < 3; r++) { const A = rows[(r + k) % 3], B = rows[(r + k + 1) % 3]; for (let c = 0; c < 3; c++) { const v = A[c] + (B[c] - A[c]) * e; out[names[r][c]] = rows[r][c] + (v - rows[r][c]) * a; } }
    return out;
}
// Só movimentos contínuos (nada de pulsar, piscar ou "respirar"): o loop parece infinito.
const FX_ANIM = {
    channel_mixer: { nome: 'canais girando', fn: (p, T, a) => rotateMixer(p, T, Math.min(1, a)) },
    hatching: { nome: 'anéis se expandindo', shader: true },
    outlines: { nome: 'contornos marchando', shader: true },
    pattern_refraction: { nome: 'faixas correndo', shader: true },
    warp: { nome: 'ondas correndo', fn: (p, T) => ({ uPhase: p.uPhase + TAU * T }) },
    photocopy: { nome: 'scanner vivo', shader: true },
    vhs: { nome: 'fita rodando', shader: true },
    kodak_pb: { nome: 'grão vivo', shader: true },
    vencido: { nome: 'grão vivo', shader: true },
};
const DITHER_STYLES = {
    auto: { id: 0, nome: 'Próprio' }, drift: { id: 1, nome: 'Deslizar' }, rotate: { id: 2, nome: 'Girar' }, breathe: { id: 3, nome: 'Respirar' },
    wave: { id: 4, nome: 'Ondular' }, ripple: { id: 5, nome: 'Ondas radiais' }, twist: { id: 6, nome: 'Redemoinho' }, sparkle: { id: 7, nome: 'Cintilar' },
    pulse: { id: 8, nome: 'Pulsar' }, sweep: { id: 9, nome: 'Varredura' }, glitch: { id: 10, nome: 'Glitch' }, rain: { id: 11, nome: 'Chuva' },
    dissolve: { id: 12, nome: 'Dissolver' }, spiral: { id: 13, nome: 'Espiral' }, jitter: { id: 14, nome: 'Tremer' },
};
// Cada padrão tem o seu movimento próprio, sempre contínuo e em números inteiros de
// períodos por volta (o último quadro emenda no primeiro sem salto).
const DITHER_SIGNATURE = {
    halftone: { style: 'drift', angle: 45, nome: 'retícula fluindo na diagonal' },
    nintendo_ds: { style: 'rain', angle: 90, nome: 'pontilhismo escorrendo' },
    bayer8: { style: 'drift', angle: 315, nome: 'Bayer deslizando' },
    floyd_approx: { style: 'drift', angle: 135, nome: 'difusão correndo' },
    checkerboard: { style: 'wave', angle: 0, nome: 'xadrez ondulando' },   // casas de 2 px não "andam": uma onda contínua passa por elas
    scanlines: { style: 'auto', angle: 0, nome: 'linhas de TV rolando' },
    noise: { style: 'auto', angle: 0, nome: 'ruído vivo' },
};
// estilos alternativos permitidos (todos contínuos)
const DITHER_STYLE_OPTS = ['auto', 'drift', 'rain', 'wave', 'ripple', 'spiral', 'rotate', 'sweep'];
const CAM_STYLES = { none: 0, shake: 1, zoom: 2, orbit: 3, sway: 4, tape: 5, bumps: 6, beat: 7, pan: 8 };
const CAM_NAMES = { none: 'Parada', shake: 'Tremor na mão', zoom: 'Zoom respirando', beat: 'Zoom na batida', orbit: 'Órbita', sway: 'Balanço', pan: 'Deriva lateral', tape: 'Fita ondulando', bumps: 'Solavancos' };
const COL_STYLES = { none: 0, hue: 1, bright: 2, sat: 3, flash: 4, daynight: 5, contrast: 6, rainbow: 7, temp: 8, tint: 9, duo: 10, poster: 11, solar: 12, channels: 13, neon: 14, wash: 15, vig: 16, split: 17, blocks: 18, sepia: 19, gamma: 20 };
const COL_NAMES = { none: 'Nenhuma', bright: 'Brilho pulsando', contrast: 'Contraste pulsando', gamma: 'Gama respirando', daynight: 'Dia e noite', flash: 'Piscar negativo', hue: 'Girar matiz', rainbow: 'Arco-íris', sat: 'Saturação pulsando', temp: 'Temperatura', split: 'Sombras e luzes', channels: 'Trocar canais', sepia: 'Sépia e volta', tint: 'Tingir', duo: 'Duotone pulsando', neon: 'Neon nas luzes', wash: 'Desbotar', vig: 'Vinheta colorida', poster: 'Posterizar', solar: 'Solarização', blocks: 'Blocos cintilando' };
const COL_COLOR_STYLES = new Set(['tint', 'duo', 'neon', 'wash', 'vig']);
const COL_WAVES = { sine: 0, tri: 1, saw: 2, square: 3, beat: 4 };
const COL_WAVE_NAMES = { sine: 'Suave', tri: 'Vai e volta', saw: 'Rampa', square: 'Liga/desliga', beat: 'Batida' };
const COL_TARGETS = { all: 0, shadows: 1, mids: 2, highs: 3 };
const COL_TARGET_NAMES = { all: 'Imagem toda', shadows: 'Sombras', mids: 'Meios-tons', highs: 'Luzes' };
const COL_SWEEPS = { none: 0, vertical: 1, horizontal: 2, radial: 3, diagonal: 4 };
const COL_SWEEP_NAMES = { none: 'Sem varredura', vertical: 'Vertical', horizontal: 'Horizontal', radial: 'Do centro', diagonal: 'Diagonal' };
const FX_STYLE_NAMES = { auto: 'Próprio', colors: 'Girar cores' };
const FILM_ANIM_NAMES = { live: 'Grão e poeira vivos', leak: 'Luz vazando', burn: 'Película queimando' };
const GRAIN_ANIM_NAMES = { live: 'Vivo', boil: 'Fervendo', frozen: 'Parado' };

const ANIM_PRESETS = {
    calmo: { nome: 'Calmo', amount: 70, cycles: 1, ease: 'smooth', dStyle: 'breathe', fxStyle: 'breathe', grainStyle: 'boil', camStyle: 'zoom', camAmt: 60, colStyle: 'none' },
    hipnose: { nome: 'Hipnose', amount: 120, cycles: 2, ease: 'linear', dStyle: 'spiral', dWave: 120, fxStyle: 'colors', camStyle: 'none', colStyle: 'hue', colAmt: 50 },
    glitch: { nome: 'Glitch', amount: 180, cycles: 3, ease: 'steps', dStyle: 'glitch', fxStyle: 'glitch', grainStyle: 'live', camStyle: 'bumps', camAmt: 120, colStyle: 'flash', colAmt: 40 },
    festa: { nome: 'Festa', amount: 160, cycles: 4, ease: 'pulse', dStyle: 'pulse', fxStyle: 'pulse', grainStyle: 'pulse', camStyle: 'beat', camAmt: 150, colStyle: 'rainbow', colAmt: 80 },
    vhs: { nome: 'Fita VHS', amount: 130, cycles: 2, ease: 'linear', dStyle: 'rain', fxStyle: 'auto', grainStyle: 'live', camStyle: 'tape', camAmt: 120, colStyle: 'contrast', colAmt: 50 },
    oceano: { nome: 'Oceano', amount: 120, cycles: 1, ease: 'linear', dStyle: 'wave', dAngle: 90, dWave: 90, fxStyle: 'drift', grainStyle: 'boil', camStyle: 'sway', camAmt: 80, colStyle: 'daynight', colAmt: 60 },
    estrelas: { nome: 'Estrelas', amount: 140, cycles: 2, ease: 'linear', dStyle: 'sparkle', fxStyle: 'breathe', grainStyle: 'live', camStyle: 'orbit', camAmt: 60, colStyle: 'bright', colAmt: 40 },
    neon: { nome: 'Neon', amount: 140, cycles: 2, ease: 'linear', dStyle: 'sparkle', fxStyle: 'breathe', grainStyle: 'live', colStyle: 'neon', colAmt: 120, colTarget: 'highs', colColor: '#00e5ff', camStyle: 'none' },
    polaroid: { nome: 'Sol de tarde', amount: 90, cycles: 1, ease: 'smooth', dStyle: 'breathe', fxStyle: 'breathe', grainStyle: 'boil', filmStyle: 'auto', colStyle: 'wash', colAmt: 80, colColor: '#ffb27a', camStyle: 'zoom', camAmt: 50 },
    aurora: { nome: 'Aurora', amount: 120, cycles: 1, ease: 'linear', dStyle: 'wave', fxStyle: 'drift', colStyle: 'split', colAmt: 110, colSweep: 'vertical', colSweepScale: 150, camStyle: 'sway', camAmt: 60 },
    projetor: { nome: 'Projetor', amount: 130, cycles: 2, ease: 'linear', dStyle: 'jitter', fxStyle: 'auto', grainStyle: 'live', filmStyle: 'auto', filmAmt: 150, camStyle: 'shake', camAmt: 40, colStyle: 'bright', colAmt: 30 },
    radar: { nome: 'Radar', amount: 150, cycles: 2, ease: 'linear', dStyle: 'sweep', dAngle: 45, dWave: 160, fxStyle: 'fade', grainStyle: 'frozen', camStyle: 'none', colStyle: 'none' },
};

// configuração da animação a partir do estado
// Passo de movimento dos padrões em pixel: sempre um número inteiro de pixels por quadro
// (ou meio pixel, alternando de forma regular) e o loop fechando num período inteiro.
// Assim o padrão marcha liso, sem trancos, e o fim emenda no começo.
const PX_SPEED = { 1: 0.5, 2: 1, 3: 2, 4: 3 };
function patternUnit(mode, sc, style) {
    // deslocamento (px) por unidade de fase T, igual ao shader (patPeriod × ceil(8/P))
    const P = { nintendo_ds: 4 * sc, floyd_approx: 4 * sc, bayer8: 8 * sc, checkerboard: 2 * sc, scanlines: 3 * sc }[mode];
    if (!P) return 0;
    if (style === 'auto') return mode === 'scanlines' ? 3 * sc : 0;         // linhas de TV nativas
    if (style === 'drift' || style === 'rain') return P * Math.ceil(8 / P);
    return 0;
}
function readAnim(st, format = 'mp4') {
    const A = st.anim, amount = A.amount / 100;
    let fps = +A.fps; if (format === 'gif') fps = Math.min(fps, 50);
    let frames = Math.max(2, Math.round(fps * A.duration)), cycles = +A.cycles;
    if (A.dither && st.dither.mode !== 'none') {
        const sig = DITHER_SIGNATURE[st.dither.mode] || { style: 'auto' };
        const style = (A.dStyle === 'auto' || !DITHER_STYLE_OPTS.includes(A.dStyle)) ? sig.style : A.dStyle;
        const U = patternUnit(st.dither.mode, Math.max(1, Math.round(st.dither.scale)), style);
        if (U) {
            const r = PX_SPEED[Math.min(4, Math.max(1, Math.round(cycles)))] || 1;
            // menor quantidade de quadros (≥ a pedida) em que r·F é múltiplo do período
            let F = frames; for (let k = 0; k < frames && (r * F) % U !== 0; k++) F++;
            if ((r * F) % U === 0) { frames = F; cycles = r * F / U; }
        }
    }
    const duration = frames / fps;
    return {
        format, fps, duration, frames, cycles, amount,
        direction: A.direction === 'reverse' ? 'reverse' : 'forward', ease: 'linear',   // sempre constante: sem vai-e-volta nem trancos
        dither: { on: A.dither, style: A.dStyle, angle: A.dAngle * Math.PI / 180, wave: +A.dWave, amt: amount * A.dAmt / 100 },
        fx: { on: A.fx, style: A.fxStyle, amt: amount * A.fxAmt / 100 },
        grain: { on: A.grain, style: A.grainStyle, amt: amount * A.grainAmt / 100 },
        film: { on: A.film, style: A.filmStyle, amt: amount * A.filmAmt / 100 },
        cam: { style: A.camStyle, amt: amount * A.camAmt / 100, offset: +A.camOffset },
        col: { style: A.colStyle, amt: amount * A.colAmt / 100, offset: +A.colOffset, speed: Math.max(1, Math.round(A.colSpeed)), wave: A.colWave, target: A.colTarget, sweep: A.colSweep, sweepScale: A.colSweepScale / 100, color: A.colColor },
    };
}
function animPhase(i, cfg) {
    let u = (i % cfg.frames) / cfg.frames;
    if (cfg.direction === 'reverse') u = 1 - u; else if (cfg.direction === 'pingpong') u = 1 - Math.abs(1 - 2 * u);
    if (cfg.ease === 'smooth') u = 0.5 - 0.5 * Math.cos(Math.PI * u);
    else if (cfg.ease === 'pulse') u = u - Math.sin(TAU * u * cfg.cycles) / (TAU * cfg.cycles);
    else if (cfg.ease === 'steps') u = Math.floor(u * cfg.cycles * 6) / (cfg.cycles * 6);
    else if (cfg.ease === 'bounce') { const k = u * cfg.cycles, f = k - Math.floor(k); u = (Math.floor(k) + (1 - Math.pow(1 - f, 3))) / cfg.cycles; }
    return u * cfg.cycles;
}
// lista legível do que vai se mover
function describeAnimation(s, cfg) {
    if (cfg.amount <= 0) return [];
    const parts = [];
    if (cfg.dither.on && cfg.dither.amt > 0 && s.dither.mode !== 'none' && DITHER_SIGNATURE[s.dither.mode]) parts.push(cfg.dither.style === 'auto' ? DITHER_SIGNATURE[s.dither.mode].nome : 'padrão: ' + DITHER_STYLES[cfg.dither.style].nome.toLowerCase());
    if (cfg.fx.on && cfg.fx.amt > 0 && s.fx && (FX_ANIM[s.fx.id] || cfg.fx.style === 'colors')) parts.push(cfg.fx.style === 'colors' ? 'cores da textura girando' : FX_ANIM[s.fx.id].nome);
    if (cfg.grain.on && cfg.grain.amt > 0 && s.grain && cfg.grain.style !== 'frozen') parts.push('grão ' + GRAIN_ANIM_NAMES[cfg.grain.style].toLowerCase());
    const fm = s.film;
    if (fm && cfg.film.on && cfg.film.amt > 0) {
        if (fm.fx && FX_ANIM[fm.fx.id]) parts.push(FX_ANIM[fm.fx.id].nome);
        const u = fm.u, st = cfg.film.style;
        if (u) {
            const live = u.uGrain + u.uDust + u.uScratch + u.uChromaNoise + u.uInterlace > 0;
            const s2 = FILM_ANIM_NAMES[st] ? st : 'live';
            const ok = (s2 === 'leak' && u.uLeak > 0) || (s2 === 'burn' && u.uBurn > 0) || (s2 === 'live' && live);
            if (ok) parts.push(FILM_ANIM_NAMES[s2].toLowerCase());
        }
    }
    return parts;
}
const fxHash = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
function fxRange(id, key, base) { const r = (FX_RANGES_BY_EFFECT[id] || {})[key] || FX_RANGES[key]; return r || [Math.min(0, base * 2), Math.max(1, Math.abs(base) * 2)]; }
function styleFxParams(id, style, base, T, a) {
    const out = {};
    const keys = Object.keys(base).filter(k => !/_(r|g|b)$/.test(k) && !['uVariant', 'uHue', 'uSeed'].includes(k));
    if (style === 'colors') {
        const groups = {};
        Object.keys(base).forEach(k => { const m = k.match(/^(.*)_(r|g|b)$/); if (m) (groups[m[1]] = groups[m[1]] || {})[m[2]] = k; });
        Object.values(groups).forEach((g, gi) => {
            if (!g.r || !g.g || !g.b) return;
            const hsl = rgbToHsl(base[g.r] * 255, base[g.g] * 255, base[g.b] * 255);
            if (hsl.l < 0.06 || hsl.l > 0.94) return;
            const turn = a >= 1 ? T * Math.floor(a) : a * 0.5 * Math.sin(TAU * T);
            const c = hslToRgb((((hsl.h + turn + gi * 0.1) % 1) + 1) % 1, Math.max(hsl.s, 0.35 * Math.min(a, 1)), hsl.l);
            out[g.r] = c.r / 255; out[g.g] = c.g / 255; out[g.b] = c.b / 255;
        });
        if (id === 'lumiere') out.uHue = (((base.uHue || 0) + T * Math.max(1, Math.floor(a))) % 1 + 1) % 1;
        if (!Object.keys(out).length) return styleFxParams(id, 'breathe', base, T, a);
        return out;
    }
    keys.forEach((k, ki) => {
        const [lo, hi] = fxRange(id, k, base[k]), span = hi - lo, ph = ki * 1.7; let d = 0;
        if (style === 'breathe' || style === 'combo') d = 0.22 * Math.sin(TAU * T + ph);
        else if (style === 'pulse') d = 0.4 * Math.pow(0.5 + 0.5 * Math.cos(TAU * T + ph * 0.3), 6) - 0.08;
        else if (style === 'drift') d = 0.16 * (Math.sin(TAU * T + ph) + 0.6 * Math.sin(TAU * 2 * T + ph * 2.3));
        else if (style === 'glitch') { const st = Math.floor(((T % 1) + 1) % 1 * 8); d = fxHash(st, ki) > 0.4 ? (fxHash(st + 9, ki) - 0.5) * 0.7 : 0; }
        out[k] = Math.max(lo, Math.min(hi, base[k] + span * d * a));
    });
    if (style === 'glitch' && base.uSeed !== undefined) out.uSeed = base.uSeed + Math.floor(((T % 1) + 1) % 1 * 8);
    return out;
}
// opções de render do quadro i da animação
function animFrameOptions(i, cfg, s) {
    const T = animPhase(i, cfg), frame = (i % cfg.frames) + 1;
    const D = cfg.dither, F = cfg.fx, G = cfg.grain;
    const dOn = D.on && D.amt > 0 && s.dither.mode !== 'none';
    const sig = DITHER_SIGNATURE[s.dither.mode] || { style: 'auto', angle: 0 };
    const dStyle = (D.style === 'auto' || !DITHER_STYLE_OPTS.includes(D.style)) ? sig.style : D.style;
    const dAngle = (D.style === 'auto' || !DITHER_STYLE_OPTS.includes(D.style)) ? sig.angle * Math.PI / 180 : D.angle;
    const anim = {
        T, frame, amt: dOn ? Math.max(1, D.amt) : 0,
        dStyle: dOn ? DITHER_STYLES[dStyle].id : 0, dAngle, dWave: D.wave, dAmp: D.amt,
        fxT: 0, fxFrame: 0, fxParams: null, fxMix: null,
        cam: { mode: 0, T: 0, amt: 0 },   // sem mover a imagem (zoom, giro, tremor)
        col: { mode: 0, T: T * cfg.col.speed + cfg.col.offset / 360, amt: cfg.col.amt, wave: COL_WAVES[cfg.col.wave] || 0, target: COL_TARGETS[cfg.col.target] || 0, sweep: COL_SWEEPS[cfg.col.sweep] || 0, sweepScale: cfg.col.sweepScale, color: rgbArr(cfg.col.color) },
    };
    const def = F.on && F.amt > 0 && s.fx && (FX_ANIM[s.fx.id] || (F.style === 'colors' && { nome: '' }));
    if (def) {
        const base = Object.assign({}, PixelarFX.getEffectDef(s.fx.id).uniforms, s.fx.params);
        anim.fxFrame = frame; let params = {};
        if (F.style !== 'colors') { if (def.shader) anim.fxT = T; if (def.fn) params = def.fn(base, T, F.amt); }
        if (F.style === 'colors') params = styleFxParams(s.fx.id, 'colors', base, T, Math.max(1, F.amt));
        anim.fxParams = Object.assign({}, s.fx.params, params);
    }
    const Fm = cfg.film;
    if (s.film && Fm.on && Fm.amt > 0) {
        const a = Fm.amt, st = Fm.style;
        const af = { T, frame, weave: 0, flicker: 0, leak: st === 'leak' ? a * 1.5 : 0, burn: st === 'burn' ? a : 0, fxParams: null, fxT: 0 };
        const lf = s.film.fx, d2 = lf && FX_ANIM[lf.id];
        if (d2) { const base = Object.assign({}, PixelarFX.getEffectDef(lf.id).uniforms, lf.params); if (d2.shader) af.fxT = T; if (d2.fn) af.fxParams = Object.assign({}, lf.params, d2.fn(base, T, a)); }
        anim.film = af;
    }
    let grainSeed = 0, grainScale = 1, grainCell = 1;
    if (s.grain && G.on && G.amt > 0) {
        if (G.style === 'live') { grainSeed = frame; grainScale = Math.max(0.3, 0.5 + 0.5 * G.amt); }
        else if (G.style === 'boil') { const steps = Math.max(2, Math.round(cfg.frames / 4)); grainSeed = Math.floor((i % cfg.frames) * steps / cfg.frames) + 1; grainScale = Math.max(0.3, 0.5 + 0.5 * G.amt); }
    }
    return { anim, grainSeed, grainScale, grainCell };
}

// ============================================================
// ALEATÓRIO — sorteios contidos, guiados pela análise da imagem
// ============================================================
const FX_RANGES = {
    uThreshold: [0, 1], uIntensity: [0, 2], uRadius: [0, 20], uBoost: [0, 6], uSpeed: [-1, 1], uScale: [0.5, 40], uGrain: [0, 0.5], uSaturation: [0, 1],
    uContrast: [0.2, 3], uShadowLift: [-0.3, 0.3], uTemp: [-0.3, 0.3], uSatMid: [0, 2], uGray: [0, 1], uAngle: [0, 6.283], uSmooth: [0.01, 0.3], uFreq: [0.5, 20], uThickness: [0.5, 10],
    uAmount: [0, 1], uChroma: [0, 0.05], uZoom: [0.5, 1.5], uSpacing: [2, 40], uBands: [2, 40], uShift: [0, 0.3], uStretch: [0, 1], uSizeX: [2, 40], uSizeY: [2, 40],
    uSlices: [2, 40], uSeed: [0, 20], uDuo: [0, 1], uBlend: [0, 1], uMirror: [0, 1], uDither: [0, 1], uRings: [2, 40], uDotSize: [0.05, 0.5], uStarDensity: [10, 150],
    uOffset: [0, 1], uPhase: [0, 12.566], uToneAmount: [0, 1], uStreaks: [0, 1], uJitter: [0, 0.03], uBleed: [0, 0.02], uScanline: [0, 1], uNoise: [0, 0.3],
    uFade: [0, 1], uSatShift: [0, 1.5], uBlackPoint: [0, 0.3], uWhitePoint: [0.7, 1], uWarmth: [0, 1], uMicroGrain: [0, 0.3], uSpread: [0.1, 1.5], uSoftness: [0.01, 1],
    uRR: [-1, 2], uRG: [-1, 2], uRB: [-1, 2], uGR: [-1, 2], uGG: [-1, 2], uGB: [-1, 2], uBR: [-1, 2], uBG: [-1, 2], uBB: [-1, 2],
};
const FX_RANGES_BY_EFFECT = { vignette: { uRadius: [0, 1.5], uSoftness: [0.01, 1.5], uIntensity: [0, 1.5] } };
const FX_LABELS = {
    uThreshold: 'Limiar', uIntensity: 'Intensidade', uRadius: 'Raio', uBoost: 'Realce', uScale: 'Escala', uGrain: 'Granulado', uContrast: 'Contraste', uShadowLift: 'Sombras',
    uSatMid: 'Saturação', uAngle: 'Ângulo', uSmooth: 'Suavidade', uFreq: 'Frequência', uThickness: 'Espessura', uAmount: 'Quantidade', uChroma: 'Aberração', uZoom: 'Zoom',
    uSpacing: 'Espaçamento', uBands: 'Faixas', uShift: 'Deslocamento', uSizeX: 'Largura', uSizeY: 'Altura', uSlices: 'Fatias', uSeed: 'Semente', uDuo: 'Duotone', uPhase: 'Fase',
    uToneAmount: 'Tom', uStreaks: 'Riscos', uJitter: 'Trepidação', uBleed: 'Sangria', uScanline: 'Linhas', uNoise: 'Ruído', uFade: 'Desbotado', uSatShift: 'Saturação',
    uBlackPoint: 'Preto', uWhitePoint: 'Branco', uWarmth: 'Calor', uMicroGrain: 'Micro-grão', uSpread: 'Alcance', uSoftness: 'Suavidade',
    uRR: 'R ← R', uRG: 'R ← G', uRB: 'R ← B', uGR: 'G ← R', uGG: 'G ← G', uGB: 'G ← B', uBR: 'B ← R', uBG: 'B ← G', uBB: 'B ← B',
};
const FX_COLOR_LABELS = { uColor: 'Cor', uColorA: 'Cor A', uColorB: 'Cor B', uFg: 'Traço', uBg: 'Fundo', uShadowTone: 'Sombras', uHighTone: 'Luzes', uInk: 'Tinta', uPaper: 'Papel', uLeak: 'Vazamento' };

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
// ============================================================
// PALETAS VIVAS (aleatório e Surpresa)
// Combinações que se complementam: esquemas harmônicos com saturação alta,
// sempre com uma rampa de luz do escuro ao claro (a imagem não fica "chapada").
// ============================================================
const CURATED_PALETTES = [
    ['#001219', '#005F73', '#0A9396', '#94D2BD', '#E9D8A6', '#EE9B00', '#CA6702', '#AE2012'],
    ['#264653', '#2A9D8F', '#E9C46A', '#F4A261', '#E76F51'],
    ['#FFBE0B', '#FB5607', '#FF006E', '#8338EC', '#3A86FF'],
    ['#10002B', '#3C096C', '#7B2CBF', '#C77DFF', '#E0AAFF'],
    ['#006D77', '#83C5BE', '#EDF6F9', '#FFDDD2', '#E29578'],
    ['#F72585', '#7209B7', '#3A0CA3', '#4361EE', '#4CC9F0'],
    ['#0D1B2A', '#1B263B', '#415A77', '#E0E1DD', '#FCA311'],
    ['#FF595E', '#FFCA3A', '#8AC926', '#1982C4', '#6A4C93'],
    ['#2D00F7', '#8900F2', '#E500A4', '#F20089', '#FFB600'],
    ['#0B090A', '#660708', '#A4161A', '#E5383B', '#F5F3F4'],
    ['#012A4A', '#01497C', '#2C7DA0', '#A9D6E5', '#FFD166'],
    ['#1B4332', '#2D6A4F', '#52B788', '#B7E4C7', '#FFB703', '#FB8500'],
    ['#22223B', '#4A4E69', '#9A8C98', '#F2E9E4', '#E07A5F'],
    ['#000000', '#14213D', '#FCA311', '#E5E5E5', '#FFFFFF'],
    ['#3D348B', '#7678ED', '#F7B801', '#F18701', '#F35B04'],
    ['#011627', '#2EC4B6', '#CBF3F0', '#FFFFFF', '#FFBF69', '#FF9F1C'],
    ['#1D3557', '#457B9D', '#A8DADC', '#F1FAEE', '#E63946'],
    ['#231942', '#5E548E', '#9F86C0', '#E0B1CB', '#FFD6A5'],
    ['#0A0908', '#22333B', '#5E503F', '#C6AC8F', '#EAE0D5', '#D4502B'],
    ['#390099', '#9E0059', '#FF0054', '#FF5400', '#FFBD00'],
    ['#1A1A2E', '#9B5DE5', '#F15BB5', '#FEE440', '#00BBF9', '#00F5D4'],
    ['#2B193D', '#2C365E', '#4B8F8C', '#C5979D', '#F6BD60'],
    ['#0B132B', '#3A506B', '#5BC0BE', '#F7F7FF', '#FF6B6B'],
    ['#03071E', '#6A040F', '#D00000', '#E85D04', '#FAA307', '#FFBA08'],
    ['#0F4C5C', '#E36414', '#FB8B24', '#9A031E', '#5F0F40'],
    ['#073B4C', '#118AB2', '#06D6A0', '#FFD166', '#EF476F'],
    ['#13111C', '#3F3D56', '#FF7A5C', '#FFC857', '#E9F2F9'],
    ['#140D4F', '#4EA699', '#2DD881', '#6FEDB7', '#F5F749', '#F24236'],
];
const SCHEMES = {
    complementar: [0, 0.5], dividido: [0, 0.42, 0.58], triade: [0, 1 / 3, 2 / 3], tetrade: [0, 0.25, 0.5, 0.75],
    analogo: [0, 0.07, 0.14, 0.55],   // análogas + uma de contraste
    quente_frio: [0.03, 0.1, 0.55, 0.62],
};
function vividPalette(qty) {
    const base = Math.random(), hues = SCHEMES[pick(Object.keys(SCHEMES))];
    const out = [];
    for (let i = 0; i < qty; i++) {
        const t = qty > 1 ? i / (qty - 1) : 0.5;
        const l = 0.1 + t * 0.8;                                   // rampa de luz: escuro → claro
        const h = (base + hues[i % hues.length] + (Math.random() - 0.5) * 0.03 + 1) % 1;
        const edge = Math.min(t, 1 - t) * 2;                        // extremos um pouco menos saturados
        const sat = 0.55 + 0.45 * Math.min(1, edge * 1.6) * (0.85 + Math.random() * 0.15);
        out.push(hslToRgb(h, sat, l));
    }
    return out;
}
function randomPalette(qty) {
    if (Math.random() < 0.5) { const p = pick(CURATED_PALETTES); return (Math.random() < 0.5 ? p : p.slice().reverse()).map(hexToRgb).sort((a, b) => luma(a) - luma(b)); }
    return vividPalette(qty);
}

function randNear(base, spread) { return base + (Math.random() - Math.random()) * spread; }
function clampV(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function randFxParams(id) {
    const def = PixelarFX.getEffectDef(id); const params = {};
    Object.keys(def.uniforms).forEach(k => {
        const dv = def.uniforms[k];
        if (/_(r|g|b)$/.test(k)) { params[k] = clamp01(dv + (Math.random() * 2 - 1) * 0.25); return; }
        if (k === 'uVariant' || k === 'uHue') return;
        const r = (FX_RANGES_BY_EFFECT[id] || {})[k] || FX_RANGES[k];
        params[k] = r ? clampV(dv + (Math.random() * 2 - 1) * (r[1] - r[0]) * 0.35, r[0], r[1]) : dv;
    });
    return params;
}

const RANDOM_GROUPS = {
    luz: 'Luz e cor', pixel: 'Tamanho do pixel', dither: 'Padrão', palette: 'Paleta', edge: 'Contorno', fx: 'Efeito', grain: 'Granulado', film: 'Filme', grad: 'Degradê', anim: 'Movimento',
};
// muta st; locks = Set de caminhos travados ('adj.exposure'...); groups = Set de grupos ligados
function randomize(st, A, groups, locks, only, vivid) {
    // modo vivo (Surpresa): sempre uma paleta, filmes mais raros e leves, luz puxando para cor e contraste
    if (vivid && groups.has('palette')) { groups = new Set(groups); }
    const on = (g) => (only ? only === g || (Array.isArray(only) && only.includes(g)) : groups.has(g));
    const L = (p) => locks.has(p);
    const set = (path, v) => { if (L(path)) return; const [a, b] = path.split('.'); st[a][b] = v; };
    const touched = [];
    if (on('luz')) {
        set('adj.exposure', Math.round(clampV(randNear(A ? (A.isDark ? 12 : A.isBright ? -12 : 0) : 0, 35), -60, 60)));
        set('adj.brightness', Math.round(clampV(randNear(A ? (A.isDark ? 10 : A.isBright ? -10 : 0) : 0, 30), -55, 55)));
        set('adj.contrast', Math.round(clampV(randNear(A ? (A.isLowContrast ? 14 : A.isHighContrast ? -14 : 0) : 0, 30), -55, 55)));
        set('adj.shadows', Math.round(clampV(randNear(0, 30), -55, 55)));
        set('adj.temperature', Math.round(clampV(randNear(0, 30), -55, 55)));
        set('adj.saturation', Math.round(clampV(randNear((A ? (A.isLowSat ? 10 : A.isHighSat ? -10 : 0) : 0) + (vivid ? 22 : 0), vivid ? 18 : 30), -55, 70)));
        if (vivid) { set('adj.contrast', Math.round(clampV(randNear(12, 14), -10, 45))); set('adj.exposure', Math.round(clampV(randNear(A && A.isDark ? 18 : 4, 14), -20, 45))); }
        set('adj.posterize', vivid || Math.random() < 0.7 ? 0 : Math.round(5 + Math.random() * 25));
        touched.push('luz');
    }
    if (on('pixel')) { set('pixel.size', 1 + Math.floor(Math.random() * 4)); touched.push('pixel ' + st.pixel.size); }
    if (on('dither')) {
        set('dither.mode', pick(['none', 'nintendo_ds', 'halftone', 'checkerboard', 'scanlines', 'noise', 'bayer8', 'floyd_approx']));
        const busy = A && A.isBusy;
        set('dither.scale', Math.floor(Math.random() * (busy ? 2 : 3)) + 1);
        set('dither.intensity', Math.floor(Math.random() * (busy ? 50 : 80)) + 30);
        touched.push(DITHER_NAMES[st.dither.mode]);
    }
    if (on('palette') && !L('color.palette')) {
        const c = st.color;
        let qty = parseInt(c.sel, 10);
        if (!L('color.sel') || isNaN(qty)) qty = pick([3, 4, 5, 6, 6, 8, 8, 12]);
        c.mode = 'random'; c.invert = false;
        const pal = (L('color.sel') ? vividPalette(qty) : randomPalette(qty)).map(rgbHex);
        c.sel = String(pal.length);
        // mapa de tons: a paleta (do escuro ao claro) é distribuída pela luz da imagem,
        // então todas as cores aparecem — em vez de a foto só "puxar" as cores parecidas com ela
        const n = pal.length, ramp = pal.map((_, i) => { const v = Math.round(18 + 219 * (n > 1 ? i / (n - 1) : 0.5)); return rgbToHex(v, v, v); });
        c.base = pal.slice(); c.ref = ramp; c.hue = c.sat = c.light = 0;
        touched.push(pal.length + ' cores');
    }
    if (on('edge')) { set('edge.size', Math.random() > 0.5 ? 0 : Math.floor(Math.random() * 2) + 1); set('edge.color', rgbToHex(Math.random() * 255, Math.random() * 255, Math.random() * 255)); }
    if (on('fx') && !L('fx.id')) {
        if (Math.random() < (vivid ? 0.3 : A && A.isBusy ? 0.35 : 0.6)) {
            // no modo vivo, só texturas que preservam as cores (as outras repintam com cores próprias)
            const keepColor = ['pattern_refraction', 'pixelate_fx', 'slice_shift', 'vhs', 'channel_mixer'];
            const choice = pick(PixelarFX.listEffects().filter(f => !vivid || keepColor.includes(f.id)));
            st.fx.id = choice.id; st.fxParams[choice.id] = randFxParams(choice.id); st.fx.mix = 50 + Math.floor(Math.random() * 31);
            touched.push(PixelarFX.getEffectDef(choice.id).nome);
        } else st.fx.id = 'none';
    }
    if (on('grain') && !L('grain.amount')) {
        const g = st.grain, busy = A && A.isBusy;
        if (Math.random() < (vivid ? 0.25 : busy ? 0.3 : 0.45)) {
            g.amount = 10 + Math.floor(Math.random() * (busy ? 15 : 30)); g.size = 70 + Math.floor(Math.random() * 90); g.rough = 25 + Math.floor(Math.random() * 45);
            g.bias = Math.floor(Math.random() * 50); g.speckle = Math.random() < 0.3 ? Math.floor(Math.random() * 30) : 0; g.mono = Math.random() < 0.7;
            touched.push('grão');
        } else g.amount = 0;
    }
    if (on('film') && !L('film.look')) {
        const keep = { frame: st.film.frame, stamp: st.film.stamp, frameColor: st.film.frameColor, stampColor: st.film.stampColor };
        st.film = Object.assign(deepClone(DEFAULT_STATE.film), keep);
        if (Math.random() < (vivid ? 0.3 : 0.5)) {
            const bw = ['noir', 'hp5', 'nitrato', 'kodak_pb', 'lumiere'];
            const ids = Object.keys(FILM_LOOKS).filter(k => !(st.color.sel !== 'all' && bw.includes(k)));
            const id = pick(ids); st.film.look = id; st.film.mix = vivid ? 35 + Math.floor(Math.random() * 3) * 10 : 50 + Math.floor(Math.random() * 4) * 10;
            if (id === 'vencido') st.film.vencido = Math.floor(Math.random() * 4);
            if (id === 'lumiere') st.film.lumiereHue = Math.floor(Math.random() * 360);
            touched.push(FILM_LOOKS[id].nome);
        }
        if (Math.random() < (vivid ? 0.2 : 0.35)) {
            st.film.vignette = Math.floor(Math.random() * (vivid ? 25 : 50));
            if (Math.random() < 0.3) st.film.halation = Math.floor(Math.random() * 40);
            if (Math.random() < 0.25) st.film.soft = Math.floor(Math.random() * 30);
            if (Math.random() < 0.2) st.film.leak = Math.floor(Math.random() * 50);
        }
    }
    if (on('grad') && !L('grad.on')) {
        if (Math.random() < 0.35) { randGradAll(st.grad); touched.push('degradê'); } else st.grad.on = false;
    }
    if (on('anim')) randAnim(st.anim);
    return touched;
}

function randGradColors(g) {
    const base = Math.random(), scheme = pick(['analogas', 'complementar', 'triade', 'mono', 'quente', 'fria', 'pastel', 'neon']);
    const qty = 2 + Math.floor(Math.random() * 3), out = [];
    const gHex = (h, s, l) => { const c = hslToRgb(((h % 1) + 1) % 1, s, l); return rgbHex(c); };
    for (let i = 0; i < qty; i++) {
        const k = qty > 1 ? i / (qty - 1) : 0; let h = base, s = 0.7, l = 0.5;
        if (scheme === 'analogas') { h = base + k * 0.16; s = 0.65 + 0.2 * Math.random(); l = 0.35 + k * 0.3; }
        else if (scheme === 'complementar') { h = base + k * 0.5; l = 0.3 + k * 0.4; }
        else if (scheme === 'triade') { h = base + k * 0.333; s = 0.72; l = 0.45; }
        else if (scheme === 'mono') { s = 0.55; l = 0.15 + k * 0.7; }
        else if (scheme === 'quente') { h = 0.02 + k * 0.13; s = 0.85; l = 0.3 + k * 0.4; }
        else if (scheme === 'fria') { h = 0.45 + k * 0.18; l = 0.3 + k * 0.4; }
        else if (scheme === 'pastel') { h = base + k * 0.25; s = 0.45; l = 0.72 + k * 0.1; }
        else { h = base + k * 0.4; s = 1; l = 0.5 + k * 0.08; }
        out.push(gHex(h, s, l));
    }
    g.colors = out;
}
function randGradShape(g) {
    g.type = pick(GRAD_SHAPES); g.angle = Math.floor(Math.random() * 24) * 15; g.cx = 30 + Math.floor(Math.random() * 41); g.cy = 30 + Math.floor(Math.random() * 41);
    g.scale = 60 + Math.floor(Math.random() * 15) * 10; g.repeat = pick([1, 1, 1, 2, 2, 3, 4]); g.mirror = Math.random() < 0.4;
    g.steps = Math.random() < 0.55 ? 0 : 2 + Math.floor(Math.random() * 10); g.pos = 35 + Math.floor(Math.random() * 31); g.smooth = 40 + Math.floor(Math.random() * 61);
}
function randGradAll(g) { g.on = true; randGradColors(g); randGradShape(g); g.blend = pick(GRAD_BLENDS); g.opacity = 40 + Math.floor(Math.random() * 13) * 5; g.noise = Math.random() < 0.5 ? 0 : Math.floor(Math.random() * 40); }
function randAnim(a) {
    a.amount = 100; a.cycles = pick([1, 1, 2, 2, 3]); a.direction = pick(['forward', 'forward', 'reverse']); a.ease = 'linear';
    a.dStyle = pick(['auto', 'auto', 'auto', 'drift', 'rain', 'wave', 'ripple', 'spiral', 'sweep']);
    a.dAngle = pick([0, 45, 90, 135, 180, 225, 270, 315]); a.dWave = pick([64, 96, 160, 240]);
    a.fxStyle = pick(['auto', 'auto', 'colors']); a.grainStyle = pick(['live', 'boil']); a.filmStyle = pick(['live', 'live', 'leak', 'burn']);
    a.camStyle = 'none'; a.colStyle = 'none';
    a.dither = a.fx = a.grain = a.film = true;
}

const DITHER_NAMES = { none: 'Sólido', nintendo_ds: 'Pontilhismo', halftone: 'Retícula', checkerboard: 'Xadrez', scanlines: 'TV analógica', noise: 'Ruído', bayer8: 'Bayer fino', floyd_approx: 'Difusão' };
