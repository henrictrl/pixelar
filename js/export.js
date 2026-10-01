/* Pixelar — exportação: PNG/JPEG/WebP (com configurações embutidas), SVG,
 * configurações (.txt), animação em loop (MP4/WebM/GIF) e vídeo (MP4/WebM/GIF).
 * Toda função recebe o estado e a mídia explicitamente e informa o progresso
 * por callback: job.progress(0..1, canvasDoQuadro) — a interface mostra o quadro.
 */
'use strict';

const Exporter = (() => {
    const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    function download(blob, name) {
        if (typeof window.__pixelarDownloadHook === 'function' && window.__pixelarDownloadHook(blob, name)) return;
        const url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = name; a.style.display = 'none'; document.body.appendChild(a);
        try { a.click(); } catch (e) { window.open(url, '_blank'); }
        a.remove(); setTimeout(() => URL.revokeObjectURL(url), 20000);
    }
    const metaString = (st) => 'PIXELAR_META:' + JSON.stringify(st);

    // renderiza a imagem na resolução pedida (null = tela) e recorta a área transparente
    function renderStill(st, media, res, key) {
        const c = document.createElement('canvas'), out = { canvas: c, ctx: c.getContext('2d') };
        const r = Engine.render(st, { media, key, out, targetRes: res || null, maxDim: res ? null : 4096 });
        if (!r) return null;
        if (st.pixel.scale >= 100) return c;
        const t = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
        let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (t[(y * c.width + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        if (x1 < 0) return null;
        const k = document.createElement('canvas'); k.width = x1 - x0 + 1; k.height = y1 - y0 + 1;
        k.getContext('2d').drawImage(c, x0, y0, k.width, k.height, 0, 0, k.width, k.height);
        return k;
    }

    async function image(st, media, { res, format = 'png', quality = 0.92, key } = {}) {
        const c = renderStill(st, media, res, key); if (!c) throw new Error('Imagem vazia');
        const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
        let blob = await new Promise(r => c.toBlob(r, mime, quality));
        if (!blob) throw new Error('O navegador não gerou a imagem');
        if (format === 'png') blob = new Blob([blob, new TextEncoder().encode(metaString(st))], { type: 'image/png' });
        download(blob, `pixelar_${stamp()}.${format === 'jpeg' ? 'jpg' : format}`);
        return blob;
    }

    async function svg(st, media, { res, key } = {}) {
        const c = renderStill(st, media, res, key); if (!c) throw new Error('Imagem vazia');
        const w = c.width, h = c.height, d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
        const parts = [`<?xml version="1.0" encoding="utf-8"?>\n<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">`];
        for (let y = 0; y < h; y++) {
            let start = 0, cur = null;
            for (let x = 0; x <= w; x++) {
                const i = (y * w + x) * 4; let hex = x < w && d[i + 3] >= 127 ? rgbToHex(d[i], d[i + 1], d[i + 2]) : null;
                if (x === 0) { cur = hex; continue; }
                if (hex !== cur || x === w) { if (cur) parts.push(`<rect x="${start}" y="${y}" width="${x - start}" height="1" fill="${cur}"/>`); start = x; cur = hex; }
            }
        }
        parts.push('</svg>');
        const blob = new Blob([parts.join('\n')], { type: 'image/svg+xml;charset=utf-8' });
        download(blob, `pixelar_vetor_${stamp()}.svg`); return blob;
    }

    function config(st) { const blob = new Blob([metaString(st)], { type: 'text/plain' }); download(blob, 'pixelar_config.txt'); return blob; }

    const bitrateFor = (h, fps) => Math.round(Math.min(Math.max((h || 1080) * (h || 1080) * (16 / 9) * fps * 0.15, 6e6), 60e6));

    // ---------- animação em loop a partir de imagem ----------
    async function animation(st, media, job) {
        const cfg = readAnim(st, job.format), s = Engine.readSettings(st);
        if (!describeAnimation(s, cfg).length) throw new Error('Nada para animar: ligue um padrão, filme, grão ou movimento.');
        const repeat = job.format === 'gif' ? 1 : (job.repeat || 1);
        const frameCanvas = document.createElement('canvas'), out = { canvas: frameCanvas, ctx: frameCanvas.getContext('2d', { willReadFrequently: job.format === 'gif' }) };
        const renderAt = (i) => { const o = animFrameOptions(i, cfg, s); return Engine.render(st, Object.assign({ media, key: job.key, out, targetRes: job.res || null, maxDim: job.res ? null : 1600 }, o)); };
        if (job.format === 'gif') return gifFrom(st, cfg.frames, cfg.fps, renderAt, frameCanvas, job, 'pixelar_loop');
        return encodeFrames(cfg.frames * repeat, cfg.fps, (k) => renderAt(k % cfg.frames), frameCanvas, job, 'pixelar_loop', null, (k) => k % cfg.frames === 0, st);
    }

    // codifica N quadros com WebCodecs (mediabunny); cai para MediaRecorder se preciso
    async function encodeFrames(total, fps, renderAt, frameCanvas, job, prefix, audio, isKey, st) {
        let MB = null; try { MB = await Media.loadMediabunny(); } catch (e) { MB = null; }
        const r0 = renderAt(0); if (!r0) throw new Error('Falha ao renderizar');
        const W = Media.evenDim(r0.W), H = Media.evenDim(r0.H);
        const bg = st.bg.fill ? st.bg.color : '#000000';
        if (MB) {
            const outFmt = job.format === 'webm' ? new MB.WebMOutputFormat() : new MB.Mp4OutputFormat({ fastStart: 'in-memory' });
            const bitrate = Math.min(80e6, Math.max(8e6, bitrateFor(H, fps) * 1.5));
            const vcodec = await Media.pickVideoCodec(MB, outFmt, W, H, bitrate, fps);
            if (vcodec) {
                const enc = document.createElement('canvas'); enc.width = W; enc.height = H; const ectx = enc.getContext('2d');
                const output = new MB.Output({ format: outFmt, target: new MB.BufferTarget() });
                const vsrc = new MB.CanvasSource(enc, Object.assign({ codec: vcodec, quality: new MB.Quality({ bitrate, bitrateMode: 'variable' }), keyFrameInterval: 2 }, Media.encExtra()));
                output.addVideoTrack(vsrc, { frameRate: fps });
                let audioTask = null;
                if (audio) { const a = await audio(MB, outFmt, output); audioTask = a; }
                await output.start();
                if (audioTask) audioTask = audioTask();
                for (let k = 0; k < total; k++) {
                    if (job.cancelled) { try { await output.cancel(); } catch (e) {} throw new Error('cancelado'); }
                    if (k > 0 && !renderAt(k)) continue;
                    ectx.fillStyle = bg; ectx.fillRect(0, 0, W, H); ectx.drawImage(frameCanvas, 0, 0, W, H, 0, 0, W, H);
                    // vigia: se o codificador do navegador travar, grava pelo caminho alternativo em vez de ficar parado
                    const ok = await Promise.race([vsrc.add(k / fps, 1 / fps, isKey ? { keyFrame: isKey(k) } : undefined).then(() => true), new Promise(r => setTimeout(() => r(false), 15000))]);
                    if (!ok) { try { await output.cancel(); } catch (e) {} if (audio) throw new Error('O codificador de vídeo do navegador travou. Tente WebM ou GIF.'); return recordRealtime(total, fps, renderAt, frameCanvas, job, prefix); }
                    if (k % 2 === 0) job.progress(k / total, enc);
                }
                if (audioTask) await audioTask;
                await output.finalize();
                const blob = new Blob([output.target.buffer], { type: outFmt.mimeType });
                download(blob, `${prefix}_${stamp()}${outFmt.fileExtension}`); return blob;
            }
        }
        return recordRealtime(total, fps, renderAt, frameCanvas, job, prefix);
    }

    // sem WebCodecs: pré-renderiza em PNG e grava em tempo real com MediaRecorder
    async function recordRealtime(total, fps, renderAt, frameCanvas, job, prefix) {
        const types = job.format === 'mp4' ? ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'] : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
        const mime = typeof MediaRecorder !== 'undefined' ? types.find(t => MediaRecorder.isTypeSupported(t)) : '';
        if (!mime) throw new Error('Este navegador não grava vídeo');
        const frames = [];
        for (let k = 0; k < total; k++) {
            if (job.cancelled) throw new Error('cancelado');
            renderAt(k); frames.push(await new Promise(r => frameCanvas.toBlob(r, 'image/png')));
            job.progress(0.5 * k / total, frameCanvas);
        }
        const rec = document.createElement('canvas'); rec.width = frameCanvas.width; rec.height = frameCanvas.height; const rctx = rec.getContext('2d');
        const stream = rec.captureStream(fps), chunks = [];
        const mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrateFor(rec.height, fps) });
        mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
        const done = new Promise(res => { mr.onstop = res; });
        mr.start(500);
        const t0 = performance.now(), interval = 1000 / fps;
        for (let k = 0; k < frames.length; k++) {
            if (job.cancelled) { mr.stop(); throw new Error('cancelado'); }
            const bmp = await createImageBitmap(frames[k]); rctx.drawImage(bmp, 0, 0); bmp.close();
            job.progress(0.5 + 0.5 * k / frames.length, rec);
            await new Promise(r => setTimeout(r, Math.max(0, t0 + (k + 1) * interval - performance.now())));
        }
        mr.requestData(); await new Promise(r => setTimeout(r, 250)); mr.stop(); await done;
        const blob = new Blob(chunks, { type: mr.mimeType || mime });
        download(blob, `${prefix}_${stamp()}.${(mr.mimeType || mime).includes('mp4') ? 'mp4' : 'webm'}`); return blob;
    }

    // ---------- GIF (paleta global, LZW em workers) ----------
    const GIF_WORKER_SRC = `
    const stamp = new Int32Array(4096 * 256), codes = new Int16Array(4096 * 256);
    let gen = 1, lut = null, lutId = -1;
    const B4 = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
    function lzw(px, minSize) {
        const clear = 1 << minSize, eoi = clear + 1;
        let size = minSize + 1, next = eoi + 1, buf = 0, bits = 0, len = 0;
        let out = new Uint8Array(Math.max(1024, px.length >> 1));
        const put = (b) => { if (len >= out.length) { const o = new Uint8Array(out.length * 2); o.set(out); out = o; } out[len++] = b; };
        const emit = (c) => { buf |= c << bits; bits += size; while (bits >= 8) { put(buf & 255); buf >>>= 8; bits -= 8; } };
        gen++; emit(clear);
        let prefix = px[0];
        for (let i = 1; i < px.length; i++) {
            const k = px[i], key = (prefix << 8) | k;
            if (stamp[key] === gen) { prefix = codes[key]; continue; }
            emit(prefix);
            if (next < 4096) { if (next >= (1 << size)) size++; stamp[key] = gen; codes[key] = next++; }
            else { emit(clear); gen++; size = minSize + 1; next = eoi + 1; }
            prefix = k;
        }
        emit(prefix); emit(eoi); if (bits > 0) put(buf & 255);
        return out.subarray(0, len);
    }
    self.onmessage = (e) => {
        const { id, data, w, h, pal, palId, exact, trans, minSize } = e.data;
        const n = pal.length / 3;
        if (palId !== lutId) { lutId = palId; lut = exact ? new Map() : new Int16Array(262144).fill(-1); if (exact) for (let i = 0; i < n; i++) lut.set((pal[i*3] << 16) | (pal[i*3+1] << 8) | pal[i*3+2], i); }
        const idx = new Uint8Array(w * h);
        for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p++) {
            const o = p * 4;
            if (trans >= 0 && data[o + 3] < 128) { idx[p] = trans; continue; }
            let r = data[o], g = data[o + 1], b = data[o + 2];
            if (exact) { const v = lut.get((r << 16) | (g << 8) | b); if (v !== undefined) { idx[p] = v; continue; } }
            else { const t = (B4[(y & 3) * 4 + (x & 3)] / 16 - 0.47) * 6; r = Math.max(0, Math.min(255, r + t)); g = Math.max(0, Math.min(255, g + t)); b = Math.max(0, Math.min(255, b + t)); }
            const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
            let c = exact ? -1 : lut[key];
            if (c < 0) {
                let best = 1e9; const rr = exact ? r : (r >> 2) * 4 + 2, gg = exact ? g : (g >> 2) * 4 + 2, bb = exact ? b : (b >> 2) * 4 + 2;
                for (let i = 0; i < n; i++) { if (i === trans) continue; const dr = pal[i*3] - rr, dg = pal[i*3+1] - gg, db = pal[i*3+2] - bb; const d = dr*dr*2 + dg*dg*3 + db*db; if (d < best) { best = d; c = i; } }
                if (exact) lut.set((r << 16) | (g << 8) | b, c); else lut[key] = c;
            }
            idx[p] = c;
        }
        const out = lzw(idx, minSize), copy = new Uint8Array(out);
        self.postMessage({ id, bytes: copy }, [copy.buffer]);
    };`;
    function buildGifPalette(samples) {
        const exactMap = new Map(); let exact = true, hasTrans = false; const hist = new Uint32Array(262144);
        for (const d of samples) for (let o = 0; o < d.length; o += 4) {
            if (d[o + 3] < 128) { hasTrans = true; continue; }
            const rgb = (d[o] << 16) | (d[o + 1] << 8) | d[o + 2];
            if (exact && !exactMap.has(rgb)) { exactMap.set(rgb, 1); if (exactMap.size > 256) exact = false; }
            hist[((d[o] >> 2) << 12) | ((d[o + 1] >> 2) << 6) | (d[o + 2] >> 2)]++;
        }
        const maxColors = hasTrans ? 255 : 256; let colors;
        if (exact && exactMap.size <= maxColors) colors = [...exactMap.keys()].map(v => [v >> 16, (v >> 8) & 255, v & 255]);
        else {
            exact = false; const pts = [];
            for (let k = 0; k < hist.length; k++) if (hist[k]) pts.push({ r: (k >> 12) * 4 + 2, g: ((k >> 6) & 63) * 4 + 2, b: (k & 63) * 4 + 2, n: hist[k] });
            const makeBox = (arr) => { let lr = 255, lg = 255, lb = 255, hr = 0, hg = 0, hb = 0, cnt = 0; for (const p of arr) { if (p.r < lr) lr = p.r; if (p.r > hr) hr = p.r; if (p.g < lg) lg = p.g; if (p.g > hg) hg = p.g; if (p.b < lb) lb = p.b; if (p.b > hb) hb = p.b; cnt += p.n; } const rr = hr - lr, rg = (hg - lg) * 1.2, rb = (hb - lb) * 0.8; const axis = rr >= rg && rr >= rb ? 'r' : rg >= rb ? 'g' : 'b'; return { arr, cnt, axis, score: arr.length < 2 ? -1 : Math.max(rr, rg, rb) * Math.sqrt(cnt) }; };
            const boxes = [makeBox(pts)];
            while (boxes.length < maxColors) {
                let bi = -1; for (let i = 0; i < boxes.length; i++) if (boxes[i].score > 0 && (bi < 0 || boxes[i].score > boxes[bi].score)) bi = i;
                if (bi < 0) break;
                const { arr, cnt, axis } = boxes[bi]; arr.sort((p, q) => p[axis] - q[axis]);
                let acc = 0, cut = 1; for (; cut < arr.length - 1; cut++) { acc += arr[cut - 1].n; if (acc >= cnt / 2) break; }
                boxes.splice(bi, 1, makeBox(arr.slice(0, cut)), makeBox(arr.slice(cut)));
            }
            colors = boxes.filter(b => b.arr.length).map(({ arr }) => { let r = 0, g = 0, b = 0, n = 0; for (const p of arr) { r += p.r * p.n; g += p.g * p.n; b += p.b * p.n; n += p.n; } return [Math.round(r / n), Math.round(g / n), Math.round(b / n)]; });
        }
        const trans = hasTrans ? colors.length : -1; if (hasTrans) colors.push([0, 0, 0]);
        let bitsN = 1; while ((1 << bitsN) < colors.length) bitsN++;
        const pal = new Uint8Array(colors.length * 3); colors.forEach((c, i) => pal.set(c, i * 3));
        return { pal, exact, trans, bitsN, minSize: Math.max(2, bitsN) };
    }
    function assembleGif(w, h, P, frames, delays) {
        const parts = [], u8 = (a) => parts.push(new Uint8Array(a)), le = (v) => [v & 255, (v >> 8) & 255];
        u8([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...le(w), ...le(h), 0xF0 | (P.bitsN - 1), 0, 0]);
        const table = new Uint8Array(3 << P.bitsN); table.set(P.pal); parts.push(table);
        u8([0x21, 0xFF, 0x0B, ...'NETSCAPE2.0'.split('').map(c => c.charCodeAt(0)), 0x03, 0x01, 0, 0, 0]);
        frames.forEach((bytes, i) => {
            const disposal = P.trans >= 0 ? 2 : 1;
            u8([0x21, 0xF9, 0x04, (disposal << 2) | (P.trans >= 0 ? 1 : 0), ...le(delays[i]), Math.max(0, P.trans), 0]);
            u8([0x2C, 0, 0, 0, 0, ...le(w), ...le(h), 0, P.minSize]);
            for (let o = 0; o < bytes.length; o += 255) { const n = Math.min(255, bytes.length - o); parts.push(new Uint8Array([n])); parts.push(bytes.subarray(o, o + n)); }
            u8([0]);
        });
        u8([0x3B]);
        return new Blob(parts, { type: 'image/gif' });
    }
    // renderAt(i) desenha o quadro i em frameCanvas (pode ser assíncrono)
    async function gifFrom(st, N, fps, renderAt, frameCanvas, job, prefix) {
        const r0 = await renderAt(0); if (!r0) throw new Error('Falha ao renderizar');
        const W = frameCanvas.width, H = frameCanvas.height;
        const gctx = frameCanvas.getContext('2d', { willReadFrequently: true });
        const grab = () => gctx.getImageData(0, 0, W, H).data;
        const sIdx = [...new Set(Array.from({ length: Math.min(12, N) }, (_, k) => Math.floor(k * N / Math.min(12, N))))];
        const samples = []; for (const i of sIdx) { await renderAt(i); samples.push(grab()); }
        const P = buildGifPalette(samples); job.progress(0.05, frameCanvas);
        const url = URL.createObjectURL(new Blob([GIF_WORKER_SRC], { type: 'text/javascript' }));
        const nW = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
        const workers = Array.from({ length: nW }, () => new Worker(url)), results = new Array(N), waiting = new Map();
        workers.forEach(wk => { wk.onmessage = (e) => { results[e.data.id] = e.data.bytes; waiting.get(e.data.id)(); waiting.delete(e.data.id); }; });
        let done = 0;
        try {
            const inflight = [];
            for (let i = 0; i < N; i++) {
                if (job.cancelled) throw new Error('cancelado');
                await renderAt(i); const data = grab();
                const p = new Promise(res => waiting.set(i, () => { done++; job.progress(0.05 + 0.9 * done / N, frameCanvas); res(); }));
                workers[i % nW].postMessage({ id: i, data, w: W, h: H, pal: P.pal, palId: 1, exact: P.exact, trans: P.trans, minSize: P.minSize }, [data.buffer]);
                inflight.push(p); if (inflight.length >= nW * 2) await inflight.shift();
            }
            await Promise.all(inflight);
        } finally { workers.forEach(wk => wk.terminate()); URL.revokeObjectURL(url); }
        const delays = Array.from({ length: N }, (_, i) => Math.round((i + 1) * 100 / fps) - Math.round(i * 100 / fps));
        const blob = assembleGif(W, H, P, results, delays);
        download(blob, `${prefix}_${stamp()}.gif`); return blob;
    }

    // ---------- vídeo ----------
    // job: { format: mp4|webm|gif, fps, res, progress, cancelled, withAnim }
    // Áudio em camadas: o decodificador do WebCodecs do Safari falha com alguns arquivos
    // ("internal audio decoder error"), e isso derrubava a exportação inteira.
    // 1) WebCodecs (rápido, em fluxo) → 2) Web Audio (outro motor; decodifica o arquivo inteiro) → 3) sem som, com aviso.
    async function decodeWithWebAudio(blob) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
        const ctx = new AC();
        try {
            const data = await blob.arrayBuffer();
            return await new Promise((res, rej) => { const p = ctx.decodeAudioData(data, res, rej); if (p && p.then) p.then(res, rej); });
        } catch (e) { console.warn('[Pixelar] Web Audio também não leu o áudio:', e); return null; }
        finally { try { ctx.close(); } catch (e) {} }
    }
    // pedaço [from, to) segundos de um AudioBuffer, em blocos de 1 s (memória baixa no encoder)
    async function feedAudioBuffer(asrc, ab, from, to, job) {
        const sr = ab.sampleRate, ch = ab.numberOfChannels, a = Math.max(0, Math.floor(from * sr)), b = Math.min(ab.length, Math.floor(to * sr));
        for (let off = a; off < b; off += sr) {
            if (job.cancelled) return;
            const len = Math.min(sr, b - off), piece = new AudioBuffer({ length: len, numberOfChannels: ch, sampleRate: sr });
            for (let c = 0; c < ch; c++) piece.copyToChannel(ab.getChannelData(c).subarray(off, off + len), c);
            await asrc.add(piece);
        }
    }
    async function video(st, videoBlob, job) {
        try { return await videoInner(st, videoBlob, job); }
        catch (e) {
            // erro ligado ao áudio no meio do caminho: refaz sem som em vez de perder a exportação
            if (!job.mute && !job.cancelled && /audio|áudio|decod|AudioDecoder|AudioEncoder/i.test(String(e && (e.message || e)))) {
                console.warn('[Pixelar] exportando sem som depois de falha no áudio:', e);
                job.audioDropped = true;
                return await videoInner(st, videoBlob, Object.assign(job, { mute: true }));
            }
            throw e;
        }
    }
    async function videoInner(st, videoBlob, job) {
        const MB = await Media.loadMediabunny().catch(() => null);
        if (!MB) throw new Error('Exportar vídeo precisa de WebCodecs (Chrome, Edge ou Safari 17+)');
        const input = new MB.Input({ source: new MB.BlobSource(videoBlob), formats: [MB.MP4, MB.QTFF, MB.MATROSKA, MB.WEBM] });
        const vt = await input.getPrimaryVideoTrack();
        if (!vt || !(await vt.canDecode())) throw new Error('Sem decodificador para este vídeo');
        const t0 = await vt.getFirstTimestamp(), end = await vt.computeDuration();
        let fps = job.fps; if (job.format === 'gif') fps = Math.min(fps, 25);
        let tEnd = end; if (job.format === 'gif') tEnd = Math.min(end, t0 + (job.maxSeconds || 15));
        if (job.trim) { tEnd = Math.min(tEnd, t0 + job.trim[1]); }
        const tStart = job.trim ? t0 + job.trim[0] : t0;
        const N = Math.max(1, Math.round((tEnd - tStart) * fps));
        const sink = new MB.CanvasSink(vt, { poolSize: 2 });
        const s = Engine.readSettings(st), cfg = readAnim(st), animOn = job.withAnim && describeAnimation(s, cfg).length > 0;
        const frameCanvas = document.createElement('canvas'), out = { canvas: frameCanvas, ctx: frameCanvas.getContext('2d', { willReadFrequently: job.format === 'gif' }) };
        let last = null;
        const renderWith = (media, i) => Engine.render(st, Object.assign({ media, key: null, out, targetRes: job.res, grainSeed: i / fps }, animOn ? animFrameOptions(i, cfg, s) : {}));
        if (job.format === 'gif') {
            const times = Array.from({ length: N }, (_, i) => tStart + (i + 0.5) / fps);
            const renderAt = async (i) => { const wc = await sink.getCanvas(times[i]); if (wc) last = wc.canvas; return last ? renderWith(last, i) : null; };
            return gifFrom(st, N, fps, renderAt, frameCanvas, job, 'pixelar_video');
        }
        const first = await sink.getCanvas(tStart + 0.5 / fps); if (!first) throw new Error('Vídeo sem quadros');
        last = first.canvas;
        const r0 = renderWith(last, 0); const W = Media.evenDim(r0.W), H = Media.evenDim(r0.H);
        const enc = document.createElement('canvas'); enc.width = W; enc.height = H; const ectx = enc.getContext('2d');
        const outFmt = job.format === 'webm' ? new MB.WebMOutputFormat() : new MB.Mp4OutputFormat({ fastStart: 'in-memory' });
        const bitrate = bitrateFor(job.res, fps);
        const vcodec = await Media.pickVideoCodec(MB, outFmt, W, H, bitrate, fps); if (!vcodec) throw new Error('Sem codificador de vídeo para ' + job.format);
        const output = new MB.Output({ format: outFmt, target: new MB.BufferTarget() });
        const vsrc = new MB.CanvasSource(enc, Object.assign({ codec: vcodec, quality: new MB.Quality({ bitrate, bitrateMode: 'variable' }), keyFrameInterval: 2 }, Media.encExtra()));
        output.addVideoTrack(vsrc, { frameRate: fps });
        let asrc = null, at = null, audioTask = null, plan = null, waBuffer = null, aFirst = 0;
        if (!job.mute) try {
            at = await input.getPrimaryAudioTrack();
            if (at) {
                aFirst = await at.getFirstTimestamp().catch(() => 0);
                // 1) o WebCodecs consegue decodificar? (testa meio segundo antes de começar)
                if (await at.canDecode().catch(() => false)) {
                    try { if (window.__pixelarAudioFail === 'start') throw new DOMException('Internal audio decoder error (teste)', 'EncodingError'); for await (const wb of new MB.AudioBufferSink(at).buffers(tStart, Math.min(tEnd, tStart + 0.5))) { wb && 0; } plan = 'webcodecs'; }
                    catch (e) { console.warn('[Pixelar] WebCodecs não decodifica este áudio:', e); }
                }
                // 2) senão, Web Audio
                if (!plan) { waBuffer = await decodeWithWebAudio(videoBlob); if (waBuffer) plan = 'webaudio'; }
                if (plan) {
                    const srcCh = plan === 'webaudio' ? waBuffer.numberOfChannels : await at.getNumberOfChannels(), srcRate = plan === 'webaudio' ? waBuffer.sampleRate : await at.getSampleRate();
                    const ch = Math.min(2, srcCh), ac = await Media.pickAudioCodec(MB, outFmt, ch, srcRate);
                    if (ac) { const aStart = Math.max(0, aFirst - tStart); asrc = new MB.AudioBufferSource({ codec: ac.codec, quality: new MB.Quality({ bitrate: 192000 }), transform: Object.assign({ numberOfChannels: ch }, ac.transform) }, { startTimestamp: aStart }); output.addAudioTrack(asrc); }
                }
                if (!asrc) job.audioDropped = true;   // 3) sem som, mas o vídeo sai
            }
        } catch (e) { console.warn('[Pixelar] áudio ignorado:', e); asrc = null; job.audioDropped = true; }
        await output.start();
        if (asrc) audioTask = (async () => {
            const from = Math.max(tStart, aFirst);
            if (plan === 'webaudio') return feedAudioBuffer(asrc, waBuffer, from - aFirst, tEnd - aFirst, job);   // o buffer do Web Audio começa no 1º som
            let added = 0;
            try {
                for await (const wb of new MB.AudioBufferSink(at).buffers(tStart, tEnd)) { if (job.cancelled) break; await asrc.add(wb.buffer); added += wb.buffer.duration; if (window.__pixelarAudioFail === 'mid' && added > 1) throw new DOMException('Internal audio decoder error (teste)', 'EncodingError'); }
            } catch (e) {
                // o decodificador caiu no meio: continua do ponto em que parou pelo Web Audio
                console.warn('[Pixelar] WebCodecs falhou no meio do áudio; seguindo pelo Web Audio:', e);
                const ab = waBuffer || await decodeWithWebAudio(videoBlob);
                if (!ab) throw new Error('áudio: não foi possível decodificar');
                await feedAudioBuffer(asrc, ab, from + added - aFirst, tEnd - aFirst, job);
            }
        })();
        const times = function* () { for (let i = 0; i < N; i++) yield tStart + (i + 0.5) / fps; };
        let i = 0;
        for await (const wc of sink.canvasesAtTimestamps(times())) {
            if (job.cancelled) { try { await output.cancel(); } catch (e) {} throw new Error('cancelado'); }
            if (wc) last = wc.canvas;
            renderWith(last, i);
            ectx.drawImage(frameCanvas, 0, 0, W, H, 0, 0, W, H);
            const ok = await Promise.race([vsrc.add(i / fps, 1 / fps).then(() => true), new Promise(r => setTimeout(() => r(false), 15000))]);
            if (!ok) { try { await output.cancel(); } catch (e) {} throw new Error('O codificador de vídeo do navegador travou. Tente WebM ou GIF.'); }
            i++;
            if (i % 2 === 0) job.progress(i / N, enc);
        }
        if (audioTask) await audioTask;
        await output.finalize();
        const blob = new Blob([output.target.buffer], { type: outFmt.mimeType });
        download(blob, `pixelar_video_${stamp()}${outFmt.fileExtension}`);
        return { blob, hasAudio: !!asrc, audioDropped: !!job.audioDropped };
    }

    return { image, svg, config, animation, video, download };
})();
