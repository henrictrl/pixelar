#!/usr/bin/env python3
"""Cartões de visita RINO — 10 frentes + 10 versos, PDF vetorial em CMYK.

Formato: corte 90x50 mm, sangria 3 mm (página 96x56 mm), margem de segurança 3 mm.
Uso: python3 gerar.py  ->  saída em ./saida/*.pdf e ./previas/*.png
"""
import copy, math, os, subprocess
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.lib.colors import CMYKColor, Color
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.graphics import renderPDF
from svglib.svglib import svg2rlg

AQUI = os.path.dirname(os.path.abspath(__file__))
for n in ("Regular", "Medium", "SemiBold"):
    pdfmetrics.registerFont(TTFont(f"Inter-{n}", f"{AQUI}/fonts/Inter-{n}.ttf"))

# ---------- geometria (mm) ----------
TW, TH, B, S = 90, 50, 3, 3
PW, PH = TW + 2 * B, TH + 2 * B
L, R, BOT, TOP = B + S, B + TW - S, B + S, B + TH - S      # caixa segura

# ---------- paleta (CMYK; RGB do manual entre parênteses) ----------
def cmyk(c, m, y, k): return CMYKColor(c / 100, m / 100, y / 100, k / 100)
RINO     = cmyk(100, 80, 35, 35)   # Azul Rino      #123458
PROFUNDO = cmyk(78, 55, 32, 20)    # Azul Profundo  #3A5674
NEVOA    = cmyk(48, 33, 22, 6)     # Azul Névoa     ~#8C9BAC
OFF      = cmyk(4, 4, 6, 0)        # Off-white      #F1EFEC
TINTA    = cmyk(9, 7, 9, 0)        # off-white mais escuro (marca-d'água / pauta)
RGB2CMYK = {(18, 52, 88): RINO, (241, 239, 236): OFF, (58, 86, 116): PROFUNDO}

# ---------- logos ----------
LOGOS = {k: f"{AQUI}/logos/{k}.svg" for k in
         ("faixa_positiva", "faixa_negativa", "faixa_positiva_transparente", "horizontal_negativo")}
# recortes (pt, no SVG da faixa transparente): nome, rinoceronte, serviços
PARTES = {"nome": (0, 60.75), "rino": (78.75, 158.25), "servicos": (173.75, 244.0)}

def _recolor(node, solid):
    if hasattr(node, "contents"):
        for n in node.contents: _recolor(n, solid)
        return
    fc = getattr(node, "fillColor", None)
    if fc is not None:
        key = tuple(round(v * 255) for v in (fc.red, fc.green, fc.blue))
        node.fillColor = solid or RGB2CMYK.get(key, RINO)
    if getattr(node, "strokeColor", None) is not None:
        node.strokeColor = None

def logo(c, key, x, y, w=None, h=None, parte=None, solid=None):
    """Desenha logo com canto inferior esquerdo em (x,y) mm; w ou h em mm. Retorna (w,h) mm."""
    d = svg2rlg(LOGOS[key]); _recolor(d, solid)
    x0, x1 = PARTES[parte] if parte else (0, d.width)
    cw = x1 - x0
    k = (w * mm / cw) if w else (h * mm / d.height)
    c.saveState(); c.translate(x * mm, y * mm); c.scale(k, k)
    p = c.beginPath(); p.rect(0, 0, cw, d.height); c.clipPath(p, stroke=0, fill=0)
    c.translate(-x0, 0); renderPDF.draw(d, c, 0, 0); c.restoreState()
    return cw * k / mm, d.height * k / mm

# ---------- fundos ----------
def solido(c, cor, x=0, y=0, w=PW, h=PH):
    c.setFillColor(cor); c.rect(x * mm, y * mm, w * mm, h * mm, stroke=0, fill=1)

def degrade(c, cores, pos=None, x=0, y=0, w=PW, h=PH, graus=0):
    """Linear, vertical (graus=0) ou inclinado (4–5°). cores: de cima para baixo."""
    c.saveState()
    p = c.beginPath(); p.rect(x * mm, y * mm, w * mm, h * mm); c.clipPath(p, stroke=0, fill=0)
    cx, cy = (x + w / 2) * mm, (y + h / 2) * mm
    a = math.radians(graus); half = (h / 2 * math.cos(a) + w / 2 * math.sin(abs(a))) * mm
    dx, dy = math.sin(a) * half, math.cos(a) * half
    # reportlab: do 1º ponto (início) ao 2º; início = topo
    c.linearGradient(cx - dx, cy + dy, cx + dx, cy - dy, cores, pos, extend=True)
    c.restoreState()

