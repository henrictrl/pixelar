/* ==========================================================================
   PIXELAR STUDIO — State Schema (Beta 3)
   - Default Preset Intensity: 100%
   - Zero Frames
   - Full Creative Lab Palette Quantization, Recoloring & Wild Textures
   ========================================================================== */
'use strict';

window.HSL_BANDS = [
  { key: 'red',     label: 'Vermelho', hex: '#ef4444', hue: 0 },
  { key: 'orange',  label: 'Laranja',  hex: '#f97316', hue: 30 },
  { key: 'yellow',  label: 'Amarelo',  hex: '#eab308', hue: 60 },
  { key: 'green',   label: 'Verde',    hex: '#22c55e', hue: 120 },
  { key: 'aqua',    label: 'Água',     hex: '#06b6d4', hue: 180 },
  { key: 'blue',    label: 'Azul',     hex: '#3b82f6', hue: 225 },
  { key: 'purple',  label: 'Roxo',     hex: '#a855f7', hue: 275 },
  { key: 'magenta', label: 'Magenta',  hex: '#ec4899', hue: 320 },
];

window.LAB_PALETTES = {
  auto:         { label: 'Da Foto (Auto)', colors: [] },
  gameboy:      { label: 'Game Boy',       colors: ['#0F380F', '#306230', '#8BAC0F', '#9BBC0F'] },
  pico8:        { label: 'PICO-8',         colors: ['#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8', '#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA'] },
  vaporwave:    { label: 'Vaporwave',      colors: ['#1A0F3C', '#5E2B82', '#C94B9E', '#FF7EB6', '#7CE8FF', '#F8EEFF'] },
  cyberpunk:    { label: 'Cyberpunk',      colors: ['#0B0A1F', '#2B1055', '#B91372', '#FF2A85', '#00E5FF', '#F9F871'] },
  riso_coral:   { label: 'Riso Coral',     colors: ['#14284B', '#1F5C99', '#E84A5F', '#FF9F68', '#FAF3E3'] },
  noir_gold:    { label: 'Noir & Ouro',    colors: ['#0D0D10', '#2E2A25', '#786852', '#D4A244', '#F6F0E4'] },
  sepia:        { label: 'Sépia Prata',    colors: ['#1E140B', '#54351E', '#8F6441', '#C8A77E', '#F4E9D7'] },
  cga:          { label: 'CGA Retro',      colors: ['#000000', '#55FFFF', '#FF55FF', '#FFFFFF'] },
  terracota:    { label: 'Terracota Sol',  colors: ['#26140E', '#6E2B1E', '#B84A2E', '#DF8549', '#ECC28A', '#FAF1DF'] },
  botanica:     { label: 'Botânica',       colors: ['#0C1D14', '#1C4731', '#3E7A4B', '#7EB36A', '#C8D99B', '#F3F4E3'] },
  cianotipia:   { label: 'Cianotipia',     colors: ['#07182E', '#113A69', '#2567A8', '#78B0DF', '#EFF5FB'] },
  pop_warhol:   { label: 'Pop Warhol',     colors: ['#120E38', '#0048BA', '#E6007E', '#FF5E1A', '#FFE600', '#5CE1E6'] },
  pastel_tokyo: { label: 'Pastel Tóquio',  colors: ['#2F2847', '#7F6A93', '#F29CB8', '#F9C5A7', '#AEE5D8', '#FCF8F2'] },
  infra:        { label: 'Infravermelho',  colors: ['#1A0410', '#630829', '#C81D4E', '#FF7CA3', '#FFF0F5'] },
  artico:       { label: 'Ártico',         colors: ['#09131F', '#1B3A57', '#3E789E', '#97C8DF', '#F2F9FC'] },
  cinza:        { label: 'Cinza Prata',    colors: ['#0E0E10', '#4A4A52', '#9A9AA3', '#EFEFF2'] },
  fogo:         { label: 'Fogo & Brasa',   colors: ['#140806', '#5A110C', '#B82914', '#EC661C', '#F8B932', '#FFF4C2'] },
};

