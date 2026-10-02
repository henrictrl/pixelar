/* Pixelar — catálogo de efeitos (GLSL) + motor WebGL2. Extraído sem alterações de lógica da versão 2fa6a2b. */
'use strict';
        // ==== Catálogo de efeitos (PixelarFX) + motor PixelarGPU ====
// ==========================================
// PixelarFX — banco de efeitos de pós-processamento (GLSL ES 3.0)
// Cada efeito é um fragment shader independente que roda sobre o
// resultado da passada principal do PixelarGPU (MAIN).
// Todos recebem uSource (textura de entrada) + uResolution, e um
// conjunto de uniforms próprios (parâmetros do efeito, incluindo
// cor configurável onde fizer sentido — nunca cor fixa/hardcoded).
// ==========================================

const PIXELAR_FX_COMMON = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSource;
uniform vec2 uResolution;
uniform float uTime;      // reservado
uniform float uAnim;      // fase da animação em loop (0 = imagem estática; período 1)
uniform float uAnimFrame; // índice do quadro na animação (0 = estático) — re-semeia ruídos

vec3 rgb2hsl(vec3 c) {
    float maxc = max(max(c.r, c.g), c.b);
    float minc = min(min(c.r, c.g), c.b);
    float l = (maxc + minc) / 2.0;
    float h = 0.0; float s = 0.0;
    if (maxc != minc) {
        float d = maxc - minc;
        s = l > 0.5 ? d / (2.0 - maxc - minc) : d / (maxc + minc);
        if (maxc == c.r) { h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0); }
        else if (maxc == c.g) { h = (c.b - c.r) / d + 2.0; }
        else { h = (c.r - c.g) / d + 4.0; }
        h /= 6.0;
    }
    return vec3(h, s, l);
}
float hue2rgb(float p, float q, float t) {
    if (t < 0.0) t += 1.0;
    if (t > 1.0) t -= 1.0;
    if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
    if (t < 1.0/2.0) return q;
    if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
    return p;
}
vec3 hsl2rgb(vec3 hsl) {
    float h = hsl.x, s = hsl.y, l = hsl.z;
    if (s == 0.0) return vec3(l);
    float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
    float p = 2.0 * l - q;
    return vec3(hue2rgb(p, q, h + 1.0/3.0), hue2rgb(p, q, h), hue2rgb(p, q, h - 1.0/3.0));
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Ruído hash barato, usado por vários efeitos (grain, fractal noise, nebula, clouds)
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise2(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash(i), b = hash(i + vec2(1.0,0.0)), c = hash(i + vec2(0.0,1.0)), d = hash(i + vec2(1.0,1.0));
    vec2 u = f*f*(3.0-2.0*f);
    return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
}
float fbm(vec2 p) {
    float v = 0.0, amp = 0.5;
    for (int i = 0; i < 5; i++) { v += amp * noise2(p); p *= 2.02; amp *= 0.5; }
    return v;
}
`;

// Cada entrada: { id, nome (pt-br), uniforms (nome->default), src (corpo do main()) }
const PIXELAR_FX_LIST = [

  // ===================== EFFECTS =====================

  
  {
    id: 'bokeh_blur', nome: 'Desfoque',
    uniforms: { uRadius: 6.0, uThreshold: 0.6, uBoost: 2.0 },
    src: `
    uniform float uRadius, uThreshold, uBoost;
    void main() {
        vec2 texel = 1.0/uResolution;
        vec3 sum = vec3(0.0);
        float wsum = 0.0;
        const int SAMPLES = 24;
        for (int i = 0; i < SAMPLES; i++) {
            float a = float(i) / float(SAMPLES) * 6.28318;
            float r = sqrt(float(i) / float(SAMPLES));
            vec2 off = vec2(cos(a), sin(a)) * r * uRadius * texel;
            vec3 c = texture(uSource, vUv + off).rgb;
            float br = luma(c);
            float w = br > uThreshold ? 1.0 + (br - uThreshold) * uBoost : 1.0;
            sum += c * w;
            wsum += w;
        }
        outColor = vec4(sum / max(wsum, 0.001), 1.0);
    }`
  },

  {
    id: 'channel_mixer', nome: 'Misturador',
    uniforms: {
      uRR: 0.0, uRG: 1.0, uRB: 0.0,
      uGR: 0.0, uGG: 0.0, uGB: 1.0,
      uBR: 1.0, uBG: 0.0, uBB: 0.0
    },
    src: `
    uniform float uRR, uRG, uRB, uGR, uGG, uGB, uBR, uBG, uBB;
    void main() {
        vec3 c = texture(uSource, vUv).rgb;
        vec3 outc = vec3(
            dot(c, vec3(uRR, uRG, uRB)),
            dot(c, vec3(uGR, uGG, uGB)),
            dot(c, vec3(uBR, uBG, uBB))
        );
        outColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
    }`
  },

  
  {
    id: 'color_adjustment', nome: 'Ajuste',
    uniforms: { uContrast: 1.3, uShadowLift: 0.0, uSatMid: 0.7, uToneAmount: 0.35,
      uShadowTone_r:0.05,uShadowTone_g:0.25,uShadowTone_b:0.15, uHighTone_r:1.0,uHighTone_g:0.75,uHighTone_b:0.45 },
    src: `
    uniform float uContrast, uShadowLift, uSatMid, uToneAmount;
    uniform float uShadowTone_r,uShadowTone_g,uShadowTone_b, uHighTone_r,uHighTone_g,uHighTone_b;
    void main() {
        vec3 c = texture(uSource, vUv).rgb;
        c = (c - 0.5) * uContrast + 0.5;
        c = mix(vec3(0.0), c, smoothstep(0.0, 0.25, luma(c) + uShadowLift));
        float l = luma(clamp(c,0.0,1.0));
        vec3 shadowTone = vec3(uShadowTone_r,uShadowTone_g,uShadowTone_b);
        vec3 highTone = vec3(uHighTone_r,uHighTone_g,uHighTone_b);
        vec3 toned = mix(c * (shadowTone*2.0), c * (highTone*2.0), smoothstep(0.15, 0.85, l));
        c = mix(c, toned, uToneAmount);
        vec3 hsl = rgb2hsl(clamp(c,0.0,1.0));
        hsl.y *= mix(1.0, uSatMid, smoothstep(0.15,0.6,hsl.z) * (1.0-smoothstep(0.6,0.9,hsl.z)));
        outColor = vec4(clamp(hsl2rgb(hsl), 0.0, 1.0), 1.0);
    }`
  },

  
  
  // filter_presets é tratado fora do FX (combinação de controles já existentes), sem shader próprio

  {
    id: 'gooey_merge', nome: 'Fusão',
    uniforms: { uThreshold: 0.5, uSmooth: 0.08, uColorA_r: 1.0, uColorA_g: 0.3, uColorA_b: 0.85, uColorB_r: 0.1, uColorB_g: 0.1, uColorB_b: 0.1 },
    src: `
    uniform float uThreshold, uSmooth;
    uniform float uColorA_r, uColorA_g, uColorA_b, uColorB_r, uColorB_g, uColorB_b;
    void main() {
        vec2 texel = 1.0/uResolution;
        float acc = 0.0, wsum = 0.0;
        for (float x=-3.0;x<=3.0;x+=1.0) for (float y=-3.0;y<=3.0;y+=1.0) {
            float w = exp(-(x*x+y*y)/8.0);
            acc += luma(texture(uSource, vUv + vec2(x,y)*texel*2.0).rgb) * w;
            wsum += w;
        }
        float field = acc / max(wsum,0.001);
        float mask = smoothstep(uThreshold-uSmooth, uThreshold+uSmooth, field);
        vec3 colA = vec3(uColorA_r,uColorA_g,uColorA_b);
        vec3 colB = vec3(uColorB_r,uColorB_g,uColorB_b);
        outColor = vec4(mix(colB, colA, mask), 1.0);
    }`
  },

  
  
  {
    id: 'hatching', nome: 'Gravura',
    uniforms: { uScale: 14.0, uThreshold: 0.5, uFg_r:0.0,uFg_g:0.6,uFg_b:1.0, uBg_r:1.0,uBg_g:1.0,uBg_b:1.0 },
    src: `
    uniform float uScale, uThreshold;
    uniform float uFg_r,uFg_g,uFg_b, uBg_r,uBg_g,uBg_b;
    void main() {
        vec2 p = vUv * uResolution;
        vec2 center = uResolution * 0.5;
        float dist = length(p - center);
        float ring = fract(dist / uScale - uAnim);
        float lineDensity = mix(0.5, 0.08, luma(texture(uSource, vUv).rgb));
        float lineMask = 1.0 - smoothstep(lineDensity-0.03, lineDensity+0.03, ring);
        float shapeMask = step(uThreshold, luma(texture(uSource, vUv).rgb));
        vec3 fg = vec3(uFg_r,uFg_g,uFg_b), bg = vec3(uBg_r,uBg_g,uBg_b);
        vec3 result = mix(mix(bg, fg, lineMask), fg, shapeMask);
        outColor = vec4(result, 1.0);
    }`
  },

  {
    id: 'lens_distortion', nome: 'Distorção',
    uniforms: { uAmount: 0.35, uChroma: 0.015, uZoom: 1.0 },
    src: `
    uniform float uAmount, uChroma, uZoom;
    vec2 distort(vec2 uv, float k) {
        vec2 cc = uv - 0.5;
        float r2 = dot(cc, cc);
        return 0.5 + cc * (1.0 + k * r2) * uZoom;
    }
    void main() {
        vec2 uvR = distort(vUv, uAmount + uChroma);
        vec2 uvG = distort(vUv, uAmount);
        vec2 uvB = distort(vUv, uAmount - uChroma);
        float r = texture(uSource, uvR).r;
        float g = texture(uSource, uvG).g;
        float b = texture(uSource, uvB).b;
        float inBounds = (uvG.x>=0.0&&uvG.x<=1.0&&uvG.y>=0.0&&uvG.y<=1.0) ? 1.0 : 0.0;
        outColor = vec4(vec3(r,g,b) * inBounds, 1.0);
    }`
  },

  {
    id: 'outlines', nome: 'Contornos',
    uniforms: { uSpacing: 8.0, uThickness: 2.0, uColor_r: 0.75, uColor_g: 0.85, uColor_b: 1.0, uBg_r:0.0,uBg_g:0.0,uBg_b:0.0 },
    src: `
    uniform float uSpacing, uThickness;
    uniform float uColor_r,uColor_g,uColor_b, uBg_r,uBg_g,uBg_b;
    void main() {
        vec2 texel = 1.0/uResolution;
        float lc = luma(texture(uSource, vUv).rgb);
        // distancia aproximada até a borda de forma via diferença local repetida em aneis
        float minEdge = 1.0;
        for (float ring = 0.0; ring < 12.0; ring += 1.0) {
            float rr = ring * uSpacing;
            float found = 0.0;
            for (float a = 0.0; a < 6.28318; a += 0.39269908) {
                vec2 off = vec2(cos(a), sin(a)) * rr * texel;
                float lsample = luma(texture(uSource, vUv + off).rgb);
                if (abs(lsample - lc) > 0.15) found = 1.0;
            }
            if (found > 0.5) { minEdge = ring / 12.0; break; }
        }
        float lineMask = 1.0 - smoothstep(uThickness*0.5*0.02, uThickness*0.02, fract(minEdge*12.0/2.0));
        vec3 col = vec3(uColor_r,uColor_g,uColor_b), bg = vec3(uBg_r,uBg_g,uBg_b);
        outColor = vec4(mix(bg, col, step(0.5, mod(minEdge*12.0 + uAnim*2.0, 2.0)) ), 1.0);
    }`
  },

  {
    id: 'pattern_refraction', nome: 'Refração',
    uniforms: { uBands: 14.0, uShift: 0.06, uAngle: 0.0 },
    src: `
    uniform float uBands, uShift, uAngle;
    void main() {
        float ca = cos(uAngle), sa = sin(uAngle);
        vec2 rp = vec2(vUv.x*ca - vUv.y*sa, vUv.x*sa + vUv.y*ca);
        float band = floor(rp.y * uBands);
        float dir = mod(band, 2.0) < 1.0 ? 1.0 : -1.0;
        float off = dir * uShift * (0.5 + 0.5*sin(band*12.9898 + uAnim*6.28318530718));
        vec2 uv2 = vUv + vec2(off * ca, off * sa);
        outColor = texture(uSource, clamp(uv2, 0.0, 1.0));
    }`
  },

  
  {
    id: 'pixelate_fx', nome: 'Pixelização',
    uniforms: { uSizeX: 14.0, uSizeY: 6.0 },
    src: `
    uniform float uSizeX, uSizeY;
    void main() {
        vec2 cell = vec2(uSizeX, uSizeY);
        vec2 uv = (floor(vUv * uResolution / cell) + 0.5) * cell / uResolution;
        outColor = texture(uSource, uv);
    }`
  },

  {
    id: 'slice_shift', nome: 'Fatias',
    uniforms: { uSlices: 8.0, uShift: 0.04, uSeed: 1.0 },
    src: `
    uniform float uSlices, uShift, uSeed;
    void main() {
        float sliceId = floor(vUv.x * uSlices);
        float r = hash(vec2(sliceId, uSeed));
        float off = (r - 0.5) * uShift;
        vec2 uv2 = vec2(vUv.x, vUv.y + off);
        outColor = texture(uSource, clamp(uv2, 0.0, 1.0));
    }`
  },

  {
    id: 'warp', nome: 'Deformação',
    uniforms: { uAmount: 0.05, uFreq: 6.0, uPhase: 0.0, uDuo: 1.0, uColorA_r:1.0,uColorA_g:0.85,uColorA_b:0.55, uColorB_r:0.35,uColorB_g:0.75,uColorB_b:1.0 },
    src: `
    uniform float uAmount, uFreq, uPhase, uDuo;
    uniform float uColorA_r,uColorA_g,uColorA_b, uColorB_r,uColorB_g,uColorB_b;
    void main() {
        vec2 uv = vUv;
        float wobble = sin(uv.y * uFreq + uPhase) * uAmount;
        vec2 uv2 = vec2(uv.x + wobble, uv.y);
        vec3 c = texture(uSource, clamp(uv2, 0.0, 1.0)).rgb;
        if (uDuo > 0.5) {
            vec3 colA = vec3(uColorA_r,uColorA_g,uColorA_b), colB = vec3(uColorB_r,uColorB_g,uColorB_b);
            c = mix(colB, colA, luma(c));
        }
        outColor = vec4(c, 1.0);
    }`
  },

  {
    // Inspirado em fotocópias/scans desbotados: contraste duro, tom monocromático
    // amarelado, ruído de scanner em faixas e vinheta suja nas bordas.
    id: 'photocopy', nome: 'Fotocópia',
    uniforms: { uContrast: 2.2, uGrain: 0.18, uStreaks: 0.25, uInk_r:0.16,uInk_g:0.16,uInk_b:0.32, uPaper_r:0.96,uPaper_g:0.94,uPaper_b:0.82 },
    src: `
    uniform float uContrast, uGrain, uStreaks;
    uniform float uInk_r,uInk_g,uInk_b, uPaper_r,uPaper_g,uPaper_b;
    void main() {
        vec3 c = texture(uSource, vUv).rgb;
        float l = luma(c);
        l = clamp((l - 0.5) * uContrast + 0.5, 0.0, 1.0);
        vec3 ink = vec3(uInk_r,uInk_g,uInk_b), paper = vec3(uPaper_r,uPaper_g,uPaper_b);
        vec3 result = mix(ink, paper, l);
        float streak = step(1.0 - uStreaks*0.3, hash(vec2(floor(vUv.y*uResolution.y*0.5), 7.0 + uAnimFrame)));
        result *= (1.0 - streak*0.25);
        float g = (hash(vUv*uResolution + uAnimFrame*vec2(17.0, 31.0)) - 0.5) * uGrain;
        outColor = vec4(clamp(result + g, 0.0, 1.0), 1.0);
    }`
  },

  {
    // Inspirado em fita VHS/vídeo analógico: leve deslocamento horizontal por
    // linha (jitter), sangramento de cor (chroma bleed) e scanlines escuras.
    id: 'vhs', nome: 'Fita',
    uniforms: { uJitter: 0.008, uBleed: 0.006, uScanline: 0.25, uNoise: 0.06 },
    src: `
    uniform float uJitter, uBleed, uScanline, uNoise;
    void main() {
        float lineNoise = (hash(vec2(floor(vUv.y * uResolution.y), 3.0 + uAnimFrame)) - 0.5) * 2.0;
        float jitterAmt = lineNoise * uJitter * step(0.92, hash(vec2(floor(vUv.y*uResolution.y*0.2), 9.0 + uAnimFrame)));
        vec2 uv = vec2(vUv.x + jitterAmt, vUv.y);
        float r = texture(uSource, clamp(uv + vec2(uBleed,0.0), 0.0, 1.0)).r;
        float g = texture(uSource, clamp(uv, 0.0, 1.0)).g;
        float b = texture(uSource, clamp(uv - vec2(uBleed,0.0), 0.0, 1.0)).b;
        vec3 c = vec3(r,g,b);
        float scan = 1.0 - uScanline * (0.5 + 0.5*sin(vUv.y * uResolution.y * 3.14159 + uAnim*6.28318530718));
        c *= scan;
        float n = (hash(vUv*uResolution*1.7 + uAnimFrame*vec2(13.0, 7.0)) - 0.5) * uNoise;
        outColor = vec4(clamp(c + n, 0.0, 1.0), 1.0);
    }`
  },

  // ===================== NOVOS: GRÁFICOS, IMPRESSÃO, LUZ, ARTE =====================
  // Tamanhos em "px por 1000 px do lado maior": o efeito fica igual na miniatura, na tela e na exportação.

  {
    id: 'ascii', nome: 'ASCII',
    uniforms: { uCell: 10.0, uContrast: 1.35, uColorMode: 1.0, uInk_r: 0.62, uInk_g: 1.0, uInk_b: 0.62, uPaper_r: 0.02, uPaper_g: 0.04, uPaper_b: 0.03 },
    src: `
    uniform float uCell, uContrast, uColorMode, uInk_r, uInk_g, uInk_b, uPaper_r, uPaper_g, uPaper_b;
    // 10 caracteres do mais vazio ao mais cheio: ' . : - = + * # % @' (5x7, linhas de cima para baixo)
    const int G[70] = int[70](0,0,0,0,0,0,0, 0,0,0,0,0,12,12, 0,12,12,0,12,12,0, 0,0,0,14,0,0,0, 0,0,31,0,31,0,0,
                              0,4,4,31,4,4,0, 0,21,14,31,14,21,0, 10,31,10,10,31,10,0, 25,26,2,4,8,11,19, 14,17,23,21,23,16,14);
    void main() {
        float S = max(uResolution.x, uResolution.y) / 1000.0, cw = max(4.0, uCell * S), ch = cw * 1.4;
        vec2 p = vUv * uResolution, cell = floor(p / vec2(cw, ch));
        vec3 c = texture(uSource, (cell + 0.5) * vec2(cw, ch) / uResolution).rgb;
        float l = clamp((luma(c) - 0.5) * uContrast + 0.55, 0.0, 1.0);
        int g = int(clamp(floor(pow(l, 0.8) * 9.999), 0.0, 9.0));
        vec2 f = fract(p / vec2(cw, ch));
        int col = int(floor(f.x * 6.0)), row = int(floor(f.y * 8.0));
        float on = 0.0;
        if (col < 5 && row < 7) on = float((G[g * 7 + row] >> (4 - col)) & 1);
        vec3 ink = mix(vec3(uInk_r, uInk_g, uInk_b), c * 1.25, uColorMode);
        outColor = vec4(mix(vec3(uPaper_r, uPaper_g, uPaper_b), ink, on), 1.0);
    }`
  },

  {
    id: 'crt', nome: 'Monitor CRT',
    uniforms: { uPitch: 3.0, uMask: 0.55, uScan: 0.45, uCurve: 0.12, uGlow: 0.35 },
    src: `
    uniform float uPitch, uMask, uScan, uCurve, uGlow;
    void main() {
        vec2 uv = vUv * 2.0 - 1.0;
        uv *= 1.0 + uCurve * dot(uv, uv) * 0.25;
        vec2 t = uv * 0.5 + 0.5;
        if (t.x < 0.0 || t.x > 1.0 || t.y < 0.0 || t.y > 1.0) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        float S = max(uResolution.x, uResolution.y) / 1000.0, pitch = max(2.0, uPitch * S);
        vec3 c = texture(uSource, t).rgb;
        vec3 blur = (texture(uSource, t + vec2(2.0, 0.0) / uResolution).rgb + texture(uSource, t - vec2(2.0, 0.0) / uResolution).rgb + texture(uSource, t + vec2(0.0, 2.0) / uResolution).rgb) / 3.0;
        c += blur * blur * uGlow;
        vec2 px = t * uResolution;
        float m = mod(floor(px.x / (pitch / 3.0)), 3.0);
        vec3 mask = m < 0.5 ? vec3(1.0, 0.3, 0.3) : m < 1.5 ? vec3(0.3, 1.0, 0.3) : vec3(0.3, 0.3, 1.0);
        c *= mix(vec3(1.0), mask * 1.6, uMask);
        float roll = 0.5 + 0.5 * sin((t.y - uAnim) * 6.28318);
        float scan = 0.5 + 0.5 * cos(px.y / pitch * 6.28318);
        c *= mix(1.0, scan, uScan) * (0.94 + 0.06 * roll);
        vec2 v = t * (1.0 - t); c *= pow(v.x * v.y * 16.0, 0.18);
        outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`
  },

  {
    id: 'beads', nome: 'Miçangas',
    uniforms: { uCell: 14.0, uHole: 0.28, uShine: 0.5, uBg_r: 0.93, uBg_g: 0.92, uBg_b: 0.9 },
    src: `
    uniform float uCell, uHole, uShine, uBg_r, uBg_g, uBg_b;
    void main() {
        float S = max(uResolution.x, uResolution.y) / 1000.0, cs = max(4.0, uCell * S);
        vec2 p = vUv * uResolution, id = floor(p / cs), f = fract(p / cs) - 0.5;
        vec3 c = texture(uSource, (id + 0.5) * cs / uResolution).rgb;
        float r = length(f), aa = 1.5 / cs;
        float bead = smoothstep(0.47, 0.47 - aa, r) * smoothstep(uHole * 0.5 - aa, uHole * 0.5, r);
        float shade = 0.75 + 0.25 * (1.0 - smoothstep(0.1, 0.5, length(f - vec2(-0.14, -0.16))));
        vec3 bc = c * shade + uShine * 0.35 * smoothstep(0.14, 0.0, length(f - vec2(-0.16, -0.18)));
        vec3 bg = vec3(uBg_r, uBg_g, uBg_b) * (0.9 + 0.1 * smoothstep(0.5, 0.2, r));
        outColor = vec4(mix(bg, bc, bead), 1.0);
    }`
  },

  {
    id: 'knit', nome: 'Tricô',
    uniforms: { uCell: 12.0, uDepth: 0.6, uFuzz: 0.4 },
    src: `
    uniform float uCell, uDepth, uFuzz;
    void main() {
        float S = max(uResolution.x, uResolution.y) / 1000.0, cw = max(4.0, uCell * S), ch = cw * 1.25;
        vec2 p = vUv * uResolution, id = floor(p / vec2(cw, ch)), f = fract(p / vec2(cw, ch));
        vec3 c = texture(uSource, (id + 0.5) * vec2(cw, ch) / uResolution).rgb;
        // ponto em V: duas “pernas” inclinadas (elipses) lado a lado
        vec2 a = vec2(f.x * 2.0 - 0.5, f.y - 0.45); a.x = abs(a.x) - 0.25;
        float ang = sign(f.x - 0.5) * 0.55; mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
        vec2 q = R * vec2(a.x * 2.0, a.y * 1.05);
        float leg = smoothstep(0.62, 0.42, length(q * vec2(1.7, 0.9)));
        float yarn = 0.72 + 0.28 * sin(q.y * 24.0 + q.x * 6.0);
        float fuzz = (hash(p * 0.7) - 0.5) * uFuzz * 0.25;
        vec3 col = c * mix(1.0 - uDepth * 0.7, 1.0, leg) * mix(1.0, yarn, leg * uDepth) + fuzz;
        outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`
  },

  {
    id: 'mosaic_tiles', nome: 'Pastilhas',
    uniforms: { uCell: 16.0, uGrout: 0.12, uBrick: 0.0, uBevel: 0.5, uGrout_r: 0.9, uGrout_g: 0.89, uGrout_b: 0.86 },
    src: `
    uniform float uCell, uGrout, uBrick, uBevel, uGrout_r, uGrout_g, uGrout_b;
    void main() {
        float S = max(uResolution.x, uResolution.y) / 1000.0, cs = max(4.0, uCell * S);
        vec2 p = vUv * uResolution / cs;
        vec2 size = uBrick > 0.5 ? vec2(2.0, 1.0) : vec2(1.0);
        p.x += uBrick > 0.5 ? step(1.0, mod(floor(p.y), 2.0)) * 1.0 : 0.0;
        vec2 id = floor(p / size), f = fract(p / size);
        vec3 c = texture(uSource, clamp(((id + 0.5) * size - vec2(uBrick > 0.5 ? step(1.0, mod(floor(p.y), 2.0)) : 0.0, 0.0)) * cs / uResolution, 0.0, 1.0)).rgb;
        c *= 0.94 + 0.12 * hash(id + 7.0);
        vec2 e = min(f, 1.0 - f) * size;
        float g = uGrout * 0.5, aa = 1.0 / cs;
        float tile = smoothstep(g, g + aa, min(e.x, e.y));
        float bevel = smoothstep(g + 0.18, g, min(e.x, e.y)) * uBevel;
        float lit = (f.x < 0.5 || f.y < 0.5) ? 1.0 + bevel * 0.35 : 1.0 - bevel * 0.35;
        outColor = vec4(mix(vec3(uGrout_r, uGrout_g, uGrout_b), c * lit, tile), 1.0);
    }`
  },

  {
    id: 'hologram', nome: 'Holograma',
    uniforms: { uAmount: 0.7, uBands: 3.0, uShift: 1.2, uLines: 0.25 },
    src: `
    uniform float uAmount, uBands, uShift, uLines;
    void main() {
        vec3 c = texture(uSource, vUv).rgb;
        float l = luma(c);
        float hue = fract(l * uBands + (vUv.x * 0.6 + vUv.y) * uShift + uAnim);
        vec3 irid = hsl2rgb(vec3(hue, 0.85, 0.55 + 0.25 * l));
        vec3 col = mix(c, irid * (0.35 + l), uAmount);
        col = mix(col, 1.0 - (1.0 - col) * (1.0 - irid * 0.35), uAmount * 0.5);
        float line = 0.5 + 0.5 * sin(vUv.y * uResolution.y * 1.2 + uAnim * 6.28318);
        col *= 1.0 - uLines * 0.35 * line;
        outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`
  },

  {
    id: 'contour', nome: 'Topografia',
    uniforms: { uLevels: 10.0, uThickness: 1.4, uFill: 0.4, uInk_r: 0.12, uInk_g: 0.1, uInk_b: 0.09, uPaper_r: 0.96, uPaper_g: 0.94, uPaper_b: 0.89 },
    src: `
    uniform float uLevels, uThickness, uFill, uInk_r, uInk_g, uInk_b, uPaper_r, uPaper_g, uPaper_b;
    float L(vec2 uv) { vec2 t = 4.0 * max(1.0, max(uResolution.x, uResolution.y) / 1000.0) / uResolution; return (luma(texture(uSource, uv).rgb) * 2.0 + luma(texture(uSource, uv + vec2(t.x, 0.0)).rgb) + luma(texture(uSource, uv - vec2(t.x, 0.0)).rgb) + luma(texture(uSource, uv + vec2(0.0, t.y)).rgb) + luma(texture(uSource, uv - vec2(0.0, t.y)).rgb)) / 6.0; }
    void main() {
        vec3 c = texture(uSource, vUv).rgb;
        float v = L(vUv) * uLevels;
        float d = abs(fract(v - 0.5) - 0.5) / max(fwidth(v), 1e-4);
        float S = max(uResolution.x, uResolution.y) / 1000.0;
        float line = 1.0 - smoothstep(uThickness * S * 0.5, uThickness * S * 0.5 + 1.0, d);
        vec3 base = mix(vec3(uPaper_r, uPaper_g, uPaper_b), c, uFill);
        outColor = vec4(mix(base, vec3(uInk_r, uInk_g, uInk_b), line), 1.0);
    }`
  },

  {
    id: 'starlight', nome: 'Estrelas',
    uniforms: { uThreshold: 0.68, uLength: 34.0, uIntensity: 1.6, uDiagonal: 0.0 },
    src: `
    uniform float uThreshold, uLength, uIntensity, uDiagonal;
    vec3 bright(vec2 uv) { vec3 c = texture(uSource, uv).rgb; return c * smoothstep(uThreshold, 1.0, luma(c)); }
    void main() {
        vec3 c = texture(uSource, vUv).rgb, acc = vec3(0.0);
        float S = max(uResolution.x, uResolution.y) / 1000.0, len = uLength * S;
        vec2 dirs[4]; dirs[0] = vec2(1.0, 0.0); dirs[1] = vec2(0.0, 1.0); dirs[2] = normalize(vec2(1.0, 1.0)); dirs[3] = normalize(vec2(1.0, -1.0));
        for (int d = 0; d < 4; d++) {
            float wd = d < 2 ? 1.0 : uDiagonal;
            if (wd <= 0.0) continue;
            for (int i = 1; i <= 16; i++) {
                float t = float(i) / 16.0, w = pow(1.0 - t, 2.0) * wd;
                vec2 o = dirs[d] * t * len / uResolution;
                acc += (bright(vUv + o) + bright(vUv - o)) * w;
            }
        }
        float tw = 0.85 + 0.15 * sin(uAnim * 6.28318 + hash(floor(vUv * 40.0)) * 6.28);
        outColor = vec4(clamp(c + acc / 8.0 * uIntensity * tw, 0.0, 1.0), 1.0);
    }`
  },

  {
    id: 'stipple', nome: 'Pontilhado',
    uniforms: { uCell: 6.0, uJitter: 0.8, uGamma: 1.2, uInk_r: 0.08, uInk_g: 0.07, uInk_b: 0.07, uPaper_r: 0.97, uPaper_g: 0.95, uPaper_b: 0.9 },
    src: `
    uniform float uCell, uJitter, uGamma, uInk_r, uInk_g, uInk_b, uPaper_r, uPaper_g, uPaper_b;
    void main() {
        float S = max(uResolution.x, uResolution.y) / 1000.0, cs = max(2.5, uCell * S);
        vec2 p = vUv * uResolution / cs; float ink = 0.0;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec2 id = floor(p) + vec2(x, y);
            vec2 ctr = id + 0.5 + (vec2(hash(id), hash(id + 17.0)) - 0.5) * uJitter;
            float dark = pow(1.0 - luma(texture(uSource, ctr * cs / uResolution).rgb), uGamma);
            float r = sqrt(dark) * 0.62;
            ink = max(ink, smoothstep(r, r - 1.2 / cs, length(p - ctr)));
        }
        outColor = vec4(mix(vec3(uPaper_r, uPaper_g, uPaper_b), vec3(uInk_r, uInk_g, uInk_b), ink), 1.0);
    }`
  },

  {
    id: 'woodcut', nome: 'Xilogravura',
    uniforms: { uSpacing: 7.0, uWarp: 1.4, uContrast: 1.3, uInk_r: 0.07, uInk_g: 0.06, uInk_b: 0.05, uPaper_r: 0.95, uPaper_g: 0.91, uPaper_b: 0.82 },
    src: `
    uniform float uSpacing, uWarp, uContrast, uInk_r, uInk_g, uInk_b, uPaper_r, uPaper_g, uPaper_b;
    void main() {
        float S = max(uResolution.x, uResolution.y) / 1000.0, sp = max(2.5, uSpacing * S);
        vec2 p = vUv * uResolution;
        float l = clamp((luma(texture(uSource, vUv).rgb) - 0.5) * uContrast + 0.5, 0.0, 1.0);
        float flow = fbm(p / (sp * 18.0)) * uWarp * 4.0 + luma(texture(uSource, vUv).rgb) * uWarp;
        float v = 0.5 + 0.5 * sin((p.y / sp + flow) * 6.28318);
        float grain = (fbm(p / (sp * 0.6)) - 0.5) * 0.25;
        float ink = smoothstep(l - 0.08, l + 0.08, v + grain);
        outColor = vec4(mix(vec3(uInk_r, uInk_g, uInk_b), vec3(uPaper_r, uPaper_g, uPaper_b), ink), 1.0);
    }`
  },

  {
    id: 'mesh_lines', nome: 'Pulsar',
    uniforms: { uSpacing: 14.0, uHeight: 70.0, uThickness: 1.8, uInk_r: 0.95, uInk_g: 0.95, uInk_b: 0.93, uBg_r: 0.02, uBg_g: 0.02, uBg_b: 0.03 },
    src: `
    uniform float uSpacing, uHeight, uThickness, uInk_r, uInk_g, uInk_b, uBg_r, uBg_g, uBg_b;
    void main() {
        float S = max(uResolution.x, uResolution.y) / 1000.0, sp = max(3.0, uSpacing * S), hh = uHeight * S;
        vec2 p = vUv * uResolution; float ink = 0.0;
        float k0 = floor(p.y / sp);
        // linhas de cima para baixo: cada linha mais próxima (mais embaixo) tapa as de trás — como uma cordilheira
        for (int j = 0; j <= 10; j++) {
            float yl = (k0 + float(j)) * sp;
            float xs = vUv.x;
            float h = luma(texture(uSource, vec2(xs, clamp(yl / uResolution.y, 0.0, 1.0))).rgb);
            float edge = smoothstep(0.0, 0.18, xs) * smoothstep(1.0, 0.82, xs);
            float y = yl - pow(h, 1.4) * hh * (0.35 + 0.65 * edge);
            if (p.y > y + uThickness * S) ink = 0.0;
            ink = max(ink, 1.0 - smoothstep(uThickness * S * 0.5, uThickness * S * 0.5 + 1.0, abs(p.y - y)));
        }
        outColor = vec4(mix(vec3(uBg_r, uBg_g, uBg_b), vec3(uInk_r, uInk_g, uInk_b), ink), 1.0);
    }`
  },

  {
    id: 'paper', nome: 'Papel',
    uniforms: { uFiber: 0.5, uGrain: 0.35, uWarmth: 0.4, uFade: 0.12 },
    src: `
    uniform float uFiber, uGrain, uWarmth, uFade;
    void main() {
        vec3 c = texture(uSource, vUv).rgb;
        float S = max(uResolution.x, uResolution.y) / 1000.0;
        vec2 p = vUv * uResolution / S;
        float fib = fbm(vec2(p.x * 0.02, p.y * 0.35)) * 0.6 + fbm(p * 0.08) * 0.4;
        float g = hash(floor(p * 0.9)) - 0.5;
        vec3 paper = vec3(0.97, 0.94, 0.87) + vec3(0.0, -0.01, -0.04) * uWarmth;
        vec3 col = mix(c, c * paper, 0.7);
        col = mix(col, paper, uFade);
        col *= 1.0 - (fib - 0.5) * uFiber * 0.35;
        col += g * uGrain * 0.12;
        outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`
  },

  {
    id: 'fluted_glass', nome: 'Vidro canelado',
    uniforms: { uRib: 22.0, uStrength: 0.9, uAngle: 0.0, uShade: 0.35 },
    src: `
    uniform float uRib, uStrength, uAngle, uShade;
    void main() {
        float S = max(uResolution.x, uResolution.y) / 1000.0, rib = max(4.0, uRib * S);
        vec2 p = vUv * uResolution;
        vec2 dir = vec2(cos(uAngle), sin(uAngle)), nrm = vec2(-dir.y, dir.x);
        float u = dot(p, dir) / rib, f = fract(u) - 0.5;
        float off = f * rib * uStrength;
        vec2 uv = (p - dir * off * 0.9) / uResolution;
        vec3 c = texture(uSource, clamp(uv, 0.0, 1.0)).rgb;
        vec3 c2 = texture(uSource, clamp(uv + dir * 1.5 / uResolution, 0.0, 1.0)).rgb;
        c = (c + c2) * 0.5;
        c *= 1.0 - uShade * (f * f * 2.2) + uShade * 0.25 * smoothstep(0.35, 0.5, -f);
        outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`
  },

  {
    id: 'cmyk_halftone', nome: 'Meio-tom CMYK',
    uniforms: { uCell: 7.0, uDot: 1.0, uPaper_r: 0.97, uPaper_g: 0.95, uPaper_b: 0.91 },
    src: `
    uniform float uCell, uDot, uPaper_r, uPaper_g, uPaper_b;
    float screen(vec2 p, float ang, float cs, float amt) {
        mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
        vec2 q = R * p / cs, id = floor(q) + 0.5;
        float r = sqrt(clamp(amt, 0.0, 1.0)) * 0.7 * uDot;
        return smoothstep(r, r - 1.2 / cs, length(q - id));
    }
    void main() {
        float S = max(uResolution.x, uResolution.y) / 1000.0, cs = max(3.0, uCell * S);
        vec2 p = vUv * uResolution;
        vec3 c = texture(uSource, vUv).rgb;
        float k = 1.0 - max(max(c.r, c.g), c.b);
        vec3 cmy = (1.0 - c - k) / max(1.0 - k, 1e-3);
        float C = screen(p, 0.2618, cs, cmy.x), M = screen(p, 1.309, cs, cmy.y), Y = screen(p, 0.0, cs, cmy.z), K = screen(p, 0.7854, cs, k);
        vec3 col = vec3(uPaper_r, uPaper_g, uPaper_b);
        col *= 1.0 - C * vec3(1.0, 0.0, 0.0) * 0.9; col *= 1.0 - M * vec3(0.0, 1.0, 0.0) * 0.9; col *= 1.0 - Y * vec3(0.0, 0.0, 1.0) * 0.9; col *= 1.0 - K * 0.92;
        outColor = vec4(col, 1.0);
    }`
  },

  {
    id: 'water', nome: 'Água',
    uniforms: { uAmount: 0.6, uScale: 1.0, uCaustics: 0.4 },
    src: `
    uniform float uAmount, uScale, uCaustics;
    void main() {
        vec2 p = vUv * vec2(uResolution.x / uResolution.y, 1.0) * 6.0 * uScale;
        float t = uAnim * 6.28318;
        vec2 w = vec2(sin(p.y * 2.1 + t) + sin(p.x * 1.3 + p.y * 0.7 - t), cos(p.x * 1.7 - t) + cos(p.y * 1.1 + p.x * 0.9 + t));
        vec2 uv = vUv + w * 0.004 * uAmount;
        vec3 c = texture(uSource, clamp(uv, 0.0, 1.0)).rgb;
        float ca = pow(abs(sin(p.x * 3.0 + w.x * 2.0 + t) * sin(p.y * 3.0 + w.y * 2.0 - t)), 6.0);
        c += ca * uCaustics * 0.35;
        outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`
  },

  {
    id: 'thermal', nome: 'Térmico',
    uniforms: { uContrast: 1.2, uShift: 0.0, uBlur: 0.5 },
    src: `
    uniform float uContrast, uShift, uBlur;
    vec3 heat(float t) {
        t = clamp(t, 0.0, 1.0);
        vec3 a = vec3(0.0, 0.0, 0.1), b = vec3(0.25, 0.0, 0.6), c = vec3(0.85, 0.0, 0.45), d = vec3(1.0, 0.45, 0.0), e = vec3(1.0, 0.95, 0.3), f = vec3(1.0);
        return t < 0.2 ? mix(a, b, t / 0.2) : t < 0.4 ? mix(b, c, (t - 0.2) / 0.2) : t < 0.6 ? mix(c, d, (t - 0.4) / 0.2) : t < 0.8 ? mix(d, e, (t - 0.6) / 0.2) : mix(e, f, (t - 0.8) / 0.2);
    }
    void main() {
        vec2 o = uBlur * 3.0 / uResolution;
        float l = (luma(texture(uSource, vUv).rgb) * 2.0 + luma(texture(uSource, vUv + vec2(o.x, 0.0)).rgb) + luma(texture(uSource, vUv - vec2(o.x, 0.0)).rgb) + luma(texture(uSource, vUv + vec2(0.0, o.y)).rgb) + luma(texture(uSource, vUv - vec2(0.0, o.y)).rgb)) / 6.0;
        outColor = vec4(heat((l - 0.5) * uContrast + 0.5 + uShift), 1.0);
    }`
  },

  {
    id: 'emboss', nome: 'Relevo',
    uniforms: { uStrength: 1.5, uAngle: 0.8, uColorMix: 0.25 },
    src: `
    uniform float uStrength, uAngle, uColorMix;
    void main() {
        float S = max(uResolution.x, uResolution.y) / 1000.0;
        vec2 d = vec2(cos(uAngle), sin(uAngle)) * 1.5 * S / uResolution;
        float a = luma(texture(uSource, vUv - d).rgb), b = luma(texture(uSource, vUv + d).rgb);
        float e = clamp(0.5 + (a - b) * uStrength * 2.0, 0.0, 1.0);
        vec3 c = texture(uSource, vUv).rgb;
        outColor = vec4(mix(vec3(e), c * (e + 0.5), uColorMix), 1.0);
    }`
  },

  {
    id: 'bitmap', nome: 'Bitmap',
    uniforms: { uThreshold: 0.5, uNoise: 0.25, uInk_r: 0.0, uInk_g: 0.0, uInk_b: 0.0, uPaper_r: 1.0, uPaper_g: 1.0, uPaper_b: 1.0 },
    src: `
    uniform float uThreshold, uNoise, uInk_r, uInk_g, uInk_b, uPaper_r, uPaper_g, uPaper_b;
    void main() {
        float l = luma(texture(uSource, vUv).rgb) + (hash(floor(vUv * uResolution)) - 0.5) * uNoise;
        outColor = vec4(l > uThreshold ? vec3(uPaper_r, uPaper_g, uPaper_b) : vec3(uInk_r, uInk_g, uInk_b), 1.0);
    }`
  },

  {
    id: 'duo_halftone', nome: 'Meio-tom duplo',
    uniforms: { uCell: 8.0, uColorA_r: 0.12, uColorA_g: 0.2, uColorA_b: 0.55, uColorB_r: 1.0, uColorB_g: 0.36, uColorB_b: 0.47, uPaper_r: 0.97, uPaper_g: 0.95, uPaper_b: 0.9 },
    src: `
    uniform float uCell, uColorA_r, uColorA_g, uColorA_b, uColorB_r, uColorB_g, uColorB_b, uPaper_r, uPaper_g, uPaper_b;
    float dotAt(vec2 p, float ang, float cs, float amt) {
        mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)); vec2 q = R * p / cs, id = floor(q) + 0.5;
        float r = sqrt(clamp(amt, 0.0, 1.0)) * 0.72; return smoothstep(r, r - 1.2 / cs, length(q - id));
    }
    void main() {
        float S = max(uResolution.x, uResolution.y) / 1000.0, cs = max(3.0, uCell * S);
        vec2 p = vUv * uResolution;
        float l = luma(texture(uSource, vUv).rgb);
        float a = dotAt(p, 0.785, cs, pow(1.0 - l, 1.4));
        float b = dotAt(p, 0.26, cs, smoothstep(0.1, 0.9, 1.0 - abs(l - 0.55) * 1.8));
        vec3 col = vec3(uPaper_r, uPaper_g, uPaper_b);
        col = mix(col, col * vec3(uColorB_r, uColorB_g, uColorB_b), b * 0.9);
        col = mix(col, col * vec3(uColorA_r, uColorA_g, uColorA_b), a * 0.95);
        outColor = vec4(col, 1.0);
    }`
  },

  {
    id: 'edge_ink', nome: 'Nanquim',
    uniforms: { uThickness: 1.0, uThreshold: 0.12, uWash: 0.35, uInk_r: 0.06, uInk_g: 0.05, uInk_b: 0.05, uPaper_r: 0.97, uPaper_g: 0.95, uPaper_b: 0.9 },
    src: `
    uniform float uThickness, uThreshold, uWash, uInk_r, uInk_g, uInk_b, uPaper_r, uPaper_g, uPaper_b;
    float L(vec2 uv) { return luma(texture(uSource, uv).rgb); }
    void main() {
        float S = max(uResolution.x, uResolution.y) / 1000.0;
        vec2 t = uThickness * S / uResolution;
        float gx = L(vUv + vec2(t.x, 0.0)) - L(vUv - vec2(t.x, 0.0)) + 0.5 * (L(vUv + t) - L(vUv - t) + L(vUv + vec2(t.x, -t.y)) - L(vUv + vec2(-t.x, t.y)));
        float gy = L(vUv + vec2(0.0, t.y)) - L(vUv - vec2(0.0, t.y)) + 0.5 * (L(vUv + t) - L(vUv - t) - L(vUv + vec2(t.x, -t.y)) + L(vUv + vec2(-t.x, t.y)));
        float e = smoothstep(uThreshold, uThreshold * 2.2, length(vec2(gx, gy)));
        float wash = (1.0 - L(vUv)) * uWash;
        vec3 paper = vec3(uPaper_r, uPaper_g, uPaper_b), ink = vec3(uInk_r, uInk_g, uInk_b);
        outColor = vec4(mix(mix(paper, ink, wash), ink, e), 1.0);
    }`
  },

  {
    id: 'color_threshold', nome: 'Limiar de cor',
    uniforms: { uThreshold: 0.5, uSoft: 0.04, uSplit: 0.12 },
    src: `
    uniform float uThreshold, uSoft, uSplit;
    void main() {
        vec3 c = texture(uSource, vUv).rgb;
        vec3 t = vec3(uThreshold - uSplit, uThreshold, uThreshold + uSplit);
        outColor = vec4(smoothstep(t - uSoft, t + uSoft, c), 1.0);
    }`
  },

  {
    id: 'ghost_lens', nome: 'Lente fantasma',
    uniforms: { uIntensity: 0.8, uThreshold: 0.72, uSpread: 0.6, uHalo: 0.4 },
    src: `
    uniform float uIntensity, uThreshold, uSpread, uHalo;
    vec3 br(vec2 uv) { vec3 c = texture(uSource, clamp(uv, 0.0, 1.0)).rgb; return c * smoothstep(uThreshold, 1.0, luma(c)); }
    void main() {
        vec3 c = texture(uSource, vUv).rgb, g = vec3(0.0);
        vec2 toC = vec2(0.5) - vUv;
        for (int i = 1; i <= 5; i++) {
            float k = float(i) * 0.22 * uSpread;
            vec3 tint = hsl2rgb(vec3(fract(float(i) * 0.19 + 0.55), 0.7, 0.6));
            g += br(vUv + toC * k * 2.0) * tint * (1.0 - float(i) * 0.12);
        }
        vec2 hv = normalize(toC + 1e-5) * 0.35;
        g += br(vUv + hv) * uHalo * vec3(0.8, 0.9, 1.0);
        outColor = vec4(clamp(c + g * uIntensity * 0.6, 0.0, 1.0), 1.0);
    }`
  },

  {
    id: 'acid', nome: 'Ácido',
    uniforms: { uAmount: 0.8, uWarp: 0.5, uSat: 1.6 },
    src: `
    uniform float uAmount, uWarp, uSat;
    void main() {
        vec2 q = vUv * 3.0;
        vec2 w = vec2(fbm(q + uAnim * 2.0), fbm(q + 5.2 - uAnim * 2.0)) - 0.5;
        vec3 c = texture(uSource, clamp(vUv + w * 0.03 * uWarp, 0.0, 1.0)).rgb;
        vec3 h = rgb2hsl(c);
        h.x = fract(h.x + luma(c) * uAmount * 1.5 + uAnim + w.x * uWarp);
        h.y = clamp(h.y * uSat + 0.2 * uAmount, 0.0, 1.0);
        outColor = vec4(mix(c, hsl2rgb(h), clamp(uAmount, 0.0, 1.0)), 1.0);
    }`
  },

  {
    id: 'neon_trace', nome: 'Traçado néon',
    uniforms: { uThickness: 1.2, uGlow: 0.8, uThreshold: 0.1, uBg: 0.05 },
    src: `
    uniform float uThickness, uGlow, uThreshold, uBg;
    vec3 C(vec2 uv) { return texture(uSource, clamp(uv, 0.0, 1.0)).rgb; }
    float E(vec2 uv, vec2 t) { float gx = luma(C(uv + vec2(t.x, 0.0))) - luma(C(uv - vec2(t.x, 0.0))); float gy = luma(C(uv + vec2(0.0, t.y))) - luma(C(uv - vec2(0.0, t.y))); return length(vec2(gx, gy)); }
    void main() {
        float S = max(uResolution.x, uResolution.y) / 1000.0;
        vec2 t = uThickness * S / uResolution;
        float e = smoothstep(uThreshold, uThreshold * 2.5, E(vUv, t));
        float glow = 0.0;
        for (int i = 0; i < 8; i++) { float a = float(i) * 0.785; vec2 o = vec2(cos(a), sin(a)) * 3.0 * S / uResolution; glow += smoothstep(uThreshold, uThreshold * 2.5, E(vUv + o, t)); }
        vec3 hue = hsl2rgb(vec3(rgb2hsl(C(vUv)).x, 0.9, 0.6));
        vec3 col = C(vUv) * uBg + hue * (e + glow / 8.0 * uGlow);
        outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`
  },

  {
    id: 'smudge', nome: 'Borrão',
    uniforms: { uLength: 30.0, uAngle: 0.3, uFlow: 0.6 },
    src: `
    uniform float uLength, uAngle, uFlow;
    void main() {
        float S = max(uResolution.x, uResolution.y) / 1000.0;
        float a = uAngle + (fbm(vUv * 4.0) - 0.5) * 3.0 * uFlow;
        vec2 d = vec2(cos(a), sin(a)) * uLength * S / uResolution;
        vec3 acc = vec3(0.0); float ws = 0.0;
        for (int i = 0; i < 14; i++) { float t = float(i) / 13.0, w = 1.0 - t * 0.7; acc += texture(uSource, clamp(vUv - d * t, 0.0, 1.0)).rgb * w; ws += w; }
        outColor = vec4(acc / ws, 1.0);
    }`
  },

  // ===================== FILMES =====================

  {
    // Kodak Verde: puxa a imagem para um tom oliva/esverdeado nos meios-tons
    // e sombras (tipico de slides de filme antigo desbotado, referencia das
    // fotos de praia), mantendo realces mais quentes/amarelados e contraste
    // levemente suavizado.
    id: 'kodak_verde', nome: 'Kodak',
    uniforms: {
      uContrast: 0.92, uFade: 0.12, uSatShift: 0.85,
      uShadowTone_r: 0.55, uShadowTone_g: 0.62, uShadowTone_b: 0.42,
      uHighTone_r: 1.0, uHighTone_g: 0.93, uHighTone_b: 0.68
    },
    src: `
    uniform float uContrast, uFade, uSatShift;
    uniform float uShadowTone_r,uShadowTone_g,uShadowTone_b, uHighTone_r,uHighTone_g,uHighTone_b;
    void main() {
        vec3 c = texture(uSource, vUv).rgb;
        c = mix(c, vec3(0.5), uFade * 0.3);
        c = (c - 0.5) * uContrast + 0.5;
        c = clamp(c, 0.0, 1.0);
        float l = luma(c);
        vec3 shadowTone = vec3(uShadowTone_r,uShadowTone_g,uShadowTone_b);
        vec3 highTone = vec3(uHighTone_r,uHighTone_g,uHighTone_b);
        vec3 toned = mix(c * (shadowTone * 1.5), c * (highTone * 1.15), smoothstep(0.2, 0.85, l));
        c = mix(c, toned, 0.55);
        vec3 hsl = rgb2hsl(clamp(c, 0.0, 1.0));
        hsl.y *= uSatShift;
        hsl.x = mix(hsl.x, mod(hsl.x + (0.34 - hsl.x) * 0.18 + 1.0, 1.0), 0.5);
        outColor = vec4(clamp(hsl2rgb(hsl), 0.0, 1.0), 1.0);
    }`
  },

  {
    // Kodak P&B: conversao para preto-e-branco com curva de contraste forte
    // (tipo Ilford HP5 / Tri-X), leve tonalidade quente nas sombras (preto
    // nao 100% neutro, como no filme real) e grao sutil embutido para dar
    // corpo -- independente do controle global de Grain da aba Pixel.
    id: 'kodak_pb', nome: 'Kodak P&B',
    uniforms: { uContrast: 1.55, uBlackPoint: 0.04, uWhitePoint: 0.97, uWarmth: 0.06, uMicroGrain: 0.05 },
    src: `
    uniform float uContrast, uBlackPoint, uWhitePoint, uWarmth, uMicroGrain;
    void main() {
        vec3 c = texture(uSource, vUv).rgb;
        float l = luma(c);
        float s = (l - 0.5) * uContrast + 0.5;
        s = smoothstep(0.0, 1.0, clamp(s, 0.0, 1.0));
        s = clamp((s - uBlackPoint) / max(0.0001, (uWhitePoint - uBlackPoint)), 0.0, 1.0);
        float g = (hash(vUv*uResolution*2.2 + uAnimFrame*vec2(11.0, 19.0)) - 0.5) * uMicroGrain;
        s = clamp(s + g, 0.0, 1.0);
        vec3 warmBlack = vec3(0.05, 0.035, 0.02) * uWarmth;
        vec3 result = mix(warmBlack, vec3(1.0), s);
        outColor = vec4(clamp(result, 0.0, 1.0), 1.0);
    }`
  },

  {
    // Lumiere: efeito de matiz customizavel (roxo por padrao, referencia do
    // usuario). uHue (0-1, representando 0-360 graus) escolhe a cor de
    // aplicacao. A aplicacao NAO e uma tinta uniforme: dosa por luminancia
    // (mais forte nas sombras/meios-tons, mais fraca nas luzes) e gira o
    // matiz em HSL proporcionalmente a uAmount, preservando estrutura
    // tonal -- muda tons especificos em vez de pintar tudo de uma cor so.
    id: 'lumiere', nome: 'Lumiere',
    uniforms: { uHue: 0.78, uAmount: 0.5, uSpread: 0.6 },
    src: `
    uniform float uHue, uAmount, uSpread;
    void main() {
        vec3 c = texture(uSource, vUv).rgb;
        vec3 hsl = rgb2hsl(c);
        float l = hsl.z;
        float mask = 1.0 - smoothstep(0.35, 0.35 + uSpread * 0.6, l);
        mask = mix(mask, 1.0, 0.15);
        float strength = uAmount * mask;
        float dh = uHue - hsl.x;
        dh -= floor(dh + 0.5);
        hsl.x = fract(hsl.x + dh * strength * 0.9 + 1.0);
        hsl.y = clamp(hsl.y + strength * 0.22, 0.0, 1.0);
        hsl.z = clamp(l - strength * 0.05 * (1.0 - l), 0.0, 1.0);
        outColor = vec4(clamp(hsl2rgb(hsl), 0.0, 1.0), 1.0);
    }`
  },

  {
    // Vencido: simula filme fotografico vencido/expirado. uVariant (0-3)
    // escolhe entre 4 assinaturas de degradacao distintas:
    //   0 = Deslocamento Quente  -- vazamento de luz alaranjado, contraste
    //       reduzido, base amarelada
    //   1 = Nevoa Magenta        -- veu magenta/rosa por fog quimico, pretos
    //       levantados, saturacao reduzida
    //   2 = Deslocamento Frio    -- dominante ciano/azulado nas sombras,
    //       realces ainda quentes (degradacao de camada de cor desigual)
    //   3 = Desbotado & Granulado -- baixissimo contraste, cores lavadas,
    //       grao pesado e irregular
    id: 'vencido', nome: 'Vencido',
    uniforms: { uVariant: 0.0, uIntensity: 0.75, uLeak_r: 1.0, uLeak_g: 0.45, uLeak_b: 0.1 },
    src: `
    uniform float uVariant, uIntensity;
    uniform float uLeak_r, uLeak_g, uLeak_b;
    void main() {
        vec3 c = texture(uSource, vUv).rgb;
        vec2 uv = vUv;
        int v = int(uVariant + 0.5);
        vec3 result = c;

        if (v == 0) {
            float corner = hash(vec2(7.0, 3.0));
            vec2 leakPos = vec2(mix(0.0,1.0,step(0.5,corner)), mix(0.0,1.0,step(0.5,fract(corner*9.0))));
            float d = distance(uv, leakPos);
            float leak = smoothstep(0.9, 0.05, d) * 0.55;
            vec3 leakColor = vec3(uLeak_r, uLeak_g, uLeak_b);
            result = c * vec3(1.08, 0.98, 0.82);
            result = (result - 0.5) * 0.82 + 0.5;
            result = mix(result, result + leakColor, leak);
            result += (hash(uv*uResolution + uAnimFrame*vec2(17.0, 31.0)) - 0.5) * 0.05;
        } else if (v == 1) {
            vec3 hslv = rgb2hsl(c);
            hslv.y *= 0.65;
            hslv.z = mix(hslv.z, 0.5, 0.08);
            vec3 base = hsl2rgb(hslv);
            vec3 fog = vec3(0.85, 0.55, 0.7);
            result = mix(base, base + fog * 0.25, 0.5);
            result = mix(vec3(0.12,0.06,0.09), result, 0.94);
        } else if (v == 2) {
            float l = luma(c);
            vec3 shadowTone = vec3(0.55, 0.85, 0.9);
            vec3 highTone = vec3(1.0, 0.92, 0.78);
            vec3 toned = mix(c * shadowTone, c * highTone, smoothstep(0.25, 0.85, l));
            result = mix(c, toned, 0.6);
            result = (result - 0.5) * 0.9 + 0.5;
        } else {
            vec3 hslv = rgb2hsl(c);
            hslv.y *= 0.5;
            vec3 base = hsl2rgb(hslv);
            base = (base - 0.5) * 0.6 + 0.58;
            float coarse = hash(floor(uv*uResolution/2.0) + uAnimFrame*vec2(5.0, 3.0));
            float fine = hash(uv*uResolution*1.5 + uAnimFrame*vec2(13.0, 29.0));
            float grain = (coarse*0.6 + fine*0.4 - 0.5) * 0.16;
            result = base + grain;
            result = mix(result, result * vec3(1.05,1.0,0.9), 0.4);
        }

        outColor = vec4(clamp(mix(c, result, uIntensity), 0.0, 1.0), 1.0);
    }`
  },

  {
    id: 'vignette', nome: 'Vinheta',
    uniforms: { uRadius: 0.75, uSoftness: 0.45, uIntensity: 0.6, uColor_r: 0.0, uColor_g: 0.0, uColor_b: 0.0 },
    src: `
    uniform float uRadius, uSoftness, uIntensity;
    uniform float uColor_r, uColor_g, uColor_b;
    void main() {
        vec3 c = texture(uSource, vUv).rgb;
        vec2 aspect = uResolution.x > uResolution.y ? vec2(uResolution.x/uResolution.y, 1.0) : vec2(1.0, uResolution.y/uResolution.x);
        vec2 offset = (vUv - 0.5) * aspect;
        float dist = length(offset);
        float mask = smoothstep(uRadius - uSoftness, uRadius, dist) * uIntensity;
        vec3 vigColor = vec3(uColor_r, uColor_g, uColor_b);
        vec3 result = mix(c, vigColor, mask);
        outColor = vec4(clamp(result, 0.0, 1.0), 1.0);
    }`
  },

  {
    // Bloom: parente direto do "bokeh_blur" acima -- reaproveita o mesmo
    // padrão de 24 amostras radiais para o blur, mas em vez de PESAR e
    // MISTURAR os pixels (como o bokeh_blur faz), extrai antes uma máscara
    // de brilho (só pixels acima de uThreshold entram no blur) e depois
    // SOMA aditivamente esse glow borrado sobre a imagem nítida original,
    // multiplicado por uIntensity -- é literalmente um bokeh_blur restrito
    // às altas-luzes e aplicado como halo aditivo, não como substituição.
    id: 'bloom', nome: 'Bloom',
    uniforms: { uThreshold: 0.7, uRadius: 8.0, uIntensity: 1.2 },
    src: `
    uniform float uThreshold, uRadius, uIntensity;
    void main() {
        vec3 original = texture(uSource, vUv).rgb;
        vec2 texel = 1.0/uResolution;
        vec3 glowSum = vec3(0.0);
        float wsum = 0.0;
        const int SAMPLES = 24;
        for (int i = 0; i < SAMPLES; i++) {
            float a = float(i) / float(SAMPLES) * 6.28318;
            float r = sqrt(float(i) / float(SAMPLES));
            vec2 off = vec2(cos(a), sin(a)) * r * uRadius * texel;
            vec3 s = texture(uSource, vUv + off).rgb;
            float br = luma(s);
            float bright = max(0.0, br - uThreshold);
            glowSum += s * bright;
            wsum += 1.0;
        }
        vec3 bloomGlow = glowSum / max(wsum, 0.001);
        outColor = vec4(clamp(original + bloomGlow * uIntensity, 0.0, 1.0), 1.0);
    }`
  },


  
  
  
  
  
  
];

// ==========================================
// PixelarGPU — motor WebGL2 único do pipeline inteiro.
// Antes eram dois contextos (PixelarGL + PixelarFX) e o resultado
// ia e voltava da GPU a cada etapa (readPixels → rgbShift/grão em CPU
// → upload → efeito → readPixels → grão em CPU → putImageData).
// Agora todas as etapas rodam encadeadas em framebuffers no mesmo
// contexto, e o resultado final é desenhado direto no canvas de saída
// (drawImage do canvas WebGL) — sem cópia para a CPU no caminho comum.
//
//   fonte (textura, só reenviada quando muda)
//     → MAIN  (ajustes de cor + dither procedural + degradê + paleta/duotone)
//     → SHIFT (aberração RGB)            [opcional]
//     → FX    (efeito de textura + mix)  [opcional]
//     → GRAIN (granulado de filme)       [opcional]
//     → BLIT  (inverte Y para a tela)
//
// Todas as passadas trabalham em "espaço de imagem" (linha 0 = topo),
// igual ao buffer Uint8ClampedArray do fallback CPU; só o BLIT inverte.
// ==========================================
const GLSL_HASH = `
uvec3 pcg3d(uvec3 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    return v;
}
// hash estável 0..1 por (pixel inteiro, semente float) — mesma fórmula do JS (pcgHash)
float phash(ivec2 p, float s) { return float(pcg3d(uvec3(uvec2(p), floatBitsToUint(s))).x) / 4294967295.0; }
`;

const FILM_INT_UNIFORMS = new Set(['uSwap', 'uFrame', 'uStamp']);
const FILM_FX_IDS = ['kodak_verde', 'kodak_pb', 'lumiere', 'vencido'];
const LENS_FX_IDS = ['vignette', 'bloom', 'bokeh_blur', 'lens_distortion']; // viraram controles da Lente (Filtros)
const PixelarGPU = (function () {
    let gl = null, glCanvas = null;
    let initialized = false, ok = false, contextLost = false;
    let vao = null, maxTex = 4096;
    const progs = {};          // MAIN, SHIFT, GRAIN, BLIT
    const fxProgs = {};        // id do efeito -> programa
    let srcTex, gradTex, palTex, refPalTex;
    let srcKey = null, gradKey = null, palKey = null, refPalKey = null, palCount = 0;
    const targets = [];        // 2 alvos de ping-pong (textura + framebuffer)
    let tw = 0, th = 0, lastTarget = -1, edgeBase = false;

    const VS = `#version 300 es
    layout(location = 0) in vec2 aPos;
    out vec2 vUv;
    void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

    const MAIN_FS = `#version 300 es
    precision highp float; precision highp int;
    in vec2 vUv; out vec4 outColor;
    uniform sampler2D uSource, uGrad, uPalette, uRefPalette;
    // ajustes (mesma matemática do fallback CPU, em escala 0..255)
    uniform float uExp, uBr, uSh, uSat, uCont, uContFactor, uTemp, uPoster;
    uniform bool uInvert;
    // dither
    uniform int uDitherMode;         // 0 nenhum 1 halftone 2 ds(bayer4) 3 bayer8 4 floyd 5 xadrez 6 scanlines 7 ruído
    uniform float uDScale, uDStrength, uSin, uCos, uNoiseSeed;
    // animação (0 = imagem estática)
    uniform float uAnimT, uAnimAmt, uAnimFrame;
    // estilos de movimento do dither (0 = assinatura do padrão)
    uniform int uDStyle;
    uniform float uDAngle, uDWave, uDAmp;
    uniform vec2 uImgSize;
    uniform float uMinL, uMaxL;
    uniform bool uShadowsInverted, uMidDither, uUseGrad;
    uniform int uGradBlend;          // 0 normal 1 multiply 2 screen 3 overlay 4 color 5 darken 6 lighten 7 difference 8 soft light
    uniform float uGradAlpha;        // opacidade do degradê
    uniform int uColorMode;          // 0 livre 1 paleta 2 duotone/tritone
    uniform float uPaletteCount;
    uniform vec3 uDuo0, uDuo1, uDuo2;
    uniform int uDuoCount;
    ${GLSL_HASH}

    const int B4[16] = int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);
    const int B8[64] = int[64](0,32,8,40,2,34,10,42,48,16,56,24,50,18,58,26,12,44,4,36,14,46,6,38,60,28,52,20,62,30,54,22,3,35,11,43,1,33,9,41,51,19,59,27,49,17,57,25,15,47,7,39,13,45,5,37,63,31,55,23,61,29,53,21);
    const int FS4[16] = int[16](0,0,7,3,5,1,0,0,3,7,0,0,0,0,1,5);
    const float TAU = 6.28318530718;

    vec3 rgb2hsl(vec3 c) {
        float maxc = max(max(c.r, c.g), c.b), minc = min(min(c.r, c.g), c.b);
        float l = (maxc + minc) / 2.0, h = 0.0, s = 0.0;
        if (maxc != minc) {
            float d = maxc - minc;
            s = l > 0.5 ? d / (2.0 - maxc - minc) : d / (maxc + minc);
            if (maxc == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
            else if (maxc == c.g) h = (c.b - c.r) / d + 2.0;
            else h = (c.r - c.g) / d + 4.0;
            h /= 6.0;
        }
        return vec3(h, s, l);
    }
    float hue2rgb(float p, float q, float t) {
        if (t < 0.0) t += 1.0; if (t > 1.0) t -= 1.0;
        if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
        if (t < 0.5) return q;
        if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
        return p;
    }
    vec3 hsl2rgb(vec3 hsl) {
        if (hsl.y == 0.0) return vec3(hsl.z);
        float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
        float p = 2.0 * hsl.z - q;
        return vec3(hue2rgb(p, q, hsl.x + 1.0/3.0), hue2rgb(p, q, hsl.x), hue2rgb(p, q, hsl.x - 1.0/3.0));
    }

    vec3 adjust(vec3 c) {
        c = c * uExp + uBr;
        if (uCont != 0.0) c = uContFactor * (c - 128.0) + 128.0;
        if (uTemp != 0.0) { c.r += uTemp; c.b -= uTemp; }
        c = clamp(c, 0.0, 255.0);
        if (uInvert) c = 255.0 - c;
        float l = 0.3*c.r + 0.59*c.g + 0.11*c.b;
        if (uSat != 0.0) c = l + (c - l) * (1.0 + uSat);
        if (uSh != 0.0 && l < 128.0) c += uSh * (128.0 - l) / 128.0;
        if (uPoster > 0.0) { float n = uPoster - 1.0; c = floor(c / 255.0 * n + 0.5) * (255.0 / n); }
        return floor(clamp(c, 0.0, 255.0) + 0.5); // Uint8ClampedArray arredonda
    }

    // T = fase da animação (período 1). T = 0 → padrão estático original.
    float ditherAt(float x, float y, float T, float seed, bool anim) {
        float sc = uDScale;
        float sx = floor(x / sc), sy = floor(y / sc);
        if (uDitherMode == 1) {
            float size = max(2.0, sc * 3.0);
            float rx = x * uCos - y * uSin, ry = x * uSin + y * uCos;
            float cx = mod(abs(rx) + T * size, size) - size / 2.0;
            float cy = mod(abs(ry) + T * size, size) - size / 2.0;
            float pulse = 1.0 + 0.35 * sin(TAU * T);
            return ((sqrt(cx*cx + cy*cy) * pulse / (size / 1.5)) - 0.5) * 1.5;
        }
        if (uDitherMode == 2) {
            int v = (B4[int(mod(sy, 4.0)) * 4 + int(mod(sx, 4.0))] + int(floor(T * 16.0))) % 16;
            return (float(v) / 15.0 - 0.5) * 0.5;
        }
        if (uDitherMode == 3) {
            int v = (B8[int(mod(sy, 8.0)) * 8 + int(mod(sx, 8.0))] + int(floor(T * 64.0))) % 64;
            return (float(v) / 63.0 - 0.5) * 0.5;
        }
        if (uDitherMode == 4) {
            float o = floor(T * 4.0);
            return (float(FS4[int(mod(sy + o, 4.0)) * 4 + int(mod(sx + o, 4.0))]) / 16.0 - 0.5) * 0.6;
        }
        if (uDitherMode == 5) {
            float par = mod(sx + sy, 2.0) < 0.5 ? 1.0 : -1.0;
            if (!anim) return -0.3 * par;
            return -0.3 * par * cos(TAU * (T - (sx + sy) / 24.0)); // onda diagonal
        }
        if (uDitherMode == 6) {
            float sy2 = floor((y + T * 3.0 * sc) / sc);
            return mod(sy2, 3.0) < 0.5 ? -0.4 : 0.1;
        }
        if (uDitherMode == 7) return (phash(ivec2(x, y), seed) - 0.5) * 0.4;
        return 0.0;
    }

    // período do padrão (px) — deslocar por múltiplos inteiros dele fecha o loop sem emenda
    vec2 patPeriod() {
        float sc = uDScale;
        if (uDitherMode == 1) return vec2(max(2.0, sc * 3.0) * 1.41421356);
        if (uDitherMode == 2 || uDitherMode == 4) return vec2(4.0 * sc);
        if (uDitherMode == 3) return vec2(8.0 * sc);
        if (uDitherMode == 5) return vec2(2.0 * sc);
        if (uDitherMode == 6) return vec2(3.0 * sc);
        if (uDitherMode == 7) return vec2(64.0);
        return vec2(1.0);
    }
    // padrão estático "ladrilhável" (retícula sem espelho, ruído em bloco de 64 px)
    float patternAt(vec2 p, float seed) {
        if (uDitherMode == 1) {
            float size = max(2.0, uDScale * 3.0);
            float rx = p.x * uCos - p.y * uSin, ry = p.x * uSin + p.y * uCos;
            float cx = mod(rx, size) - size / 2.0, cy = mod(ry, size) - size / 2.0;
            return ((sqrt(cx*cx + cy*cy) / (size / 1.5)) - 0.5) * 1.5;
        }
        if (uDitherMode == 7) return (phash(ivec2(mod(floor(p), 64.0)), seed) - 0.5) * 0.4;
        return ditherAt(p.x, p.y, 0.0, seed, false);
    }
    mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
    float styledDither(float x, float y, float T, float seed, float frameSeed) {
        vec2 p = vec2(x, y) + 0.5;
        vec2 c = uImgSize * 0.5;
        vec2 P = patPeriod();
        float A = uDAmp, ph = TAU * T;
        float K = max(1.0, floor(A + 0.5));             // velocidade inteira (loop exato)
        vec2 dir = vec2(cos(uDAngle), sin(uDAngle));
        if (uDitherMode == 6) dir = vec2(-dir.y, dir.x); // linhas horizontais: movimento transversal
        vec2 PE = P * ceil(8.0 / max(P, vec2(1.0)));      // períodos minúsculos (xadrez) andam em saltos visíveis
        int s = uDStyle;
        if (s == 1) {       // deslizar
            vec2 d = vec2(abs(dir.x) > 0.38 ? sign(dir.x) : 0.0, abs(dir.y) > 0.38 ? sign(dir.y) : 0.0);
            p -= d * PE * T * K;
        } else if (s == 2) { // girar
            p = c + rot2(ph * K) * (p - c);
        } else if (s == 3) { // respirar (zoom)
            p = c + (p - c) / (1.0 + 0.4 * min(A, 2.5) * sin(ph));
        } else if (s == 4) { // ondular
            vec2 n = vec2(-dir.y, dir.x);
            p += dir * (P.x * 0.5 + 3.0) * A * sin(TAU * dot(p, n) / uDWave - ph);
        } else if (s == 5) { // ondas radiais
            vec2 v = p - c; float r = length(v);
            p += (r > 0.0 ? v / r : vec2(0.0)) * (P.x * 0.5 + 3.0) * A * sin(TAU * r / uDWave - ph);
        } else if (s == 6) { // redemoinho
            vec2 v = p - c; float r = length(v);
            p = c + rot2(A * 1.4 * sin(ph) * (1.0 - smoothstep(0.0, length(c), r))) * v;
        } else if (s == 7) { // cintilar
            float h = phash(ivec2(floor(p / max(P, vec2(1.0)))), seed + 17.0);
            return patternAt(p, seed) * (0.15 + (0.9 + 0.35 * A) * (0.5 + 0.5 * cos(ph + TAU * h)));
        } else if (s == 8) { // pulsar
            return patternAt(p, seed) * max(0.0, 1.0 + 0.9 * A * sin(ph));
        } else if (s == 9) { // varredura
            float band = fract(dot(p, dir) / uDWave - T);
            float m = smoothstep(0.0, 0.1, band) * (1.0 - smoothstep(0.25, 0.5, band));
            return patternAt(p, seed) * (0.1 + (1.0 + A) * m);
        } else if (s == 10) { // glitch
            float st = mod(floor(T * 8.0), 8.0);
            float row = floor(p.y / max(P.y, 4.0));
            if (uDitherMode == 6) row = floor(p.x / 6.0);
            if (phash(ivec2(row, st), seed + 3.0) > 0.78 - 0.12 * min(A, 3.0)) {
                float off = (phash(ivec2(row, st + 11.0), seed + 5.0) - 0.5) * 60.0 * A;
                if (uDitherMode == 6) p.y += off; else p.x += off;
            }
        } else if (s == 11) { // chuva
            float k = 1.0 + floor(phash(ivec2(floor(p.x / max(P.x, 2.0)), 7), seed + 9.0) * 3.0);
            p.y -= T * PE.y * k * K;
        } else if (s == 12) { // dissolver
            float h = phash(ivec2(floor(p / max(P, vec2(1.0)))), seed + 23.0);
            return patternAt(p, seed) * clamp(0.5 + (0.6 + 0.4 * A) * sin(ph + TAU * h) * 1.5, 0.0, 1.0 + 0.5 * A);
        } else if (s == 13) { // espiral
            vec2 v = p - c; float r = length(v);
            p = c + rot2(ph * K + TAU * r / uDWave * 0.25 * A * sin(ph)) * v;
        } else if (s == 14) { // tremer
            float st = mod(floor(T * 12.0), 12.0);
            p += (vec2(phash(ivec2(st, 1), seed), phash(ivec2(st, 2), seed)) - 0.5) * max(P, vec2(6.0)) * A;
        }
        return patternAt(p, seed);
    }

    void main() {
        ivec2 ip = ivec2(gl_FragCoord.xy);
        vec4 src = texelFetch(uSource, ip, 0);
        if (floor(src.a * 255.0 + 0.5) < 127.0) { outColor = vec4(0.0); return; }

        vec3 c = adjust(floor(src.rgb * 255.0 + 0.5));
        float luma = 0.3*c.r + 0.59*c.g + 0.11*c.b;
        float norm = (luma - uMinL) / ((uMaxL - uMinL) == 0.0 ? 1.0 : (uMaxL - uMinL));
        vec3 rgb = c;

        if (uShadowsInverted && norm < 0.45) rgb = 255.0 - rgb;

        float x = float(ip.x), y = float(ip.y);
        float factor = 0.0;
        if (uDitherMode != 0) {
            factor = ditherAt(x, y, 0.0, uNoiseSeed, false);
            if (uAnimAmt > 0.0) {
                // até 100%: mistura estático→animado; acima disso a força do padrão também pulsa
                float w = min(uAnimAmt, 1.0);
                float boost = 1.0 + max(uAnimAmt - 1.0, 0.0) * 0.5; // mais forte, sem pulsar
                float fa = uDStyle == 0 ? ditherAt(x, y, uAnimT, uNoiseSeed + uAnimFrame, true) : styledDither(x, y, uAnimT, uNoiseSeed, uAnimFrame);
                factor = mix(factor, fa * (uDStyle == 0 ? boost : 1.0), w);
            }
            factor *= uDStrength;
        }
        if (uMidDither && (norm < 0.25 || norm > 0.75)) factor = 0.0;
        if (factor != 0.0) rgb = clamp(rgb + factor * 120.0, 0.0, 255.0);

        if (uUseGrad) {
            // o degradê vem numa grade pequena e é interpolado aqui (é suave por natureza)
            vec3 g = floor(texture(uGrad, (vec2(ip) + 0.5) / uImgSize).rgb * 255.0 + 0.5);
            vec3 pre = rgb;
            if (uGradBlend == 1) rgb = rgb * g / 255.0;
            else if (uGradBlend == 2) rgb = 255.0 - (255.0 - rgb) * (255.0 - g) / 255.0;
            else if (uGradBlend == 3) rgb = mix(2.0 * rgb * g / 255.0, 255.0 - 2.0 * (255.0 - rgb) * (255.0 - g) / 255.0, step(128.0, rgb));
            else if (uGradBlend == 4) { vec3 ho = rgb2hsl(rgb / 255.0), hg = rgb2hsl(g / 255.0); rgb = floor(hsl2rgb(vec3(hg.x, hg.y, ho.z)) * 255.0 + 0.5); }
            else if (uGradBlend == 5) rgb = min(rgb, g);
            else if (uGradBlend == 6) rgb = max(rgb, g);
            else if (uGradBlend == 7) rgb = abs(rgb - g);
            else if (uGradBlend == 8) { vec3 a2 = rgb / 255.0, b2 = g / 255.0;
                rgb = floor(255.0 * mix(2.0 * a2 * b2 + a2 * a2 * (1.0 - 2.0 * b2), sqrt(a2) * (2.0 * b2 - 1.0) + 2.0 * a2 * (1.0 - b2), step(0.5, b2)) + 0.5); }
            else rgb = g;
            if (uGradAlpha < 1.0) rgb = floor(mix(pre, rgb, uGradAlpha) + 0.5);
        }

        if (uColorMode == 2) {
            // duotone/tritone: usa a luminância ANTES de inversão/dither (igual ao CPU)
            float t = clamp(luma / 255.0, 0.0, 1.0);
            vec3 dc = uDuoCount >= 3
                ? (t < 0.5 ? mix(uDuo0, uDuo1, t / 0.5) : mix(uDuo1, uDuo2, (t - 0.5) / 0.5))
                : mix(uDuo0, uDuo1, t);
            outColor = vec4(dc / 255.0, 1.0);
            return;
        }
        if (uColorMode == 1) {
            // mesma quantização 5 bits/canal da LUT CPU (r>>3 trunca)
            vec3 q5 = floor(floor(clamp(rgb, 0.0, 255.0)) / 8.0);
            vec3 q = q5 * 8.0 + floor(q5 / 4.0);
            float best = 1e9, bestIdx = 0.0;
            int count = int(uPaletteCount);
            for (int i = 0; i < 64; i++) {
                if (i >= count) break;
                vec3 d = q - texture(uRefPalette, vec2((float(i) + 0.5) / uPaletteCount, 0.5)).rgb * 255.0;
                float dist = dot(d, d);
                if (dist < best - 0.01) { best = dist; bestIdx = float(i); }
            }
            outColor = vec4(texture(uPalette, vec2((bestIdx + 0.5) / uPaletteCount, 0.5)).rgb, 1.0);
            return;
        }
        outColor = vec4(rgb / 255.0, 1.0);
    }`;

    const SHIFT_FS = `#version 300 es
    precision highp float; precision highp int;
    out vec4 outColor;
    uniform sampler2D uTex; uniform int uShift;
    void main() {
        ivec2 p = ivec2(gl_FragCoord.xy); int w = textureSize(uTex, 0).x;
        vec4 c = texelFetch(uTex, p, 0);
        if (p.x + uShift < w) c.r = texelFetch(uTex, ivec2(p.x + uShift, p.y), 0).r;
        if (p.x - uShift >= 0) c.b = texelFetch(uTex, ivec2(p.x - uShift, p.y), 0).b;
        outColor = c;
    }`;

    const GRAIN_FS = `#version 300 es
    precision highp float; precision highp int;
    out vec4 outColor;
    uniform sampler2D uTex;
    uniform float uStrength, uCell, uRough, uBias, uSpeckle, uSeed;
    uniform bool uMono;
    ${GLSL_HASH}
    void main() {
        ivec2 ip = ivec2(gl_FragCoord.xy);
        vec4 c = texelFetch(uTex, ip, 0);
        if (c.a == 0.0) { outColor = c; return; }
        vec3 d = floor(c.rgb * 255.0 + 0.5);
        float x = float(ip.x), y = float(ip.y);
        float s0 = uSeed * 91.7 + 1.0, s1 = uSeed * 91.7 + 37.0;
        float coarse = phash(ivec2(floor(x / uCell), floor(y / uCell)), s0);
        float n = (coarse * (1.0 - uRough) + phash(ip, s1) * uRough - 0.5) * 2.0;
        float clump = 1.0;
        if (uSpeckle > 0.0) {
            float cc = uCell * 6.0;
            if (phash(ivec2(floor(x / cc), floor(y / cc)), s0 + 5.0) > 1.0 - uSpeckle * 0.5) clump = 1.0 + uSpeckle * 2.5;
        }
        float l = (0.3*d.r + 0.59*d.g + 0.11*d.b) / 255.0;
        float lw = 1.0;
        if (uBias > 0.0) lw = 1.0 - l * uBias * 0.9; else if (uBias < 0.0) lw = 1.0 + (l - 1.0) * uBias * 0.9;
        if (uMono) d += n * uStrength * clump * max(0.15, lw);
        else d += (vec3(phash(ip, s1 + 11.0), phash(ip, s1 + 23.0), phash(ip, s1 + 41.0)) * 2.0 - 1.0) * uStrength * clump * lw;
        outColor = vec4(clamp(d, 0.0, 255.0) / 255.0, c.a);
    }`;

    // ==========================================
    // FILM — simulação de filme e câmera analógica/digital antiga.
    // Um único shader parametrizado: cada "look" (Kodachrome, Polaroid,
    // Super 8, CCD...) é só um conjunto de valores destes uniforms.
    // Ordem: moldura → tremor/lente → desfoque/nitidez → halação/bloom →
    // química de cor (misturada por uMix) → flash/vazamento/queima/vinheta →
    // vídeo/digital → grão/poeira/riscos → data carimbada.
    // ==========================================
    const FILM_FS = `#version 300 es
    precision highp float; precision highp int;
    out vec4 outColor;
    uniform sampler2D uTex;
    uniform vec2 uSize;
    uniform float uMix, uLookOn;
    uniform float uExposure, uContrast, uFade, uRoll, uSat, uTemp, uTint, uHue, uSplit, uCross, uBleach, uBW, uTone, uSwapAmt;
    uniform vec3 uShadowTint, uHighTint, uBase, uBWMix, uToneColor;
    uniform int uSwap;
    uniform float uHalation, uBloom, uSoft, uBlur, uSharpen, uVignette, uDistort, uChroma, uFlash;
    uniform vec3 uHalColor;
    uniform float uLeak, uLeakPos, uDust, uScratch, uBurn, uGrain, uGrainSize, uJpeg, uChromaNoise, uInterlace, uAutochrome;
    uniform vec3 uLeakColor, uVigColor;
    uniform int uFrame;
    uniform vec3 uFrameColor;
    uniform int uStamp;
    uniform vec4 uStampA;
    uniform vec2 uStampB;
    uniform vec3 uStampColor;
    uniform float uAnim, uAnimFrame, uWeave, uFlicker, uLeakDrift, uBurnAnim;
    ${GLSL_HASH}
    const float TAU = 6.28318530718;
    const int SEG[10] = int[10](63, 6, 91, 79, 102, 109, 125, 7, 127, 111);

    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    float h21(vec2 p, float s) { return phash(ivec2(floor(p)), s); }
    float vnoise(vec2 p, float s) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i, s), h21(i + vec2(1.0, 0.0), s), f.x), mix(h21(i + vec2(0.0, 1.0), s), h21(i + vec2(1.0, 1.0), s), f.x), f.y);
    }
    vec3 img(vec2 uv) { return texture(uTex, clamp(uv, vec2(0.0), vec2(1.0))).rgb; }
    vec3 hueRot(vec3 c, float a) {
        const mat3 toY = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
        const mat3 fromY = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
        vec3 y = toY * c; float cs = cos(a), sn = sin(a);
        y.yz = mat2(cs, sn, -sn, cs) * y.yz;
        return fromY * y;
    }
    float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
    float segD(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - 0.11; }
    float digitD(vec2 p, int d) {
        if (d < 0 || d > 9) return 1e3;
        int m = SEG[d]; float r = 1e3;
        if ((m & 1) != 0) r = min(r, segD(p, vec2(0.15, 0.0), vec2(0.85, 0.0)));
        if ((m & 2) != 0) r = min(r, segD(p, vec2(1.0, 0.15), vec2(1.0, 0.85)));
        if ((m & 4) != 0) r = min(r, segD(p, vec2(1.0, 1.15), vec2(1.0, 1.85)));
        if ((m & 8) != 0) r = min(r, segD(p, vec2(0.15, 2.0), vec2(0.85, 2.0)));
        if ((m & 16) != 0) r = min(r, segD(p, vec2(0.0, 1.15), vec2(0.0, 1.85)));
        if ((m & 32) != 0) r = min(r, segD(p, vec2(0.0, 0.15), vec2(0.0, 0.85)));
        if ((m & 64) != 0) r = min(r, segD(p, vec2(0.15, 1.0), vec2(0.85, 1.0)));
        return r;
    }

    void main() {
        vec2 frag = gl_FragCoord.xy;              // linha 0 = topo da imagem
        vec2 S = uSize;
        float m = min(S.x, S.y);

        // ---------- moldura: retângulo útil (em px) ----------
        float L = 0.0, R = 0.0, T = 0.0, B = 0.0, rad = 0.0, rough = 0.0;
        if (uFrame == 1) { L = R = T = 0.055 * m; B = 0.22 * m; }                  // Polaroid
        else if (uFrame == 2) { L = R = 0.07 * m; T = 0.1 * m; B = 0.24 * m; rad = 0.015 * m; }  // Instax
        else if (uFrame == 3) { T = B = 0.13 * S.y; L = R = 0.01 * S.x; }            // tira 35 mm
        else if (uFrame == 4) { L = R = 0.05 * m; T = B = 0.04 * m; rad = 0.09 * m; } // Super 8
        else if (uFrame == 5) { L = R = T = B = 0.035 * m; rough = 0.012 * m; }      // médio formato
        else if (uFrame == 6) { float hb = max(0.0, (S.y - S.x / 2.39) * 0.5); T = B = hb; } // Cinemascope
        else if (uFrame == 7) { L = R = T = B = 0.13 * m; rad = 0.03 * m; }          // moldura de slide
        else if (uFrame == 8) { L = R = T = B = 0.06 * m; rough = 0.008 * m; }       // papel antigo
        else if (uFrame == 9) { L = R = T = B = 0.03 * m; rough = 0.03 * m; }        // placa (ferrótipo)
        else if (uFrame == 10) { L = R = T = 0.05 * m; B = 0.05 * m; rad = 0.04 * m; } // cantos arredondados
        vec2 i0 = vec2(L, T), i1 = S - vec2(R, B);
        vec2 isz = max(i1 - i0, vec2(1.0));
        vec2 ic = (i0 + i1) * 0.5;
        float sd = sdBox(frag - ic, isz * 0.5, rad);
        if (rough > 0.0) sd += (vnoise(frag / (m * 0.02), 91.0) - 0.5) * rough * 2.0 + (vnoise(frag / (m * 0.004), 92.0) - 0.5) * rough * 0.6;
        if (uFrame != 0 && sd > 0.0) {
            vec3 fc = uFrameColor;
            // textura do papel/plástico
            fc *= 0.94 + 0.06 * vnoise(frag / 3.0, 71.0);
            if (uFrame == 3) {
                // furos de tracionamento
                float pitch = 0.075 * m, hw = 0.022 * m, hh = 0.035 * m;
                float cx = mod(frag.x, pitch) - pitch * 0.5;
                float yTop = T * 0.5, yBot = S.y - B * 0.5;
                float hole = min(sdBox(vec2(cx, frag.y - yTop), vec2(hw, hh * 0.5), 0.006 * m), sdBox(vec2(cx, frag.y - yBot), vec2(hw, hh * 0.5), 0.006 * m));
                if (hole < 0.0) fc = vec3(0.92, 0.9, 0.84);
            }
            if (uFrame == 8) fc = mix(fc, fc * vec3(0.93, 0.86, 0.72), vnoise(frag / (m * 0.1), 77.0) * 0.35);
            outColor = vec4(clamp(fc, 0.0, 1.0), 1.0);
            return;
        }
        vec2 iuv = (frag - i0) / isz;             // 0..1 dentro da foto

        // ---------- tremor de quadro (projetor) ----------
        if (uWeave > 0.0) {
            float ph = TAU * uAnim;
            iuv += vec2(sin(ph * 2.0 + 1.7) * 0.6 + sin(ph * 5.0) * 0.3, sin(ph * 3.0 + 0.4) + sin(ph * 7.0 + 2.1) * 0.4) * 0.0025 * uWeave;
        }

        // ---------- lente: distorção + aberração ----------
        vec2 cc = iuv - 0.5;
        float r2 = dot(cc, cc);
        vec2 duv = 0.5 + cc * (1.0 + uDistort * r2) / (1.0 + uDistort * 0.25);
        // coordenada de amostragem na textura inteira
        vec2 toTex = isz / S, offTex = i0 / S;
        #define TEX(u) (offTex + clamp(u, 0.0, 1.0) * toTex)
        vec3 col;
        if (uChroma > 0.0) {
            vec2 d = cc * uChroma * 0.02;
            col = vec3(img(TEX(duv + d)).r, img(TEX(duv)).g, img(TEX(duv - d)).b);
        } else col = img(TEX(duv));

        // ---------- foco: desfoque suave e bordas moles ----------
        float blurPx = (uSoft + uBlur * r2 * 5.0) * m * 0.004;
        if (blurPx > 0.35) {
            vec3 acc = col; float wsum = 1.0;
            for (int i = 0; i < 12; i++) {
                float a = float(i) * TAU / 12.0 + 0.2;
                float rr = (i % 2 == 0) ? 1.0 : 0.55;
                acc += img(TEX(duv + vec2(cos(a), sin(a)) * blurPx * rr / isz)); wsum += 1.0;
            }
            col = acc / wsum;
        }
        if (uSharpen > 0.0) {
            vec2 px = 1.0 / isz;
            vec3 b = (img(TEX(duv + vec2(px.x, 0.0))) + img(TEX(duv - vec2(px.x, 0.0))) + img(TEX(duv + vec2(0.0, px.y))) + img(TEX(duv - vec2(0.0, px.y)))) * 0.25;
            col += (col - b) * uSharpen * 2.2;
        }

        // ---------- halação (brilho avermelhado nas luzes) e bloom ----------
        if (uHalation > 0.0 || uBloom > 0.0) {
            vec3 glow = vec3(0.0);
            for (int i = 0; i < 16; i++) {
                float a = float(i) * TAU / 16.0 + 0.3;
                float rr = (float(i % 4) + 1.0) / 4.0;
                vec3 s = img(TEX(duv + vec2(cos(a), sin(a)) * rr * m * 0.035 / isz));
                glow += s * max(0.0, luma(s) - 0.68) / 0.32; // só as luzes fortes
            }
            glow /= 16.0;
            col += uHalColor * luma(glow) * uHalation * 1.6;
            col += glow * uBloom * 1.4;
        }

        // ---------- química do filme ----------
        if (uLookOn > 0.5) {
            vec3 src = col;
            vec3 c = col * pow(2.0, uExposure);
            c *= vec3(1.0 + uTemp * 0.14, 1.0 - uTint * 0.1, 1.0 - uTemp * 0.14) * vec3(1.0 + uTint * 0.03, 1.0, 1.0 + uTint * 0.05);
            if (uSwap == 1) {           // Aerochrome: folhagem (verde) vira vermelho, vermelho vira verde, verde vira azul
                float ir = clamp(c.g * 1.25 + max(0.0, c.g - max(c.r, c.b)) * 1.8 - c.b * 0.15, 0.0, 1.2);
                c = mix(c, vec3(ir, c.r * 0.95, c.g * 0.8 + c.b * 0.25), uSwapAmt);
            } else if (uSwap == 2) {    // LomoChrome Purple: verdes viram roxo, roxos viram verde
                float gw = clamp((c.g - max(c.r, c.b)) * 3.0, 0.0, 1.0);
                float pw = clamp((min(c.r, c.b) - c.g) * 3.0, 0.0, 1.0);
                vec3 s = hueRot(c, -2.6 * gw + 2.6 * pw);
                s = mix(s, vec3(c.r, c.b * 0.9, c.g * 0.6 + c.b * 0.5), 0.35);
                c = mix(c, s, uSwapAmt);
            } else if (uSwap == 3) {    // Technicolor 3 cores: separação de corantes
                vec3 t = vec3(c.r - (c.g + c.b) * 0.5, c.g - (c.r + c.b) * 0.5, c.b - (c.r + c.g) * 0.5);
                c = mix(c, c + t * 0.6, uSwapAmt);
            } else if (uSwap == 4) {    // Technicolor 2 cores: só laranja-avermelhado e ciano-esverdeado
                float gb = (c.g + c.b) * 0.5;
                c = mix(c, vec3(c.r, gb * 0.95, gb), uSwapAmt);
            }
            c = max(c, 0.0);
            if (uRoll > 0.0) c = c / (1.0 + c * uRoll) * (1.0 + uRoll);       // luzes comprimidas (negativo)
            c = 0.5 + (c - 0.5) * uContrast;
            if (uContrast > 1.0) c = mix(c, smoothstep(0.0, 1.0, c), (uContrast - 1.0) * 0.5);
            c = clamp(c, 0.0, 1.0);
            if (uCross > 0.0) c = mix(c, vec3(smoothstep(0.05, 0.95, c.r) * 1.05, pow(c.g, 0.85), c.b * 0.7 + 0.14), uCross);
            if (uBleach > 0.0) { float l = luma(c); vec3 bb = 0.5 + (mix(vec3(l), c, 0.4) - 0.5) * 1.4; c = mix(c, bb, uBleach); }
            float l = luma(c);
            c = mix(vec3(l), c, uSat);
            if (uHue != 0.0) c = hueRot(c, uHue);
            if (uBW > 0.0) { float g = dot(c, uBWMix) / max(1e-3, uBWMix.r + uBWMix.g + uBWMix.b); c = mix(c, vec3(g), uBW); }
            if (uTone > 0.0) {
                float g = luma(c);
                vec3 toned = g < 0.5 ? mix(vec3(0.02), uToneColor, g * 2.0) : mix(uToneColor, vec3(1.0), (g - 0.5) * 2.0);
                c = mix(c, toned, uTone);
            }
            float lum = luma(c);
            c += (uShadowTint - 0.5) * uSplit * (1.0 - smoothstep(0.0, 0.55, lum));
            c += (uHighTint - 0.5) * uSplit * smoothstep(0.45, 1.0, lum);
            c = mix(c, uBase + c * (1.0 - uBase), uFade);
            col = mix(src, clamp(c, 0.0, 1.0), uMix);
        }

        // ---------- autocromo: grãos de amido coloridos ----------
        if (uAutochrome > 0.0) {
            float hsel = h21(frag / 1.3, 55.0);
            vec3 dotc = hsel < 0.34 ? vec3(1.25, 0.55, 0.35) : hsel < 0.67 ? vec3(0.5, 1.2, 0.45) : vec3(0.55, 0.45, 1.3);
            col = mix(col, col * dotc, uAutochrome * 0.55);
        }
        // ---------- flash direto ----------
        if (uFlash > 0.0) {
            vec2 q = (iuv - vec2(0.5, 0.42)) * vec2(isz.x / min(isz.x, isz.y), isz.y / min(isz.x, isz.y));
            col *= 1.0 + uFlash * (1.2 * exp(-dot(q, q) * 5.0) - 0.45);
        }
        // ---------- vazamento de luz ----------
        if (uLeak > 0.0) {
            float ang = TAU * (uLeakPos + uLeakDrift * 0.08 * sin(TAU * uAnim));
            vec2 lp = 0.5 + vec2(cos(ang), sin(ang)) * 0.8;
            vec2 dv = iuv - lp;
            float d = length(dv);
            float leak = smoothstep(0.95, 0.0, d);
            leak += smoothstep(0.1, 0.0, abs(dot(dv, vec2(-sin(ang), cos(ang))))) * smoothstep(1.1, 0.2, d) * 0.7;
            leak *= 0.85 + 0.3 * uLeakDrift * sin(TAU * uAnim * 2.0 + 1.0);
            col = 1.0 - (1.0 - col) * (1.0 - clamp(uLeakColor * leak * uLeak, 0.0, 1.0));
        }
        // ---------- filme queimado nas bordas ----------
        if (uBurn > 0.0) {
            float e = max(abs(iuv.x - 0.5), abs(iuv.y - 0.5)) * 2.0;
            float n = vnoise(iuv * 5.0 + vec2(cos(TAU * uAnim), sin(TAU * uAnim)) * uBurnAnim * 0.8, 5.0); // trajetória circular → loop sem emenda
            float burn = smoothstep(0.72, 1.05, e + (n - 0.5) * 0.45);
            col = mix(col, vec3(1.0, 0.62, 0.22) * (1.1 + n * 0.3), burn * uBurn);
        }
        // ---------- vinheta ----------
        if (uVignette > 0.0) {
            vec2 v = (iuv - 0.5) * vec2(1.0, isz.y / isz.x) * 1.35;
            float vk = clamp(min(1.0, uVignette) * smoothstep(0.25, 0.95, length(v)) + max(0.0, uVignette - 1.0) * smoothstep(0.1, 0.8, length(v)) * 0.6, 0.0, 1.0);
            col = mix(col, uVigColor, vk); // cor da vinheta configurável
        }
        // ---------- cintilação do projetor ----------
        if (uFlicker > 0.0) col *= 1.0 + uFlicker * (phash(ivec2(int(uAnimFrame), 3), 11.0) - 0.5) * 0.16;
        // ---------- vídeo e digital ----------
        if (uJpeg > 0.0) {
            vec2 blk = (floor(iuv * isz / 8.0) * 8.0 + 4.0) / isz;
            col = mix(col, mix(col, img(TEX(blk)), 0.55), uJpeg);
            col = mix(col, floor(col * 24.0 + 0.5) / 24.0, uJpeg * 0.6);
        }
        if (uInterlace > 0.0) col *= 1.0 - uInterlace * 0.22 * step(0.5, fract(frag.y * 0.5 + uAnimFrame * 0.5));
        if (uChromaNoise > 0.0) {
            float sh = 1.0 - smoothstep(0.0, 0.6, luma(col));
            col += (vec3(h21(frag, 1.0 + uAnimFrame), h21(frag, 2.0 + uAnimFrame), h21(frag, 3.0 + uAnimFrame)) - 0.5) * uChromaNoise * 0.3 * (0.3 + sh);
        }
        // ---------- grão de filme (mais forte nos meios-tons) ----------
        if (uGrain > 0.0) {
            vec2 gp = frag / max(1.0, uGrainSize);
            float n = vnoise(gp, 7.0 + uAnimFrame) + vnoise(gp * 2.3, 13.0 + uAnimFrame) * 0.5 - 0.75;
            float l = luma(col);
            col += n * uGrain * 0.4 * (0.35 + 0.65 * (1.0 - abs(l - 0.5) * 2.0));
        }
        // ---------- poeira e riscos ----------
        if (uDust > 0.0) {
            float sd2 = h21(frag / max(1.0, m * 0.004), 31.0 + uAnimFrame);
            if (sd2 > 1.0 - uDust * 0.006) col = mix(col, (h21(frag, 33.0 + uAnimFrame) > 0.5) ? vec3(0.95) : vec3(0.04), 0.85);
            float hair = abs(sin(iuv.x * 17.0 + vnoise(iuv * 3.0, 41.0 + floor(uAnimFrame / 4.0)) * 9.0) * 0.5 + 0.5 - iuv.y);
            if (h21(vec2(floor(uAnimFrame / 4.0), 1.0), 47.0) < uDust * 0.6) col = mix(col, vec3(0.05), (1.0 - smoothstep(0.0, 1.5 / isz.y, hair)) * 0.6);
        }
        if (uScratch > 0.0) {
            float cx = floor(iuv.x * 300.0);
            float s = h21(vec2(cx, floor(uAnimFrame / 2.0)), 57.0);
            if (s > 1.0 - uScratch * 0.012) col = mix(col, vec3(0.92), 0.55 * vnoise(vec2(cx, iuv.y * 30.0), 3.0));
        }
        // ---------- data carimbada (display de 7 segmentos) ----------
        if (uStamp == 1) {
            float u = max(2.2, 0.026 * min(isz.x, isz.y));
            vec2 br = i1 - vec2(0.05, 0.05) * min(isz.x, isz.y);
            float cw = 1.75;
            vec2 p = (frag - (br - vec2(cw * 9.0 * u, 2.0 * u))) / u;
            p.x += (2.0 - p.y) * 0.12;
            int ci = int(floor(p.x / cw));
            if (ci >= 0 && ci < 9 && p.y > -0.5 && p.y < 2.5) {
                vec2 lp = vec2(p.x - float(ci) * cw, p.y);
                float d2 = 1e3;
                if (ci == 0) d2 = segD(lp, vec2(0.7, 0.0), vec2(0.55, 0.45));
                else {
                    int dg = ci == 1 ? int(uStampA.x) : ci == 2 ? int(uStampA.y) : ci == 4 ? int(uStampA.z) : ci == 5 ? int(uStampA.w) : ci == 7 ? int(uStampB.x) : ci == 8 ? int(uStampB.y) : -1;
                    d2 = digitD(lp, dg);
                }
                float core = 1.0 - smoothstep(0.0, 1.0 / u, d2);
                float glow = exp(-max(d2, 0.0) * 2.5) * 0.45;
                col = mix(col, uStampColor * (1.0 + core * 0.2), clamp(core + glow * (1.0 - core), 0.0, 1.0));
            }
        }
        // transparência: a foto mantém o alfa original; a moldura (retornada antes) é opaca
        outColor = vec4(clamp(col, 0.0, 1.0), texture(uTex, TEX(duv)).a);
    }`;

    // BLIT: inverte Y para a tela e aplica as camadas globais da animação
    // (câmera e cor) — funções periódicas, então o loop continua sem emenda
    const BLIT_FS = `#version 300 es
    precision highp float; precision highp int;
    out vec4 outColor;
    uniform sampler2D uTex;
    uniform int uCamMode, uColMode, uColWave, uColTarget, uColSweep;
    uniform float uCamT, uCamAmt, uColT, uColAmt, uColSweepScale;
    uniform vec3 uColColor;
    ${GLSL_HASH}
    const float TAU = 6.28318530718;
    mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
    // forma da onda da cor animada (todas com período 1 → loop sem emenda)
    float colWave(float t, int w) {
        if (w == 1) return 4.0 * abs(fract(t - 0.25) - 0.5) - 1.0;   // triângulo
        if (w == 2) return 2.0 * fract(t) - 1.0;                     // dente de serra
        if (w == 3) return step(0.5, fract(t)) * 2.0 - 1.0;          // quadrada
        if (w == 4) return pow(0.5 + 0.5 * cos(TAU * t), 8.0) * 2.0 - 1.0; // batida
        return sin(TAU * t);                                         // senoide
    }
    vec3 hueRotYIQ(vec3 c, float a) {
        const mat3 toY = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
        const mat3 fromY = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
        vec3 y = toY * c; y.yz = rot2(a) * y.yz; return fromY * y;
    }
    void main() {
        ivec2 size = textureSize(uTex, 0);
        vec2 sz = vec2(size), c = sz * 0.5;
        vec2 q = vec2(gl_FragCoord.x, sz.y - gl_FragCoord.y);
        if (uCamMode != 0) {
            float ph = TAU * uCamT, A = uCamAmt, m = min(sz.x, sz.y);
            if (uCamMode == 1) {        // tremor de câmera na mão
                vec2 o = vec2(sin(ph * 3.0 + 1.3) + 0.5 * sin(ph * 7.0 + 0.2), cos(ph * 2.0 + 0.7) + 0.5 * sin(ph * 5.0 + 2.9)) * m * 0.006 * A;
                q = c + (q - c - o) / (1.0 + 0.02 * A);
            } else if (uCamMode == 2) { // zoom respirando
                q = c + (q - c) / (1.0 + 0.08 * A * (0.5 - 0.5 * cos(ph)));
            } else if (uCamMode == 3) { // órbita
                vec2 o = vec2(cos(ph), sin(ph)) * m * 0.02 * A;
                q = c + (q - c - o) / (1.0 + 0.05 * A);
            } else if (uCamMode == 4) { // balanço
                q = c + rot2(0.04 * A * sin(ph)) * (q - c) / (1.0 + 0.06 * A);
            } else if (uCamMode == 5) { // ondulação de fita
                q.x += sin(TAU * q.y / (sz.y * 0.3) + ph) * m * 0.012 * A;
            } else if (uCamMode == 6) { // solavancos
                float st = mod(floor(uCamT * 6.0), 6.0);
                vec2 o = (vec2(phash(ivec2(st, 1), 3.0), phash(ivec2(st, 2), 3.0)) - 0.5) * m * 0.03 * A;
                q = c + (q - c - o) / (1.0 + 0.03 * A);
            } else if (uCamMode == 7) { // zoom pulsado (batida)
                float k = pow(0.5 + 0.5 * cos(ph), 8.0);
                q = c + (q - c) / (1.0 + 0.1 * A * k);
            } else if (uCamMode == 8) { // deriva lateral (vai e volta)
                q.x += sin(ph) * m * 0.03 * A;
                q = c + (q - c) / (1.0 + 0.07 * A);
            }
        }
        vec4 col = texelFetch(uTex, clamp(ivec2(floor(q)), ivec2(0), size - 1), 0);
        if (uColMode != 0 && col.a > 0.0) {
            float B = uColAmt;
            vec3 rgb = col.rgb, src = rgb;
            float l = dot(rgb, vec3(0.299, 0.587, 0.114));
            // varredura: adianta a fase conforme a posição do pixel
            float sp = 0.0;
            if (uColSweep == 1) sp = q.y / sz.y;
            else if (uColSweep == 2) sp = q.x / sz.x;
            else if (uColSweep == 3) sp = length((q - c) / min(sz.x, sz.y)) * 2.0;
            else if (uColSweep == 4) sp = (q.x / sz.x + q.y / sz.y) * 0.5;
            float t = uColT + sp * uColSweepScale;
            float sw = colWave(t, uColWave);          // -1..1
            float u01 = 0.5 + 0.5 * sw;               // 0..1
            float ph = (uColWave == 0 || uColWave == 2) ? TAU * t : TAU * u01; // giro contínuo x vai-e-volta
            if (uColMode == 1) {        // girar matiz
                rgb = mix(rgb, hueRotYIQ(rgb, ph), min(B, 1.0));
            } else if (uColMode == 2) { // pulsar brilho
                rgb *= 1.0 + 0.35 * B * sw;
            } else if (uColMode == 3) { // pulsar saturação
                rgb = mix(vec3(l), rgb, max(0.0, 1.0 + 0.9 * B * sw));
            } else if (uColMode == 4) { // piscar (negativo)
                rgb = mix(rgb, 1.0 - rgb, step(0.55, u01) * min(B, 1.0));
            } else if (uColMode == 5) { // dia e noite
                rgb *= mix(vec3(1.0), vec3(0.7, 0.85, 1.3), u01 * min(B, 1.5));
            } else if (uColMode == 6) { // contraste pulsando
                rgb = (rgb - 0.5) * max(0.0, 1.0 + 0.6 * B * sw) + 0.5;
            } else if (uColMode == 7) { // arco-íris por altura
                rgb = mix(rgb, hueRotYIQ(rgb, ph + TAU * q.y / sz.y), min(B, 1.0));
            } else if (uColMode == 8) { // temperatura (quente ↔ frio)
                rgb *= mix(vec3(1.0), vec3(1.0 + 0.3 * sw, 1.0 + 0.04 * sw, 1.0 - 0.3 * sw), min(B, 1.5));
            } else if (uColMode == 9) { // tingir com a cor escolhida
                rgb = mix(rgb, mix(rgb, uColColor * (0.35 + l), 0.9), u01 * min(B, 1.0));
            } else if (uColMode == 10) { // duotone pulsante
                rgb = mix(rgb, mix(vec3(0.03), uColColor, sqrt(l)), u01 * min(B, 1.0));
            } else if (uColMode == 11) { // posterizar pulsando
                float lv = max(2.0, mix(24.0, 2.0, u01 * min(B, 1.0)));
                rgb = floor(rgb * lv + 0.5) / lv;
            } else if (uColMode == 12) { // solarização correndo
                float th = u01;
                rgb = mix(rgb, 1.0 - rgb, smoothstep(th - 0.1, th + 0.1, l) * min(B, 1.0));
            } else if (uColMode == 13) { // trocar canais (R→G→B)
                float sN = 3.0 * fract(t), ki = floor(sN), f = sN - ki;
                f = f * f * (3.0 - 2.0 * f);
                vec3 a1 = ki < 1.0 ? rgb.rgb : (ki < 2.0 ? rgb.gbr : rgb.brg);
                vec3 b1 = ki < 1.0 ? rgb.gbr : (ki < 2.0 ? rgb.brg : rgb.rgb);
                rgb = mix(rgb, mix(a1, b1, f), min(B, 1.0));
            } else if (uColMode == 14) { // neon nas luzes
                rgb = mix(vec3(l), rgb, 1.0 + 0.9 * B * u01);
                rgb += uColColor * smoothstep(0.6, 1.0, l) * 0.7 * B * u01;
            } else if (uColMode == 15) { // desbotar e voltar
                rgb = mix(rgb, mix(rgb, uColColor, 0.45) * 0.8 + 0.14, u01 * min(B, 1.0));
            } else if (uColMode == 16) { // vinheta de cor pulsando
                float vg = smoothstep(0.35, 1.1, length((q - c) / min(sz.x, sz.y) * 2.2));
                rgb = mix(rgb, uColColor * (0.2 + l), vg * u01 * min(B, 1.0));
            } else if (uColMode == 17) { // sombras e luzes girando (split tone)
                vec3 sh = 0.5 + 0.5 * vec3(cos(ph), cos(ph + 2.0944), cos(ph + 4.1888));
                rgb += (sh - 0.5) * 0.6 * B * (1.0 - smoothstep(0.0, 0.6, l));
                rgb += (0.5 - sh) * 0.6 * B * smoothstep(0.4, 1.0, l);
            } else if (uColMode == 18) { // cintilar em blocos (glitch de cor)
                float bs = max(4.0, sz.y / 14.0);
                vec2 bi = floor(q / bs);
                float st = floor(fract(t) * 8.0);
                float hsel = phash(ivec2(int(bi.x) + int(st) * 37, int(bi.y) + int(st) * 11), 7.0);
                if (hsel > 1.0 - 0.6 * min(B, 1.0)) rgb = hueRotYIQ(rgb, hsel * TAU);
            } else if (uColMode == 19) { // sépia e volta
                rgb = mix(rgb, vec3(l) * vec3(1.15, 0.95, 0.72), u01 * min(B, 1.0));
            } else if (uColMode == 20) { // gama respirando
                rgb = pow(max(rgb, 0.0), vec3(clamp(1.0 + 0.55 * B * sw, 0.2, 3.0)));
            }
            // onde aplica: imagem toda, sombras, meios-tons ou luzes
            float mk = 1.0;
            if (uColTarget == 1) mk = 1.0 - smoothstep(0.05, 0.55, l);
            else if (uColTarget == 2) mk = 1.0 - abs(l - 0.5) * 2.0;
            else if (uColTarget == 3) mk = smoothstep(0.45, 0.95, l);
            col.rgb = clamp(mix(src, rgb, clamp(mk, 0.0, 1.0)), 0.0, 1.0);
        }
        outColor = col;
    }`;

    // MESCLAGEM DE CAMADA: base (o que veio antes) + camada (resultado do efeito),
    // com modo de mesclagem e opacidade. uUseAlpha: a camada traz a própria cobertura no alfa (contorno).
    const BLEND_FS = `#version 300 es
    precision highp float; precision highp int;
    out vec4 outColor;
    uniform sampler2D uBase, uLayer;
    uniform int uMode, uUseAlpha;
    uniform float uOp;
    vec3 rgb2hsl_(vec3 c) {
        float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), l = (mx + mn) * 0.5, d = mx - mn;
        if (d < 1e-5) return vec3(0.0, 0.0, l);
        float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn), h;
        if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0); else if (mx == c.g) h = (c.b - c.r) / d + 2.0; else h = (c.r - c.g) / d + 4.0;
        return vec3(h / 6.0, s, l);
    }
    vec3 hsl2rgb_(vec3 h) { vec3 k = clamp(abs(mod(h.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return h.z + h.y * (k - 0.5) * (1.0 - abs(2.0 * h.z - 1.0)); }
    void main() {
        ivec2 p = ivec2(gl_FragCoord.xy);
        vec4 b = texelFetch(uBase, p, 0), l = texelFetch(uLayer, p, 0);
        vec3 a = b.rgb, c = l.rgb, r = c;
        if (uMode == 1) r = a * c;
        else if (uMode == 2) r = 1.0 - (1.0 - a) * (1.0 - c);
        else if (uMode == 3) r = mix(2.0 * a * c, 1.0 - 2.0 * (1.0 - a) * (1.0 - c), step(0.5, a));
        else if (uMode == 4) { vec3 ho = rgb2hsl_(a), hc = rgb2hsl_(c); r = hsl2rgb_(vec3(hc.x, hc.y, ho.z)); }
        else if (uMode == 5) r = min(a, c);
        else if (uMode == 6) r = max(a, c);
        else if (uMode == 7) r = abs(a - c);
        else if (uMode == 8) r = mix(2.0 * a * c + a * a * (1.0 - 2.0 * c), sqrt(a) * (2.0 * c - 1.0) + 2.0 * a * (1.0 - c), step(0.5, c));
        float k = uOp * (uUseAlpha == 1 ? l.a : 1.0);
        outColor = vec4(clamp(mix(a, r, k), 0.0, 1.0), uUseAlpha == 1 ? b.a : l.a);
    }`;

    // DEGRADÊ como camada: só a cor do degradê (a mesclagem é feita pela passada BLEND)
    const GRADL_FS = `#version 300 es
    precision highp float; precision highp int;
    out vec4 outColor;
    uniform sampler2D uTex, uGrad; uniform vec2 uImgSize;
    void main() {
        ivec2 ip = ivec2(gl_FragCoord.xy);
        outColor = vec4(texture(uGrad, (vec2(ip) + 0.5) / uImgSize).rgb, texelFetch(uTex, ip, 0).a);
    }`;

    // CONTORNO: desenhado direto na resolução de saída, a partir da imagem final da GPU.
    // Para cada pixel de saída, verifica se está a menos de meia espessura de uma divisa
    // entre dois pixels da arte com cores diferentes (mesmo critério do antigo desenho em CPU).
    const EDGE_FS = `#version 300 es
    precision highp float; precision highp int;
    out vec4 outColor;
    uniform sampler2D uTex;
    uniform vec2 uOut; uniform float uScale, uHalf; uniform vec4 uColor; uniform int uFlip;
    bool differs(ivec2 p, ivec2 q) {
        ivec2 sz = textureSize(uTex, 0);
        if (p.x < 0 || p.y < 0 || q.x >= sz.x || q.y >= sz.y) return false;
        vec3 a = texelFetch(uTex, p, 0).rgb, b = texelFetch(uTex, q, 0).rgb;
        vec3 d = abs(a - b) * 255.0;
        return d.r + d.g + d.b > 40.0;
    }
    void main() {
        vec2 q = uFlip == 1 ? vec2(gl_FragCoord.x, uOut.y - gl_FragCoord.y) : gl_FragCoord.xy;   // centro do pixel de saída
        ivec2 a = ivec2(floor(q / uScale));
        float xr = float(a.x + 1) * uScale - q.x, xl = q.x - float(a.x) * uScale;
        float yb = float(a.y + 1) * uScale - q.y, yt = q.y - float(a.y) * uScale;
        // cobertura antisserrilhada de uma linha de largura 2·uHalf (como o canvas faz com retângulos)
        float c = 0.0;
        if (differs(a, a + ivec2(1, 0))) c = max(c, clamp(uHalf + 0.5 - xr, 0.0, 1.0));
        if (differs(a - ivec2(1, 0), a)) c = max(c, clamp(uHalf + 0.5 - xl, 0.0, 1.0));
        if (differs(a, a + ivec2(0, 1))) c = max(c, clamp(uHalf + 0.5 - yb, 0.0, 1.0));
        if (differs(a - ivec2(0, 1), a)) c = max(c, clamp(uHalf + 0.5 - yt, 0.0, 1.0));
        c = min(c, 2.0 * uHalf);   // linhas mais finas que 1 px ficam proporcionalmente mais claras
        outColor = vec4(uColor.rgb, uColor.a * c);
    }`;

    function compile(type, src) {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src); gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(sh); gl.deleteShader(sh); throw new Error('Shader: ' + log); }
        return sh;
    }
    function link(fsSrc) {
        const p = gl.createProgram();
        const vs = compile(gl.VERTEX_SHADER, VS), fs = compile(gl.FRAGMENT_SHADER, fsSrc);
        gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
        gl.deleteShader(vs); gl.deleteShader(fs);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(p));
        const loc = {};
        const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; loc[name] = gl.getUniformLocation(p, name); }
        return { p, loc };
    }
    function newTex(filter) {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return t;
    }

    function setup() {
        for (const k in fxProgs) delete fxProgs[k];
        targets.length = 0; tw = th = 0;
        srcKey = gradKey = palKey = refPalKey = null;
        maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        progs.MAIN = link(MAIN_FS); progs.SHIFT = link(SHIFT_FS);
        progs.GRAIN = link(GRAIN_FS); progs.BLIT = link(BLIT_FS); progs.FILM = link(FILM_FS); progs.EDGE = link(EDGE_FS);
        progs.BLEND = link(BLEND_FS); progs.GRADL = link(GRADL_FS);
        srcTex = newTex(gl.NEAREST); gradTex = newTex(gl.LINEAR);
        palTex = newTex(gl.NEAREST); refPalTex = newTex(gl.NEAREST);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.disable(gl.BLEND);
    }

    function init() {
        if (initialized) return ok;
        initialized = true;
        glCanvas = document.createElement('canvas');
        // preserveDrawingBuffer desligado: o resultado é sempre copiado na mesma tarefa em que é desenhado,
        // e sem a cópia extra o canvas usa metade da memória (importante no iPhone)
        gl = glCanvas.getContext('webgl2', { premultipliedAlpha: false, alpha: true, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
        if (!gl) return (ok = false);
        glCanvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); contextLost = true; console.warn('[PixelarGPU] contexto perdido'); if (typeof window.onGpuLost === 'function') window.onGpuLost(); });
        glCanvas.addEventListener('webglcontextrestored', () => {
            try { setup(); contextLost = false; if (typeof window.onGpuRestored === 'function') window.onGpuRestored(); }
            catch (e) { console.warn('[PixelarGPU] falha ao restaurar:', e); }
        });
        try { setup(); ok = true; } catch (e) { console.warn('[PixelarGPU] indisponível:', e); ok = false; }
        return ok;
    }

    function isAvailable() { if (!initialized) init(); return ok && !contextLost; }
    function fits(w, h) { return w <= maxTex && h <= maxTex; }

    function ensureTargets(w, h) {
        if (tw === w && th === h && targets.length === 4) return;
        for (const t of targets) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
        targets.length = 0;
        for (let i = 0; i < 4; i++) {   // 0–2: rodízio das camadas; 3: cópia da base (contorno)
            const tex = newTex(gl.LINEAR); // LINEAR: efeitos FX amostram coordenadas fracionárias
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            const fbo = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
            targets.push({ tex, fbo });
        }
        tw = w; th = h;
    }

    function bindTex(unit, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }

    // executa uma passada: lê de inputTex (unidade 0) e escreve em targets[out] (ou na tela se out < 0)
    function pass(prog, inputTex, out, setUniforms) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, out >= 0 ? targets[out].fbo : null);
        gl.viewport(0, 0, tw, th);
        gl.useProgram(prog.p);
        if (inputTex) { bindTex(0, inputTex); if (prog.loc.uTex) gl.uniform1i(prog.loc.uTex, 0); if (prog.loc.uSource) gl.uniform1i(prog.loc.uSource, 0); }
        setUniforms && setUniforms(prog.loc);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function uploadPalette(tex, palette) {
        const n = Math.max(1, palette.length);
        const data = new Uint8Array(n * 4);
        palette.forEach((c, i) => { data[i*4] = c.r; data[i*4+1] = c.g; data[i*4+2] = c.b; data[i*4+3] = 255; });
        bindTex(0, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, n, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }

    function getFx(id) {
        if (fxProgs[id]) return fxProgs[id];
        const def = PIXELAR_FX_LIST.find(f => f.id === id);
        if (!def) return null;
        // o main() do efeito vira fxMain(); o novo main() aplica a intensidade (mix)
        const body = def.src.replace(/void\s+main\s*\(\s*\)/, 'void fxMain()');
        const src = PIXELAR_FX_COMMON + body + `
        uniform float uFxMix;
        void main() {
            vec4 srcC = texture(uSource, vUv);
            fxMain();
            if (uFxMix < 1.0) outColor = vec4(mix(srcC.rgb, outColor.rgb, uFxMix), 1.0);
            outColor.a = srcC.a; // mantém a transparência da imagem original
        }`;
        fxProgs[id] = Object.assign(link(src), { def });
        return fxProgs[id];
    }

    const GRAD_BLEND_IDS = { normal: 0, multiply: 1, screen: 2, overlay: 3, color: 4, darken: 5, lighten: 6, difference: 7, softlight: 8 };
    const DITHER_IDS = { none: 0, halftone: 1, nintendo_ds: 2, bayer8: 3, floyd_approx: 4, checkerboard: 5, scanlines: 6, noise: 7 };

    // o: ver renderFrame() — retorna true se renderizou (resultado em glCanvas, tamanho w x h)
    function render(o) {
        if (!isAvailable() || !fits(o.w, o.h)) return false;
        try {
            const { w, h } = o;
            // Redimensionar o canvas WebGL custa ~100 ms: ele só cresce (em blocos de 256 px)
            // e cada render ocupa o canto inferior esquerdo (ver region()).
            if (glCanvas.width < w || glCanvas.height < h) {
                glCanvas.width = Math.min(maxTex, Math.max(glCanvas.width, Math.ceil(w / 256) * 256));
                glCanvas.height = Math.min(maxTex, Math.max(glCanvas.height, Math.ceil(h / 256) * 256));
            }
            ensureTargets(w, h);
            gl.bindVertexArray(vao);

            if (o.srcKey === null || o.srcKey !== srcKey) {
                bindTex(0, srcTex);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, o.srcCanvas);
                srcKey = o.srcKey;
            }
            if (o.grad && o.grad.key !== gradKey) {
                bindTex(0, gradTex);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, o.grad.w, o.grad.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(o.grad.d.buffer, o.grad.d.byteOffset, o.grad.d.length));
                gradKey = o.grad.key;
            }
            const cm = o.color;
            if (cm.mode === 1) {
                if (cm.paletteHash !== palKey) { uploadPalette(palTex, cm.palette); palKey = cm.paletteHash; palCount = cm.palette.length; }
                if (cm.refHash !== refPalKey) { uploadPalette(refPalTex, cm.refPalette); refPalKey = cm.refHash; }
            }

            const a = o.adj, dt = o.dither, an = o.anim || { T: 0, amt: 0, frame: 0 };
            // MAIN → alvo 0
            bindTex(1, gradTex); bindTex(2, palTex); bindTex(3, refPalTex);
            pass(progs.MAIN, srcTex, 0, (L) => {
                gl.uniform1i(L.uGrad, 1); gl.uniform1i(L.uPalette, 2); gl.uniform1i(L.uRefPalette, 3);
                gl.uniform1f(L.uExp, a.exp); gl.uniform1f(L.uBr, a.br); gl.uniform1f(L.uSh, a.sh);
                gl.uniform1f(L.uSat, a.sat); gl.uniform1f(L.uCont, a.cont); gl.uniform1f(L.uContFactor, a.contFactor);
                gl.uniform1f(L.uTemp, a.temp); gl.uniform1f(L.uPoster, a.poster); gl.uniform1i(L.uInvert, a.invert ? 1 : 0);
                gl.uniform1i(L.uDitherMode, DITHER_IDS[dt.mode] || 0);
                gl.uniform1f(L.uDScale, Math.max(1, dt.scale)); gl.uniform1f(L.uDStrength, dt.strength);
                gl.uniform1f(L.uSin, Math.sin(Math.PI / 4)); gl.uniform1f(L.uCos, Math.cos(Math.PI / 4));
                gl.uniform1f(L.uNoiseSeed, dt.noiseSeed || 0);
                gl.uniform1f(L.uAnimT, an.T); gl.uniform1f(L.uAnimAmt, an.amt); gl.uniform1f(L.uAnimFrame, an.frame);
                gl.uniform1i(L.uDStyle, an.dStyle || 0); gl.uniform1f(L.uDAngle, an.dAngle || 0);
                gl.uniform1f(L.uDWave, Math.max(4, an.dWave || 64)); gl.uniform1f(L.uDAmp, an.dAmp !== undefined ? an.dAmp : an.amt);
                gl.uniform2f(L.uImgSize, w, h);
                gl.uniform1f(L.uMinL, o.minL); gl.uniform1f(L.uMaxL, o.maxL);
                gl.uniform1i(L.uShadowsInverted, o.shadowsInverted ? 1 : 0); gl.uniform1i(L.uMidDither, o.midDither ? 1 : 0);
                gl.uniform1i(L.uUseGrad, 0);
                gl.uniform1i(L.uGradBlend, GRAD_BLEND_IDS[o.grad ? o.grad.b : 'normal'] || 0);
                gl.uniform1f(L.uGradAlpha, o.grad && o.grad.a !== undefined ? o.grad.a : 1);
                gl.uniform1i(L.uColorMode, cm.mode);
                gl.uniform1f(L.uPaletteCount, Math.max(1, palCount));
                const duo = cm.duo || [];
                const dv = (i) => duo[i] ? [duo[i].r, duo[i].g, duo[i].b] : [0, 0, 0];
                gl.uniform3fv(L.uDuo0, dv(0)); gl.uniform3fv(L.uDuo1, dv(1)); gl.uniform3fv(L.uDuo2, dv(2));
                gl.uniform1i(L.uDuoCount, duo.length);
            });
            let cur = 0;
            const next = () => (cur + 1) % 3;
            if (o.rgbShift > 0) {
                pass(progs.SHIFT, targets[cur].tex, next(), (L) => gl.uniform1i(L.uShift, o.rgbShift));
                cur = next();
            }
            // contorno: sempre medido na base (foto + paleta + pixel), não nas texturas por cima
            edgeBase = false;
            if (o.edgeBase) {
                bindTex(1, targets[cur].tex);
                pass(progs.BLEND, targets[cur].tex, 3, (L) => { gl.uniform1i(L.uBase, 0); gl.uniform1i(L.uLayer, 1); gl.uniform1i(L.uMode, 0); gl.uniform1f(L.uOp, 1); gl.uniform1i(L.uUseAlpha, 0); });
                edgeBase = true;
            }
            // cada camada: suas passadas alternam entre os dois alvos livres; depois, se a camada tiver
            // modo de mesclagem ou opacidade, a passada BLEND junta base + camada no alvo que sobrou
            const BLEND_IDS = { normal: 0, 'source-atop': 0, multiply: 1, screen: 2, overlay: 3, color: 4, darken: 5, lighten: 6, difference: 7, softlight: 8, 'soft-light': 8 };
            const runFx = (fx, from, to, animT, animFrame) => {
                const fp = getFx(fx.id); if (!fp) return false;
                const params = Object.assign({}, fp.def.uniforms, fx.params || {});
                pass(fp, targets[from].tex, to, (L) => {
                    gl.uniform2f(L.uResolution, w, h);
                    if (L.uTime) gl.uniform1f(L.uTime, an.T);
                    if (L.uAnim) gl.uniform1f(L.uAnim, animT || 0);
                    if (L.uAnimFrame) gl.uniform1f(L.uAnimFrame, animFrame || 0);
                    gl.uniform1f(L.uFxMix, fx.mix);
                    for (const k in params) if (L[k]) gl.uniform1f(L[k], params[k]);
                });
                return true;
            };
            const runFilm = (u, from, to) => pass(progs.FILM, targets[from].tex, to, (L) => {
                gl.uniform2f(L.uSize, w, h);
                for (const k in u) {
                    const loc = L[k], v = u[k];
                    if (!loc) continue;
                    if (Array.isArray(v)) { if (v.length === 3) gl.uniform3fv(loc, v); else if (v.length === 4) gl.uniform4fv(loc, v); else gl.uniform2fv(loc, v); }
                    else if (FILM_INT_UNIFORMS.has(k)) gl.uniform1i(loc, v | 0);
                    else gl.uniform1f(loc, v);
                }
            });
            for (const ly of (o.chain || [])) {
                const base = cur, f1 = (base + 1) % 3, f2 = (base + 2) % 3;
                const steps = [];   // cada passo: (de, para) => bool
                let useAlpha = 0;
                if (ly.kind === 'fx') steps.push((a, b) => runFx(ly.fx, a, b, an.fxT, an.fxFrame));
                else if (ly.kind === 'film') {
                    const fl = ly.film;
                    if (fl.fx) steps.push((a, b) => runFx(fl.fx, a, b, fl.fx.animT, fl.fx.animFrame));
                    if (fl.u) steps.push((a, b) => { runFilm(fl.u, a, b); return true; });
                } else if (ly.kind === 'grain') {
                    const g = ly.grain;
                    steps.push((a, b) => { pass(progs.GRAIN, targets[a].tex, b, (L) => {
                        gl.uniform1f(L.uStrength, g.strength); gl.uniform1f(L.uCell, g.cell); gl.uniform1f(L.uRough, g.rough);
                        gl.uniform1f(L.uBias, g.bias); gl.uniform1f(L.uSpeckle, g.speckle); gl.uniform1f(L.uSeed, g.seed || 0);
                        gl.uniform1i(L.uMono, g.mono ? 1 : 0);
                    }); return true; });
                } else if (ly.kind === 'grad' && o.grad) {
                    bindTex(1, gradTex);
                    steps.push((a, b) => { pass(progs.GRADL, targets[a].tex, b, (L) => { gl.uniform1i(L.uGrad, 1); gl.uniform2f(L.uImgSize, w, h); }); return true; });
                } else if (ly.kind === 'edge') {
                    useAlpha = 1;
                    steps.push((a, b) => { pass(progs.EDGE, targets[edgeBase ? 3 : a].tex, b, (L) => {
                        gl.uniform2f(L.uOut, w, h); gl.uniform1f(L.uScale, 1); gl.uniform1f(L.uHalf, ly.half); gl.uniform1i(L.uFlip, 0);
                        gl.uniform4f(L.uColor, ly.color[0], ly.color[1], ly.color[2], 1);
                    }); return true; });
                }
                let src = base, dst = f1, ran = 0;
                for (const st of steps) { if (st(src, dst)) { ran++; src = dst; dst = dst === f1 ? f2 : f1; } }
                if (!ran) continue;
                const mode = BLEND_IDS[ly.blend] || 0, op = ly.op === undefined ? 1 : ly.op;
                if (mode === 0 && op >= 1 && !useAlpha) { cur = src; continue; }
                const out = src === f1 ? f2 : f1;
                bindTex(1, targets[src].tex);
                pass(progs.BLEND, targets[base].tex, out, (L) => {
                    gl.uniform1i(L.uBase, 0); gl.uniform1i(L.uLayer, 1);
                    gl.uniform1i(L.uMode, mode); gl.uniform1f(L.uOp, Math.max(0, Math.min(1, op))); gl.uniform1i(L.uUseAlpha, useAlpha);
                });
                cur = out;
            }
            // intensidade do estilo: mistura o resultado com a foto original (mesma resolução)
            if (o.mix !== undefined && o.mix < 1) {
                const out = next();
                bindTex(1, targets[cur].tex);
                pass(progs.BLEND, srcTex, out, (L) => {
                    gl.uniform1i(L.uBase, 0); gl.uniform1i(L.uLayer, 1);
                    gl.uniform1i(L.uMode, 0); gl.uniform1f(L.uOp, Math.max(0, o.mix)); gl.uniform1i(L.uUseAlpha, 0);
                });
                cur = out;
            }
            lastTarget = cur;
            pass(progs.BLIT, targets[cur].tex, -1, (L) => {
                const cam = an.cam || { mode: 0 }, col = an.col || { mode: 0 };
                gl.uniform1i(L.uCamMode, cam.mode || 0); gl.uniform1f(L.uCamT, cam.T || 0); gl.uniform1f(L.uCamAmt, cam.amt || 0);
                gl.uniform1i(L.uColMode, col.mode || 0); gl.uniform1f(L.uColT, col.T || 0); gl.uniform1f(L.uColAmt, col.amt || 0);
                gl.uniform1i(L.uColWave, col.wave || 0); gl.uniform1i(L.uColTarget, col.target || 0);
                gl.uniform1i(L.uColSweep, col.sweep || 0); gl.uniform1f(L.uColSweepScale, col.sweepScale !== undefined ? col.sweepScale : 1);
                gl.uniform3fv(L.uColColor, col.color || [1, 0.3, 0.6]);
            });
            if (gl.isContextLost()) { contextLost = true; return false; }
            return true;
        } catch (e) {
            console.warn('[PixelarGPU] render falhou, usando CPU:', e);
            return false;
        }
    }

    // Lê o último resultado em ordem de imagem (linha 0 = topo), só quando preciso (contorno/GIF)
    function readPixels(out) {
        const buf = out && out.length === tw * th * 4 ? out : new Uint8ClampedArray(tw * th * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, targets[lastTarget].fbo);
        gl.readPixels(0, 0, tw, th, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(buf.buffer, buf.byteOffset, buf.length));
        return buf;
    }

    // desenha o contorno (W × H, já na escala de saída) e devolve a região no canvas WebGL
    function edges(o) {
        if (!isAvailable() || lastTarget < 0 || !targets.length) return null;
        const W = o.W, H = o.H; if (W > maxTex || H > maxTex) return null;
        try {
            if (glCanvas.width < W || glCanvas.height < H) {
                glCanvas.width = Math.min(maxTex, Math.max(glCanvas.width, Math.ceil(W / 256) * 256));
                glCanvas.height = Math.min(maxTex, Math.max(glCanvas.height, Math.ceil(H / 256) * 256));
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, glCanvas.width, glCanvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
            gl.viewport(0, 0, W, H);
            gl.bindVertexArray(vao); gl.useProgram(progs.EDGE.p);
            bindTex(0, targets[edgeBase ? 3 : lastTarget].tex);
            const L = progs.EDGE.loc;
            gl.uniform1i(L.uTex, 0); gl.uniform2f(L.uOut, W, H); gl.uniform1f(L.uScale, o.scale); gl.uniform1f(L.uHalf, o.half); gl.uniform1i(L.uFlip, 1);
            gl.uniform4f(L.uColor, o.color[0], o.color[1], o.color[2], o.opacity);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            return { x: 0, y: glCanvas.height - H, w: W, h: H };
        } catch (e) { console.warn('[PixelarGPU] contorno falhou:', e); return null; }
    }
    // retângulo do último resultado dentro do canvas WebGL (coordenadas de imagem, origem no topo)
    function region() { return { x: 0, y: glCanvas.height - th, w: tw, h: th }; }
    return { init, isAvailable, fits, render, readPixels, region, edges, get canvas() { return glCanvas; }, get maxTex() { if (!initialized) init(); return maxTex || 4096; } };
})();

// Catálogo de efeitos (usado pela UI): mesmo contrato do antigo PixelarFX
const PixelarFX = {
    // texturas artísticas (filmes e lentes ficam em Filtros)
    listEffects: () => PIXELAR_FX_LIST.filter(fx => !FILM_FX_IDS.includes(fx.id) && !LENS_FX_IDS.includes(fx.id)).map(fx => ({ id: fx.id, nome: fx.nome, uniforms: fx.uniforms })),
    getEffectDef: (id) => PIXELAR_FX_LIST.find(fx => fx.id === id) || null,
    isAvailable: () => PixelarGPU.isAvailable(),
};