# ---------- texto ----------
def txt(c, s, x, y, fonte="Regular", pt=8, cor=RINO, alinhar="e", tracking=0):
    nome = f"Inter-{fonte}"
    w = pdfmetrics.stringWidth(s, nome, pt) + tracking * len(s)
    x0 = x * mm - {"e": 0, "d": w, "c": w / 2}[alinhar]
    t = c.beginText(x0, y * mm); t.setFont(nome, pt); t.setFillColor(cor)
    t.setCharSpace(tracking); t.textOut(s); c.drawText(t)

NOME, CARGO = "Romulo Guerriero", "Diretor"
FONE, MAIL = "(11) 93359-8394", "rinocebranco@gmail.com"

def bloco_nome(c, x, y, cor, alinhar="e"):
    txt(c, NOME, x, y, "SemiBold", 11, cor, alinhar)
    txt(c, CARGO, x, y - 4.2, "Regular", 8, cor, alinhar)

def bloco_contato(c, x, y, cor, alinhar="d"):
    """y = linha do e-mail (baixo); telefone acima. Alinhado na linha de base."""
    txt(c, FONE, x, y + 3.9, "Regular", 8, cor, alinhar)
    txt(c, MAIL, x, y, "Regular", 8, cor, alinhar)


def servicos(c, x, y, cor, alinhar="d"):
    """Serviços em texto (8 pt), 3 linhas; y = linha de base da última."""
    for i, t in enumerate(("Empréstimos", "Financiamentos", "Antecipações")):
        txt(c, t, x, y + i * 3.6, "Medium", 8, cor, alinhar)

def marca(c, x, y, cor, w=17):
    # y = base das letras (o recorte tem folga abaixo do wordmark)
    logo(c, "faixa_positiva_transparente", x, y - .156 * w, w=w, parte="nome", solid=cor)

# =====================================================================
# FRENTES (todas com nome, cargo, telefone, e-mail, logo e serviços)
# =====================================================================
def f01(c):  # Horizonte vertical — referência do cliente (azul sólido sob a placa do logo)
    degrade(c, [OFF, NEVOA, RINO], [0, .3, .66])
    bloco_nome(c, L, TOP - 4, RINO); bloco_contato(c, R, TOP - 7.9, RINO)
    logo(c, "faixa_positiva", L - 1.2, BOT - 1.3, w=R - L + 2.4)

def f02(c):  # Anoitecer — tudo na ponta escura
    degrade(c, [NEVOA, PROFUNDO, RINO], [0, .3, .66])
    bloco_nome(c, L, TOP - 14, OFF); bloco_contato(c, R, TOP - 17.9, OFF)
    logo(c, "faixa_positiva", L - 1.2, BOT - 1.3, w=R - L + 2.4)

def f03(c):  # Profundidade — rinoceronte grande à direita
    degrade(c, [PROFUNDO, RINO], [0, .85])
    logo(c, "faixa_positiva_transparente", R - 42, TOP - 22.5, w=42, parte="rino")
    bloco_nome(c, L, TOP - 4, OFF)
    txt(c, FONE, L, BOT + 11.5, "Regular", 8, OFF); txt(c, MAIL, L, BOT + 7.6, "Regular", 8, OFF)
    marca(c, L, BOT, OFF); servicos(c, R, BOT, OFF)

def f04(c):  # Névoa — claro, tinta azul
    degrade(c, [OFF, NEVOA], [0, 1])
    bloco_nome(c, L, TOP - 4, RINO); bloco_contato(c, R, TOP - 7.9, RINO)
    logo(c, "faixa_positiva_transparente", L, BOT + .3, w=R - L)

def f05(c):  # Sólido: azul em cima, faixa off-white embaixo (referência 1 do cliente)
    solido(c, RINO); solido(c, OFF, 0, 0, PW, 21)
    bloco_nome(c, L, TOP - 4, OFF); bloco_contato(c, R, TOP - 7.9, OFF)
    logo(c, "faixa_positiva_transparente", L, BOT + 1.7, w=R - L)