window.DUO_PRESETS = [
  { id: 'noite',   label: 'Noite',     colors: ['#0A1A2F', '#5A82A5', '#F2EFE9'] },
  { id: 'rosa',    label: 'Rosa Néon', colors: ['#2A0845', '#FF6FB5', '#FFE8F4'] },
  { id: 'laranja', label: 'Cinema',    colors: ['#141B34', '#EB7324', '#FFEBC9'] },
  { id: 'menta',   label: 'Menta',     colors: ['#0B2B28', '#2EC4B6', '#E8FFF9'] },
  { id: 'sangue',  label: 'Rubi',      colors: ['#140204', '#B8132B', '#FFE0E4'] },
  { id: 'ouro',    label: 'Ouro',      colors: ['#1A1306', '#C99A2E', '#FFF6DA'] },
  { id: 'ciano',   label: 'Prússia',   colors: ['#071930', '#2E72B8', '#EEF6FF'] },
  { id: 'lavanda', label: 'Lavanda',   colors: ['#1E1233', '#9B6EE8', '#F5EEFF'] },
];

window.DEFAULT_PRESET_MIX = 100;

window.LAB_PRESET_CATS = [
  { id: 'all',       label: 'Todos' },
  { id: 'opticos',   label: 'Ópticos' },
  { id: 'impressao', label: 'Impressão' },
  { id: 'arte',      label: 'Arte' },
  { id: 'retro',     label: 'Retro & Glitch' },
  { id: 'pixel',     label: 'Pixel Art' },
];

window.LAB_FX_META = {
  none:          { label: 'Nenhum',          s: 'Escala / Estrutura',     i: 'Intensidade',             p: 'Variação / Ângulo',        defMix: 75, defS: 50, defI: 50, defP: 50 },
  starlight:     { label: 'Estrelas',        s: 'Comprimento dos Raios',  i: 'Brilho / Limiar',         p: 'Ângulo das Pontas',        defMix: 80, defS: 56, defI: 55, defP: 25 },
  fluted_glass:  { label: 'Vidro Canelado',  s: 'Largura das Canaletas',  i: 'Refração do Vidro',       p: 'Orientação (Vert ↔ Horiz)',defMix: 88, defS: 44, defI: 60, defP: 0 },
  prism:         { label: 'Prisma Óptico',   s: 'Abertura do Prisma',     i: 'Dispersão Cromática',     p: 'Ângulo do Corte',          defMix: 82, defS: 60, defI: 56, defP: 35 },
  double_exp:    { label: 'Dupla Exposição', s: 'Deslocamento Fantasma',  i: 'Contraste da Fusão',      p: 'Ângulo / Escala',          defMix: 72, defS: 48, defI: 56, defP: 25 },
  motion_smudge: { label: 'Borrão Cinema',   s: 'Ângulo do Movimento',    i: 'Extensão do Rastro',      p: 'Direção (Unid ↔ Bidir)',   defMix: 75, defS: 20, defI: 58, defP: 50 },
  kaleidoscope:  { label: 'Caleidoscópio',   s: 'Espelhos (4 a 12)',      i: 'Zoom Central',            p: 'Rotação do Prisma',        defMix: 100, defS: 45, defI: 52, defP: 30 },
  riso:          { label: 'Risografia',      s: 'Desalinhamento Tinta',   i: 'Grão de Papel',           p: 'Dupla de Tintas (4 estilos)', defMix: 92, defS: 42, defI: 56, defP: 15 },
  cmyk:          { label: 'Meio-Tom CMYK',   s: 'Tamanho da Retícula',    i: 'Densidade de Tinta',      p: 'Rotação da Malha',         defMix: 88, defS: 42, defI: 60, defP: 50 },
  ink:           { label: 'Esboço Nanquim',  s: 'Espessura do Traço',     i: 'Hachura nas Sombras',     p: 'Tom do Papel (Creme ↔ Branco)', defMix: 92, defS: 48, defI: 58, defP: 30 },
  oil:           { label: 'Óleo Impasto',    s: 'Tamanho do Pincel',      i: 'Textura Impasto',         p: 'Riqueza Cromática',        defMix: 90, defS: 52, defI: 62, defP: 55 },
  stained_glass: { label: 'Vitral',          s: 'Tamanho das Peças',      i: 'Espessura do Chumbo',     p: 'Brilho do Vidro',          defMix: 86, defS: 46, defI: 54, defP: 55 },
  solarize:      { label: 'Solarização',     s: 'Limiar Sabattier',       i: 'Força da Inversão',       p: 'Prata ↔ Cor Psicodélica',  defMix: 85, defS: 52, defI: 62, defP: 35 },
  liquid:        { label: 'Reflexo Líquido', s: 'Frequência das Ondas',   i: 'Força da Distorção',      p: 'Fluxo & Caústica',         defMix: 84, defS: 48, defI: 48, defP: 45 },
  vhs:           { label: 'Fita VHS',        s: 'Sangramento RGB',        i: 'Ruído & Scanlines',       p: 'Tracking / Glitch',        defMix: 86, defS: 50, defI: 58, defP: 48 },
  crt:           { label: 'Monitor CRT',     s: 'Grade de Fósforo',       i: 'Brilho & Scanlines',      p: 'Curvatura de Tubo',        defMix: 90, defS: 45, defI: 58, defP: 40 },
  pixel_sort:    { label: 'Pixel Sort',      s: 'Comprimento do Fluxo',   i: 'Limiar de Luz',           p: 'Direção (↓ → ↑ ←)',        defMix: 82, defS: 56, defI: 58, defP: 10 },
  thermal:       { label: 'Térmico IR',      s: 'Deslocamento Térmico',   i: 'Contraste de Calor',      p: 'Paleta (FLIR/Iron/Gelo/NV)', defMix: 92, defS: 50, defI: 58, defP: 10 },
  neon_trace:    { label: 'Traçado Néon',    s: 'Espessura da Linha',     i: 'Brilho Néon',             p: 'Deslocamento de Cor',      defMix: 88, defS: 46, defI: 66, defP: 50 },
};

