/* Pixelar — presets prontos, conversão de configurações antigas e categorias. */
'use strict';

// Presets originais (formato da versão anterior; só os campos diferentes do padrão).
const LEGACY_PRESETS = {"GameBoy":{"px":"3","col":"4","dith":"nintendo_ds","cc":["#0f380f","#306230","#8bac0f","#9bbc0f"],"palMode":"preset"},
  "CGA 4-Color":{"px":"2","col":"4","dith":"checkerboard","cont":"15","dScale":"2","cc":["#000000","#55ffff","#ff55ff","#ffffff"],"palMode":"preset"},
  "KGB":{"px":"2","col":"4","dith":"scanlines","dScale":"5","dInt":"80","tAng":"0","cc":["#000000","#550000","#aa0000","#ff0000"],"palMode":"preset","rSht":"2"},
  "Manga":{"col":"2","dith":"halftone","cont":"40","dScale":"35","dInt":"150","cc":["#000000","#ffffff"],"palMode":"preset"},
  "Nintendo DS":{"px":"7","col":"2","dith":"nintendo_ds","cont":"20","cc":["#000000","#ffffff"],"palMode":"preset"},
  "Negativo":{"px":"2","col":"16","dith":"scanlines","exp":"-28","cont":"31","post":"31","dScale":"2","dInt":"63","tAng":"180","effMidDither":true,"cc":["#FAE6FE","#F9F5FE","#FFFFFF","#E0ECFD","#C7E4FB","#C6DEFB","#C6D7FA","#C7D0FA","#BDBFF5","#A9A1EA","#9279E3","#793CF2","#715EDE","#6384D8","#49B1DE","#35EBDD"],"palMode":"manual","inv":true,"rSht":"2","edgC":"#be38f3"},
  "Matrix":{"px":"2","col":"4","dith":"scanlines","dScale":"5","dInt":"150","cc":["#000000","#003300","#009900","#00ff00"],"palMode":"preset","rSht":"2"},
  "Degrade Linear":{"sat":"50","cont":"30","temp":"-15","cc":[],"rSht":"4","iGrad":true,"iGradCol":["#ff0055","#00ddff"],"iGradBld":"color"},
  "CMYK":{"col":"4","dith":"halftone","dScale":"2","tAng":"15","fillBg":true,"bgColor":"#f5f5f0","cc":["#000000","#00ffff","#ff00ff","#ffff00"],"palMode":"preset"},
  "Degrade Radial":{"px":"2","dith":"checkerboard","cont":"10","dScale":"3","dInt":"30","cc":[],"iGrad":true,"iGradTyp":"radial","iGradCol":["#ff7b00","#5c00ff"],"iGradPos":"70","iGradBld":"screen"},
  "Cianotipo":{"col":"2","cont":"10","cc":["#08204A","#EAF2FA"],"palMode":"preset"},
  "Kodachrome":{"exp":"5","som":"-5","sat":"25","cont":"15","temp":"12","cc":[],"fx":"color_adjustment","fxMix":"65","fxParams":{"uContrast":1.25,"uShadowLift":0.0,"uSatMid":1.15,"uToneAmount":0.3,"uShadowTone_r":0.15,"uShadowTone_g":0.08,"uShadowTone_b":0.05,"uHighTone_r":1.0,"uHighTone_g":0.55,"uHighTone_b":0.2}},
  "Bauhaus":{"col":"4","cont":"15","cc":["#E5231B","#F6C500","#1859A9","#111111"],"palMode":"preset"},
  "Pop Art":{"col":"4","dith":"halftone","sat":"20","cont":"25","dScale":"3","dInt":"70","cc":["#FF2D75","#00C2D1","#FFD400","#111111"],"palMode":"preset"},
  "Memphis":{"col":"5","sat":"20","cont":"10","cc":["#FF6FA5","#00D9C0","#FFD23F","#7B61FF","#111111"],"palMode":"preset"},
  "Comunismo":{"col":"3","sat":"-10","cont":"30","cc":["#C1121F","#111111","#F2EFE9"],"palMode":"preset"},
  "Jornal Impresso":{"col":"2","dith":"halftone","cont":"30","dScale":"5","dInt":"90","cc":["#111111","#EDE8DC"],"palMode":"preset"},
  "Propaganda":{"col":"3","dith":"halftone","sat":"-15","cont":"35","dScale":"5","dInt":"40","cc":["#B0281A","#EDE0C8","#1A1A1A"],"palMode":"preset"},
  "LSD":{"col":"8","sat":"30","cont":"20","cc":["#E435B9","#1EB1E1","#ED78D0","#62C9EA","#C1E74B","#A5E0F3","#F6BCE8","#D8F08F"],"palMode":"random","edgC":"#0a0a0a","edgSiz":"1"},
  "Câmera de Segurança":{"col":"3","dith":"noise","sat":"-90","cont":"15","dInt":"25","cc":["#0A0A0A","#5C6B5C","#D4E0D4"],"palMode":"preset","fx":"vhs","fxMix":"40","fxParams":{"uJitter":0.004,"uBleed":0.002,"uScanline":0.3,"uNoise":0.05}},
  "Termovisão":{"col":"5","cont":"25","cc":["#000033","#7A00CC","#FF3300","#FFCC00","#FFFFFF"],"palMode":"preset"},
  "Raio-X":{"col":"2","cont":"30","cc":["#000814","#B9E5FF"],"palMode":"preset"},
  "Néon Noturno":{"col":"4","sat":"30","cont":"20","cc":["#FF00A8","#00E5FF","#7B2FFF","#0A0A1A"],"palMode":"preset","fx":"bokeh_blur","fxMix":"20","fxParams":{"uRadius":4,"uThreshold":0.7,"uBoost":1.5}},
  "Datamosh":{"col":"6","cc":["#FF2D75","#00E5FF","#FFD400","#7B2FFF","#00FF85","#111111"],"palMode":"preset","rSht":"2","fx":"slice_shift","fxMix":"80","fxParams":{"uSlices":20,"uShift":0.12,"uSeed":4}},
  "Recibo":{"col":"2","dith":"noise","cont":"35","dInt":"45","cc":["#1A1A1A","#F0EDE4"],"palMode":"preset","fx":"photocopy","fxMix":"30","fxParams":{"uContrast":2.0,"uStreaks":0.4,"uInk_r":0.1,"uInk_g":0.1,"uInk_b":0.1,"uPaper_r":0.94,"uPaper_g":0.93,"uPaper_b":0.88}},
  "Vinheta Noir":{"col":"2","cont":"25","cc":["#080604","#F4F1EA"],"palMode":"preset","fx":"vignette","fxMix":"70","fxParams":{"uRadius":0.7,"uSoftness":0.5,"uIntensity":0.65,"uColor_r":0.0,"uColor_g":0.0,"uColor_b":0.0},
  "grainAmt":"18","grainSz":"100","grainRough":"45","grainSB":"20","grainSpk":"0","grainMono":true},
  "Bloom":{"col":"6","sat":"30","cont":"15","cc":["#FF00A8","#00E5FF","#7B2FFF","#00FF85","#FFD400","#0A0A1A"],"palMode":"preset","fx":"bloom","fxMix":"80","fxParams":{"uThreshold":0.6,"uRadius":9.0,"uIntensity":1.4}},
  "Duotone":{"col":"duotone","cont":"5","cc":["#0A1A2F","#DCE9F5"],"palMode":"duotone"},
  "Bayer Fino":{"px":"2","col":"6","dith":"bayer8","cont":"10","cc":["#101010","#404040","#707070","#A0A0A0","#D0D0D0","#FFFFFF"],"palMode":"preset"}};