def f06(c):  # Horizonte invertido: azul no topo (texto claro), off-white embaixo (logo azul)
    degrade(c, [RINO, NEVOA, OFF], [.1, .55, 1])
    bloco_nome(c, L, TOP - 4, OFF); bloco_contato(c, R, TOP - 7.9, OFF)
    logo(c, "faixa_positiva_transparente", L, BOT + .3, w=R - L)

def f07(c):  # Dois painéis: azul sólido (rinoceronte + nome) e off-white→névoa com dados
    solido(c, RINO, 0, 0, 38, PH)
    degrade(c, [OFF, NEVOA], [0, 1], x=38, w=PW - 38)
    logo(c, "faixa_positiva_transparente", L - 1, PH / 2 - 1, w=28, parte="rino")
    marca(c, L, BOT, OFF, w=22)
    x0 = 43
    txt(c, NOME, x0, TOP - 4, "SemiBold", 11, RINO); txt(c, CARGO, x0, TOP - 8.2, "Regular", 8, RINO)
    txt(c, FONE, x0, BOT + 17.5, "Regular", 8, RINO); txt(c, MAIL, x0, BOT + 13.6, "Regular", 8, RINO)
    servicos(c, R, BOT, RINO)

def f08(c):  # Bloco empilhado (logo vertical) sobre Horizonte
    degrade(c, [OFF, NEVOA, RINO], [0, .5, 1])
    logo(c, "horizontal_negativo", L, BOT, w=34)
    bloco_nome(c, 46, TOP - 4, RINO)
    txt(c, FONE, 46, TOP - 14.7, "Regular", 8, RINO); txt(c, MAIL, 46, TOP - 18.6, "Regular", 8, RINO)

def f09(c):  # Profundidade inclinada 5° + rinoceronte tom sobre tom
    degrade(c, [PROFUNDO, RINO], [0, .9], graus=5)
    logo(c, "faixa_positiva_transparente", 41, -3, w=66, parte="rino", solid=PROFUNDO)
    bloco_nome(c, L, TOP - 4, OFF)
    txt(c, FONE, L, BOT + 11.5, "Regular", 8, OFF); txt(c, MAIL, L, BOT + 7.6, "Regular", 8, OFF)
    marca(c, L, BOT, OFF); servicos(c, R, BOT, OFF)

def f10(c):  # Horizonte 5° com a faixa negativa (placa clara) ancorada na base
    degrade(c, [OFF, NEVOA, RINO], [0, .5, .95], graus=5)
    bloco_nome(c, L, TOP - 4, RINO); bloco_contato(c, R, TOP - 7.9, RINO)
    logo(c, "faixa_negativa", L - 1.2, BOT - 1.3, w=R - L + 2.4)

# =====================================================================
# VERSOS (espaço para escrever: áreas claras, sem verniz/laminação)
# =====================================================================
def pauta(c, x0, x1, ys, cor=NEVOA):
    c.setStrokeColor(cor); c.setLineWidth(.5)       # ≥0,5 pt (regra de linha mínima)
    for y in ys: c.line(x0 * mm, y * mm, x1 * mm, y * mm)

def v01(c):  # Horizonte: topo off-white para escrever, base azul sólida + logo
    degrade(c, [OFF, OFF, NEVOA, RINO], [0, .3, .5, .66])
    logo(c, "faixa_positiva", L - 1.2, BOT - 1.3, w=R - L + 2.4)

def v02(c):  # Off-white com pauta + faixa azul sólida na base
    solido(c, OFF); solido(c, RINO, 0, 0, PW, 19)
    pauta(c, L, R, [TOP - 7, TOP - 14, TOP - 21])
    logo(c, "faixa_positiva", L - 1.2, BOT - 1.3, w=R - L + 2.4)

def v03(c):  # Névoa clara, rinoceronte azul pequeno no canto
    degrade(c, [OFF, OFF, NEVOA], [0, .6, 1])
    logo(c, "faixa_positiva_transparente", R - 20, BOT, w=20, parte="rino")

def v04(c):  # Barra lateral azul com rinoceronte, resto livre
    solido(c, OFF); solido(c, RINO, 0, 0, 28, PH)
    logo(c, "faixa_positiva_transparente", L, PH / 2 - 4.5, w=18, parte="rino")
    pauta(c, 33, R, [TOP - 8, TOP - 16, TOP - 24, TOP - 32])