window.LAB_PRESETS = [
  // Ópticos
  { id: 'lp_starlight', cat: 'opticos', name: 'Estrela Editorial', badge: 'CROSS-SCREEN', subtitle: 'Raios cruzados em pontos de luz',
    lab: { fxId: 'starlight', fxMix: 82, fxScale: 58, fxIntensity: 58, fxParam: 25, fxBlend: 'screen' } },
  { id: 'lp_fluted', cat: 'opticos', name: 'Vidro Arquitetônico', badge: 'VIDRO', subtitle: 'Canaletas verticais com refração',
    lab: { fxId: 'fluted_glass', fxMix: 90, fxScale: 42, fxIntensity: 62, fxParam: 0, fxBlend: 'normal' } },
  { id: 'lp_prism70', cat: 'opticos', name: 'Prisma 70s', badge: 'PRISMA', subtitle: 'Divisão óptica + halo espectral',
    lab: { fxId: 'prism', fxMix: 84, fxScale: 62, fxIntensity: 58, fxParam: 35, fxBlend: 'screen' } },
  { id: 'lp_double', cat: 'opticos', name: 'Dupla Exposição', badge: 'ANALÓGICO', subtitle: 'Fusão fantasma deslocada em tela',
    lab: { fxId: 'double_exp', fxMix: 74, fxScale: 48, fxIntensity: 58, fxParam: 28, fxBlend: 'screen' } },
  { id: 'lp_wkw_trail', cat: 'opticos', name: 'Step-Print Cinema', badge: 'MOVIMENTO', subtitle: 'Rastro cinematográfico direcional',
    lab: { fxId: 'motion_smudge', fxMix: 76, fxScale: 16, fxIntensity: 62, fxParam: 45, fxBlend: 'normal' } },
  { id: 'lp_kaleido', cat: 'opticos', name: 'Caleidoscópio 6×', badge: 'ESPELHO', subtitle: 'Geometria radial simétrica',
    lab: { fxId: 'kaleidoscope', fxMix: 100, fxScale: 40, fxIntensity: 54, fxParam: 30, fxBlend: 'normal' } },

  // Impressão
  { id: 'lp_riso_coral', cat: 'impressao', name: 'Zine Risografia', badge: '2 TINTAS', subtitle: 'Coral + Azul com deslocamento',
    lab: { fxId: 'riso', fxMix: 94, fxScale: 44, fxIntensity: 58, fxParam: 10, fxBlend: 'normal' } },
  { id: 'lp_riso_bot', cat: 'impressao', name: 'Riso Esmeralda', badge: 'BOTÂNICA', subtitle: 'Verde + Rosa fluo sobre papel',
    lab: { fxId: 'riso', fxMix: 92, fxScale: 38, fxIntensity: 52, fxParam: 62, fxBlend: 'normal', ditherMode: 'noise', ditherStrength: 18 } },
  { id: 'lp_cmyk_pop', cat: 'impressao', name: 'Jornal Pop CMYK', badge: 'HALFTONE', subtitle: 'Retícula gráfica 4 cores',
    lab: { fxId: 'cmyk', fxMix: 88, fxScale: 40, fxIntensity: 64, fxParam: 50, fxBlend: 'normal' } },
  { id: 'lp_ciano_print', cat: 'impressao', name: 'Cianotipia Fina', badge: 'DEGRADÊ', subtitle: 'Azul da Prússia com grão retícula',
    lab: { colorMode: '5', paletteId: 'cianotipia', palMap: 'smooth', palMix: 92, ditherMode: 'noise', ditherStrength: 24 } },

  // Arte & Pintura
  { id: 'lp_ink', cat: 'arte', name: 'Esboço Nanquim', badge: 'ILUSTRAÇÃO', subtitle: 'Traço editorial e hachura em papel',
    lab: { fxId: 'ink', fxMix: 94, fxScale: 48, fxIntensity: 60, fxParam: 28, fxBlend: 'normal' } },
  { id: 'lp_oil', cat: 'arte', name: 'Óleo Galeria', badge: 'IMPASTO', subtitle: 'Pincelada pictórica Kuwahara',
    lab: { fxId: 'oil', fxMix: 90, fxScale: 52, fxIntensity: 64, fxParam: 60, fxBlend: 'normal' } },
  { id: 'lp_vitral', cat: 'arte', name: 'Vitral Catedral', badge: 'VORONOI', subtitle: 'Mosaico de vidro colorido e chumbo',
    lab: { fxId: 'stained_glass', fxMix: 88, fxScale: 46, fxIntensity: 56, fxParam: 62, fxBlend: 'normal' } },
  { id: 'lp_solarize', cat: 'arte', name: 'Solarização 1930', badge: 'SABATTIER', subtitle: 'Inversão de câmara escura Man Ray',
    lab: { fxId: 'solarize', fxMix: 88, fxScale: 52, fxIntensity: 64, fxParam: 20, fxBlend: 'normal' } },
  { id: 'lp_liquid', cat: 'arte', name: 'Reflexo Líquido', badge: 'ÁGUA', subtitle: 'Refração orgânica de vidro molhado',
    lab: { fxId: 'liquid', fxMix: 86, fxScale: 48, fxIntensity: 50, fxParam: 45, fxBlend: 'normal' } },

  // Retro & Glitch
  { id: 'lp_vhs94', cat: 'retro', name: 'Fita VHS 1994', badge: 'TAPE', subtitle: 'Tracking instável e sangramento RGB',
    lab: { fxId: 'vhs', fxMix: 88, fxScale: 52, fxIntensity: 62, fxParam: 48, fxBlend: 'normal' } },
  { id: 'lp_crt', cat: 'retro', name: 'Monitor CRT', badge: 'FÓSFORO', subtitle: 'Tríade RGB, scanlines e tubo curvo',
    lab: { fxId: 'crt', fxMix: 92, fxScale: 46, fxIntensity: 60, fxParam: 42, fxBlend: 'normal' } },
  { id: 'lp_pixelsort', cat: 'retro', name: 'Glitch Pixel Sort', badge: 'FLUXO', subtitle: 'Derretimento vertical de luzes',
    lab: { fxId: 'pixel_sort', fxMix: 84, fxScale: 58, fxIntensity: 60, fxParam: 10, fxBlend: 'normal' } },
  { id: 'lp_thermal', cat: 'retro', name: 'Câmera Térmica', badge: 'FLIR IR', subtitle: 'Mapa de calor infravermelho',
    lab: { fxId: 'thermal', fxMix: 94, fxScale: 50, fxIntensity: 60, fxParam: 10, fxBlend: 'normal' } },
  { id: 'lp_neon', cat: 'retro', name: 'Cyber Néon', badge: 'OUTLINE', subtitle: 'Contornos elétricos sobre a cena',
    lab: { fxId: 'neon_trace', fxMix: 88, fxScale: 46, fxIntensity: 68, fxParam: 55, fxBlend: 'screen' } },

  // Pixel Art
  { id: 'lp_gameboy', cat: 'pixel', name: 'Game Boy 1989', badge: '4 CORES', subtitle: 'Matriz verde + Bayer 8×8 clássico',
    lab: { colorMode: '4', paletteId: 'gameboy', palMap: 'tones', palMix: 100, pixelSize: 4, ditherMode: 'bayer8', ditherStrength: 56 } },
  { id: 'lp_pico8', cat: 'pixel', name: 'PICO-8 Arcade', badge: '16 CORES', subtitle: 'Pixel art vibrante de console indie',
    lab: { colorMode: '16', paletteId: 'pico8', palMap: 'nearest', palMix: 100, pixelSize: 4, ditherMode: 'bayer8', ditherStrength: 42 } },
  { id: 'lp_mac84', cat: 'pixel', name: 'Macintosh 1984', badge: '1-BIT', subtitle: 'Dither Atkinson monocromático retrô',
    lab: { colorMode: '2', paletteId: 'cinza', palMap: 'tones', palMix: 100, pixelSize: 2, ditherMode: 'atkinson', ditherStrength: 62 } },
  { id: 'lp_vapor', cat: 'pixel', name: 'Vaporwave CRT', badge: 'SYNTH', subtitle: 'Paleta néon + scanlines + tubo',
    lab: { colorMode: '6', paletteId: 'vaporwave', palMap: 'smooth', palMix: 88, pixelSize: 3, ditherMode: 'scanlines', ditherStrength: 44, fxId: 'crt', fxMix: 40, fxScale: 42, fxIntensity: 48, fxParam: 35 } },
];

