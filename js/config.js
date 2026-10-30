/* Pixelar — configurações salvas em arquivo.
 * O PNG exportado (e o .txt de “Config.”) trazem o estado no fim: PIXELAR_META:{...}.
 * v2 = formato atual; sem v = formato da primeira versão do app (convertido aqui).
 */
'use strict';

// formato da primeira versão (chaves curtas) → estado atual
function fromLegacy(p) {
    const st = freshState();
    const num = (v, d) => (v === undefined || v === null || v === '' ? d : +v);
    st.pixel.size = num(p.px, 1); st.pixel.scale = num(p.iSca, 100);
    st.adj.exposure = num(p.exp, 0); st.adj.brightness = num(p.bri, 0); st.adj.shadows = num(p.som, 0); st.adj.saturation = num(p.sat, 0);
    st.adj.contrast = num(p.cont, 0); st.adj.temperature = num(p.temp, 0); st.adj.rgbShift = num(p.rSht, 0);   // normalizeState converte em aberração
    st.adj.shadowsInverted = !!p.shInv;
    st.dither.mode = p.dith || 'none'; st.dither.scale = num(p.dScale, 1); st.dither.intensity = num(p.dInt, 100); st.dither.opacity = num(p.tOpa, 100); st.dither.midOnly = !!p.effMidDither;
    if (p.edgC) st.edge.color = p.edgC; st.edge.size = num(p.edgSiz, 0); st.edge.opacity = num(p.eOpa, 100);
    const c = st.color;
    c.sel = p.col !== undefined ? String(p.col) : 'all';
    c.mode = p.palMode || 'original'; c.invert = !!p.inv;
    c.hue = num(p.pHue, 0); c.sat = num(p.pSat, 0); c.light = num(p.pLig, 0);
    const cc = (p.cc || []).map(x => rgbHex(hexToRgb(x))), rc = (p.rc && p.rc.length ? p.rc : p.cc || []).map(x => rgbHex(hexToRgb(x)));
    if ((c.sel === 'duotone' || c.sel === 'tritone') && cc.length >= 2) { c.duo = [cc[0], cc[1], cc[2] || '#F2EFE9']; }
    else if (cc.length) {
        // paleta salva: a quantidade vem da própria paleta (há presets com 3 ou 5 cores)
        c.base = cc; c.ref = rc.length === cc.length ? rc : cc.slice();
        if (c.sel !== 'all') c.sel = String(cc.length);
        if (c.mode === 'original') c.mode = 'preset';
    }
    // os deslocamentos de matiz/sat/luz já estão "assados" em cc no formato antigo
    c.hue = c.sat = c.light = 0;
    const g = st.grad;
    g.on = !!p.iGrad; if (p.iGradCol) g.colors = p.iGradCol.slice(); if (p.iGradTyp) g.type = p.iGradTyp;
    g.angle = num(p.iGradAng, 90); g.steps = num(p.iGradStp, 0); g.pos = num(p.iGradPos, 50); g.smooth = num(p.iGradSmt, 100); if (p.iGradBld) g.blend = p.iGradBld;
    if (p.grad) { const m = { imgGradType: 'type', imgGradAngle: 'angle', imgGradSteps: 'steps', imgGradPos: 'pos', imgGradSmooth: 'smooth', imgGradBlend: 'blend', imgGradCX: 'cx', imgGradCY: 'cy', imgGradScale: 'scale', imgGradRepeat: 'repeat', imgGradMirror: 'mirror', imgGradNoise: 'noise', imgGradOpacity: 'opacity' }; for (const k in m) if (p.grad[k] !== undefined) g[m[k]] = typeof g[m[k]] === 'number' ? +p.grad[k] : p.grad[k]; }
    st.grain.amount = num(p.grainAmt, 0); st.grain.size = num(p.grainSz, 100); st.grain.rough = num(p.grainRough, 45); st.grain.bias = num(p.grainSB, 20); st.grain.speckle = num(p.grainSpk, 0); st.grain.mono = p.grainMono !== undefined ? !!p.grainMono : true;
    // efeito de textura (filmes e lentes antigos viram filtros)
    const fx = p.fx || 'none', mix = p.fxMix !== undefined ? +p.fxMix : 100, pr = p.fxParams || {};
    const f = st.film;
    if (['kodak_verde', 'kodak_pb', 'lumiere', 'vencido'].includes(fx)) { f.look = fx; f.mix = mix; st.fxParams[fx] = Object.assign({}, pr); }
    else if (fx === 'vignette') { f.vignette = Math.round(Math.min(100, (pr.uIntensity !== undefined ? pr.uIntensity : 0.6) * mix)); if (pr.uColor_r !== undefined) f.vigColor = arrHex([pr.uColor_r, pr.uColor_g, pr.uColor_b]); }
    else if (fx === 'bloom') f.bloom = Math.round(Math.min(100, (pr.uIntensity || 1.2) * mix * 0.5));
    else if (fx === 'bokeh_blur') f.soft = Math.round(Math.min(100, (pr.uRadius || 6) * mix * 0.12));
    else if (fx === 'lens_distortion') { f.distort = Math.round(Math.max(-100, Math.min(100, (pr.uAmount || 0.35) * mix))); f.chroma = Math.round(Math.min(100, (pr.uChroma || 0.015) * mix * 25)); }
    else if (fx !== 'none' && fx !== 'solarize' && typeof PixelarFX !== 'undefined' && PixelarFX.getEffectDef(fx)) { st.fx.id = fx; st.fx.mix = mix; st.fxParams[fx] = Object.assign({}, pr); }
    if (p.film) {
        const F = p.film, m = { filmLook: 'look', filmMix: 'mix', filmGrainAmt: 'grainAmt', lensVigColor: 'vigColor', lensLeakColor: 'leakColor', lensVignette: 'vignette', lensHalation: 'halation', lensBloom: 'bloom', lensSoft: 'soft', lensDistort: 'distort', lensChroma: 'chroma', lensLeak: 'leak', lensDust: 'dust', lensFlash: 'flash' };
        for (const k in m) if (F[k] !== undefined) f[m[k]] = typeof f[m[k]] === 'number' ? +F[k] : F[k];
        if (F.filmTemp !== undefined) f.temp = +F.filmTemp;   // normalizeState leva para Luz
        const look = FILM_LOOKS[f.look]; if (look && look.fx && F.filmParams) st.fxParams[look.fx] = Object.assign({}, F.filmParams);
    }
    if (p.filmVencidoVariant !== undefined) f.vencido = +p.filmVencidoVariant;
    if (p.filmLumiereHue !== undefined && +p.filmLumiereHue) f.lumiereHue = +p.filmLumiereHue;
    if (p.anim) { const A = st.anim; for (const k in p.anim) { const nk = k.replace(/^anim/, ''); const key = nk.charAt(0).toLowerCase() + nk.slice(1); if (A[key] !== undefined) A[key] = typeof A[key] === 'number' ? +p.anim[k] : typeof A[key] === 'boolean' ? !!p.anim[k] : p.anim[k]; } }
    return normalizeState(st);
}

// lê as configurações embutidas num arquivo (PNG exportado ou .txt)
function parseMeta(text) {
    const m = text.match(/PIXELAR_META:(\{.*\})/s); if (!m) return null;
    try { const p = JSON.parse(m[1]); return p.v === 2 ? normalizeState(p) : fromLegacy(p); } catch (e) { return null; }
}
