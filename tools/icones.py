#!/usr/bin/env python3
"""Gera os ícones PNG do app a partir do logo (icons/logo.svg, grade 12 × 11).
Uso: python3 tools/icones.py  (precisa do Pillow)"""
import re, pathlib
from PIL import Image, ImageDraw
root = pathlib.Path(__file__).resolve().parent.parent
svg = (root / 'icons/logo.svg').read_text()
d = re.search(r' d="([^"]+)"', svg).group(1)
rows = [(int(x), int(y), int(w)) for x, y, w in re.findall(r'M(\d+) (\d+)h(\d+)', d)]   # trechos de 1 pixel de altura
BG, FG = (242, 242, 247, 255), (20, 20, 20, 255)
def make(size, cell, name, round_bg=False, alpha=False):
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0) if alpha else BG)
    dr = ImageDraw.Draw(im)
    if round_bg: dr.rounded_rectangle([0, 0, size - 1, size - 1], radius=size * 0.22, fill=BG)
    ox, oy = (size - 12 * cell) // 2, (size - 11 * cell) // 2
    for x, y, w in rows: dr.rectangle([ox + x * cell, oy + (y - 1) * cell, ox + (x + w) * cell - 1, oy + y * cell - 1], fill=FG)
    im.save(root / 'icons' / name)
make(192, 11, 'icon-192.png', round_bg=True, alpha=True)
make(512, 28, 'icon-512.png', round_bg=True, alpha=True)
make(512, 22, 'maskable-512.png')          # área segura: logo menor, fundo cheio
make(180, 10, 'apple-touch-icon.png')
make(32, 2, 'favicon-32.png', round_bg=True, alpha=True)
print('ícones gerados')