window.DEFAULT_STATE = {
  v: 6,
  preset: {
    id: 'none',
    variation: 0,
    mix: 100,
  },
  crop: {
    aspect: 'original',
    rot: 0,
    straighten: 0,
    flipH: false,
    flipV: false,
    // Lightroom Transform (Geometria)
    perspV: 0,
    perspH: 0,
    skew: 0,
    aspectWarp: 0,
    scale: 100,
    offsetX: 0,
    offsetY: 0,
    constrainCrop: true,
    // Lens Corrections (Óptica Geométrica)
    distortion: 0,
    lensVignette: 0,
    // Composition Guide (visual overlay only)
    grid: 'thirds',
  },
  light: {
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
  },
  curve: {
    rgb: [[0, 0], [1, 1]],
    r:   [[0, 0], [1, 1]],
    g:   [[0, 0], [1, 1]],
    b:   [[0, 0], [1, 1]],
  },
  color: {
    temp: 0,
    tint: 0,
    vibrance: 0,
    saturation: 0,
  },
  hsl: {
    red:     { h: 0, s: 0, l: 0 },
    orange:  { h: 0, s: 0, l: 0 },
    yellow:  { h: 0, s: 0, l: 0 },
    green:   { h: 0, s: 0, l: 0 },
    aqua:    { h: 0, s: 0, l: 0 },
    blue:    { h: 0, s: 0, l: 0 },
    purple:  { h: 0, s: 0, l: 0 },
    magenta: { h: 0, s: 0, l: 0 },
  },
  grade: {
    shadows:    { h: 0, s: 0, l: 0 },
    midtones:   { h: 0, s: 0, l: 0 },
    highlights: { h: 0, s: 0, l: 0 },
    balance: 0,
    blending: 55,
  },
  presence: {
    clarity: 0,
    dehaze: 0,
    sharpen: 0,
    fade: 0,
  },
  film: {
    chem: 'none',
    rolloff: 0,
    bwMix: [30, 59, 11],
    toneAmt: 0,
    toneColor: '#8d9cb0',
    vencidoAge: 0,
    vencidoFog: 0,
    vencidoMottle: 0,
    vencidoLeak: 0,
    vencidoLayer: 3,
    vencidoSeed: 1,
    vencidoTint: '#d482ae',
  },
  optics: {
    halation: 0,
    halationColor: '#ff3418',
    bloom: 0,
    orton: 0,
    anamorphic: 0,
    vignette: 0,
    vigMidpoint: 48,
    vigFeather: 72,
    chroma: 0,
    leak: 0,
    leakAngle: 35,
    leakColor: '#ff7a2e',
    flash: 0,
    grain: 0,
    grainSize: 95,
    grainRough: 42,
    grainMono: true,
  },
  lab: {
    presetId: 'none',
    // Color Quantization & Recoloring (DNA Pixelar Expanded)
    colorMode: 'all',     // 'all' | '2'..'256' | 'duotone' | 'tritone'
    paletteId: 'auto',    // 'auto' or key in LAB_PALETTES or 'custom'
    palMap: 'auto',       // 'auto' | 'tones' (Integral) | 'smooth' (Degradê) | 'nearest' (Exato)
    palMix: 100,          // 0 .. 100%
    palHue: 0,            // -180 .. +180
    palSat: 0,            // -100 .. +100
    palLight: 0,          // -100 .. +100
    palInvert: false,
    customPal: [],        // Array of hex strings when edited/shuffled
    duo0: '#0A1A2F',
    duo1: '#5A82A5',
    duo2: '#F2EFE9',
    // Pixel & Dither
    pixelSize: 1,         // 1 .. 32
    ditherMode: 'none',   // 'none' | 'bayer8' | 'atkinson' | 'halftone' | 'scanlines' | 'noise'
    ditherStrength: 45,
    // 18 Wild & Practical Creative Textures
    fxId: 'none',
    fxMix: 75,
    fxScale: 50,
    fxIntensity: 50,
    fxParam: 50,
    fxBlend: 'normal',    // 'normal' | 'screen' | 'multiply' | 'overlay' | 'softlight'
  },
};

