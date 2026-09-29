/* Pixelar — Muse: variações inteligentes.
 *
 * Em vez de sortear parâmetros às cegas, o Muse:
 *   1. LÊ a foto: tons (chave alta/baixa, contraste), cor (colorido, matizes dominantes, clima quente/frio),
 *      textura (bordas, áreas lisas), e o que ela provavelmente mostra (pele/retrato, céu e verde/paisagem,
 *      noite, arte gráfica, foto quase P&B).
 *   2. ESCOLHE FAMÍLIAS de estilo com pesos que dependem dessa leitura (um retrato puxa filme e pintura,
 *      uma cena noturna puxa néon, uma arte chapada puxa gráfico e pixel...).
 *   3. GERA um "genoma" por candidato: paleta (harmonias no espaço OKLCH a partir das cores da própria
 *      foto, ou paletas de obras e estéticas com afinidade de matiz), mapa de tons ajustado à luz da foto,
 *      pixel, padrão, textura, filme, grão, contorno, degradê e luz.
 *   4. PONTUA cada candidato com critérios estéticos: legibilidade (escala de luz da paleta), harmonia
 *      de matizes, afinidade com a foto, segurança da pele em retratos, preservação de detalhe, coerência
 *      com a chave de luz, novidade em relação ao que já foi mostrado e o gosto aprendido da pessoa.
 *   5. SELECIONA os melhores com diversidade (MMR): nada de doze variações parecidas.
 *   6. EVOLUI: "Parecidas" cria mutações da variação escolhida; cada escolha ensina o gosto (salvo no aparelho).
 */
