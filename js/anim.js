/* Pixelar — animação em loop e modo aleatório.
 * A fase T percorre um número inteiro de ciclos e todos os movimentos têm
 * período 1: o quadro seguinte ao último é exatamente o primeiro (loop sem emenda).
 */
'use strict';

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
    starlight: { nome: 'estrelas cintilando', shader: true },
    channel_mixer: { nome: 'canais girando', fn: (p, T, a) => rotateMixer(p, T, Math.min(1, a)) },
    pattern_refraction: { nome: 'faixas correndo', shader: true },
    warp: { nome: 'ondas correndo', fn: (p, T) => ({ uPhase: p.uPhase + TAU * T }) },
    vhs: { nome: 'fita rodando', shader: true },
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
    bayer8: { style: 'drift', angle: 315, nome: 'Bayer deslizando' },
    checkerboard: { style: 'wave', angle: 0, nome: 'xadrez ondulando' },   // casas de 2 px não "andam": uma onda contínua passa por elas
    scanlines: { style: 'auto', angle: 0, nome: 'linhas de TV rolando' },
    noise: { style: 'auto', angle: 0, nome: 'ruído vivo' },
};
// estilos alternativos permitidos (todos contínuos)
const DITHER_STYLE_OPTS = ['auto', 'drift', 'rain', 'wave', 'ripple', 'spiral', 'rotate', 'sweep'];
const COL_WAVES = { sine: 0, tri: 1, saw: 2, square: 3, beat: 4 };
const COL_TARGETS = { all: 0, shadows: 1, mids: 2, highs: 3 };
const COL_SWEEPS = { none: 0, vertical: 1, horizontal: 2, radial: 3, diagonal: 4 };
const FX_STYLE_NAMES = { auto: 'Próprio', colors: 'Girar cores' };
const FILM_ANIM_NAMES = { live: 'Grão e poeira vivos', leak: 'Luz vazando', burn: 'Película queimando' };
const GRAIN_ANIM_NAMES = { live: 'Vivo', boil: 'Fervendo', frozen: 'Parado' };