window.deepClone = (o) => JSON.parse(JSON.stringify(o));
window.freshState = () => window.deepClone(window.DEFAULT_STATE);

window.mergeState = function mergeState(base, patch) {
  const out = window.deepClone(base);
  if (!patch || typeof patch !== 'object') return out;
  for (const k of Object.keys(patch)) {
    const pv = patch[k];
    if (pv === undefined || pv === null) continue;
    if (Array.isArray(pv)) {
      out[k] = window.deepClone(pv);
    } else if (typeof pv === 'object' && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = mergeState(out[k], pv);
    } else {
      out[k] = pv;
    }
  }
  return out;
};

/* Monotone Cubic Hermite Spline (Fritsch-Carlson) for smooth Lightroom Tone Curves */
window.evalCurve256 = function evalCurve256(points) {
  const lut = new Uint8Array(256);
  if (!points || points.length < 2) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }
  const pts = points.slice().sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  const xs = pts.map(p => p[0]);
  const ys = pts.map(p => p[1]);

  if (n === 2) {
    const dx = Math.max(1e-5, xs[1] - xs[0]);
    for (let i = 0; i < 256; i++) {
      const x = i / 255;
      let y;
      if (x <= xs[0]) y = ys[0];
      else if (x >= xs[1]) y = ys[1];
      else y = ys[0] + ((x - xs[0]) / dx) * (ys[1] - ys[0]);
      lut[i] = Math.max(0, Math.min(255, Math.round(y * 255)));
    }
    return lut;
  }

  const d = new Array(n - 1);
  const m = new Array(n);
  for (let i = 0; i < n - 1; i++) {
    const h = Math.max(1e-5, xs[i + 1] - xs[i]);
    d[i] = (ys[i + 1] - ys[i]) / h;
  }
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else m[i] = (d[i - 1] + d[i]) * 0.5;
  }
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(d[i]) < 1e-6) { m[i] = 0; m[i + 1] = 0; }
    else {
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
  }

  let seg = 0;
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    let y;
    if (x <= xs[0]) y = ys[0];
    else if (x >= xs[n - 1]) y = ys[n - 1];
    else {
      while (seg < n - 2 && x > xs[seg + 1]) seg++;
      const h = Math.max(1e-5, xs[seg + 1] - xs[seg]);
      const t = (x - xs[seg]) / h, t2 = t * t, t3 = t2 * t;
      y = (2 * t3 - 3 * t2 + 1) * ys[seg] + (t3 - 2 * t2 + t) * h * m[seg]
        + (-2 * t3 + 3 * t2) * ys[seg + 1] + (t3 - t2) * h * m[seg + 1];
    }
    lut[i] = Math.max(0, Math.min(255, Math.round(y * 255)));
  }
  return lut;
};

