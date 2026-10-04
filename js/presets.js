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
// Paleta como mapa de tons: as cores (do escuro ao claro) se espalham pela luz da foto,
// então QUALQUER imagem usa a paleta inteira da obra (em vez de cair em duas ou três cores).
const tone = (list) => {
    const lum = (h) => { const c = hexToRgb(h); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };
    const sorted = list.slice().sort((x, y) => lum(x) - lum(y)), n = sorted.length;
    const ref = sorted.map((_, i) => { const v = Math.round(18 + 219 * (n > 1 ? i / (n - 1) : 0.5)); return rgbToHex(v, v, v); });
    return { sel: String(n), mode: 'preset', base: sorted, ref };
};
const G = (amount, rough = 70, size = 160, mono = true) => ({ amount, size, rough, bias: 0, speckle: 10, mono });
const MODERN_PRESETS = {

    // ---------- obras (pinturas famosas) ----------
    'Noite Estrelada': { color: tone(['#0B1437', '#1B3A7A', '#2F6DB5', '#6FA3D8', '#C9D9A0', '#F2D04B', '#F7E9A0']), dither: { mode: 'floyd_approx', scale: 2, intensity: 110 }, fx: { id: 'warp', mix: 100 }, fxParams: { warp: { uAmount: 0.014, uFreq: 12, uPhase: 0.4, uDuo: 0 } }, grain: G(16, 90, 220, false), adj: { saturation: 20, contrast: 12 } },
    'A Grande Onda': { color: tone(['#0E1B33', '#1F3F6E', '#3F6FA0', '#9CB9CF', '#E8E0CB', '#F4EEDF']), edge: { size: 1, color: '#0E1B33', opacity: 65 }, grain: G(12, 60, 140), adj: { contrast: 14 } },
    'O Grito': { color: tone(['#1B2440', '#3B5B7E', '#C4501F', '#E67E22', '#F2B544', '#E9D3A0']), fx: { id: 'warp', mix: 100 }, fxParams: { warp: { uAmount: 0.03, uFreq: 5, uPhase: 1.2, uDuo: 0 } }, film: { soft: 12 }, grain: G(14, 80, 200, false) },
    'Girassóis': { color: tone(['#3A2A12', '#7A5418', '#C68A1E', '#E9B92E', '#F4D86B', '#FFF1B8']), dither: { mode: 'floyd_approx', scale: 2, intensity: 95 }, grain: G(20, 90, 220, false), adj: { saturation: 25, temperature: 15 } },
    'Moça com Brinco de Pérola': { color: tone(['#0C0D10', '#1E2A44', '#3C5A8A', '#8C7A55', '#C9A35B', '#EFE3C2']), film: { soft: 18, vignette: 45 }, grain: G(10, 60, 180), adj: { contrast: 18, shadows: -15 } },
    'Nighthawks': { color: tone(['#0D1A1A', '#1F4038', '#3F7A62', '#A83A2A', '#C7B26A', '#F1E7B8']), film: { look: 'gold200', mix: 50, vignette: 30 }, adj: { contrast: 15 } },
    'O Beijo': { color: tone(['#1E140A', '#5A3C12', '#A67C22', '#D9B24C', '#F3E3A0']), dither: { mode: 'checkerboard', scale: 3, intensity: 85 }, film: { bloom: 30, halation: 18 }, adj: { temperature: 20 } },
    'Impressão, Nascer do Sol': { color: tone(['#23344A', '#4A6B85', '#8FA6B2', '#C9B8A0', '#E86F2C']), film: { soft: 30, bloom: 25 }, grain: G(16, 85, 240, false), adj: { contrast: -10 } },
    'Ninfeias': { color: tone(['#1F3B3A', '#3F6B5E', '#7FA69A', '#B5C9D6', '#E3B9C9', '#F2E6D8']), film: { soft: 34, bloom: 20 }, grain: G(14, 80, 220, false), adj: { contrast: -12, brightness: 6 } },
    'Tarde de Domingo': { pixel: { size: 2 }, color: tone(['#23402F', '#5E8A4A', '#6FA0C8', '#D86A4A', '#A9C27A', '#E8E0B0']), dither: { mode: 'noise', scale: 2, intensity: 170 }, adj: { saturation: 20 } },
    'Nascimento de Vênus': { color: tone(['#2E4A4A', '#7A9A8A', '#B98A6A', '#CDBA8A', '#EBD8B8', '#F7EDE2']), film: { soft: 22, look: 'portra160', mix: 45 }, grain: G(10, 70, 200) },
    'Ronda Noturna': { color: tone(['#0B0805', '#2A1C0E', '#6B4A1E', '#C49A4A', '#F0D890']), film: { vignette: 55, soft: 10 }, adj: { contrast: 28, shadows: -25 }, grain: G(12, 70, 180) },
    'Abaporu': { color: tone(['#2F6B3A', '#7FB3D5', '#D9643A', '#F2A12E', '#E8C66A', '#F6E7C1']), film: { soft: 18 }, adj: { saturation: 30, posterize: 15 } },
    'Operários': { color: tone(['#2A2622', '#5B4B3E', '#8C735A', '#B89A77', '#D9C3A0', '#EFE3CC']), edge: { size: 1, color: '#2A2622', opacity: 45 }, adj: { contrast: 10, saturation: -20 } },
    'Retirantes': { color: tone(['#141414', '#3A3530', '#6A6258', '#8C8A86', '#C4B8A6', '#E6DDCF']), fx: { id: 'warp', mix: 60 }, fxParams: { warp: { uAmount: 0.012, uFreq: 6, uPhase: 0, uDuo: 0 } }, grain: G(22, 90, 200) },
    'A Boba': { color: tone(['#1E2A3A', '#2E6A5A', '#C93A2A', '#E8C63A', '#F2E6C9']), fx: { id: 'warp', mix: 100 }, fxParams: { warp: { uAmount: 0.02, uFreq: 7, uPhase: 2, uDuo: 0 } }, adj: { saturation: 30, contrast: 15 } },
    'Guernica': { color: tone(['#0A0A0A', '#3A3A3A', '#7A7A7A', '#BDBDBD', '#F4F4F4']), fx: { id: 'pixelate_fx', mix: 100 }, fxParams: { pixelate_fx: { uSizeX: 22, uSizeY: 12 } }, edge: { size: 2, color: '#0A0A0A', opacity: 90 }, adj: { contrast: 35 } },
    // ---------- mais artistas ----------
    'Monet': { color: tone(['#2B3F5C', '#5F7FA0', '#9FB7C9', '#D7C7A6', '#F2D7C2', '#FBF3E6']), film: { soft: 32, bloom: 30 }, grain: G(18, 90, 240, false), adj: { contrast: -12, saturation: 12 } },
    'Seurat': { pixel: { size: 2 }, dither: { mode: 'noise', scale: 1, intensity: 190 }, color: tone(['#1E3050', '#4F6F9F', '#E0703A', '#9CC060', '#F4D35E', '#FFF7E0']), adj: { saturation: 20 } },
    'Vermeer': { color: tone(['#0E0E14', '#1B2B4B', '#3E5E8C', '#A48A5A', '#E3CC8E', '#F5ECD2']), film: { soft: 16, vignette: 40, halation: 12 }, adj: { contrast: 15 } },
    'Rembrandt': { color: tone(['#060403', '#24160A', '#5E3E18', '#A77B3A', '#E7C77E']), film: { vignette: 60 }, adj: { contrast: 30, shadows: -30, temperature: 18 }, grain: G(10, 60, 160) },
    'Caravaggio': { color: tone(['#030303', '#1E1410', '#5A3524', '#A8613A', '#E8B17A', '#F7E3C6']), film: { vignette: 50 }, adj: { contrast: 42, shadows: -35 } },
    'Turner': { color: tone(['#4A3B2A', '#9C7B4E', '#D9B56C', '#F2D48A', '#FBEBC4', '#FFFBEF']), film: { soft: 45, bloom: 50, halation: 20 }, adj: { contrast: -20, brightness: 12 } },
    'Matisse': { color: tone(['#1B2F6B', '#E23B2E', '#2F8F5B', '#F2B6C6', '#F7E36A', '#FDF6E3']), adj: { posterize: 55, saturation: 40, contrast: 15 } },
    'Hilma af Klint': { color: tone(['#2B2A4C', '#C0504D', '#E8A0B4', '#F2C38B', '#A7C4A0', '#F6EEDD']), grad: { on: true, type: 'radial', colors: ['#F2C38B', '#E8A0B4'], blend: 'softlight', opacity: 35 }, film: { soft: 12 }, adj: { posterize: 30 } },
    'Frida': { color: tone(['#1F3A2A', '#3E6B3A', '#8A2D2A', '#C9452C', '#E8A33A', '#F2D7A6']), adj: { saturation: 35, contrast: 12 }, grain: G(10, 70, 160, false) },
    'Portinari': { color: tone(['#1D2433', '#3F5673', '#7A8FA6', '#B9794B', '#D9B68C', '#F0E4CF']), edge: { size: 1, color: '#1D2433', opacity: 40 }, adj: { saturation: 5, contrast: 12 } },
    'Di Cavalcanti': { color: tone(['#3A1A12', '#8A3A1E', '#2E5A4A', '#D9743A', '#F2C66A', '#F7E8C8']), film: { soft: 14 }, adj: { saturation: 30, temperature: 15 } },
    'Magritte': { color: tone(['#1C2A44', '#3C6E9F', '#7FB1D9', '#C9DDEB', '#F4F1E8']), film: { soft: 10 }, adj: { contrast: 8, saturation: -5 } },
    'Kusama': { dither: { mode: 'halftone', scale: 6, intensity: 150 }, color: tone(['#C8102E', '#F4F1EA']), adj: { contrast: 40 } },
    'Haring': { color: tone(['#111111', '#E23B2E', '#F7D002', '#2F6BD8', '#F5F5F0']), edge: { size: 3, color: '#111111', opacity: 100 }, adj: { posterize: 70, contrast: 30 } },
    // ---------- paletas icônicas ----------
    'Technicolor': { color: tone(['#101820', '#0B6E99', '#E23E57', '#F9C74F', '#F4F1DE']), film: { look: 'techni3', mix: 55 }, adj: { saturation: 20 } },
    'Miami 86': { color: tone(['#1B0B3A', '#6A1B9A', '#F72585', '#4CC9F0', '#F8F7FF']), film: { bloom: 35, halation: 20 }, adj: { contrast: 15 } },
    'Tóquio Neon': { color: tone(['#07010F', '#2B0F54', '#AB1F65', '#FF4F69', '#00E5FF', '#FFF7F8']), dither: { mode: 'scanlines', scale: 2, intensity: 45 }, film: { bloom: 45, halation: 30 } },
    'Aurora Boreal': { color: tone(['#04151F', '#183A37', '#1F7A6C', '#5FD3A5', '#B388EB', '#E8FFF4']), film: { bloom: 35, soft: 12 } },
    'Deserto': { color: tone(['#2B1B17', '#6E3B2A', '#C0703E', '#E7A868', '#F6DDB6']), film: { look: 'gold200', mix: 40 }, grain: G(12, 60, 180) },
    'Pêssego': { color: tone(['#3D2C3E', '#8E5572', '#E29578', '#FFDDD2', '#FFF4EC']), film: { soft: 20, bloom: 20 } },
    'Lavanda': { color: tone(['#231942', '#5E548E', '#9F86C0', '#E0B1CB', '#FBF4F9']), film: { soft: 18, bloom: 18 } },
    'Menta e Cereja': { color: tone(['#1A1423', '#3D7068', '#D7263D', '#8FC9A8', '#F2E8DC']), adj: { contrast: 12 } },
    'Commodore 64': { pixel: { size: 4 }, dither: { mode: 'bayer8', intensity: 70 }, color: pal(['#000000', '#FFFFFF', '#880000', '#AAFFEE', '#CC44CC', '#00CC55', '#0000AA', '#EEEE77', '#DD8855', '#664400', '#FF7777', '#333333', '#777777', '#AAFF66', '#0088FF', '#BBBBBB']) },
    'ZX Spectrum': { pixel: { size: 4 }, dither: { mode: 'checkerboard', intensity: 60 }, color: pal(['#000000', '#0000D7', '#D70000', '#D700D7', '#00D700', '#00D7D7', '#D7D700', '#D7D7D7']) },
    'Macintosh 1-bit': { pixel: { size: 2 }, dither: { mode: 'floyd_approx', intensity: 110 }, color: pal(['#000000', '#FFFFFF']) },
    'Teletexto': { pixel: { size: 8 }, color: pal(['#000000', '#FF0000', '#00FF00', '#FFFF00', '#0000FF', '#FF00FF', '#00FFFF', '#FFFFFF']), adj: { contrast: 20 } },

    // ---------- texturas (filtros novos) ----------
    'Terminal': { fx: { id: 'ascii', mix: 100 }, fxParams: { ascii: { uCell: 9, uContrast: 1.5, uColorMode: 0, uInk_r: 0.486, uInk_g: 1.000, uInk_b: 0.608, uPaper_r: 0.012, uPaper_g: 0.067, uPaper_b: 0.039 } }, film: { bloom: 25 } },
    'ASCII colorido': { fx: { id: 'ascii', mix: 100 }, fxParams: { ascii: { uCell: 8, uContrast: 1.4, uColorMode: 1, uPaper_r: 0.020, uPaper_g: 0.020, uPaper_b: 0.020 } }, adj: { saturation: 30 } },
    'Monitor CRT': { fx: { id: 'crt', mix: 100 }, fxParams: { crt: { uPitch: 3.5, uMask: 0.6, uScan: 0.5, uCurve: 0.14, uGlow: 0.45 } }, adj: { saturation: 15, contrast: 10 } },
    'Arcade': { pixel: { size: 4 }, color: pal(['#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#FF004D', '#FFA300', '#FFEC27', '#29ADFF', '#FFF1E8']), fx: { id: 'crt', mix: 100 }, fxParams: { crt: { uPitch: 4, uMask: 0.5, uScan: 0.55, uCurve: 0.18, uGlow: 0.5 } } },
    'Hama beads': { fx: { id: 'beads', mix: 100 }, fxParams: { beads: { uCell: 16, uHole: 0.3, uShine: 0.6 } }, color: tone(['#1B1B3A', '#693668', '#A74482', '#F84AA7', '#FF9F1C', '#FFD23F', '#F7F7FF']), adj: { saturation: 20 } },
    'Tricô da vó': { fx: { id: 'knit', mix: 100 }, fxParams: { knit: { uCell: 14, uDepth: 0.7, uFuzz: 0.5 } }, color: tone(['#2B2D42', '#8D2B2B', '#D9A441', '#E9DCC9', '#FFFFFF']) },
    'Pastilhas': { fx: { id: 'mosaic_tiles', mix: 100 }, fxParams: { mosaic_tiles: { uCell: 18, uGrout: 0.14, uBevel: 0.6 } }, adj: { saturation: 15 } },
    'Tijolinhos': { fx: { id: 'mosaic_tiles', mix: 100 }, fxParams: { mosaic_tiles: { uCell: 14, uGrout: 0.12, uBrick: 1, uBevel: 0.5, uGrout_r: 0.847, uGrout_g: 0.812, uGrout_b: 0.769 } }, color: tone(['#3A1F1A', '#7A3B2E', '#B5573F', '#D98C64', '#EBC9A6']) },
    'Holograma': { fx: { id: 'hologram', mix: 100 }, fxParams: { hologram: { uAmount: 0.75, uBands: 2.5, uShift: 1.4, uLines: 0.3 } }, film: { bloom: 25 } },
    'Mapa topográfico': { fx: { id: 'contour', mix: 100 }, fxParams: { contour: { uLevels: 12, uThickness: 1.3, uFill: 0.25 } } },
    'Curvas de nível': { fx: { id: 'contour', mix: 100 }, fxParams: { contour: { uLevels: 18, uThickness: 1, uFill: 0, uInk_r: 0.949, uInk_g: 0.914, uInk_b: 0.863, uPaper_r: 0.106, uPaper_g: 0.165, uPaper_b: 0.255 } } },
    'Noite de estrelas': { fx: { id: 'starlight', mix: 100 }, fxParams: { starlight: { uThreshold: 0.62, uLength: 46, uIntensity: 2, uDiagonal: 0.6 } }, adj: { contrast: 15, exposure: -8 } },
    'Pontilhista': { fx: { id: 'stipple', mix: 100 }, fxParams: { stipple: { uCell: 5, uJitter: 0.9, uGamma: 1.3 } } },
    'Xilo nordestina': { fx: { id: 'woodcut', mix: 100 }, fxParams: { woodcut: { uSpacing: 6, uWarp: 1.6, uContrast: 1.5 } } },
    'Pulsar': { fx: { id: 'mesh_lines', mix: 100 }, fxParams: { mesh_lines: { uSpacing: 12, uHeight: 80, uThickness: 1.6 } }, adj: { contrast: 20 } },
    'Papel de arroz': { fx: { id: 'paper', mix: 100 }, fxParams: { paper: { uFiber: 0.8, uGrain: 0.4, uWarmth: 0.5, uFade: 0.18 } }, film: { soft: 10 }, adj: { saturation: -15 } },
    'Vidro canelado': { fx: { id: 'fluted_glass', mix: 100 }, fxParams: { fluted_glass: { uRib: 26, uStrength: 1, uShade: 0.4 } } },
    'Gibi CMYK': { fx: { id: 'cmyk_halftone', mix: 100 }, fxParams: { cmyk_halftone: { uCell: 7, uDot: 1.1 } }, adj: { saturation: 35, contrast: 15 } },
    'Riso duplo': { fx: { id: 'duo_halftone', mix: 100 }, fxParams: { duo_halftone: { uCell: 7, uColorA_r: 0.114, uColorA_g: 0.208, uColorA_b: 0.341, uColorB_r: 1.000, uColorB_g: 0.373, uColorB_b: 0.494 } } },
    'Riso verde e laranja': { fx: { id: 'duo_halftone', mix: 100 }, fxParams: { duo_halftone: { uCell: 8, uColorA_r: 0.000, uColorA_g: 0.514, uColorA_b: 0.431, uColorB_r: 1.000, uColorB_g: 0.424, uColorB_b: 0.184 } } },
    'Ondas': { fx: { id: 'water', mix: 100 }, fxParams: { water: { uAmount: 1, uScale: 1.2, uCaustics: 0.6 } }, adj: { temperature: -12, saturation: 10 } },
    'Câmera térmica': { fx: { id: 'thermal', mix: 100 }, fxParams: { thermal: { uContrast: 1.3, uBlur: 0.8 } } },
    'Baixo-relevo': { fx: { id: 'emboss', mix: 100 }, fxParams: { emboss: { uStrength: 2, uColorMix: 0.15 } } },
    'Bitmap 1-bit': { fx: { id: 'bitmap', mix: 100 }, fxParams: { bitmap: { uThreshold: 0.5, uNoise: 0.35 } } },
    'Nanquim': { fx: { id: 'edge_ink', mix: 100 }, fxParams: { edge_ink: { uThickness: 1.2, uThreshold: 0.1, uWash: 0.3 } } },
    'Limiar pop': { fx: { id: 'color_threshold', mix: 100 }, fxParams: { color_threshold: { uThreshold: 0.5, uSoft: 0.03, uSplit: 0.15 } } },
    'Lente fantasma': { fx: { id: 'ghost_lens', mix: 100 }, fxParams: { ghost_lens: { uIntensity: 1.2, uThreshold: 0.65, uSpread: 0.7, uHalo: 0.5 } }, film: { bloom: 30, halation: 15 } },
    'Ácido': { fx: { id: 'acid', mix: 100 }, fxParams: { acid: { uAmount: 0.85, uWarp: 0.8, uSat: 1.8 } } },
    'Néon traçado': { fx: { id: 'neon_trace', mix: 100 }, fxParams: { neon_trace: { uThickness: 1.4, uGlow: 1.2, uThreshold: 0.08, uBg: 0.08 } } },
    'Pincelada': { fx: { id: 'smudge', mix: 100 }, fxParams: { smudge: { uLength: 34, uFlow: 0.9 } }, adj: { saturation: 20 }, grain: G(12, 80, 200, false) },
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
    'Expressionismo': { fx: { id: 'warp', mix: 100 }, fxParams: { warp: { uAmount: 0.02, uFreq: 9, uPhase: 0, uDuo: 0 } }, color: tone(['#141432', '#2E4A8B', '#C8452C', '#EE8A3C', '#F6D98A']), dither: { mode: 'floyd_approx', intensity: 70 }, adj: { contrast: 20 } },
    'Cubismo': { fx: { id: 'pixelate_fx', mix: 100 }, fxParams: { pixelate_fx: { uSizeX: 26, uSizeY: 14 } }, edge: { size: 1, color: '#2A2118', opacity: 80 }, color: tone(['#2A2118', '#6E5638', '#A88B5E', '#D8C79E', '#58675F', '#8E3B2B']) },
    'Futurismo': { fx: { id: 'slice_shift', mix: 90 }, fxParams: { slice_shift: { uSlices: 18, uShift: 0.06, uSeed: 3 } }, color: tone(['#101010', '#B71C1C', '#E0E0E0', '#F4A300', '#37474F']), adj: { contrast: 25 } },
    'Suprematismo': { pixel: { size: 6 }, adj: { contrast: 35, posterize: 30 }, color: tone(['#111111', '#F4EFE6', '#C8102E', '#1F3A93', '#E8B400']) },
    'Construtivismo': { color: duo('#141414', '#C62828', '#F1E6D0'), dither: { mode: 'halftone', scale: 3, intensity: 110 }, adj: { contrast: 30 } },
    'Art Nouveau': { color: tone(['#2F3B2A', '#6F7F4E', '#C9A86A', '#E9D8B0', '#A45A3F']), film: { look: 'kodak_verde', mix: 40, soft: 20, vignette: 25 }, edge: { size: 1, color: '#2F3B2A', opacity: 60 }, adj: { saturation: -10 } },
    'Art Déco': { color: tone(['#0E0E0E', '#1F4E4A', '#C9A646', '#EDE0C0']), grad: { on: true, type: 'conic', colors: ['#0E0E0E', '#C9A646', '#0E0E0E'], steps: 16, blend: 'overlay', opacity: 35, repeat: 2 }, adj: { contrast: 20 } },
    'Surrealismo': { film: { look: 'aerochrome', mix: 70, soft: 25 }, adj: { temperature: -10, saturation: 10 }, grad: { on: true, type: 'radial', colors: ['#FFE9C7', '#3C2A6B'], blend: 'softlight', opacity: 45 } },
    'Dadá': { fx: { id: 'photocopy', mix: 100 }, fxParams: { photocopy: { uContrast: 2.6, uGrain: 0.22, uStreaks: 0.45 } }, dither: { mode: 'halftone', scale: 2, intensity: 90 } },
    'Op Art': { color: duo('#0A0A0A', '#F5F5F0'), dither: { mode: 'checkerboard', scale: 6, intensity: 170 }, adj: { contrast: 40 } },
    'Minimalismo': { color: duo('#2B2B2B', '#EDEBE6'), adj: { contrast: -15, posterize: 55 }, film: { soft: 15 } },
    'Psicodelia': { color: tone(['#2B0A3D', '#7B1FA2', '#E91E63', '#FF9800', '#FFEB3B', '#4CAF50', '#00BCD4', '#FFFFFF']), grad: { on: true, type: 'spiral', colors: ['#FF00A0', '#FFE600', '#00E5FF'], blend: 'overlay', opacity: 55, repeat: 3 }, adj: { saturation: 60 }, dither: { mode: 'bayer8', intensity: 60 } },
    // ---------- artistas ----------
    'Van Gogh': { color: tone(['#0B1D51', '#1F4E9A', '#4F7CC2', '#9EC1E6', '#F2D64B', '#F7B32B', '#2E5E3A']), dither: { mode: 'floyd_approx', scale: 2, intensity: 120 }, fx: { id: 'warp', mix: 100 }, fxParams: { warp: { uAmount: 0.012, uFreq: 14, uPhase: 0, uDuo: 0 } }, grain: { amount: 18, size: 220, rough: 90, bias: 0, speckle: 30, mono: false }, adj: { saturation: 35, contrast: 15 } },
    'Klimt': { color: tone(['#2A1A0A', '#6B4A1B', '#B8862B', '#E3C16F', '#F7E7B4', '#3E5B3A']), dither: { mode: 'checkerboard', scale: 3, intensity: 90 }, film: { bloom: 35, halation: 20 }, adj: { temperature: 25, contrast: 10 } },
    'Hokusai': { color: tone(['#15233F', '#2E5E8C', '#7FA7C9', '#E9DFC7', '#C4553A']), edge: { size: 1, color: '#15233F', opacity: 70 }, film: { look: 'kodak_verde', mix: 30 }, grain: { amount: 10, size: 140, rough: 70, bias: 0, speckle: 0, mono: true }, adj: { contrast: 10 } },
    'Mondrian': { pixel: { size: 18 }, color: tone(['#111111', '#F5F5F0', '#D52B1E', '#1D4E9E', '#F7D002']), edge: { size: 3, color: '#111111', opacity: 100 }, adj: { contrast: 30, saturation: 30 } },
    'Lichtenstein': { dither: { mode: 'halftone', scale: 3, intensity: 130 }, color: tone(['#111111', '#F5F0E6', '#E63B2E', '#FFD23F', '#2F6BD8']), adj: { contrast: 25, saturation: 40 } },
    'Warhol': { color: duo('#1A0B3D', '#FF3EA5', '#FFE94E'), adj: { contrast: 45, posterize: 40 } },
    'Rothko': { film: { soft: 70, vignette: 30 }, grad: { on: true, type: 'linear', angle: 180, colors: ['#5A0F12', '#C2361F', '#E88A2E'], steps: 3, smooth: 30, blend: 'overlay', opacity: 75 }, adj: { saturation: -30, contrast: -10 }, grain: { amount: 12, size: 200, rough: 80, bias: 0, speckle: 0, mono: true } },
    'Hopper': { film: { look: 'gold200', mix: 80, vignette: 25 }, adj: { contrast: 18, shadows: -15, saturation: -5 }, color: { sel: '24', mode: 'original' } },
    'Kandinsky': { fx: { id: 'pattern_refraction', mix: 80 }, fxParams: { pattern_refraction: { uBands: 10, uShift: 0.03, uAngle: 0.6 } }, color: tone(['#101820', '#F2AA4C', '#D7263D', '#1B998B', '#2E86AB', '#F4F1DE']) },
    'Munch': { fx: { id: 'warp', mix: 100 }, fxParams: { warp: { uAmount: 0.035, uFreq: 5, uPhase: 1, uDuo: 0 } }, color: tone(['#1E1B3A', '#3D5A80', '#D9642C', '#F2A541', '#E8D6A8']), film: { soft: 20 }, adj: { saturation: 30 } },
    // ---------- Brasil ----------
    'Tarsila': { color: tone(['#2E5E3E', '#E9A23B', '#D9573B', '#F2D7A6', '#3A7CA5', '#6B3E26']), film: { soft: 25 }, adj: { saturation: 25, posterize: 20 } },
    'Tropicália': { color: tone(['#0B6E4F', '#F9C80E', '#F86624', '#EA3546', '#43BCCD', '#662E9B']), dither: { mode: 'halftone', scale: 2, intensity: 100 }, adj: { saturation: 55, contrast: 15 } },
    'Cordel': { fx: { id: 'hatching', mix: 100 }, fxParams: { hatching: { uScale: 9, uThreshold: 0.62, uFg_r: 0.08, uFg_g: 0.06, uFg_b: 0.05, uBg_r: 0.93, uBg_g: 0.88, uBg_b: 0.76 } }, adj: { contrast: 30 } },
    'Oiticica': { pixel: { size: 24 }, color: tone(['#F26A1B', '#E8341C', '#FFB400', '#FFE08A', '#8C1C13']), edge: { size: 1, color: '#8C1C13', opacity: 40 } },
    'Azulejo': { color: duo('#0F3D91', '#F4F4F0'), dither: { mode: 'bayer8', scale: 2, intensity: 110 }, pixel: { size: 2 }, adj: { contrast: 25 } },
    'Neoconcreto': { pixel: { size: 32 }, color: tone(['#1A1A1A', '#F2F0EA', '#D7263D', '#2D5DA1']), adj: { contrast: 40 }, edge: { size: 2, color: '#F2F0EA', opacity: 100 } },
    // ---------- estéticas ----------
    'Vaporwave': { color: tone(['#2D1B69', '#FF6AD5', '#C774E8', '#AD8CFF', '#94D0FF', '#FFFFFF']), dither: { mode: 'scanlines', scale: 2, intensity: 60 }, grad: { on: true, type: 'linear', angle: 180, colors: ['#FF6AD5', '#94D0FF'], blend: 'overlay', opacity: 45 }, adj: { rgbShift: 2 } },
    'Synthwave': { grad: { on: true, type: 'linear', angle: 180, colors: ['#2B1055', '#D53A9D', '#FFB347'], blend: 'color', opacity: 70 }, film: { bloom: 45, halation: 30 }, dither: { mode: 'scanlines', scale: 3, intensity: 50 }, adj: { contrast: 20, saturation: 30 } },
    'Cyberpunk': { color: duo('#08040F', '#00E5FF', '#FF2E97'), film: { bloom: 40 }, adj: { rgbShift: 3, contrast: 25 } },
    'Glitch art': { fx: { id: 'slice_shift', mix: 100 }, fxParams: { slice_shift: { uSlices: 24, uShift: 0.09, uSeed: 7 } }, adj: { rgbShift: 5 }, color: { sel: '16', mode: 'original' } },
    'Brutalismo': { color: duo('#1E1E1E', '#BDB8AE'), fx: { id: 'photocopy', mix: 70 }, grain: { amount: 25, size: 160, rough: 80, bias: 20, speckle: 30, mono: true }, adj: { contrast: 30 } },
    'Estilo Suíço': { color: duo('#E30613', '#F5F5F0'), dither: { mode: 'halftone', scale: 5, intensity: 140 }, adj: { contrast: 35 } },
    'Stencil': { color: tone(['#111111', '#F2F2F2']), adj: { contrast: 55, posterize: 70 }, grain: { amount: 20, size: 120, rough: 90, bias: 0, speckle: 40, mono: true } },
    'Sumi-e': { color: duo('#141414', '#F3EFE6'), film: { soft: 40 }, adj: { contrast: 25, brightness: 10 }, grain: { amount: 15, size: 200, rough: 60, bias: -30, speckle: 10, mono: true } },
    'Y2K': { color: tone(['#0A0A23', '#3F8EFC', '#B8F2FF', '#E0E0E0', '#FF7AC6']), film: { look: 'ccd', mix: 80, bloom: 30 }, adj: { saturation: 20 } },
    // ---------- retrô ----------
    'Pixel Pastel': { pixel: { size: 4 }, dither: { mode: 'bayer8', intensity: 80 }, color: pal(['#2B2D42', '#8D99AE', '#EDF2F4', '#F4ACB7', '#FFCAD4', '#9D8189']) },
    'NES': { pixel: { size: 4 }, dither: { mode: 'nintendo_ds', intensity: 90 }, color: pal(['#000000', '#FCFCFC', '#BCBCBC', '#7C7C7C', '#A4E4FC', '#3CBCFC', '#0078F8', '#F8B8F8', '#F878F8', '#D800CC', '#F87858', '#F83800', '#FCE0A8', '#F8B800', '#B8F818', '#00A800']) },
    'PICO-8': { pixel: { size: 5 }, dither: { mode: 'bayer8', intensity: 70 }, color: pal(['#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8', '#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA']) },
    'Filmadora 85': { film: { look: 'vhscam', mix: 100 }, fx: { id: 'vhs', mix: 70 } },
    'Cyber-shot 2004': { film: { look: 'ccd', mix: 100 } },
    // ---------- impressão ----------
    'Risografia': { dither: { mode: 'halftone', scale: 2, intensity: 120 }, color: tone(['#1D3557', '#FF5F7E', '#F7F1E3']), grain: { amount: 18, size: 120, rough: 70, bias: 0, speckle: 20, mono: true }, adj: { contrast: 20 } },
    'Serigrafia': { color: tone(['#101010', '#F2E8CF', '#E4572E', '#29335C']), adj: { contrast: 35, posterize: 45 }, grain: { amount: 12, size: 100, rough: 90, bias: 0, speckle: 35, mono: true } },
    'Blueprint': { color: duo('#0B3C8C', '#E8F1FF'), fx: { id: 'hatching', mix: 40 }, fxParams: { hatching: { uFg_r: 0.9, uFg_g: 0.95, uFg_b: 1, uBg_r: 0.04, uBg_g: 0.24, uBg_b: 0.55 } } },
};

