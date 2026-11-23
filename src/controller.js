/* ==========================================================================
   PIXELAR STUDIO — Beta 3 Lightroom Desktop & Mobile Controller
   - Fixed "Foto" mode (origCanvas hidden cleanly, never blocks edits)
   - Equal-size Side-by-Side comparison (identical fitW x fitH)
   - Full Video (MP4/MOV/WebM) & Sony Cyber-shot .AVI (MJPEG + PCM) support
   - Modern Video Conversion/Export with live GPU effects + audio
   - Lightroom Mobile bottom-sheet & tab navigation (auto <= 860px + toggle)
   - Expanded Creative Lab (2..32 palette quantization, Duotone/Tritone,
     recoloring, 12 practical & wild textures) & 13 film chemistries
   - IntersectionObserver lazy preset thumbnails + isDrag fast path
   - Original 100% quality preserved on photo & video exports
   ========================================================================== */
'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const pxIco = (id, size = 13) => `<svg class="px-ico" width="${size}" height="${size}" aria-hidden="true"><use href="#${id}"/></svg>`;

  let st = window.freshState();
  let isInteracting = false;

  // Unified Media State: 'image' | 'video' | 'avi'
  const media = {
    kind: 'image',
    id: '',
    name: '',
    w: 0,
    h: 0,
    img: null,
    // Native video
    videoEl: $('nativeVideo'),
    videoUrl: '',
    // Sony Cyber-shot AVI
    avi: null,
    aviFrameIdx: 0,
    aviFrameBmp: null,
    aviDecodeBusy: false,
    // Playback
    playing: false,
    rafId: 0,
    playStartPerf: 0,
    playStartTime: 0,
    audioCtx: null,
    audioSrc: null,
  };

  const view = {
    mode: 'single',
    split: 0.5,
    zoom: 1,
    panX: 0,
    panY: 0,
    fitW: 0,
    fitH: 0,
    holdOrig: false,
  };

  const store = {
    get(k, def) {
      try { const v = localStorage.getItem('pixelar_studio.' + k); return v === null ? def : JSON.parse(v); }
      catch { return def; }
    },
    set(k, v) {
      try { localStorage.setItem('pixelar_studio.' + k, JSON.stringify(v)); } catch {}
    },
  };

  const ui = {
    collection: 'all',
    labCat: 'all',
    search: '',
    favOnly: false,
    favs: new Set(store.get('favs', ['gold200', 'vencido_viva', 'vencido_redscale', 'cam_cybershot', 'cinestill800t'])),
    savedPresets: store.get('savedPresets', []),
    activeCurveCh: 'rgb',
    activeHslBand: 'red',
    openSections: new Set(['light', 'color', 'film', 'optics']),
    exportFmt: 'png',
    exportQuality: 96,
    mobileManual: null, // null = auto <= 860px, true/false = manual override
    mobActiveTab: 'presets',
  };

  const hist = { stack: [], i: -1, timer: 0 };

  const studioEl = $('studio');
  const outCanvas = $('outCanvas');
  const origCanvas = $('origCanvas');
  const gridOverlay = $('gridOverlay');
  const viewport = $('viewport');
  const canvasFrame = $('canvasFrame');
  const splitLine = $('splitLine');
  const histCanvas = $('histCanvas');

  function getActiveSource() {
    if (media.kind === 'image') return media.img;
    if (media.kind === 'video') return media.videoEl && media.videoEl.readyState >= 2 ? media.videoEl : null;
    if (media.kind === 'avi') return media.aviFrameBmp;
    return null;
  }

  // Track active pointer interaction to skip heavy optical passes during slider drag
  window.addEventListener('pointerdown', (e) => {
    if (e.target.closest('input[type="range"], #curveCanvas, .wheel-canvas')) isInteracting = true;
  }, true);
  const endInteract = () => {
    if (!isInteracting) return;
    isInteracting = false;
    requestRender(); // Snap immediately to full quality preview on release
  };
  window.addEventListener('pointerup', endInteract, true);
  window.addEventListener('pointercancel', endInteract, true);

  // =========================================================================
  // TOASTS
  // =========================================================================
  function toast(msg) {
    const stack = $('toastStack');
    stack.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.remove(); }, 2600);
  }

  // =========================================================================
  // HISTORY (UNDO / REDO)
  // =========================================================================
  function pushHistory() {
    const snap = JSON.stringify(st);
    if (hist.stack[hist.i] === snap) return;
    hist.stack = hist.stack.slice(0, hist.i + 1);
    hist.stack.push(snap);
    if (hist.stack.length > 60) hist.stack.shift();
    hist.i = hist.stack.length - 1;
    updateHistoryButtons();
  }

  function commit(immediate = false) {
    clearTimeout(hist.timer);
    if (immediate) pushHistory();
    else hist.timer = setTimeout(pushHistory, 260);
  }

  function updateHistoryButtons() {
    $('btnUndo').disabled = hist.i <= 0;
    $('btnRedo').disabled = hist.i >= hist.stack.length - 1;
    if (window.__PX_ADAPTIVE && window.__PX_ADAPTIVE.onHistory) window.__PX_ADAPTIVE.onHistory(hist.i > 0, hist.i < hist.stack.length - 1);
  }

  function undo() {
    if (hist.i <= 0) return;
    hist.i--;
    st = JSON.parse(hist.stack[hist.i]);
    syncAllUI();
    requestRender();
    updateHistoryButtons();
  }

  function redo() {
    if (hist.i >= hist.stack.length - 1) return;
    hist.i++;
    st = JSON.parse(hist.stack[hist.i]);
    syncAllUI();
    requestRender();
    updateHistoryButtons();
  }

  // =========================================================================
  // RENDER PIPELINE & VIEWPORT FIT / ZOOM / COMPARE
  // =========================================================================
  let renderPending = false;
  let lastAspect = 0;
  let histTimer = 0;

  function requestRender() {
    if (renderPending || !getActiveSource()) return;
    renderPending = true;
    requestAnimationFrame(() => {
      renderPending = false;
      renderNow();
    });
  }

  function scheduleHistogram() {
    clearTimeout(histTimer);
    histTimer = setTimeout(() => {
      window.StudioGPU.computeHistogram(outCanvas, histCanvas, $('clipLeft'), $('clipRight'));
    }, (isInteracting || media.playing) ? 180 : 40);
  }

  function renderNow() {
    const src = getActiveSource();
    if (!src) return;
    const needOrig = view.mode !== 'single' || view.holdOrig;
    const isVid = media.kind !== 'image';
    const targetMax = isInteracting ? 720 : (isVid ? 1280 : 1800);
    const res = window.StudioGPU.renderToCanvas(src, media.id, st, outCanvas, {
      maxDim: targetMax,
      pool: 'main',
      isDrag: isInteracting,
      isVideo: isVid,
      origCanvas: needOrig ? origCanvas : null,
    });
    if (!res) return;

    const aspect = res.w / res.h;
    if (Math.abs(aspect - lastAspect) > 0.002 || !view.fitW) {
      lastAspect = aspect;
      fitViewport(false);
    }
    applyCompareVisuals();
    scheduleHistogram();
    updateRecipeBadge();
  }

  function fitViewport(resetZoom = true) {
    if (!outCanvas.width || !outCanvas.height) return;
    let baseOffX = 0;
    let baseOffY = 0;
    const customFit = window.__PX_ADAPTIVE && window.__PX_ADAPTIVE.computeFit && window.__PX_ADAPTIVE.computeFit(viewport, outCanvas, view);
    if (customFit) {
      view.fitW = customFit.fitW;
      view.fitH = customFit.fitH;
      baseOffX = customFit.offsetX || 0;
      baseOffY = customFit.offsetY || 0;
    } else {
      const padX = 24;
      const padY = 52;
      const vw = Math.max(100, viewport.clientWidth - padX);
      const vh = Math.max(100, viewport.clientHeight - padY);

      let scale;
      if (view.mode === 'side') {
        const gap = 12;
        const eachW = Math.max(60, (vw - gap) / 2);
        scale = Math.min(eachW / outCanvas.width, vh / outCanvas.height);
      } else {
        scale = Math.min(vw / outCanvas.width, vh / outCanvas.height);
      }

      view.fitW = Math.max(1, Math.floor(outCanvas.width * scale));
      view.fitH = Math.max(1, Math.floor(outCanvas.height * scale));
    }
    view.baseOffsetX = baseOffX;
    view.baseOffsetY = baseOffY;

    outCanvas.style.width = view.fitW + 'px';
    outCanvas.style.height = view.fitH + 'px';

    if (view.mode === 'side') {
      origCanvas.style.width = view.fitW + 'px';
      origCanvas.style.height = view.fitH + 'px';
    } else {
      origCanvas.style.width = '';
      origCanvas.style.height = '';
    }

    if (resetZoom) { view.zoom = 1; view.panX = 0; view.panY = 0; }
    applyTransform();
  }

  function applyTransform() {
    canvasFrame.style.transform = `translate(${view.panX + (view.baseOffsetX || 0)}px, ${view.panY + (view.baseOffsetY || 0)}px) scale(${view.zoom})`;
    $('zoomLabel').textContent = Math.round(view.zoom * 100) + '%';
  }

  function setZoom(nextZoom) {
    view.zoom = Math.max(0.5, Math.min(6, nextZoom));
    if (view.zoom <= 1.01) { view.panX = 0; view.panY = 0; }
    applyTransform();
  }

  function renderGridOverlay() {
    if (!gridOverlay) return;
    const mode = (st.crop && st.crop.grid) || 'thirds';
    const show = ui.mobActiveTab === 'crop' && mode !== 'none' && !view.holdOrig && view.mode !== 'side';
    gridOverlay.hidden = !show;
    if (!show) return;
    const stroke = 'rgba(255,255,255,0.42)';
    const accent = 'rgba(255,176,0,0.68)';
    let svg = '';
    if (mode === 'thirds') {
      svg = `<line x1="33.33" y1="0" x2="33.33" y2="100" stroke="${stroke}" stroke-width="0.35" vector-effect="non-scaling-stroke"/>`
          + `<line x1="66.67" y1="0" x2="66.67" y2="100" stroke="${stroke}" stroke-width="0.35" vector-effect="non-scaling-stroke"/>`
          + `<line x1="0" y1="33.33" x2="100" y2="33.33" stroke="${stroke}" stroke-width="0.35" vector-effect="non-scaling-stroke"/>`
          + `<line x1="0" y1="66.67" x2="100" y2="66.67" stroke="${stroke}" stroke-width="0.35" vector-effect="non-scaling-stroke"/>`;
    } else if (mode === 'fine') {
      for (let i = 1; i < 6; i++) {
        const p = (i * 100 / 6).toFixed(2);
        const col = i === 3 ? accent : stroke;
        const op = i === 3 ? '0.65' : '0.32';
        svg += `<line x1="${p}" y1="0" x2="${p}" y2="100" stroke="${col}" stroke-opacity="${op}" stroke-width="0.3" vector-effect="non-scaling-stroke"/>`;
        svg += `<line x1="0" y1="${p}" x2="100" y2="${p}" stroke="${col}" stroke-opacity="${op}" stroke-width="0.3" vector-effect="non-scaling-stroke"/>`;
      }
    } else if (mode === 'golden') {
      const a = 38.2, b = 61.8;
      svg = `<line x1="${a}" y1="0" x2="${a}" y2="100" stroke="${accent}" stroke-width="0.35" vector-effect="non-scaling-stroke"/>`
          + `<line x1="${b}" y1="0" x2="${b}" y2="100" stroke="${accent}" stroke-width="0.35" vector-effect="non-scaling-stroke"/>`
          + `<line x1="0" y1="${a}" x2="100" y2="${a}" stroke="${accent}" stroke-width="0.35" vector-effect="non-scaling-stroke"/>`
          + `<line x1="0" y1="${b}" x2="100" y2="${b}" stroke="${accent}" stroke-width="0.35" vector-effect="non-scaling-stroke"/>`;
    } else if (mode === 'diag') {
      svg = `<line x1="0" y1="0" x2="100" y2="100" stroke="${stroke}" stroke-width="0.35" vector-effect="non-scaling-stroke"/>`
          + `<line x1="100" y1="0" x2="0" y2="100" stroke="${stroke}" stroke-width="0.35" vector-effect="non-scaling-stroke"/>`
          + `<line x1="50" y1="0" x2="50" y2="100" stroke="${stroke}" stroke-opacity="0.25" stroke-width="0.3" vector-effect="non-scaling-stroke"/>`
          + `<line x1="0" y1="50" x2="100" y2="50" stroke="${stroke}" stroke-opacity="0.25" stroke-width="0.3" vector-effect="non-scaling-stroke"/>`;
    } else if (mode === 'center') {
      svg = `<line x1="0" y1="50" x2="100" y2="50" stroke="${accent}" stroke-width="0.4" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/>`
          + `<line x1="50" y1="0" x2="50" y2="100" stroke="${accent}" stroke-width="0.4" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/>`
          + `<circle cx="50" cy="50" r="8" fill="none" stroke="${accent}" stroke-width="0.35" vector-effect="non-scaling-stroke"/>`;
    }
    gridOverlay.innerHTML = svg;
  }

  function applyCompareVisuals() {
    const pill = $('stageStatusPill');
    viewport.classList.toggle('mode-side', view.mode === 'side');

    if (view.holdOrig) {
      origCanvas.hidden = false;
      origCanvas.style.clipPath = '';
      splitLine.hidden = true;
      pill.textContent = 'ORIGINAL';
      pill.hidden = false;
      renderGridOverlay();
      return;
    }

    if (view.mode === 'split') {
      origCanvas.hidden = false;
      splitLine.hidden = false;
      const pct = (view.split * 100).toFixed(2) + '%';
      origCanvas.style.clipPath = `inset(0 ${(100 - view.split * 100).toFixed(2)}% 0 0)`;
      splitLine.style.left = pct;
      pill.textContent = 'ORIGINAL  |  EDITADA';
      pill.hidden = false;
    } else if (view.mode === 'side') {
      origCanvas.hidden = false;
      origCanvas.style.clipPath = '';
      splitLine.hidden = true;
      pill.textContent = 'ORIGINAL  |  EDITADA';
      pill.hidden = false;
    } else {
      // "Foto" mode: origCanvas strictly hidden so #outCanvas is always visible
      origCanvas.hidden = true;
      origCanvas.style.clipPath = '';
      splitLine.hidden = true;
      pill.hidden = true;
    }
    renderGridOverlay();
  }

  // =========================================================================
  // VIDEO & SONY CYBER-SHOT .AVI PLAYBACK ENGINE
  // =========================================================================
  function fmtTime(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r < 10 ? '0' : ''}${r}`;
  }

  function stopAviAudio() {
    if (media.audioSrc) {
      try { media.audioSrc.stop(); } catch {}
      media.audioSrc = null;
    }
    if (media.audioCtx) {
      media.audioCtx.close().catch(() => {});
      media.audioCtx = null;
    }
  }

  function stopPlayback() {
    media.playing = false;
    if (media.rafId) { cancelAnimationFrame(media.rafId); media.rafId = 0; }
    stopAviAudio();
    if (media.kind === 'video' && media.videoEl) {
      try { media.videoEl.pause(); } catch {}
    }
    $('btnVideoPlay').innerHTML = pxIco('px-play', 13);
  }

  function updateVideoBarUI(curSec, durSec) {
    $('videoTime').textContent = `${fmtTime(curSec)} / ${fmtTime(durSec)}`;
    if (durSec > 0) {
      $('videoScrub').value = Math.round((curSec / durSec) * 1000);
    }
  }

  async function seekAviFrame(idx) {
    if (!media.avi || !media.avi.frames.length) return;
    const clamped = Math.max(0, Math.min(media.avi.frames.length - 1, idx));
    if (media.aviDecodeBusy) return;
    media.aviDecodeBusy = true;
    try {
      const bmp = await window.StudioVideo.decodeBlobToImage(media.avi.frames[clamped]);
      if (media.aviFrameBmp && media.aviFrameBmp.close) media.aviFrameBmp.close();
      media.aviFrameBmp = bmp;
      media.aviFrameIdx = clamped;
      renderNow();
      updateVideoBarUI(clamped / media.avi.fps, media.avi.duration);
    } catch (e) {
      console.warn('[AVI] Erro ao decodificar frame:', e);
    } finally {
      media.aviDecodeBusy = false;
    }
  }

  function startAviPlayback() {
    if (!media.avi) return;
    media.playing = true;
    $('btnVideoPlay').innerHTML = pxIco('px-pause', 13);
    if (media.aviFrameIdx >= media.avi.frames.length - 1) media.aviFrameIdx = 0;

    const startSec = media.aviFrameIdx / media.avi.fps;
    media.playStartTime = startSec;
    media.playStartPerf = performance.now();

    if (media.avi.audioBuffer) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        media.audioCtx = new AC();
        media.audioSrc = media.audioCtx.createBufferSource();
        media.audioSrc.buffer = media.avi.audioBuffer;
        media.audioSrc.connect(media.audioCtx.destination);
        media.audioSrc.start(0, Math.min(startSec, Math.max(0, media.avi.audioBuffer.duration - 0.05)));
      } catch (e) {
        console.warn('[AVI Audio]', e);
      }
    }

    const tick = () => {
      if (!media.playing || media.kind !== 'avi' || !media.avi) return;
      const elapsed = (performance.now() - media.playStartPerf) / 1000;
      const curSec = media.playStartTime + elapsed;
      if (curSec >= media.avi.duration) {
        // Loop cleanly from start
        stopAviAudio();
        media.aviFrameIdx = 0;
        startAviPlayback();
        return;
      }
      const targetIdx = Math.min(media.avi.frames.length - 1, Math.floor(curSec * media.avi.fps));
      if (targetIdx !== media.aviFrameIdx && !media.aviDecodeBusy) {
        seekAviFrame(targetIdx);
      }
      media.rafId = requestAnimationFrame(tick);
    };
    media.rafId = requestAnimationFrame(tick);
  }

  function startNativeVideoPlayback() {
    const v = media.videoEl;
    if (!v) return;
    v.muted = false;
    v.play().then(() => {
      media.playing = true;
      $('btnVideoPlay').innerHTML = pxIco('px-pause', 13);
      const pump = () => {
        if (!media.playing || media.kind !== 'video') return;
        renderNow();
        updateVideoBarUI(v.currentTime, v.duration || 0);
        media.rafId = requestAnimationFrame(pump);
      };
      media.rafId = requestAnimationFrame(pump);
    }).catch(() => {
      // Fallback muted autoplay if browser blocks unmuted play
      v.muted = true;
      v.play().then(() => {
        media.playing = true;
        $('btnVideoPlay').innerHTML = pxIco('px-pause', 13);
        const pump = () => {
          if (!media.playing || media.kind !== 'video') return;
          renderNow();
          updateVideoBarUI(v.currentTime, v.duration || 0);
          media.rafId = requestAnimationFrame(pump);
        };
        media.rafId = requestAnimationFrame(pump);
      }).catch(() => toast('Não foi possível reproduzir o vídeo'));
    });
  }

  function togglePlayback() {
    if (media.kind === 'image') return;
    if (media.playing) {
      stopPlayback();
    } else if (media.kind === 'avi') {
      startAviPlayback();
    } else if (media.kind === 'video') {
      startNativeVideoPlayback();
    }
  }

  $('btnVideoPlay').onclick = togglePlayback;
  $('videoScrub').oninput = (e) => {
    const pct = parseFloat(e.target.value) / 1000;
    if (media.kind === 'avi' && media.avi) {
      const wasPlaying = media.playing;
      if (wasPlaying) stopPlayback();
      const idx = Math.floor(pct * (media.avi.frames.length - 1));
      seekAviFrame(idx);
    } else if (media.kind === 'video' && media.videoEl && media.videoEl.duration) {
      media.videoEl.currentTime = pct * media.videoEl.duration;
      updateVideoBarUI(media.videoEl.currentTime, media.videoEl.duration);
    }
  };

  // =========================================================================
  // MEDIA LOADING (IMAGES, MP4/MOV/WEBM & SONY CYBER-SHOT AVI)
  // =========================================================================
  let userUploadedItems = [];

  function clearPrevMedia() {
    stopPlayback();
    if (media.aviFrameBmp && media.aviFrameBmp.close) media.aviFrameBmp.close();
    media.aviFrameBmp = null;
    media.avi = null;
    if (media.videoUrl) { URL.revokeObjectURL(media.videoUrl); media.videoUrl = ''; }
  }

  function updatePhotoMeta() {
    const modeLabel = window.StudioGPU.isGPU() ? 'GPU' : 'CPU';
    if (media.kind === 'avi' && media.avi) {
      $('photoMeta').textContent = `${media.w}×${media.h} · AVI ${Math.round(media.avi.fps)}fps · ${modeLabel}`;
    } else if (media.kind === 'video') {
      $('photoMeta').textContent = `${media.w}×${media.h} · VÍDEO · ${modeLabel}`;
    } else {
      $('photoMeta').textContent = `${media.w} × ${media.h} · ${modeLabel}`;
    }
  }

  function loadPhotoSrc(src, name, id) {
    clearPrevMedia();
    $('videoBar').hidden = true;
    const img = new Image();
    if (/^https?:\/\//i.test(src)) img.crossOrigin = 'anonymous';
    img.onload = () => {
      media.kind = 'image';
      media.img = img;
      media.w = img.naturalWidth;
      media.h = img.naturalHeight;
      media.name = name || 'Foto';
      media.id = id || ('photo_' + Date.now());
      updatePhotoMeta();
      window.StudioGPU.invalidate();
      lastAspect = 0;
      renderNow();
      fitViewport(true);
      syncAllUI();
      resetLazyThumbs();
      highlightFilmstrip(media.id);
      if (window.__PX_ADAPTIVE && window.__PX_ADAPTIVE.onMediaChange) window.__PX_ADAPTIVE.onMediaChange();
    };
    img.src = src;
  }

  async function loadAviFile(file) {
    toast('Lendo vídeo Cyber-shot .AVI...');
    try {
      const avi = await window.StudioVideo.parseAviFile(file);
      clearPrevMedia();
      media.kind = 'avi';
      media.avi = avi;
      media.aviFrameIdx = 0;
      media.name = file.name.replace(/\.[^.]+$/, '');
      media.id = 'avi_' + Date.now();
      const firstBmp = await window.StudioVideo.decodeBlobToImage(avi.frames[0]);
      media.aviFrameBmp = firstBmp;
      media.w = firstBmp.width || avi.width;
      media.h = firstBmp.height || avi.height;
      avi.width = media.w;
      avi.height = media.h;

      $('videoBar').hidden = false;
      $('videoBadge').textContent = `CYBER-SHOT AVI · ${avi.codec} · ${Math.round(avi.fps)}fps${avi.audioBuffer ? ' · ÁUDIO' : ''}`;
      updateVideoBarUI(0, avi.duration);
      updatePhotoMeta();
      window.StudioGPU.invalidate();
      lastAspect = 0;
      renderNow();
      fitViewport(true);
      resetLazyThumbs();
      highlightFilmstrip('');
      if (window.__PX_ADAPTIVE && window.__PX_ADAPTIVE.onMediaChange) window.__PX_ADAPTIVE.onMediaChange();
      toast(`AVI carregado (${avi.frames.length} frames · ${media.w}×${media.h}). Clique em Exportar para converter!`);
    } catch (e) {
      toast(e.message || 'Erro ao abrir arquivo .AVI');
    }
  }

  function loadNativeVideoFile(file) {
    clearPrevMedia();
    const v = media.videoEl;
    const url = URL.createObjectURL(file);
    media.videoUrl = url;
    v.src = url;
    v.muted = true;
    v.loop = true;

    v.onloadeddata = () => {
      media.kind = 'video';
      media.w = v.videoWidth || 1280;
      media.h = v.videoHeight || 720;
      media.name = file.name.replace(/\.[^.]+$/, '');
      media.id = 'vid_' + Date.now();
      $('videoBar').hidden = false;
      $('videoBadge').textContent = `VÍDEO · ${media.w}×${media.h}`;
      updateVideoBarUI(0, v.duration || 0);
      updatePhotoMeta();
      window.StudioGPU.invalidate();
      lastAspect = 0;
      renderNow();
      fitViewport(true);
      resetLazyThumbs();
      highlightFilmstrip('');
      if (window.__PX_ADAPTIVE && window.__PX_ADAPTIVE.onMediaChange) window.__PX_ADAPTIVE.onMediaChange();
      toast(`Vídeo carregado: ${media.name}`);
    };
    v.onseeked = () => { if (!media.playing && media.kind === 'video') renderNow(); };
    v.onerror = () => toast('Formato de vídeo não suportado pelo navegador');
    v.load();
  }

  function loadFile(file) {
    if (!file) return;
    const lower = (file.name || '').toLowerCase();
    if (lower.endsWith('.avi') || file.type === 'video/x-msvideo' || file.type === 'video/avi') {
      loadAviFile(file);
      return;
    }
    if (file.type.startsWith('video/')) {
      loadNativeVideoFile(file);
      return;
    }
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        const id = 'user_' + Date.now();
        const item = { id, title: file.name.replace(/\.[^.]+$/, ''), src: reader.result, thumb: reader.result };
        userUploadedItems.unshift(item);
        buildFilmstrip();
        loadPhotoSrc(item.src, item.title, item.id);
        toast('Foto carregada: ' + item.title);
      };
      reader.readAsDataURL(file);
      return;
    }
    toast('Envie uma foto (JPG/PNG/WebP) ou vídeo (MP4/MOV/WebM/AVI)');
  }

  function buildFilmstrip() {
    const mount = $('stripItems');
    mount.innerHTML = '';
    const all = [...userUploadedItems, ...(window.STUDY_SAMPLES || [])];
    all.forEach((item) => {
      const btn = document.createElement('button');
      btn.className = 'strip-item' + (media.id === item.id ? ' active' : '');
      btn.dataset.id = item.id;
      btn.title = item.title + (item.tag ? ' — ' + item.tag : '');
      btn.innerHTML = `<img src="${item.thumb}" alt="${item.title}"><span class="strip-cap">${item.title}</span>`;
      btn.onclick = () => loadPhotoSrc(item.src, item.title, item.id);
      mount.appendChild(btn);
    });
  }

  function highlightFilmstrip(id) {
    $('stripItems').querySelectorAll('.strip-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === id);
    });
  }

  // =========================================================================
  // LEFT PANEL: COLLECTIONS, PRESET CARDS & LAZY INTERSECTION THUMBNAILS
  // =========================================================================
  let thumbQueue = [];
  let thumbTimer = 0;
  let thumbObserver = null;
  const thumbItemsByCard = new WeakMap();

  function initThumbObserver() {
    if (thumbObserver) thumbObserver.disconnect();
    if (typeof IntersectionObserver === 'undefined') return;
    const scrollRoot = $('presetScroll');
    thumbObserver = new IntersectionObserver((entries) => {
      let added = false;
      for (const ent of entries) {
        if (!ent.isIntersecting) continue;
        const item = thumbItemsByCard.get(ent.target);
        if (item && item.canvas.dataset.rk !== media.id) {
          thumbQueue.push(item);
          added = true;
        }
      }
      if (added) pumpThumbQueue();
    }, { root: scrollRoot, rootMargin: '140px 0px' });
  }

  let labThumbObserver = null;
  const labThumbItemsByCard = new WeakMap();

  function resetLabThumbs() {
    const grid = document.querySelector('.lab-preset-grid');
    if (!grid) return;
    if (labThumbObserver) labThumbObserver.disconnect();
    const cards = grid.querySelectorAll('.lab-preset-card');
    if (typeof IntersectionObserver !== 'undefined') {
      labThumbObserver = new IntersectionObserver((entries) => {
        let added = false;
        for (const ent of entries) {
          if (!ent.isIntersecting) continue;
          const item = labThumbItemsByCard.get(ent.target);
          if (item && item.canvas.dataset.rk !== media.id) {
            thumbQueue.push(item);
            added = true;
          }
        }
        if (added) pumpThumbQueue();
      }, { root: $('inspectorScroll'), rootMargin: '120px 0px' });
      cards.forEach((card) => {
        const item = labThumbItemsByCard.get(card);
        if (!item) return;
        item.canvas.dataset.rk = '';
        labThumbObserver.observe(card);
      });
    } else {
      cards.forEach((card) => {
        const item = labThumbItemsByCard.get(card);
        if (item) { item.canvas.dataset.rk = ''; thumbQueue.push(item); }
      });
      pumpThumbQueue();
    }
  }

  function resetLazyThumbs() {
    clearTimeout(thumbTimer);
    thumbQueue = [];
    const cards = $('presetScroll').querySelectorAll('.preset-card');
    initThumbObserver();
    cards.forEach((card) => {
      const item = thumbItemsByCard.get(card);
      if (!item) return;
      item.canvas.dataset.rk = '';
      if (thumbObserver) thumbObserver.observe(card);
      else thumbQueue.push(item);
    });
    if (!thumbObserver && thumbQueue.length) pumpThumbQueue();
    if (ui.mobActiveTab === 'lab') resetLabThumbs();
  }

  function pumpThumbQueue() {
    if (thumbTimer) return;
    const src = getActiveSource();
    if (!src || !thumbQueue.length) return;

    function step() {
      thumbTimer = 0;
      if (isInteracting || media.playing) {
        thumbTimer = setTimeout(step, 140);
        return;
      }
      const curSrc = getActiveSource();
      if (!curSrc) return;
      const start = performance.now();
      while (thumbQueue.length && performance.now() - start < 5) {
        const item = thumbQueue.shift();
        if (!item.canvas.isConnected || item.canvas.dataset.rk === media.id) continue;
        const ts = item.stateFn();
        window.StudioGPU.renderToCanvas(curSrc, media.id + '_th', ts, item.canvas, {
          maxDim: 148,
          pool: 'thumb',
          grainUnit: 0.4,
        });
        item.canvas.dataset.rk = media.id;
      }
      if (thumbQueue.length) thumbTimer = setTimeout(step, 24);
    }
    thumbTimer = setTimeout(step, 35);
  }

  function buildCollectionTabs() {
    const mount = $('collectionTabs');
    mount.innerHTML = '';
    window.PRESET_COLLECTIONS.forEach((col) => {
      const btn = document.createElement('button');
      btn.className = 'col-pill' + (ui.collection === col.id ? ' active' : '');
      btn.textContent = col.label;
      btn.onclick = () => {
        ui.collection = col.id;
        buildCollectionTabs();
        buildPresetGrid();
      };
      mount.appendChild(btn);
    });
  }

  function getFilteredPresets() {
    const q = ui.search.trim().toLowerCase();
    if (ui.collection === 'saved') {
      return ui.savedPresets.filter(p => !q || p.name.toLowerCase().includes(q));
    }
    return window.PRESET_CATALOG.filter((p) => {
      if (ui.collection !== 'all' && p.collection !== ui.collection) return false;
      if (ui.favOnly && !ui.favs.has(p.id)) return false;
      if (q) {
        const hay = `${p.name} ${p.subtitle} ${p.desc} ${p.badge} ${(p.tags || []).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function buildPresetGrid() {
    const mount = $('presetScroll');
    mount.innerHTML = '';
    thumbQueue = [];
    clearTimeout(thumbTimer);
    thumbTimer = 0;

    const list = getFilteredPresets();
    if (!list.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:28px 14px;text-align:center;color:var(--text-3);font-size:12px;line-height:1.5;';
      empty.textContent = ui.collection === 'saved'
        ? 'Você ainda não salvou nenhum preset. Ajuste sua foto e clique em "Salvar" no topo.'
        : 'Nenhum filme encontrado com esse filtro.';
      mount.appendChild(empty);
      return;
    }

    if (ui.collection === 'saved') {
      renderPresetSection(mount, 'Meus Presets Salvos', list, true);
    } else if (ui.collection === 'all' && !ui.search.trim() && !ui.favOnly) {
      ['vencido', 'cameras', 'classicos', 'cinema', 'bw', 'icones'].forEach((cid) => {
        const colObj = window.PRESET_COLLECTIONS.find(c => c.id === cid);
        const items = list.filter(p => p.collection === cid);
        if (items.length && colObj) renderPresetSection(mount, colObj.label, items, false);
      });
    } else {
      renderPresetSection(mount, `${list.length} resultado${list.length > 1 ? 's' : ''}`, list, false);
    }

    resetLazyThumbs();
  }

  function renderPresetSection(mount, title, items, isSaved) {
    const wrap = document.createElement('div');
    const head = document.createElement('div');
    head.className = 'preset-group-title';
    head.innerHTML = `<span>${title}</span><span>${items.length}</span>`;
    wrap.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'preset-grid';

    items.forEach((p) => {
      const card = document.createElement('button');
      card.className = 'preset-card' + (st.preset.id === p.id ? ' active' : '');
      card.dataset.pid = p.id;

      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'preset-thumb-wrap';
      const cv = document.createElement('canvas');
      cv.width = 148;
      cv.height = 98;
      thumbWrap.appendChild(cv);

      if (p.badge) {
        const b = document.createElement('span');
        b.className = 'preset-badge';
        b.textContent = p.badge;
        thumbWrap.appendChild(b);
      }

      if (!isSaved) {
        const fav = document.createElement('span');
        fav.className = 'preset-fav' + (ui.favs.has(p.id) ? ' is-fav' : '');
        fav.innerHTML = pxIco('px-star', 11);
        fav.title = 'Favoritar';
        fav.onclick = (e) => {
          e.stopPropagation();
          if (ui.favs.has(p.id)) ui.favs.delete(p.id);
          else ui.favs.add(p.id);
          store.set('favs', [...ui.favs]);
          fav.classList.toggle('is-fav', ui.favs.has(p.id));
          if (ui.favOnly) buildPresetGrid();
        };
        thumbWrap.appendChild(fav);

        if (p.variations && p.variations.length > 1) {
          const dots = document.createElement('span');
          dots.className = 'preset-var-dots';
          dots.title = `${p.variations.length} variações`;
          p.variations.slice(0, 5).forEach(() => dots.appendChild(document.createElement('span')));
          thumbWrap.appendChild(dots);
        }
      } else {
        const del = document.createElement('span');
        del.className = 'preset-fav is-fav';
        del.style.color = '#ef4444';
        del.innerHTML = pxIco('px-close', 10);
        del.title = 'Excluir preset salvo';
        del.onclick = (e) => {
          e.stopPropagation();
          ui.savedPresets = ui.savedPresets.filter(x => x.id !== p.id);
          store.set('savedPresets', ui.savedPresets);
          buildPresetGrid();
          toast('Preset excluído');
        };
        thumbWrap.appendChild(del);
      }

      const meta = document.createElement('div');
      meta.className = 'preset-meta';
      meta.innerHTML = `<span class="preset-name">${p.name}</span><span class="preset-sub">${p.subtitle || 'Receita personalizada'}</span>`;

      card.append(thumbWrap, meta);

      const getTargetState = () => isSaved
        ? window.mergeState(window.freshState(), p.state)
        : window.buildPresetState(p.id, 0, st.crop, window.DEFAULT_PRESET_MIX);

      card.onclick = () => {
        st = getTargetState();
        if (isSaved) st.preset = { id: p.id, variation: 0, mix: p.state?.preset?.mix ?? window.DEFAULT_PRESET_MIX };
        if (['vencido_viva', 'redscale', 'xray_fog', 'film_soup', 'autochrome'].includes(st.film.chem)) {
          ui.openSections.add('film');
          if (sectionRefs.film) sectionRefs.film.classList.add('open');
        }
        commit(true);
        syncAllUI();
        requestRender();
      };

      grid.appendChild(card);
      thumbItemsByCard.set(card, { canvas: cv, stateFn: getTargetState });
    });

    wrap.appendChild(grid);
    mount.appendChild(wrap);
  }

  function syncActiveLookBar() {
    const bar = $('activeLookBar');
    const p = window.getPresetById(st.preset.id);
    if (!p) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    $('activeLookName').textContent = p.name;
    $('activeLookDesc').textContent = p.desc || p.subtitle || '';

    const vMount = $('variationChips');
    vMount.innerHTML = '';
    if (p.variations && p.variations.length > 1) {
      p.variations.forEach((v, idx) => {
        const btn = document.createElement('button');
        btn.className = 'var-chip' + (st.preset.variation === idx ? ' active' : '');
        btn.textContent = v.name;
        btn.onclick = () => {
          const curMix = st.preset.mix;
          st = window.buildPresetState(p.id, idx, st.crop, curMix);
          commit(true);
          syncAllUI();
          requestRender();
        };
        vMount.appendChild(btn);
      });
    }

    const mixMount = $('mixControlMount');
    mixMount.replaceWith(createSliderRow({
      id: 'mixControlMount',
      label: 'Intensidade do Look',
      min: 0, max: 100, step: 1, def: window.DEFAULT_PRESET_MIX,
      get: () => st.preset.mix,
      set: (v) => { st.preset.mix = v; },
      fmt: (v) => v + '%',
    }));
  }

  // =========================================================================
  // PRECISION SLIDER COMPONENT
  // =========================================================================
  function createSliderRow(cfg) {
    const row = document.createElement('div');
    row.className = 'ctrl-row';
    if (cfg.id) row.id = cfg.id;

    const top = document.createElement('div');
    top.className = 'ctrl-top';

    const nameEl = document.createElement('span');
    nameEl.className = 'ctrl-name';
    nameEl.textContent = cfg.label;

    const valEl = document.createElement('span');
    valEl.className = 'ctrl-val';
    valEl.title = 'Clique duplo para restaurar';
    top.append(nameEl, valEl);

    const wrap = document.createElement('div');
    wrap.className = 'slider-wrap';

    const track = document.createElement('div');
    track.className = 'slider-track' + (cfg.trackClass ? ' ' + cfg.trackClass : '');
    const fill = document.createElement('div');
    fill.className = 'slider-fill';
    track.appendChild(fill);

    const isBipolar = cfg.min < 0 && cfg.max > 0;
    if (isBipolar) {
      const tick = document.createElement('div');
      tick.className = 'slider-center-tick';
      wrap.appendChild(tick);
    }

    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'pro-range';
    input.min = cfg.min;
    input.max = cfg.max;
    input.step = cfg.step ?? 1;

    function updateVisual(v) {
      input.value = v;
      const pct = (v - cfg.min) / (cfg.max - cfg.min);
      if (isBipolar) {
        const zeroPct = (0 - cfg.min) / (cfg.max - cfg.min);
        fill.style.left = (Math.min(zeroPct, pct) * 100) + '%';
        fill.style.width = (Math.abs(pct - zeroPct) * 100) + '%';
      } else {
        fill.style.left = '0%';
        fill.style.width = (pct * 100) + '%';
      }
      row.classList.toggle('modified', Math.abs(v - cfg.def) > 0.001);
      valEl.textContent = cfg.fmt ? cfg.fmt(v) : (v > 0 && isBipolar ? '+' + v : String(v));
    }

    input.oninput = () => {
      const v = parseFloat(input.value);
      cfg.set(v);
      updateVisual(v);
      requestRender();
      commit(false);
      updateSectionDots();
    };
    input.ondblclick = valEl.ondblclick = () => {
      cfg.set(cfg.def);
      updateVisual(cfg.def);
      requestRender();
      commit(true);
      updateSectionDots();
    };

    wrap.append(track, input);
    row.append(top, wrap);
    updateVisual(cfg.get());
    row._sync = () => updateVisual(cfg.get());
    return row;
  }

  // =========================================================================
  // INTERACTIVE TONE CURVE WIDGET
  // =========================================================================
  const CURVE_PRESETS = {
    linear: [[0, 0], [1, 1]],
    softS:  [[0, 0.02], [0.25, 0.22], [0.75, 0.79], [1, 0.98]],
    matte:  [[0, 0.07], [0.25, 0.24], [0.75, 0.79], [1, 0.95]],
    strong: [[0, 0.0], [0.22, 0.15], [0.78, 0.85], [1, 0.99]],
  };

  function buildCurveWidget() {
    const container = document.createElement('div');
    container.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

    const head = document.createElement('div');
    head.className = 'curve-header';
    const chWrap = document.createElement('div');
    chWrap.className = 'curve-channels';

    [['rgb', 'RGB'], ['r', 'R'], ['g', 'G'], ['b', 'B']].forEach(([k, label]) => {
      const b = document.createElement('button');
      b.className = 'curve-ch-btn' + (ui.activeCurveCh === k ? ' active' : '');
      b.dataset.ch = k;
      b.textContent = label;
      b.onclick = () => {
        ui.activeCurveCh = k;
        chWrap.querySelectorAll('.curve-ch-btn').forEach(x => x.classList.toggle('active', x.dataset.ch === k));
        drawCurve();
      };
      chWrap.appendChild(b);
    });

    const resetCh = document.createElement('button');
    resetCh.className = 'acc-section-reset';
    resetCh.textContent = 'Reset canal';
    resetCh.onclick = () => {
      st.curve[ui.activeCurveCh] = [[0, 0], [1, 1]];
      drawCurve(); requestRender(); commit(true); updateSectionDots();
    };
    head.append(chWrap, resetCh);

    const box = document.createElement('div');
    box.className = 'curve-canvas-box';
    const cv = document.createElement('canvas');
    cv.id = 'curveCanvas';
    box.appendChild(cv);

    const presetsRow = document.createElement('div');
    presetsRow.className = 'curve-presets';
    [['linear', 'Linear'], ['softS', 'S-Suave'], ['matte', 'Matte Filme'], ['strong', 'Contraste S']].forEach(([k, lbl]) => {
      const btn = document.createElement('button');
      btn.className = 'mini-chip';
      btn.textContent = lbl;
      btn.onclick = () => {
        st.curve[ui.activeCurveCh] = window.deepClone(CURVE_PRESETS[k]);
        drawCurve(); requestRender(); commit(true); updateSectionDots();
      };
      presetsRow.appendChild(btn);
    });

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:10.5px;color:var(--text-3);';
    hint.textContent = 'Clique para adicionar ponto · Arraste · Clique duplo remove';

    container.append(head, box, presetsRow, hint);

    const CH_COLORS = { rgb: '#f3f2ee', r: '#f87171', g: '#4ade80', b: '#60a5fa' };
    let dragIdx = -1;

    function drawCurve() {
      const w = cv.width = (box.clientWidth || 280) * 2;
      const h = cv.height = (box.clientHeight || 200) * 2;
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, w, h);

      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath(); ctx.moveTo((w * i) / 4, 0); ctx.lineTo((w * i) / 4, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, (h * i) / 4); ctx.lineTo(w, (h * i) / 4); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(w, 0); ctx.stroke();
      ctx.setLineDash([]);

      ['rgb', 'r', 'g', 'b'].forEach((ch) => {
        if (ch === ui.activeCurveCh) return;
        const lut = window.evalCurve256(st.curve[ch]);
        ctx.strokeStyle = CH_COLORS[ch];
        ctx.globalAlpha = 0.22;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 256; i++) {
          const x = (i / 255) * w, y = h - (lut[i] / 255) * h;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });

      const ch = ui.activeCurveCh;
      const lut = window.evalCurve256(st.curve[ch]);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = CH_COLORS[ch];
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      for (let i = 0; i < 256; i++) {
        const x = (i / 255) * w, y = h - (lut[i] / 255) * h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();

      st.curve[ch].forEach((p, idx) => {
        const x = p[0] * w, y = (1 - p[1]) * h;
        ctx.beginPath();
        ctx.arc(x, y, idx === dragIdx ? 10 : 8, 0, Math.PI * 2);
        ctx.fillStyle = idx === dragIdx ? '#ffb000' : '#111114';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = idx === dragIdx ? '#ffb000' : CH_COLORS[ch];
        ctx.stroke();
      });
    }

    function getPos(e) {
      const r = cv.getBoundingClientRect();
      return [
        Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
        Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)),
      ];
    }

    cv.addEventListener('pointerdown', (e) => {
      const [x, y] = getPos(e);
      const pts = st.curve[ui.activeCurveCh];
      let hit = -1, bestD = 0.075;
      pts.forEach((p, idx) => { const d = Math.hypot(p[0] - x, p[1] - y); if (d < bestD) { bestD = d; hit = idx; } });
      if (hit >= 0) dragIdx = hit;
      else if (pts.length < 9) {
        pts.push([x, y]);
        pts.sort((a, b) => a[0] - b[0]);
        dragIdx = pts.findIndex(p => p[0] === x && p[1] === y);
        requestRender(); commit(false);
      }
      cv.setPointerCapture(e.pointerId);
      drawCurve();
    });

    cv.addEventListener('pointermove', (e) => {
      if (dragIdx < 0) return;
      const [x, y] = getPos(e);
      const pts = st.curve[ui.activeCurveCh];
      if (dragIdx === 0) { pts[0][0] = 0; pts[0][1] = y; }
      else if (dragIdx === pts.length - 1) { pts[dragIdx][0] = 1; pts[dragIdx][1] = y; }
      else {
        pts[dragIdx][0] = Math.max(pts[dragIdx - 1][0] + 0.03, Math.min(pts[dragIdx + 1][0] - 0.03, x));
        pts[dragIdx][1] = y;
      }
      drawCurve(); requestRender(); commit(false); updateSectionDots();
    });

    cv.addEventListener('pointerup', () => { if (dragIdx >= 0) { dragIdx = -1; drawCurve(); commit(true); } });
    cv.addEventListener('dblclick', (e) => {
      const [x, y] = getPos(e);
      const pts = st.curve[ui.activeCurveCh];
      let hit = -1, bestD = 0.08;
      pts.forEach((p, idx) => { if (idx === 0 || idx === pts.length - 1) return; const d = Math.hypot(p[0] - x, p[1] - y); if (d < bestD) { bestD = d; hit = idx; } });
      if (hit > 0) { pts.splice(hit, 1); drawCurve(); requestRender(); commit(true); updateSectionDots(); }
    });

    container._sync = () => requestAnimationFrame(drawCurve);
    requestAnimationFrame(drawCurve);
    return container;
  }

  // =========================================================================
  // INTERACTIVE 3-WAY COLOR GRADING WHEELS (Pre-rendered bitmap!)
  // =========================================================================
  const wheelBgCanvas = document.createElement('canvas');
  wheelBgCanvas.width = 176; wheelBgCanvas.height = 176;
  (() => {
    const ctx = wheelBgCanvas.getContext('2d');
    const R = 84, cx = 88, cy = 88;
    for (let a = 0; a < 360; a += 2) {
      const rad1 = (a - 1) * Math.PI / 180, rad2 = (a + 2) * Math.PI / 180;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      grad.addColorStop(0, '#18181e');
      grad.addColorStop(1, `hsl(${a}, 80%, 50%)`);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, rad1, rad2); ctx.closePath();
      ctx.fillStyle = grad; ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
  })();

  function buildColorWheel(key, label) {
    const card = document.createElement('div');
    card.className = 'wheel-card';
    const cv = document.createElement('canvas');
    cv.className = 'wheel-canvas';
    cv.width = 176; cv.height = 176;
    const lbl = document.createElement('span');
    lbl.className = 'wheel-label';
    lbl.textContent = label;
    card.append(cv, lbl);

    const ctx = cv.getContext('2d');
    const R = 84, cx = 88, cy = 88;

    function draw() {
      ctx.clearRect(0, 0, 176, 176);
      ctx.drawImage(wheelBgCanvas, 0, 0);
      const g = st.grade[key];
      const ang = (g.h * Math.PI) / 180;
      const dist = (g.s / 100) * (R - 8);
      const px = cx + Math.cos(ang) * dist;
      const py = cy + Math.sin(ang) * dist;

      if (g.s > 1) {
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, py); ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(px, py, 9, 0, Math.PI * 2);
      ctx.fillStyle = g.s > 1 ? `hsl(${g.h}, 85%, 58%)` : '#262630';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = g.s > 1 ? '#ffffff' : '#777786';
      ctx.stroke();
    }

    let dragging = false;
    function pick(e) {
      const r = cv.getBoundingClientRect();
      const dx = ((e.clientX - r.left) / r.width) * 176 - cx;
      const dy = ((e.clientY - r.top) / r.height) * 176 - cy;
      const dist = Math.min(R - 8, Math.hypot(dx, dy));
      let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (deg < 0) deg += 360;
      st.grade[key].h = Math.round(deg);
      st.grade[key].s = Math.round((dist / (R - 8)) * 100);
      draw(); requestRender(); commit(false); updateSectionDots();
    }

    cv.addEventListener('pointerdown', (e) => { dragging = true; cv.setPointerCapture(e.pointerId); pick(e); });
    cv.addEventListener('pointermove', (e) => { if (dragging) pick(e); });
    cv.addEventListener('pointerup', () => { if (dragging) { dragging = false; commit(true); } });
    cv.addEventListener('dblclick', () => { st.grade[key] = { h: 0, s: 0, l: 0 }; draw(); requestRender(); commit(true); updateSectionDots(); });

    draw();
    card._sync = draw;
    return card;
  }

  // =========================================================================
  // RIGHT PANEL: LIGHTROOM INSPECTOR ACCORDIONS
  // =========================================================================
  const syncHooks = [];
  const sectionRefs = {};
  const sectionSummaries = {};

  function buildAccordion(id, title, onReset, buildBodyFn) {
    const sec = document.createElement('section');
    sec.className = 'acc-section' + (ui.openSections.has(id) ? ' open' : '');
    sec.dataset.sec = id;

    const head = document.createElement('button');
    head.className = 'acc-head';
    head.innerHTML = `
      <span class="acc-head-l">
        <svg class="acc-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        <span>${title}</span>
        <span class="acc-dot"></span>
      </span>
    `;

    const rightWrap = document.createElement('span');
    rightWrap.className = 'acc-head-r';

    const sumEl = document.createElement('span');
    sumEl.className = 'acc-summary';
    sumEl.hidden = true;
    rightWrap.appendChild(sumEl);
    sectionSummaries[id] = sumEl;

    if (onReset) {
      const rbtn = document.createElement('span');
      rbtn.className = 'acc-section-reset';
      rbtn.textContent = 'Reset';
      rbtn.onclick = (e) => { e.stopPropagation(); onReset(); commit(true); syncAllUI(); requestRender(); };
      rightWrap.appendChild(rbtn);
    }
    head.appendChild(rightWrap);

    head.onclick = () => {
      const open = sec.classList.toggle('open');
      if (open) ui.openSections.add(id); else ui.openSections.delete(id);
      if (open && id === 'curve') syncHooks.forEach(fn => fn());
      if (open && id === 'lab_presets') setTimeout(resetLabThumbs, 25);
    };

    const body = document.createElement('div');
    body.className = 'acc-body';
    buildBodyFn(body);
    sec.append(head, body);
    sectionRefs[id] = sec;
    return sec;
  }

  function addSlider(parent, cfg) {
    const el = createSliderRow(cfg);
    parent.appendChild(el);
    syncHooks.push(el._sync);
    return el;
  }

  function buildInspector() {
    const mount = $('inspectorScroll');
    mount.innerHTML = '';
    syncHooks.length = 0;

    // 1. LUZ
    mount.appendChild(buildAccordion('light', 'Luz & Exposição', () => { st.light = window.deepClone(window.DEFAULT_STATE.light); }, (b) => {
      addSlider(b, { label: 'Exposição', min: -3, max: 3, step: 0.05, def: 0, get: () => st.light.exposure, set: v => st.light.exposure = v, fmt: v => (v > 0 ? '+' : '') + v.toFixed(2) });
      addSlider(b, { label: 'Contraste', min: -100, max: 100, def: 0, get: () => st.light.contrast, set: v => st.light.contrast = v });
      addSlider(b, { label: 'Realces', min: -100, max: 100, def: 0, get: () => st.light.highlights, set: v => st.light.highlights = v });
      addSlider(b, { label: 'Sombras', min: -100, max: 100, def: 0, get: () => st.light.shadows, set: v => st.light.shadows = v });
      addSlider(b, { label: 'Brancos', min: -100, max: 100, def: 0, get: () => st.light.whites, set: v => st.light.whites = v });
      addSlider(b, { label: 'Pretos', min: -100, max: 100, def: 0, get: () => st.light.blacks, set: v => st.light.blacks = v });
    }));

    // 2. CURVA DE TONS
    mount.appendChild(buildAccordion('curve', 'Curva de Tons', () => { st.curve = window.deepClone(window.DEFAULT_STATE.curve); }, (b) => {
      const w = buildCurveWidget();
      b.appendChild(w);
      syncHooks.push(w._sync);
    }));

    // 3. COR
    mount.appendChild(buildAccordion('color', 'Cor & Balanço de Branco', () => { st.color = window.deepClone(window.DEFAULT_STATE.color); }, (b) => {
      addSlider(b, { label: 'Temperatura', min: -100, max: 100, def: 0, trackClass: 'grad-temp', get: () => st.color.temp, set: v => st.color.temp = v });
      addSlider(b, { label: 'Matiz (Tint)', min: -100, max: 100, def: 0, trackClass: 'grad-tint', get: () => st.color.tint, set: v => st.color.tint = v });
      addSlider(b, { label: 'Vibração', min: -100, max: 100, def: 0, get: () => st.color.vibrance, set: v => st.color.vibrance = v });
      addSlider(b, { label: 'Saturação', min: -100, max: 100, def: 0, get: () => st.color.saturation, set: v => st.color.saturation = v });
    }));

    // 4. HSL
    mount.appendChild(buildAccordion('hsl', 'Misturador HSL (8 Cores)', () => { st.hsl = window.deepClone(window.DEFAULT_STATE.hsl); }, (b) => {
      const sw = document.createElement('div');
      sw.className = 'hsl-swatches';
      const bandLabel = document.createElement('div');
      bandLabel.style.cssText = 'font-size:11px;color:var(--text-1);font-weight:600;display:flex;justify-content:space-between;align-items:center;';

      const refreshDots = () => {
        sw.querySelectorAll('.hsl-dot-btn').forEach((btn) => {
          const k = btn.dataset.band, x = st.hsl[k];
          btn.classList.toggle('active', ui.activeHslBand === k);
          btn.classList.toggle('mod', x.h !== 0 || x.s !== 0 || x.l !== 0);
        });
        const cur = window.HSL_BANDS.find(x => x.key === ui.activeHslBand);
        bandLabel.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:9px;height:9px;border-radius:99px;background:${cur.hex};display:inline-block;"></span>${cur.label}</span>`;
      };

      window.HSL_BANDS.forEach((band) => {
        const btn = document.createElement('button');
        btn.className = 'hsl-dot-btn';
        btn.dataset.band = band.key;
        btn.title = band.label;
        btn.innerHTML = `<span style="background:${band.hex}"></span>`;
        btn.onclick = () => { ui.activeHslBand = band.key; refreshDots(); hSl._sync(); sSl._sync(); lSl._sync(); };
        sw.appendChild(btn);
      });

      b.append(sw, bandLabel);
      const hSl = addSlider(b, { label: 'Matiz', min: -100, max: 100, def: 0, get: () => st.hsl[ui.activeHslBand].h, set: v => { st.hsl[ui.activeHslBand].h = v; refreshDots(); } });
      const sSl = addSlider(b, { label: 'Saturação', min: -100, max: 100, def: 0, get: () => st.hsl[ui.activeHslBand].s, set: v => { st.hsl[ui.activeHslBand].s = v; refreshDots(); } });
      const lSl = addSlider(b, { label: 'Luminância', min: -100, max: 100, def: 0, get: () => st.hsl[ui.activeHslBand].l, set: v => { st.hsl[ui.activeHslBand].l = v; refreshDots(); } });
      syncHooks.push(refreshDots);
      refreshDots();
    }));

    // 5. COLOR GRADING
    mount.appendChild(buildAccordion('grade', 'Color Grading (3-Vias)', () => { st.grade = window.deepClone(window.DEFAULT_STATE.grade); }, (b) => {
      const grid = document.createElement('div');
      grid.className = 'wheels-grid';
      const wS = buildColorWheel('shadows', 'Sombras');
      const wM = buildColorWheel('midtones', 'Meios-tons');
      const wH = buildColorWheel('highlights', 'Realces');
      grid.append(wS, wM, wH);
      syncHooks.push(wS._sync, wM._sync, wH._sync);
      b.appendChild(grid);
      addSlider(b, { label: 'Balanço (Sombras / Realces)', min: -100, max: 100, def: 0, get: () => st.grade.balance, set: v => st.grade.balance = v });
      addSlider(b, { label: 'Suavidade da Mistura', min: 0, max: 100, def: 55, get: () => st.grade.blending, set: v => st.grade.blending = v });
    }));

    // 6. PRESENÇA
    mount.appendChild(buildAccordion('presence', 'Presença & Detalhe', () => { st.presence = window.deepClone(window.DEFAULT_STATE.presence); }, (b) => {
      addSlider(b, { label: 'Claridade (Microcontraste)', min: -100, max: 100, def: 0, get: () => st.presence.clarity, set: v => st.presence.clarity = v });
      addSlider(b, { label: 'Desembaçar (Dehaze)', min: -100, max: 100, def: 0, get: () => st.presence.dehaze, set: v => st.presence.dehaze = v });
      addSlider(b, { label: 'Nitidez', min: 0, max: 100, def: 0, get: () => st.presence.sharpen, set: v => st.presence.sharpen = v });
      addSlider(b, { label: 'Fade Analógico (Pretos)', min: 0, max: 100, def: 0, get: () => st.presence.fade, set: v => st.presence.fade = v, fmt: v => v + '%' });
    }));

    // 7. QUÍMICA DO FILME & VENCIDO (13 processos!)
    mount.appendChild(buildAccordion('film', 'Química do Filme & Vencido', () => { st.film = window.deepClone(window.DEFAULT_STATE.film); }, (b) => {
      addSlider(b, { label: 'Roll-off de Luzes (Película)', min: 0, max: 100, def: 0, get: () => st.film.rolloff, set: v => st.film.rolloff = v, fmt: v => v + '%' });

      const chemWrap = document.createElement('div');
      chemWrap.style.cssText = 'display:flex;flex-direction:column;gap:5px;';
      chemWrap.innerHTML = `<span class="ctrl-name">Processo Químico / Emulsão</span>`;
      const chips = document.createElement('div');
      chips.className = 'chips-wrap';
      const CHEMS = [
        ['none', 'Normal'],
        ['vencido_viva', 'Vencido Viva'],
        ['redscale', 'Redscale'],
        ['xray_fog', 'Raio-X'],
        ['film_soup', 'Film Soup'],
        ['autochrome', 'Autochrome'],
        ['cross', 'Cross-Proc'],
        ['bleach', 'Bleach'],
        ['aerochrome', 'Aerochrome'],
        ['lomopurple', 'LomoPurple'],
        ['technicolor', 'Technicolor'],
        ['bw', 'P&B Prata'],
        ['wood_ir', 'Infra P&B'],
      ];

      const vBox = document.createElement('div');
      vBox.style.cssText = 'display:flex;flex-direction:column;gap:9px;padding:9px;border-radius:6px;background:#16161c;border:1px solid var(--border-strong);';
      const vTitle = document.createElement('div');
      vTitle.style.cssText = 'display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:600;color:var(--accent);';
      const vTitleLabel = document.createElement('span');
      vTitleLabel.textContent = 'Química Vencida & Experimental';
      const vSeedBtn = document.createElement('button');
      vSeedBtn.className = 'mini-chip';
      vSeedBtn.innerHTML = `${pxIco('px-reset', 11)}<span>Nova Mancha</span>`;
      vSeedBtn.onclick = () => { st.film.vencidoSeed = 1 + Math.floor(Math.random() * 99); requestRender(); commit(true); };
      vTitle.append(vTitleLabel, vSeedBtn);
      vBox.appendChild(vTitle);

      const layerChips = document.createElement('div');
      layerChips.className = 'chips-wrap';
      [[3, 'Auto (Cena)'], [0, 'Camada R'], [1, 'Camada G'], [2, 'Camada B']].forEach(([val, lbl]) => {
        const cb = document.createElement('button');
        cb.className = 'mini-chip';
        cb.dataset.l = val;
        cb.textContent = lbl;
        cb.onclick = () => {
          st.film.vencidoLayer = val;
          layerChips.querySelectorAll('.mini-chip').forEach(x => x.classList.toggle('active', Number(x.dataset.l) === st.film.vencidoLayer));
          requestRender(); commit(true);
        };
        layerChips.appendChild(cb);
      });
      vBox.appendChild(layerChips);

      const slAge = addSlider(vBox, { label: 'Idade / Intensidade Química', min: 0, max: 100, def: 0, get: () => st.film.vencidoAge, set: v => st.film.vencidoAge = v, fmt: v => v + '%' });
      const slFog = addSlider(vBox, { label: 'Véu Químico (Fog)', min: 0, max: 100, def: 0, get: () => st.film.vencidoFog, set: v => st.film.vencidoFog = v, fmt: v => v + '%' });
      const slMot = addSlider(vBox, { label: 'Manchas de Densidade', min: 0, max: 100, def: 0, get: () => st.film.vencidoMottle, set: v => st.film.vencidoMottle = v, fmt: v => v + '%' });
      const slLkk = addSlider(vBox, { label: 'Vazamento da Cena', min: 0, max: 100, def: 0, get: () => st.film.vencidoLeak, set: v => st.film.vencidoLeak = v, fmt: v => v + '%' });

      const EXP_CHEMS = new Set(['vencido_viva', 'redscale', 'xray_fog', 'film_soup', 'autochrome']);
      const refreshChem = () => {
        chips.querySelectorAll('.mini-chip').forEach(x => x.classList.toggle('active', x.dataset.c === st.film.chem));
        const isExp = EXP_CHEMS.has(st.film.chem);
        vBox.hidden = !isExp;
        const isViva = st.film.chem === 'vencido_viva';
        layerChips.hidden = !isViva;
        slFog.hidden = !isViva && st.film.chem !== 'xray_fog';
        slMot.hidden = !isViva && st.film.chem !== 'film_soup';
        slLkk.hidden = !isViva;
        layerChips.querySelectorAll('.mini-chip').forEach(x => x.classList.toggle('active', Number(x.dataset.l) === st.film.vencidoLayer));
      };

      CHEMS.forEach(([k, lbl]) => {
        const btn = document.createElement('button');
        btn.className = 'mini-chip';
        btn.dataset.c = k;
        btn.textContent = lbl;
        btn.onclick = () => {
          st.film.chem = k;
          if (k === 'vencido_viva' && st.film.vencidoAge === 0) {
            st.film.vencidoAge = 46; st.film.vencidoFog = 36; st.film.vencidoMottle = 30; st.film.vencidoLeak = 24;
          } else if (EXP_CHEMS.has(k) && st.film.vencidoAge === 0) {
            st.film.vencidoAge = 55; st.film.vencidoFog = 45; st.film.vencidoMottle = 40;
          }
          refreshChem(); syncAllUI(); requestRender(); commit(true);
        };
        chips.appendChild(btn);
      });
      chemWrap.appendChild(chips);
      b.append(chemWrap, vBox);

      addSlider(b, { label: 'Viragem Química (Selênio/Sépia)', min: 0, max: 100, def: 0, get: () => st.film.toneAmt, set: v => st.film.toneAmt = v, fmt: v => v + '%' });
      syncHooks.push(refreshChem);
      refreshChem();
    }));

    // 8. ÓPTICA
    mount.appendChild(buildAccordion('optics', 'Óptica, Halação & Grão', () => { st.optics = window.deepClone(window.DEFAULT_STATE.optics); }, (b) => {
      addSlider(b, { label: 'Halação Vermelha (Película)', min: 0, max: 100, def: 0, get: () => st.optics.halation, set: v => st.optics.halation = v, fmt: v => v + '%' });
      addSlider(b, { label: 'Pro-Mist / Bloom Difuso', min: 0, max: 100, def: 0, get: () => st.optics.bloom, set: v => st.optics.bloom = v, fmt: v => v + '%' });
      addSlider(b, { label: 'Orton Dream (Sonho)', min: 0, max: 100, def: 0, get: () => st.optics.orton, set: v => st.optics.orton = v, fmt: v => v + '%' });
      addSlider(b, { label: 'Anamorphic Flare (Cinema)', min: 0, max: 100, def: 0, get: () => st.optics.anamorphic, set: v => st.optics.anamorphic = v, fmt: v => v + '%' });
      addSlider(b, { label: 'Grão Orgânico de Filme', min: 0, max: 100, def: 0, get: () => st.optics.grain, set: v => st.optics.grain = v, fmt: v => v + '%' });
      addSlider(b, { label: 'Tamanho do Grão', min: 40, max: 220, def: 95, get: () => st.optics.grainSize, set: v => st.optics.grainSize = v, fmt: v => v + '%' });
      addSlider(b, { label: 'Vinheta', min: -100, max: 100, def: 0, get: () => st.optics.vignette, set: v => st.optics.vignette = v });
      addSlider(b, { label: 'Vazamento de Luz', min: 0, max: 100, def: 0, get: () => st.optics.leak, set: v => st.optics.leak = v, fmt: v => v + '%' });
      addSlider(b, { label: 'Ângulo do Vazamento', min: 0, max: 360, step: 5, def: 35, get: () => st.optics.leakAngle, set: v => st.optics.leakAngle = v, fmt: v => v + '°' });
      addSlider(b, { label: 'Aberração Cromática', min: 0, max: 100, def: 0, get: () => st.optics.chroma, set: v => st.optics.chroma = v, fmt: v => v + '%' });
      addSlider(b, { label: 'Flash Direto Compacta', min: 0, max: 100, def: 0, get: () => st.optics.flash, set: v => st.optics.flash = v, fmt: v => v + '%' });

      const colRow = document.createElement('div');
      colRow.className = 'row-inline';
      colRow.innerHTML = `<span class="ctrl-name">Cor do Vazamento</span>`;
      const lkColor = document.createElement('input');
      lkColor.type = 'color';
      lkColor.value = st.optics.leakColor;
      lkColor.oninput = () => {
        st.optics.leakColor = lkColor.value;
        if (st.optics.leak === 0) { st.optics.leak = 22; syncAllUI(); }
        requestRender(); commit(false);
      };
      const wrapC = document.createElement('div');
      wrapC.className = 'color-input-wrap';
      wrapC.appendChild(lkColor);
      colRow.appendChild(wrapC);
      b.appendChild(colRow);
      syncHooks.push(() => { lkColor.value = st.optics.leakColor; });
    }));

    // 9. LABORATÓRIO CRIATIVO — 4 ACORDEÕES COLAPSÁVEIS (UX LIMPA E ESCANEÁVEL)
    // 9A. Receitas Prontas do Lab (1 clique)
    mount.appendChild(buildAccordion('lab_presets', 'Receitas Prontas', () => { st.lab = window.deepClone(window.DEFAULT_STATE.lab); }, (b) => {
      const topActions = document.createElement('div');
      topActions.className = 'lab-top-actions';
      const remixBtn = document.createElement('button');
      remixBtn.className = 'lab-remix-btn';
      remixBtn.innerHTML = `${pxIco('px-shuffle', 12)}<span>Remix Procedural</span>`;
      remixBtn.title = 'Gera uma edição procedural inteligente analisando a foto (parâmetros editáveis)';
      remixBtn.onclick = () => runProceduralRemix('lab');
      const clearLabBtn = document.createElement('button');
      clearLabBtn.className = 'mini-chip';
      clearLabBtn.style.height = '27px';
      clearLabBtn.textContent = 'Limpar';
      clearLabBtn.onclick = () => {
        st.lab = window.deepClone(window.DEFAULT_STATE.lab);
        syncAllUI(); requestRender(); commit(true);
      };
      topActions.append(remixBtn, clearLabBtn);
      b.appendChild(topActions);

      const labCatTabs = document.createElement('div');
      labCatTabs.className = 'lab-cat-tabs';
      const labPresetGrid = document.createElement('div');
      labPresetGrid.className = 'lab-preset-grid';

      function renderLabPresets() {
        labCatTabs.innerHTML = '';
        (window.LAB_PRESET_CATS || []).forEach((c) => {
          const cb = document.createElement('button');
          cb.className = 'col-pill' + (ui.labCat === c.id ? ' active' : '');
          cb.textContent = c.label;
          cb.onclick = () => { ui.labCat = c.id; renderLabPresets(); };
          labCatTabs.appendChild(cb);
        });

        labPresetGrid.innerHTML = '';
        const items = (window.LAB_PRESETS || []).filter(p => ui.labCat === 'all' || p.cat === ui.labCat);
        items.forEach((lp) => {
          const card = document.createElement('button');
          card.className = 'lab-preset-card' + (st.lab.presetId === lp.id ? ' active' : '');
          card.dataset.lpid = lp.id;
          const thWrap = document.createElement('div');
          thWrap.className = 'lab-preset-thumb';
          const cv = document.createElement('canvas');
          cv.width = 132; cv.height = 84;
          thWrap.appendChild(cv);
          if (lp.badge) {
            const bd = document.createElement('span');
            bd.className = 'lab-preset-badge';
            bd.textContent = lp.badge;
            thWrap.appendChild(bd);
          }
          const meta = document.createElement('div');
          meta.className = 'lab-preset-meta';
          meta.innerHTML = `<span class="lab-preset-name">${lp.name}</span><span class="lab-preset-sub">${lp.subtitle}</span>`;
          card.append(thWrap, meta);

          const buildThumbState = () => {
            const s = window.freshState();
            s.lab = window.mergeState(s.lab, lp.lab);
            return s;
          };

          card.onclick = () => {
            if (st.lab.presetId === lp.id) {
              st.lab = window.deepClone(window.DEFAULT_STATE.lab);
            } else {
              st.lab = window.mergeState(window.deepClone(window.DEFAULT_STATE.lab), lp.lab);
              st.lab.presetId = lp.id;
            }
            syncAllUI(); requestRender(); commit(true);
          };

          labPresetGrid.appendChild(card);
          labThumbItemsByCard.set(card, { canvas: cv, stateFn: buildThumbState });
        });
        if (ui.mobActiveTab === 'lab') resetLabThumbs();
      }
      b.append(labCatTabs, labPresetGrid);
      renderLabPresets();
      syncHooks.push(() => {
        labPresetGrid.querySelectorAll('.lab-preset-card').forEach(c => {
          c.classList.toggle('active', c.dataset.lpid === st.lab.presetId);
        });
      });
    }));

    // 9B. Efeitos & Texturas (18 FX + Modos de Mesclagem + Controles Contextuais)
    mount.appendChild(buildAccordion('lab_fx', 'Efeitos & Texturas', () => {
      const d = window.DEFAULT_STATE.lab;
      st.lab.fxId = d.fxId; st.lab.fxBlend = d.fxBlend; st.lab.fxMix = d.fxMix;
      st.lab.fxScale = d.fxScale; st.lab.fxIntensity = d.fxIntensity; st.lab.fxParam = d.fxParam;
      st.lab.presetId = 'none';
    }, (b) => {
      const fxChips = document.createElement('div');
      fxChips.className = 'chips-wrap';
      Object.entries(window.LAB_FX_META || {}).forEach(([k, meta]) => {
        const fb = document.createElement('button');
        fb.className = 'mini-chip';
        fb.dataset.fx = k;
        fb.textContent = meta.label;
        fb.onclick = () => {
          st.lab.fxId = k;
          st.lab.presetId = 'none';
          if (k !== 'none' && meta) {
            st.lab.fxMix = meta.defMix ?? 80;
            st.lab.fxScale = meta.defS ?? 50;
            st.lab.fxIntensity = meta.defI ?? 55;
            st.lab.fxParam = meta.defP ?? 50;
          }
          syncAllUI(); requestRender(); commit(true);
        };
        fxChips.appendChild(fb);
      });
      b.appendChild(fxChips);

      const fxControlsWrap = document.createElement('div');
      fxControlsWrap.style.cssText = 'display:flex;flex-direction:column;gap:9px;';

      const blendRow = document.createElement('div');
      blendRow.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
      blendRow.innerHTML = `<span class="ctrl-name">Modo de Mesclagem</span>`;
      const blendChips = document.createElement('div');
      blendChips.className = 'chips-wrap';
      [['normal', 'Normal'], ['screen', 'Tela'], ['multiply', 'Multiplicar'], ['overlay', 'Sobrepor'], ['softlight', 'Luz Suave']].forEach(([bk, bl]) => {
        const bb = document.createElement('button');
        bb.className = 'mini-chip';
        bb.dataset.fb = bk;
        bb.textContent = bl;
        bb.onclick = () => {
          st.lab.fxBlend = bk;
          blendChips.querySelectorAll('.mini-chip').forEach(x => x.classList.toggle('active', x.dataset.fb === st.lab.fxBlend));
          requestRender(); commit(true); updateSectionDots();
        };
        blendChips.appendChild(bb);
      });
      blendRow.appendChild(blendChips);
      fxControlsWrap.appendChild(blendRow);

      addSlider(fxControlsWrap, { label: 'Mistura do Efeito', min: 0, max: 100, def: 75, get: () => st.lab.fxMix, set: v => st.lab.fxMix = v, fmt: v => v + '%' });
      const slFxScale = addSlider(fxControlsWrap, { label: 'Escala / Estrutura', min: 0, max: 100, def: 50, get: () => st.lab.fxScale, set: v => st.lab.fxScale = v });
      const slFxInt = addSlider(fxControlsWrap, { label: 'Intensidade', min: 0, max: 100, def: 50, get: () => st.lab.fxIntensity, set: v => st.lab.fxIntensity = v });
      const slFxParam = addSlider(fxControlsWrap, { label: 'Variação / Ângulo', min: 0, max: 100, def: 50, get: () => st.lab.fxParam ?? 50, set: v => st.lab.fxParam = v });
      b.appendChild(fxControlsWrap);

      const refreshFxUI = () => {
        fxChips.querySelectorAll('.mini-chip').forEach(x => x.classList.toggle('active', x.dataset.fx === st.lab.fxId));
        blendChips.querySelectorAll('.mini-chip').forEach(x => x.classList.toggle('active', x.dataset.fb === (st.lab.fxBlend || 'normal')));
        const active = st.lab.fxId && st.lab.fxId !== 'none';
        fxControlsWrap.hidden = !active;
        const meta = (window.LAB_FX_META && window.LAB_FX_META[st.lab.fxId]) || window.LAB_FX_META.none;
        if (meta) {
          const nS = slFxScale.querySelector('.ctrl-name'); if (nS) nS.textContent = meta.s;
          const nI = slFxInt.querySelector('.ctrl-name'); if (nI) nI.textContent = meta.i;
          const nP = slFxParam.querySelector('.ctrl-name'); if (nP) nP.textContent = meta.p;
        }
      };
      syncHooks.push(refreshFxUI);
      refreshFxUI();
    }));

    // 9C. Paletas & Recoloração
    mount.appendChild(buildAccordion('lab_palette', 'Paletas & Recoloração', () => {
      const d = window.DEFAULT_STATE.lab;
      st.lab.colorMode = d.colorMode; st.lab.paletteId = d.paletteId; st.lab.customPal = [];
      st.lab.palMap = d.palMap; st.lab.palMix = d.palMix; st.lab.palHue = d.palHue;
      st.lab.palSat = d.palSat; st.lab.palLight = d.palLight; st.lab.palInvert = d.palInvert;
      st.lab.duo0 = d.duo0; st.lab.duo1 = d.duo1; st.lab.duo2 = d.duo2;
      st.lab.presetId = 'none';
    }, (b) => {
      const cmChips = document.createElement('div');
      cmChips.className = 'chips-wrap';
      [
        ['all', 'Original'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'],
        ['8', '8'], ['12', '12'], ['16', '16'], ['24', '24'], ['32', '32'],
        ['48', '48'], ['64', '64'], ['128', '128'], ['256', '256'],
        ['duotone', 'Duotone'], ['tritone', 'Tritone'],
      ].forEach(([k, lbl]) => {
        const cb = document.createElement('button');
        cb.className = 'mini-chip';
        cb.dataset.cm = k;
        cb.textContent = lbl;
        cb.onclick = () => {
          st.lab.colorMode = k;
          if (k === 'all') { st.lab.paletteId = 'auto'; st.lab.customPal = []; }
          else if (st.lab.paletteId === 'custom') { st.lab.paletteId = 'auto'; st.lab.customPal = []; }
          refreshLabColors(); requestRender(); commit(true); updateSectionDots();
        };
        cmChips.appendChild(cb);
      });
      b.appendChild(cmChips);

      const duoBox = document.createElement('div');
      duoBox.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
      const duoPresRow = document.createElement('div');
      duoPresRow.className = 'pal-grid';
      (window.DUO_PRESETS || []).forEach((dp) => {
        const btn = document.createElement('button');
        btn.className = 'pal-btn';
        btn.innerHTML = `<span class="pal-btn-name">${dp.label}</span><span class="pal-strip">${dp.colors.map(c => `<span style="background:${c}"></span>`).join('')}</span>`;
        btn.onclick = () => {
          st.lab.duo0 = dp.colors[0];
          st.lab.duo1 = dp.colors[1];
          st.lab.duo2 = dp.colors[2] || '#F2EFE9';
          if (st.lab.colorMode !== 'duotone' && st.lab.colorMode !== 'tritone') st.lab.colorMode = 'tritone';
          refreshLabColors(); requestRender(); commit(true); updateSectionDots();
        };
        duoPresRow.appendChild(btn);
      });
      const duoRow = document.createElement('div');
      duoRow.className = 'row-inline';
      duoRow.style.cssText = 'padding:6px 8px;border-radius:6px;background:#16161c;border:1px solid var(--border);';
      const mkColor = (key, title) => {
        const wrap = document.createElement('label');
        wrap.className = 'color-input-wrap';
        wrap.style.cssText = 'font-size:10.5px;color:var(--text-2);cursor:pointer;';
        const inp = document.createElement('input');
        inp.type = 'color';
        inp.value = st.lab[key];
        inp.oninput = () => { st.lab[key] = inp.value; requestRender(); commit(false); updateSectionDots(); };
        const span = document.createElement('span');
        span.textContent = title;
        wrap.append(inp, span);
        wrap._inp = inp;
        return wrap;
      };
      const cDuo0 = mkColor('duo0', 'Sombras');
      const cDuo1 = mkColor('duo1', 'Meios/Luz');
      const cDuo2 = mkColor('duo2', 'Realces');
      duoRow.append(cDuo0, cDuo1, cDuo2);
      duoBox.append(duoPresRow, duoRow);
      b.appendChild(duoBox);

      const palWrap = document.createElement('div');
      palWrap.style.cssText = 'display:flex;flex-direction:column;gap:5px;';
      palWrap.innerHTML = `<span class="ctrl-name">Paletas Prontas</span>`;
      const palGrid = document.createElement('div');
      palGrid.className = 'pal-grid';
      Object.entries(window.LAB_PALETTES || {}).forEach(([pid, pObj]) => {
        const pb = document.createElement('button');
        pb.className = 'pal-btn';
        pb.dataset.pal = pid;
        const stripHtml = pObj.colors && pObj.colors.length
          ? pObj.colors.map(c => `<span style="background:${c}"></span>`).join('')
          : '';
        pb.innerHTML = `<span class="pal-btn-name">${pObj.label}</span><span class="pal-strip">${stripHtml}</span>`;
        pb.onclick = () => {
          st.lab.paletteId = pid;
          st.lab.customPal = [];
          if (pid === 'auto') {
            if (['all', 'duotone', 'tritone'].includes(st.lab.colorMode)) st.lab.colorMode = '8';
          } else {
            if (['all', 'duotone', 'tritone'].includes(st.lab.colorMode) || parseInt(st.lab.colorMode, 10) > 32) {
              st.lab.colorMode = String(pObj.colors.length);
            }
          }
          refreshLabColors(); requestRender(); commit(true); updateSectionDots();
        };
        palGrid.appendChild(pb);
      });
      palWrap.appendChild(palGrid);
      b.appendChild(palWrap);

      const mapWrap = document.createElement('div');
      mapWrap.style.cssText = 'display:flex;flex-direction:column;gap:5px;';
      mapWrap.innerHTML = `<span class="ctrl-name">Aplicação da Paleta</span>`;
      const mapChips = document.createElement('div');
      mapChips.className = 'chips-wrap';
      [['auto', 'Auto'], ['smooth', 'Degradê'], ['tones', 'Camadas'], ['nearest', 'Cor Próxima']].forEach(([mk, ml]) => {
        const mb = document.createElement('button');
        mb.className = 'mini-chip';
        mb.dataset.pmap = mk;
        mb.textContent = ml;
        mb.onclick = () => {
          st.lab.palMap = mk;
          refreshLabColors(); requestRender(); commit(true); updateSectionDots();
        };
        mapChips.appendChild(mb);
      });
      mapWrap.appendChild(mapChips);
      b.appendChild(mapWrap);

      const editBox = document.createElement('div');
      editBox.className = 'pal-edit-box';
      const editHead = document.createElement('div');
      editHead.className = 'row-inline';
      editHead.innerHTML = `<span class="ctrl-name" style="font-size:10.5px;">Cores aplicadas</span>`;
      const editBtns = document.createElement('div');
      editBtns.style.cssText = 'display:flex;gap:4px;';
      const shufBtn = document.createElement('button');
      shufBtn.className = 'mini-chip';
      shufBtn.innerHTML = `${pxIco('px-shuffle', 11)}<span>Embaralhar</span>`;
      shufBtn.onclick = () => {
        const cur = window.StudioGPU.getActivePaletteHex(st.lab);
        if (cur.length < 2) return;
        const arr = cur.slice();
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        st.lab.paletteId = 'custom';
        st.lab.customPal = arr;
        if (st.lab.palMap === 'auto') st.lab.palMap = 'smooth';
        refreshLabColors(); requestRender(); commit(true); updateSectionDots();
      };
      const photoPalBtn = document.createElement('button');
      photoPalBtn.className = 'mini-chip';
      photoPalBtn.innerHTML = `${pxIco('px-reset', 11)}<span>Da Foto</span>`;
      photoPalBtn.onclick = () => {
        st.lab.paletteId = 'auto';
        st.lab.customPal = [];
        st.lab.palMap = 'auto';
        if (st.lab.colorMode === 'all') st.lab.colorMode = '8';
        refreshLabColors(); requestRender(); commit(true); updateSectionDots();
      };
      editBtns.append(shufBtn, photoPalBtn);
      editHead.appendChild(editBtns);
      const editDots = document.createElement('div');
      editDots.className = 'pal-edit-dots';
      editBox.append(editHead, editDots);
      b.appendChild(editBox);

      addSlider(b, { label: 'Mistura da Recoloração', min: 0, max: 100, def: 100, get: () => st.lab.palMix ?? 100, set: v => st.lab.palMix = v, fmt: v => v + '%' });
      addSlider(b, { label: 'Girar Cores (Matiz)', min: -180, max: 180, step: 2, def: 0, trackClass: 'grad-hue', get: () => st.lab.palHue, set: v => st.lab.palHue = v, fmt: v => (v > 0 ? '+' : '') + v + '°' });
      addSlider(b, { label: 'Saturação da Paleta', min: -100, max: 100, def: 0, get: () => st.lab.palSat, set: v => st.lab.palSat = v });
      addSlider(b, { label: 'Luminância da Paleta', min: -100, max: 100, def: 0, get: () => st.lab.palLight || 0, set: v => st.lab.palLight = v });

      const invRow = document.createElement('div');
      invRow.className = 'row-inline';
      const invBtn = document.createElement('button');
      invBtn.className = 'mini-chip';
      invBtn.innerHTML = `${pxIco('px-invert', 11)}<span>Inverter Negativo</span>`;
      invBtn.onclick = () => {
        st.lab.palInvert = !st.lab.palInvert;
        refreshLabColors(); requestRender(); commit(true); updateSectionDots();
      };
      invRow.appendChild(invBtn);
      b.appendChild(invRow);

      function renderActivePaletteDots() {
        const isPal = !['all', 'duotone', 'tritone'].includes(st.lab.colorMode) && !(st.lab.paletteId === 'auto' && (parseInt(st.lab.colorMode, 10) || 0) > 32);
        editBox.hidden = !isPal;
        if (!isPal) return;
        const cols = window.StudioGPU.getActivePaletteHex(st.lab);
        editDots.innerHTML = '';
        cols.slice(0, 16).forEach((hex, idx) => {
          const inp = document.createElement('input');
          inp.type = 'color';
          inp.className = 'pal-dot-inp';
          inp.value = hex;
          inp.title = `Cor ${idx + 1} (${hex}) — clique para trocar`;
          inp.oninput = () => {
            const cur = window.StudioGPU.getActivePaletteHex(st.lab);
            cur[idx] = inp.value;
            st.lab.paletteId = 'custom';
            st.lab.customPal = cur;
            requestRender(); commit(false); updateSectionDots();
          };
          editDots.appendChild(inp);
        });
      }

      function refreshLabColors() {
        cmChips.querySelectorAll('.mini-chip').forEach(x => x.classList.toggle('active', x.dataset.cm === st.lab.colorMode));
        palGrid.querySelectorAll('.pal-btn').forEach(x => x.classList.toggle('active', st.lab.colorMode !== 'all' && x.dataset.pal === st.lab.paletteId));
        mapChips.querySelectorAll('.mini-chip').forEach(x => x.classList.toggle('active', x.dataset.pmap === (st.lab.palMap || 'auto')));
        const isDuo = st.lab.colorMode === 'duotone' || st.lab.colorMode === 'tritone';
        const isPal = !['all', 'duotone', 'tritone'].includes(st.lab.colorMode);
        duoBox.hidden = !isDuo;
        cDuo2.hidden = st.lab.colorMode !== 'tritone';
        mapWrap.hidden = !isPal || (st.lab.paletteId === 'auto' && (parseInt(st.lab.colorMode, 10) || 0) > 32);
        cDuo0._inp.value = st.lab.duo0;
        cDuo1._inp.value = st.lab.duo1;
        cDuo2._inp.value = st.lab.duo2;
        invBtn.classList.toggle('active', !!st.lab.palInvert);
        renderActivePaletteDots();
      }
      syncHooks.push(refreshLabColors);
      refreshLabColors();
    }));

    // 9D. Pixel & Pontilhado (DNA Pixelar)
    mount.appendChild(buildAccordion('lab_pixel', 'Pixel & Pontilhado', () => {
      const d = window.DEFAULT_STATE.lab;
      st.lab.pixelSize = d.pixelSize; st.lab.ditherMode = d.ditherMode; st.lab.ditherStrength = d.ditherStrength;
      st.lab.presetId = 'none';
    }, (b) => {
      addSlider(b, { label: 'Tamanho do Pixel', min: 1, max: 32, def: 1, get: () => st.lab.pixelSize, set: v => st.lab.pixelSize = v, fmt: v => v + ' px' });

      const dtChips = document.createElement('div');
      dtChips.className = 'chips-wrap';
      [['none', 'Sem Dither'], ['bayer8', 'Bayer 8×8'], ['atkinson', 'Atkinson 84'], ['halftone', 'Retícula'], ['scanlines', 'Linhas TV'], ['noise', 'Ruído']].forEach(([k, lbl]) => {
        const db = document.createElement('button');
        db.className = 'mini-chip';
        db.dataset.dt = k;
        db.textContent = lbl;
        db.onclick = () => {
          st.lab.ditherMode = k;
          dtChips.querySelectorAll('.mini-chip').forEach(x => x.classList.toggle('active', x.dataset.dt === st.lab.ditherMode));
          requestRender(); commit(true); updateSectionDots();
        };
        dtChips.appendChild(db);
      });
      b.appendChild(dtChips);
      syncHooks.push(() => { dtChips.querySelectorAll('.mini-chip').forEach(x => x.classList.toggle('active', x.dataset.dt === st.lab.ditherMode)); });

      addSlider(b, { label: 'Força do Dither', min: 0, max: 100, def: 45, get: () => st.lab.ditherStrength, set: v => st.lab.ditherStrength = v, fmt: v => v + '%' });
    }));

    // 10. CORTE, GEOMETRIA & CORREÇÃO DE LENTE — 3 ACORDEÕES COLAPSÁVEIS
    // 10A. Corte, Proporção & Grade
    mount.appendChild(buildAccordion('crop_frame', 'Corte & Proporção', () => {
      const d = window.DEFAULT_STATE.crop;
      st.crop.aspect = d.aspect; st.crop.rot = d.rot; st.crop.flipH = d.flipH; st.crop.flipV = d.flipV;
      st.crop.straighten = d.straighten; st.crop.constrainCrop = d.constrainCrop; st.crop.grid = d.grid;
      window.StudioGPU.invalidate();
    }, (b) => {
      const arChips = document.createElement('div');
      arChips.className = 'chips-wrap';
      [['original', 'Original'], ['1:1', '1:1'], ['4:5', '4:5'], ['3:4', '3:4'], ['2:3', '2:3'], ['3:2', '3:2'], ['16:9', '16:9'], ['9:16', '9:16'], ['21:9', 'Cinema']].forEach(([k, lbl]) => {
        const cb = document.createElement('button');
        cb.className = 'mini-chip';
        cb.dataset.ar = k;
        cb.textContent = lbl;
        cb.onclick = () => {
          st.crop.aspect = k;
          arChips.querySelectorAll('.mini-chip').forEach(x => x.classList.toggle('active', x.dataset.ar === st.crop.aspect));
          requestRender(); commit(true); updateSectionDots();
        };
        arChips.appendChild(cb);
      });
      b.appendChild(arChips);
      syncHooks.push(() => { arChips.querySelectorAll('.mini-chip').forEach(x => x.classList.toggle('active', x.dataset.ar === st.crop.aspect)); });

      const actRow = document.createElement('div');
      actRow.className = 'geom-quick-grid';
      const mkAct = (icoId, txt, title, fn) => {
        const btn = document.createElement('button');
        btn.className = 'geom-quick-btn';
        btn.innerHTML = `${pxIco(icoId, 12)}<span>${txt}</span>`;
        btn.title = title;
        btn.onclick = () => { fn(); requestRender(); commit(true); updateSectionDots(); syncAllUI(); };
        return btn;
      };
      const btnFlipH = mkAct('px-flip-h', 'Esp. H', 'Espelhar Horizontal', () => { st.crop.flipH = !st.crop.flipH; });
      const btnFlipV = mkAct('px-flip-v', 'Esp. V', 'Espelhar Vertical', () => { st.crop.flipV = !st.crop.flipV; });
      actRow.append(
        mkAct('px-rot-l', '−90°', 'Girar 90° anti-horário', () => { st.crop.rot = (st.crop.rot + 270) % 360; window.StudioGPU.invalidate(); }),
        mkAct('px-rot-r', '+90°', 'Girar 90° horário', () => { st.crop.rot = (st.crop.rot + 90) % 360; window.StudioGPU.invalidate(); }),
        btnFlipH,
        btnFlipV,
      );
      b.appendChild(actRow);
      syncHooks.push(() => {
        btnFlipH.classList.toggle('active', !!st.crop.flipH);
        btnFlipV.classList.toggle('active', !!st.crop.flipV);
      });

      const ccRow = document.createElement('div');
      ccRow.className = 'toggle-row';
      ccRow.innerHTML = `<span class="ctrl-name" style="color:var(--text-1);">Restringir Corte (Auto-Zoom)</span>`;
      const ccSwitch = document.createElement('button');
      ccSwitch.className = 'toggle-switch';
      ccSwitch.title = 'Ajusta a escala automaticamente para evitar bordas pretas ao girar ou corrigir perspectiva';
      ccSwitch.onclick = () => {
        st.crop.constrainCrop = !st.crop.constrainCrop;
        ccSwitch.classList.toggle('on', !!st.crop.constrainCrop);
        requestRender(); commit(true); updateSectionDots();
      };
      ccRow.appendChild(ccSwitch);
      b.appendChild(ccRow);
      syncHooks.push(() => { ccSwitch.classList.toggle('on', !!st.crop.constrainCrop); });

      addSlider(b, { label: 'Endireitar Horizonte', min: -45, max: 45, step: 0.1, def: 0, get: () => st.crop.straighten || 0, set: v => { st.crop.straighten = v; }, fmt: v => (v > 0 ? '+' : '') + v.toFixed(1) + '°' });

      const shGrid = document.createElement('div');
      shGrid.className = 'lab-subhead';
      shGrid.textContent = 'Grade de Composição';
      b.appendChild(shGrid);

      const grChips = document.createElement('div');
      grChips.className = 'chips-wrap';
      [['none', 'Sem Grade'], ['thirds', 'Terços 3×3'], ['fine', 'Grade 6×6'], ['golden', 'Áurea (Phi)'], ['diag', 'Diagonais'], ['center', 'Mira / Nível']].forEach(([gk, gl]) => {
        const gb = document.createElement('button');
        gb.className = 'mini-chip';
        gb.dataset.gr = gk;
        gb.textContent = gl;
        gb.onclick = () => {
          st.crop.grid = gk;
          grChips.querySelectorAll('.mini-chip').forEach(x => x.classList.toggle('active', x.dataset.gr === st.crop.grid));
          renderGridOverlay();
        };
        grChips.appendChild(gb);
      });
      b.appendChild(grChips);
      syncHooks.push(() => {
        grChips.querySelectorAll('.mini-chip').forEach(x => x.classList.toggle('active', x.dataset.gr === (st.crop.grid || 'thirds')));
        renderGridOverlay();
      });
    }));

    // 10B. Perspectiva & Transformação
    mount.appendChild(buildAccordion('crop_transform', 'Perspectiva & Transformação', () => {
      st.crop.perspV = 0; st.crop.perspH = 0; st.crop.skew = 0;
      st.crop.aspectWarp = 0; st.crop.scale = 100; st.crop.offsetX = 0; st.crop.offsetY = 0;
    }, (b) => {
      const upRow = document.createElement('div');
      upRow.className = 'geom-quick-grid';
      const mkUp = (txt, title, fn) => {
        const btn = document.createElement('button');
        btn.className = 'geom-quick-btn';
        btn.textContent = txt;
        btn.title = title;
        btn.onclick = () => { fn(); syncAllUI(); requestRender(); commit(true); };
        return btn;
      };
      upRow.append(
        mkUp('Nível 0°', 'Zerar inclinação do horizonte', () => { st.crop.straighten = 0; }),
        mkUp('Vert. +', 'Corrigir prédios convergindo no topo', () => { st.crop.perspV = Math.min(100, (st.crop.perspV || 0) + 18); }),
        mkUp('Vert. −', 'Inclinar perspectiva para baixo', () => { st.crop.perspV = Math.max(-100, (st.crop.perspV || 0) - 18); }),
        mkUp('Zerar', 'Restaurar Transformação', () => {
          st.crop.perspV = 0; st.crop.perspH = 0; st.crop.skew = 0;
          st.crop.aspectWarp = 0; st.crop.scale = 100; st.crop.offsetX = 0; st.crop.offsetY = 0;
        }),
      );
      b.appendChild(upRow);

      addSlider(b, { label: 'Vertical (Keystone V)', min: -100, max: 100, def: 0, get: () => st.crop.perspV || 0, set: v => st.crop.perspV = v });
      addSlider(b, { label: 'Horizontal (Keystone H)', min: -100, max: 100, def: 0, get: () => st.crop.perspH || 0, set: v => st.crop.perspH = v });
      addSlider(b, { label: 'Inclinação (Skew)', min: -100, max: 100, def: 0, get: () => st.crop.skew || 0, set: v => st.crop.skew = v });
      addSlider(b, { label: 'Proporção (Alongar)', min: -100, max: 100, def: 0, get: () => st.crop.aspectWarp || 0, set: v => st.crop.aspectWarp = v });
      addSlider(b, { label: 'Escala do Quadro', min: 50, max: 200, def: 100, get: () => st.crop.scale ?? 100, set: v => st.crop.scale = v, fmt: v => v + '%' });
      addSlider(b, { label: 'Deslocamento X', min: -100, max: 100, def: 0, get: () => st.crop.offsetX || 0, set: v => st.crop.offsetX = v });
      addSlider(b, { label: 'Deslocamento Y', min: -100, max: 100, def: 0, get: () => st.crop.offsetY || 0, set: v => st.crop.offsetY = v });
    }));

    // 10C. Correção de Lente
    mount.appendChild(buildAccordion('crop_lens', 'Correção de Lente', () => {
      st.crop.distortion = 0; st.crop.lensVignette = 0;
    }, (b) => {
      addSlider(b, { label: 'Distorção (Barril / Almofada)', min: -100, max: 100, def: 0, get: () => st.crop.distortion || 0, set: v => st.crop.distortion = v });
      addSlider(b, { label: 'Vinheta da Lente', min: -100, max: 100, def: 0, get: () => st.crop.lensVignette || 0, set: v => st.crop.lensVignette = v });
    }));

    updateSectionDots();
  }

  function updateSectionDots() {
    const d = window.DEFAULT_STATE;
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const labFxMod = st.lab.fxId !== 'none';
    const labPalMod = st.lab.colorMode !== 'all' || st.lab.palHue !== 0 || st.lab.palSat !== 0 || (st.lab.palLight || 0) !== 0 || !!st.lab.palInvert;
    const labPixMod = st.lab.pixelSize > 1 || st.lab.ditherMode !== 'none';
    const labPreMod = st.lab.presetId && st.lab.presetId !== 'none';
    const cropFrameMod = st.crop.aspect !== 'original' || st.crop.rot !== 0 || !!st.crop.flipH || !!st.crop.flipV || Math.abs(st.crop.straighten || 0) > 0.01;
    const cropTransMod = (st.crop.perspV || 0) !== 0 || (st.crop.perspH || 0) !== 0 || (st.crop.skew || 0) !== 0 || (st.crop.aspectWarp || 0) !== 0 || (st.crop.scale ?? 100) !== 100 || (st.crop.offsetX || 0) !== 0 || (st.crop.offsetY || 0) !== 0;
    const cropLensMod = (st.crop.distortion || 0) !== 0 || (st.crop.lensVignette || 0) !== 0;

    const map = {
      light: !eq(st.light, d.light), curve: !eq(st.curve, d.curve), color: !eq(st.color, d.color),
      hsl: !eq(st.hsl, d.hsl), grade: !eq(st.grade, d.grade), presence: !eq(st.presence, d.presence),
      film: !eq(st.film, d.film), optics: !eq(st.optics, d.optics),
      lab_presets: !!labPreMod, lab_fx: labFxMod, lab_palette: labPalMod, lab_pixel: labPixMod,
      crop_frame: cropFrameMod, crop_transform: cropTransMod, crop_lens: cropLensMod,
    };

    const fxMeta = window.LAB_FX_META && window.LAB_FX_META[st.lab.fxId];
    const palObj = window.LAB_PALETTES && window.LAB_PALETTES[st.lab.paletteId];
    const lpObj = (window.LAB_PRESETS || []).find(x => x.id === st.lab.presetId);
    const summaries = {
      lab_presets: lpObj ? lpObj.name : '',
      lab_fx: labFxMod && fxMeta ? fxMeta.label : '',
      lab_palette: labPalMod ? (st.lab.colorMode === 'duotone' ? 'Duotone' : st.lab.colorMode === 'tritone' ? 'Tritone' : (palObj && st.lab.paletteId !== 'auto' ? palObj.label : `${st.lab.colorMode} cores`)) : '',
      lab_pixel: labPixMod ? (st.lab.pixelSize > 1 ? `${st.lab.pixelSize} px` : st.lab.ditherMode) : '',
      crop_frame: st.crop.aspect !== 'original' ? st.crop.aspect : (Math.abs(st.crop.straighten || 0) > 0.05 ? `${st.crop.straighten.toFixed(1)}°` : ''),
      crop_transform: cropTransMod ? 'Ativo' : '',
      crop_lens: cropLensMod ? 'Ativo' : '',
    };

    Object.keys(map).forEach((k) => {
      if (sectionRefs[k]) sectionRefs[k].classList.toggle('modified', !!map[k]);
      const sEl = sectionSummaries[k];
      if (sEl) {
        const txt = summaries[k] || '';
        sEl.textContent = txt;
        sEl.hidden = !txt;
      }
    });

    const railMod = {
      presets: st.preset.id !== 'none',
      light: map.light || map.curve || map.presence,
      color: map.color || map.hsl || map.grade,
      optics: map.film || map.optics,
      lab: map.lab_presets || map.lab_fx || map.lab_palette || map.lab_pixel,
      crop: map.crop_frame || map.crop_transform || map.crop_lens,
    };
    const rail = $('toolRail');
    if (rail) {
      rail.querySelectorAll('.rail-btn').forEach((b) => {
        b.classList.toggle('has-mod', !!railMod[b.dataset.rtab]);
      });
    }
  }

  function updateRecipeBadge() {
    const items = window.summarizeRecipe(st);
    const badge = $('recipeBadge');
    badge.textContent = items.length;
    badge.hidden = items.length === 0;
  }

  function syncAllUI() {
    syncHooks.forEach(fn => fn());
    syncActiveLookBar();
    updateSectionDots();
    updateRecipeBadge();
    $('presetScroll').querySelectorAll('.preset-card').forEach(c => {
      c.classList.toggle('active', c.dataset.pid === st.preset.id);
    });
    if (window.__PX_ADAPTIVE && window.__PX_ADAPTIVE.onSync) window.__PX_ADAPTIVE.onSync();
  }

  // =========================================================================
  // UNIFIED TOOL RAIL (DESKTOP) — SMART COLLAPSIBLE ACCORDION GROUPS
  // =========================================================================
  const TOOL_SECTION_GROUPS = {
    light: ['light', 'curve', 'presence'],
    color: ['color', 'hsl', 'grade'],
    optics: ['film', 'optics'],
    lab: ['lab_presets', 'lab_fx', 'lab_palette', 'lab_pixel'],
    crop: ['crop_frame', 'crop_transform', 'crop_lens'],
  };

  const DEFAULT_OPEN_IN_GROUP = {
    light: ['light'],
    color: ['color'],
    optics: ['optics'],
    lab: ['lab_presets'],
    crop: ['crop_frame'],
  };

  function applyAdjustGroup(tabKey) {
    const group = TOOL_SECTION_GROUPS[tabKey] || [];
    const defOpen = DEFAULT_OPEN_IN_GROUP[tabKey] || [];
    Object.entries(sectionRefs).forEach(([k, sec]) => {
      const match = group.includes(k);
      sec.hidden = !match;
      if (match) {
        const shouldOpen = defOpen.includes(k) || sec.classList.contains('modified') || ui.openSections.has(k);
        sec.classList.toggle('open', shouldOpen);
        if (shouldOpen) ui.openSections.add(k);
        else ui.openSections.delete(k);
      }
    });
    $('inspectorScroll').scrollTop = 0;
    if (tabKey === 'light' || tabKey === 'color') syncHooks.forEach(fn => fn());
    if (tabKey === 'lab') setTimeout(resetLabThumbs, 30);
  }

  function selectToolTab(tab, allowCollapse = true) {
    if (allowCollapse && ui.mobActiveTab === tab) {
      ui.mobActiveTab = 'none';
      studioEl.dataset.tab = 'none';
    } else {
      ui.mobActiveTab = tab;
      if (tab === 'presets') {
        studioEl.dataset.tab = 'presets';
        resetLazyThumbs();
      } else if (tab === 'none') {
        studioEl.dataset.tab = 'none';
      } else {
        studioEl.dataset.tab = 'adjust';
        applyAdjustGroup(tab);
      }
    }
    const rail = $('toolRail');
    if (rail) rail.querySelectorAll('.rail-btn').forEach(x => x.classList.toggle('active', x.dataset.rtab === ui.mobActiveTab));
    const focusBtn = $('btnFocusMode');
    if (focusBtn) focusBtn.classList.toggle('active', ui.mobActiveTab === 'none' && studioEl.classList.contains('strip-hidden'));
    renderGridOverlay();
    setTimeout(() => fitViewport(false), 30);
  }

  window.addEventListener('resize', () => {
    requestAnimationFrame(() => fitViewport(false));
  });

  if ($('toolRail')) {
    $('toolRail').querySelectorAll('.rail-btn').forEach((btn) => {
      btn.onclick = () => selectToolTab(btn.dataset.rtab, true);
    });
  }

  // =========================================================================
  // AUTO TONE
  // =========================================================================
  function runAutoTone() {
    const src = getActiveSource();
    if (!src) return;
    const sc = document.createElement('canvas');
    sc.width = 96; sc.height = 64;
    const ctx = sc.getContext('2d');
    ctx.drawImage(src, 0, 0, 96, 64);
    const d = ctx.getImageData(0, 0, 96, 64).data;
    const histL = new Uint32Array(256);
    let sumL = 0, cnt = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
      histL[l]++; sumL += l; cnt++;
    }
    const mean = sumL / cnt / 255;
    let p2 = 0, p98 = 255, acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += histL[i];
      if (acc >= cnt * 0.02 && p2 === 0) p2 = i;
      if (acc >= cnt * 0.98 && p98 === 255) p98 = i;
    }
    st.light.exposure = Math.max(-0.5, Math.min(0.45, Math.round((0.46 - mean) * 1.1 * 20) / 20));
    st.light.highlights = p98 > 235 ? -24 : -10;
    st.light.shadows = p2 < 16 ? 18 : 6;
    st.light.contrast = (p98 - p2) < 170 ? 12 : 4;
    st.color.vibrance = Math.max(st.color.vibrance, 8);
    commit(true); syncAllUI(); requestRender();
    toast('Auto Luz equilibrado');
  }

  // =========================================================================
  // SMART PROCEDURAL RANDOMIZATION (HISTOGRAM + SAFE RANGES + INCOMPATIBILITY MATRIX)
  // =========================================================================
  function runProceduralRemix(scope = 'studio') {
    if (!window.StudioProcedural) return;
    const src = getActiveSource();
    const res = window.StudioProcedural.generate(src, st.crop, { scope });
    st = res.state;
    window.StudioGPU.invalidate();
    commit(true);
    syncAllUI();
    requestRender();
    toast(res.summary);
  }

  // =========================================================================
  // VIEWPORT INTERACTIONS
  // =========================================================================
  let dragPan = null;
  let dragSplit = false;

  splitLine.addEventListener('pointerdown', (e) => { e.stopPropagation(); dragSplit = true; splitLine.setPointerCapture(e.pointerId); });
  splitLine.addEventListener('pointermove', (e) => {
    if (!dragSplit) return;
    const r = outCanvas.getBoundingClientRect();
    view.split = Math.max(0.02, Math.min(0.98, (e.clientX - r.left) / r.width));
    applyCompareVisuals();
  });
  splitLine.addEventListener('pointerup', () => { dragSplit = false; });

  viewport.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.stage-hud') || e.target.closest('.split-line')) return;
    if (view.zoom <= 1.01) return;
    dragPan = { x: e.clientX, y: e.clientY, px: view.panX, py: view.panY };
    viewport.setPointerCapture(e.pointerId);
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!dragPan) return;
    view.panX = dragPan.px + (e.clientX - dragPan.x);
    view.panY = dragPan.py + (e.clientY - dragPan.y);
    applyTransform();
  });
  viewport.addEventListener('pointerup', () => { dragPan = null; });
  viewport.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(view.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)); }, { passive: false });
  viewport.addEventListener('dragover', (e) => { e.preventDefault(); viewport.classList.add('drag-over'); });
  viewport.addEventListener('dragleave', () => viewport.classList.remove('drag-over'));
  viewport.addEventListener('drop', (e) => {
    e.preventDefault();
    viewport.classList.remove('drag-over');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
  });
  window.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) if (it.type.startsWith('image/')) { loadFile(it.getAsFile()); break; }
  });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => fitViewport(false)).observe(viewport);

  // =========================================================================
  // TOPBAR & MODALS WIRING
  // =========================================================================
  $('btnUpload').onclick = $('btnStripUpload').onclick = () => $('fileInput').click();
  $('fileInput').onchange = (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ''; };
  $('btnUndo').onclick = undo;
  $('btnRedo').onclick = redo;
  $('btnAutoTone').onclick = runAutoTone;
  if ($('btnProceduralRemix')) $('btnProceduralRemix').onclick = () => runProceduralRemix('studio');
  $('btnResetAll').onclick = () => {
    st = window.freshState();
    window.StudioGPU.invalidate();
    commit(true); syncAllUI(); requestRender();
    toast('Todos os ajustes restaurados');
  };
  $('btnClearPreset').onclick = () => {
    const curCrop = window.deepClone(st.crop);
    st = window.freshState(); st.crop = curCrop;
    commit(true); syncAllUI(); requestRender();
  };
  $('btnZoomIn').onclick = () => setZoom(view.zoom * 1.25);
  $('btnZoomOut').onclick = () => setZoom(view.zoom / 1.25);
  $('btnZoomFit').onclick = () => fitViewport(true);

  let lastOpenTab = 'presets';
  function toggleFocusMode() {
    const isFocused = ui.mobActiveTab === 'none' && studioEl.classList.contains('strip-hidden');
    if (isFocused) {
      studioEl.classList.remove('strip-hidden');
      selectToolTab(lastOpenTab || 'presets', false);
    } else {
      if (ui.mobActiveTab !== 'none') lastOpenTab = ui.mobActiveTab;
      studioEl.classList.add('strip-hidden');
      selectToolTab('none', false);
    }
    if ($('btnToggleStrip')) $('btnToggleStrip').classList.toggle('active', !studioEl.classList.contains('strip-hidden'));
    setTimeout(() => fitViewport(false), 40);
  }
  if ($('btnFocusMode')) $('btnFocusMode').onclick = toggleFocusMode;
  if ($('btnToggleStrip')) {
    $('btnToggleStrip').classList.add('active');
    $('btnToggleStrip').onclick = () => {
      studioEl.classList.toggle('strip-hidden');
      $('btnToggleStrip').classList.toggle('active', !studioEl.classList.contains('strip-hidden'));
      setTimeout(() => fitViewport(false), 40);
    };
  }

  document.querySelectorAll('.seg-btn[data-view]').forEach((btn) => {
    btn.onclick = () => {
      view.mode = btn.dataset.view;
      document.querySelectorAll('.seg-btn[data-view]').forEach(x => x.classList.toggle('active', x.dataset.view === view.mode));
      fitViewport(true);
      applyCompareVisuals();
      requestRender();
    };
  });

  const holdBtn = $('btnHoldOrig');
  const setHold = (on) => {
    if (view.holdOrig === on) return;
    view.holdOrig = on;
    holdBtn.classList.toggle('active', on);
    requestRender();
  };
  holdBtn.addEventListener('pointerdown', () => setHold(true));
  window.addEventListener('pointerup', () => setHold(false));

  $('presetSearch').oninput = (e) => { ui.search = e.target.value; buildPresetGrid(); };
  $('btnFavFilter').onclick = () => {
    ui.favOnly = !ui.favOnly;
    $('btnFavFilter').style.color = ui.favOnly ? 'var(--accent)' : '';
    buildPresetGrid();
  };

  document.querySelectorAll('[data-close]').forEach((btn) => { btn.onclick = () => { $(btn.dataset.close).hidden = true; }; });
  document.querySelectorAll('.modal-backdrop').forEach((bg) => { bg.addEventListener('click', (e) => { if (e.target === bg) bg.hidden = true; }); });

  $('btnRecipe').onclick = () => {
    const items = window.summarizeRecipe(st);
    const list = $('recipeList');
    list.innerHTML = '';
    if (!items.length) list.innerHTML = `<div style="color:var(--text-3);text-align:center;padding:20px;">Nenhum ajuste aplicado ainda.</div>`;
    else items.forEach((it) => {
      const div = document.createElement('div');
      div.className = 'recipe-item';
      div.innerHTML = `<span><strong style="color:var(--text-2);font-weight:500;">${it.sec} ·</strong> ${it.label}</span><code>${it.val}</code>`;
      list.appendChild(div);
    });
    $('recipeModal').hidden = false;
  };

  $('btnCopyRecipe').onclick = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(st, null, 2)); toast('Receita JSON copiada!'); }
    catch { toast('Não foi possível copiar'); }
  };

  $('btnImportRecipe').onclick = () => $('recipeFileInput').click();
  $('recipeFileInput').onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        st = window.mergeState(window.freshState(), JSON.parse(r.result));
        window.StudioGPU.invalidate(); commit(true); syncAllUI(); requestRender();
        $('recipeModal').hidden = true; toast('Receita importada!');
      } catch { toast('Arquivo JSON inválido'); }
    };
    r.readAsText(f); e.target.value = '';
  };

  $('btnSavePreset').onclick = () => { $('savePresetName').value = ''; $('savePresetModal').hidden = false; setTimeout(() => $('savePresetName').focus(), 40); };
  $('btnConfirmSavePreset').onclick = () => {
    const name = $('savePresetName').value.trim(); if (!name) return;
    ui.savedPresets.unshift({ id: 'custom_' + Date.now(), collection: 'saved', name, badge: 'MEU LOOK', subtitle: 'Receita personalizada', state: window.deepClone(st) });
    store.set('savedPresets', ui.savedPresets);
    $('savePresetModal').hidden = true;
    ui.collection = 'saved'; buildCollectionTabs(); buildPresetGrid();
    toast(`Preset "${name}" salvo!`);
  };

  // =========================================================================
  // EXPORT MODAL (FULL ORIGINAL QUALITY PHOTO + WEBP + VALID PNG tEXt + MACOS BRIDGE)
  // =========================================================================
  function selectExportFmt(fmt) {
    ui.exportFmt = fmt;
    document.querySelectorAll('#exportFormatGrid .export-card').forEach(x => x.classList.toggle('active', x.dataset.fmt === fmt));
    const qWrap = $('exportQualityWrap');
    if (qWrap) qWrap.hidden = !(fmt === 'jpeg' || fmt === 'webp');
    if (fmt === 'cube') {
      $('exportNote').textContent = 'Gera uma 3D LUT padrão da indústria (17×17×17 .cube) para usar seu look no Lightroom, DaVinci Resolve ou Premiere.';
    } else if (fmt === 'video') {
      const m = window.StudioVideo.pickModernMime();
      $('exportNote').textContent = `Converte seu ${media.kind === 'avi' ? 'AVI Cyber-shot' : 'vídeo'} em ${m ? m.label : 'vídeo moderno'} na resolução original (${media.w}×${media.h}px) com todos os efeitos e áudio preservados.`;
    } else if (fmt === 'webp') {
      $('exportNote').textContent = `Exporta em WebP (${ui.exportQuality}%) mantendo a resolução original (${media.w} × ${media.h}px) com tamanho otimizado.`;
    } else if (fmt === 'jpeg') {
      $('exportNote').textContent = `Exporta em JPEG Editorial (${ui.exportQuality}%) na resolução original (${media.w} × ${media.h}px).`;
    } else {
      $('exportNote').textContent = `Preserva 100% da resolução original (${media.w} × ${media.h}px) sem perda de nitidez, com receita embutida em chunk PNG tEXt válido.`;
    }
  }

  if ($('exportQualityRange')) {
    $('exportQualityRange').oninput = (e) => {
      ui.exportQuality = parseInt(e.target.value, 10) || 96;
      if ($('exportQualityVal')) $('exportQualityVal').textContent = ui.exportQuality + '%';
      selectExportFmt(ui.exportFmt);
    };
  }

  $('btnExport').onclick = () => {
    const isVid = media.kind !== 'image';
    $('exportCardVideo').hidden = !isVid;
    $('exportProgressWrap').hidden = true;
    $('btnConfirmExport').disabled = false;
    if (media.kind === 'avi' || (isVid && ui.exportFmt !== 'cube')) {
      selectExportFmt('video');
    } else if (!isVid && ui.exportFmt === 'video') {
      selectExportFmt('png');
    } else {
      selectExportFmt(ui.exportFmt);
    }
    $('exportModal').hidden = false;
  };

  document.querySelectorAll('#exportFormatGrid .export-card').forEach((card) => {
    card.onclick = () => selectExportFmt(card.dataset.fmt);
  });

  // Spec-compliant CRC32 + PNG tEXt chunk injector (inserts safely BEFORE IEND)
  const PNG_CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = PNG_CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  async function injectPngTextChunk(pngBlob, keyword, text) {
    try {
      const orig = new Uint8Array(await pngBlob.arrayBuffer());
      // Find IEND chunk (last 12 bytes of a valid PNG)
      let iendPos = -1;
      for (let p = orig.length - 12; p >= 8; p--) {
        if (orig[p + 4] === 0x49 && orig[p + 5] === 0x45 && orig[p + 6] === 0x4e && orig[p + 7] === 0x44) {
          iendPos = p;
          break;
        }
      }
      if (iendPos < 8) return pngBlob;
      const enc = new TextEncoder();
      const keyB = enc.encode(keyword);
      const txtB = enc.encode(text);
      const dataLen = keyB.length + 1 + txtB.length;
      const chunk = new Uint8Array(12 + dataLen);
      const dv = new DataView(chunk.buffer);
      dv.setUint32(0, dataLen, false);
      chunk[4] = 0x74; chunk[5] = 0x45; chunk[6] = 0x58; chunk[7] = 0x74; // 'tEXt'
      chunk.set(keyB, 8);
      chunk[8 + keyB.length] = 0;
      chunk.set(txtB, 9 + keyB.length);
      dv.setUint32(8 + dataLen, crc32(chunk.subarray(4, 8 + dataLen)), false);
      const out = new Uint8Array(orig.length + chunk.length);
      out.set(orig.subarray(0, iendPos), 0);
      out.set(chunk, iendPos);
      out.set(orig.subarray(iendPos), iendPos + chunk.length);
      return new Blob([out], { type: 'image/png' });
    } catch {
      return pngBlob;
    }
  }

  function triggerDownload(blob, filename) {
    // Native macOS WKWebView Save Panel bridge!
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.pixelarSave) {
      const reader = new FileReader();
      reader.onload = () => {
        const res = String(reader.result || '');
        const comma = res.indexOf(',');
        const base64 = comma >= 0 ? res.slice(comma + 1) : res;
        window.webkit.messageHandlers.pixelarSave.postMessage({
          filename,
          mime: blob.type || 'application/octet-stream',
          base64,
        });
      };
      reader.readAsDataURL(blob);
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  $('btnExportRecipeJson').onclick = () => {
    const slug = (media.name || 'pixelar').replace(/\s+/g, '_').toLowerCase();
    triggerDownload(new Blob([JSON.stringify(st, null, 2)], { type: 'application/json' }), `${slug}_receita.json`);
    toast('Receita JSON exportada!');
  };

  $('btnConfirmExport').onclick = async () => {
    const src = getActiveSource();
    if (!src) return;
    const slug = (media.name || 'pixelar').replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
    const lookSlug = st.preset.id !== 'none' ? '_' + st.preset.id : '';

    if (ui.exportFmt === 'cube') {
      const lutText = window.StudioGPU.exportCubeLUT(st, `Pixelar_${st.preset.id || 'Custom'}`);
      triggerDownload(new Blob([lutText], { type: 'text/plain' }), `pixelar${lookSlug}.cube`);
      $('exportModal').hidden = true;
      toast('3D LUT (.cube) exportada!');
      return;
    }

    if (ui.exportFmt === 'video' && media.kind !== 'image') {
      stopPlayback();
      const btn = $('btnConfirmExport');
      btn.disabled = true;
      $('exportProgressWrap').hidden = false;
      $('exportProgressFill').style.width = '0%';
      $('exportProgressPct').textContent = '0%';
      $('exportProgressLabel').textContent = media.kind === 'avi' ? 'Convertendo AVI Cyber-shot...' : 'Renderizando vídeo...';
      try {
        const videoObj = media.kind === 'avi'
          ? media.avi
          : { kind: 'native', el: media.videoEl, width: media.w, height: media.h, fps: 30 };
        const res = await window.StudioVideo.exportModernVideo(
          videoObj,
          st,
          (frameSrc, fid, stateObj, targetCanvas, opts) => {
            return window.StudioGPU.renderToCanvas(frameSrc, fid, stateObj, targetCanvas, {
              ...opts,
              pool: 'main',
              isVideo: true,
              isExport: true,
            });
          },
          (p) => {
            const pct = Math.round(p * 100);
            $('exportProgressFill').style.width = pct + '%';
            $('exportProgressPct').textContent = pct + '%';
          }
        );
        triggerDownload(res.blob, `${slug}${lookSlug}.${res.ext}`);
        $('exportModal').hidden = true;
        toast(`Vídeo convertido em ${res.label}!`);
      } catch (e) {
        toast(e.message || 'Erro ao exportar vídeo');
      } finally {
        btn.disabled = false;
        $('exportProgressWrap').hidden = true;
        window.StudioGPU.invalidate();
        renderNow();
      }
      return;
    }

    // Full Original Resolution Photo Export (or current video frame still)
    const expCanvas = document.createElement('canvas');
    const maxDim = Math.max(media.w, media.h);
    const grainUnit = Math.max(1, maxDim / Math.max(1, Math.max(outCanvas.width, outCanvas.height)));
    window.StudioGPU.renderToCanvas(src, media.id + '_exp', st, expCanvas, {
      maxDim,
      pool: 'main',
      grainUnit,
      isExport: true,
      isVideo: media.kind !== 'image',
    });
    window.StudioGPU.invalidate();
    const mime = ui.exportFmt === 'jpeg' ? 'image/jpeg' : (ui.exportFmt === 'webp' ? 'image/webp' : 'image/png');
    const ext = ui.exportFmt === 'jpeg' ? 'jpg' : (ui.exportFmt === 'webp' ? 'webp' : 'png');
    const q = Math.max(0.6, Math.min(1, (ui.exportQuality || 96) / 100));
    expCanvas.toBlob(async (blob) => {
      if (!blob) return;
      if (ui.exportFmt === 'png') {
        const cleanPng = await injectPngTextChunk(blob, 'PIXELAR_STUDIO_META', JSON.stringify(st));
        triggerDownload(cleanPng, `${slug}${lookSlug}.png`);
      } else {
        triggerDownload(blob, `${slug}${lookSlug}.${ext}`);
      }
      $('exportModal').hidden = true;
      toast(`Exportado em qualidade original (${expCanvas.width}×${expCanvas.height}px)`);
    }, mime, q);
  };

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); $('fileInput').click(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') { e.preventDefault(); $('btnExport').click(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); $('btnSavePreset').click(); }
    else if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      if (media.kind !== 'image') togglePlayback();
      else setHold(true);
    }
    else if (e.key === '0') fitViewport(true);
    else if (e.key.toLowerCase() === 'f') toggleFocusMode();
    else if (e.key.toLowerCase() === 'g' && $('btnToggleStrip')) $('btnToggleStrip').click();
    else if (e.key.toLowerCase() === 'r') runProceduralRemix('studio');
    else if (e.key.toLowerCase() === 'c') {
      view.mode = view.mode === 'split' ? 'single' : 'split';
      document.querySelectorAll('.seg-btn[data-view]').forEach(x => x.classList.toggle('active', x.dataset.view === view.mode));
      fitViewport(false); requestRender();
    }
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space' && media.kind === 'image') setHold(false); });

  // =========================================================================
  // PUBLIC API / NATIVE MACOS & MOBILE BRIDGE
  // =========================================================================
  window.PixelarApp = {
    openMedia: () => $('fileInput').click(),
    openExport: () => $('btnExport').click(),
    openSavePreset: () => $('btnSavePreset').click(),
    exportRecipeJson: () => $('btnExportRecipeJson').click(),
    undo,
    redo,
    autoTone: runAutoTone,
    proceduralRemix: runProceduralRemix,
    resetAll: () => $('btnResetAll').click(),
    toggleFocus: toggleFocusMode,
    toggleStrip: () => $('btnToggleStrip') && $('btnToggleStrip').click(),
    zoomIn: () => setZoom(view.zoom * 1.25),
    zoomOut: () => setZoom(view.zoom / 1.25),
    zoomFit: () => fitViewport(true),
    setViewMode: (m) => {
      const btn = document.querySelector(`.seg-btn[data-view="${m}"]`);
      if (btn) btn.click();
    },
    selectTab: (tab) => selectToolTab(tab, false),
    notify: toast,
    getState: () => st,
    setState: (next) => { st = next; },
    render: requestRender,
    commit,
    sync: syncAllUI,
    fitViewport,
    setZoom,
    getView: () => view,
    setHoldOrig: setHold,
    setInteracting: (v) => { isInteracting = !!v; if (!v) requestRender(); },
    getMedia: () => media,
    getActiveSource,
    getSessionItems: () => [...userUploadedItems, ...(window.STUDY_SAMPLES || [])],
    loadPhotoSrc,
    getSectionRef: (key) => sectionRefs[key] || null,
    getInspectorMount: () => $('inspectorScroll'),
    renderGridOverlay,
    setGridTabActive: (on) => { ui.mobActiveTab = on ? 'crop' : 'presets'; renderGridOverlay(); },
    haptic: (style = 'selection') => {
      try {
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.pixelarHaptic) {
          window.webkit.messageHandlers.pixelarHaptic.postMessage({ style });
        }
      } catch {}
    },
    loadNativeFile: (filename, mime, base64) => {
      try {
        const bin = atob(base64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const file = new File([arr], filename, { type: mime || 'application/octet-stream' });
        loadFile(file);
      } catch (e) {
        toast('Erro ao abrir arquivo nativo: ' + (e.message || e));
      }
    },
  };

  // BOOT
  buildCollectionTabs();
  buildPresetGrid();
  buildInspector();
  buildFilmstrip();
  pushHistory();
  if (window.STUDY_SAMPLES && window.STUDY_SAMPLES.length) {
    const first = window.STUDY_SAMPLES[0];
    loadPhotoSrc(first.src, first.title, first.id);
  }
})();