def v05(c):  # Horizonte 5°, rinoceronte + marca na ponta escura
    degrade(c, [OFF, OFF, NEVOA, RINO], [0, .3, .7, .95], graus=5)
    logo(c, "faixa_positiva_transparente", R - 22, BOT, w=22, parte="rino")
    marca(c, L, BOT, OFF, w=14)

def v06(c):  # Faixa azul sólida no topo com o logo, resto 100% livre
    solido(c, OFF); solido(c, RINO, 0, PH - 19, PW, 19)
    logo(c, "faixa_positiva", L - 1.2, TOP - 12.3, w=R - L + 2.4)
    pauta(c, L, R, [BOT + 22, BOT + 15, BOT + 8, BOT + 1])

def v07(c):  # Quadriculado leve (rascunho/croqui) + marca discreta
    solido(c, OFF)
    c.setStrokeColor(TINTA); c.setLineWidth(.5)
    x = L
    while x <= R + .01: c.line(x * mm, BOT * mm, x * mm, TOP * mm); x += 5
    y = BOT
    while y <= TOP + .01: c.line(L * mm, y * mm, R * mm, y * mm); y += 5
    solido(c, OFF, R - 22.5, BOT - .01, 23, 9.3)
    logo(c, "faixa_positiva_transparente", R - 20.8, BOT + .3, w=20, parte="rino")

def v08(c):  # Painel off-white para escrever sobre Profundidade, logo na base
    degrade(c, [PROFUNDO, RINO], [0, .9])
    c.setFillColor(OFF); c.roundRect(L * mm, (BOT + 11) * mm, (R - L) * mm, (TOP - BOT - 11) * mm, 2.5 * mm, stroke=0, fill=1)
    pauta(c, L + 3, R - 3, [TOP - 9, TOP - 16, TOP - 23])
    marca(c, L, BOT, OFF, w=15)
    logo(c, "faixa_positiva_transparente", R - 16, BOT - .3, w=16, parte="rino")

def v09(c):  # Névoa: off-white → névoa com logo claro-sobre-névoa em azul
    degrade(c, [OFF, NEVOA], [.2, 1])
    logo(c, "faixa_positiva_transparente", L, BOT + .2, w=R - L)

def v10(c):  # Off-white, marca-d'água tom sobre tom + marca pequena
    solido(c, OFF)
    logo(c, "faixa_positiva_transparente", 38, -4, w=70, parte="rino", solid=TINTA)
    pauta(c, L, R - 30, [TOP - 8, TOP - 16, TOP - 24, TOP - 32], cor=NEVOA)
    marca(c, L, BOT, RINO, w=15)


VERSOES = [("frente", i, f) for i, f in enumerate([f01, f02, f03, f04, f05, f06, f07, f08, f09, f10], 1)] + \
          [("verso", i, f) for i, f in enumerate([v01, v02, v03, v04, v05, v06, v07, v08, v09, v10], 1)]

def guias(c):
    """Só para as prévias: corte (preto), segurança (azul), sangria (vermelho)."""
    c.setLineWidth(.2)
    for cor, m in ((Color(.9, 0, .1), 0), (Color(0, 0, 0), B), (Color(.1, .6, .9), B + S)):
        c.setStrokeColor(cor); c.rect(m * mm, m * mm, (PW - 2 * m) * mm, (PH - 2 * m) * mm, stroke=1, fill=0)

def main():
    os.makedirs(f"{AQUI}/saida", exist_ok=True); os.makedirs(f"{AQUI}/previas", exist_ok=True)
    for lado, i, fn in VERSOES:
        nome = f"rino_{lado}_{i:02d}"
        for sufixo, g in (("", False), ("_guias", True)):
            pasta = "saida" if not g else "previas"
            c = canvas.Canvas(f"{AQUI}/{pasta}/{nome}{sufixo}.pdf", pagesize=(PW * mm, PH * mm))
            c.setTitle(f"RINO — cartão {lado} {i:02d}"); c.setAuthor("Pixelar")
            if not g:
                c.setPageCompression(1)
            fn(c)
            if g: guias(c)
            c.showPage(); c.save()
        subprocess.run(["pdftoppm", "-r", "300", "-png", "-singlefile",
                        f"{AQUI}/previas/{nome}_guias.pdf", f"{AQUI}/previas/{nome}"], check=True)
        os.remove(f"{AQUI}/previas/{nome}_guias.pdf")
        print(nome)

if __name__ == "__main__":
    main()
