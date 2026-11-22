/* ==========================================================================
   PIXELAR STUDIO — Smart Procedural Randomization Engine
   - Real parametric randomization across Light, Tone Curve, Color, HSL,
     3-Way Color Grading, Presence, Film Chemistry, Optics, and Creative Lab
   - Context-aware photo histogram, luminance, saturation, warmth & edge analysis
   - Predefined Safe Ranges dynamically adapted to avoid blown highlights or crushed blacks
   - Explicit Incompatibility & Compensation Matrix (11 photographic balance rules)
   - 100% editable output: sets presetId='none' so every slider, curve, wheel & chip
     reflects the exact procedurally generated values for fine-tuning.
   ========================================================================== */
'use strict';

(() => {
  // =========================================================================
  // 1. MATH & COLOR HARMONY UTILITIES
  // =========================================================================
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const roundStep = (v, step = 1) => Number((Math.round(v / step) * step).toFixed(4));
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  // Bell-curve (triangular-averaged) random in [lo, hi] biased softly toward center
  // so generated looks feel curated and organic rather than extreme uniform noise.
  function bellRand(lo, hi, centerBias = 0.5) {
    if (hi <= lo) return lo;
    const u = (Math.random() + Math.random() + Math.random()) / 3; // ~Gaussian [0..1]
    const mid = lo + (hi - lo) * clamp(centerBias, 0.15, 0.85);
    if (u < 0.5) return lo + (mid - lo) * (u * 2);
    return mid + (hi - mid) * ((u - 0.5) * 2);
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function pickWeighted(items) {
    const total = items.reduce((s, it) => s + it.w, 0);
    let r = Math.random() * total;
    for (const it of items) {
      r -= it.w;
      if (r <= 0) return it.v;
    }
    return items[items.length - 1].v;
  }

  function hslToHex(h, s, l) {
    const hh = ((h % 360) + 360) % 360;
    const ss = clamp(s, 0, 100) / 100;
    const ll = clamp(l, 0, 100) / 100;
    const c = (1 - Math.abs(2 * ll - 1)) * ss;
    const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
    const m = ll - c / 2;
    let r = 0, g = 0, b = 0;
    if (hh < 60) { r = c; g = x; }
    else if (hh < 120) { r = x; g = c; }
    else if (hh < 180) { g = c; b = x; }
    else if (hh < 240) { g = x; b = c; }
    else if (hh < 300) { r = x; b = c; }
    else { r = c; b = x; }
    const toHex = (v) => Math.round(clamp((v + m) * 255, 0, 255)).toString(16).padStart(2, '0');
    return '#' + toHex(r) + toHex(g) + toHex(b);
  }

  function rgbToHsl(r, g, b) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const mx = Math.max(rn, gn, bn), mn = Math.min(rn, gn, bn);
    const l = (mx + mn) * 0.5;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn;
    const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    let h = 0;
    if (mx === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
    else if (mx === gn) h = ((bn - rn) / d + 2) * 60;
    else h = ((rn - gn) / d + 4) * 60;
    return [h, s, l];
  }

  // =========================================================================
  // 2. PHOTO CONTEXT & HISTOGRAM ANALYZER
  // =========================================================================
  function analyzeContext(src) {
    const fallback = {
      meanLuma: 0.48, p02: 0.06, p10: 0.16, p50: 0.48, p90: 0.82, p98: 0.93,
      dynamicRange: 0.87, darkClipRatio: 0.02, brightClipRatio: 0.02,
      meanSat: 0.30, warmthBias: 0.0, dominantHue: 35, edgeEnergy: 0.25,
      sceneTag: 'Equilibrada',
    };
    if (!src) return fallback;

    try {
      const W = 96, H = 64;
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const ctx2d = cv.getContext('2d', { willReadFrequently: true });
      ctx2d.drawImage(src, 0, 0, W, H);
      const data = ctx2d.getImageData(0, 0, W, H).data;

      const histL = new Uint32Array(256);
      const hueBins = new Float32Array(36); // 10-degree hue histogram
      const lumaGrid = new Float32Array(W * H);

      let sumL = 0, sumSat = 0, sumWarm = 0;
      let darkClip = 0, brightClip = 0;
      const totalPx = W * H;

      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const li = clamp(Math.round(luma), 0, 255);
        histL[li]++;
        lumaGrid[p] = luma / 255;
        sumL += luma / 255;
        if (li <= 14) darkClip++;
        if (li >= 242) brightClip++;
        sumWarm += (r - b) / 255;

        const [h, s, l] = rgbToHsl(r, g, b);
        sumSat += s;
        if (s > 0.14 && l > 0.08 && l < 0.92) {
          const bin = Math.floor(((h % 360) + 360) % 360 / 10) % 36;
          hueBins[bin] += s;
        }
      }

      // Compute luminance percentiles
      const pct = (q) => {
        const target = totalPx * q;
        let acc = 0;
        for (let i = 0; i < 256; i++) {
          acc += histL[i];
          if (acc >= target) return i / 255;
        }
        return 1;
      };
      const p02 = pct(0.02), p10 = pct(0.10), p50 = pct(0.50), p90 = pct(0.90), p98 = pct(0.98);
      const meanLuma = sumL / totalPx;
      const meanSat = sumSat / totalPx;
      const warmthBias = sumWarm / totalPx;
      const darkClipRatio = darkClip / totalPx;
      const brightClipRatio = brightClip / totalPx;
      const dynamicRange = Math.max(0.05, p98 - p02);

      // Dominant hue
      let bestBin = 3, bestVal = -1;
      for (let b = 0; b < 36; b++) {
        if (hueBins[b] > bestVal) { bestVal = hueBins[b]; bestBin = b; }
      }
      const dominantHue = bestBin * 10 + 5;

      // Lightweight edge energy (horizontal + vertical gradient mean)
      let edgeSum = 0;
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const idx = y * W + x;
          edgeSum += Math.abs(lumaGrid[idx + 1] - lumaGrid[idx - 1]) + Math.abs(lumaGrid[idx + W] - lumaGrid[idx - W]);
        }
      }
      const edgeEnergy = clamp(edgeSum / ((W - 2) * (H - 2)) * 2.5, 0, 1);

      let sceneTag = 'Equilibrada';
      if (brightClipRatio > 0.07 || meanLuma > 0.64) sceneTag = 'Realces Altos';
      else if (darkClipRatio > 0.09 || meanLuma < 0.34) sceneTag = 'Baixa Luz';
      else if (dynamicRange < 0.55) sceneTag = 'Contraste Suave';
      else if (meanSat > 0.44) sceneTag = 'Cor Intensa';

      return {
        meanLuma, p02, p10, p50, p90, p98, dynamicRange,
        darkClipRatio, brightClipRatio, meanSat, warmthBias, dominantHue, edgeEnergy, sceneTag,
      };
    } catch {
      return fallback;
    }
  }

  // =========================================================================
  // 3. SAFE RANGES TABLE (DYNAMICALLY ADAPTED BY PHOTO HISTOGRAM CONTEXT)
  // =========================================================================
  const BASE_SAFE_RANGES = {
    exposure:   [-0.42,  0.42],  // ~ ±14% perceived exposure
    contrast:   [-24,    32],
    highlights: [-54,    22],
    shadows:    [-18,    44],
    whites:     [-24,    20],
    blacks:     [-20,    22],
    temp:       [-26,    30],
    tint:       [-15,    16],
    vibrance:   [-18,    30],
    saturation: [-22,    24],
    clarity:    [-22,    28],
    dehaze:     [-12,    22],
    sharpen:    [0,      30],
    fade:       [0,      28],
    rolloff:    [6,      62],
    grain:      [0,      38],
    grainSize:  [72,     142],
    halation:   [0,      44],
    bloom:      [0,      34],
    orton:      [0,      26],
    anamorphic: [0,      28],
    vignette:   [-32,    12],
    leak:       [0,      34],
    chroma:     [0,      22],
    flash:      [0,      22],
    gradeSat:   [6,      25],
    hslHue:     [-20,    20],
    hslSat:     [-26,    24],
    hslLum:     [-16,    16],
    curveLift:  [0.0,    0.075],
    curveCap:   [0.935,  1.0],
  };

  function adaptSafeRanges(ctx) {
    const r = {};
    for (const [k, v] of Object.entries(BASE_SAFE_RANGES)) r[k] = [v[0], v[1]];

    // Guard bright / high-key scenes against clipping whites
    if (ctx.brightClipRatio > 0.05 || ctx.meanLuma > 0.62 || ctx.p98 > 0.94) {
      r.exposure[1] = Math.min(r.exposure[1], ctx.brightClipRatio > 0.09 ? 0.02 : 0.14);
      r.highlights[1] = Math.min(r.highlights[1], -8);
      r.whites[1] = Math.min(r.whites[1], 0);
      r.flash[1] = Math.min(r.flash[1], 6);
    }

    // Guard dark / low-key scenes against crushing blacks
    if (ctx.darkClipRatio > 0.08 || ctx.meanLuma < 0.36 || ctx.p02 < 0.04) {
      r.exposure[0] = Math.max(r.exposure[0], ctx.darkClipRatio > 0.14 ? 0.0 : -0.08);
      r.shadows[0] = Math.max(r.shadows[0], 6);
      r.blacks[0] = Math.max(r.blacks[0], 0);
      r.vignette[0] = Math.max(r.vignette[0], -18);
    }

    // Adapt contrast to existing dynamic range
    if (ctx.dynamicRange > 0.86) {
      r.contrast[1] = Math.min(r.contrast[1], 16);
      r.dehaze[1] = Math.min(r.dehaze[1], 10);
    } else if (ctx.dynamicRange < 0.56) {
      r.contrast[0] = Math.max(r.contrast[0], -6);
      r.contrast[1] = Math.min(36, r.contrast[1] + 6);
    }

    // Adapt saturation & vibrance to existing scene chroma
    if (ctx.meanSat > 0.44) {
      r.saturation[1] = Math.min(r.saturation[1], 8);
      r.vibrance[1] = Math.min(r.vibrance[1], 14);
      r.gradeSat[1] = Math.min(r.gradeSat[1], 18);
    } else if (ctx.meanSat < 0.18) {
      r.vibrance[0] = Math.max(r.vibrance[0], -4);
      r.saturation[0] = Math.max(r.saturation[0], -8);
    }

    // Counter-bias temperature if scene is already strongly warm or cool
    if (ctx.warmthBias > 0.14) r.temp[1] = Math.min(r.temp[1], 14);
    if (ctx.warmthBias < -0.14) r.temp[0] = Math.max(r.temp[0], -14);

    // Avoid harsh clarity/sharpen on busy high-frequency textures
    if (ctx.edgeEnergy > 0.45) {
      r.clarity[1] = Math.min(r.clarity[1], 14);
      r.sharpen[1] = Math.min(r.sharpen[1], 16);
    }

    return r;
  }

  // =========================================================================
  // 4. PROCEDURAL GENERATORS (CURVES, HARMONIC GRADING, HSL, LAB PALETTES)
  // =========================================================================
  function generateProceduralCurve(ranges, wantMatte, contrastHint) {
    const blackLift = wantMatte
      ? roundStep(rand(0.025, ranges.curveLift[1]), 0.005)
      : roundStep(rand(0.0, 0.022), 0.005);
    const whiteCap = roundStep(rand(ranges.curveCap[0], ranges.curveCap[1]), 0.005);

    const sAmp = contrastHint > 10 ? rand(0.015, 0.045) : (contrastHint < -6 ? rand(-0.03, 0.01) : rand(-0.015, 0.032));
    const lowY = roundStep(clamp(0.25 + blackLift * 0.45 - sAmp, 0.18, 0.31), 0.005);
    const highY = roundStep(clamp(0.75 - (1 - whiteCap) * 0.45 + sAmp, 0.70, 0.83), 0.005);

    const rgb = [[0, blackLift], [0.25, lowY], [0.75, highY], [1, whiteCap]];

    // Subtle analog RGB channel cross-drift (±0.028 max so skin tones stay natural)
    const mkCh = (loShift, hiShift) => {
      const a = roundStep(clamp(loShift, 0, 0.035), 0.005);
      const mid = roundStep(clamp(0.5 + (loShift + hiShift) * 0.28, 0.47, 0.53), 0.005);
      const b = roundStep(clamp(1 + hiShift, 0.965, 1), 0.005);
      if (Math.abs(a) < 0.004 && Math.abs(mid - 0.5) < 0.004 && Math.abs(1 - b) < 0.004) return [[0, 0], [1, 1]];
      return [[0, a], [0.5, mid], [1, b]];
    };

    const drift = Math.random() < 0.65;
    const r = drift ? mkCh(rand(0, 0.024), rand(-0.022, 0)) : [[0, 0], [1, 1]];
    const g = drift ? mkCh(rand(0, 0.016), rand(-0.016, 0)) : [[0, 0], [1, 1]];
    const b = drift ? mkCh(rand(0, 0.030), rand(-0.028, 0)) : [[0, 0], [1, 1]];

    return { rgb, r, g, b };
  }

  function generateHarmonicGrading(ctx, ranges) {
    const scheme = pick(['complementary', 'split', 'analogous', 'cinema_teal_amber', 'subtle_none']);
    if (scheme === 'subtle_none') {
      return {
        shadows: { h: 0, s: 0, l: 0 },
        midtones: { h: 0, s: 0, l: 0 },
        highlights: { h: 0, s: 0, l: 0 },
        balance: 0,
        blending: 55,
      };
    }

    const baseH = scheme === 'cinema_teal_amber'
      ? rand(195, 225)
      : (Math.random() < 0.5 ? (ctx.dominantHue + 180) % 360 : rand(0, 360));

    let hiH = (baseH + 180) % 360;
    let midH = (baseH + 90) % 360;
    if (scheme === 'split') { hiH = (baseH + 150 + rand(0, 60)) % 360; midH = (hiH + 20) % 360; }
    else if (scheme === 'analogous') { hiH = (baseH + rand(25, 55)) % 360; midH = (baseH + 18) % 360; }
    else if (scheme === 'cinema_teal_amber') { hiH = rand(28, 52); midH = rand(22, 42); }

    const sMax = ranges.gradeSat[1];
    const sMin = Math.min(ranges.gradeSat[0], sMax);
    return {
      shadows:    { h: Math.round(baseH) % 360, s: Math.round(bellRand(sMin, sMax, 0.45)), l: 0 },
      midtones:   { h: Math.round(midH) % 360,  s: Math.random() < 0.45 ? Math.round(rand(3, Math.min(12, sMax * 0.6))) : 0, l: 0 },
      highlights: { h: Math.round(hiH) % 360,   s: Math.round(bellRand(sMin, sMax, 0.45)), l: 0 },
      balance: Math.round(bellRand(-28, 28, 0.5)),
      blending: Math.round(rand(42, 78)),
    };
  }

  function generateProceduralHSL(ranges) {
    const hsl = window.deepClone(window.DEFAULT_STATE.hsl);
    const keys = Object.keys(hsl);
    // Pick 2 to 4 selective bands so edits feel deliberate & clean
    const count = 2 + Math.floor(Math.random() * 3);
    const chosen = new Set();
    while (chosen.size < count) chosen.add(pick(keys));

    for (const k of chosen) {
      // Protect skin-tone bands (red/orange) from unnatural green/purple hue shifts
      const isSkin = k === 'orange' || k === 'red';
      const hLim = isSkin ? 10 : ranges.hslHue[1];
      hsl[k] = {
        h: Math.round(bellRand(-hLim, hLim, 0.5)),
        s: Math.round(bellRand(ranges.hslSat[0], ranges.hslSat[1], 0.5)),
        l: Math.round(bellRand(ranges.hslLum[0], ranges.hslLum[1], 0.5)),
      };
    }
    return hsl;
  }

  // Synthesize a completely new harmonious dark->light custom color palette
  function generateProceduralPalette(baseHue, count) {
    const scheme = pick(['mono_rich', 'duotone_ramp', 'split_warm_cool', 'analogous_editorial', 'triad_muted']);
    const cols = [];
    const h0 = ((baseHue % 360) + 360) % 360;
    const h1 = scheme === 'mono_rich' ? (h0 + rand(-12, 12))
      : scheme === 'analogous_editorial' ? (h0 + rand(35, 75))
      : scheme === 'triad_muted' ? (h0 + 120)
      : (h0 + 160 + rand(0, 40));
    const h2 = scheme === 'triad_muted' ? (h0 + 240) : (h1 + rand(15, 40));

    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      // Lightness strictly monotonic from rich dark ink (7..14%) to warm paper light (86..96%)
      const l = 8 + t * 84 + rand(-2, 2);
      // Hue smoothly sweeps along harmony curve
      const h = t < 0.55
        ? h0 + (h1 - h0) * (t / 0.55)
        : h1 + (h2 - h1) * ((t - 0.55) / 0.45);
      // Saturation peaks in midtones, restrained in extreme darks and paper highlights
      const midPeak = Math.sin(t * Math.PI);
      const s = clamp(18 + midPeak * rand(38, 66), 10, 82);
      cols.push(hslToHex(h, s, clamp(l, 5, 96)));
    }
    return cols;
  }

  // =========================================================================
  // 5. EXPLICIT INCOMPATIBILITY & COMPENSATION MATRIX
  // =========================================================================
  const BLUR_DISTORT_FX = new Set(['oil', 'liquid', 'kaleidoscope', 'fluted_glass', 'motion_smudge', 'stained_glass']);
  const STRUCTURAL_HIGH_CONTRAST_FX = new Set(['ink', 'thermal', 'solarize', 'neon_trace', 'cmyk', 'riso']);
  const EXPIRED_CHEMS = new Set(['vencido_viva', 'film_soup', 'xray_fog', 'redscale', 'autochrome']);

  function applyIncompatibilityMatrix(st, ctx) {
    const rules = [];
    const note = (tag) => { if (!rules.includes(tag)) rules.push(tag); };

    // RULE 1: High Contrast Compensation
    // Extreme contrast crushes shadows/highlights and fights dehaze, clarity & bleach bypass.
    if (st.light.contrast > 18) {
      st.presence.dehaze = Math.min(st.presence.dehaze, 8);
      st.presence.clarity = Math.min(st.presence.clarity, 14);
      st.light.shadows = Math.max(st.light.shadows, 6);
      st.light.blacks = Math.max(st.light.blacks, -6);
      st.light.highlights = Math.min(st.light.highlights, -6);
      if (st.film.chem === 'bleach') st.film.chem = 'none';
      // Soften S-curve steepness if also steep
      if (st.curve.rgb.length >= 4) {
        st.curve.rgb[1][1] = Math.max(st.curve.rgb[1][1], 0.21);
        st.curve.rgb[2][1] = Math.min(st.curve.rgb[2][1], 0.80);
      }
      note('Compensação de Alto Contraste');
    }

    // RULE 2: Fade / Matte Black Lift vs. Deep Blacks & Dehaze Exclusivity
    const curveBlackLift = st.curve.rgb[0] ? st.curve.rgb[0][1] : 0;
    if (st.presence.fade > 14 || curveBlackLift > 0.04) {
      st.light.blacks = Math.max(st.light.blacks, 0);
      st.presence.dehaze = Math.min(st.presence.dehaze, 6);
      st.light.contrast = Math.min(st.light.contrast, 18);
      if (st.presence.fade > 16 && curveBlackLift > 0.045) {
        st.curve.rgb[0][1] = 0.03; // Prevent double grey washout
      }
      note('Equilíbrio Matte / Pretos');
    }

    // RULE 3: Optical Softness (Bloom / Orton) vs. Crispness (Clarity / Sharpen) Exclusivity
    if (st.optics.bloom > 16 || st.optics.orton > 12) {
      st.presence.clarity = Math.min(st.presence.clarity, 6);
      st.presence.sharpen = Math.min(st.presence.sharpen, 10);
      st.presence.dehaze = Math.min(st.presence.dehaze, 6);
      note('Suavidade Óptica vs. Nitidez');
    }

    // RULE 4: Cumulative Optical Glow vs. Blown Highlights Protection
    const glowTotal = st.optics.bloom + st.optics.halation + st.optics.orton + st.optics.anamorphic;
    if (glowTotal > 48) {
      st.light.exposure = roundStep(Math.min(st.light.exposure, 0.05) - 0.08, 0.05);
      st.light.highlights = Math.min(st.light.highlights, -14);
      st.light.whites = Math.min(st.light.whites, -4);
      if (st.optics.bloom > 20 && st.optics.orton > 16) st.optics.orton = Math.round(st.optics.orton * 0.5);
      note('Proteção de Brilho Óptico');
    }

    // RULE 5: Global Saturation Budget Governor (Color + Vibrance + Grading + HSL)
    const gradeSatSum = (st.grade.shadows.s + st.grade.midtones.s + st.grade.highlights.s) * 0.45;
    const satBudget = st.color.saturation + st.color.vibrance * 0.65 + gradeSatSum;
    if (satBudget > 46) {
      const scale = 42 / Math.max(1, satBudget);
      if (st.color.saturation > 0) st.color.saturation = Math.round(st.color.saturation * scale);
      if (st.color.vibrance > 0) st.color.vibrance = Math.round(st.color.vibrance * scale);
      st.grade.shadows.s = Math.round(st.grade.shadows.s * Math.min(1, scale + 0.15));
      st.grade.highlights.s = Math.round(st.grade.highlights.s * Math.min(1, scale + 0.15));
      note('Limite de Saturação Global');
    }

    // RULE 6: Monochrome / B&W Coherence
    if (st.film.chem === 'bw' || st.film.chem === 'wood_ir' || st.color.saturation <= -85) {
      st.color.temp = 0;
      st.color.tint = 0;
      st.color.vibrance = 0;
      st.optics.chroma = 0;
      st.hsl = window.deepClone(window.DEFAULT_STATE.hsl);
      st.grade.shadows.s = 0;
      st.grade.midtones.s = 0;
      st.grade.highlights.s = 0;
      st.curve.r = [[0, 0], [1, 1]];
      st.curve.g = [[0, 0], [1, 1]];
      st.curve.b = [[0, 0], [1, 1]];
      note('Coerência Monocromática');
    }

    // RULE 7: Expired Film Chemistry Restraint
    if (EXPIRED_CHEMS.has(st.film.chem)) {
      st.optics.leak = Math.min(st.optics.leak, 16);
      st.optics.vignette = Math.max(st.optics.vignette, -22);
      st.presence.fade = Math.min(st.presence.fade, 14);
      st.color.temp = clamp(st.color.temp, -18, 18);
      if (st.lab.fxId !== 'none') st.lab.fxMix = Math.min(st.lab.fxMix, 48);
      note('Moderação Química Vencida');
    }

    // RULE 8: Dark Vignette + Underexposure Corner-Crush Prevention
    if (st.optics.vignette < -18 && st.light.exposure < -0.10) {
      st.light.exposure = roundStep(Math.max(st.light.exposure, -0.05), 0.05);
      st.light.shadows = Math.max(st.light.shadows, 10);
      note('Proteção de Bordas/Vinheta');
    }

    // RULE 9: Lab Pixel Art vs. Blur/Warp FX & Soft Optics Exclusivity
    if (st.lab.pixelSize >= 3) {
      if (BLUR_DISTORT_FX.has(st.lab.fxId)) {
        st.lab.fxId = 'none';
      }
      st.optics.bloom = Math.min(st.optics.bloom, 10);
      st.optics.orton = 0;
      st.optics.grain = Math.min(st.optics.grain, 12);
      st.presence.sharpen = Math.min(st.presence.sharpen, 10);
      note('Nitidez Pixel Art');
    }

    // RULE 10: Lab Dither / Structural FX / Palette Coherence
    if (st.lab.ditherMode !== 'none') {
      st.optics.grain = Math.min(st.optics.grain, 14);
      if (st.lab.fxId !== 'none') st.lab.fxMix = Math.min(st.lab.fxMix, 58);
      note('Equilíbrio Dither vs. Grão');
    }
    if (STRUCTURAL_HIGH_CONTRAST_FX.has(st.lab.fxId)) {
      st.light.contrast = clamp(st.light.contrast, -10, 14);
      st.presence.clarity = Math.min(st.presence.clarity, 10);
      st.optics.vignette = Math.max(st.optics.vignette, -18);
      st.lab.fxMix = clamp(st.lab.fxMix, 42, 82);
      if (st.lab.colorMode !== 'all') st.lab.palMix = Math.min(st.lab.palMix, 65);
      note('Balanço de Textura Estrutural');
    }
    if (st.lab.colorMode === 'duotone' || st.lab.colorMode === 'tritone') {
      st.lab.palHue = 0;
      st.lab.palInvert = false;
      if (['lomopurple', 'redscale', 'aerochrome'].includes(st.film.chem)) st.film.chem = 'none';
      note('Harmonia Duotone/Tritone');
    }

    // RULE 11: Final Photo-Histogram Safety Guardrail
    if (ctx.brightClipRatio > 0.06 || ctx.meanLuma > 0.66) {
      st.light.exposure = roundStep(Math.min(st.light.exposure, 0.10), 0.05);
      st.light.whites = Math.min(st.light.whites, 0);
      st.light.highlights = Math.min(st.light.highlights, -12);
      note('Guarda de Realces (Histograma)');
    }
    if (ctx.darkClipRatio > 0.08 || ctx.meanLuma < 0.32) {
      st.light.exposure = roundStep(Math.max(st.light.exposure, -0.05), 0.05);
      st.light.blacks = Math.max(st.light.blacks, 0);
      st.light.shadows = Math.max(st.light.shadows, 8);
      note('Guarda de Sombras (Histograma)');
    }

    return rules;
  }

  // =========================================================================
  // 6. MAIN PROCEDURAL GENERATOR (STUDIO MODE & CREATIVE LAB MODE)
  // =========================================================================
  function generateLabLayer(st, ctx, intensityLevel = 'full') {
    const lab = st.lab;
    const fxKeys = Object.keys(window.LAB_FX_META || {}).filter(k => k !== 'none');
    const safeBlends = ['normal', 'screen', 'overlay', 'softlight', 'multiply'];

    // Pick a cohesive procedural creative direction (never copies LAB_PRESETS!)
    const recipeType = intensityLevel === 'accent'
      ? pickWeighted([
          { v: 'fx_subtle', w: 45 },
          { v: 'tone_palette', w: 35 },
          { v: 'pixel_touch', w: 20 },
        ])
      : pickWeighted([
          { v: 'fx_procedural', w: 34 },
          { v: 'palette_harmony', w: 26 },
          { v: 'pixel_dither', w: 22 },
          { v: 'hybrid_editorial', w: 18 },
        ]);

    const anchorHue = Math.random() < 0.55
      ? (ctx.dominantHue + rand(-40, 40) + 360) % 360
      : rand(0, 360);

    if (recipeType === 'fx_subtle' || recipeType === 'fx_procedural' || recipeType === 'hybrid_editorial') {
      const fxId = pick(fxKeys);
      const meta = window.LAB_FX_META[fxId] || {};
      lab.fxId = fxId;
      // Optical/glow FX look cleanest in screen/softlight/normal; structural FX in normal/overlay/softlight
      const isGlowFx = ['starlight', 'prism', 'double_exp', 'neon_trace'].includes(fxId);
      lab.fxBlend = isGlowFx
        ? pick(['screen', 'softlight', 'normal'])
        : (intensityLevel === 'accent' ? pick(['softlight', 'overlay', 'normal']) : pick(safeBlends));
      lab.fxMix = intensityLevel === 'accent'
        ? Math.round(bellRand(26, 52, 0.5))
        : Math.round(bellRand(50, 84, 0.55));
      lab.fxScale = Math.round(bellRand(24, 78, (meta.defS ?? 50) / 100));
      lab.fxIntensity = Math.round(bellRand(32, 74, (meta.defI ?? 55) / 100));
      lab.fxParam = Math.round(rand(8, 92));
    }

    if (recipeType === 'palette_harmony' || recipeType === 'tone_palette' || recipeType === 'hybrid_editorial') {
      const modePick = pickWeighted([
        { v: 'custom_pal', w: 46 },
        { v: 'duotone', w: 24 },
        { v: 'tritone', w: 30 },
      ]);
      if (modePick === 'duotone' || modePick === 'tritone') {
        const ramp = generateProceduralPalette(anchorHue, 3);
        lab.colorMode = modePick;
        lab.duo0 = ramp[0];
        lab.duo1 = ramp[1];
        lab.duo2 = ramp[2];
        lab.palMix = intensityLevel === 'accent'
          ? Math.round(rand(32, 58))
          : Math.round(rand(68, 94));
      } else {
        const colCount = pick([4, 5, 6, 8, 12]);
        lab.colorMode = String(colCount);
        lab.paletteId = 'custom';
        lab.customPal = generateProceduralPalette(anchorHue, colCount);
        lab.palMap = pick(['smooth', 'tones', 'nearest']);
        lab.palMix = intensityLevel === 'accent'
          ? Math.round(rand(30, 56))
          : Math.round(rand(65, 95));
        lab.palSat = Math.round(bellRand(-14, 18, 0.5));
        lab.palLight = Math.round(bellRand(-10, 10, 0.5));
      }
    }

    if (recipeType === 'pixel_dither' || recipeType === 'pixel_touch') {
      lab.pixelSize = recipeType === 'pixel_touch' ? pick([2, 3]) : pick([2, 3, 4, 5, 6]);
      lab.ditherMode = pick(['bayer8', 'atkinson', 'halftone', 'scanlines', 'noise']);
      lab.ditherStrength = Math.round(bellRand(26, 62, 0.5));
      if (recipeType === 'pixel_dither' && Math.random() < 0.72) {
        const colCount = pick([4, 6, 8, 12, 16]);
        lab.colorMode = String(colCount);
        if (Math.random() < 0.55) {
          lab.paletteId = 'custom';
          lab.customPal = generateProceduralPalette(anchorHue, colCount);
          lab.palMap = pick(['tones', 'nearest']);
        } else {
          lab.paletteId = 'auto';
          lab.palMap = 'auto';
        }
        lab.palMix = Math.round(rand(78, 100));
      }
    }

    lab.presetId = 'none';
    return recipeType;
  }

  function generate(src, currentCrop, opts = {}) {
    const scope = opts.scope || 'studio'; // 'studio' | 'lab'
    const ctx = analyzeContext(src);
    const ranges = adaptSafeRanges(ctx);

    const st = window.freshState();
    // Always preserve user's existing Crop & Geometry untouched!
    if (currentCrop) st.crop = window.deepClone(currentCrop);
    st.preset = { id: 'none', variation: 0, mix: 100 };

    // Choose a cohesive photographic direction so simultaneous parameters harmonize
    const archetype = scope === 'lab'
      ? pickWeighted([
          { v: 'editorial_clean', w: 45 },
          { v: 'analog_warm', w: 30 },
          { v: 'moody_cool', w: 25 },
        ])
      : pickWeighted([
          { v: 'analog_warm', w: 26 },
          { v: 'cinema_split', w: 24 },
          { v: 'editorial_matte', w: 18 },
          { v: 'crisp_daylight', w: 14 },
          { v: 'expired_dream', w: 10 },
          { v: 'silver_bw', w: 8 },
        ]);

    // 1. LIGHT (parametric independent draws inside adapted safe ranges)
    st.light.exposure   = roundStep(bellRand(ranges.exposure[0], ranges.exposure[1], 0.5), 0.05);
    st.light.contrast   = Math.round(bellRand(ranges.contrast[0], ranges.contrast[1], archetype === 'editorial_matte' ? 0.35 : 0.55));
    st.light.highlights = Math.round(bellRand(ranges.highlights[0], ranges.highlights[1], 0.4));
    st.light.shadows    = Math.round(bellRand(ranges.shadows[0], ranges.shadows[1], 0.55));
    st.light.whites     = Math.round(bellRand(ranges.whites[0], ranges.whites[1], 0.5));
    st.light.blacks     = Math.round(bellRand(ranges.blacks[0], ranges.blacks[1], archetype === 'editorial_matte' ? 0.65 : 0.48));

    // 2. COLOR
    const tempBias = archetype === 'analog_warm' ? 0.68 : (archetype === 'moody_cool' || archetype === 'cinema_split' ? 0.36 : 0.5);
    st.color.temp       = Math.round(bellRand(ranges.temp[0], ranges.temp[1], tempBias));
    st.color.tint       = Math.round(bellRand(ranges.tint[0], ranges.tint[1], 0.5));
    st.color.vibrance   = Math.round(bellRand(ranges.vibrance[0], ranges.vibrance[1], 0.55));
    st.color.saturation = Math.round(bellRand(ranges.saturation[0], ranges.saturation[1], 0.48));

    // 3. TONE CURVE (procedural smooth spline + subtle channel drift)
    const wantMatte = archetype === 'editorial_matte' || (Math.random() < 0.32);
    st.curve = generateProceduralCurve(ranges, wantMatte, st.light.contrast);

    // 4. SELECTIVE HSL (2..4 bands)
    st.hsl = generateProceduralHSL(ranges);

    // 5. 3-WAY COLOR GRADING (harmonic split / complementary / analogous)
    st.grade = generateHarmonicGrading(ctx, ranges);

    // 6. PRESENCE
    st.presence.clarity = Math.round(bellRand(ranges.clarity[0], ranges.clarity[1], archetype === 'crisp_daylight' ? 0.65 : 0.48));
    st.presence.dehaze  = Math.round(bellRand(ranges.dehaze[0], ranges.dehaze[1], 0.45));
    st.presence.sharpen = Math.round(bellRand(ranges.sharpen[0], ranges.sharpen[1], 0.4));
    st.presence.fade    = wantMatte ? Math.round(bellRand(6, ranges.fade[1], 0.45)) : (Math.random() < 0.35 ? Math.round(rand(3, 14)) : 0);

    // 7. FILM CHEMISTRY
    st.film.rolloff = Math.round(bellRand(ranges.rolloff[0], ranges.rolloff[1], 0.5));
    if (archetype === 'silver_bw') {
      st.film.chem = Math.random() < 0.8 ? 'bw' : 'wood_ir';
      st.film.toneAmt = Math.random() < 0.55 ? Math.round(rand(8, 28)) : 0;
      st.film.toneColor = pick(['#8d9cb0', '#b59a7b', '#7b8a97', '#a89078']);
    } else if (archetype === 'expired_dream') {
      st.film.chem = pick(['vencido_viva', 'cross', 'autochrome']);
      if (st.film.chem === 'vencido_viva' || st.film.chem === 'autochrome') {
        st.film.vencidoAge = Math.round(rand(22, 48));
        st.film.vencidoFog = Math.round(rand(14, 34));
        st.film.vencidoMottle = Math.round(rand(12, 30));
        st.film.vencidoLeak = Math.round(rand(8, 26));
        st.film.vencidoLayer = pick([0, 1, 2, 3]);
        st.film.vencidoSeed = 1 + Math.floor(Math.random() * 99);
      }
    } else if (scope === 'studio' && Math.random() < 0.22) {
      st.film.chem = pick(['cross', 'bleach', 'technicolor']);
    }

    // 8. OPTICS
    st.optics.grain      = Math.round(bellRand(ranges.grain[0], ranges.grain[1], 0.45));
    st.optics.grainSize  = Math.round(bellRand(ranges.grainSize[0], ranges.grainSize[1], 0.5));
    st.optics.vignette   = Math.round(bellRand(ranges.vignette[0], ranges.vignette[1], 0.38));
    st.optics.halation   = Math.random() < 0.48 ? Math.round(bellRand(8, ranges.halation[1], 0.4)) : 0;
    st.optics.bloom      = Math.random() < 0.42 ? Math.round(bellRand(6, ranges.bloom[1], 0.4)) : 0;
    st.optics.orton      = Math.random() < 0.22 ? Math.round(bellRand(6, ranges.orton[1], 0.35)) : 0;
    st.optics.anamorphic = Math.random() < 0.18 ? Math.round(bellRand(8, ranges.anamorphic[1], 0.4)) : 0;
    st.optics.chroma     = Math.random() < 0.30 ? Math.round(rand(4, ranges.chroma[1])) : 0;
    st.optics.flash      = Math.random() < 0.14 ? Math.round(rand(5, ranges.flash[1])) : 0;
    if (Math.random() < 0.24) {
      st.optics.leak = Math.round(bellRand(10, ranges.leak[1], 0.4));
      st.optics.leakAngle = Math.round(rand(0, 360) / 5) * 5;
      st.optics.leakColor = pick(['#ff7a2e', '#ff5436', '#f5a623', '#e86a92', '#ff8c42']);
    }

    // 9. CREATIVE LAB (always full procedural in 'lab' scope; subtle accent ~28% in 'studio' scope)
    let labType = null;
    if (scope === 'lab') {
      labType = generateLabLayer(st, ctx, 'full');
    } else if (archetype !== 'silver_bw' && Math.random() < 0.28) {
      labType = generateLabLayer(st, ctx, 'accent');
    }

    // 10. RUN INCOMPATIBILITY & COMPENSATION MATRIX
    const rulesTriggered = applyIncompatibilityMatrix(st, ctx);

    // Count editable recipe items for clear UI feedback
    const recipeItems = window.summarizeRecipe ? window.summarizeRecipe(st) : [];
    const moodLabels = {
      analog_warm: 'Analógico Quente',
      cinema_split: 'Cinema Split-Tone',
      editorial_matte: 'Editorial Matte',
      crisp_daylight: 'Luz Natural',
      expired_dream: 'Filme Vencido',
      silver_bw: 'P&B Prata',
      editorial_clean: 'Lab Procedural',
      moody_cool: 'Lab Atmosférico',
    };
    const fxLabel = st.lab.fxId !== 'none' && window.LAB_FX_META && window.LAB_FX_META[st.lab.fxId]
      ? window.LAB_FX_META[st.lab.fxId].label
      : null;
    const summaryTitle = scope === 'lab'
      ? (fxLabel ? `Lab Procedural · ${fxLabel}` : (st.lab.pixelSize > 1 ? `Lab Procedural · Pixel ${st.lab.pixelSize}px` : 'Lab Procedural · Paleta Harmônica'))
      : `Remix · ${moodLabels[archetype] || 'Procedural'}`;

    return {
      state: st,
      context: ctx,
      archetype,
      labType,
      rulesTriggered,
      changedCount: recipeItems.length,
      summary: `${summaryTitle} (${recipeItems.length} ajustes · ${ctx.sceneTag})`,
    };
  }

  window.StudioProcedural = {
    SAFE_RANGES: BASE_SAFE_RANGES,
    analyzeContext,
    adaptSafeRanges,
    applyIncompatibilityMatrix,
    generate,
  };
})();