// configuração da animação a partir do estado
// Passo de movimento dos padrões em pixel: sempre um número inteiro de pixels por quadro
// (ou meio pixel, alternando de forma regular) e o loop fechando num período inteiro.
// Assim o padrão marcha liso, sem trancos, e o fim emenda no começo.
const PX_SPEED = { 1: 0.5, 2: 1, 3: 2, 4: 3 };
function patternUnit(mode, sc, style) {
    // deslocamento (px) por unidade de fase T, igual ao shader (patPeriod × ceil(8/P))
    const P = { bayer8: 8 * sc, checkerboard: 2 * sc, scanlines: 3 * sc }[mode];
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
const FX_RANGES_BY_EFFECT = {
    oil: { uBrush: [2, 30], uImpasto: [0, 2], uStroke: [0, 1.5], uSat: [0.5, 2] },
    ascii: { uCell: [5, 28], uContrast: [0.5, 2.5], uBg: [0, 0.6] },
    starlight: { uThreshold: [0.4, 0.98], uLength: [5, 80], uIntensity: [0, 3], uDiagonal: [0, 1] },
    stipple: { uCell: [3, 16], uJitter: [0, 1], uGamma: [0.5, 2.5] },
    fluted_glass: { uRib: [6, 60], uStrength: [0, 2], uAngle: [0, 3.1416], uShade: [0, 1] },
    cmyk_halftone: { uCell: [3, 20], uDot: [0.5, 1.6] },
    thermal: { uContrast: [0.5, 2.5], uShift: [-0.5, 0.5], uBlur: [0, 2] },
    emboss: { uStrength: [0.2, 4], uAngle: [0, 6.2832], uColorMix: [0, 1] },
    bitmap: { uThreshold: [0.1, 0.9], uNoise: [0, 1], uColorMix: [0, 1] },
    color_threshold: { uThreshold: [0.1, 0.9], uSoft: [0, 0.3], uSplit: [0, 0.4] },
    neon_trace: { uThickness: [0.5, 4], uGlow: [0, 2], uThreshold: [0.02, 0.4], uBg: [0, 0.6] },
    smudge: { uLength: [4, 80], uAngle: [0, 6.2832], uFlow: [0, 1.5] },
    riso: { uOffset: [0, 16], uGrain: [0, 1] },
    pixel_sort: { uThreshold: [0.1, 0.9], uLength: [10, 400], uVertical: [0, 1] },
    lego: { uCell: [8, 48], uLevels: [2, 10], uStud: [0, 1] },
    lcd: { uCell: [2, 16], uGap: [0, 0.4], uLevels: [2, 8] },
    led: { uCell: [5, 30], uSize: [0.3, 1], uGlow: [0, 1.5], uBoost: [0.5, 2.5] },
    stained_glass: { uCell: [15, 120], uLead: [0.02, 0.3], uSat: [0.5, 2.5] },
    blueprint: { uGrid: [10, 120], uLines: [0.03, 0.4], uFill: [0, 1] },
};
const FX_LABELS = {
    uBrush: 'Pincel', uImpasto: 'Relevo da tinta', uStroke: 'Marcas do pincel', uBleed: 'Escorrido', uPaper: 'Papel',
    uThreshold: 'Limiar', uIntensity: 'Intensidade', uRadius: 'Raio', uBoost: 'Realce', uScale: 'Escala', uGrain: 'Granulado', uContrast: 'Contraste', uShadowLift: 'Sombras',
    uSatMid: 'Saturação', uAngle: 'Ângulo', uSmooth: 'Suavidade', uFreq: 'Frequência', uThickness: 'Espessura', uAmount: 'Quantidade', uChroma: 'Aberração', uZoom: 'Zoom',
    uSpacing: 'Espaçamento', uBands: 'Faixas', uShift: 'Deslocamento', uSizeX: 'Largura', uSizeY: 'Altura', uSlices: 'Fatias', uSeed: 'Semente', uDuo: 'Duotone', uPhase: 'Fase',
    uToneAmount: 'Tom', uStreaks: 'Riscos', uJitter: 'Trepidação', uBleed: 'Sangria', uScanline: 'Linhas', uNoise: 'Ruído', uFade: 'Desbotado', uSatShift: 'Saturação',
    uCell: 'Tamanho', uColorMode: 'Cor original', uPitch: 'Grade', uMask: 'Máscara RGB', uScan: 'Linhas', uCurve: 'Curvatura', uGlow: 'Brilho', uHole: 'Furo', uShine: 'Reflexo',
    uDepth: 'Relevo', uFuzz: 'Fiapos', uGrout: 'Rejunte', uBrick: 'Tijolos', uBevel: 'Chanfro', uLines: 'Linhas', uLevels: 'Níveis', uFill: 'Foto por baixo', uLength: 'Comprimento',
    uDiagonal: 'Diagonais', uGamma: 'Densidade', uWarp: 'Ondulação', uHeight: 'Altura', uFiber: 'Fibras', uRib: 'Canelura', uStrength: 'Força', uShade: 'Sombra', uDot: 'Ponto',
    uCaustics: 'Cáusticas', uBlur: 'Suavizar', uColorMix: 'Cor', uWash: 'Aguada', uSplit: 'Separação', uSoft: 'Suavidade', uHalo: 'Halo', uSat: 'Saturação', uFlow: 'Fluxo', uBg: 'Fundo',
    uBlackPoint: 'Preto', uWhitePoint: 'Branco', uWarmth: 'Calor', uMicroGrain: 'Micro-grão', uSpread: 'Alcance', uSoftness: 'Suavidade',
    uHue: 'Matiz', uGap: 'Moldura', uOffset: 'Desencontro', uBlock: 'Blocos', uSegments: 'Gomos', uRotate: 'Giro', uVertical: 'Vertical', uStud: 'Pinos', uThread: 'Linha',
    uSize: 'Tamanho', uRays: 'Raios', uCx: 'Centro X', uCy: 'Centro Y', uMix: 'Mistura', uTwist: 'Torção', uRings: 'Anéis', uKeep: 'Luz da foto', uLead: 'Chumbo', uCycles: 'Voltas', uGrid: 'Grade', uInk: 'Traço',
        uRR: 'R ← R', uRG: 'R ← G', uRB: 'R ← B', uGR: 'G ← R', uGG: 'G ← G', uGB: 'G ← B', uBR: 'B ← R', uBG: 'B ← G', uBB: 'B ← B',
};
const FX_COLOR_LABELS = { uInkA: 'Tinta A', uInkB: 'Tinta B', uTint: 'Tela', uLinen: 'Tecido', uGrout: 'Rejunte', uColor: 'Cor', uColorA: 'Cor A', uColorB: 'Cor B', uFg: 'Traço', uBg: 'Fundo', uShadowTone: 'Sombras', uHighTone: 'Luzes', uInk: 'Tinta', uPaper: 'Papel', uLeak: 'Vazamento' };

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
// ============================================================
// PALETAS VIVAS (sorteio por seção)
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

// ============================================================
// DADO — sorteio por RECEITAS
// Antes: toda jogada aplicava uma paleta + pequenas variações em tudo (por isso parecia
// "só trocar as cores"). Agora cada jogada escolhe uma receita (Pixel art, Analógico,
// Impressão, Pintura por números…) que liga 1–3 ferramentas com estilos fortes e
// devolve as outras ferramentas livres ao natural. Ferramentas travadas ficam como estão;
// ajustes travados (segurar o ajuste) também. Cada ferramenta tem o próprio dado.
// ============================================================
const RANDOM_GROUPS = { luz: 'Luz', cor: 'Cor', pixel: 'Pixel', textura: 'Textura', filme: 'Filme', pintura: 'Pintura', dupla: 'Dupla', movimento: 'Movimento' };
// partes do estado que cada ferramenta controla (o dado limpa só o que está livre)
const GROUP_PATHS = {
    luz: ['adj'], cor: ['color', 'grad'], pixel: ['pixel.size', 'pixel.group', 'pixel.groupRadius', 'pixel.groupTol', 'dither', 'edge'],
    textura: ['fx'], filme: ['film', 'grain'], pintura: ['paint'], dupla: ['dbl'], movimento: [],
};
const RETRO_PALETTES = [
    ['#0F380F', '#306230', '#8BAC0F', '#9BBC0F'],
    ['#000000', '#55FFFF', '#FF55FF', '#FFFFFF'],
    ['#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8', '#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA'],
    ['#2B1B0E', '#6B4226', '#A67B5B', '#D9BF9A', '#F5EBDC'],
    ['#2D1B69', '#FF6AD5', '#C774E8', '#AD8CFF', '#94D0FF'],
    ['#211E20', '#555568', '#A0A08B', '#E9EFEC'],
    ['#1A1C2C', '#5D275D', '#B13E53', '#EF7D57', '#FFCD75', '#A7F070', '#38B764', '#257179', '#29366F', '#3B5DC9', '#41A6F6', '#73EFF7', '#F4F4F4', '#94B0C2', '#566C86', '#333C57'],
    ['#332C50', '#46878F', '#94E344', '#E2F3E4'],
];
const DUO_SETS = [
    ['#0A1A2F', '#5A82A5', '#F2EFE9'], ['#2A0845', '#FF6FB5', '#FFE3F1'], ['#1B1B3A', '#FF7B00', '#FFE8C2'], ['#0B2E2B', '#2EC4B6', '#E8FFF9'],
    ['#140000', '#B3001B', '#FFD6D6'], ['#1C1405', '#C99A2E', '#FFF4D6'], ['#101820', '#F2AA4C', '#FDF6E3'], ['#1E0B36', '#00C2A8', '#F9F871'],
];
const FX_FAMILIES = {
    print: ['riso', 'cmyk_halftone', 'stipple', 'emboss'],
    screen: ['ascii', 'lcd', 'led', 'bitmap', 'blueprint', 'vhs'],
    color: ['thermal', 'channel_mixer', 'color_threshold', 'neon_trace', 'starlight', 'fluted_glass'],
    matter: ['lego', 'stained_glass', 'smudge', 'warp', 'gooey_merge', 'pattern_refraction', 'pixel_sort'],
    art: ['oil'],
    bw: ['stipple', 'bitmap', 'emboss'],
};
const FILM_STYLE_LOOKS = { natural: ['gold200'], cinema: ['cinestill', 'techni3'], loucas: ['techni3', 'vencido', 'lumiere'], vintage: ['vencido', 'gold200', 'lumiere'], pb: ['trix', 'lumiere'] };

const rr = (a, b) => a + Math.random() * (b - a);              // real entre a e b
const ri = (a, b) => Math.round(rr(a, b));                      // inteiro entre a e b
const chanceP = (p) => Math.random() < p;
// escolhe evitando repetir a escolha anterior da mesma chave (variedade de verdade)
const lastPick = {};
function pickFresh(list, key) {
    if (list.length < 2) return list[0];
    const prev = lastPick[key] || [];
    const pool = list.filter(x => !prev.includes(x));
    const v = pick(pool.length ? pool : list);
    lastPick[key] = [v, ...prev].slice(0, Math.min(3, Math.floor(list.length / 2)));
    return v;
}

// kit de uma jogada: set() respeita os ajustes travados
function diceKit(st, A, locks) {
    const L = (p) => locks.has(p);
    const set = (path, v) => { if (L(path)) return; const ks = path.split('.'); let o = st; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = v; };
    return { st, A: A || {}, L, set, touched: [] };
}
// volta a ferramenta ao natural (menos o que estiver travado)
function resetGroup(k, g) {
    (GROUP_PATHS[g] || []).forEach(path => {
        const ks = path.split('.'), def = ks.reduce((o, x) => o[x], DEFAULT_STATE);
        if (ks.length === 1 && def && typeof def === 'object' && !Array.isArray(def)) Object.keys(def).forEach(f => k.set(path + '.' + f, deepClone(def[f])));
        else k.set(path, deepClone(def));
    });
    if (g === 'cor' && (k.L('color.palette') || k.L('color.sel'))) Object.keys(DEFAULT_STATE.grad).forEach(f => k.set('grad.' + f, deepClone(DEFAULT_STATE.grad[f])));
}
// tamanho do pixel pensado em "quantas células no lado maior" (fotos de 12 MP e de 1 MP ficam parecidas)
function pxForCells(k, cells) { const long = Math.max(k.A.W || 1600, k.A.H || 1200); return Math.max(1, Math.min(64, Math.round(long / cells))); }
// paleta espalhada pela luz da foto (do escuro ao claro): todas as cores aparecem
function applyPalette(k, hexes) {
    const c = k.st.color, n = hexes.length;
    const pal = hexes.map(hexToRgb).sort((a, b) => luma(a) - luma(b)).map(rgbHex);
    const ramp = pal.map((_, i) => { const v = Math.round(18 + 219 * (n > 1 ? i / (n - 1) : 0.5)); return rgbToHex(v, v, v); });
    Object.assign(c, { mode: 'random', invert: false, sel: String(n), base: pal.slice(), ref: ramp, hue: 0, sat: 0, light: 0 });
}
function harmonicDuo(n) {
    const h = Math.random(), off = pick([0.08, 0.15, 0.5, 0.42]);
    const cols = [hslToRgb(h, rr(0.5, 0.8), rr(0.06, 0.16)), hslToRgb((h + off) % 1, rr(0.65, 1), rr(0.45, 0.6)), hslToRgb((h + off * 2) % 1, rr(0.4, 0.8), rr(0.85, 0.95))];
    return (n === 2 ? [cols[0], cols[2]] : cols).map(rgbHex);
}
function texturePick(k, fam) {
    const ids = (FX_FAMILIES[fam] || []).filter(id => PixelarFX.isTexture(id));
    const all = PixelarFX.listEffects().map(f => f.id);
    return pickFresh(ids.length ? ids : all, 'fx:' + fam);
}
function filmPick(fam) {
    const ids = (FILM_STYLE_LOOKS[fam] || Object.keys(FILM_LOOKS)).filter(id => FILM_LOOKS[id]);
    return pickFresh(ids.length ? ids : Object.keys(FILM_LOOKS), 'film:' + fam);
}

// ---------- o dado de cada ferramenta: estilo forte e coerente ----------
const LUZ_STYLES = { natural: 'Luz natural', dramatico: 'Dramático', lavado: 'Lavado', quente: 'Quente', frio: 'Frio', vivo: 'Cores vivas', pb: 'P&B', noturno: 'Noturno' };
const COR_STYLES = { paleta: 'Paleta', retro: 'Paleta retrô', foto: 'Cores da foto', duo: 'Duotone', degrade: 'Degradê', original: 'Cor original' };
const PIXEL_STYLES = { leve: 'Pixel fino', grande: 'Pixel grande', mosaico: 'Mosaico', dither: 'Pontilhado', agrupar: 'Manchas' };
const FILME_STYLES = { natural: 'Filme', cinema: 'Cinema', loucas: 'Cores loucas', vintage: 'Vintage', pb: 'Filme P&B', lente: 'Lente', grao: 'Grão' };
const TEX_STYLES = { print: 'Impressão', screen: 'Tela', color: 'Cor e luz', matter: 'Matéria', bw: 'Gravura', art: 'Pintura' };

const TOOL_DICE = {
    luz(k, style) {
        style = style || pickFresh(Object.keys(LUZ_STYLES), 'luz');
        const A = k.A, e0 = A.isDark ? 16 : A.isBright ? -14 : 0, c0 = A.isLowContrast ? 12 : A.isHighContrast ? -10 : 0, s = (p, v) => k.set('adj.' + p, Math.round(v));
        const n = (x) => rr(-x, x);
        ({
            natural: () => { s('exposure', e0 + n(10)); s('contrast', c0 + n(15)); s('saturation', n(15)); s('temperature', n(15)); s('shadows', n(15)); },
            dramatico: () => { s('exposure', e0 - 6 + n(8)); s('contrast', rr(35, 65)); s('shadows', rr(-45, -15)); s('saturation', rr(-25, 15)); s('temperature', n(20)); },
            lavado: () => { s('brightness', rr(12, 32)); s('contrast', rr(-45, -20)); s('saturation', rr(-45, -10)); s('shadows', rr(20, 45)); s('temperature', n(25)); },
            quente: () => { s('exposure', e0); s('temperature', rr(35, 70)); s('saturation', rr(5, 30)); s('contrast', rr(5, 25)); },
            frio: () => { s('exposure', e0); s('temperature', rr(-70, -35)); s('saturation', rr(-15, 10)); s('contrast', rr(5, 25)); s('shadows', n(12)); },
            vivo: () => { s('exposure', e0); s('saturation', rr(40, 80)); s('contrast', rr(15, 40)); },
            pb: () => { s('exposure', e0); s('saturation', -100); s('contrast', rr(20, 55)); s('shadows', n(25)); },
            noturno: () => { s('exposure', rr(-45, -25)); s('contrast', rr(25, 50)); s('shadows', rr(-35, -10)); s('temperature', rr(-65, -35)); s('saturation', rr(-40, -15)); },
        })[style]();
        k.touched.push(LUZ_STYLES[style]); return style;
    },
    cor(k, style) {
        const locked = k.L('color.palette') || k.L('color.sel');
        style = style || pickFresh(['paleta', 'retro', 'foto', 'duo', 'degrade'], 'cor');
        if (locked && style !== 'degrade') style = 'degrade';
        const c = k.st.color;
        if (style === 'paleta') applyPalette(k, randomPalette(pick([3, 4, 5, 6, 8, 10])).map(x => typeof x === 'string' ? x : rgbHex(x)));
        else if (style === 'retro') applyPalette(k, pickFresh(RETRO_PALETTES, 'retro'));
        else if (style === 'foto') Object.assign(c, { mode: 'original', sel: String(pick([3, 4, 5, 6, 8, 12, 16])), base: [], ref: [], hue: 0, sat: 0, light: 0, invert: false });
        else if (style === 'duo') { const tri = chanceP(0.5); c.sel = tri ? 'tritone' : 'duotone'; const set = chanceP(0.5) ? pick(DUO_SETS) : harmonicDuo(3); c.duo = tri ? set.slice() : [set[0], set[2], set[1]]; }
        else if (style === 'degrade') { randGradAll(k.st.grad); k.st.grad.blend = pick(['overlay', 'softlight', 'color', 'multiply', 'screen', 'source-atop']); k.st.grad.opacity = ri(35, 80); }
        if (style !== 'degrade' && style !== 'original' && chanceP(0.18)) { randGradAll(k.st.grad); k.st.grad.blend = pick(['overlay', 'softlight']); k.st.grad.opacity = ri(25, 55); }
        k.touched.push(COR_STYLES[style]); return style;
    },
    pixel(k, style) {
        style = style || pickFresh(Object.keys(PIXEL_STYLES), 'pixel');
        const s = k.set;
        if (style === 'leve') s('pixel.size', pxForCells(k, ri(180, 320)));
        else if (style === 'grande') { s('pixel.size', pxForCells(k, ri(48, 110))); if (chanceP(0.35)) { s('edge.size', 1); s('edge.color', '#141414'); s('edge.opacity', ri(40, 90)); } }
        else if (style === 'mosaico') { s('pixel.size', pxForCells(k, ri(28, 60))); s('pixel.group', pick([25, 50])); s('edge.size', ri(1, 2)); s('edge.color', pick(['#141414', '#FFFFFF', '#2B2B2B'])); s('edge.opacity', ri(60, 100)); }
        else if (style === 'dither') { s('pixel.size', pxForCells(k, ri(160, 360))); s('dither.mode', pickFresh(DITHER_MODES.filter(m => m !== 'none'), 'dither')); s('dither.scale', ri(1, 2)); s('dither.intensity', ri(80, 150)); s('dither.midOnly', chanceP(0.2)); }
        else if (style === 'agrupar') { s('pixel.size', pxForCells(k, ri(220, 420))); s('pixel.group', pick([50, 75, 100])); s('pixel.groupRadius', pick([1, 2])); s('pixel.groupTol', ri(30, 70)); }
        k.touched.push(style === 'dither' ? DITHER_NAMES[k.st.dither.mode] : PIXEL_STYLES[style]); return style;
    },
    textura(k, style) {
        if (k.L('fx.id')) return null;
        style = style || pickFresh(Object.keys(TEX_STYLES), 'tex');
        const id = texturePick(k, style), def = PixelarFX.getEffectDef(id);
        k.st.fx.id = id; k.st.fxParams[id] = randFxParams(id); k.set('fx.mix', ri(70, 100));
        k.touched.push(def ? def.nome : TEX_STYLES[style]); return style;
    },
    filme(k, style) {
        style = style || pickFresh(Object.keys(FILME_STYLES), 'filme');
        const s = k.set, f = k.st.film;
        if (['natural', 'cinema', 'loucas', 'vintage', 'pb'].includes(style) && !k.L('film.look')) {
            const id = filmPick(style); f.look = id; s('film.mix', ri(75, 100));
            if (id === 'vencido') f.vencido = ri(0, 3);
            if (id === 'lumiere') f.lumiereHue = ri(0, 359);
            k.touched.push(FILM_LOOKS[id].nome);
        } else k.touched.push(FILME_STYLES[style]);
        // lente: 1–3 efeitos fortes, sempre com cara de escolha
        const lens = { natural: 0.5, cinema: 0.6, loucas: 0.9, vintage: 0.9, pb: 0.5, lente: 1, grao: 0.2 }[style];
        if (chanceP(lens)) {
            const opts = ['vignette', 'halation', 'bloom', 'leak', 'chroma', 'soft', 'distort'], n = style === 'lente' ? ri(2, 3) : ri(1, 2);
            const range = { vignette: [25, 70], halation: [25, 70], bloom: [20, 55], leak: [25, 70], chroma: [20, 60], soft: [15, 45], distort: [-40, 40] };
            for (let i = 0; i < n; i++) { const kx = pick(opts); s('film.' + kx, ri(...range[kx])); }
            if (f.leak) s('film.leakColor', pick(['#ff7319', '#ff3d6e', '#ffb000', '#ff5ac8']));
        }
        // grão
        const g = { natural: 0.6, cinema: 0.7, loucas: 0.5, vintage: 0.8, pb: 0.9, lente: 0.3, grao: 1 }[style];
        if (chanceP(g)) { s('grain.amount', style === 'grao' ? ri(35, 70) : ri(12, 35)); s('grain.size', ri(80, 200)); s('grain.rough', ri(25, 70)); s('grain.mono', chanceP(0.7)); if (chanceP(0.25)) s('grain.speckle', ri(10, 40)); }
        return style;
    },
    pintura(k, style) {
        style = style || pickFresh(['regioes', 'regioes', 'pixels'], 'pintura');
        const s = k.set, pixels = style === 'pixels';
        s('paint.mode', pixels ? 'pixels' : 'regions'); s('paint.colors', pick([6, 10, 14, 18, 24, 32]));
        s('paint.detail', ri(25, 85)); s('paint.size', pick([24, 48, 80, 140, 220, 320])); s('paint.minArea', ri(6, 30)); s('paint.smooth', ri(1, 3));
        s('paint.lines', 0);   // cores lado a lado, sem linhas entre os blocos
        k.touched.push(pixels ? 'Pintura em pixels' : 'Pintura em regiões'); return style;
    },
    dupla(k) {
        const d = k.st.dbl, s = k.set;
        const srcs = ['self', 'clouds', 'light', 'leaves'].concat(typeof DblImage !== 'undefined' && DblImage.img ? ['image', 'image'] : []);
        s('dbl.on', true); s('dbl.src', pickFresh(srcs, 'dbl')); s('dbl.blend', pick(['screen', 'overlay', 'softlight', 'multiply', 'lighten', 'add']));
        s('dbl.op', ri(50, 90)); s('dbl.scale', ri(80, 180)); s('dbl.x', ri(-30, 30)); s('dbl.y', ri(-30, 30)); s('dbl.rot', chanceP(0.5) ? 0 : ri(-30, 30)); s('dbl.flip', chanceP(0.4));
        s('dbl.mask', pick(['none', 'base-light', 'base-dark', 'center', 'bottom', 'side'])); s('dbl.maskLo', ri(35, 65)); s('dbl.maskSoft', ri(15, 50));
        s('dbl.tone', pick(['color', 'color', 'mono', 'tint'])); s('dbl.tint', rgbHex(hslToRgb(Math.random(), 0.8, 0.6))); s('dbl.seed', ri(1, 999)); s('dbl.pre', chanceP(0.5));
        k.touched.push('Dupla exposição'); return d.src;
    },
    movimento(k) { randAnim(k.st.anim); k.touched.push('Movimento'); return 'mov'; },
};

// receitas: [ferramenta, estilo (ou lista), probabilidade]
const RECIPES = [
    { id: 'pixelart', nome: 'Pixel art', steps: [['pixel', ['grande', 'grande', 'mosaico']], ['cor', ['paleta', 'retro', 'foto']], ['luz', ['vivo', 'natural', 'dramatico'], 0.7]] },
    { id: '8bit', nome: '8-bit', steps: [['pixel', 'dither'], ['cor', ['retro', 'paleta']], ['luz', ['natural', 'dramatico'], 0.6]] },
    { id: 'analogico', nome: 'Analógico', steps: [['filme', ['natural', 'cinema', 'vintage']], ['luz', ['natural', 'quente', 'lavado', 'frio'], 0.7]] },
    { id: 'lomo', nome: 'Lomografia', steps: [['filme', 'loucas'], ['luz', ['vivo', 'dramatico'], 0.8]] },
    { id: 'pb', nome: 'Preto e branco', steps: [['filme', ['pb', 'grao']], ['luz', 'pb'], ['textura', 'bw', 0.3]] },
    { id: 'impressao', nome: 'Impressão', steps: [['textura', 'print'], ['luz', ['natural', 'dramatico', 'lavado'], 0.7], ['cor', ['paleta', 'duo'], 0.25]] },
    { id: 'tela', nome: 'Tela e glitch', steps: [['textura', 'screen'], ['luz', ['vivo', 'dramatico', 'frio'], 0.8], ['filme', 'lente', 0.3]] },
    { id: 'pop', nome: 'Pop art', steps: [['cor', ['duo', 'paleta']], ['luz', 'vivo'], ['textura', 'color', 0.45], ['pixel', 'agrupar', 0.3]] },
    { id: 'pintura', nome: 'Pintura por números', steps: [['pintura'], ['luz', ['vivo', 'natural', 'quente'], 0.7], ['cor', ['foto', 'paleta'], 0.25]] },
    { id: 'poster', nome: 'Pôster', steps: [['cor', ['foto', 'paleta', 'duo']], ['pixel', 'agrupar'], ['luz', ['dramatico', 'vivo']], ['filme', 'grao', 0.35]] },
    { id: 'sonho', nome: 'Sonho', steps: [['dupla'], ['filme', ['lente', 'vintage']], ['luz', ['lavado', 'quente']], ['cor', 'degrade', 0.4]] },
    { id: 'materia', nome: 'Arte e matéria', steps: [['textura', 'matter'], ['luz', ['natural', 'vivo'], 0.6]] },
    { id: 'tela_pintada', nome: 'Pintura', steps: [['textura', 'art'], ['luz', ['natural', 'vivo', 'quente'], 0.7], ['cor', ['foto', 'paleta'], 0.3]] },
    { id: 'duotone', nome: 'Duotone', steps: [['cor', 'duo'], ['filme', 'grao', 0.5], ['pixel', 'dither', 0.3], ['luz', ['dramatico', 'natural'], 0.6]] },
    { id: 'noturno', nome: 'Cinema noturno', steps: [['luz', 'noturno'], ['filme', 'cinema'], ['cor', 'degrade', 0.25]] },
    { id: 'livre', nome: 'Mistura livre', steps: null },
];
const recentRecipes = [];

// Sorteia tudo que está livre. groups: ferramentas livres; locks: ajustes travados ('adj.exposure'…).
// A = análise da foto (analyzeMedia): a luz puxa para o lado que a foto precisa e o pixel usa o tamanho real.
function randomize(st, A, groups, locks) {
    const k = diceKit(st, A, locks), free = (g) => groups.has(g);
    const usable = (r) => !r.steps || r.steps.some(([g, , p]) => free(g) && (p === undefined || p >= 1));
    let pool = RECIPES.filter(r => usable(r) && !recentRecipes.includes(r.id));
    if (!pool.length) pool = RECIPES.filter(usable);
    if (!pool.length) return [];
    const r = pick(pool);
    recentRecipes.unshift(r.id); recentRecipes.length = Math.min(recentRecipes.length, 4);
    // as ferramentas livres que a receita não usa voltam ao natural (nada de sobras da jogada anterior)
    Object.keys(RANDOM_GROUPS).forEach(g => { if (free(g) && g !== 'movimento') resetGroup(k, g); });
    let steps = r.steps;
    if (!steps) {   // mistura livre: 2–3 ferramentas, cada uma com um estilo qualquer
        const tools = ['luz', 'cor', 'pixel', 'textura', 'filme', 'pintura'].filter(free).sort(() => Math.random() - 0.5);
        steps = tools.slice(0, ri(2, 3)).map(g => [g]);
        if (!steps.some(x => x[0] === 'luz') && free('luz')) steps.push(['luz']);
    }
    k.touched.push(r.nome);
    steps.forEach(([g, style, p]) => {
        if (!free(g) || (p !== undefined && !chanceP(p))) return;
        TOOL_DICE[g](k, Array.isArray(style) ? pick(style) : style);
    });
    if (free('movimento')) randAnim(st.anim);
    return k.touched;
}
// dado de uma ferramenta só: limpa e sorteia um estilo dela, sem mexer no resto
function randomizeTool(st, A, g, locks) {
    const k = diceKit(st, A, locks);
    if (!TOOL_DICE[g]) return [];
    if (g !== 'movimento') resetGroup(k, g);
    TOOL_DICE[g](k);
    return k.touched;
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

const DITHER_NAMES = { none: 'Sólido', bayer8: 'Bayer', halftone: 'Retícula', checkerboard: 'Xadrez', scanlines: 'TV analógica', noise: 'Ruído' };
