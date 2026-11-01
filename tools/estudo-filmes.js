/* Candidatos do estudo de filmes e câmeras (não entram no app até serem escolhidos).
 * Carregado só pela galeria (tools/galeria.js --estudo). Mesmo formato de FILM_LOOK_DEFS. */
window.ESTUDO_FILMES = [
    ['Câmeras e vídeo', [
        ['polaroid', 'Polaroid 600', 'Instantânea: pretos lavados, sombras ciano, luzes quentes e bordas suaves.', { uFade: 0.26, uBase: [0.11, 0.1, 0.09], uContrast: 0.82, uSplit: 0.7, uShadowTint: [0.4, 0.53, 0.58], uHighTint: [0.62, 0.55, 0.44], uSat: 0.82, uTemp: 0.15, uSoft: 0.18, uVignette: 0.7, uGrain: 0.15 }],
        ['instax', 'Instax', 'Instantânea moderna: clara, fria, flash e luzes comprimidas.', { uExposure: 0.55, uContrast: 1.15, uTemp: -0.5, uSat: 1.15, uFade: 0.15, uBase: [0.08, 0.11, 0.14], uRoll: 0.9, uFlash: 0.6, uVignette: 0.35, uSplit: 0.5, uShadowTint: [0.42, 0.5, 0.6] }],
        ['descartavel_flash', 'Descartável com flash', 'Flash duro no centro, cores berrantes, vinheta e lente de plástico.', { uFlash: 0.95, uSat: 1.4, uTemp: 0.25, uContrast: 1.3, uVignette: 0.9, uChroma: 1.3, uSoft: 0.3, uGrain: 0.45, uExposure: -0.25 }],
        ['vhs_cam', 'Filmadora VHS', 'Fita caseira: baixa resolução, cor vazando, linhas entrelaçadas e ruído.', { uLowRes: 4, uSoft: 0.5, uChromaNoise: 1.0, uInterlace: 1.2, uSat: 1.45, uTemp: 0.15, uContrast: 1.15, uBloom: 0.6, uChroma: 3.0, uFade: 0.1, uBase: [0.05, 0.03, 0.08] }],
        ['digital2005', 'Digital 2005', 'Compacta digital: nítida demais, compressão, flash frio e risco do sensor.', { uSharpen: 1.6, uJpeg: 0.8, uChromaNoise: 0.7, uFlash: 0.8, uTemp: -0.55, uSat: 1.3, uContrast: 1.3, uBloom: 0.6, uSmear: 0.8, uExposure: 0.15, uSplit: 0.5, uShadowTint: [0.42, 0.48, 0.6] }],
        ['pinhole', 'Pinhole', 'Câmera sem lente: tudo macio, bordas escuras e distorcidas.', { uBlur: 2.5, uSoft: 0.45, uVignette: 1.5, uDistort: 0.6, uSat: 0.8, uFade: 0.12, uBase: [0.06, 0.05, 0.04], uGrain: 0.4 }],
    ]],
    ['Cor forte', [
        ['kodachrome', 'Kodachrome intenso', 'Vermelhos profundos, pretos densos e cor saturada de revista antiga.', { uSat: 1.5, uContrast: 1.38, uSwap: 3, uSwapAmt: 0.55, uSplit: 0.35, uShadowTint: [0.45, 0.48, 0.55], uHighTint: [0.6, 0.53, 0.42], uGrain: 0.15 }],
        ['tealorange', 'Laranja e azul', 'O visual de cinema: pele laranja, sombras azul-petróleo.', { uSplit: 1.1, uShadowTint: [0.28, 0.5, 0.66], uHighTint: [0.74, 0.52, 0.32], uContrast: 1.2, uSat: 1.15 }],
        ['bleach', 'Bleach bypass', 'Prata mantida no filme: pouca cor, contraste metálico.', { uBleach: 1, uSat: 0.5, uContrast: 1.45, uTemp: -0.1, uGrain: 0.3 }],
        ['technicolor2', 'Technicolor 2 cores', 'Só laranja-avermelhado e ciano-esverdeado, como os filmes dos anos 20.', { uSwap: 4, uSwapAmt: 1, uSat: 1.25, uContrast: 1.15, uGrain: 0.15 }],
        ['noiteamericana', 'Noite americana', 'Dia virando noite: azul, escuro e dessaturado.', { uExposure: -0.9, uTemp: -0.85, uSat: 0.5, uContrast: 1.3, uSplit: 0.5, uShadowTint: [0.3, 0.4, 0.65] }],
        ['superexposto', 'Superexposto', 'Luz demais no filme: tudo claro, macio e quente, com brilho.', { uExposure: 1.0, uRoll: 1.2, uFade: 0.15, uBase: [0.06, 0.05, 0.03], uSat: 0.8, uTemp: 0.2, uBloom: 0.6, uHalation: 0.4 }],
        ['sonho', 'Sonho (Orton)', 'Imagem difusa sobreposta: brilho etéreo em tudo.', { uDream: 1.5, uBloom: 0.6, uSat: 1.3, uExposure: 0.15, uSoft: 0.25 }],
        ['negativo', 'Negativo C-41', 'O próprio negativo: cores invertidas sobre a base laranja.', { uNeg: 1, uContrast: 1.1 }],
    ]],
    ['Processos antigos', [
        ['daguerreotipo', 'Daguerreótipo', 'Placa de prata: cinza metálico, foco macio, riscos e bordas escuras.', { uBW: 1, uTone: 1, uToneColor: [0.5, 0.52, 0.55], uVignette: 1.4, uScratch: 0.15, uDust: 0.4, uSoft: 0.35, uBlur: 0.8, uContrast: 1.3, uFade: 0.15, uBase: [0.08, 0.07, 0.06] }],
        ['sepia', 'Sépia antiga', 'Papel envelhecido: marrom, poeira, riscos e bordas queimadas.', { uBW: 1, uTone: 1, uToneColor: [0.62, 0.45, 0.28], uVignette: 1.0, uDust: 0.4, uScratch: 0.12, uFade: 0.2, uBase: [0.1, 0.07, 0.04], uGrain: 0.5, uBurn: 0.3 }],
        ['cianotipia', 'Cianotipia', 'Impressão azul da fotografia do século XIX.', { uBW: 1, uTone: 1, uToneColor: [0.15, 0.35, 0.62], uContrast: 1.2, uFade: 0.1, uBase: [0.08, 0.12, 0.2], uGrain: 0.2 }],
        ['autocromo', 'Autocromo', 'A primeira foto colorida: pontilhado de grãos coloridos e tons suaves.', { uAutochrome: 1.6, uSoft: 0.3, uFade: 0.2, uBase: [0.07, 0.06, 0.05], uSat: 0.8, uVignette: 0.8, uGrain: 0.3 }],
    ]],
];
