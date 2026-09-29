/* Pixelar — vidro líquido com refração de verdade.
 *
 * Para cada peça de vidro (.glass) gera um mapa de deslocamento do tamanho exato dela: dentro da
 * faixa da borda (bezel) o fundo é "puxado" para dentro seguindo a curva de uma lente convexa,
 * com os canais R, G e B deslocados em intensidades um pouco diferentes (dispersão = arco-íris
 * sutil na borda). O miolo fica limpo, quase sem desfoque — mais vidro, menos blur.
 *
 * Só navegadores Chromium aplicam filtros SVG em backdrop-filter; nos demais o CSS mantém o
 * vidro leve com desfoque curto, sem nada quebrado.
 */
'use strict';
const LiquidGlass = (() => {
    const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
    const supported = brands.some(b => /Chromium/.test(b.brand));
    const NS = 'http://www.w3.org/2000/svg';
    let svg = null, seq = 0;
    const items = new Map();   // el -> { id, w, h, r, filter }

    function ensureSvg() {
        if (svg) return svg;
        svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('aria-hidden', 'true');
        svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
        document.body.append(svg);
        return svg;
    }

    // mapa de deslocamento de um retângulo arredondado (perfil de lente circular na borda)
    function makeMap(w, h, r, bezel) {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
        const hx = w / 2, hy = h / 2, ix = hx - r, iy = hy - r;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const px = x + 0.5 - hx, py = y + 0.5 - hy;
                const qx = Math.abs(px) - ix, qy = Math.abs(py) - iy;
                // distância assinada até a borda (negativa = dentro)
                const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
                const sdf = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
                let dx = 0, dy = 0;
                const dist = -sdf;
                if (dist > 0 && dist < bezel) {
                    // normal para fora
                    let nx, ny;
                    if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = qx / l; ny = qy / l; }
                    else if (qx > qy) { nx = 1; ny = 0; } else { nx = 0; ny = 1; }
                    nx *= Math.sign(px) || 1; ny *= Math.sign(py) || 1;
                    // lente convexa: forte bem na borda, some suavemente até o fim do bezel
                    const t = 1 - dist / bezel, m = 1 - Math.sqrt(1 - t * t);
                    dx = -nx * m; dy = -ny * m;
                }
                const i = (y * w + x) * 4;
                d[i] = 128 + Math.round(dx * 127); d[i + 1] = 128 + Math.round(dy * 127); d[i + 2] = 128; d[i + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        return c.toDataURL('image/png');
    }

    function build(el, it) {
        const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
        if (w < 8 || h < 8) return;
        const cs = getComputedStyle(el);
        const r = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, w / 2, h / 2);
        if (it.w === w && it.h === h && it.r === r) return;
        it.w = w; it.h = h; it.r = r;
        const bezel = Math.max(6, Math.min(22, r * 0.9, Math.min(w, h) / 2 - 1));
        const scale = Math.round(Math.min(44, bezel * 1.7));
        const href = makeMap(w, h, r, bezel);
        const f = it.filter || document.createElementNS(NS, 'filter');
        it.filter = f; f.id = it.id;
        f.setAttribute('x', 0); f.setAttribute('y', 0); f.setAttribute('width', w); f.setAttribute('height', h);
        f.setAttribute('filterUnits', 'userSpaceOnUse'); f.setAttribute('primitiveUnits', 'userSpaceOnUse');
        f.setAttribute('color-interpolation-filters', 'sRGB');
        const ch = (s, rgb, res) => `<feDisplacementMap in="soft" in2="map" scale="${s}" xChannelSelector="R" yChannelSelector="G" result="d${res}"/>
            <feColorMatrix in="d${res}" type="matrix" values="${rgb[0]} 0 0 0 0  0 ${rgb[1]} 0 0 0  0 0 ${rgb[2]} 0 0  0 0 0 1 0" result="${res}"/>`;
        f.innerHTML = `<feGaussianBlur in="SourceGraphic" stdDeviation="1.1" result="soft"/>
            <feImage href="${href}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>
            ${ch(scale, [1, 0, 0], 'r')}${ch(Math.round(scale * 0.9), [0, 1, 0], 'g')}${ch(Math.round(scale * 0.8), [0, 0, 1], 'b')}
            <feBlend in="r" in2="g" mode="screen" result="rg"/><feBlend in="rg" in2="b" mode="screen"/>`;
        if (!f.parentNode) ensureSvg().append(f);
        el.style.setProperty('--lg-filter', `url(#${it.id})`);
        el.dataset.lg = it.id;
    }

    let ro = null, pending = new Set(), timer = 0;
    function flush() { timer = 0; pending.forEach(el => { const it = items.get(el); if (it && el.isConnected) build(el, it); }); pending.clear(); }
    function queue(el) { pending.add(el); if (!timer) timer = setTimeout(flush, 60); }
    function attach(el) {
        if (items.has(el)) return;
        const it = { id: 'lg' + (++seq) }; items.set(el, it);
        ro.observe(el); queue(el);
    }
    function scan(root) { (root || document).querySelectorAll('.glass').forEach(attach); if (root && root.classList && root.classList.contains('glass')) attach(root); }
    function init() {
        if (!supported) return;
        document.documentElement.classList.add('refract');
        ro = new ResizeObserver(entries => entries.forEach(e => queue(e.target)));
        scan();
        new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) scan(n); }))).observe(document.body, { childList: true, subtree: true });
    }
    return { init, supported, rebuild: () => { items.forEach((it, el) => { it.w = 0; queue(el); }); } };
})();
