/* ==========================================================================
   PIXELAR STUDIO — ADAPTIVE UI CONTROLLER
   - Desktop (>1180px): Pure Desktop Studio (untouched)
   - iPhone (<=740px or __PIXELAR_DEVICE==='iphone'): Modelo D Glass Pro + Área Livre Inteligente
   - iPad 10 (741..1180px or __PIXELAR_DEVICE==='ipad'): Layout 5 Darkroom (Sessão + Régua Larga)
   UX Engineering:
   - Preserves horizontal & vertical scroll offsets across all selections (zero jump!)
   - Caches GPU preview thumbnails per media.id (zero black flicker!)
   - Uniform 10px rounded cards across Original, Limpar, Filmes & Lab
   - Clean, focused collapsible sub-modules for Lab (Efeitos / Paletas / Pixel) & Geometria
   - 100% crisp SVG icons (zero emojis or raw Unicode dingbats)
   ========================================================================== */
'use strict';

(() => {
  const App = window.PixelarApp;
  if (!App) return;

  const root = document.createElement('div');
  root.id = 'pxAdaptiveRoot';
  document.body.appendChild(root);

  const LOGO_SVG = `<svg class="px-ico" width="16" height="15" viewBox="0 0 12 11" aria-hidden="true"><path fill="#FDAF00" d="M4 0h4v1H4zM2 1h8v1H2zM1 2h10v2H1zM0 4h12v1H0zM0 6h12v1H0zM1 8h10v1H1zM3 10h6v1H3z"/></svg>`;
  const pxIco = (id, size = 13) => `<svg class="px-ico" width="${size}" height="${size}" aria-hidden="true"><use href="#${id}"/></svg>`;

  // Parameter catalog for the Tactile Precision Ruler (100% parity with Desktop)
  const SLIDER_GROUPS = {
    light: [
      { id: 'exposure',   label: 'Exposição',  min: -3, max: 3, step: 0.05, def: 0, get: s => s.light.exposure, set: (s, v) => s.light.exposure = v, fmt: v => (v > 0 ? '+' : '') + v.toFixed(2) + ' EV' },
      { id: 'contrast',   label: 'Contraste',  min: -100, max: 100, step: 1, def: 0, get: s => s.light.contrast, set: (s, v) => s.light.contrast = v },
      { id: 'highlights', label: 'Realces',    min: -100, max: 100, step: 1, def: 0, get: s => s.light.highlights, set: (s, v) => s.light.highlights = v },
      { id: 'shadows',    label: 'Sombras',    min: -100, max: 100, step: 1, def: 0, get: s => s.light.shadows, set: (s, v) => s.light.shadows = v },
      { id: 'whites',     label: 'Brancos',    min: -100, max: 100, step: 1, def: 0, get: s => s.light.whites, set: (s, v) => s.light.whites = v },
      { id: 'blacks',     label: 'Pretos',     min: -100, max: 100, step: 1, def: 0, get: s => s.light.blacks, set: (s, v) => s.light.blacks = v },
      { id: 'clarity',    label: 'Claridade',  min: -100, max: 100, step: 1, def: 0, get: s => s.presence.clarity, set: (s, v) => s.presence.clarity = v },
      { id: 'dehaze',     label: 'Desembaçar', min: -100, max: 100, step: 1, def: 0, get: s => s.presence.dehaze, set: (s, v) => s.presence.dehaze = v },
      { id: 'sharpen',    label: 'Nitidez',    min: 0, max: 100, step: 1, def: 0, get: s => s.presence.sharpen, set: (s, v) => s.presence.sharpen = v },
      { id: 'fade',       label: 'Fade',       min: 0, max: 100, step: 1, def: 0, get: s => s.presence.fade, set: (s, v) => s.presence.fade = v, fmt: v => v + '%' },
    ],
    color: [
      { id: 'temp',       label: 'Temperatura', min: -100, max: 100, step: 1, def: 0, get: s => s.color.temp, set: (s, v) => s.color.temp = v },
      { id: 'tint',       label: 'Matiz (Tint)',min: -100, max: 100, step: 1, def: 0, get: s => s.color.tint, set: (s, v) => s.color.tint = v },
      { id: 'vibrance',   label: 'Vibração',    min: -100, max: 100, step: 1, def: 0, get: s => s.color.vibrance, set: (s, v) => s.color.vibrance = v },
      { id: 'saturation', label: 'Saturação',   min: -100, max: 100, step: 1, def: 0, get: s => s.color.saturation, set: (s, v) => s.color.saturation = v },
    ],
    optics: [
      { id: 'halation',   label: 'Halação',     min: 0, max: 100, step: 1, def: 0, get: s => s.optics.halation, set: (s, v) => s.optics.halation = v, fmt: v => v + '%' },
      { id: 'bloom',      label: 'Pro-Mist',    min: 0, max: 100, step: 1, def: 0, get: s => s.optics.bloom, set: (s, v) => s.optics.bloom = v, fmt: v => v + '%' },
      { id: 'orton',      label: 'Orton Dream', min: 0, max: 100, step: 1, def: 0, get: s => s.optics.orton, set: (s, v) => s.optics.orton = v, fmt: v => v + '%' },
      { id: 'anamorphic', label: 'Anamórfico',  min: 0, max: 100, step: 1, def: 0, get: s => s.optics.anamorphic, set: (s, v) => s.optics.anamorphic = v, fmt: v => v + '%' },
      { id: 'grain',      label: 'Grão Filme',  min: 0, max: 100, step: 1, def: 0, get: s => s.optics.grain, set: (s, v) => s.optics.grain = v, fmt: v => v + '%' },
      { id: 'grainSize',  label: 'Tam. Grão',   min: 40, max: 220, step: 1, def: 95, get: s => s.optics.grainSize, set: (s, v) => s.optics.grainSize = v, fmt: v => v + '%' },
      { id: 'vignette',   label: 'Vinheta',     min: -100, max: 100, step: 1, def: 0, get: s => s.optics.vignette, set: (s, v) => s.optics.vignette = v },
      { id: 'leak',       label: 'Vazamento',   min: 0, max: 100, step: 1, def: 0, get: s => s.optics.leak, set: (s, v) => s.optics.leak = v, fmt: v => v + '%' },
      { id: 'chroma',     label: 'Aberração',   min: 0, max: 100, step: 1, def: 0, get: s => s.optics.chroma, set: (s, v) => s.optics.chroma = v, fmt: v => v + '%' },
      { id: 'flash',      label: 'Flash',       min: 0, max: 100, step: 1, def: 0, get: s => s.optics.flash, set: (s, v) => s.optics.flash = v, fmt: v => v + '%' },
      { id: 'rolloff',    label: 'Roll-off',    min: 0, max: 100, step: 1, def: 0, get: s => s.film.rolloff, set: (s, v) => s.film.rolloff = v, fmt: v => v + '%' },
      { id: 'toneAmt',    label: 'Viragem',     min: 0, max: 100, step: 1, def: 0, get: s => s.film.toneAmt, set: (s, v) => s.film.toneAmt = v, fmt: v => v + '%' },
    ],
    crop: [
      { id: 'straighten',  label: 'Endireitar',     min: -45, max: 45, step: 0.1, def: 0, get: s => s.crop.straighten || 0, set: (s, v) => s.crop.straighten = v, fmt: v => (v > 0 ? '+' : '') + v.toFixed(1) + '°' },
      { id: 'perspV',      label: 'Vertical V',     min: -100, max: 100, step: 1, def: 0, get: s => s.crop.perspV || 0, set: (s, v) => s.crop.perspV = v },
      { id: 'perspH',      label: 'Horizontal H',   min: -100, max: 100, step: 1, def: 0, get: s => s.crop.perspH || 0, set: (s, v) => s.crop.perspH = v },
      { id: 'skew',        label: 'Inclinação',     min: -100, max: 100, step: 1, def: 0, get: s => s.crop.skew || 0, set: (s, v) => s.crop.skew = v },
      { id: 'aspectWarp',  label: 'Alongar',        min: -100, max: 100, step: 1, def: 0, get: s => s.crop.aspectWarp || 0, set: (s, v) => s.crop.aspectWarp = v },
      { id: 'scale',       label: 'Escala',         min: 50, max: 200, step: 1, def: 100, get: s => s.crop.scale ?? 100, set: (s, v) => s.crop.scale = v, fmt: v => v + '%' },
      { id: 'offsetX',     label: 'Desloc. X',      min: -100, max: 100, step: 1, def: 0, get: s => s.crop.offsetX || 0, set: (s, v) => s.crop.offsetX = v },
      { id: 'offsetY',     label: 'Desloc. Y',      min: -100, max: 100, step: 1, def: 0, get: s => s.crop.offsetY || 0, set: (s, v) => s.crop.offsetY = v },
      { id: 'distortion',  label: 'Distorção Lente',min: -100, max: 100, step: 1, def: 0, get: s => s.crop.distortion || 0, set: (s, v) => s.crop.distortion = v },
      { id: 'lensVignette',label: 'Vinheta Lente',  min: -100, max: 100, step: 1, def: 0, get: s => s.crop.lensVignette || 0, set: (s, v) => s.crop.lensVignette = v },
    ],
  };

  const state = {
    layout: 'desktop', // 'desktop' | 'iphone' | 'ipad'
    dock: 'compact',   // 'pill' | 'compact' | 'expanded'
    tab: 'presets',    // iPad tabs: 'presets' | 'light' | 'color' | 'optics' | 'lab' | 'crop'
    phoneTab: 'presets', // iPhone tabs: 'presets' | 'lightcolor' | 'optics' | 'lab' | 'crop'
    filmCol: 'all',
    labCat: 'all',
    showPresetMix: false,
    activeParam: {
      light: 'exposure',
      color: 'temp',
      lightcolor: 'exposure',
      optics: 'halation',
      crop: 'straighten',
    },
    advSection: null, // 'curve' | 'hsl' | 'grade' | 'film' | 'lab_fx' | 'lab_palette' | 'lab_pixel' | 'crop_frame' | 'crop_lens'
    advTitle: '',
    ipadSessionOpen: false,
    reparentedKey: null,
  };

  // Scroll position memory (prevents any carousel/strip from jumping back to start!)
  const scrollMem = {};
  function saveScrollPositions() {
    root.querySelectorAll('[data-scroll-key]').forEach((el) => {
      scrollMem[el.dataset.scrollKey] = { x: el.scrollLeft, y: el.scrollTop };
    });
  }
  function restoreScrollPositions() {
    root.querySelectorAll('[data-scroll-key]').forEach((el) => {
      const mem = scrollMem[el.dataset.scrollKey];
      if (!mem) return;
      if (mem.x) el.scrollLeft = mem.x;
      if (mem.y) el.scrollTop = mem.y;
    });
  }

  // Thumbnail dataURL cache keyed by media.id + '|' + itemKey (zero black flicker!)
  const adThumbCache = new Map();
  let adThumbCacheMediaId = '';

  function ensureThumbCacheForMedia() {
    const mid = App.getMedia().id || '';
    if (mid !== adThumbCacheMediaId) {
      adThumbCache.clear();
      adThumbCacheMediaId = mid;
    }
  }

  function detectLayout() {
    const params = new URLSearchParams(location.search);
    const qMode = params.get('mode');
    if (qMode === 'iphone' || qMode === 'ipad' || qMode === 'desktop') return qMode;
    if (window.__PIXELAR_DEVICE === 'iphone') return 'iphone';
    if (window.__PIXELAR_DEVICE === 'ipad') return 'ipad';
    const w = window.innerWidth;
    const h = window.innerHeight;
    const isTouch = navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches;
    const isIpadOS = /iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIpadOS) return 'ipad';
    if (w <= 740 || (isTouch && Math.min(w, h) <= 500)) return 'iphone';
    if ((isTouch && w <= 1280) || w <= 1024) return 'ipad';
    return 'desktop';
  }

  function restoreBorrowedSection() {
    if (!state.reparentedKey) return;
    const sec = App.getSectionRef(state.reparentedKey);
    const insp = App.getInspectorMount();
    if (sec && insp) {
      sec.hidden = false;
      insp.appendChild(sec);
    }
    state.reparentedKey = null;
  }

  function borrowSectionInto(key, hostEl) {
    restoreBorrowedSection();
    if (!key || !hostEl) return;
    const sec = App.getSectionRef(key);
    if (!sec) return;
    sec.hidden = false;
    sec.classList.add('open');
    hostEl.innerHTML = '';
    hostEl.appendChild(sec);
    state.reparentedKey = key;
    setTimeout(() => App.sync(), 25);
  }

  // =========================================================================
  // TACTILE PRECISION RULER WIDGET (HAPTIC TICKS + GLASS AUTO-FADE)
  // =========================================================================
  function createRuler(param, onDragState) {
    const st = App.getState();
    const box = document.createElement('div');
    box.className = 'px-ruler-box';

    const head = document.createElement('div');
    head.className = 'px-ruler-head';
    const lbl = document.createElement('span');
    lbl.className = 'px-ruler-label';
    lbl.textContent = param.label;
    const valEl = document.createElement('span');
    valEl.className = 'px-ruler-val';
    valEl.title = 'Toque para zerar';
    head.append(lbl, valEl);

    const track = document.createElement('div');
    track.className = 'px-ruler-track';
    const ticks = document.createElement('div');
    ticks.className = 'px-ruler-ticks';
    const N = 41;
    const mid = Math.floor(N / 2);
    for (let i = 0; i < N; i++) {
      const t = document.createElement('i');
      if (i === mid) t.className = 'zero';
      else if ((i - mid) % 5 === 0) t.className = 'maj';
      ticks.appendChild(t);
    }
    const needle = document.createElement('div');
    needle.className = 'px-ruler-needle';
    track.append(ticks, needle);

    box.append(head, track);

    const formatVal = (v) => param.fmt ? param.fmt(v) : (v > 0 && param.min < 0 ? '+' + v : String(v));

    function updateVisual(v) {
      valEl.textContent = formatVal(v);
      const norm = (v - param.min) / Math.max(1e-5, param.max - param.min);
      const zeroNorm = (param.def - param.min) / Math.max(1e-5, param.max - param.min);
      const shiftPx = (zeroNorm - norm) * 140;
      ticks.style.transform = `translateX(${shiftPx.toFixed(1)}px)`;
    }
    updateVisual(param.get(st));

    let dragging = false;
    let startX = 0;
    let startV = 0;
    let lastTickStep = null;

    track.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      dragging = true;
      startX = e.clientX;
      startV = param.get(App.getState());
      lastTickStep = Math.round(startV / (param.step || 1));
      track.setPointerCapture(e.pointerId);
      App.setInteracting(true);
      if (onDragState) onDragState(true);
    });

    track.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const range = param.max - param.min;
      const sens = Math.max(180, track.clientWidth * 0.88);
      let next = startV + (dx / sens) * range;
      const step = param.step || 1;
      next = Math.round(next / step) * step;
      next = Math.max(param.min, Math.min(param.max, next));
      if (Math.abs(next - param.def) < range * 0.012) next = param.def;
      next = Number(next.toFixed(4));

      const stepInt = Math.round(next / step);
      if (stepInt !== lastTickStep) {
        if (next === param.def && lastTickStep !== Math.round(param.def / step)) App.haptic('medium');
        else if (Math.abs(stepInt - lastTickStep) >= 2) App.haptic('selection');
        lastTickStep = stepInt;
      }

      const cur = App.getState();
      param.set(cur, next);
      updateVisual(next);
      App.render();
      App.commit(false);
    });

    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      App.setInteracting(false);
      if (onDragState) onDragState(false);
      App.commit(true);
      App.sync();
    };
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);

    const resetVal = () => {
      const cur = App.getState();
      param.set(cur, param.def);
      updateVisual(param.def);
      App.haptic('light');
      App.render();
      App.commit(true);
      App.sync();
    };
    valEl.onclick = resetVal;
    track.addEventListener('dblclick', resetVal);

    return box;
  }

  // =========================================================================
  // CACHED LAZY THUMBNAIL QUEUE (ZERO FLICKER ON SELECTION)
  // =========================================================================
  let adThumbQueue = [];
  let adThumbTimer = 0;

  function pumpAdThumbs() {
    if (adThumbTimer) return;
    const src = App.getActiveSource();
    if (!src || !adThumbQueue.length) return;
    const step = () => {
      adThumbTimer = 0;
      const s = App.getActiveSource();
      if (!s) return;
      const mid = App.getMedia().id || '';
      const t0 = performance.now();
      while (adThumbQueue.length && performance.now() - t0 < 6) {
        const it = adThumbQueue.shift();
        if (!it.canvas.isConnected) continue;
        window.StudioGPU.renderToCanvas(s, mid + '_adth', it.stateFn(), it.canvas, {
          maxDim: 120, pool: 'thumb', grainUnit: 0.4,
        });
        try {
          adThumbCache.set(it.cacheKey, it.canvas.toDataURL('image/jpeg', 0.82));
        } catch {}
      }
      if (adThumbQueue.length) adThumbTimer = setTimeout(step, 18);
    };
    adThumbTimer = setTimeout(step, 16);
  }

  function createActionCard(iconId, label, isActive, onClick) {
    const card = document.createElement('button');
    card.className = 'px-thumb-card px-thumb-card-action' + (isActive ? ' active' : '');
    const box = document.createElement('div');
    box.className = 'px-thumb-action-box';
    box.innerHTML = pxIco(iconId, 18);
    const nm = document.createElement('span');
    nm.className = 'px-tn';
    nm.textContent = label;
    card.append(box, nm);
    card.onclick = onClick;
    return card;
  }

  function createPreviewCard(cacheKey, label, isActive, stateFn, onClick) {
    const card = document.createElement('button');
    card.className = 'px-thumb-card' + (isActive ? ' active' : '');
    const cachedUrl = adThumbCache.get(cacheKey);
    if (cachedUrl) {
      const img = document.createElement('img');
      img.className = 'px-thumb-img';
      img.src = cachedUrl;
      img.alt = label;
      img.decoding = 'async';
      card.appendChild(img);
    } else {
      const cv = document.createElement('canvas');
      cv.width = 120; cv.height = 80;
      card.appendChild(cv);
      adThumbQueue.push({ cacheKey, canvas: cv, stateFn });
    }
    const nm = document.createElement('span');
    nm.className = 'px-tn';
    nm.textContent = label;
    card.appendChild(nm);
    card.onclick = onClick;
    return card;
  }

  function mkQuickChip(label, isActive, onClick, iconId = '') {
    const b = document.createElement('button');
    b.className = 'px-chip' + (isActive ? ' active' : '');
    if (iconId) b.innerHTML = `${pxIco(iconId, 12)}<span>${label}</span>`;
    else b.textContent = label;
    b.onclick = onClick;
    return b;
  }

  // =========================================================================
  // CAROUSELS & SLIDER STRIPS (WITH SCROLL PRESERVATION)
  // =========================================================================
  function buildFilmCarousel(container, onDragState) {
    ensureThumbCacheForMedia();
    const st = App.getState();

    // Collection pills
    const colsRow = document.createElement('div');
    colsRow.className = 'px-hstrip px-nosb';
    colsRow.dataset.scrollKey = 'filmCols';
    (window.PRESET_COLLECTIONS || []).filter(c => c.id !== 'saved').forEach((c) => {
      const b = document.createElement('button');
      b.className = 'px-chip' + (state.filmCol === c.id ? ' active' : '');
      b.textContent = c.label;
      b.onclick = () => {
        state.filmCol = c.id;
        scrollMem.filmStrip = { x: 0, y: 0 };
        renderAdaptiveUI();
      };
      colsRow.appendChild(b);
    });
    container.appendChild(colsRow);

    // Optional Intensity Ruler + Variations when user taps active preset a second time
    const curP = window.getPresetById(st.preset.id);
    if (curP && state.showPresetMix) {
      if (curP.variations && curP.variations.length > 1) {
        const vRow = document.createElement('div');
        vRow.className = 'px-hstrip px-nosb';
        vRow.dataset.scrollKey = 'filmVars';
        curP.variations.forEach((v, idx) => {
          const vb = document.createElement('button');
          vb.className = 'px-chip' + (st.preset.variation === idx ? ' active' : '');
          vb.textContent = v.name;
          vb.onclick = () => {
            const next = window.buildPresetState(curP.id, idx, st.crop, st.preset.mix);
            App.setState(next); App.commit(true); App.sync(); App.render();
          };
          vRow.appendChild(vb);
        });
        container.appendChild(vRow);
      }
      container.appendChild(createRuler({
        id: 'mix', label: `Intensidade · ${curP.name}`, min: 0, max: 100, step: 1, def: 100,
        get: s => s.preset.mix ?? 100, set: (s, v) => s.preset.mix = v, fmt: v => v + '%',
      }, onDragState));
    }

    // Horizontal Film Thumbnail Strip (uniform 10px card rounding for Original + all Films)
    const strip = document.createElement('div');
    strip.className = 'px-hstrip px-nosb';
    strip.dataset.scrollKey = 'filmStrip';

    strip.appendChild(createActionCard('px-single', 'Original', st.preset.id === 'none', () => {
      App.haptic('light');
      const c = window.deepClone(st.crop);
      const ns = window.freshState(); ns.crop = c;
      state.showPresetMix = false;
      App.setState(ns); App.commit(true); App.sync(); App.render();
    }));

    const list = (window.PRESET_CATALOG || []).filter(p => state.filmCol === 'all' || p.collection === state.filmCol);
    adThumbQueue = [];
    list.forEach((p) => {
      const card = createPreviewCard(
        'film_' + p.id,
        p.name,
        st.preset.id === p.id,
        () => window.buildPresetState(p.id, 0, null, 100),
        () => {
          App.haptic('light');
          if (st.preset.id === p.id) {
            state.showPresetMix = !state.showPresetMix;
            renderAdaptiveUI();
            setTimeout(() => App.fitViewport(false), 30);
            return;
          }
          const next = window.buildPresetState(p.id, 0, st.crop, window.DEFAULT_PRESET_MIX);
          state.showPresetMix = false;
          App.setState(next); App.commit(true); App.sync(); App.render();
        }
      );
      strip.appendChild(card);
    });
    container.appendChild(strip);
    pumpAdThumbs();
  }

  function buildLabCarousel(container, onOpenAdvanced) {
    ensureThumbCacheForMedia();
    const st = App.getState();

    const topRow = document.createElement('div');
    topRow.className = 'px-hstrip px-nosb';
    topRow.dataset.scrollKey = 'labCats';

    const remix = document.createElement('button');
    remix.className = 'px-chip accent-solid';
    remix.innerHTML = `${pxIco('px-shuffle', 12)}<span>Remix</span>`;
    remix.onclick = () => {
      const list = window.LAB_PRESETS || [];
      if (!list.length) return;
      const pick = list[Math.floor(Math.random() * list.length)];
      st.lab = window.mergeState(window.deepClone(window.DEFAULT_STATE.lab), pick.lab);
      st.lab.presetId = pick.id;
      if (st.lab.fxId !== 'none') {
        st.lab.fxParam = Math.max(0, Math.min(100, (st.lab.fxParam ?? 50) + Math.round((Math.random() - 0.5) * 34)));
      }
      App.haptic('medium');
      App.commit(true); App.sync(); App.render();
      App.notify('Remix Lab: ' + pick.name);
    };
    topRow.appendChild(remix);

    // Focused collapsible sub-modules (instead of 1 giant uncollapsible Lab dump)
    const fxMod = st.lab.fxId !== 'none';
    const palMod = st.lab.colorMode !== 'all' || st.lab.palHue !== 0 || st.lab.palSat !== 0 || (st.lab.palLight || 0) !== 0 || !!st.lab.palInvert;
    const pixMod = st.lab.pixelSize > 1 || st.lab.ditherMode !== 'none';

    const btnFx = mkQuickChip('Efeitos', state.advSection === 'lab_fx', () => onOpenAdvanced('lab_fx', 'Lab · Efeitos & Texturas'), 'px-lab');
    if (fxMod) btnFx.classList.add('mod');
    const btnPal = mkQuickChip('Paletas', state.advSection === 'lab_palette', () => onOpenAdvanced('lab_palette', 'Lab · Paletas & Recoloração'), 'px-color');
    if (palMod) btnPal.classList.add('mod');
    const btnPix = mkQuickChip('Pixel', state.advSection === 'lab_pixel', () => onOpenAdvanced('lab_pixel', 'Lab · Pixel & Pontilhado'), 'px-sliders');
    if (pixMod) btnPix.classList.add('mod');

    topRow.append(btnFx, btnPal, btnPix);

    (window.LAB_PRESET_CATS || []).forEach((c) => {
      const cb = document.createElement('button');
      cb.className = 'px-chip' + (state.labCat === c.id ? ' active' : '');
      cb.textContent = c.label;
      cb.onclick = () => {
        state.labCat = c.id;
        scrollMem.labStrip = { x: 0, y: 0 };
        renderAdaptiveUI();
      };
      topRow.appendChild(cb);
    });
    container.appendChild(topRow);

    // Horizontal Lab Presets Strip (uniform 10px card rounding for Limpar + all Lab recipes)
    const strip = document.createElement('div');
    strip.className = 'px-hstrip px-nosb';
    strip.dataset.scrollKey = 'labStrip';

    const isLabClean = st.lab.fxId === 'none' && st.lab.colorMode === 'all' && st.lab.pixelSize === 1 && st.lab.ditherMode === 'none';
    strip.appendChild(createActionCard('px-reset', 'Limpar', isLabClean, () => {
      App.haptic('light');
      st.lab = window.deepClone(window.DEFAULT_STATE.lab);
      App.commit(true); App.sync(); App.render();
    }));

    const list = (window.LAB_PRESETS || []).filter(p => state.labCat === 'all' || p.cat === state.labCat);
    adThumbQueue = [];
    list.forEach((lp) => {
      const card = createPreviewCard(
        'lab_' + lp.id,
        lp.name,
        st.lab.presetId === lp.id,
        () => { const s = window.freshState(); s.lab = window.mergeState(s.lab, lp.lab); return s; },
        () => {
          App.haptic('light');
          if (st.lab.presetId === lp.id) {
            st.lab = window.deepClone(window.DEFAULT_STATE.lab);
          } else {
            st.lab = window.mergeState(window.deepClone(window.DEFAULT_STATE.lab), lp.lab);
            st.lab.presetId = lp.id;
          }
          App.commit(true); App.sync(); App.render();
        }
      );
      strip.appendChild(card);
    });
    container.appendChild(strip);
    pumpAdThumbs();
  }

  function buildSliderPanel(container, groupKey, params, extraChips, onDragState) {
    const st = App.getState();
    const curId = state.activeParam[groupKey] || params[0].id;
    const activeParam = params.find(p => p.id === curId) || params[0];

    container.appendChild(createRuler(activeParam, onDragState));

    const strip = document.createElement('div');
    strip.className = 'px-hstrip px-nosb';
    strip.dataset.scrollKey = 'params_' + groupKey;
    (extraChips || []).forEach(el => strip.appendChild(el));

    params.forEach((p) => {
      const b = document.createElement('button');
      const isMod = Math.abs(p.get(st) - p.def) > 0.001;
      b.className = 'px-chip' + (activeParam.id === p.id ? ' active' : '') + (isMod ? ' mod' : '');
      b.textContent = p.label;
      b.onclick = () => {
        App.haptic('selection');
        state.activeParam[groupKey] = p.id;
        renderAdaptiveUI();
      };
      strip.appendChild(b);
    });
    container.appendChild(strip);
  }

  // =========================================================================
  // RENDER IPHONE — MODELO D (GLASS PRO + ÁREA LIVRE INTELIGENTE)
  // =========================================================================
  function renderIphoneUI() {
    saveScrollPositions();
    restoreBorrowedSection();
    root.innerHTML = '';
    const st = App.getState();
    const view = App.getView();

    App.setGridTabActive(state.phoneTab === 'crop');

    // Top Floating Glass Pills
    const topBar = document.createElement('div');
    topBar.className = 'm-top-pills';
    topBar.id = 'mGlassTop';

    const leftPill = document.createElement('div');
    leftPill.className = 'm-pill px-glass';
    const openBtn = document.createElement('button');
    openBtn.className = 'm-icon-btn';
    openBtn.innerHTML = `${LOGO_SVG}<span>Abrir</span>`;
    openBtn.onclick = () => App.openMedia();
    leftPill.appendChild(openBtn);

    const rightPill = document.createElement('div');
    rightPill.className = 'm-pill px-glass';

    const btnUndo = document.createElement('button');
    btnUndo.className = 'm-icon-btn icon-only'; btnUndo.id = 'adBtnUndo';
    btnUndo.setAttribute('aria-label', 'Desfazer');
    btnUndo.innerHTML = pxIco('px-undo', 14);
    btnUndo.disabled = document.getElementById('btnUndo').disabled;
    btnUndo.onclick = () => App.undo();

    const btnRedo = document.createElement('button');
    btnRedo.className = 'm-icon-btn icon-only'; btnRedo.id = 'adBtnRedo';
    btnRedo.setAttribute('aria-label', 'Refazer');
    btnRedo.innerHTML = pxIco('px-redo', 14);
    btnRedo.disabled = document.getElementById('btnRedo').disabled;
    btnRedo.onclick = () => App.redo();

    const btnSplit = document.createElement('button');
    btnSplit.className = 'm-icon-btn' + (view.mode === 'split' ? ' active' : '');
    btnSplit.innerHTML = `${pxIco('px-split', 13)}<span>Cortina</span>`;
    btnSplit.onclick = () => {
      App.setViewMode(view.mode === 'split' ? 'single' : 'split');
      renderAdaptiveUI();
    };

    const btnExp = document.createElement('button');
    btnExp.className = 'm-icon-btn export';
    btnExp.textContent = 'Exportar';
    btnExp.onclick = () => App.openExport();

    rightPill.append(btnUndo, btnRedo, btnSplit, btnExp);
    topBar.append(leftPill, rightPill);

    // Bottom Floating Glass Dock (3 states: pill | compact | expanded)
    const dock = document.createElement('div');
    dock.className = 'm-glass-dock px-glass';
    dock.id = 'mGlassDock';
    dock.dataset.dock = state.dock;

    const handle = document.createElement('button');
    handle.className = 'm-dock-handle';
    handle.setAttribute('aria-label', 'Alternar tamanho do painel');
    handle.innerHTML = '<span></span>';
    handle.onclick = () => {
      App.haptic('light');
      if (state.dock === 'pill') state.dock = 'compact';
      else if (state.dock === 'compact') state.dock = state.advSection ? 'expanded' : 'pill';
      else { state.dock = 'compact'; state.advSection = null; }
      renderAdaptiveUI();
      setTimeout(() => App.fitViewport(false), 30);
    };
    dock.appendChild(handle);

    const onDragState = (isDragging) => {
      dock.classList.toggle('glass-dragging', isDragging);
      topBar.classList.toggle('glass-dragging', isDragging);
    };

    const body = document.createElement('div');
    body.className = 'm-dock-body';

    const openPhoneAdv = (secKey) => {
      if (state.advSection === secKey && state.dock === 'expanded') {
        state.advSection = null; state.dock = 'compact';
      } else {
        state.advSection = secKey; state.dock = 'expanded';
      }
      renderAdaptiveUI();
      setTimeout(() => App.fitViewport(false), 40);
    };

    if (state.phoneTab === 'presets') {
      buildFilmCarousel(body, onDragState);
    } else if (state.phoneTab === 'lightcolor') {
      const merged = [...SLIDER_GROUPS.light, ...SLIDER_GROUPS.color];
      const extras = [
        mkQuickChip('Auto Luz', false, () => App.autoTone(), 'px-light'),
        mkQuickChip('Curva', state.advSection === 'curve', () => openPhoneAdv('curve'), 'px-curve'),
        mkQuickChip('HSL', state.advSection === 'hsl', () => openPhoneAdv('hsl'), 'px-sliders'),
        mkQuickChip('Rodas', state.advSection === 'grade', () => openPhoneAdv('grade'), 'px-color'),
      ];
      buildSliderPanel(body, 'lightcolor', merged, extras, onDragState);
    } else if (state.phoneTab === 'optics') {
      const extras = [
        mkQuickChip('Química & Vencido', state.advSection === 'film', () => openPhoneAdv('film'), 'px-optics'),
      ];
      buildSliderPanel(body, 'optics', SLIDER_GROUPS.optics, extras, onDragState);
    } else if (state.phoneTab === 'lab') {
      buildLabCarousel(body, (secKey) => openPhoneAdv(secKey));
    } else if (state.phoneTab === 'crop') {
      const extras = [
        mkQuickChip('Proporções', state.advSection === 'crop_frame', () => openPhoneAdv('crop_frame'), 'px-crop'),
        mkQuickChip('Lente', state.advSection === 'crop_lens', () => openPhoneAdv('crop_lens'), 'px-optics'),
        mkQuickChip('−90°', false, () => { st.crop.rot = (st.crop.rot + 270) % 360; window.StudioGPU.invalidate(); App.render(); App.commit(true); }, 'px-rot-l'),
        mkQuickChip('+90°', false, () => { st.crop.rot = (st.crop.rot + 90) % 360; window.StudioGPU.invalidate(); App.render(); App.commit(true); }, 'px-rot-r'),
        mkQuickChip('Esp. H', !!st.crop.flipH, () => { st.crop.flipH = !st.crop.flipH; App.render(); App.commit(true); renderAdaptiveUI(); }, 'px-flip-h'),
        mkQuickChip('Auto-Corte', !!st.crop.constrainCrop, () => { st.crop.constrainCrop = !st.crop.constrainCrop; App.render(); App.commit(true); renderAdaptiveUI(); }, st.crop.constrainCrop ? 'px-check' : ''),
      ];
      buildSliderPanel(body, 'crop', SLIDER_GROUPS.crop, extras, onDragState);
    }

    if (state.dock === 'expanded' && state.advSection) {
      const host = document.createElement('div');
      host.className = 'px-adv-host';
      host.dataset.scrollKey = 'advHost';
      body.appendChild(host);
      borrowSectionInto(state.advSection, host);
    }

    dock.appendChild(body);

    // 5 Bottom Tabs
    const tabs = document.createElement('div');
    tabs.className = 'm-dock-tabs';
    [
      ['presets', 'px-film', 'Filmes'],
      ['lightcolor', 'px-light', 'Luz/Cor'],
      ['optics', 'px-optics', 'Óptica'],
      ['lab', 'px-lab', 'Lab'],
      ['crop', 'px-crop', 'Geom'],
    ].forEach(([k, ico, lbl]) => {
      const b = document.createElement('button');
      b.className = 'm-tab-btn' + (state.phoneTab === k ? ' active' : '');
      b.innerHTML = `${pxIco(ico, 16)}<span>${lbl}</span>`;
      b.onclick = () => {
        App.haptic('selection');
        if (state.phoneTab === k && state.dock !== 'pill') {
          state.dock = 'pill'; state.advSection = null;
        } else {
          state.phoneTab = k;
          state.advSection = null;
          if (state.dock === 'pill') state.dock = 'compact';
        }
        renderAdaptiveUI();
        setTimeout(() => App.fitViewport(false), 30);
      };
      tabs.appendChild(b);
    });
    dock.appendChild(tabs);

    root.append(topBar, dock);
    restoreScrollPositions();
  }

  // =========================================================================
  // RENDER IPAD 10 — LAYOUT 5 (DARKROOM IPAD: SESSÃO + RÉGUA LARGA)
  // =========================================================================
  function renderIpadUI() {
    saveScrollPositions();
    restoreBorrowedSection();
    root.innerHTML = '';
    const st = App.getState();
    const view = App.getView();
    const media = App.getMedia();

    App.setGridTabActive(state.tab === 'crop');

    // Clean Top Bar
    const top = document.createElement('header');
    top.className = 'ip-topbar';

    const leftG = document.createElement('div');
    leftG.className = 'ip-topbar-group';
    const sessToggle = document.createElement('button');
    sessToggle.className = 'px-chip' + (state.ipadSessionOpen ? ' active' : '');
    sessToggle.innerHTML = `${LOGO_SVG}<span>Sessão</span>`;
    sessToggle.onclick = () => { state.ipadSessionOpen = !state.ipadSessionOpen; renderAdaptiveUI(); setTimeout(() => App.fitViewport(false), 30); };

    const title = document.createElement('span');
    title.className = 'ip-title';
    title.textContent = media.name || 'Pixelar Studio';
    leftG.append(sessToggle, title);

    const midG = document.createElement('div');
    midG.className = 'ip-topbar-group';
    const btnSplit = mkQuickChip('Cortina', view.mode === 'split', () => { App.setViewMode(view.mode === 'split' ? 'single' : 'split'); renderAdaptiveUI(); }, 'px-split');
    const btnSide = mkQuickChip('Lado a Lado', view.mode === 'side', () => { App.setViewMode(view.mode === 'side' ? 'single' : 'side'); renderAdaptiveUI(); }, 'px-side');
    const btnAuto = mkQuickChip('Auto Luz', false, () => App.autoTone(), 'px-light');
    midG.append(btnSplit, btnSide, btnAuto);

    const rightG = document.createElement('div');
    rightG.className = 'ip-topbar-group';
    const btnUndo = document.createElement('button');
    btnUndo.className = 'px-chip icon-sq'; btnUndo.id = 'adBtnUndo';
    btnUndo.setAttribute('aria-label', 'Desfazer');
    btnUndo.innerHTML = pxIco('px-undo', 14);
    btnUndo.disabled = document.getElementById('btnUndo').disabled;
    btnUndo.onclick = () => App.undo();

    const btnRedo = document.createElement('button');
    btnRedo.className = 'px-chip icon-sq'; btnRedo.id = 'adBtnRedo';
    btnRedo.setAttribute('aria-label', 'Refazer');
    btnRedo.innerHTML = pxIco('px-redo', 14);
    btnRedo.disabled = document.getElementById('btnRedo').disabled;
    btnRedo.onclick = () => App.redo();

    const btnExp = document.createElement('button');
    btnExp.className = 'px-chip accent-solid';
    btnExp.innerHTML = `${pxIco('px-export', 13)}<span>Exportar</span>`;
    btnExp.onclick = () => App.openExport();

    rightG.append(btnUndo, btnRedo, btnExp);
    top.append(leftG, midG, rightG);

    // Left Session Filmstrip Sidebar (Darkroom iPad Signature)
    const sess = document.createElement('aside');
    sess.className = 'ip-session px-nosb' + (state.ipadSessionOpen ? ' force-open' : '');
    sess.id = 'ipSession';
    sess.dataset.scrollKey = 'ipadSession';
    const slbl = document.createElement('span');
    slbl.className = 'ip-session-label'; slbl.textContent = 'Sessão';
    sess.appendChild(slbl);

    App.getSessionItems().forEach((item) => {
      const b = document.createElement('button');
      b.className = 'ip-sess-item' + (media.id === item.id ? ' active' : '');
      b.title = item.title;
      b.innerHTML = `<img src="${item.thumb}" alt="${item.title}">`;
      b.onclick = () => App.loadPhotoSrc(item.src, item.title, item.id);
      sess.appendChild(b);
    });
    const addBtn = document.createElement('button');
    addBtn.className = 'ip-sess-add';
    addBtn.setAttribute('aria-label', 'Abrir foto ou vídeo');
    addBtn.innerHTML = pxIco('px-plus', 15);
    addBtn.onclick = () => App.openMedia();
    sess.appendChild(addBtn);

    // Bottom Wide Tactile Precision Ruler Dock
    const dock = document.createElement('section');
    dock.className = 'ip-dock';
    dock.id = 'ipDock';

    const openIpadPop = (secKey, popTitle) => {
      if (state.advSection === secKey) {
        state.advSection = null; state.advTitle = '';
      } else {
        state.advSection = secKey; state.advTitle = popTitle;
      }
      renderAdaptiveUI();
    };

    if (state.tab === 'presets') {
      buildFilmCarousel(dock, null);
    } else if (state.tab === 'light') {
      const extras = [mkQuickChip('Curva RGB', state.advSection === 'curve', () => openIpadPop('curve', 'Curva de Tons RGB'), 'px-curve')];
      buildSliderPanel(dock, 'light', SLIDER_GROUPS.light, extras, null);
    } else if (state.tab === 'color') {
      const extras = [
        mkQuickChip('HSL (8 Cores)', state.advSection === 'hsl', () => openIpadPop('hsl', 'Misturador HSL (8 Cores)'), 'px-sliders'),
        mkQuickChip('Rodas 3-Vias', state.advSection === 'grade', () => openIpadPop('grade', 'Color Grading (3-Vias)'), 'px-color'),
      ];
      buildSliderPanel(dock, 'color', SLIDER_GROUPS.color, extras, null);
    } else if (state.tab === 'optics') {
      const extras = [mkQuickChip('Química & Vencido', state.advSection === 'film', () => openIpadPop('film', 'Química do Filme & Vencido'), 'px-optics')];
      buildSliderPanel(dock, 'optics', SLIDER_GROUPS.optics, extras, null);
    } else if (state.tab === 'lab') {
      buildLabCarousel(dock, (secKey, t) => openIpadPop(secKey, t));
    } else if (state.tab === 'crop') {
      const extras = [
        mkQuickChip('Proporções & Grade', state.advSection === 'crop_frame', () => openIpadPop('crop_frame', 'Corte, Proporção & Grade'), 'px-crop'),
        mkQuickChip('Lente', state.advSection === 'crop_lens', () => openIpadPop('crop_lens', 'Correção de Lente'), 'px-optics'),
        mkQuickChip('−90°', false, () => { st.crop.rot = (st.crop.rot + 270) % 360; window.StudioGPU.invalidate(); App.render(); App.commit(true); }, 'px-rot-l'),
        mkQuickChip('+90°', false, () => { st.crop.rot = (st.crop.rot + 90) % 360; window.StudioGPU.invalidate(); App.render(); App.commit(true); }, 'px-rot-r'),
        mkQuickChip('Esp. H', !!st.crop.flipH, () => { st.crop.flipH = !st.crop.flipH; App.render(); App.commit(true); renderAdaptiveUI(); }, 'px-flip-h'),
        mkQuickChip('Esp. V', !!st.crop.flipV, () => { st.crop.flipV = !st.crop.flipV; App.render(); App.commit(true); renderAdaptiveUI(); }, 'px-flip-v'),
        mkQuickChip('Auto-Corte', !!st.crop.constrainCrop, () => { st.crop.constrainCrop = !st.crop.constrainCrop; App.render(); App.commit(true); renderAdaptiveUI(); }, st.crop.constrainCrop ? 'px-check' : ''),
      ];
      buildSliderPanel(dock, 'crop', SLIDER_GROUPS.crop, extras, null);
    }

    // 6 Bottom Category Tabs
    const tabRow = document.createElement('div');
    tabRow.className = 'ip-dock-tabs';
    [
      ['presets', 'px-film', 'Filmes'],
      ['light', 'px-light', 'Luz'],
      ['color', 'px-color', 'Cor'],
      ['optics', 'px-optics', 'Óptica'],
      ['lab', 'px-lab', 'Lab'],
      ['crop', 'px-crop', 'Geometria'],
    ].forEach(([k, ico, lbl]) => {
      const b = document.createElement('button');
      b.className = 'ip-tab-btn' + (state.tab === k ? ' active' : '');
      b.innerHTML = `${pxIco(ico, 15)}<span>${lbl}</span>`;
      b.onclick = () => {
        App.haptic('selection');
        state.tab = k;
        state.advSection = null;
        renderAdaptiveUI();
        setTimeout(() => App.fitViewport(false), 30);
      };
      tabRow.appendChild(b);
    });
    dock.appendChild(tabRow);

    root.append(top, sess, dock);

    // Optional Floating Glass Popover for 2D / Sub-Module Widgets
    if (state.advSection) {
      const pop = document.createElement('div');
      pop.className = 'ip-popover px-glass';
      const head = document.createElement('div');
      head.className = 'ip-popover-head';
      head.innerHTML = `<span>${state.advTitle || 'Ajustes Avançados'}</span>`;
      const cls = document.createElement('button');
      cls.className = 'px-chip icon-sq';
      cls.style.height = '26px';
      cls.style.width = '26px';
      cls.setAttribute('aria-label', 'Fechar');
      cls.innerHTML = pxIco('px-close', 11);
      cls.onclick = () => { state.advSection = null; renderAdaptiveUI(); };
      head.appendChild(cls);
      const host = document.createElement('div');
      host.className = 'px-adv-host';
      host.dataset.scrollKey = 'advHost';
      pop.append(head, host);
      root.appendChild(pop);
      borrowSectionInto(state.advSection, host);
    }

    restoreScrollPositions();
  }

  function renderAdaptiveUI() {
    if (state.layout === 'iphone') renderIphoneUI();
    else if (state.layout === 'ipad') renderIpadUI();
    else { restoreBorrowedSection(); root.innerHTML = ''; }
  }

  // =========================================================================
  // ÁREA LIVRE INTELIGENTE (IPHONE MODELO D) & IPAD 5 FIT CALCULATOR
  // =========================================================================
  function computeFit(viewport, outCanvas, view) {
    if (state.layout === 'desktop') return null;
    const W = viewport.clientWidth || window.innerWidth;
    const H = viewport.clientHeight || window.innerHeight;
    const aspect = outCanvas.width / Math.max(1, outCanvas.height);

    if (state.layout === 'iphone') {
      const topEl = document.getElementById('mGlassTop');
      const dockEl = document.getElementById('mGlassDock');
      const topSafe = topEl ? (topEl.getBoundingClientRect().bottom + 8) : 64;
      const dockTop = dockEl ? dockEl.getBoundingClientRect().top : (H - 170);
      const botSafe = Math.max(70, H - dockTop + 8);

      // Área Livre Inteligente:
      // Fotos horizontais/quadradas (aspect >= 0.88) centralizam na área livre entre pílula superior e card flutuante.
      // Fotos verticais (aspect < 0.88) aproveitam a altura edge-to-edge atrás do vidro.
      if (aspect >= 0.88) {
        const freeH = Math.max(120, H - topSafe - botSafe);
        const freeW = Math.max(120, W - 16);
        const sc = Math.min(freeW / outCanvas.width, freeH / outCanvas.height);
        const freeCenterY = topSafe + freeH * 0.5;
        return {
          fitW: Math.max(1, Math.floor(outCanvas.width * sc)),
          fitH: Math.max(1, Math.floor(outCanvas.height * sc)),
          offsetY: Math.round(freeCenterY - H * 0.5),
        };
      } else {
        const sc = Math.min((W - 6) / outCanvas.width, (H - 12) / outCanvas.height);
        return {
          fitW: Math.max(1, Math.floor(outCanvas.width * sc)),
          fitH: Math.max(1, Math.floor(outCanvas.height * sc)),
          offsetY: 0,
        };
      }
    }

    if (state.layout === 'ipad') {
      const topEl = root.querySelector('.ip-topbar');
      const dockEl = document.getElementById('ipDock');
      const sessEl = document.getElementById('ipSession');
      const topH = topEl ? topEl.getBoundingClientRect().height : 50;
      const dockH = dockEl ? dockEl.getBoundingClientRect().height : 160;
      const leftW = (sessEl && getComputedStyle(sessEl).display !== 'none') ? sessEl.getBoundingClientRect().width : 0;

      const availW = Math.max(160, W - leftW - 32);
      const availH = Math.max(160, H - topH - dockH - 24);
      let sc;
      if (view.mode === 'side') {
        sc = Math.min(Math.max(80, (availW - 12) / 2) / outCanvas.width, availH / outCanvas.height);
      } else {
        sc = Math.min(availW / outCanvas.width, availH / outCanvas.height);
      }
      const centerY = topH + 12 + availH * 0.5;
      return {
        fitW: Math.max(1, Math.floor(outCanvas.width * sc)),
        fitH: Math.max(1, Math.floor(outCanvas.height * sc)),
        offsetX: Math.round(leftW * 0.5),
        offsetY: Math.round(centerY - H * 0.5),
      };
    }
    return null;
  }

  // =========================================================================
  // TOUCH GESTURES ON CANVAS: LONG-PRESS ORIGINAL + TAP DOCK + PINCH ZOOM
  // =========================================================================
  const viewport = document.getElementById('viewport');
  let holdTimer = 0;
  let heldOrig = false;
  let tapStart = null;
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  let lastTapMs = 0;

  viewport.addEventListener('touchstart', (e) => {
    if (state.layout === 'desktop') return;
    if (e.target.closest('.split-line')) return;
    if (e.touches.length === 2) {
      clearTimeout(holdTimer);
      pinchStartDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      pinchStartZoom = App.getView().zoom;
      return;
    }
    if (e.touches.length === 1) {
      const t = e.touches[0];
      tapStart = { x: t.clientX, y: t.clientY, time: performance.now() };
      heldOrig = false;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        if (!tapStart) return;
        heldOrig = true;
        App.haptic('light');
        App.setHoldOrig(true);
      }, 240);
    }
  }, { passive: true });

  viewport.addEventListener('touchmove', (e) => {
    if (state.layout === 'desktop') return;
    if (e.touches.length === 2 && pinchStartDist > 10) {
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      App.setZoom(pinchStartZoom * (dist / pinchStartDist));
      return;
    }
    if (tapStart && e.touches.length === 1) {
      const t = e.touches[0];
      if (Math.hypot(t.clientX - tapStart.x, t.clientY - tapStart.y) > 10) {
        clearTimeout(holdTimer);
        tapStart = null;
      }
    }
  }, { passive: true });

  const endTouch = () => {
    clearTimeout(holdTimer);
    if (heldOrig) {
      heldOrig = false;
      App.setHoldOrig(false);
    } else if (tapStart && performance.now() - tapStart.time < 220) {
      const now = performance.now();
      if (now - lastTapMs < 280) {
        App.zoomFit();
      } else if (state.layout === 'iphone') {
        state.dock = state.dock === 'pill' ? 'compact' : 'pill';
        if (state.dock === 'pill') state.advSection = null;
        renderAdaptiveUI();
        setTimeout(() => App.fitViewport(false), 30);
      }
      lastTapMs = now;
    }
    tapStart = null;
    pinchStartDist = 0;
  };
  viewport.addEventListener('touchend', endTouch, { passive: true });
  viewport.addEventListener('touchcancel', endTouch, { passive: true });

  // =========================================================================
  // LIFECYCLE & RESIZE SYNC
  // =========================================================================
  function syncLayout(force = false) {
    const next = detectLayout();
    if (!force && next === state.layout) {
      if (state.layout !== 'desktop') setTimeout(() => App.fitViewport(false), 20);
      return;
    }
    state.layout = next;
    document.body.dataset.layout = next;
    if (next === 'desktop') {
      restoreBorrowedSection();
      root.innerHTML = '';
    } else {
      renderAdaptiveUI();
    }
    setTimeout(() => App.fitViewport(true), 40);
  }

  window.__PX_ADAPTIVE = {
    computeFit,
    onSync: () => { if (state.layout !== 'desktop' && !state.reparentedKey) renderAdaptiveUI(); },
    onMediaChange: () => {
      adThumbCache.clear();
      if (state.layout !== 'desktop') {
        renderAdaptiveUI();
        setTimeout(() => App.fitViewport(true), 40);
      }
    },
    onHistory: (canUndo, canRedo) => {
      const u = document.getElementById('adBtnUndo');
      const r = document.getElementById('adBtnRedo');
      if (u) u.disabled = !canUndo;
      if (r) r.disabled = !canRedo;
    },
    setLayout: (m) => { window.__PIXELAR_DEVICE = m; syncLayout(true); },
  };

  window.addEventListener('resize', () => syncLayout(false));
  window.addEventListener('orientationchange', () => setTimeout(() => syncLayout(true), 120));

  syncLayout(true);

  // Register offline PWA Service Worker cleanly when served on GitHub Pages / HTTPS
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
    });
  }
})();
