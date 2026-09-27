/* Pixelar — imagem de exemplo gerada no próprio navegador (sem arquivos nem direitos autorais):
 * pôr do sol sobre montanhas e um lago, com textura suficiente para os efeitos aparecerem. */
'use strict';
function makeSampleImage(W = 1200, H = 900) {
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    // céu
    const sky = x.createLinearGradient(0, 0, 0, H * 0.62);
    sky.addColorStop(0, '#1d2b64'); sky.addColorStop(0.38, '#7a3e8e'); sky.addColorStop(0.7, '#f0726a'); sky.addColorStop(1, '#ffc56e');
    x.fillStyle = sky; x.fillRect(0, 0, W, H);
    // estrelas
    for (let i = 0; i < 140; i++) { const y = rnd() * H * 0.35; x.globalAlpha = 0.25 + rnd() * 0.6 * (1 - y / (H * 0.35)); x.fillStyle = '#fff'; x.fillRect(rnd() * W, y, 1.6, 1.6); }
    x.globalAlpha = 1;
    // sol com halo
    const sx = W * 0.62, sy = H * 0.5;
    const halo = x.createRadialGradient(sx, sy, 10, sx, sy, W * 0.42); halo.addColorStop(0, 'rgba(255,236,170,.85)'); halo.addColorStop(0.25, 'rgba(255,170,110,.35)'); halo.addColorStop(1, 'rgba(255,120,100,0)');
    x.fillStyle = halo; x.fillRect(0, 0, W, H);
    x.fillStyle = '#fff4d6'; x.beginPath(); x.arc(sx, sy, W * 0.085, 0, TAU); x.fill();
    // nuvens
    x.fillStyle = 'rgba(255,190,170,.55)';
    for (let i = 0; i < 5; i++) { const cx = rnd() * W, cy = H * (0.18 + rnd() * 0.22), cw = W * (0.12 + rnd() * 0.18); x.beginPath(); x.ellipse(cx, cy, cw, cw * 0.09, 0, 0, TAU); x.fill(); }
    // montanhas
    const ridge = (base, amp, col, rough) => {
        x.fillStyle = col; x.beginPath(); x.moveTo(0, H);
        let y = base; for (let px = 0; px <= W; px += 6) { y += (rnd() - 0.5) * rough; y = Math.max(base - amp, Math.min(base + amp * 0.3, y + (base - y) * 0.02)); x.lineTo(px, y - Math.sin(px / W * Math.PI * 2.2 + base) * amp * 0.5); }
        x.lineTo(W, H); x.fill();
    };
    ridge(H * 0.5, H * 0.14, '#5b3a6e', 22);
    ridge(H * 0.56, H * 0.1, '#3a2752', 18);
    ridge(H * 0.61, H * 0.06, '#221a38', 12);
    // lago com reflexo
    const lake = x.createLinearGradient(0, H * 0.64, 0, H); lake.addColorStop(0, '#f39a74'); lake.addColorStop(0.35, '#7a3e8e'); lake.addColorStop(1, '#141b3f');
    x.fillStyle = lake; x.fillRect(0, H * 0.64, W, H * 0.36);
    for (let i = 0; i < 70; i++) { const y = H * 0.65 + Math.pow(rnd(), 1.6) * H * 0.34; const w2 = (20 + rnd() * 160) * (1 - (y - H * 0.64) / (H * 0.5)); x.fillStyle = `rgba(255,${200 + rnd() * 50 | 0},${160 + rnd() * 60 | 0},${0.25 + rnd() * 0.4})`; x.fillRect(sx - w2 / 2 + (rnd() - 0.5) * 120, y, w2, 2 + rnd() * 2); }
    // margem com árvores
    x.fillStyle = '#120e22';
    x.fillRect(0, H * 0.635, W, 8);
    for (let i = 0; i < 26; i++) { const tx = rnd() < 0.5 ? rnd() * W * 0.32 : W * 0.78 + rnd() * W * 0.22, th = 40 + rnd() * 110, tw = th * 0.28; x.beginPath(); x.moveTo(tx, H * 0.64 - th); x.lineTo(tx - tw, H * 0.64); x.lineTo(tx + tw, H * 0.64); x.fill(); }
    // barco
    x.fillStyle = '#0d0a18'; x.beginPath(); x.moveTo(W * 0.4, H * 0.72); x.lineTo(W * 0.47, H * 0.72); x.lineTo(W * 0.455, H * 0.735); x.lineTo(W * 0.415, H * 0.735); x.fill();
    x.fillRect(W * 0.433, H * 0.66, 3, H * 0.06); x.beginPath(); x.moveTo(W * 0.436, H * 0.662); x.lineTo(W * 0.462, H * 0.712); x.lineTo(W * 0.436, H * 0.712); x.fill();
    // textura fina (para dither e grão terem o que morder)
    const img = x.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 10; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    x.putImageData(img, 0, 0);
    return c;
}
