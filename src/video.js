/* ==========================================================================
   PIXELAR STUDIO — Video Engine & Sony Cyber-shot .AVI (MJPEG + PCM) Decoder
   Supports:
     - Native browser videos (MP4, MOV, WebM) rendered live through WebGL2
     - Vintage Sony Cyber-shot / digicam .AVI (RIFF MJPEG + PCM/u-law audio)
       parsed 100% locally in pure JS without server or external libraries
     - Real-time modern video export/conversion (.mp4 / .webm) with audio!
   ========================================================================== */
'use strict';

window.StudioVideo = (function () {
  function fourCC(dv, off) {
    return String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3));
  }

  // Decode standard RIFF AVI container containing Motion JPEG (MJPG/JPEG) + optional PCM audio
  async function parseAviFile(file) {
    const buf = await file.arrayBuffer();
    const dv = new DataView(buf);
    const bytes = new Uint8Array(buf);

    if (buf.byteLength < 64 || fourCC(dv, 0) !== 'RIFF' || fourCC(dv, 8) !== 'AVI ') {
      throw new Error('Arquivo AVI inválido ou cabeçalho RIFF ausente.');
    }

    let width = 640, height = 480, fps = 25, microSecPerFrame = 40000;
    let videoCodec = '';
    let audioFmt = null; // { formatTag, channels, sampleRate, bitsPerSample }
    const videoFrames = [];
    const audioChunks = [];

    function walkList(start, end) {
      let p = start;
      while (p + 8 <= end) {
        const id = fourCC(dv, p);
        const size = dv.getUint32(p + 4, true);
        const dataStart = p + 8;
        const dataEnd = Math.min(end, dataStart + size);

        if (id === 'LIST' && dataStart + 4 <= end) {
          const listType = fourCC(dv, dataStart);
          if (listType === 'hdrl' || listType === 'strl' || listType === 'movi' || listType === 'rec ') {
            walkList(dataStart + 4, dataEnd);
          }
        } else if (id === 'avih' && size >= 40) {
          microSecPerFrame = dv.getUint32(dataStart, true) || 40000;
          fps = Math.max(5, Math.min(60, Math.round((1000000 / microSecPerFrame) * 100) / 100));
          width = dv.getUint32(dataStart + 32, true) || width;
          height = dv.getUint32(dataStart + 36, true) || height;
        } else if (id === 'strh' && size >= 32) {
          const fccType = fourCC(dv, dataStart);
          const fccHandler = fourCC(dv, dataStart + 4);
          if (fccType === 'vids') {
            videoCodec = fccHandler.toUpperCase();
            const scale = dv.getUint32(dataStart + 20, true);
            const rate = dv.getUint32(dataStart + 24, true);
            if (scale > 0 && rate > 0) fps = Math.max(5, Math.min(60, rate / scale));
          }
        } else if (id === 'strf' && size >= 16) {
          // Could be BITMAPINFOHEADER (video, 40 bytes) or WAVEFORMATEX (audio, 16-18 bytes)
          const biSize = dv.getUint32(dataStart, true);
          if (biSize === 40 && size >= 40) {
            const w = dv.getInt32(dataStart + 4, true);
            const h = Math.abs(dv.getInt32(dataStart + 8, true));
            const comp = fourCC(dv, dataStart + 16).toUpperCase();
            if (w > 0 && h > 0) { width = w; height = h; }
            if (comp && comp.trim()) videoCodec = comp;
          } else if (size >= 16 && size <= 36) {
            const fmtTag = dv.getUint16(dataStart, true);
            const channels = dv.getUint16(dataStart + 2, true);
            const sampleRate = dv.getUint32(dataStart + 4, true);
            const bitsPerSample = dv.getUint16(dataStart + 14, true);
            if ((fmtTag === 1 || fmtTag === 7) && channels >= 1 && channels <= 2 && sampleRate >= 4000 && sampleRate <= 96000) {
              audioFmt = { formatTag: fmtTag, channels, sampleRate, bitsPerSample };
            }
          }
        } else if ((id.endsWith('dc') || id.endsWith('db')) && size > 16) {
          // Video frame chunk — check JPEG SOI marker (0xFF 0xD8)
          if (bytes[dataStart] === 0xFF && bytes[dataStart + 1] === 0xD8) {
            videoFrames.push(new Blob([bytes.subarray(dataStart, dataEnd)], { type: 'image/jpeg' }));
          } else {
            // Sometimes MJPEG AVI has a small header before SOI; scan first 64 bytes
            let soi = -1;
            const scanEnd = Math.min(dataEnd - 1, dataStart + 64);
            for (let k = dataStart; k < scanEnd; k++) {
              if (bytes[k] === 0xFF && bytes[k + 1] === 0xD8) { soi = k; break; }
            }
            if (soi >= 0) {
              videoFrames.push(new Blob([bytes.subarray(soi, dataEnd)], { type: 'image/jpeg' }));
            }
          }
        } else if (id.endsWith('wb') && size > 0) {
          audioChunks.push(bytes.subarray(dataStart, dataEnd));
        }

        // RIFF chunks are 2-byte aligned
        p = dataStart + size + (size & 1);
      }
    }

    walkList(12, buf.byteLength);

    if (!videoFrames.length) {
      throw new Error(
        `Este .AVI usa o codec "${videoCodec || 'desconhecido'}" (não é Motion-JPEG de Cyber-shot). ` +
        `Converta para MP4 ou use um AVI MJPEG (Sony Cyber-shot / câmeras compactas).`
      );
    }

    // Build AudioBuffer from PCM / mu-law audio chunks if present
    let audioBuffer = null;
    if (audioFmt && audioChunks.length) {
      try {
        const totalBytes = audioChunks.reduce((acc, c) => acc + c.byteLength, 0);
        const merged = new Uint8Array(totalBytes);
        let off = 0;
        for (const c of audioChunks) { merged.set(c, off); off += c.byteLength; }

        const bytesPerSample = audioFmt.formatTag === 7 ? 1 : Math.max(1, audioFmt.bitsPerSample >> 3);
        const sampleCount = Math.floor(totalBytes / (bytesPerSample * audioFmt.channels));
        if (sampleCount > 0) {
          const AC = window.AudioContext || window.webkitAudioContext;
          const actx = new AC();
          audioBuffer = actx.createBuffer(audioFmt.channels, sampleCount, audioFmt.sampleRate);
          const mdv = new DataView(merged.buffer);
          for (let ch = 0; ch < audioFmt.channels; ch++) {
            const out = audioBuffer.getChannelData(ch);
            for (let i = 0; i < sampleCount; i++) {
              const byteIdx = (i * audioFmt.channels + ch) * bytesPerSample;
              if (audioFmt.formatTag === 7) {
                // ITU-T G.711 u-law decode
                const u = ~merged[byteIdx] & 0xFF;
                const sign = (u & 0x80) ? -1 : 1;
                const exp = (u >> 4) & 0x07;
                const man = u & 0x0F;
                const sample = (((man << 3) + 0x84) << exp) - 0x84;
                out[i] = (sign * sample) / 32768;
              } else if (bytesPerSample === 1) {
                out[i] = (merged[byteIdx] - 128) / 128;
              } else {
                out[i] = mdv.getInt16(byteIdx, true) / 32768;
              }
            }
          }
          actx.close().catch(() => {});
        }
      } catch (e) {
        console.warn('[StudioVideo] Áudio AVI ignorado:', e);
      }
    }

    return {
      kind: 'avi',
      codec: videoCodec || 'MJPG',
      width,
      height,
      fps,
      frames: videoFrames,
      duration: videoFrames.length / fps,
      audioBuffer,
    };
  }

  // Decode a single AVI JPEG Blob into an ImageBitmap / HTMLImageElement
  async function decodeBlobToImage(blob) {
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(blob); } catch {}
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  // Pick the best modern video container supported by the user's browser (MP4 H.264 preferred, fallback WebM VP9/VP8)
  function pickModernMime() {
    if (typeof MediaRecorder === 'undefined') return null;
    const candidates = [
      { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4', label: 'MP4 (H.264)' },
      { mime: 'video/mp4', ext: 'mp4', label: 'MP4' },
      { mime: 'video/webm;codecs=vp9,opus', ext: 'webm', label: 'WebM (VP9)' },
      { mime: 'video/webm;codecs=vp8,opus', ext: 'webm', label: 'WebM (VP8)' },
      { mime: 'video/webm', ext: 'webm', label: 'WebM' },
    ];
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c.mime)) return c;
    }
    return { mime: '', ext: 'webm', label: 'WebM' };
  }

  // Export & Convert Video (both native MP4/MOV/WebM AND Cyber-shot .AVI) with live GPU effects + audio!
  async function exportModernVideo(videoObj, st, renderFrameFn, onProgress) {
    const fmt = pickModernMime();
    if (!fmt) throw new Error('Seu navegador não suporta gravação de vídeo (MediaRecorder). Use Chrome, Edge ou Safari recente.');

    const expCanvas = document.createElement('canvas');
    const fps = Math.round(videoObj.fps || 30);
    const maxDim = Math.max(videoObj.width, videoObj.height);

    // Prepare canvas size with first frame
    if (videoObj.kind === 'avi') {
      const firstBmp = await decodeBlobToImage(videoObj.frames[0]);
      renderFrameFn(firstBmp, 'vexp_0', st, expCanvas, { maxDim, isExport: true });
      if (firstBmp.close) firstBmp.close();
    } else {
      renderFrameFn(videoObj.el, 'vexp_0', st, expCanvas, { maxDim, isExport: true });
    }

    const stream = expCanvas.captureStream(fps);
    let audioCtx = null;
    let audioSrc = null;

    if (videoObj.kind === 'avi' && videoObj.audioBuffer) {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
      const dest = audioCtx.createMediaStreamDestination();
      audioSrc = audioCtx.createBufferSource();
      audioSrc.buffer = videoObj.audioBuffer;
      audioSrc.connect(dest);
      dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    } else if (videoObj.kind === 'native' && videoObj.el && typeof videoObj.el.captureStream === 'function') {
      try {
        const vStream = videoObj.el.captureStream();
        vStream.getAudioTracks().forEach(t => stream.addTrack(t));
      } catch {}
    }

    const opts = fmt.mime ? { mimeType: fmt.mime, videoBitsPerSecond: 8000000 } : { videoBitsPerSecond: 8000000 };
    const recorder = new MediaRecorder(stream, opts);
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

    const done = new Promise((resolve) => {
      recorder.onstop = () => {
        if (audioCtx) audioCtx.close().catch(() => {});
        resolve({ blob: new Blob(chunks, { type: fmt.mime || 'video/webm' }), ext: fmt.ext, label: fmt.label });
      };
    });

    recorder.start();
    if (audioSrc) audioSrc.start(0);

    if (videoObj.kind === 'avi') {
      const frameMs = 1000 / (videoObj.fps || 25);
      const total = videoObj.frames.length;
      const tStart = performance.now();
      for (let i = 0; i < total; i++) {
        const bmp = await decodeBlobToImage(videoObj.frames[i]);
        renderFrameFn(bmp, 'vexp_' + i, st, expCanvas, { maxDim, isExport: true });
        if (bmp.close) bmp.close();
        if (onProgress) onProgress((i + 1) / total);
        const target = tStart + (i + 1) * frameMs;
        const wait = target - performance.now();
        if (wait > 2) await new Promise(r => setTimeout(r, wait));
      }
    } else {
      const v = videoObj.el;
      const prevMuted = v.muted;
      const prevLoop = v.loop;
      v.loop = false;
      v.muted = true;
      v.currentTime = 0;
      await v.play();
      await new Promise((resolve) => {
        const pump = () => {
          if (v.ended || v.paused) { resolve(); return; }
          renderFrameFn(v, 'vexp_' + v.currentTime, st, expCanvas, { maxDim, isExport: true });
          if (onProgress && v.duration) onProgress(Math.min(0.99, v.currentTime / v.duration));
          requestAnimationFrame(pump);
        };
        v.onended = () => resolve();
        requestAnimationFrame(pump);
      });
      v.muted = prevMuted;
      v.loop = prevLoop;
    }

    recorder.stop();
    if (onProgress) onProgress(1);
    return done;
  }

  return { parseAviFile, decodeBlobToImage, pickModernMime, exportModernVideo };
})();