const PRESET_GROUPS = [
    ['Obras', ['Noite Estrelada', 'A Grande Onda', 'O Grito', 'Girassóis', 'Moça com Brinco de Pérola', 'Nighthawks', 'O Beijo', 'Tarde de Domingo', 'Guernica', 'Abaporu', 'Operários', 'A Boba', 'Tarsila', 'Oiticica', 'Neoconcreto', 'Azulejo']],
    ['Artistas', ['Van Gogh', 'Monet', 'Seurat', 'Vermeer', 'Turner', 'Munch', 'Matisse', 'Hilma af Klint', 'Mondrian', 'Kandinsky', 'Magritte', 'Lichtenstein', 'Warhol', 'Rothko', 'Kusama']],
    ['Movimentos e impressão', ['Impressionismo', 'Pontilhismo', 'Expressionismo', 'Cubismo', 'Suprematismo', 'Construtivismo', 'Bauhaus', 'Dadá', 'Pop Art', 'Minimalismo', 'Manga', 'Jornal Impresso', 'CMYK', 'Serigrafia', 'Propaganda', 'Comunismo', 'Duotone', 'Cianotipo']],
    ['Texturas e retrô', ['Terminal', 'Arcade', 'Hama beads', 'Tricô da vó', 'Curvas de nível', 'Noite de estrelas', 'Pontilhista', 'Papel de arroz', 'Gibi CMYK', 'Riso duplo', 'Riso verde e laranja', 'GameBoy', 'CGA 4-Color', 'Câmera de Segurança', 'KGB', 'ZX Spectrum', 'Macintosh 1-bit', 'Teletexto', 'Termovisão', 'Negativo']],
    ['Estéticas e cor', ['Vaporwave', 'Synthwave', 'Cyberpunk', 'Y2K', 'Glitch art', 'Brutalismo', 'Estilo Suíço', 'Stencil', 'Sumi-e', 'LSD', 'Néon Noturno', 'Datamosh', 'Matrix', 'Technicolor', 'Tóquio Neon', 'Aurora Boreal', 'Lavanda', 'Portra', 'Bloom']],
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