// Presets novos, já no formato de estado atual (parciais — o resto fica no padrão).
const pal = (list, sel) => ({ sel: String(sel || list.length), mode: 'preset', base: list.slice(), ref: list.slice() });
const duo = (a, b, c) => ({ sel: c ? 'tritone' : 'duotone', mode: c ? 'tritone' : 'duotone', duo: [a, b, c || b] });
const MODERN_PRESETS = {
    // ---------- filme ----------
    'Super 8': { film: { look: 'super8', mix: 100 }, grain: { amount: 12, size: 140, rough: 50, bias: 20, speckle: 10, mono: true } },
    'Polaroid': { film: { look: 'polaroid', mix: 100 } },
    'Instax': { film: { look: 'instax', mix: 100 } },
    'CineStill': { film: { look: 'cinestill', mix: 100 }, adj: { contrast: 8 } },
    'Portra': { film: { look: 'portra', mix: 100 } },
    'Noir': { film: { look: 'noir', mix: 100, vignette: 20 } },
    'Aerochrome': { film: { look: 'aerochrome', mix: 100 } },
    'Kodachrome': { film: { look: 'kodachrome64', mix: 100 } },
    'Kodachrome 25': { film: { look: 'kodachrome25', mix: 100 } },
    'Ektachrome': { film: { look: 'ektachrome', mix: 100 } },
    'Portra 160': { film: { look: 'portra160', mix: 100 } },
    'Portra 800': { film: { look: 'portra800', mix: 100 } },
    'Gold 200': { film: { look: 'gold200', mix: 100 } },
    'Ultramax': { film: { look: 'ultramax', mix: 100 } },
    'ColorPlus': { film: { look: 'colorplus', mix: 100 } },
    'Ektar': { film: { look: 'ektar', mix: 100 } },
    'Tri-X': { film: { look: 'trix', mix: 100 } },
    'Velvia': { film: { look: 'velvia', mix: 100 } },
    'Provia': { film: { look: 'provia', mix: 100 } },
    'Pro 400H': { film: { look: 'pro400h', mix: 100 } },
    'Superia': { film: { look: 'superia', mix: 100 } },
    'Acros': { film: { look: 'acros', mix: 100 } },
    'HP5': { film: { look: 'hp5', mix: 100 } },
    'CineStill 50D': { film: { look: 'cinestill50', mix: 100 } },
    'Vision3 500T': { film: { look: 'vision500t', mix: 100 } },
    'Contax T2': { film: { look: 'contaxt2', mix: 100 } },
    'Olympus mju': { film: { look: 'mju2', mix: 100 } },
    'Hasselblad': { film: { look: 'hasselblad', mix: 100 } },
    // ---------- movimentos artísticos ----------
    'Impressionismo': { adj: { saturation: 18, contrast: -8, brightness: 6 }, film: { look: 'portra', mix: 55, soft: 32, bloom: 28, halation: 10 }, grain: { amount: 14, size: 180, rough: 85, bias: 0, speckle: 25, mono: false } },
    'Pontilhismo': { pixel: { size: 2 }, dither: { mode: 'noise', scale: 2, intensity: 170 }, color: { sel: '16', mode: 'original' }, adj: { saturation: 25, contrast: 10 } },
    'Fauvismo': { adj: { saturation: 85, contrast: 25, temperature: 15 }, color: { sel: '8', mode: 'original' }, dither: { mode: 'floyd_approx', intensity: 60 } },
    'Expressionismo': { fx: { id: 'warp', mix: 100 }, fxParams: { warp: { uAmount: 0.02, uFreq: 9, uPhase: 0, uDuo: 0 } }, color: pal(['#141432', '#2E4A8B', '#C8452C', '#EE8A3C', '#F6D98A']), dither: { mode: 'floyd_approx', intensity: 70 }, adj: { contrast: 20 } },
    'Cubismo': { fx: { id: 'pixelate_fx', mix: 100 }, fxParams: { pixelate_fx: { uSizeX: 26, uSizeY: 14 } }, edge: { size: 1, color: '#2A2118', opacity: 80 }, color: pal(['#2A2118', '#6E5638', '#A88B5E', '#D8C79E', '#58675F', '#8E3B2B']) },
    'Futurismo': { fx: { id: 'slice_shift', mix: 90 }, fxParams: { slice_shift: { uSlices: 18, uShift: 0.06, uSeed: 3 } }, color: pal(['#101010', '#B71C1C', '#E0E0E0', '#F4A300', '#37474F']), adj: { contrast: 25 } },
    'Suprematismo': { pixel: { size: 6 }, adj: { contrast: 35, posterize: 30 }, color: pal(['#111111', '#F4EFE6', '#C8102E', '#1F3A93', '#E8B400']) },
    'Construtivismo': { color: duo('#141414', '#C62828', '#F1E6D0'), dither: { mode: 'halftone', scale: 3, intensity: 110 }, adj: { contrast: 30 } },
    'Art Nouveau': { color: pal(['#2F3B2A', '#6F7F4E', '#C9A86A', '#E9D8B0', '#A45A3F']), film: { look: 'kodak_verde', mix: 40, soft: 20, vignette: 25 }, edge: { size: 1, color: '#2F3B2A', opacity: 60 }, adj: { saturation: -10 } },
    'Art Déco': { color: pal(['#0E0E0E', '#1F4E4A', '#C9A646', '#EDE0C0']), grad: { on: true, type: 'conic', colors: ['#0E0E0E', '#C9A646', '#0E0E0E'], steps: 16, blend: 'overlay', opacity: 35, repeat: 2 }, adj: { contrast: 20 } },
    'Surrealismo': { film: { look: 'aerochrome', mix: 70, soft: 25 }, adj: { temperature: -10, saturation: 10 }, grad: { on: true, type: 'radial', colors: ['#FFE9C7', '#3C2A6B'], blend: 'softlight', opacity: 45 } },
    'Dadá': { fx: { id: 'photocopy', mix: 100 }, fxParams: { photocopy: { uContrast: 2.6, uGrain: 0.22, uStreaks: 0.45 } }, dither: { mode: 'halftone', scale: 2, intensity: 90 } },
    'Op Art': { color: duo('#0A0A0A', '#F5F5F0'), dither: { mode: 'checkerboard', scale: 6, intensity: 170 }, adj: { contrast: 40 } },
    'Minimalismo': { color: duo('#2B2B2B', '#EDEBE6'), adj: { contrast: -15, posterize: 55 }, film: { soft: 15 } },
    'Psicodelia': { color: pal(['#2B0A3D', '#7B1FA2', '#E91E63', '#FF9800', '#FFEB3B', '#4CAF50', '#00BCD4', '#FFFFFF']), grad: { on: true, type: 'spiral', colors: ['#FF00A0', '#FFE600', '#00E5FF'], blend: 'overlay', opacity: 55, repeat: 3 }, adj: { saturation: 60 }, dither: { mode: 'bayer8', intensity: 60 } },
    // ---------- artistas ----------
    'Van Gogh': { color: pal(['#0B1D51', '#1F4E9A', '#4F7CC2', '#9EC1E6', '#F2D64B', '#F7B32B', '#2E5E3A']), dither: { mode: 'floyd_approx', scale: 2, intensity: 120 }, fx: { id: 'warp', mix: 100 }, fxParams: { warp: { uAmount: 0.012, uFreq: 14, uPhase: 0, uDuo: 0 } }, grain: { amount: 18, size: 220, rough: 90, bias: 0, speckle: 30, mono: false }, adj: { saturation: 35, contrast: 15 } },
    'Klimt': { color: pal(['#2A1A0A', '#6B4A1B', '#B8862B', '#E3C16F', '#F7E7B4', '#3E5B3A']), dither: { mode: 'checkerboard', scale: 3, intensity: 90 }, film: { bloom: 35, halation: 20 }, adj: { temperature: 25, contrast: 10 } },
    'Hokusai': { color: pal(['#15233F', '#2E5E8C', '#7FA7C9', '#E9DFC7', '#C4553A']), edge: { size: 1, color: '#15233F', opacity: 70 }, film: { look: 'kodak_verde', mix: 30 }, grain: { amount: 10, size: 140, rough: 70, bias: 0, speckle: 0, mono: true }, adj: { contrast: 10 } },
    'Mondrian': { pixel: { size: 18 }, color: pal(['#111111', '#F5F5F0', '#D52B1E', '#1D4E9E', '#F7D002']), edge: { size: 3, color: '#111111', opacity: 100 }, adj: { contrast: 30, saturation: 30 } },
    'Lichtenstein': { dither: { mode: 'halftone', scale: 3, intensity: 130 }, color: pal(['#111111', '#F5F0E6', '#E63B2E', '#FFD23F', '#2F6BD8']), edge: { size: 2, color: '#111111', opacity: 100 }, adj: { contrast: 25, saturation: 40 } },
    'Warhol': { color: duo('#1A0B3D', '#FF3EA5', '#FFE94E'), adj: { contrast: 45, posterize: 40 } },
    'Rothko': { film: { soft: 70, vignette: 30 }, grad: { on: true, type: 'linear', angle: 180, colors: ['#5A0F12', '#C2361F', '#E88A2E'], steps: 3, smooth: 30, blend: 'overlay', opacity: 75 }, adj: { saturation: -30, contrast: -10 }, grain: { amount: 12, size: 200, rough: 80, bias: 0, speckle: 0, mono: true } },
    'Hopper': { film: { look: 'gold200', mix: 80, vignette: 25 }, adj: { contrast: 18, shadows: -15, saturation: -5 }, color: { sel: '24', mode: 'original' } },
    'Kandinsky': { fx: { id: 'pattern_refraction', mix: 80 }, fxParams: { pattern_refraction: { uBands: 10, uShift: 0.03, uAngle: 0.6 } }, color: pal(['#101820', '#F2AA4C', '#D7263D', '#1B998B', '#2E86AB', '#F4F1DE']), edge: { size: 1, color: '#101820', opacity: 70 } },
    'Munch': { fx: { id: 'warp', mix: 100 }, fxParams: { warp: { uAmount: 0.035, uFreq: 5, uPhase: 1, uDuo: 0 } }, color: pal(['#1E1B3A', '#3D5A80', '#D9642C', '#F2A541', '#E8D6A8']), film: { soft: 20 }, adj: { saturation: 30 } },
    // ---------- Brasil ----------
    'Tarsila': { color: pal(['#2E5E3E', '#E9A23B', '#D9573B', '#F2D7A6', '#3A7CA5', '#6B3E26']), film: { soft: 25 }, adj: { saturation: 25, posterize: 20 } },
    'Tropicália': { color: pal(['#0B6E4F', '#F9C80E', '#F86624', '#EA3546', '#43BCCD', '#662E9B']), dither: { mode: 'halftone', scale: 2, intensity: 100 }, adj: { saturation: 55, contrast: 15 } },
    'Cordel': { fx: { id: 'hatching', mix: 100 }, fxParams: { hatching: { uScale: 9, uThreshold: 0.62, uFg_r: 0.08, uFg_g: 0.06, uFg_b: 0.05, uBg_r: 0.93, uBg_g: 0.88, uBg_b: 0.76 } }, adj: { contrast: 30 } },
    'Oiticica': { pixel: { size: 24 }, color: pal(['#F26A1B', '#E8341C', '#FFB400', '#FFE08A', '#8C1C13']), edge: { size: 1, color: '#8C1C13', opacity: 40 } },
    'Azulejo': { color: duo('#0F3D91', '#F4F4F0'), dither: { mode: 'bayer8', scale: 2, intensity: 110 }, pixel: { size: 2 }, adj: { contrast: 25 } },
    'Neoconcreto': { pixel: { size: 32 }, color: pal(['#1A1A1A', '#F2F0EA', '#D7263D', '#2D5DA1']), adj: { contrast: 40 }, edge: { size: 2, color: '#F2F0EA', opacity: 100 } },
    // ---------- estéticas ----------
    'Vaporwave': { color: pal(['#2D1B69', '#FF6AD5', '#C774E8', '#AD8CFF', '#94D0FF', '#FFFFFF']), dither: { mode: 'scanlines', scale: 2, intensity: 60 }, grad: { on: true, type: 'linear', angle: 180, colors: ['#FF6AD5', '#94D0FF'], blend: 'overlay', opacity: 45 }, adj: { rgbShift: 2 } },
    'Synthwave': { grad: { on: true, type: 'linear', angle: 180, colors: ['#2B1055', '#D53A9D', '#FFB347'], blend: 'color', opacity: 70 }, film: { bloom: 45, halation: 30 }, dither: { mode: 'scanlines', scale: 3, intensity: 50 }, adj: { contrast: 20, saturation: 30 } },
    'Cyberpunk': { color: duo('#08040F', '#00E5FF', '#FF2E97'), film: { bloom: 40 }, adj: { rgbShift: 3, contrast: 25 } },
    'Glitch art': { fx: { id: 'slice_shift', mix: 100 }, fxParams: { slice_shift: { uSlices: 24, uShift: 0.09, uSeed: 7 } }, adj: { rgbShift: 5 }, color: { sel: '16', mode: 'original' } },
    'Brutalismo': { color: duo('#1E1E1E', '#BDB8AE'), fx: { id: 'photocopy', mix: 70 }, grain: { amount: 25, size: 160, rough: 80, bias: 20, speckle: 30, mono: true }, adj: { contrast: 30 } },
    'Estilo Suíço': { color: duo('#E30613', '#F5F5F0'), dither: { mode: 'halftone', scale: 5, intensity: 140 }, adj: { contrast: 35 } },
    'Stencil': { color: pal(['#111111', '#F2F2F2']), adj: { contrast: 55, posterize: 70 }, grain: { amount: 20, size: 120, rough: 90, bias: 0, speckle: 40, mono: true } },
    'Sumi-e': { color: duo('#141414', '#F3EFE6'), film: { soft: 40 }, adj: { contrast: 25, brightness: 10 }, grain: { amount: 15, size: 200, rough: 60, bias: -30, speckle: 10, mono: true } },
    'Y2K': { color: pal(['#0A0A23', '#3F8EFC', '#B8F2FF', '#E0E0E0', '#FF7AC6']), film: { look: 'ccd', mix: 80, bloom: 30 }, adj: { saturation: 20 } },
    // ---------- retrô ----------
    'Pixel Pastel': { pixel: { size: 4 }, dither: { mode: 'bayer8', intensity: 80 }, color: pal(['#2B2D42', '#8D99AE', '#EDF2F4', '#F4ACB7', '#FFCAD4', '#9D8189']) },
    'NES': { pixel: { size: 4 }, dither: { mode: 'nintendo_ds', intensity: 90 }, color: pal(['#000000', '#FCFCFC', '#BCBCBC', '#7C7C7C', '#A4E4FC', '#3CBCFC', '#0078F8', '#F8B8F8', '#F878F8', '#D800CC', '#F87858', '#F83800', '#FCE0A8', '#F8B800', '#B8F818', '#00A800']) },
    'PICO-8': { pixel: { size: 5 }, dither: { mode: 'bayer8', intensity: 70 }, color: pal(['#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8', '#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA']) },
    'Filmadora 85': { film: { look: 'vhscam', mix: 100 }, fx: { id: 'vhs', mix: 70 } },
    'Cyber-shot 2004': { film: { look: 'ccd', mix: 100 } },
    // ---------- impressão ----------
    'Risografia': { dither: { mode: 'halftone', scale: 2, intensity: 120 }, color: pal(['#1D3557', '#FF5F7E', '#F7F1E3']), grain: { amount: 18, size: 120, rough: 70, bias: 0, speckle: 20, mono: true }, adj: { contrast: 20 } },
    'Serigrafia': { color: pal(['#101010', '#F2E8CF', '#E4572E', '#29335C']), adj: { contrast: 35, posterize: 45 }, grain: { amount: 12, size: 100, rough: 90, bias: 0, speckle: 35, mono: true } },
    'Blueprint': { color: duo('#0B3C8C', '#E8F1FF'), fx: { id: 'hatching', mix: 40 }, fxParams: { hatching: { uFg_r: 0.9, uFg_g: 0.95, uFg_b: 1, uBg_r: 0.04, uBg_g: 0.24, uBg_b: 0.55 } } },
};