window.buildCurveTextureRGBA = function buildCurveTextureRGBA(curve) {
  const data = new Uint8Array(256 * 4);
  const rgb = window.evalCurve256(curve.rgb);
  const r = window.evalCurve256(curve.r);
  const g = window.evalCurve256(curve.g);
  const b = window.evalCurve256(curve.b);
  for (let i = 0; i < 256; i++) {
    data[i * 4 + 0] = r[i];
    data[i * 4 + 1] = g[i];
    data[i * 4 + 2] = b[i];
    data[i * 4 + 3] = rgb[i];
  }
  return data;
};

window.hexToRgb01 = function hexToRgb01(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#ffffff');
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [1, 1, 1];
};

window.summarizeRecipe = function summarizeRecipe(st) {
  const items = [];
  const d = window.DEFAULT_STATE;
  if (st.preset.id !== 'none') {
    const p = window.getPresetById ? window.getPresetById(st.preset.id) : null;
    const vName = p && p.variations && p.variations[st.preset.variation] ? ' · ' + p.variations[st.preset.variation].name : '';
    items.push({ sec: 'Filme / Look', label: (p ? p.name : st.preset.id) + vName, val: st.preset.mix + '%' });
  }
  const addNum = (sec, label, val, def, suffix = '', fmt = null) => {
    if (Math.abs(val - def) > 0.001) {
      items.push({ sec, label, val: fmt ? fmt(val) : (val > 0 ? '+' + val : String(val)) + suffix });
    }
  };
  addNum('Luz', 'Exposição', st.light.exposure, 0, ' EV', v => (v > 0 ? '+' : '') + v.toFixed(2) + ' EV');
  addNum('Luz', 'Contraste', st.light.contrast, 0);
  addNum('Luz', 'Realces', st.light.highlights, 0);
  addNum('Luz', 'Sombras', st.light.shadows, 0);
  addNum('Luz', 'Brancos', st.light.whites, 0);
  addNum('Luz', 'Pretos', st.light.blacks, 0);
  addNum('Cor', 'Temperatura', st.color.temp, 0);
  addNum('Cor', 'Matiz (Tint)', st.color.tint, 0);
  addNum('Cor', 'Vibração', st.color.vibrance, 0);
  addNum('Cor', 'Saturação', st.color.saturation, 0);
  addNum('Presença', 'Claridade', st.presence.clarity, 0);
  addNum('Presença', 'Desembaçar', st.presence.dehaze, 0);
  addNum('Presença', 'Nitidez', st.presence.sharpen, 0);
  addNum('Presença', 'Fade Analógico', st.presence.fade, 0, '%');

  if (JSON.stringify(st.curve) !== JSON.stringify(d.curve)) items.push({ sec: 'Curva', label: 'Curva de Tons', val: 'Personalizada' });
  const hslMods = window.HSL_BANDS.filter(b => st.hsl[b.key].h || st.hsl[b.key].s || st.hsl[b.key].l);
  if (hslMods.length) items.push({ sec: 'HSL', label: 'Cores ajustadas', val: hslMods.map(b => b.label).join(', ') });
  if (st.grade.shadows.s > 0 || st.grade.midtones.s > 0 || st.grade.highlights.s > 0) items.push({ sec: 'Color Grading', label: 'Rodas 3-Vias', val: 'Ativo' });
  if (st.film.chem !== 'none') items.push({ sec: 'Química', label: 'Emulsão', val: st.film.chem });
  addNum('Óptica', 'Halação', st.optics.halation, 0, '%');
  addNum('Óptica', 'Pro-Mist / Bloom', st.optics.bloom, 0, '%');
  addNum('Óptica', 'Orton Dream', st.optics.orton, 0, '%');
  addNum('Óptica', 'Anamórfico', st.optics.anamorphic, 0, '%');
  addNum('Óptica', 'Vazamento de Luz', st.optics.leak, 0, '%');
  addNum('Óptica', 'Grão de Filme', st.optics.grain, 0, '%');
  addNum('Óptica', 'Vinheta', st.optics.vignette, 0);
  addNum('Óptica', 'Aberração Crom.', st.optics.chroma, 0, '%');
  if (st.lab.colorMode !== 'all') items.push({ sec: 'Lab Criativo', label: 'Paleta / Cores', val: st.lab.colorMode });
  if (st.lab.palHue !== 0) items.push({ sec: 'Lab Criativo', label: 'Girar Cores', val: st.lab.palHue + '°' });
  if (st.lab.palInvert) items.push({ sec: 'Lab Criativo', label: 'Inverter', val: 'Negativo' });
  if (st.lab.pixelSize > 1) items.push({ sec: 'Lab Criativo', label: 'Pixelização', val: st.lab.pixelSize + 'px' });
  if (st.lab.ditherMode !== 'none') items.push({ sec: 'Lab Criativo', label: 'Dither', val: st.lab.ditherMode });
  if (st.lab.fxId !== 'none') {
    const fxMeta = window.LAB_FX_META && window.LAB_FX_META[st.lab.fxId];
    items.push({ sec: 'Lab Criativo', label: 'Efeito', val: (fxMeta ? fxMeta.label : st.lab.fxId) + ' (' + st.lab.fxMix + '%)' });
  }
  if (st.crop) {
    if (st.crop.aspect && st.crop.aspect !== 'original') items.push({ sec: 'Geometria', label: 'Proporção', val: st.crop.aspect });
    if (st.crop.rot) items.push({ sec: 'Geometria', label: 'Rotação', val: st.crop.rot + '°' });
    addNum('Geometria', 'Endireitar', st.crop.straighten || 0, 0, '°', v => (v > 0 ? '+' : '') + v.toFixed(1) + '°');
    if (st.crop.flipH) items.push({ sec: 'Geometria', label: 'Espelhar', val: 'Horizontal' });
    if (st.crop.flipV) items.push({ sec: 'Geometria', label: 'Espelhar', val: 'Vertical' });
    addNum('Geometria', 'Perspectiva Vertical', st.crop.perspV || 0, 0);
    addNum('Geometria', 'Perspectiva Horizontal', st.crop.perspH || 0, 0);
    addNum('Geometria', 'Inclinação (Skew)', st.crop.skew || 0, 0);
    addNum('Geometria', 'Proporção (Aspect)', st.crop.aspectWarp || 0, 0);
    addNum('Geometria', 'Escala', st.crop.scale ?? 100, 100, '%', v => v + '%');
    addNum('Geometria', 'Deslocamento X', st.crop.offsetX || 0, 0);
    addNum('Geometria', 'Deslocamento Y', st.crop.offsetY || 0, 0);
    addNum('Lente', 'Distorção de Lente', st.crop.distortion || 0, 0);
    addNum('Lente', 'Vinheta da Lente', st.crop.lensVignette || 0, 0);
  }
  return items;
};