'use strict';
const Muse = (() => {
    // ---------------- números e acaso reproduzível ----------------
    const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
    const lerp = (a, b, t) => a + (b - a) * t;
    function rng(seed) { let s = seed >>> 0; return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
    const pickW = (R, items, w) => { let s = 0; for (const x of w) s += Math.max(0, x); let r = R() * s; for (let i = 0; i < items.length; i++) { r -= Math.max(0, w[i]); if (r <= 0) return items[i]; } return items[items.length - 1]; };
    const pick = (R, a) => a[Math.floor(R() * a.length)];

    // ---------------- cor: sRGB ↔ OKLab/OKLCH ----------------
    const toLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const toGam = (c) => { const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.round(clamp(v, 0, 1) * 255); };
    function rgb2lab(r, g, b) {
        r = toLin(r); g = toLin(g); b = toLin(b);
        const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
        const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
        const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
        return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
    }
    function lab2lin(L, a, b) {
        const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
        return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
    }
    // OKLCH → hex, reduzindo o croma até caber no sRGB (mantém luz e matiz)
    function lch2hex(L, C, hDeg) {
        const h = hDeg * Math.PI / 180;
        let c = C;
        for (let i = 0; i < 24; i++) {
            const [r, g, b] = lab2lin(L, c * Math.cos(h), c * Math.sin(h));
            if (r >= -0.001 && r <= 1.001 && g >= -0.001 && g <= 1.001 && b >= -0.001 && b <= 1.001) return rgbToHex(toGam(r), toGam(g), toGam(b)).toUpperCase();
            c *= 0.9;
        }
        const [r, g, b] = lab2lin(L, 0, 0); return rgbToHex(toGam(r), toGam(g), toGam(b)).toUpperCase();
    }
    function hex2lch(hex) { const { r, g, b } = hexToRgb(hex); const [L, a, bb] = rgb2lab(r, g, b); return { L, C: Math.hypot(a, bb), h: (Math.atan2(bb, a) * 180 / Math.PI + 360) % 360, a, b: bb }; }
    const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
    const dE = (p, q) => Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);

    // ---------------- 1. leitura da foto ----------------
    const _c = document.createElement('canvas'), _x = _c.getContext('2d', { willReadFrequently: true });
    function analyze(src) {
        if (!src || !src.width) return null;
        const S = 96, k = S / Math.max(src.width, src.height), w = Math.max(8, Math.round(src.width * k)), h = Math.max(8, Math.round(src.height * k));
        _c.width = w; _c.height = h; _x.drawImage(src, 0, 0, w, h);
        const d = _x.getImageData(0, 0, w, h).data, n = w * h;
        const Ls = new Float32Array(n), As = new Float32Array(n), Bs = new Float32Array(n);
        const hueHist = new Float32Array(36);
        let sumL = 0, sumC = 0, skin = 0, skinC = 0, skinT = 0, sky = 0, green = 0, rgS = 0, ybS = 0, rgQ = 0, ybQ = 0, warm = 0;
        const cx0 = w * 0.2, cx1 = w * 0.8, cy0 = h * 0.15, cy1 = h * 0.9; let nC = 0, nT = 0;
        const topRows = Math.floor(h * 0.38);
        for (let i = 0, p = 0; p < n; i += 4, p++) {
            const r = d[i], g = d[i + 1], b = d[i + 2];
            const [L, a, bb] = rgb2lab(r, g, b); Ls[p] = L; As[p] = a; Bs[p] = bb;
            const C = Math.hypot(a, bb), hh = (Math.atan2(bb, a) * 180 / Math.PI + 360) % 360;
            sumL += L; sumC += C; warm += bb + 0.4 * a;
            if (C > 0.03) hueHist[Math.floor(hh / 10) % 36] += C;
            // pele: regra RGB clássica (várias etnias) + faixa de matiz/croma em OKLab (tira céus e laranjas saturados)
            const px = p % w, py = (p / w) | 0, central = px > cx0 && px < cx1 && py > cy0 && py < cy1, top = py < h * 0.25;
            if (central) nC++; if (top) nT++;
            if (r > 95 && g > 40 && b > 20 && r > g && r > b && (r - Math.min(g, b)) > 15 && Math.abs(r - g) > 15 && L > 0.4 && L < 0.9 && C > 0.03 && C < 0.13 && hh > 30 && hh < 85) { skin++; if (central) skinC++; if (top) skinT++; }
            if (p < topRows * w && hh > 200 && hh < 275 && L > 0.45) sky++;
            if (hh > 115 && hh < 165 && C > 0.04) green++;
            const rg = r - g, yb = 0.5 * (r + g) - b; rgS += rg; ybS += yb; rgQ += rg * rg; ybQ += yb * yb;
        }
        const meanL = sumL / n, meanC = sumC / n;
        const sorted = Array.from(Ls).sort((a, b) => a - b), q = (t) => sorted[Math.min(n - 1, Math.floor(t * n))];
        let v = 0; for (let p = 0; p < n; p++) v += (Ls[p] - meanL) ** 2; const stdL = Math.sqrt(v / n);
        // colorido (Hasler & Süsstrunk)
        const mrg = rgS / n, myb = ybS / n, srg = Math.sqrt(Math.max(0, rgQ / n - mrg * mrg)), syb = Math.sqrt(Math.max(0, ybQ / n - myb * myb));
        const colorful = Math.sqrt(srg * srg + syb * syb) + 0.3 * Math.sqrt(mrg * mrg + myb * myb);
        // bordas (Sobel na luz)
        let edges = 0, flat = 0;
        for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
            const p = y * w + x;
            const gx = Ls[p - w + 1] + 2 * Ls[p + 1] + Ls[p + w + 1] - Ls[p - w - 1] - 2 * Ls[p - 1] - Ls[p + w - 1];
            const gy = Ls[p + w - 1] + 2 * Ls[p + w] + Ls[p + w + 1] - Ls[p - w - 1] - 2 * Ls[p - w] - Ls[p - w + 1];
            const m = Math.hypot(gx, gy); edges += m; if (m < 0.02) flat++;
        }
        const inner = Math.max(1, (w - 2) * (h - 2)); edges /= inner; flat /= inner;
        let smoothTop = 0, nTop = 0;
        for (let y = 1; y < Math.floor(h * 0.35); y++) for (let x = 1; x < w - 1; x++) { const p = y * w + x; nTop++; if (Math.abs(Ls[p + 1] - Ls[p - 1]) + Math.abs(Ls[p + w] - Ls[p - w]) < 0.03) smoothTop++; }
        smoothTop /= Math.max(1, nTop);
        // matizes dominantes: histograma suavizado e picos separados por ≥ 40°
        const sm = hueHist.map((_, i) => hueHist[(i + 35) % 36] * 0.25 + hueHist[i] * 0.5 + hueHist[(i + 1) % 36] * 0.25);
        const peaks = []; const idx = [...sm.keys()].sort((a, b) => sm[b] - sm[a]);
        for (const i of idx) { if (sm[i] <= 0) break; const hue = i * 10 + 5; if (peaks.every(pk => hueDist(pk.h, hue) >= 40)) peaks.push({ h: hue, w: sm[i] }); if (peaks.length >= 4) break; }
        const tot = sm.reduce((a, b) => a + b, 0) || 1; peaks.forEach(pk => pk.w /= tot);
        // cores principais (k-means em OKLab, 6 grupos)
        const clusters = kmeans(Ls, As, Bs, 6);
        const A = {
            w, h, meanL, stdL, p05: q(0.05), p50: q(0.5), p95: q(0.95), meanC, colorful, edges, flat, warmth: warm / n,
            skin: skin / n, skinC: skinC / Math.max(1, nC), skinT: skinT / Math.max(1, nT), sky: sky / Math.max(1, topRows * w), green: green / n, peaks, clusters,
        };
        // caráter (0..1, somas não precisam dar 1)
        A.c = {
            // retrato: pele concentrada no centro (e não espalhada pelo alto, como num céu de fim de tarde)
            retrato: clamp((A.skinC - 0.05) * 5, 0, 1) * (A.skinT > A.skinC * 1.1 ? 0.25 : 1) * (A.skin > 0.6 ? 0.3 : 1),
            paisagem: clamp(A.sky * 1.6 + A.green * 2.2 + smoothTop * 0.9 - 0.15, 0, 1),
            noite: clamp((0.36 - A.p50) * 4, 0, 1) * clamp((A.p95 - 0.55) * 3, 0.3, 1),
            grafico: clamp((A.flat - 0.55) * 3, 0, 1) * clamp(1 - A.stdL * 2 + 0.5, 0, 1) + (A.clusters.length && A.clusters[0].wt > 0.45 ? 0.2 : 0),
            vivo: clamp((A.colorful - 45) / 55, 0, 1),
            apagado: clamp((40 - A.colorful) / 30, 0, 1),
            mono: clamp((0.035 - A.meanC) * 40, 0, 1),
            clara: clamp((A.p50 - 0.68) * 5, 0, 1),
            escura: clamp((0.32 - A.p50) * 5, 0, 1),
            detalhada: clamp((A.edges - 0.12) * 4, 0, 1),
            quente: clamp(A.warmth * 12, -1, 1),
        };
        return A;
    }
    function kmeans(L, a, b, k) {
        const n = L.length, step = Math.max(1, Math.floor(n / 1500));
        const pts = []; for (let i = 0; i < n; i += step) pts.push([L[i], a[i], b[i]]);
        const R = rng(7);
        let cs = []; for (let i = 0; i < k; i++) cs.push(pts[Math.floor(R() * pts.length)].slice());
        const as = new Int32Array(pts.length);
        for (let it = 0; it < 8; it++) {
            for (let i = 0; i < pts.length; i++) { let bi = 0, bd = 1e9; for (let j = 0; j < k; j++) { const d = (pts[i][0] - cs[j][0]) ** 2 + (pts[i][1] - cs[j][1]) ** 2 + (pts[i][2] - cs[j][2]) ** 2; if (d < bd) { bd = d; bi = j; } } as[i] = bi; }
            const acc = cs.map(() => [0, 0, 0, 0]);
            for (let i = 0; i < pts.length; i++) { const c = acc[as[i]]; c[0] += pts[i][0]; c[1] += pts[i][1]; c[2] += pts[i][2]; c[3]++; }
            cs = acc.map((c, j) => c[3] ? [c[0] / c[3], c[1] / c[3], c[2] / c[3], c[3]] : cs[j]);
        }
        return cs.filter(c => c[3]).map(c => ({ L: c[0], a: c[1], b: c[2], C: Math.hypot(c[1], c[2]), h: (Math.atan2(c[2], c[1]) * 180 / Math.PI + 360) % 360, wt: c[3] / pts.length })).sort((x, y) => y.wt - x.wt);
    }

    // ---------------- 2. paletas ----------------
    // obras e estéticas (paletas de referência, do escuro ao claro); tags ajudam a combinar com a foto
    const LIBRARY = [
        ['Noite estrelada', ['#0B1437', '#1B3A7A', '#2F6DB5', '#6FA3D8', '#C9D9A0', '#F2D04B', '#F7E9A0'], 'frio vivo pintura'],
        ['A grande onda', ['#0E1B33', '#1F3F6E', '#3F6FA0', '#9CB9CF', '#E8E0CB', '#F4EEDF'], 'frio papel'],
        ['Girassóis', ['#3A2A12', '#7A5418', '#C68A1E', '#E9B92E', '#F4D86B', '#9DB0A0'], 'quente pintura'],
        ['O grito', ['#1B2440', '#3B5B7E', '#C4501F', '#E67E22', '#F2B544', '#E9D3A0'], 'quente contraste'],
        ['Pérola', ['#0C0D10', '#1E2A44', '#3C5A8A', '#C9A35B', '#EFE3C2'], 'escuro retrato'],
        ['Ninfeias', ['#1F3B3A', '#3F6B5E', '#7FA69A', '#B5C9D6', '#E3B9C9', '#F2E6D8'], 'pastel frio'],
        ['Nascer do sol', ['#23344A', '#4A6B85', '#8FA6B2', '#C9B8A0', '#E86F2C'], 'frio acento'],
        ['O beijo', ['#1E140A', '#5A3C12', '#A67C22', '#D9B24C', '#F3E3A0'], 'quente ouro'],
        ['Abaporu', ['#2F6B3A', '#7FB3D5', '#D9643A', '#F2A12E', '#E8C66A'], 'vivo brasil'],
        ['Tropicália', ['#0B6E4F', '#662E9B', '#EA3546', '#F86624', '#F9C80E', '#43BCCD'], 'vivo brasil'],
        ['Chiaroscuro', ['#0B0805', '#2A1C0E', '#6B4A1E', '#C49A4A', '#F0D890'], 'escuro retrato quente'],
        ['Vênus', ['#2E4A4A', '#7A9A8A', '#CDBA8A', '#EBD8B8', '#F2E3D3'], 'pastel retrato'],
        ['Rothko', ['#2A0A0C', '#5A0F12', '#C2361F', '#E88A2E', '#F2C57A'], 'quente'],
        ['Hopper', ['#0D1A1A', '#1F4038', '#3F7A62', '#C7B26A', '#F1E7B8'], 'frio noite'],
        ['Matisse', ['#1B2F6B', '#E23B2E', '#F2B6C6', '#F7E36A', '#FDF6E3'], 'vivo recorte'],
        ['Hilma', ['#2B2A4C', '#E8A0B4', '#F2C38B', '#A7C4A0', '#F6EEDD'], 'pastel'],
        ['Mondrian', ['#111111', '#1D4E9E', '#D52B1E', '#F7D002', '#F5F5F0'], 'grafico vivo'],
        ['Bauhaus', ['#111111', '#1859A9', '#E5231B', '#F6C500', '#EFE9DE'], 'grafico vivo'],
        ['Riso rosa e azul', ['#1D3557', '#3A6EA5', '#FF5F7E', '#FFB3C1', '#F7F1E3'], 'impressao'],
        ['Game Boy', ['#0F380F', '#306230', '#8BAC0F', '#9BBC0F'], 'retro'],
        ['CGA', ['#000000', '#AA00AA', '#00AAAA', '#FFFFFF'], 'retro'],
        ['Commodore', ['#352879', '#6C5EB5', '#9A6759', '#C0C0C0', '#E0E0A0'], 'retro'],
        ['Miami 86', ['#1B0B3A', '#6A1B9A', '#F72585', '#4CC9F0', '#F8F7FF'], 'neon'],
        ['Tóquio neon', ['#07010F', '#2B0F54', '#AB1F65', '#FF4F69', '#FFF7F8', '#00E5FF'], 'neon noite'],
        ['Aurora', ['#04151F', '#183A37', '#1F7A6C', '#5FD3A5', '#C8F9D9', '#B388EB'], 'frio noite'],
        ['Deserto', ['#2B1B17', '#6E3B2A', '#C0703E', '#E7A868', '#F6DDB6'], 'quente'],
        ['Oceano', ['#03045E', '#0077B6', '#00B4D8', '#90E0EF', '#E0FBFC'], 'frio'],
        ['Pêssego', ['#3D2C3E', '#8E5572', '#E29578', '#FFDDD2', '#FFF4EC'], 'pastel quente retrato'],
        ['Tecnicolor', ['#101820', '#0B6E99', '#E23E57', '#F9C74F', '#F4F1DE'], 'vivo cinema'],
        ['Sépia', ['#1E140C', '#4A3322', '#8A6A4A', '#C8AE8A', '#F1E6D0'], 'quente mono'],
        ['Cianotipia', ['#08204A', '#1E4C8C', '#6E9AC8', '#EAF2FA'], 'frio mono'],
        ['Menta e cereja', ['#1A1423', '#3D7068', '#8FC9A8', '#F2E8DC', '#D7263D'], 'contraste'],
        ['Lavanda', ['#231942', '#5E548E', '#9F86C0', '#E0B1CB', '#FBF4F9'], 'pastel frio'],
        ['Ferrugem', ['#1B1B1E', '#3E4A61', '#A14A2E', '#D9824B', '#F2E3C9'], 'contraste'],
    ].map(([name, colors, tags]) => ({ name, colors, tags: tags.split(' '), lch: colors.map(hex2lch) }));
    // paletas curadas antigas também entram, sem nome
    try { if (typeof CURATED_PALETTES !== 'undefined') CURATED_PALETTES.forEach((p, i) => LIBRARY.push({ name: null, colors: p.slice(), tags: ['curada'], lch: p.map(hex2lch) })); } catch (e) {}

    const SCHEMES = {
        analogas: [0, 28, -28, 56],
        complementar: [0, 180, 20, 200],
        tríade: [0, 120, 240],
        'dividida': [0, 150, 210],
        quadrada: [0, 90, 180, 270],
        mono: [0, 6, -6],
    };
    // paleta harmônica: rampa de luz com croma que cresce no meio (como tinta de verdade)
    function harmony(R, anchor, scheme, n, A, opts = {}) {
        const offs = SCHEMES[scheme];
        const lo = opts.lo !== undefined ? opts.lo : lerp(0.14, 0.24, A.c.clara), hi = opts.hi !== undefined ? opts.hi : lerp(0.94, 0.86, A.c.escura);
        const cMax = opts.cMax || lerp(0.13, 0.2, R());
        const out = [];
        for (let i = 0; i < n; i++) {
            const t = n > 1 ? i / (n - 1) : 0.5;
            const L = lerp(lo, hi, opts.curve ? Math.pow(t, opts.curve) : t);
            const hue = (anchor + offs[i % offs.length] + (R() - 0.5) * 8 + 360) % 360;
            const C = cMax * (0.35 + 0.65 * Math.sin(Math.PI * clamp(t * 0.9 + 0.05, 0, 1)));
            out.push(lch2hex(L, C, hue));
        }
        return out;
    }
    // as cores da própria foto, mais intensas e com escala de luz completa
    function fromImage(A, n, boost) {
        const cs = A.clusters.slice().sort((x, y) => x.L - y.L);
        const out = [];
        for (let i = 0; i < n; i++) {
            const t = n > 1 ? i / (n - 1) : 0.5, c = cs[Math.min(cs.length - 1, Math.round(t * (cs.length - 1)))];
            out.push(lch2hex(lerp(0.12, 0.95, t), Math.min(0.3, c.C * boost + 0.02), c.h));
        }
        return out;
    }
    // afinidade de uma paleta com a foto: quanto os matizes fortes da paleta aparecem na foto
    function affinity(lchList, A) {
        if (!A.peaks.length) return 0.5;
        let s = 0, wsum = 0;
        lchList.forEach(p => { if (p.C < 0.04) return; const best = Math.min(...A.peaks.map(pk => hueDist(pk.h, p.h) / (0.6 + pk.w))); s += p.C * clamp(1 - best / 90, 0, 1); wsum += p.C; });
        return wsum ? s / wsum : 0.5;
    }
    // mapa de tons: cada cor da paleta cobre uma faixa de luz da foto (usa a luz real da imagem, p5..p95)
    function toneRef(colors, A) {
        const n = colors.length, lo = Math.max(0.02, A.p05), hi = Math.min(0.99, A.p95);
        return colors.map((_, i) => { const L = lerp(lo, hi, n > 1 ? i / (n - 1) : 0.5); const [r, g, b] = lab2lin(L, 0, 0); const v = toGam(r); return rgbToHex(v, v, v).toUpperCase(); });
    }
    const byLight = (list) => list.slice().sort((x, y) => hex2lch(x).L - hex2lch(y).L);

    // nomes em português para matizes (para batizar as variações)
    function hueName(h, L, C) {
        if (C < 0.035) return L < 0.3 ? 'Grafite' : L > 0.8 ? 'Marfim' : 'Prata';
        const names = [[15, 'Carmim'], [35, 'Coral'], [55, 'Terracota'], [70, 'Âmbar'], [90, 'Mostarda'], [110, 'Oliva'], [140, 'Jade'], [165, 'Menta'], [195, 'Turquesa'], [225, 'Céu'], [250, 'Cobalto'], [275, 'Índigo'], [300, 'Violeta'], [325, 'Ameixa'], [345, 'Magenta'], [361, 'Carmim']];
        let nm = names.find(([t]) => h < t)[1];
        if (L > 0.8 && C < 0.12) nm = { Carmim: 'Rosa', Coral: 'Pêssego', Terracota: 'Areia', Âmbar: 'Creme', Mostarda: 'Baunilha', Jade: 'Menta', Céu: 'Névoa', Cobalto: 'Gelo', Índigo: 'Lavanda', Violeta: 'Lilás', Ameixa: 'Orquídea', Magenta: 'Rosa' }[nm] || nm;
        return nm;
    }
    function paletteTitle(colors) {
        const l = colors.map(hex2lch).filter(p => p.C > 0.05).sort((a, b) => b.C - a.C);
        if (!l.length) { const m = colors.map(hex2lch); return hueName(0, m[Math.floor(m.length / 2)].L, 0); }
        const a = hueName(l[0].h, l[0].L, l[0].C), b2 = l.find(p => hueDist(p.h, l[0].h) > 40);
        return b2 ? a + ' e ' + hueName(b2.h, b2.L, b2.C).toLowerCase() : a;
    }

    // ---------------- 3. famílias e genomas ----------------
    const BW_LOOKS = () => Object.keys(FILM_LOOKS).filter(k => FILM_LOOKS[k].u && FILM_LOOKS[k].u.uBW);
    const COLOR_LOOKS = () => Object.keys(FILM_LOOKS).filter(k => !(FILM_LOOKS[k].u && FILM_LOOKS[k].u.uBW) && !FILM_LOOKS[k].fx);
    const FAMILIES = {
        pintura: { nome: 'Pintura', w: (c) => 1 + c.paisagem * 1.2 + c.retrato * 0.6 + c.apagado * 0.4 - c.grafico * 0.5 },
        grafico: { nome: 'Pôster', w: (c) => 0.8 + c.grafico * 1.5 + c.vivo * 0.5 - c.retrato * 0.5 },
        pixel: { nome: 'Pixel', w: (c) => 0.8 + c.grafico * 1.2 + (1 - c.detalhada) * 0.4 - c.retrato * 0.6 },
        filme: { nome: 'Filme', w: (c) => 1 + c.retrato * 1.4 + c.paisagem * 0.5 + c.noite * 0.4 },
        impressao: { nome: 'Impressão', w: (c) => 0.8 + c.apagado * 0.8 + c.mono * 0.8 + c.grafico * 0.3 },
        neon: { nome: 'Néon', w: (c) => 0.4 + c.noite * 2.2 + c.escura * 1.2 - c.clara * 0.4 - c.retrato * 0.3 },
        sonho: { nome: 'Sonho', w: (c) => 0.7 + c.clara * 1.4 + c.retrato * 0.5 + c.paisagem * 0.4 - c.escura * 0.5 },
        mono: { nome: 'Monocromo', w: (c) => 0.5 + c.mono * 1.8 + c.apagado * 0.6 + c.detalhada * 0.3 },
        cor: { nome: 'Cor', w: (c) => 0.9 + c.vivo * 0.8 + c.retrato * 0.8 + c.paisagem * 0.5 },
    };
    const TEXTURES = ['pattern_refraction', 'pixelate_fx', 'slice_shift', 'vhs', 'channel_mixer', 'warp', 'hatching', 'photocopy', 'bloom'];

    function choosePalette(R, A, fam, prefer) {
        const c = A.c, anchor = A.peaks.length ? A.peaks[0].h : (c.quente > 0 ? 55 : 240);
        // estratégia de paleta por família
        const opts = {
            pintura: [['lib', 3], ['harm', 2], ['img', 1.5]],
            grafico: [['lib', 2.5], ['harm', 2], ['duo', 1]],
            pixel: [['lib', 2.5], ['harm', 1.5], ['img', 1]],
            impressao: [['duo', 2.5], ['lib', 1.5], ['harm', 1]],
            neon: [['neon', 3], ['lib', 1]],
            sonho: [['pastel', 2.5], ['lib', 1.2], ['duo', 0.8]],
            mono: [['duo', 3], ['tri', 1]],
            filme: [['none', 3], ['img', 1]],
            cor: [['img', 2], ['harm', 1.5], ['none', 1]],
        }[fam];
        const kind = prefer || pickW(R, opts.map(o => o[0]), opts.map(o => o[1]));
        const n = pickW(R, [3, 4, 5, 6, 8, 12], fam === 'pixel' ? [1, 3, 3, 2, 2, 0.5] : fam === 'grafico' ? [2, 3, 3, 2, 1, 0] : [0.5, 1, 2, 3, 3, 2]);
        if (kind === 'none') return { kind, colors: [], name: null };
        if (kind === 'lib') {
            // sorteio ponderado pela afinidade (70% combina com a foto, 30% contraste proposital)
            const want = R() < 0.72;
            const lib = LIBRARY.filter(p => !(c.retrato > 0.4 && p.tags.includes('neon')));
            const w = lib.map(p => { const af = affinity(p.lch, A); let s = want ? 0.15 + af * af * 2 : 0.4 + (1 - af); if (p.tags.includes('noite') || p.tags.includes('neon')) s *= 0.5 + c.noite * 2; if (p.tags.includes('pastel')) s *= 0.6 + c.clara * 1.6; if (p.tags.includes('retrato')) s *= 1 + c.retrato; if (fam === 'pixel' && p.tags.includes('retro')) s *= 2.2; if (fam === 'grafico' && p.tags.includes('grafico')) s *= 2; if (fam === 'pintura' && p.tags.includes('pintura')) s *= 2; if (!p.name) s *= 0.5; return s; });
            const p = pickW(R, lib, w);
            return { kind, colors: byLight(p.colors), name: p.name };
        }
        if (kind === 'harm') {
            const scheme = pickW(R, Object.keys(SCHEMES), [3, 2, 1, 1.5, 0.6, 1.2].map((x, i) => i === 0 ? x + c.paisagem : i === 1 ? x + c.vivo : x));
            const cols = harmony(R, anchor + (R() < 0.25 ? pick(R, [30, -30, 180]) : 0), scheme, n, A);
            return { kind, colors: cols, name: null, scheme };
        }
        if (kind === 'img') return { kind, colors: fromImage(A, Math.max(4, n), lerp(1.3, 2.2, R())), name: null };
        if (kind === 'pastel') return { kind, colors: harmony(R, anchor + pick(R, [0, 30, 150, 180]), pick(R, ['analogas', 'dividida', 'complementar']), Math.max(4, n), A, { lo: 0.42, hi: 0.97, cMax: 0.1 }), name: null };
        if (kind === 'neon') return { kind, colors: harmony(R, pick(R, [300, 330, 200, 180, 270]), pick(R, ['complementar', 'dividida', 'tríade']), Math.max(4, n), A, { lo: 0.1, hi: 0.9, cMax: 0.28, curve: 1.4 }), name: null };
        // duo/tri: sombras frias ou profundas, luzes quentes/claras (ou o inverso), sempre com luz bem separada
        const h1 = (anchor + pick(R, [180, 150, 210, 0])) % 360, h2 = anchor;
        const dark = lch2hex(lerp(0.12, 0.22, R()), lerp(0.04, 0.12, R()), h1), light = lch2hex(lerp(0.9, 0.97, R()), lerp(0.02, 0.08, R()), h2);
        if (kind === 'tri' || (kind === 'duo' && R() < 0.35)) return { kind: 'tri', colors: [dark, lch2hex(lerp(0.5, 0.64, R()), lerp(0.12, 0.2, R()), (h1 + h2) / 2 + pick(R, [0, 90])), light], name: null };
        return { kind: 'duo', colors: [dark, light], name: null };
    }

    function genome(R, A, ctx, fam) {
        const c = A.c, g = { fam, v: 1 };
        g.pal = choosePalette(R, A, fam);
        // pixel: tamanho pensado em "blocos" no lado maior (retratos pedem mais blocos)
        const long = ctx.long;
        const blocks = { pixel: lerp(64, 200, R()), grafico: lerp(160, 420, R()), impressao: lerp(260, 700, R()) }[fam];
        g.px = blocks ? clamp(Math.round(long / Math.max(blocks, c.retrato > 0.4 ? 140 : 0)), 1, 64) : 1;
        // padrão (dither)
        const dith = {
            pintura: [['floyd_approx', 3], ['noise', 2], ['none', 1.5]],
            grafico: [['halftone', 2], ['none', 2.5], ['checkerboard', 0.6], ['bayer8', 1]],
            pixel: [['bayer8', 3], ['nintendo_ds', 2], ['floyd_approx', 1.5], ['checkerboard', 1], ['none', 1]],
            impressao: [['halftone', 3], ['noise', 1.5], ['scanlines', 0.4]],
            neon: [['scanlines', 1.2], ['none', 2], ['bayer8', 1]],
            sonho: [['none', 3], ['noise', 1]],
            mono: [['floyd_approx', 2], ['halftone', 1.5], ['bayer8', 1.5], ['none', 1.5]],
            filme: [['none', 1]], cor: [['none', 1]],
        }[fam];
        const dm = pickW(R, dith.map(x => x[0]), dith.map(x => x[1]));
        g.dither = dm === 'none' ? null : { mode: dm, scale: dm === 'halftone' ? pick(R, [2, 3, 4, 5]) : pick(R, [1, 1, 2]), intensity: Math.round(lerp(60, dm === 'halftone' ? 140 : 120, R())) };
        // filme
        if (fam === 'filme' || (fam === 'cor' && R() < 0.6) || (fam === 'sonho' && R() < 0.5) || (fam === 'pintura' && R() < 0.25)) {
            const pool = c.mono > 0.5 || fam === 'mono' ? BW_LOOKS() : COLOR_LOOKS();
            // retrato: filmes de pele (Portra, Pro 400H, Gold...) ganham peso
            const skinFriendly = ['portra', 'portra160', 'portra800', 'pro400h', 'gold200', 'natura', 'astia', 'kodachrome25', 'contaxt2', 'hasselblad', 'leica', 'cinestill50', 'vision250d'];
            const w = pool.map(id => (c.retrato > 0.3 && skinFriendly.includes(id) ? 3 : 1) * (c.noite > 0.4 && /cinestill|vision500t|natura|delta3200/.test(id) ? 3 : 1));
            g.film = { look: pickW(R, pool, w), mix: Math.round(lerp(fam === 'filme' ? 70 : 40, 100, R())) };
        } else if (fam === 'mono' && R() < 0.45) g.film = { look: pick(R, BW_LOOKS()), mix: 100 };
        // lente e luz
        g.lens = {};
        if (fam === 'sonho') { g.lens.soft = Math.round(lerp(15, 40, R())); g.lens.bloom = Math.round(lerp(15, 45, R())); if (R() < 0.4) g.lens.halation = Math.round(lerp(10, 30, R())); }
        if (fam === 'neon') { g.lens.bloom = Math.round(lerp(25, 55, R())); g.lens.halation = Math.round(lerp(10, 35, R())); }
        if (fam === 'filme' && R() < 0.4) g.lens.vignette = Math.round(lerp(10, 35, R()));
        if (fam === 'pintura' && R() < 0.35) g.lens.soft = Math.round(lerp(8, 25, R()));
        // grão
        const grainP = { pintura: 0.65, filme: 0.55, impressao: 0.6, mono: 0.5, sonho: 0.3, grafico: 0.2, neon: 0.25, pixel: 0.05, cor: 0.3 }[fam];
        g.grain = R() < grainP ? { amount: Math.round(lerp(8, fam === 'pintura' || fam === 'impressao' ? 26 : 18, R())), size: Math.round(lerp(100, 220, R())), rough: Math.round(lerp(40, 90, R())), mono: fam !== 'pintura' || R() < 0.5 } : null;
        // textura
        const texP = { pintura: 0.3, grafico: 0.2, neon: 0.3, impressao: 0.35, mono: 0.15, sonho: 0.15, pixel: 0.05, filme: 0.05, cor: 0.1 }[fam];
        if (R() < texP * (c.retrato > 0.4 ? 0.5 : 1)) {
            const pool = { pintura: ['warp', 'pattern_refraction', 'hatching'], grafico: ['pixelate_fx', 'pattern_refraction', 'slice_shift'], neon: ['bloom', 'vhs', 'channel_mixer', 'slice_shift'], impressao: ['photocopy', 'hatching'], mono: ['photocopy', 'hatching'], sonho: ['bloom', 'pattern_refraction'], pixel: ['pixelate_fx'], filme: ['vhs'], cor: ['channel_mixer', 'bloom'] }[fam];
            const id = pick(R, pool);
            if (PixelarFX.getEffectDef(id)) g.fx = { id, mix: Math.round(lerp(35, 80, R())), params: typeof randFxParams === 'function' ? randFxParams(id) : {} };
        }
        // contorno
        const edgeP = { grafico: 0.45, pixel: 0.2, impressao: 0.15, pintura: 0.1 }[fam] || 0;
        if (R() < edgeP * (c.detalhada > 0.6 ? 0.4 : 1)) g.edge = { size: pick(R, [1, 1, 2]), opacity: Math.round(lerp(55, 100, R())) };
        // degradê de luz (colorir sem perder a foto)
        const gradP = { sonho: 0.4, neon: 0.35, cor: 0.3, pintura: 0.12 }[fam] || 0;
        if (R() < gradP && g.pal.kind !== 'duo' && g.pal.kind !== 'tri') {
            const hA = A.peaks.length ? A.peaks[0].h : 40, hB = (hA + pick(R, [150, 180, 210, 60])) % 360;
            g.grad = { type: pick(R, ['linear', 'radial', 'diamond', 'mirror']), angle: pick(R, [90, 135, 180, 45]), colors: [lch2hex(0.7, 0.16, hA), lch2hex(0.55, 0.18, hB)], blend: pick(R, ['softlight', 'overlay', 'color', 'screen']), opacity: Math.round(lerp(25, 55, R())) };
        }
        // luz: corrige o que a foto pede e dá a pegada da família
        g.adj = {
            exposure: Math.round(clamp((0.5 - A.p50) * 40 * (c.escura > 0.5 ? 1 : 0.4), -25, 30)),
            contrast: Math.round(clamp((0.22 - A.stdL) * 120, -20, 30) + ({ grafico: 12, impressao: 10, neon: 15, mono: 12, sonho: -10 }[fam] || 0)),
            saturation: Math.round(({ cor: lerp(5, 30, R()), pintura: lerp(5, 25, R()), sonho: lerp(-10, 10, R()), neon: 25, filme: 0 }[fam] || 0) + c.apagado * 15 - c.vivo * 10),
            temperature: Math.round(({ filme: lerp(-8, 12, R()), sonho: lerp(0, 12, R()), cor: lerp(-15, 15, R()) }[fam] || 0)),
        };
        g.pal.n = g.pal.colors.length;
        return g;
    }

    // genoma → estado (partindo do atual: recorte, fundo e animação são mantidos; o resto recomeça)
    function express(g, cur, A, locks) {
        const s = normalizeState(deepClone(DEFAULT_STATE));
        s.crop = deepClone(cur.crop); s.bg = deepClone(cur.bg); s.anim = deepClone(cur.anim);
        Object.assign(s.adj, g.adj);
        s.pixel.size = g.px;
        if (g.dither) Object.assign(s.dither, g.dither);
        const p = g.pal;
        if (p.kind === 'duo' || p.kind === 'tri') { s.color.sel = p.kind === 'tri' ? 'tritone' : 'duotone'; s.color.mode = s.color.sel; s.color.duo = p.kind === 'tri' ? p.colors.slice(0, 3) : [p.colors[0], p.colors[1], p.colors[1]]; }
        else if (p.colors.length) { s.color.sel = String(p.colors.length); s.color.mode = 'preset'; s.color.base = p.colors.slice(); s.color.ref = toneRef(p.colors, A); }
        if (g.film) Object.assign(s.film, g.film);
        Object.assign(s.film, g.lens || {});
        if (g.grain) Object.assign(s.grain, g.grain);
        if (g.fx) { s.fx.id = g.fx.id; s.fx.mix = g.fx.mix; s.fxParams[g.fx.id] = g.fx.params; }
        if (g.edge) { s.edge.size = g.edge.size; s.edge.opacity = g.edge.opacity; s.edge.color = p.colors.length ? p.colors[0] : '#141414'; }
        if (g.grad) Object.assign(s.grad, g.grad, { on: true });
        // controles travados pela pessoa ficam como estão
        if (locks && locks.size) locks.forEach(path => {
            const [a, b] = path.split('.');
            if (path === 'color.palette') { s.color = deepClone(cur.color); return; }
            if (cur[a] && b in cur[a]) s[a][b] = deepClone(cur[a][b]);
        });
        return s;
    }

    // ---------------- 4. pontuação ----------------
    function features(g) {
        const f = { ['fam:' + g.fam]: 1, ['pal:' + g.pal.kind]: 1 };
        if (g.pal.name) f['lib:' + g.pal.name] = 1;
        if (g.dither) f['dith:' + g.dither.mode] = 1;
        if (g.film) f['film'] = 1;
        if (g.grain) f['grain'] = 1;
        if (g.fx) f['fx:' + g.fx.id] = 1;
        if (g.edge) f['edge'] = 1;
        if (g.grad) f['grad'] = 1;
        f['px:' + (g.px <= 1 ? 'fino' : g.px <= 4 ? 'medio' : 'grosso')] = 1;
        return f;
    }
    function sim(fa, fb) { let dot = 0, na = 0, nb = 0; for (const k in fa) { na++; if (fb[k]) dot++; } for (const k in fb) nb++; return dot / Math.sqrt(na * nb || 1); }
    function score(g, A, ctx) {
        const c = A.c, cols = g.pal.colors.map(hex2lch);
        let s = 0; const why = {};
        if (cols.length) {
            const Ls = cols.map(p => p.L).sort((a, b) => a - b), span = Ls[Ls.length - 1] - Ls[0];
            why.legivel = clamp((span - 0.35) / 0.45, 0, 1);                       // escala de luz ampla = foto legível
            let minGap = 1; for (let i = 1; i < Ls.length; i++) minGap = Math.min(minGap, Ls[i] - Ls[i - 1]);
            why.degraus = cols.length <= 8 ? clamp(minGap / 0.08, 0, 1) : 0.8;      // cores não se confundem
            // harmonia: pares de matizes fortes perto de 0/30/120/150/180°
            const strong = cols.filter(p => p.C > 0.06); let hs = 0, hn = 0;
            for (let i = 0; i < strong.length; i++) for (let j = i + 1; j < strong.length; j++) { const d = hueDist(strong[i].h, strong[j].h); hs += Math.max(...[0, 30, 120, 150, 180].map(t => clamp(1 - Math.abs(d - t) / 22, 0, 1))); hn++; }
            why.harmonia = hn ? hs / hn : 0.7;
            why.afinidade = affinity(cols, A);
            // retrato: a cor que vai cair na pele (luz ~0.6–0.8) precisa ser quente e não berrante
            if (c.retrato > 0.25) {
                const skinTone = cols.reduce((b, p) => Math.abs(p.L - 0.7) < Math.abs(b.L - 0.7) ? p : b, cols[0]);
                const ok = skinTone.C < 0.03 || (skinTone.h > 25 && skinTone.h < 95 && skinTone.C < 0.16);
                why.pele = ok ? 1 : 0;
            }
            // chave de luz: foto escura com paleta sem pretos vira lavada
            if (c.escura > 0.4 && Ls[0] > 0.3) why.chave = 0; else why.chave = 1;
        } else { why.legivel = 0.9; why.harmonia = 0.8; why.afinidade = 0.9; why.degraus = 1; why.chave = 1; if (c.retrato > 0.25) why.pele = 1; }
        // detalhe: blocos no lado maior
        const blocks = ctx.long / g.px;
        why.detalhe = clamp((blocks - (c.retrato > 0.3 ? 110 : 50)) / 120, 0, 1);
        // foto cheia de detalhes + poucas cores + sem padrão = ruído
        why.ruido = (c.detalhada > 0.5 && cols.length && cols.length <= 4 && !g.dither) ? 0.3 : 1;
        // gosto aprendido
        const f = features(g); let pref = 0; for (const k in f) pref += (ctx.taste[k] || 0);
        // novidade frente ao que já foi mostrado
        let rep = 0; for (const h of ctx.recent) rep = Math.max(rep, sim(f, h));
        const W = { legivel: 1.2, degraus: 0.6, harmonia: 0.8, afinidade: 0.7, pele: 1.6, chave: 0.8, detalhe: 1.0, ruido: 0.8 };
        for (const k in why) s += (W[k] || 0.5) * why[k];
        s += clamp(pref, -1.5, 1.5) * 0.6 - rep * 0.5;
        return { s, why, f };
    }

    // ---------------- 5. geração, seleção com diversidade e evolução ----------------
    const KEY = 'pixelar.muse';
    function loadMem() { try { const m = JSON.parse(localStorage.getItem(KEY) || '{}'); return { taste: m.taste || {}, recent: (m.recent || []).slice(-40) }; } catch (e) { return { taste: {}, recent: [] }; } }
    function saveMem(m) { try { localStorage.setItem(KEY, JSON.stringify({ taste: m.taste, recent: m.recent.slice(-40) })); } catch (e) {} }
    let mem = loadMem(), seedN = (Date.now() & 0xffff) ^ 0x51ed;

    const NOUNS = {
        pintura: ['Óleo', 'Guache', 'Têmpera', 'Pastel seco', 'Aquarela'], grafico: ['Serigrafia', 'Cartaz', 'Lambe-lambe', 'Recorte'],
        pixel: ['8 bits', 'Mosaico', 'Cartucho', 'Fliperama'], impressao: ['Riso', 'Offset', 'Tipografia', 'Xilo'],
        neon: ['Néon', 'Letreiro', 'Madrugada', 'Fliperama'], sonho: ['Névoa', 'Sonho', 'Aurora', 'Veludo'],
        mono: ['Nanquim', 'Carvão', 'Prata', 'Grafite'], cor: ['Luz', 'Cor', 'Tarde'], filme: ['Filme'],
    };
    function title(g) {
        const fam = (NOUNS[g.fam] || [FAMILIES[g.fam].nome])[(g.pal.colors.join('').length + g.px + (g.dither ? g.dither.intensity : 0)) % (NOUNS[g.fam] || [0]).length];
        if (g.pal.name) return g.pal.name;
        if (g.film && !g.pal.colors.length) return (FILM_LOOKS[g.film.look] || {}).nome || fam;
        if (g.pal.colors.length) return fam + ' · ' + paletteTitle(g.pal.colors).toLowerCase();
        const a = g.adj || {}; return fam + ' · ' + (a.temperature > 5 ? 'quente' : a.temperature < -5 ? 'fria' : a.saturation > 15 ? 'viva' : 'natural');
    }

    function mmr(cands, k, lambda = 0.62) {
        const out = [], rest = cands.slice(), perFam = {};
        const smax = Math.max(...rest.map(c => c.sc.s)), smin = Math.min(...rest.map(c => c.sc.s));
        const norm = (x) => (x - smin) / ((smax - smin) || 1);
        while (out.length < k && rest.length) {
            let bi = 0, bv = -1e9;
            const cap = Math.max(2, Math.ceil(k / 4));   // no máximo ~1/4 do lote numa mesma família
            rest.forEach((c, i) => { const div = out.length ? Math.max(...out.map(o => sim(o.sc.f, c.sc.f))) : 0; let v = lambda * norm(c.sc.s) - (1 - lambda) * div; if ((perFam[c.g.fam] || 0) >= cap) v -= 1; if (v > bv) { bv = v; bi = i; } });
            const c = rest.splice(bi, 1)[0]; perFam[c.g.fam] = (perFam[c.g.fam] || 0) + 1; out.push(c);
        }
        return out;
    }

    // n variações para a foto atual
    function generate(A, cur, opts = {}) {
        const n = opts.n || 12, pool = opts.pool || 60;
        const R = rng(opts.seed || (++seedN * 2654435761));
        const ctx = { long: opts.long || 1600, taste: mem.taste, recent: mem.recent };
        const fams = Object.keys(FAMILIES), fw = fams.map(f => Math.max(0.05, FAMILIES[f].w(A.c)) * (1 + clamp(mem.taste['fam:' + f] || 0, -0.8, 1.5)));
        const cands = [];
        for (let i = 0; i < pool; i++) {
            const fam = opts.parent ? (R() < 0.8 ? opts.parent.fam : pickW(R, fams, fw)) : pickW(R, fams, fw);
            const g = opts.parent ? mutate(R, opts.parent, A, ctx) : genome(R, A, ctx, fam);
            const sc = score(g, A, ctx); sc.s += (R() - 0.5) * 0.35;          // um pouco de acaso: infinitas boas opções
            cands.push({ g, sc });
        }
        cands.sort((a, b) => b.sc.s - a.sc.s);
        const top = cands.slice(0, Math.max(n * 3, 20));
        const chosen = mmr(top, n);
        chosen.forEach(c => mem.recent.push(c.sc.f)); saveMem(mem);
        const seen = {};
        return chosen.map(c => {
            let name = title(c.g);
            if (seen[name]) name += ' ' + ['II', 'III', 'IV', 'V', 'VI'][Math.min(4, seen[name] - 1)];   // sem nomes repetidos no lote
            seen[title(c.g)] = (seen[title(c.g)] || 0) + 1;
            return { genome: c.g, name, state: express(c.g, cur, A, opts.locks), score: c.sc };
        });
    }
    // mutação: mantém o espírito da variação escolhida e explora ao redor
    function mutate(R, p, A, ctx) {
        const g = JSON.parse(JSON.stringify(p));
        const r = () => R() < 0.35;
        if (r()) { const np = choosePalette(R, A, g.fam); if (np.kind !== 'none' || !g.pal.colors.length) g.pal = np; }
        else if (g.pal.colors.length) { const dh = (R() - 0.5) * 40; g.pal.colors = g.pal.colors.map(hx => { const q = hex2lch(hx); return lch2hex(clamp(q.L + (R() - 0.5) * 0.06, 0.03, 0.98), clamp(q.C * lerp(0.8, 1.25, R()), 0, 0.3), (q.h + dh + 360) % 360); }); g.pal.name = null; }
        if (r()) g.px = clamp(Math.round(g.px * lerp(0.6, 1.6, R())), 1, 64);
        if (r() && g.dither) g.dither.intensity = clamp(Math.round(g.dither.intensity * lerp(0.7, 1.3, R())), 20, 200);
        if (R() < 0.15) g.dither = g.dither ? null : { mode: pick(R, ['bayer8', 'halftone', 'floyd_approx', 'noise']), scale: pick(R, [1, 2, 3]), intensity: 100 };
        if (r() && g.film) g.film.mix = clamp(Math.round(g.film.mix * lerp(0.7, 1.2, R())), 20, 100);
        if (R() < 0.2) g.grain = g.grain ? null : { amount: 14, size: 150, rough: 60, mono: true };
        if (R() < 0.15) g.edge = g.edge ? null : { size: 1, opacity: 80 };
        Object.keys(g.adj).forEach(k => { if (r()) g.adj[k] = Math.round(clamp(g.adj[k] + (R() - 0.5) * 20, -60, 60)); });
        return g;
    }
    // a pessoa escolheu: reforça o que havia nela, enfraquece levemente o resto do lote
    function learn(chosen, batch) {
        const up = features(chosen);
        for (const k in up) mem.taste[k] = clamp((mem.taste[k] || 0) + 0.25, -1.5, 2);
        (batch || []).forEach(b => { if (b === chosen) return; const f = features(b); for (const k in f) if (!up[k]) mem.taste[k] = clamp((mem.taste[k] || 0) - 0.03, -1.5, 2); });
        saveMem(mem);
    }
    function forget() { mem = { taste: {}, recent: [] }; saveMem(mem); }

    return { analyze, generate, learn, forget, lch2hex, hex2lch, harmony, toneRef, paletteTitle, get taste() { return mem.taste; } };
})();
