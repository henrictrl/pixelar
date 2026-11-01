/* Estudo 2 de filmes e câmeras (candidatos; o app só os carrega depois de escolhidos).
 * Critério: técnicas e defeitos reais de processos, câmeras e transmissões pouco usados em apps,
 * e cor ADAPTATIVA: quando um processo puxa a cor, ela sai da cor dominante da própria foto
 * (domColor), nunca de um tom fixo. Cada entrada é uma textura (shader) com parâmetros editáveis.
 * Carregado só pela galeria (tools/estudo.js). */
'use strict';
// cor dominante da imagem (média ponderada pela saturação), usada pelos processos que tingem
const ESTUDO_DOM = `
vec3 domColor() {
    vec3 acc = vec3(0.0); float w = 0.0;
    for (int y = 0; y < 6; y++) for (int x = 0; x < 6; x++) {
        vec3 c = texture(uSource, (vec2(float(x), float(y)) + 0.5) / 6.0).rgb; vec3 h = rgb2hsl(c);
        float k = h.y * (1.0 - abs(h.z - 0.5) * 1.6) + 0.02; acc += c * k; w += k;
    }
    return acc / w;
}
vec3 tone(vec3 base, float l, float s) { vec3 h = rgb2hsl(base); return hsl2rgb(vec3(h.x, clamp(h.y * s, 0.0, 1.0), l)); }
// pigmento: mesmo matiz da foto, com saturação mínima (fotos quase sem cor ainda dão tinta)
vec3 pigment(vec3 base, float l, float smin) { vec3 h = rgb2hsl(base); return hsl2rgb(vec3(h.x, clamp(max(h.y * 2.0, smin), 0.0, 1.0), l)); }
`;
window.ESTUDO_FX = [
  // ======================= FLASH =======================
  { grupo: 'Flash', id: 'e_arrasto', nome: 'Flash com arrasto', desc: 'Obturador lento + flash na 2ª cortina: quem está perto fica nítido e congelado, a luz ambiente vira rastro de movimento.',
    uniforms: { uLength: 150.0, uAngle: 0.35, uFlash: 1.0, uAmbient: 0.9 },
    src: `
    uniform float uLength, uAngle, uFlash, uAmbient;
    void main() {
        float S = max(uResolution.x, uResolution.y) / 1000.0, asp = uResolution.x / uResolution.y;
        vec2 d = vec2(cos(uAngle), sin(uAngle)) * uLength * S / uResolution;
        vec3 tr = vec3(0.0); float ws = 0.0;
        for (int i = 0; i < 28; i++) { float t = float(i) / 27.0, w = 1.0 - t * 0.7; tr += texture(uSource, clamp(vUv - d * t, 0.0, 1.0)).rgb * w; ws += w; }
        tr /= ws;
        vec3 c = texture(uSource, vUv).rgb;
        vec2 q = (vUv - vec2(0.5, 0.45)) * vec2(asp, 1.0);
        float fall = smoothstep(0.15, 0.6, exp(-dot(q, q) * 6.0) * (0.6 + 0.6 * luma(c)));   // o flash pega o que está perto e claro
        vec3 lit = c * uFlash * 1.25 * fall;
        vec3 amb = tr * uAmbient * 0.85 * (1.0 - fall * 0.6);
        outColor = vec4(clamp(1.0 - (1.0 - amb) * (1.0 - lit), 0.0, 1.0), 1.0);
    }` },
  { grupo: 'Flash', id: 'e_flashnoite', nome: 'Flash noturno (técnica)', desc: 'Refeito: o flash cai com a distância e o fundo afunda na cor dominante da própria foto (muda a cada imagem), com luzes duras e sem vinheta.',
    uniforms: { uFalloff: 1.0, uAmbient: 0.25, uCast: 0.8, uHard: 1.0 },
    src: ESTUDO_DOM + `
    uniform float uFalloff, uAmbient, uCast, uHard;
    void main() {
        float asp = uResolution.x / uResolution.y;
        vec3 c = texture(uSource, vUv).rgb, dom = domColor();
        vec2 q = (vUv - vec2(0.5, 0.42)) * vec2(asp, 1.0);
        // distância aproximada: longe do centro e escuro = longe do flash
        float near = exp(-dot(q, q) * 7.0 * uFalloff) * (0.75 + 0.5 * luma(c));
        float lit = smoothstep(0.2, 0.75, near);
        vec3 flash = c * (1.0 + 1.6 * lit * uHard);
        flash = 1.0 - exp(-flash * 1.4);                                   // luz dura que estoura com suavidade
        vec3 deep = tone(dom, 0.04 + luma(c) * 0.22, 1.6);                 // fundo: a cor dominante, bem escura
        vec3 amb = mix(c * uAmbient, deep, uCast);
        outColor = vec4(clamp(mix(amb, flash, lit), 0.0, 1.0), 1.0);
    }` },
  // ======================= QUÍMICA =======================
  { grupo: 'Química', id: 'e_vencido', nome: 'Filme vencido (química)', desc: 'Refeito: véu de base nas sombras, uma camada de cor perde força (qual muda com a Variação), manchas de densidade e vazamento com cor e lugar tirados da foto.',
    uniforms: { uAge: 0.8, uFog: 0.6, uMottle: 0.6, uLeak: 0.6, uVariant: 0.0 },
    src: ESTUDO_DOM + `
    uniform float uAge, uFog, uMottle, uLeak, uVariant;
    void main() {
        vec3 c = texture(uSource, vUv).rgb, dom = domColor();
        float v = floor(mod(uVariant, 3.0) + 0.5);
        vec3 lose = v < 0.5 ? vec3(1.0, 0.0, 0.0) : v < 1.5 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
        // a camada mais velha perde contraste e sobe (não é uma cor escolhida: é a química)
        vec3 flat_ = mix(c, vec3(0.45 + c * 0.35), lose * uAge);
        float m = fbm(vUv * 3.0 + v * 7.0);
        vec3 fogc = tone(1.0 - dom, 0.22 + m * 0.1, 0.5);                   // véu: complementar da foto
        vec3 col = mix(flat_, flat_ + fogc * (1.0 - luma(flat_)), uFog * 0.7);
        col *= 1.0 + (m - 0.5) * uMottle * 0.5;                             // densidade irregular
        // vazamento: posição e cor variam com a foto e a variação
        vec2 lp = vec2(fract(0.17 + v * 0.37 + dom.r * 0.3), fract(0.83 - v * 0.29 + dom.b * 0.4));
        float lk = smoothstep(0.75, 0.0, length((vUv - lp) * vec2(1.0, 0.6)));
        vec3 lc = tone(dom, 0.62, 1.6);
        col = 1.0 - (1.0 - col) * (1.0 - lc * lk * uLeak);
        outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }` },
  { grupo: 'Química', id: 'e_sabattier', nome: 'Sabattier (linhas de Mackie)', desc: 'Papel reexposto à luz no meio da revelação: parte dos tons se inverte e surge uma linha clara fina contornando as formas.',
    uniforms: { uThreshold: 0.55, uReverse: 0.8, uMackie: 0.8, uWidth: 1.5 },
    src: `
    uniform float uThreshold, uReverse, uMackie, uWidth;
    vec3 sol(vec3 c) { return mix(c, mix(c, uThreshold - (c - uThreshold) * 1.6, step(uThreshold, c)), uReverse); }
    void main() {
        float S = max(uResolution.x, uResolution.y) / 1000.0;
        vec2 t = uWidth * S / uResolution;
        vec3 c = texture(uSource, vUv).rgb;
        float gx = luma(texture(uSource, vUv + vec2(t.x, 0.0)).rgb) - luma(texture(uSource, vUv - vec2(t.x, 0.0)).rgb);
        float gy = luma(texture(uSource, vUv + vec2(0.0, t.y)).rgb) - luma(texture(uSource, vUv - vec2(0.0, t.y)).rgb);
        float e = smoothstep(0.06, 0.2, length(vec2(gx, gy)));
        vec3 col = clamp(sol(c), 0.0, 1.0);
        col = mix(col, vec3(1.0) - col * 0.15, e * uMackie);                // linha de Mackie: clara, na borda
        outColor = vec4(col, 1.0);
    }` },
  { grupo: 'Química', id: 'e_push', nome: 'Revelação forçada +3', desc: 'Filme puxado três pontos: pretos esmagados, luzes estouradas, grão em aglomerados e as sombras cruzando para a cor dominante.',
    uniforms: { uPush: 1.0, uGrain: 1.0, uCross: 0.7 },
    src: ESTUDO_DOM + `
    uniform float uPush, uGrain, uCross;
    void main() {
        float S = max(uResolution.x, uResolution.y) / 1000.0;
        vec3 c = texture(uSource, vUv).rgb, dom = domColor();
        vec3 p = clamp((c - 0.5) * (1.0 + uPush * 1.3) + 0.5 + uPush * 0.08, 0.0, 1.0);
        float l = luma(p);
        p = mix(p, tone(dom, l * 0.8, 1.4), uCross * (1.0 - smoothstep(0.0, 0.45, l)) * 0.7);
        vec2 g = vUv * uResolution / (S * uUnit);
        float n = (noise2(g / 2.2) - 0.5) * 0.7 + (noise2(g / 6.0) - 0.5) * 0.6 + (hash(floor(g)) - 0.5) * 0.4;
        p += n * uGrain * 0.28 * (0.4 + 0.6 * (1.0 - abs(l - 0.5) * 2.0));
        outColor = vec4(clamp(p, 0.0, 1.0), 1.0);
    }` },
  { grupo: 'Química', id: 'e_goma', nome: 'Goma bicromatada', desc: 'Impressão do século XIX em camadas de pigmento passadas a pincel: duas tintas tiradas da própria foto, com registro solto e papel.',
    uniforms: { uBrush: 1.0, uMisreg: 1.0, uPaper: 0.8, uContrast: 1.2 },
    src: ESTUDO_DOM + `
    uniform float uBrush, uMisreg, uPaper, uContrast;
    void main() {
        float S = max(uResolution.x, uResolution.y) / 1000.0;
        vec2 p = vUv * uResolution / S;
        vec3 dom = domColor(), inkA = pigment(dom, 0.3, 0.55), inkB = pigment(1.0 - dom, 0.62, 0.6);
        vec2 o = vec2(3.0, -2.0) * uMisreg * S / uResolution;
        float la = luma(texture(uSource, vUv).rgb), lb = luma(texture(uSource, vUv + o).rgb);
        float br = fbm(vec2(p.x * 0.004, p.y * 0.03)) - 0.5;              // marcas do pincel na horizontal
        float a = clamp((0.62 - la) * uContrast * 1.6 + br * uBrush * 0.5, 0.0, 1.0);
        float b = clamp((0.85 - lb) * uContrast * 1.1 + (fbm(p * 0.02 + 5.0) - 0.5) * uBrush * 0.6, 0.0, 1.0);
        vec3 paper = vec3(0.96, 0.94, 0.9) * (1.0 + (fbm(p * 0.15) - 0.5) * 0.08 * uPaper);
        vec3 col = paper * mix(vec3(1.0), inkB, b * 0.8) * mix(vec3(1.0), inkA, a);
        outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }` },
  { grupo: 'Química', id: 'e_quimigrama', nome: 'Quimigrama', desc: 'Revelador e fixador pingados no papel: manchas orgânicas onde a imagem aparece, se inverte ou mancha na cor da foto.',
    uniforms: { uScale: 1.0, uEdges: 0.8, uStain: 0.7, uSeed: 1.0 },
    src: ESTUDO_DOM + `
    uniform float uScale, uEdges, uStain, uSeed;
    void main() {
        vec3 c = texture(uSource, vUv).rgb, dom = domColor();
        float f = fbm(vUv * 2.5 * uScale + uSeed * 3.1) + fbm(vUv * 7.0 * uScale - uSeed) * 0.35;
        float zone = smoothstep(0.64, 0.68, f), ring = smoothstep(0.025, 0.0, abs(f - 0.66)) * uEdges;
        vec3 inv = tone(dom, 1.0 - luma(c) * 0.85, 1.4);
        vec3 col = mix(inv, c, zone);
        col = mix(col, tone(1.0 - dom, 0.3, 1.5), ring);
        col *= 1.0 - (fbm(vUv * 18.0 + uSeed) - 0.5) * uStain * 0.5;
        outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }` },
  // ======================= CÂMERAS DIGITAIS =======================
  { grupo: 'Câmeras e sensores', id: 'e_mavica', nome: 'Mavica (disquete, 1997)', desc: '0,3 megapixel salvos num disquete: blocos de JPEG, nitidez artificial e franja roxa nas bordas de alto contraste.',
    uniforms: { uRes: 400.0, uFringe: 1.4, uJpeg: 1.0, uSharpen: 1.2 },
    src: `
    uniform float uRes, uFringe, uJpeg, uSharpen;
    void main() {
        float k = max(uResolution.x, uResolution.y) / uRes;
        vec2 cell = vec2(k) / uResolution, uv = (floor(vUv / cell) + 0.5) * cell;
        vec3 c = texture(uSource, uv).rgb;
        vec3 b = (texture(uSource, uv + vec2(cell.x, 0.0)).rgb + texture(uSource, uv - vec2(cell.x, 0.0)).rgb + texture(uSource, uv + vec2(0.0, cell.y)).rgb + texture(uSource, uv - vec2(0.0, cell.y)).rgb) * 0.25;
        c += (c - b) * uSharpen * 1.5;
        vec2 blk = cell * 8.0; vec3 avg = texture(uSource, (floor(vUv / blk) + 0.5) * blk).rgb;
        c = mix(c, mix(c, avg, 0.5), uJpeg * smoothstep(0.0, 0.15, 0.15 - length(c - avg)));   // áreas lisas viram blocos
        float edge = clamp(length(c - b) * 3.0, 0.0, 1.0) * smoothstep(0.55, 0.9, luma(b));
        c = mix(c, vec3(0.55, 0.2, 0.9), edge * uFringe * 0.6);              // franja roxa: aberração do sensor nas luzes
        outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }` },
  { grupo: 'Câmeras e sensores', id: 'e_zoom', nome: 'Zoom digital de celular', desc: 'O que o celular faz ao ampliar: redução de ruído que vira pintura, halos de nitidez e blocos de compressão.',
    uniforms: { uZoom: 7.0, uSmear: 1.0, uHalo: 1.4 },
    src: `
    uniform float uZoom, uSmear, uHalo;
    void main() {
        float S = max(uResolution.x, uResolution.y) / 1000.0;
        vec2 cell = vec2(uZoom * S) / uResolution;
        vec2 f = fract(vUv / cell), i = floor(vUv / cell);
        vec3 a = texture(uSource, (i + 0.5) * cell).rgb, b = texture(uSource, (i + vec2(1.5, 0.5)) * cell).rgb;
        vec3 c2 = texture(uSource, (i + vec2(0.5, 1.5)) * cell).rgb, d = texture(uSource, (i + 1.5) * cell).rgb;
        vec2 s = smoothstep(0.0, 1.0, f);
        vec3 up = mix(mix(a, b, s.x), mix(c2, d, s.x), s.y);
        // redução de ruído: aplaina detalhes finos em manchas
        vec3 m = up; float r = uZoom * S * 2.0, cnt = 1.0;
        for (int k = 0; k < 8; k++) { float an = float(k) * 0.785; vec3 q = texture(uSource, vUv + vec2(cos(an), sin(an)) * r / uResolution).rgb; if (length(q - up) < 0.12) { m += q; cnt += 1.0; } }
        up = mix(up, m / cnt, uSmear);
        up += (up - (a + b + c2 + d) * 0.25) * uHalo * 1.8;                     // halo da nitidez artificial
        outColor = vec4(clamp(up, 0.0, 1.0), 1.0);
    }` },
  { grupo: 'Câmeras e sensores', id: 'e_bayer', nome: 'Sensor cru (Bayer)', desc: 'A foto antes da câmera montar as cores: cada ponto do sensor só enxerga vermelho, verde ou azul, no padrão RGGB.',
    uniforms: { uCell: 3.0, uRaw: 0.85, uGain: 1.6 },
    src: `
    uniform float uCell, uRaw, uGain;
    void main() {
        float S = max(uResolution.x, uResolution.y) / 1000.0, cs = max(1.0, uCell * S);
        vec2 p = floor(vUv * uResolution / cs), uv = (p + 0.5) * cs / uResolution;
        vec3 c = texture(uSource, uv).rgb;
        float x = mod(p.x, 2.0), y = mod(p.y, 2.0);
        vec3 m = (x < 0.5 && y < 0.5) ? vec3(1.0, 0.0, 0.0) : (x > 0.5 && y > 0.5) ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
        vec3 raw = c * m * uGain;
        outColor = vec4(clamp(mix(c, raw, uRaw), 0.0, 1.0), 1.0);
    }` },
  { grupo: 'Câmeras e sensores', id: 'e_ledflicker', nome: 'Faixas de LED', desc: 'Obturador eletrônico sob luz de LED piscando: faixas horizontais de brilho e cor (tiradas da foto) e leve inclinação do rolling shutter.',
    uniforms: { uBands: 9.0, uDepth: 0.7, uSkew: 0.4, uColor: 0.6 },
    src: ESTUDO_DOM + `
    uniform float uBands, uDepth, uSkew, uColor;
    void main() {
        vec3 dom = domColor();
        vec2 uv = vUv; uv.x += (uv.y - 0.5) * uSkew * 0.04;
        vec3 c = texture(uSource, clamp(uv, 0.0, 1.0)).rgb;
        float ph = uv.y * uBands + uAnim * uBands;
        float band = 0.5 + 0.5 * sin(ph * 6.28318);
        band = smoothstep(0.2, 0.8, band);
        vec3 tint = mix(vec3(1.0), tone(dom, 0.6, 1.5) * 1.4, uColor);
        c *= mix(vec3(1.0), mix(vec3(1.0 - uDepth * 0.7), tint, band), uDepth);
        outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }` },
  { grupo: 'Câmeras e sensores', id: 'e_infra', nome: 'Infravermelho P&B (efeito Wood)', desc: 'Filme que enxerga infravermelho: folhagem fica branca como neve, céu azul fica quase preto, luzes ganham halo.',
    uniforms: { uFoliage: 1.0, uSky: 0.8, uGlow: 0.7, uGrain: 0.5 },
    src: `
    uniform float uFoliage, uSky, uGlow, uGrain;
    float ir(vec3 c) { vec3 h = rgb2hsl(c); float leaf = smoothstep(0.15, 0.45, c.g - c.b + (c.g - c.r) * 0.5) * h.y; float sky = smoothstep(0.05, 0.3, c.b - max(c.r, c.g) * 0.9);
        return clamp(luma(c) * 0.8 + leaf * uFoliage * 1.4 - sky * uSky * 0.7, 0.0, 1.0); }
    void main() {
        float S = max(uResolution.x, uResolution.y) / 1000.0;
        float l = ir(texture(uSource, vUv).rgb), g = 0.0;
        for (int i = 0; i < 12; i++) { float a = float(i) * 0.5236; g += ir(texture(uSource, vUv + vec2(cos(a), sin(a)) * 14.0 * S / uResolution).rgb); }
        g /= 12.0;
        l = 1.0 - (1.0 - l) * (1.0 - smoothstep(0.5, 1.0, g) * uGlow);
        l += (hash(floor(vUv * uResolution / (1.4 * S * uUnit))) - 0.5) * uGrain * 0.18;
        outColor = vec4(vec3(clamp(l, 0.0, 1.0)), 1.0);
    }` },
  { grupo: 'Câmeras e sensores', id: 'e_disc', nome: 'Kodak Disc (1982)', desc: 'Negativo de 8 × 10 mm: detalhe que some, grão enorme, cor apagada que tende ao tom dominante.',
    uniforms: { uSoft: 1.0, uGrain: 1.0, uMute: 0.7 },
    src: ESTUDO_DOM + `
    uniform float uSoft, uGrain, uMute;
    void main() {
        float S = max(uResolution.x, uResolution.y) / 1000.0;
        vec3 acc = vec3(0.0); float r = 5.0 * S * uSoft;
        for (int i = 0; i < 12; i++) { float a = float(i) * 0.5236; acc += texture(uSource, vUv + vec2(cos(a), sin(a)) * r * (i % 2 == 0 ? 1.0 : 0.5) / uResolution).rgb; }
        vec3 c = acc / 12.0, dom = domColor();
        float l = luma(c);
        c = mix(c, tone(dom, l, 0.6), uMute * 0.5);
        c = mix(vec3(l), c, 1.0 - uMute * 0.35);
        vec2 g = vUv * uResolution / (S * uUnit * 3.0);
        c += ((noise2(g) - 0.5) * 0.8 + (noise2(g * 2.7) - 0.5) * 0.4) * uGrain * 0.2;
        outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }` },
  // ======================= TRANSMISSÃO =======================
  { grupo: 'Transmissão e varredura', id: 'e_scanner', nome: 'Scanner arrastado', desc: 'A foto mexeu enquanto o scanner passava: faixas esticadas, partes deslocadas e as três linhas de cor do sensor fora de registro.',
    uniforms: { uAmount: 0.7, uBands: 1.0, uShift: 1.0, uSeed: 1.0 },
    src: `
    uniform float uAmount, uBands, uShift, uSeed;
    void main() {
        float y = vUv.y, rows = 40.0 * uBands;
        float bi = floor(y * rows), r = hash(vec2(bi, uSeed));
        vec2 uv = vUv;
        if (r < uAmount * 0.5) uv.y = (bi + 0.02) / rows;                                      // faixa esticada: a mesma linha repetida
        uv.x += (hash(vec2(bi, uSeed + 3.0)) - 0.5) * 0.06 * uShift * step(1.0 - uAmount * 0.4, hash(vec2(bi, uSeed + 9.0)));
        float o = 2.0 / uResolution.y;
        vec3 c = vec3(texture(uSource, clamp(uv - vec2(0.0, o), 0.0, 1.0)).r, texture(uSource, clamp(uv, 0.0, 1.0)).g, texture(uSource, clamp(uv + vec2(0.0, o), 0.0, 1.0)).b);
        outColor = vec4(c, 1.0);
    }` },
  { grupo: 'Transmissão e varredura', id: 'e_wirephoto', nome: 'Belinógrafo (foto por fio)', desc: 'Foto de jornal transmitida linha a linha por telefone nos anos 30: linhas visíveis, tremor horizontal, tons em degraus, tinta na cor escura da foto.',
    uniforms: { uLines: 1.0, uJitter: 1.0, uLevels: 8.0, uTint: 0.7 },
    src: ESTUDO_DOM + `
    uniform float uLines, uJitter, uLevels, uTint;
    void main() {
        float S = max(uResolution.x, uResolution.y) / 1000.0, pitch = 3.5 * S * uLines;
        float row = floor(vUv.y * uResolution.y / pitch);
        vec2 uv = vUv; uv.x += (hash(vec2(row, 3.0)) - 0.5) * 0.004 * uJitter + (noise2(vec2(row * 0.05, 1.0)) - 0.5) * 0.01 * uJitter;
        float l = luma(texture(uSource, clamp(uv, 0.0, 1.0)).rgb) * (0.9 + hash(vec2(row, 7.0)) * 0.15 * uJitter);
        l = floor(clamp(l, 0.0, 0.999) * uLevels) / max(1.0, uLevels - 1.0);
        float fy = fract(vUv.y * uResolution.y / pitch), line = smoothstep(0.0, 0.25, fy) * smoothstep(1.0, 0.75, fy);
        vec3 ink = mix(vec3(0.05), tone(domColor(), 0.12, 1.2), uTint), paper = mix(vec3(0.95), tone(domColor(), 0.92, 0.25), uTint);
        outColor = vec4(mix(ink, paper, l * (0.75 + 0.25 * line)), 1.0);
    }` },
  { grupo: 'Transmissão e varredura', id: 'e_sstv', nome: 'TV de varredura lenta (SSTV)', desc: 'Imagem recebida por rádio, como as da Estação Espacial: inclinação por erro de sincronia, ruído em rajadas e baixa resolução.',
    uniforms: { uRes: 240.0, uSlant: 1.0, uNoise: 1.0, uBursts: 1.0 },
    src: `
    uniform float uRes, uSlant, uNoise, uBursts;
    void main() {
        float rows = uRes * uResolution.y / max(uResolution.x, uResolution.y);
        float row = floor(vUv.y * rows);
        vec2 uv = vUv; uv.x = fract(uv.x + row / rows * uSlant * 0.15);
        uv = (floor(uv * vec2(uRes, rows)) + 0.5) / vec2(uRes, rows);
        vec3 c = texture(uSource, uv).rgb;
        float burst = step(1.0 - uBursts * 0.15, hash(vec2(row, 11.0)));
        vec3 n = vec3(hash(vec2(floor(vUv.x * uRes), row)), hash(vec2(floor(vUv.x * uRes) + 3.0, row)), hash(vec2(floor(vUv.x * uRes) + 7.0, row))) - 0.5;
        c += n * uNoise * (0.12 + burst * 0.8);
        c = mix(c, c.gbr, burst * 0.5);
        outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }` },
];