const PRESET_GROUPS = [
    ['Movimentos', ['Impressionismo', 'Pontilhismo', 'Fauvismo', 'Expressionismo', 'Cubismo', 'Futurismo', 'Suprematismo', 'Construtivismo', 'Bauhaus', 'Art Nouveau', 'Art Déco', 'Surrealismo', 'Dadá', 'Pop Art', 'Op Art', 'Minimalismo', 'Psicodelia', 'Memphis']],
    ['Artistas', ['Van Gogh', 'Klimt', 'Hokusai', 'Munch', 'Mondrian', 'Kandinsky', 'Lichtenstein', 'Warhol', 'Rothko', 'Hopper']],
    ['Brasil', ['Tarsila', 'Tropicália', 'Cordel', 'Oiticica', 'Neoconcreto', 'Azulejo']],
    ['Filme', ['Kodachrome', 'Kodachrome 25', 'Ektachrome', 'Portra 160', 'Portra', 'Portra 800', 'Gold 200', 'Ultramax', 'ColorPlus', 'Ektar', 'Velvia', 'Provia', 'Pro 400H', 'Superia', 'CineStill 50D', 'CineStill', 'Vision3 500T', 'Tri-X', 'HP5', 'Acros', 'Noir', 'Polaroid', 'Instax', 'Super 8', 'Aerochrome', 'Vinheta Noir', 'Cianotipo']],
    ['Câmeras', ['Contax T2', 'Olympus mju', 'Hasselblad', 'Filmadora 85', 'Cyber-shot 2004']],
    ['Estéticas', ['Vaporwave', 'Synthwave', 'Cyberpunk', 'Y2K', 'Glitch art', 'Brutalismo', 'Estilo Suíço', 'Stencil', 'Sumi-e', 'LSD', 'Néon Noturno', 'Datamosh', 'Matrix']],
    ['Retrô', ['GameBoy', 'NES', 'PICO-8', 'Nintendo DS', 'CGA 4-Color', 'Bayer Fino', 'Pixel Pastel', 'Câmera de Segurança', 'KGB']],
    ['Impressão', ['Manga', 'Jornal Impresso', 'CMYK', 'Risografia', 'Serigrafia', 'Blueprint', 'Recibo', 'Propaganda', 'Comunismo', 'Duotone', 'Degrade Linear', 'Degrade Radial']],
    ['Digital', ['Termovisão', 'Raio-X', 'Bloom', 'Negativo']],
];


