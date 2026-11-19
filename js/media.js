/* Pixelar — abertura de vídeos (nativos, AVI/MJPEG e FFmpeg) e bibliotecas sob demanda.
 * Nada aqui é baixado na abertura do app: mediabunny e FFmpeg só carregam
 * quando um vídeo precisa ser convertido ou exportado.
 */
'use strict';

const Media = (() => {
    let mbPromise = null;
    function loadMediabunny() {
        if (window.Mediabunny) return Promise.resolve(window.Mediabunny);
        if (!mbPromise) {
            mbPromise = new Promise((res, rej) => {
                if (typeof VideoEncoder === 'undefined') { rej(new Error('WebCodecs indisponível')); return; }
                const s = document.createElement('script'); s.src = 'vendor/mediabunny.js?v=' + (window.PIXELAR_V || ''); s.async = true;
                s.onload = () => window.Mediabunny ? res(window.Mediabunny) : rej(new Error('mediabunny não carregou'));
                s.onerror = () => rej(new Error('mediabunny não carregou'));
                document.head.appendChild(s);
            });
            mbPromise.catch(() => { mbPromise = null; });
        }
        return mbPromise;
    }
    // aquece a biblioteca em segundo plano (quando o navegador estiver ocioso)
    function prefetch() { const go = () => loadMediabunny().catch(() => {}); if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 4000 }); else setTimeout(go, 1500); }

    const FFMPEG_BASE = { ffmpeg: 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/umd/', core: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/' };
    let ffPromise = null;
    async function fetchBlobURL(url, type, onProgress) {
        const r = await fetch(url); if (!r.ok) throw new Error('Falha ao baixar ' + url);
        const total = +r.headers.get('content-length') || 0;
        if (!onProgress || !total || !r.body) return URL.createObjectURL(new Blob([await r.arrayBuffer()], { type }));
        const reader = r.body.getReader(), parts = []; let got = 0;
        for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; onProgress(got / total); }
        return URL.createObjectURL(new Blob(parts, { type }));
    }
    function loadFFmpeg(onProgress) {
        if (!ffPromise) {
            ffPromise = (async () => {
                const libURL = await fetchBlobURL(FFMPEG_BASE.ffmpeg + 'ffmpeg.js', 'text/javascript');
                await new Promise((res, rej) => { const s = document.createElement('script'); s.src = libURL; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
                const worker = await fetchBlobURL('vendor/ffmpeg-worker.js?v=' + (window.PIXELAR_V || ''), 'text/javascript');
                const ff = new FFmpegWASM.FFmpeg();
                await ff.load({ classWorkerURL: worker, coreURL: await fetchBlobURL(FFMPEG_BASE.core + 'ffmpeg-core.js', 'text/javascript'), wasmURL: await fetchBlobURL(FFMPEG_BASE.core + 'ffmpeg-core.wasm', 'application/wasm', onProgress) });
                return ff;
            })();
            ffPromise.catch(() => { ffPromise = null; });
        }
        return ffPromise;
    }
    async function transcodeWithFFmpeg(file, progress, note) {
        note('Convertendo com FFmpeg (a 1ª vez baixa ~31 MB)…');
        const ff = await loadFFmpeg((p) => progress(p * 0.4));
        const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
        const h264 = document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"') !== '';
        const outName = h264 ? 'saida.mp4' : 'saida.webm', inName = 'entrada.' + ext;
        const vArgs = h264 ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '14'] : ['-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '12M', '-crf', '6'];
        const aArgs = [...(h264 ? ['-c:a', 'aac', '-b:a', '192k'] : ['-c:a', 'libopus', '-b:a', '192k']), '-af', 'aresample=async=1'];
        const common = ['-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'];
        await ff.writeFile(inName, new Uint8Array(await file.arrayBuffer()));
        const onProg = ({ progress: p }) => progress(0.4 + Math.max(0, Math.min(1, p)) * 0.6);
        ff.on('progress', onProg);
        try {
            let code = await ff.exec(['-i', inName, '-map', '0:v:0', '-map', '0:a:0?', ...vArgs, ...common, ...aArgs, ...(h264 ? ['-movflags', '+faststart'] : []), outName]);
            let mute = false;
            if (code !== 0) { mute = true; code = await ff.exec(['-i', inName, '-map', '0:v:0', ...vArgs, ...common, '-an', outName]); }
            if (code !== 0) throw new Error('FFmpeg não conseguiu converter o arquivo');
            const data = await ff.readFile(outName);
            const blob = new Blob([data.buffer], { type: h264 ? 'video/mp4' : 'video/webm' });
            if (mute) blob.pixelarAudioLost = true;
            return blob;
        } finally { ff.off('progress', onProg); try { await ff.deleteFile(inName); } catch (e) {} try { await ff.deleteFile(outName); } catch (e) {} }
    }

    // ---------- AVI (RIFF) com Motion JPEG ----------
    function parseAvi(buf) {
        const dv = new DataView(buf), u8 = new Uint8Array(buf), fcc = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
        const streams = []; let avih = null; const video = [], audio = []; let vS = null, aS = null;
        function walk(start, end, inMovi) {
            let o = start;
            while (o + 8 <= end) {
                const id = fcc(o), size = dv.getUint32(o + 4, true), body = o + 8;
                if (size > end - body) { if (inMovi) break; }
                const bodyEnd = Math.min(end, body + size);
                if (id === 'RIFF' || id === 'LIST') { const type = fcc(body); if (type === 'strl') streams.push({}); walk(body + 4, bodyEnd, inMovi || type === 'movi'); }
                else if (id === 'avih') avih = { usPerFrame: dv.getUint32(body, true), width: dv.getUint32(body + 32, true), height: dv.getUint32(body + 36, true) };
                else if (id === 'strh' && streams.length) { const s = streams[streams.length - 1]; s.type = fcc(body); s.handler = fcc(body + 4); s.scale = dv.getUint32(body + 20, true); s.rate = dv.getUint32(body + 24, true); }
                else if (id === 'strf' && streams.length) {
                    const s = streams[streams.length - 1];
                    if (s.type === 'vids') { s.width = dv.getInt32(body + 4, true); s.height = Math.abs(dv.getInt32(body + 8, true)); s.compression = fcc(body + 16); }
                    else if (s.type === 'auds') { s.format = dv.getUint16(body, true); s.channels = dv.getUint16(body + 2, true); s.sampleRate = dv.getUint32(body + 4, true); s.blockAlign = dv.getUint16(body + 12, true); s.bits = dv.getUint16(body + 14, true); s.samplesPerBlock = size >= 20 && (s.format === 0x11 || s.format === 0x02) ? dv.getUint16(body + 18, true) : 0; if (s.format === 0xFFFE && size >= 26) s.format = dv.getUint16(body + 24, true); }
                } else if (inMovi && /^\d\d(dc|db|wb)$/.test(id)) {
                    if (!vS) { vS = streams.find(s => s.type === 'vids'); aS = streams.find(s => s.type === 'auds'); }
                    const st = streams[+id.slice(0, 2)];
                    if (st && st === vS && !id.endsWith('wb')) video.push([body, size]); else if (st && st === aS && id.endsWith('wb')) audio.push([body, size]);
                }
                o = body + size + (size & 1);
            }
        }
        if (fcc(0) !== 'RIFF' || fcc(8) !== 'AVI ') throw new Error('Não é um AVI válido');
        walk(0, buf.byteLength, false);
        const vs = streams.find(s => s.type === 'vids'), as = streams.find(s => s.type === 'auds');
        if (!vs) throw new Error('AVI sem vídeo');
        const fps = vs.scale && vs.rate ? vs.rate / vs.scale : (avih && avih.usPerFrame ? 1e6 / avih.usPerFrame : 30);
        return { u8, fps, width: vs.width || (avih && avih.width), height: vs.height || (avih && avih.height), compression: (vs.compression || vs.handler || '').toUpperCase(), video, audio: as ? Object.assign({ chunks: audio }, as) : null };
    }
    const MJPEG_DHT = (() => {
        const hex = (s) => s.match(/../g).map(h => parseInt(h, 16));
        const T = [[0x00, '00010501010101010100000000000000', '000102030405060708090a0b'], [0x01, '00030101010101010101010000000000', '000102030405060708090a0b'],
            [0x10, '0002010303020403050504040000017d', '01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9fa'],
            [0x11, '00020102040403040705040400010277', '000102031104052131061241510761711322328108144291a1b1c109233352f0156272d10a162434e125f11718191a262728292a35363738393a434445464748494a535455565758595a636465666768696a737475767778797a82838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9fa']];
        const body = []; for (const [tc, bits, vals] of T) body.push(tc, ...hex(bits), ...hex(vals));
        const len = body.length + 2; return new Uint8Array([0xFF, 0xC4, len >> 8, len & 255, ...body]);
    })();
    function fixMjpeg(frame) {
        let o = 2;
        while (o + 4 <= frame.length) { if (frame[o] !== 0xFF) break; const m = frame[o + 1]; if (m === 0xC4) return frame; if (m === 0xDA) break; o += 2 + ((frame[o + 2] << 8) | frame[o + 3]); }
        const out = new Uint8Array(frame.length + MJPEG_DHT.length); out.set(frame.subarray(0, 2)); out.set(MJPEG_DHT, 2); out.set(frame.subarray(2), 2 + MJPEG_DHT.length); return out;
    }
    const IMA_STEPS = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767];
    const IMA_IDX = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];
    function decodeAviAudio(avi) {
        const a = avi.audio; if (!a || !a.chunks.length) return null;
        const ch = Math.max(1, a.channels || 1); let total = 0; for (const [, s] of a.chunks) total += s;
        const src = new Uint8Array(total); let p = 0; for (const [o, s] of a.chunks) { src.set(avi.u8.subarray(o, o + s), p); p += s; }
        const dv = new DataView(src.buffer); let out; const fmt = a.format, bits = a.bits;
        if (fmt === 1 || fmt === 3) {
            const bps = bits >> 3, n = Math.floor(total / (bps * ch)); out = Array.from({ length: ch }, () => new Float32Array(n));
            for (let i = 0, o = 0; i < n; i++) for (let c = 0; c < ch; c++, o += bps) { let v; if (fmt === 3) v = bps === 8 ? dv.getFloat64(o, true) : dv.getFloat32(o, true); else if (bps === 1) v = (src[o] - 128) / 128; else if (bps === 2) v = dv.getInt16(o, true) / 32768; else if (bps === 3) v = ((src[o] | (src[o + 1] << 8) | (src[o + 2] << 16)) << 8 >> 8) / 8388608; else v = dv.getInt32(o, true) / 2147483648; out[c][i] = v; }
        } else if (fmt === 6 || fmt === 7) {
            const n = Math.floor(total / ch); out = Array.from({ length: ch }, () => new Float32Array(n));
            for (let i = 0, o = 0; i < n; i++) for (let c = 0; c < ch; c++, o++) { let x = ~src[o] & 255, v; if (fmt === 7) { const t = ((x & 15) << 3) + 132; v = ((x & 0x70) ? (t << ((x & 0x70) >> 4)) : t) - 132; if (x & 128) v = -v; } else { x ^= 0xD5 ^ 0xFF; let t = (x & 15) << 4; const seg = (x & 0x70) >> 4; t = seg === 0 ? t + 8 : seg === 1 ? t + 0x108 : (t + 0x108) << (seg - 1); v = (x & 128) ? t : -t; } out[c][i] = v / 32768; }
        } else if (fmt === 0x11) {
            const block = a.blockAlign, spb = a.samplesPerBlock || ((block - 4 * ch) * 8) / (4 * ch) + 1, nB = Math.floor(total / block);
            out = Array.from({ length: ch }, () => new Float32Array(nB * spb));
            for (let b = 0; b < nB; b++) {
                const base = b * block, pred = [], idx = [];
                for (let c = 0; c < ch; c++) { pred[c] = dv.getInt16(base + 4 * c, true); idx[c] = Math.min(88, src[base + 4 * c + 2]); out[c][b * spb] = pred[c] / 32768; }
                // dados em grupos de 4 bytes (8 amostras) por canal, alternando os canais
                const ds = base + 4 * ch, groups = Math.floor((spb - 1) / 8);
                for (let g = 0; g < groups; g++) for (let c = 0; c < ch; c++) for (let k = 0; k < 8; k++) {
                    const bo = ds + (g * ch + c) * 4 + (k >> 1); if (bo >= base + block) break;
                    const byte = src[bo], code = (k & 1) ? (byte >> 4) : (byte & 15);
                    const step = IMA_STEPS[idx[c]]; let diff = step >> 3; if (code & 1) diff += step >> 2; if (code & 2) diff += step >> 1; if (code & 4) diff += step;
                    pred[c] = Math.max(-32768, Math.min(32767, pred[c] + ((code & 8) ? -diff : diff))); idx[c] = Math.max(0, Math.min(88, idx[c] + IMA_IDX[code])); out[c][b * spb + 1 + g * 8 + k] = pred[c] / 32768;
                }
            }
        } else if (fmt === 0x02) {   // MS ADPCM (comum em AVI gravado no Windows)
            const block = a.blockAlign, spb = a.samplesPerBlock || ((block - 7 * ch) * 8) / (4 * ch) + 2, nB = Math.floor(total / block);
            const C1 = [256, 512, 0, 192, 240, 460, 392], C2 = [0, -256, 0, 64, 0, -208, -232], AD = [230, 230, 230, 230, 307, 409, 512, 614, 768, 614, 512, 409, 307, 230, 230, 230];
            out = Array.from({ length: ch }, () => new Float32Array(nB * spb));
            for (let b = 0; b < nB; b++) {
                const base = b * block, c1 = [], c2 = [], d = [], s1 = [], s2 = [];
                for (let c = 0; c < ch; c++) { const pi = Math.min(6, src[base + c]); c1[c] = C1[pi]; c2[c] = C2[pi]; d[c] = dv.getInt16(base + ch + 2 * c, true); s1[c] = dv.getInt16(base + 3 * ch + 2 * c, true); s2[c] = dv.getInt16(base + 5 * ch + 2 * c, true); out[c][b * spb] = s2[c] / 32768; out[c][b * spb + 1] = s1[c] / 32768; }
                let nib = 0; const ds = base + 7 * ch;
                for (let k = 2; k < spb; k++) for (let c = 0; c < ch; c++) {
                    const bo = ds + (nib >> 1); if (bo >= base + block) break;
                    const code = (nib & 1) ? (src[bo] & 15) : (src[bo] >> 4); nib++;
                    let v = ((s1[c] * c1[c] + s2[c] * c2[c]) >> 8) + (code >= 8 ? code - 16 : code) * d[c];
                    v = Math.max(-32768, Math.min(32767, v)); s2[c] = s1[c]; s1[c] = v; d[c] = Math.max(16, (AD[code] * d[c]) >> 8); out[c][b * spb + k] = v / 32768;
                }
            }
        } else return null;
        return { channels: out.slice(0, 2), sampleRate: a.sampleRate };
    }
    // áudio comprimido no AVI (MP3/MP2): o Web Audio lê o fluxo cru concatenado
    async function decodeAviAudioWeb(avi) {
        const a = avi.audio; if (!a || !a.chunks.length || ![0x50, 0x55].includes(a.format)) return null;
        const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext; if (!OAC) return null;
        let total = 0; for (const [, s] of a.chunks) total += s;
        const src = new Uint8Array(total); let p = 0; for (const [o, s] of a.chunks) { src.set(avi.u8.subarray(o, o + s), p); p += s; }
        try {
            const ctx = new OAC(Math.min(2, a.channels || 2), 1, a.sampleRate || 44100);
            const ab = await new Promise((res, rej) => { const r = ctx.decodeAudioData(src.buffer, res, rej); if (r && r.then) r.then(res, rej); });
            return { channels: Array.from({ length: Math.min(2, ab.numberOfChannels) }, (_, i) => ab.getChannelData(i)), sampleRate: ab.sampleRate };
        } catch (e) { console.warn('[Pixelar] Web Audio não leu o áudio do AVI:', e); return null; }
    }
    // PCM float → WAV 16 bits (entrada pequena para o FFmpeg só recodificar o som)
    function pcmToWav(pcm) {
        const ch = pcm.channels.length, n = pcm.channels[0].length, buf = new ArrayBuffer(44 + n * ch * 2), dv = new DataView(buf);
        const str = (o, t) => { for (let i = 0; i < t.length; i++) dv.setUint8(o + i, t.charCodeAt(i)); };
        str(0, 'RIFF'); dv.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
        dv.setUint32(24, pcm.sampleRate, true); dv.setUint32(28, pcm.sampleRate * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, n * ch * 2, true);
        for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 2) dv.setInt16(o, Math.max(-1, Math.min(1, pcm.channels[c][i])) * 32767, true);
        return new Uint8Array(buf);
    }
    // junta o som a um MP4 só de imagem (vídeo copiado, áudio em AAC) — usado quando o navegador não tem codificador de áudio
    // ou o AVI traz um codec de áudio que o app não lê sozinho (MS ADPCM, AC3, AAC…)
    async function muxAudioWithFFmpeg(videoBlob, audioBytes, audioExt, progress, note) {
        note('Adicionando o som com FFmpeg (a 1ª vez baixa ~31 MB)…');
        const ff = await loadFFmpeg((p) => progress(0.85 + p * 0.1));
        const aName = 'som.' + audioExt;
        await ff.writeFile('imagem.mp4', new Uint8Array(await videoBlob.arrayBuffer()));
        await ff.writeFile(aName, audioBytes);
        try {
            const code = await ff.exec(['-i', 'imagem.mp4', '-i', aName, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-af', 'aresample=async=1', '-movflags', '+faststart', 'final.mp4']);
            if (code !== 0) throw new Error('FFmpeg não juntou o áudio');
            const data = await ff.readFile('final.mp4');
            return new Blob([data.buffer], { type: 'video/mp4' });
        } finally { for (const f of ['imagem.mp4', aName, 'final.mp4']) { try { await ff.deleteFile(f); } catch (e) {} } }
    }
    const evenDim = (n) => Math.max(2, n - (n % 2));
    // Safari (Mac e todos os navegadores do iPhone): o codificador H.264 no modo 'quality' retém os quadros
    // e o envio trava após ~7 quadros; no modo 'realtime' ele libera cada quadro na hora
    const encExtra = () => (/^Apple/.test(navigator.vendor || '') ? { latencyMode: 'realtime' } : {});
    async function pickVideoCodec(MB, format, width, height, bitrate, fps) {
        const pref = ['avc', 'vp9', 'av1', 'hevc', 'vp8'];
        const list = format.getSupportedVideoCodecs().filter(c => pref.includes(c)).sort((a, b) => pref.indexOf(a) - pref.indexOf(b));
        const opts = { width, height, quality: new MB.Quality({ bitrate }), frameRate: fps };
        let c = await MB.getFirstEncodableVideoCodec(list, opts);
        // o nível certo para o fps (ex.: 4.2 em 1080p60) não existe neste aparelho: volta ao nível antigo, mas mantém o H.264
        if (c !== list[0] && list[0] === 'avc' && globalThis.__pixelarMbFps) { const keep = globalThis.__pixelarMbFps; globalThis.__pixelarMbFps = 0; const c2 = await MB.getFirstEncodableVideoCodec(['avc'], opts); if (c2) return c2; globalThis.__pixelarMbFps = keep; }
        return c;
    }
    async function pickAudioCodec(MB, format, channels, sampleRate) {
        const pref = ['aac', 'opus'], list = format.getSupportedAudioCodecs().filter(c => pref.includes(c)).sort((a, b) => pref.indexOf(a) - pref.indexOf(b));
        const opt = { numberOfChannels: channels, quality: new MB.Quality({ bitrate: 192000 }) };
        const direct = await MB.getFirstEncodableAudioCodec(list, Object.assign({ sampleRate }, opt)); if (direct) return { codec: direct, transform: undefined };
        const rs = await MB.getFirstEncodableAudioCodec(list, Object.assign({ sampleRate: 48000 }, opt)); return rs ? { codec: rs, transform: { sampleRate: 48000 } } : null;
    }
    async function transcodeAviMjpeg(file, progress, note) {
        const MB = await loadMediabunny(), avi = parseAvi(await file.arrayBuffer());
        if (!/^(MJPG|MJPEG|AVRN|LJPG|JPEG|DMB1|MJLS)/.test(avi.compression) || !avi.video.length) throw new Error('codec ' + avi.compression);
        const first = avi.video.find(([, s]) => s > 0);
        const probe = await createImageBitmap(new Blob([fixMjpeg(avi.u8.subarray(first[0], first[0] + first[1]))], { type: 'image/jpeg' }));
        const W = evenDim(probe.width), H = evenDim(probe.height); probe.close();
        const fmt = new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), bitrate = Math.max(8e6, W * H * avi.fps * 0.3);
        const vcodec = await pickVideoCodec(MB, fmt, W, H, bitrate, avi.fps); if (!vcodec) throw new Error('sem codificador de vídeo');
        const output = new MB.Output({ format: fmt, target: new MB.BufferTarget() });
        const vsrc = new MB.VideoSampleSource(Object.assign({ codec: vcodec, quality: new MB.Quality({ bitrate }), keyFrameInterval: 1, sizeChangeBehavior: 'fill' }, encExtra()));
        output.addVideoTrack(vsrc, { frameRate: avi.fps });
        const hasAudio = !!(avi.audio && avi.audio.chunks.some(([, s]) => s > 0));
        let pcm = null; try { pcm = decodeAviAudio(avi) || await decodeAviAudioWeb(avi); } catch (e) { console.warn('[Pixelar] áudio do AVI:', e); }
        let asrc = null;
        if (pcm && pcm.channels[0].length) { const ac = await pickAudioCodec(MB, fmt, pcm.channels.length, pcm.sampleRate).catch(() => null); if (ac) { asrc = new MB.AudioSampleSource({ codec: ac.codec, quality: new MB.Quality({ bitrate: 192000 }), transform: ac.transform }); output.addAudioTrack(asrc); } }
        await output.start();
        const enc = document.createElement('canvas'); enc.width = W; enc.height = H; const ectx = enc.getContext('2d');
        const audioTask = (async () => { if (!asrc) return; const n = pcm.channels[0].length, CH = pcm.sampleRate; for (let off = 0; off < n; off += CH) { const len = Math.min(CH, n - off), data = new Float32Array(len * pcm.channels.length); pcm.channels.forEach((c, i) => data.set(c.subarray(off, off + len), i * len)); const s = new MB.AudioSample({ data, format: 'f32-planar', numberOfChannels: pcm.channels.length, sampleRate: pcm.sampleRate, timestamp: off / pcm.sampleRate }); await asrc.add(s); s.close(); } })();
        const frames = avi.video, N = frames.length, pending = new Map(); let lastGood = null;
        const decode = (i) => { const [o, s] = frames[i]; if (!s) return Promise.resolve(null); return createImageBitmap(new Blob([fixMjpeg(avi.u8.subarray(o, o + s))], { type: 'image/jpeg' })).catch(() => null); };
        for (let i = 0; i < N; i++) {
            for (let k = i; k < Math.min(N, i + 6); k++) if (!pending.has(k)) pending.set(k, decode(k));
            const bmp = await pending.get(i); pending.delete(i);
            if (bmp) { ectx.drawImage(bmp, 0, 0, W, H); bmp.close(); lastGood = true; }
            if (!lastGood) continue;
            const sample = new MB.VideoSample(enc, { timestamp: i / avi.fps, duration: 1 / avi.fps }); await vsrc.add(sample); sample.close();
            if (i % 5 === 0) progress(i / N * (hasAudio && !asrc ? 0.85 : 1));
        }
        await audioTask; await output.finalize();
        const blob = new Blob([output.target.buffer], { type: 'video/mp4' });
        if (!hasAudio || asrc) return blob;
        // som presente mas sem caminho nativo: FFmpeg junta (WAV já decodificado, ou o próprio AVI)
        try { return await muxAudioWithFFmpeg(blob, pcm ? pcmToWav(pcm) : avi.u8, pcm ? 'wav' : 'avi', progress, note); }
        catch (e) { console.warn('[Pixelar] não deu para juntar o som:', e); blob.pixelarAudioLost = true; return blob; }
    }

    const NATIVE_VIDEO_EXT = ['mp4', 'm4v', 'webm', 'mov', 'ogv', 'ogg', 'mkv'];
    const VIDEO_EXT = ['avi', 'wmv', 'flv', '3gp', '3g2', 'mts', 'm2ts', 'ts', 'mpg', 'mpeg', 'vob', 'divx', 'xvid', 'asf', 'f4v', 'dv', ...NATIVE_VIDEO_EXT];
    const fileExt = (f) => ((f.name || '').split('.').pop() || '').toLowerCase();
    const isVideoFile = (f) => (f.type || '').startsWith('video/') || VIDEO_EXT.includes(fileExt(f));
    function canPlayNatively(blob) {
        return new Promise((resolve) => {
            const v = document.createElement('video'); v.muted = true; v.preload = 'metadata';
            const url = URL.createObjectURL(blob);
            const done = (ok) => { clearTimeout(t); v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); resolve(ok); };
            const t = setTimeout(() => done(false), 8000);
            v.onloadedmetadata = () => done(v.videoWidth > 0); v.onerror = () => done(false); v.src = url;
        });
    }
    // devolve um Blob que o <video> consegue tocar (convertendo quando preciso)
    async function prepareVideoBlob(file, progress, note) {
        const ext = fileExt(file);
        if (ext !== 'avi' && await canPlayNatively(file)) return file;
        if (ext === 'avi') { try { note('Convertendo AVI…'); return await transcodeAviMjpeg(file, progress, note); } catch (e) { console.warn('AVI nativo falhou, tentando FFmpeg:', e); } }
        return transcodeWithFFmpeg(file, progress, note);
    }
    const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const IS_SAFARI = /^((?!chrome|android).)*safari/i.test(navigator.userAgent) || IS_IOS;
    return { loadMediabunny, prefetch, prepareVideoBlob, isVideoFile, pickVideoCodec, pickAudioCodec, evenDim, encExtra, IS_IOS, IS_SAFARI };
})();