// Converte o formato antigo (getStateObject da versão 2fa6a2b) para o estado atual.
function fromLegacy(p) {
    const st = freshState();
    const num = (v, d) => (v === undefined || v === null || v === '' ? d : +v);
    st.pixel.size = num(p.px, 1); st.pixel.scale = num(p.iSca, 100);
    st.adj.exposure = num(p.exp, 0); st.adj.brightness = num(p.bri, 0); st.adj.shadows = num(p.som, 0); st.adj.saturation = num(p.sat, 0);
    st.adj.contrast = num(p.cont, 0); st.adj.temperature = num(p.temp, 0); st.adj.posterize = num(p.post, 0); st.adj.rgbShift = num(p.rSht, 0);
    st.adj.shadowsInverted = !!p.shInv;
    st.dither.mode = p.dith || 'none'; st.dither.scale = num(p.dScale, 1); st.dither.intensity = num(p.dInt, 100); st.dither.opacity = num(p.tOpa, 100); st.dither.midOnly = !!p.effMidDither;
    st.bg.fill = !!p.fillBg; if (p.bgColor) st.bg.color = p.bgColor;
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
        const F = p.film, m = { filmLook: 'look', filmMix: 'mix', filmTemp: 'temp', filmGrainAmt: 'grainAmt', filmFrame: 'frame', filmFrameColor: 'frameColor', filmStamp: 'stamp', filmStampColor: 'stampColor', lensVigColor: 'vigColor', lensLeakColor: 'leakColor', lensVignette: 'vignette', lensHalation: 'halation', lensBloom: 'bloom', lensSoft: 'soft', lensDistort: 'distort', lensChroma: 'chroma', lensLeak: 'leak', lensDust: 'dust', lensFlash: 'flash' };
        for (const k in m) if (F[k] !== undefined) f[m[k]] = typeof f[m[k]] === 'number' ? +F[k] : F[k];
        const look = FILM_LOOKS[f.look]; if (look && look.fx && F.filmParams) st.fxParams[look.fx] = Object.assign({}, F.filmParams);
    }
    if (p.filmVencidoVariant !== undefined) f.vencido = +p.filmVencidoVariant;
    if (p.filmLumiereHue !== undefined && +p.filmLumiereHue) f.lumiereHue = +p.filmLumiereHue;
    if (p.anim) { const A = st.anim; for (const k in p.anim) { const nk = k.replace(/^anim/, ''); const key = nk.charAt(0).toLowerCase() + nk.slice(1); if (A[key] !== undefined) A[key] = typeof A[key] === 'number' ? +p.anim[k] : typeof A[key] === 'boolean' ? !!p.anim[k] : p.anim[k]; } }
    return st;
}

// estado de um preset pelo nome
function presetState(name, userPresets) {
    if (userPresets && userPresets[name]) return normalizeState(userPresets[name]);
    if (MODERN_PRESETS[name]) return normalizeState(MODERN_PRESETS[name]);
    if (LEGACY_PRESETS[name]) return fromLegacy(LEGACY_PRESETS[name]);
    return null;
}
// lê configurações embutidas num arquivo (PNG exportado ou .txt)
function parseMeta(text) {
    const m = text.match(/PIXELAR_META:(\{.*\})/s); if (!m) return null;
    try { const p = JSON.parse(m[1]); return p.v === 2 ? normalizeState(p) : fromLegacy(p); } catch (e) { return null; }
}
