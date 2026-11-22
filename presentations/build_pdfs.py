#!/usr/bin/env python3
"""
Pixelar Studio — Editorial Darkroom PDF Presentations Generator
Generates two publication-grade PDFs using ReportLab + Pillow with real
visual transformations rendered from the user's high-res Viveiro photo:
  1. Pixelar_Studio_Apresentacao.pdf     (16:9 Widescreen, 10-slide keynote deck)
  2. Pixelar_Studio_Resumo_Executivo.pdf (A4 Portrait, 1-page visual executive sheet)
"""
import os, math, random
from PIL import Image, ImageEnhance, ImageFilter, ImageOps, ImageDraw, ImageChops
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase.pdfmetrics import stringWidth

ROOT = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.join(ROOT, "assets")
os.makedirs(ASSETS_DIR, exist_ok=True)

SOURCE_PHOTO = os.path.join(ROOT, "pinacoteca_source.jpg")
FALLBACK_SAMPLE = os.path.join(os.path.dirname(ROOT), "src", "samples.js")

# Darkroom Editorial Palette
C_BG        = colors.HexColor("#09090B")
C_SURFACE   = colors.HexColor("#121217")
C_CARD      = colors.HexColor("#17171E")
C_CARD_HI   = colors.HexColor("#1E1E27")
C_BORDER    = colors.HexColor("#272732")
C_BORDER_HI = colors.HexColor("#393948")
C_TEXT1     = colors.HexColor("#F3F2EE")
C_TEXT2     = colors.HexColor("#A2A1AC")
C_TEXT3     = colors.HexColor("#6A6976")
C_AMBER     = colors.HexColor("#FDAF00")
C_AMBER_DIM = colors.HexColor("#3A2B09")
C_CYAN      = colors.HexColor("#38BDF8")
C_RED       = colors.HexColor("#F87171")
C_GREEN     = colors.HexColor("#4ADE80")
C_PURPLE    = colors.HexColor("#C084FC")

# Exact 12x11 Pixelar Official Sunset Grid (rows of (x, w))
SUNSET_RECTS = [
    # y_from_top, x, w, h
    (0, 4, 4, 1),
    (1, 2, 8, 1),
    (2, 1, 10, 2),
    (4, 0, 12, 1),
    (6, 0, 12, 1),
    (8, 1, 10, 1),
    (10, 3, 6, 1),
]

def draw_pixelar_logo(c, x, y, size, bg_box=True, radius=None):
    """Draws the official 12x11 Pixelar Sunset logo as crisp vector geometry."""
    c.saveState()
    if bg_box:
        r = radius if radius is not None else size * 0.22
        c.setFillColor(colors.HexColor("#0D0D10"))
        c.setStrokeColor(colors.HexColor("#4F390A"))
        c.setLineWidth(0.9)
        c.roundRect(x, y, size, size, r, stroke=1, fill=1)
        pad = size * 0.16
        inner_w = size - 2 * pad
        unit = inner_w / 12.0
        ox = x + pad
        oy = y + (size - 11.0 * unit) * 0.5
    else:
        unit = size / 12.0
        ox = x
        oy = y
    c.setFillColor(C_AMBER)
    for row_top, rx, rw, rh in SUNSET_RECTS:
        # ReportLab y goes bottom-up; row_top=0 is at top (y = oy + (11 - row_top - rh)*unit)
        ry = oy + (11.0 - row_top - rh) * unit
        c.rect(ox + rx * unit, ry, rw * unit, rh * unit, stroke=0, fill=1)
    c.restoreState()

def draw_wrapped_text(c, text, x, y, max_w, font="Helvetica", size=11, leading=16, color=C_TEXT2):
    c.saveState()
    c.setFont(font, size)
    c.setFillColor(color)
    words = text.split()
    lines = []
    cur = ""
    for w in words:
        test = (cur + " " + w).strip()
        if stringWidth(test, font, size) <= max_w:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    cy = y
    for line in lines:
        c.drawString(x, cy, line)
        cy -= leading
    c.restoreState()
    return cy

def draw_pill(c, x, y, text, bg=C_CARD_HI, fg=C_TEXT1, border=C_BORDER_HI, font="Helvetica-Bold", size=8.5, h=19, pad_x=10):
    tw = stringWidth(text, font, size)
    w = tw + pad_x * 2
    c.saveState()
    c.setFillColor(bg)
    c.setStrokeColor(border)
    c.setLineWidth(0.7)
    c.roundRect(x, y, w, h, h / 2.0, stroke=1, fill=1)
    c.setFont(font, size)
    c.setFillColor(fg)
    c.drawCentredString(x + w / 2.0, y + (h - size) * 0.5 + 1.2, text)
    c.restoreState()
    return w

def draw_card(c, x, y, w, h, r=10, fill=C_CARD, stroke=C_BORDER, lw=0.8):
    c.saveState()
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.setLineWidth(lw)
    c.roundRect(x, y, w, h, r, stroke=1, fill=1)
    c.restoreState()

def draw_clipped_image(c, img_path, x, y, w, h, r=8, border=C_BORDER_HI):
    c.saveState()
    p = c.beginPath()
    p.roundRect(x, y, w, h, r)
    c.clipPath(p, stroke=0, fill=0)
    c.drawImage(img_path, x, y, width=w, height=h, preserveAspectRatio=False, mask="auto")
    c.restoreState()
    if border:
        c.saveState()
        c.setStrokeColor(border)
        c.setLineWidth(0.9)
        c.roundRect(x, y, w, h, r, stroke=1, fill=0)
        c.restoreState()

# =========================================================================
# REAL PHOTOGRAPHIC SAMPLES RENDERER (PIL FROM HIGH-RES VIVEIRO PHOTO)
# =========================================================================
def load_base_photo():
    if os.path.exists(SOURCE_PHOTO):
        im = Image.open(SOURCE_PHOTO).convert("RGB")
    else:
        raise FileNotFoundError(f"Source photo not found: {SOURCE_PHOTO}")
    # Crop neatly to 3:2 aspect ratio at high resolution (1200x800) for crisp PDF printing
    tw, th = 1200, 800
    w, h = im.size
    target_ar = tw / th
    if w / h > target_ar:
        nw = int(h * target_ar)
        x0 = (w - nw) // 2
        im = im.crop((x0, 0, x0 + nw, h))
    else:
        nh = int(w / target_ar)
        y0 = (h - nh) // 2
        im = im.crop((0, y0, w, y0 + nh))
    return im.resize((tw, th), Image.LANCZOS)

def add_grain(im, strength=14):
    w, h = im.size
    rng = random.Random(42)
    # Fast tileable grain for speed & organic texture
    gw, gh = 240, 160
    noise = Image.new("L", (gw, gh))
    px = [max(0, min(255, 128 + int(rng.gauss(0, strength)))) for _ in range(gw * gh)]
    noise.putdata(px)
    noise = noise.resize((w, h), Image.BILINEAR)
    r, g, b = im.split()
    def blend_ch(ch):
        return Image.eval(ch, lambda v: v)
    # Use soft overlay blend via point math on RGB
    out = Image.new("RGB", (w, h))
    n_rgb = Image.merge("RGB", (noise, noise, noise))
    return Image.blend(im, n_rgb, min(0.22, strength / 120.0))

def generate_photo_samples():
    paths = {}
    base = load_base_photo()

    # 1. Original CCD
    p_orig = os.path.join(ASSETS_DIR, "viveiro_orig.jpg")
    base.save(p_orig, "JPEG", quality=93)
    paths["orig"] = p_orig

    # 2. Kodak Gold 200 (warm amber highlights, lifted shadows, lush greens, subtle bloom)
    im = base.copy()
    r, g, b = im.split()
    r = r.point(lambda v: min(255, int(10 + v * 1.07)))
    g = g.point(lambda v: min(255, int(6 + v * 1.02)))
    b = b.point(lambda v: max(0, min(255, int(12 + v * 0.86))))
    im = Image.merge("RGB", (r, g, b))
    im = ImageEnhance.Contrast(im).enhance(1.12)
    im = ImageEnhance.Color(im).enhance(1.18)
    bloom = im.filter(ImageFilter.GaussianBlur(14))
    im = Image.blend(im, bloom, 0.14)
    p_gold = os.path.join(ASSETS_DIR, "viveiro_gold200.jpg")
    im.save(p_gold, "JPEG", quality=92)
    paths["gold"] = p_gold

    # 3. Vencido Viva (expired film fog, magenta-amber cast, corner light leak, fade)
    im = base.copy()
    r, g, b = im.split()
    r = r.point(lambda v: min(255, int(28 + v * 0.96)))
    g = g.point(lambda v: min(255, int(18 + v * 0.88)))
    b = b.point(lambda v: min(255, int(34 + v * 0.82)))
    im = Image.merge("RGB", (r, g, b))
    im = ImageEnhance.Contrast(im).enhance(0.92)
    # Add warm amber-orange film edge light leak on left
    w, h = im.size
    leak = Image.new("RGB", (w, h), (0, 0, 0))
    ld = ImageDraw.Draw(leak)
    for x in range(int(w * 0.36)):
        t = (1.0 - x / (w * 0.36)) ** 2.2
        col = (int(240 * t), int(95 * t), int(20 * t))
        ld.line([(x, 0), (x, h)], fill=col)
    im = Image.blend(im, ImageOps.colorize(im.convert("L"), "#2a1228", "#f6d29c"), 0.18)
    # Screen-like additive leak
    im_px = im.load()
    lk_px = leak.load()
    for yy in range(0, h, 2):
        for xx in range(0, int(w * 0.36)):
            lr, lg, lb = lk_px[xx, yy]
            if lr > 2:
                cr, cg, cb = im_px[xx, yy]
                nr = min(255, cr + int(lr * 0.55))
                ng = min(255, cg + int(lg * 0.55))
                nb = min(255, cb + int(lb * 0.45))
                im_px[xx, yy] = (nr, ng, nb)
                if yy + 1 < h:
                    im_px[xx, yy + 1] = (nr, ng, nb)
    p_venc = os.path.join(ASSETS_DIR, "viveiro_vencido.jpg")
    im.save(p_venc, "JPEG", quality=92)
    paths["vencido"] = p_venc

    # 4. CineStill 800T (cool teal tungsten shadows, glowing red halation on highlights)
    im = base.copy()
    r, g, b = im.split()
    r = r.point(lambda v: min(255, int(v * 0.94 + (28 if v > 185 else 0))))
    g = g.point(lambda v: min(255, int(8 + v * 1.01)))
    b = b.point(lambda v: min(255, int(22 + v * 1.12)))
    im = Image.merge("RGB", (r, g, b))
    im = ImageEnhance.Contrast(im).enhance(1.16)
    # Red halation halo around bright highlights
    hi = base.convert("L").point(lambda v: 255 if v > 195 else 0).filter(ImageFilter.GaussianBlur(18))
    halo = Image.merge("RGB", (hi, hi.point(lambda v: int(v * 0.22)), hi.point(lambda v: int(v * 0.08))))
    im = Image.blend(im, halo, 0.24)
    im = ImageEnhance.Brightness(im).enhance(1.15)
    p_cine = os.path.join(ASSETS_DIR, "viveiro_cinestill.jpg")
    im.save(p_cine, "JPEG", quality=92)
    paths["cinestill"] = p_cine

    # 5. Tri-X P&B Prata (rich silver monochrome)
    im = ImageOps.grayscale(base)
    im = ImageEnhance.Contrast(im).enhance(1.38)
    im = ImageOps.colorize(im, "#0b0b0e", "#f4f1ea")
    p_bw = os.path.join(ASSETS_DIR, "viveiro_trix.jpg")
    im.save(p_bw, "JPEG", quality=92)
    paths["bw"] = p_bw

    # 6. Lab: Risograph Duotone (deep indigo + amber paper + subtle grain)
    gray = ImageOps.grayscale(base)
    gray = ImageEnhance.Contrast(gray).enhance(1.26)
    riso = ImageOps.colorize(gray, black="#12183B", mid="#D94E28", white="#F8E7B9")
    p_riso = os.path.join(ASSETS_DIR, "viveiro_riso.jpg")
    riso.save(p_riso, "JPEG", quality=92)
    paths["riso"] = p_riso

    # 7. Lab: Pixel Art 8-Colors (crisp pixel blocks + retro palette quantization)
    small = base.resize((120, 80), Image.BILINEAR)
    pal_img = small.quantize(colors=8, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).convert("RGB")
    pal_img = ImageEnhance.Color(pal_img).enhance(1.28)
    pix = pal_img.resize(base.size, Image.NEAREST)
    p_pix = os.path.join(ASSETS_DIR, "viveiro_pixel.jpg")
    pix.save(p_pix, "JPEG", quality=92)
    paths["pixel"] = p_pix

    # 8. Lab: CRT Scanlines & Chromatic Aberration
    w, h = base.size
    r, g, b = base.split()
    r = ImageChops.offset(r, 6, 0)
    b = ImageChops.offset(b, -6, 0)
    crt = Image.merge("RGB", (r, g, b))
    crt = ImageEnhance.Contrast(crt).enhance(1.18)
    crt = ImageEnhance.Color(crt).enhance(1.15)
    d = ImageDraw.Draw(crt)
    for y in range(0, h, 5):
        d.line([(0, y), (w, y)], fill=(8, 10, 14), width=2)
    p_crt = os.path.join(ASSETS_DIR, "viveiro_crt.jpg")
    crt.save(p_crt, "JPEG", quality=92)
    paths["crt"] = p_crt

    # 9. Geometria + Grade Áurea/Terços Overlay
    geom = base.copy()
    geom = ImageEnhance.Contrast(geom).enhance(1.06)
    gd = ImageDraw.Draw(geom, "RGBA")
    # Rule of thirds + golden center crosshair
    for frac in (1/3, 2/3):
        x = int(w * frac)
        y = int(h * frac)
        gd.line([(x, 0), (x, h)], fill=(255, 255, 255, 130), width=2)
        gd.line([(0, y), (w, y)], fill=(255, 255, 255, 130), width=2)
    # Amber horizon alignment line + corner crop brackets
    gd.line([(0, h // 2), (w, h // 2)], fill=(253, 175, 0, 175), width=2)
    m = 36
    L = 56
    col_b = (253, 175, 0, 235)
    for (cx, cy, dx, dy) in [(m, m, 1, 1), (w - m, m, -1, 1), (m, h - m, 1, -1), (w - m, h - m, -1, -1)]:
        gd.line([(cx, cy), (cx + dx * L, cy)], fill=col_b, width=5)
        gd.line([(cx, cy), (cx, cy + dy * L)], fill=col_b, width=5)
    p_geom = os.path.join(ASSETS_DIR, "viveiro_geom.jpg")
    geom.save(p_geom, "JPEG", quality=92)
    paths["geom"] = p_geom

    return paths

# =========================================================================
# DECK SHARED CHROME (16:9 WIDESCREEN: 1280 x 720 pt)
# =========================================================================
SLIDE_W, SLIDE_H = 1280, 720

def start_slide(c, slide_num, total_slides, section_tag=""):
    # Obsidian Darkroom background
    c.setFillColor(C_BG)
    c.rect(0, 0, SLIDE_W, SLIDE_H, stroke=0, fill=1)

    # Subtle ambient darkroom top-left radial-like highlight box
    c.saveState()
    c.setFillColor(colors.HexColor("#101016"))
    c.rect(0, SLIDE_H - 64, SLIDE_W, 64, stroke=0, fill=1)
    c.setStrokeColor(C_BORDER)
    c.setLineWidth(0.8)
    c.line(0, SLIDE_H - 64, SLIDE_W, SLIDE_H - 64)
    c.line(0, 44, SLIDE_W, 44)
    c.restoreState()

    # Header bar
    draw_pixelar_logo(c, 48, SLIDE_H - 46, 28, bg_box=True, radius=6)
    c.setFont("Helvetica-Bold", 11.5)
    c.setFillColor(C_TEXT1)
    c.drawString(86, SLIDE_H - 36, "PIXELAR STUDIO")
    if section_tag:
        c.setFont("Courier-Bold", 9.5)
        c.setFillColor(C_AMBER)
        c.drawRightString(SLIDE_W - 48, SLIDE_H - 36, section_tag.upper())

    # Footer bar
    c.setFont("Courier", 9)
    c.setFillColor(C_TEXT3)
    c.drawString(48, 19, "PIXELAR STUDIO  ·  ESTÚDIO ANALÓGICO, LAB CRIATIVO & GEOMETRIA EM GPU")
    c.drawRightString(SLIDE_W - 48, 19, f"{slide_num:02d} / {total_slides:02d}")

# =========================================================================
# VECTOR DEVICE MOCKUPS FOR SLIDE 7 (MACOS, IPHONE MODELO D, IPAD 10 LAYOUT 5)
# =========================================================================
def draw_device_mockups(c, photos):
    # 1. macOS Desktop App Mockup (Left, w=450)
    x0, y0, w0, h0 = 48, 130, 460, 360
    draw_card(c, x0, y0, w0, h0, r=12, fill=C_SURFACE, stroke=C_BORDER_HI, lw=1.1)
    # macOS titlebar
    c.setFillColor(colors.HexColor("#18181F"))
    c.roundRect(x0, y0 + h0 - 28, w0, 28, 12, stroke=0, fill=1)
    c.rect(x0, y0 + h0 - 28, w0, 14, stroke=0, fill=1)
    for i, col in enumerate(["#FF5F56", "#FFBD2E", "#27C93F"]):
        c.setFillColor(colors.HexColor(col))
        c.circle(x0 + 16 + i * 13, y0 + h0 - 14, 4, stroke=0, fill=1)
    c.setFont("Helvetica-Bold", 8.5)
    c.setFillColor(C_TEXT2)
    c.drawCentredString(x0 + w0 / 2, y0 + h0 - 17, "Pixelar Studio.app — macOS")
    # Main canvas + right inspector + tool rail
    draw_clipped_image(c, photos["gold"], x0 + 14, y0 + 54, 286, 260, r=6, border=C_BORDER)
    # Filmstrip bottom
    c.setFillColor(colors.HexColor("#0E0E13"))
    c.rect(x0 + 1, y0 + 1, 314, 42, stroke=0, fill=1)
    draw_clipped_image(c, photos["orig"], x0 + 16, y0 + 7, 46, 30, r=3, border=C_AMBER)
    # Inspector drawer
    c.setFillColor(colors.HexColor("#111116"))
    c.rect(x0 + 314, y0 + 1, 114, h0 - 29, stroke=0, fill=1)
    c.setStrokeColor(C_BORDER)
    c.line(x0 + 314, y0 + 1, x0 + 314, y0 + h0 - 28)
    c.line(x0 + 428, y0 + 1, x0 + 428, y0 + h0 - 28)
    # Mini histogram + collapsible accordion bars
    c.setFillColor(colors.HexColor("#0A0A0E"))
    c.roundRect(x0 + 322, y0 + h0 - 78, 98, 38, 4, stroke=0, fill=1)
    c.setFillColor(colors.HexColor("#FDAF00"))
    for k in range(18):
        bh = 6 + int(24 * math.sin((k + 1) * 0.24) ** 2)
        c.rect(x0 + 326 + k * 5, y0 + h0 - 76, 3.5, bh, stroke=0, fill=1)
    acc_labels = ["Receitas Prontas", "Efeitos & Texturas", "Paletas", "Pixel & Dither"]
    for idx, al in enumerate(acc_labels):
        ay = y0 + h0 - 106 - idx * 36
        c.setFillColor(C_CARD if idx == 0 else colors.HexColor("#14141B"))
        c.roundRect(x0 + 322, ay, 98, 26, 4, stroke=0, fill=1)
        c.setFont("Helvetica-Bold", 7.2)
        c.setFillColor(C_AMBER if idx == 0 else C_TEXT2)
        c.drawString(x0 + 329, ay + 10, al)
    # Tool rail (rightmost 32pt)
    for idx in range(6):
        ry = y0 + h0 - 54 - idx * 32
        c.setFillColor(C_AMBER_DIM if idx == 4 else colors.HexColor("#17171E"))
        c.roundRect(x0 + 434, ry, 20, 22, 4, stroke=0, fill=1)
        c.setFillColor(C_AMBER if idx == 4 else C_TEXT3)
        c.rect(x0 + 441, ry + 8, 6, 6, stroke=0, fill=1)
    # Caption below
    c.setFont("Helvetica-Bold", 13)
    c.setFillColor(C_TEXT1)
    c.drawString(x0, y0 - 26, "macOS & Desktop")
    draw_wrapped_text(c, "App nativo arm64 com painel único contextual, acordeões colapsáveis, barra de ferramentas lateral e exportação direta via NSSavePanel.", x0, y0 - 44, w0, size=9.8, leading=14)

    # 2. iPhone Modelo D Glass Pro Mockup (Center, w=206)
    x1, y1, w1, h1 = 548, 118, 212, 384
    draw_card(c, x1, y1, w1, h1, r=28, fill=colors.HexColor("#060608"), stroke=C_BORDER_HI, lw=1.6)
    # Dynamic Island
    c.setFillColor(colors.HexColor("#000000"))
    c.roundRect(x1 + w1 / 2 - 28, y1 + h1 - 22, 56, 13, 6.5, stroke=0, fill=1)
    # Top glass pills
    c.setFillColor(colors.HexColor("#1A1A23"))
    c.roundRect(x1 + 12, y1 + h1 - 48, 56, 18, 9, stroke=0, fill=1)
    c.roundRect(x1 + w1 - 92, y1 + h1 - 48, 80, 18, 9, stroke=0, fill=1)
    c.setFillColor(C_AMBER)
    c.roundRect(x1 + w1 - 46, y1 + h1 - 46, 32, 14, 7, stroke=0, fill=1)
    # Photo centered in Área Livre Inteligente!
    draw_clipped_image(c, photos["vencido"], x1 + 12, y1 + 152, w1 - 24, 152, r=6, border=C_BORDER)
    # Floating Glass Dock at bottom
    c.setFillColor(colors.HexColor("#171720"))
    c.setStrokeColor(C_BORDER_HI)
    c.setLineWidth(0.8)
    c.roundRect(x1 + 10, y1 + 14, w1 - 20, 118, 16, stroke=1, fill=1)
    # Handle
    c.setFillColor(C_TEXT3)
    c.roundRect(x1 + w1 / 2 - 14, y1 + 122, 28, 3, 1.5, stroke=0, fill=1)
    # Precision Ruler inside dock
    c.setFillColor(colors.HexColor("#0B0B0F"))
    c.roundRect(x1 + 20, y1 + 82, w1 - 40, 22, 6, stroke=0, fill=1)
    for t in range(19):
        tx = x1 + 28 + t * 8.5
        th = 11 if t == 9 else (8 if t % 3 == 0 else 5)
        c.setFillColor(C_AMBER if t == 9 else C_TEXT3)
        c.rect(tx, y1 + 93 - th / 2, 1.4, th, stroke=0, fill=1)
    # Uniform 10px cards row
    for ci in range(4):
        cx = x1 + 20 + ci * 44
        c.setFillColor(C_AMBER_DIM if ci == 1 else colors.HexColor("#101015"))
        c.setStrokeColor(C_AMBER if ci == 1 else C_BORDER)
        c.roundRect(cx, y1 + 48, 38, 26, 5, stroke=1, fill=1)
    # 5 Bottom tabs
    for ti in range(5):
        tx = x1 + 20 + ti * 35
        c.setFillColor(C_AMBER if ti == 0 else C_TEXT3)
        c.roundRect(tx, y1 + 22, 24, 14, 5, stroke=0, fill=1)
    c.setFont("Helvetica-Bold", 13)
    c.setFillColor(C_TEXT1)
    c.drawString(x1, y1 - 14, "iPhone · Modelo D")
    draw_wrapped_text(c, "Glass Pro com Área Livre Inteligente, régua tátil háptica, cards uniformes e scroll preservado.", x1, y1 - 32, w1, size=9.6, leading=14)

    # 3. iPad 10 Layout 5 Darkroom Mockup (Right, w=432)
    x2, y2, w2, h2 = 800, 130, 432, 360
    draw_card(c, x2, y2, w2, h2, r=18, fill=colors.HexColor("#0A0A0D"), stroke=C_BORDER_HI, lw=1.4)
    # Topbar
    c.setFillColor(colors.HexColor("#13131A"))
    c.rect(x2 + 2, y2 + h2 - 30, w2 - 4, 28, stroke=0, fill=1)
    c.setFillColor(C_AMBER)
    c.roundRect(x2 + w2 - 58, y2 + h2 - 24, 46, 16, 8, stroke=0, fill=1)
    c.setFont("Helvetica-Bold", 7.2)
    c.setFillColor(C_BG)
    c.drawCentredString(x2 + w2 - 35, y2 + h2 - 19, "Exportar")
    # Left Session Sidebar
    c.setFillColor(colors.HexColor("#121218"))
    c.rect(x2 + 2, y2 + 96, 52, h2 - 126, stroke=0, fill=1)
    draw_clipped_image(c, photos["orig"], x2 + 9, y2 + h2 - 80, 38, 30, r=4, border=C_AMBER)
    draw_clipped_image(c, photos["gold"], x2 + 9, y2 + h2 - 118, 38, 30, r=4, border=C_BORDER)
    draw_clipped_image(c, photos["riso"], x2 + 9, y2 + h2 - 156, 38, 30, r=4, border=C_BORDER)
    # Wide canvas
    draw_clipped_image(c, photos["cinestill"], x2 + 72, y2 + 114, 336, 200, r=6, border=C_BORDER)
    # Bottom Wide Precision Ruler Dock
    c.setFillColor(colors.HexColor("#14141B"))
    c.rect(x2 + 2, y2 + 2, w2 - 4, 94, stroke=0, fill=1)
    c.setFillColor(colors.HexColor("#0B0B0F"))
    c.roundRect(x2 + 24, y2 + 54, w2 - 48, 24, 6, stroke=0, fill=1)
    for t in range(37):
        tx = x2 + 34 + t * 10.2
        th = 13 if t == 18 else (9 if t % 5 == 0 else 5)
        c.setFillColor(C_AMBER if t == 18 else C_TEXT3)
        c.rect(tx, y2 + 66 - th / 2, 1.5, th, stroke=0, fill=1)
    # Bottom 6 tabs
    for ti in range(6):
        tx = x2 + 58 + ti * 54
        c.setFillColor(C_AMBER_DIM if ti == 2 else colors.HexColor("#1D1D26"))
        c.roundRect(tx, y2 + 16, 44, 18, 9, stroke=0, fill=1)
    c.setFont("Helvetica-Bold", 13)
    c.setFillColor(C_TEXT1)
    c.drawString(x2, y2 - 26, "iPad 10 · Layout 5 Darkroom")
    draw_wrapped_text(c, "Sessão vertical à esquerda, palco amplo de edição, régua de precisão em largura total e popovers de vidro para Curvas, HSL e Rodas.", x2, y2 - 44, w2, size=9.8, leading=14)

# =========================================================================
# BUILD DELIVERABLE 1: 10-SLIDE WIDESCREEN KEYNOTE DECK
# =========================================================================
def build_keynote_pdf(photos, out_path):
    c = canvas.Canvas(out_path, pagesize=(SLIDE_W, SLIDE_H))
    c.setTitle("Pixelar Studio — Apresentação Oficial")
    c.setAuthor("Pixelar Studio")
    TOTAL = 10

    # --- SLIDE 1: HERO EDITORIAL COVER ---
    c.setFillColor(C_BG)
    c.rect(0, 0, SLIDE_W, SLIDE_H, stroke=0, fill=1)
    # Subtle darkroom grid accent lines
    c.setStrokeColor(colors.HexColor("#17171F"))
    c.setLineWidth(0.8)
    c.line(48, 668, SLIDE_W - 48, 668)
    c.line(48, 56, SLIDE_W - 48, 56)

    # Top editorial tag
    c.setFont("Courier-Bold", 10)
    c.setFillColor(C_AMBER)
    c.drawString(48, 682, "PIXELAR STUDIO  //  APRESENTAÇÃO DO PRODUTO")
    c.setFillColor(C_TEXT3)
    c.drawRightString(SLIDE_W - 48, 682, "EDIÇÃO 2.0  ·  WEBGL2 GPU STUDIO")

    # Left Hero Copy
    draw_pixelar_logo(c, 48, 524, 72, bg_box=True, radius=16)
    c.setFont("Helvetica-Bold", 54)
    c.setFillColor(C_TEXT1)
    c.drawString(48, 442, "Pixelar Studio")
    c.setFont("Helvetica-Bold", 21)
    c.setFillColor(C_AMBER)
    c.drawString(48, 404, "Estúdio Analógico, Lab Criativo & Geometria.")
    draw_wrapped_text(
        c,
        "Um editor de fotos e vídeos acelerado por GPU que une emulação química de filmes 35mm, resgate de vídeos Sony Cyber-shot .AVI, laboratório criativo procedural e correção geométrica padrão Lightroom — 100% local, instantâneo e desenhado sob medida para macOS, Web, iPhone e iPad.",
        48, 358, 535, font="Helvetica", size=13.5, leading=21, color=C_TEXT2
    )

    # Platform pills
    px = 48
    for lbl in ["macOS arm64", "iPhone · Modelo D", "iPad 10 · Layout 5", "Web Offline"]:
        pw = draw_pill(c, px, 174, lbl, bg=C_CARD, fg=C_TEXT1, border=C_BORDER_HI, size=9.5, h=24, pad_x=12)
        px += pw + 8

    # Key highlight strip
    c.setFont("Courier", 10)
    c.setFillColor(C_TEXT3)
    c.drawString(48, 96, "PROCESSAMENTO LOCAL EM 60 FPS  ·  ZERO NUVEM  ·  ZERO ASSINATURA  ·  QUALIDADE ORIGINAL 100%")

    # Right Hero Photo Frame (Viveiro Kodak Gold + Original corner inset)
    draw_card(c, 620, 108, 612, 514, r=14, fill=C_SURFACE, stroke=C_BORDER_HI, lw=1.0)
    draw_clipped_image(c, photos["gold"], 636, 172, 580, 404, r=9, border=C_BORDER)
    # Inset Original badge
    draw_clipped_image(c, photos["orig"], 652, 188, 148, 98, r=6, border=C_AMBER)
    draw_pill(c, 660, 195, "ORIGINAL", bg=colors.HexColor("#0D0D11"), fg=C_AMBER, border=C_AMBER, size=7.5, h=16, pad_x=7)
    # Caption bar inside hero card
    c.setFont("Helvetica-Bold", 11.5)
    c.setFillColor(C_TEXT1)
    c.drawString(640, 142, "Pinacoteca · Octógono  →  Kodak Gold 200")
    c.setFont("Courier", 9.5)
    c.setFillColor(C_TEXT3)
    c.drawString(640, 124, "Arquitetura & Claraboia  ·  Halação Película + Roll-off Analógico + Grão Orgânico")
    c.setFont("Courier-Bold", 9)
    c.setFillColor(C_AMBER)
    c.drawRightString(1214, 142, "GPU 60 FPS")

    c.showPage()

    # --- SLIDE 2: A VISÃO & DIFERENCIAIS ---
    start_slide(c, 2, TOTAL, "01 · Visão do Produto")
    c.setFont("Helvetica-Bold", 36)
    c.setFillColor(C_TEXT1)
    c.drawString(48, 590, "Por que o Pixelar Studio existe?")
    draw_wrapped_text(
        c,
        "Editores modernos cobram assinaturas mensais, sobem suas fotos para a nuvem e entregam filtros genéricos. O Pixelar devolve o controle tátil de uma câmara escura profissional — direto na sua GPU, sem perder um único pixel de resolução.",
        48, 548, 860, size=14, leading=21, color=C_TEXT2
    )

    # 3 Big Value Pillars
    pillars = [
        ("60 FPS", "Motor WebGL2 em 6 Estágios",
         "Cada slider, curva RGB, roda 3-vias, lente e textura do Lab roda em shaders GLSL ES 3.00 reais na placa de vídeo, com resposta imediata mesmo em fotos de 14 MP e vídeos."),
        ("100%", "Qualidade Original & Privacidade",
         "Nenhum arquivo sai do seu Mac, iPhone ou iPad. A exportação preserva a resolução nativa completa (PNG com receita embutida, JPEG Editorial, WebP e 3D LUT .cube)."),
        ("4 TELAS", "UX Desenhada Para Cada Dispositivo",
         "Em vez de espremer a tela do PC no celular, cada plataforma tem sua própria ergonomia: Estúdio no macOS, Glass Pro no iPhone e Darkroom no iPad 10."),
    ]
    for i, (num, title, desc) in enumerate(pillars):
        cx = 48 + i * 402
        draw_card(c, cx, 232, 380, 260, r=12, fill=C_CARD, stroke=C_BORDER_HI)
        c.setFont("Courier-Bold", 34)
        c.setFillColor(C_AMBER)
        c.drawString(cx + 26, 434, num)
        c.setFont("Helvetica-Bold", 16)
        c.setFillColor(C_TEXT1)
        c.drawString(cx + 26, 396, title)
        draw_wrapped_text(c, desc, cx + 26, 368, 328, size=11.8, leading=18, color=C_TEXT2)

    # Bottom Metric Strip
    metrics = [
        ("13", "Químicas de Filme"),
        ("24", "Receitas Prontas no Lab"),
        ("18", "Texturas GPU + 5 Blend Modes"),
        ("18+", "Paletas & Quantização 2–256"),
        ("6", "Grades de Composição"),
        (".AVI", "Resgate Sony Cyber-shot"),
    ]
    draw_card(c, 48, 84, SLIDE_W - 96, 112, r=12, fill=C_SURFACE, stroke=C_BORDER)
    mw = (SLIDE_W - 96) / len(metrics)
    for idx, (val, lbl) in enumerate(metrics):
        mx = 48 + idx * mw + mw / 2.0
        if idx > 0:
            c.setStrokeColor(C_BORDER)
            c.line(48 + idx * mw, 102, 48 + idx * mw, 178)
        c.setFont("Courier-Bold", 24)
        c.setFillColor(C_AMBER)
        c.drawCentredString(mx, 146, val)
        c.setFont("Helvetica", 10.2)
        c.setFillColor(C_TEXT2)
        c.drawCentredString(mx, 116, lbl)

    c.showPage()

    # --- SLIDE 3: FILMES ANALÓGICOS, VENCIDOS & CÂMERAS ---
    start_slide(c, 3, TOTAL, "02 · Emulação de Película")
    c.setFont("Helvetica-Bold", 34)
    c.setFillColor(C_TEXT1)
    c.drawString(48, 594, "Filmes 35mm, Vencidos & Câmeras Cult")
    draw_wrapped_text(
        c,
        "Mais do que presets de cor: o Pixelar simula fisicamente o roll-off de altas luzes, halação vermelha da camada anti-halo, grão orgânico dependente de luminância e degradação química de filmes vencidos — cada um com variações e controle contínuo de intensidade.",
        48, 554, 960, size=13, leading=19, color=C_TEXT2
    )

    # 4-up Real Contact Sheet of Viveiro
    films = [
        ("orig", "Original · Pinacoteca", "Referência sem edição · luz natural"),
        ("gold", "Kodak Gold 200", "Realces âmbar, tijolos quentes, bloom suave"),
        ("vencido", "Vencido Viva · Emulsão", "Véu químico, manchas orgânicas e light leak"),
        ("cinestill", "CineStill 800T", "Sombras tungstênio + halação vermelha"),
    ]
    cw, ch = 282, 200
    for i, (key, title, sub) in enumerate(films):
        fx = 48 + i * 300
        fy = 278
        draw_card(c, fx, fy - 56, cw, ch + 66, r=10, fill=C_CARD, stroke=C_AMBER if i == 1 else C_BORDER_HI)
        draw_clipped_image(c, photos[key], fx + 8, fy + 2, cw - 16, ch - 12, r=6, border=C_BORDER)
        c.setFont("Helvetica-Bold", 12)
        c.setFillColor(C_AMBER if i == 1 else C_TEXT1)
        c.drawString(fx + 12, fy - 20, title)
        c.setFont("Helvetica", 9.5)
        c.setFillColor(C_TEXT2)
        c.drawString(fx + 12, fy - 38, sub)

    # Bottom Chemistry & Optics Feature Row
    draw_card(c, 48, 76, 580, 120, r=10, fill=C_SURFACE, stroke=C_BORDER)
    c.setFont("Courier-Bold", 10)
    c.setFillColor(C_AMBER)
    c.drawString(68, 168, "13 PROCESSOS QUÍMICOS EM TEMPO REAL")
    draw_wrapped_text(
        c,
        "Vencido Viva (camadas R/G/B independentes, idade, véu, manchas e semente aleatória), Redscale, Raio-X, Film Soup, Autochrome, Cross-Process, Bleach Bypass, Aerochrome, LomoPurple, Technicolor, P&B Prata e Infravermelho.",
        68, 146, 540, size=10.8, leading=16, color=C_TEXT2
    )

    draw_card(c, 652, 76, 580, 120, r=10, fill=C_SURFACE, stroke=C_BORDER)
    c.setFont("Courier-Bold", 10)
    c.setFillColor(C_AMBER)
    c.drawString(672, 168, "CÂMARA ESCURA COMPLETA (LUZ, COR & ÓPTICA)")
    draw_wrapped_text(
        c,
        "Histograma RGB ao vivo com alerta de estourados, Auto Luz inteligente, Curva de Tons RGB + canais R/G/B, Misturador HSL (8 bandas), Rodas de Color Grading 3-Vias, Pro-Mist, Orton Dream, Anamorphic Flare e Flash Direto.",
        672, 146, 540, size=10.8, leading=16, color=C_TEXT2
    )

    c.showPage()

    # --- SLIDE 4: LABORATÓRIO CRIATIVO (LAB) ---
    start_slide(c, 4, TOTAL, "03 · Laboratório Criativo")
    c.setFont("Helvetica-Bold", 34)
    c.setFillColor(C_TEXT1)
    c.drawString(48, 594, "Laboratório Criativo: Do Analógico à Arte Digital")
    draw_wrapped_text(
        c,
        "Organizado em 4 módulos colapsáveis limpos (Receitas Prontas, Efeitos & Texturas, Paletas & Recoloração, Pixel & Pontilhado), o Lab transforma qualquer foto em pôster risográfico, arte 8-bit, tela CRT ou colagem experimental com 1 clique.",
        48, 554, 980, size=13, leading=19, color=C_TEXT2
    )

    # 3 Large Visual Lab Showcase Cards
    labs = [
        ("riso", "Risograph & Duotone / Tritone",
         "Mapeamento tonal em 2 ou 3 tintas editáveis + paletas prontas (GameBoy, Cyber, Risograph, Bauhaus, PICO-8) e quantização de 2 a 256 cores."),
        ("pixel", "DNA Pixelar & Pontilhado (Dither)",
         "Blocos de pixel de 1 a 32 px combinados com algoritmos clássicos: Bayer 8×8, Atkinson 1984 (Macintosh), Retícula Halftone e Linhas de TV."),
        ("crt", "18 Texturas GPU + 5 Blend Modes",
         "CRT, Glitch VHS, Prisma Caleidoscópio, Vidro Canelado, Estrelas, Pintura a Óleo, Fotocópia Xerox e Papel Molhado — com controles contextuais."),
    ]
    for i, (key, title, desc) in enumerate(labs):
        lx = 48 + i * 402
        draw_card(c, lx, 184, 380, 326, r=12, fill=C_CARD, stroke=C_BORDER_HI)
        draw_clipped_image(c, photos[key], lx + 12, 286, 356, 212, r=8, border=C_BORDER)
        c.setFont("Helvetica-Bold", 13.5)
        c.setFillColor(C_AMBER)
        c.drawString(lx + 16, 258, title)
        draw_wrapped_text(c, desc, lx + 16, 238, 348, size=10.3, leading=15, color=C_TEXT2)

    # Bottom UX callout strip (Highlighting the new collapsible Lab architecture)
    draw_card(c, 48, 76, SLIDE_W - 96, 82, r=10, fill=C_SURFACE, stroke=C_AMBER_DIM, lw=1.1)
    c.setFont("Courier-Bold", 10)
    c.setFillColor(C_AMBER)
    c.drawString(70, 134, "UX/UI REDESENHADA  ·  REMIX INSTANTÂNEO + MÓDULOS COLAPSÁVEIS")
    draw_wrapped_text(
        c,
        "24 receitas visuais filtráveis por categoria (Retrô, Editorial, Cinema, Glitch, Arte), botão Remix com variação orgânica em tempo real e acordeões independentes com indicador de status ativo — poder máximo sem poluição visual.",
        70, 114, SLIDE_W - 140, size=11, leading=16, color=C_TEXT1
    )

    c.showPage()

    # --- SLIDE 5: GEOMETRIA & CORREÇÃO DE LENTE ---
    start_slide(c, 5, TOTAL, "04 · Geometria Padrão Lightroom")
    c.setFont("Helvetica-Bold", 34)
    c.setFillColor(C_TEXT1)
    c.drawString(48, 594, "Geometria, Perspectiva & Correção de Lente")
    draw_wrapped_text(
        c,
        "Um estágio dedicado em GPU (Pass 0) executa homografia projetiva, correção de distorção radial de lente e cálculo matemático exato de auto-corte — garantindo bordas limpas sem perder nitidez.",
        48, 554, 920, size=13, leading=19, color=C_TEXT2
    )

    # Left: Large Visual Geometry Preview with Grid Overlay
    draw_card(c, 48, 92, 620, 424, r=12, fill=C_SURFACE, stroke=C_BORDER_HI)
    draw_clipped_image(c, photos["geom"], 64, 152, 588, 348, r=8, border=C_BORDER)
    c.setFont("Helvetica-Bold", 11.5)
    c.setFillColor(C_TEXT1)
    c.drawString(68, 122, "Overlay Vetorial SVG em Tempo Real (Terços 3×3, 6×6, Áurea Phi, Diagonais, Mira)")
    c.setFont("Courier", 9.5)
    c.setFillColor(C_AMBER)
    c.drawString(68, 105, "CONSTRAIN CROP ATIVO  ·  SOLVER AUTOMÁTICO DE ESCALA SEM CANTOS PRETOS")

    # Right: 3 Clean Collapsible Module Cards
    geom_mods = [
        ("01 · Corte & Proporção",
         "9 proporções instantâneas (Original, 1:1, 4:5, 3:4, 2:3, 3:2, 16:9, 9:16, Cinema 21:9), rotação ±90°, espelhamento H/V, ajuste fino de horizonte (±45° em passos de 0,1°) e switch Restringir Corte (Auto-Zoom)."),
        ("02 · Perspectiva & Transformação",
         "Keystone Vertical (corrige prédios convergindo), Keystone Horizontal, Inclinação (Skew), Alongar Proporção, Escala (50–200%), Deslocamento X/Y e botões rápidos Nível 0° / Vert. + / Vert. −."),
        ("03 · Correção Óptica de Lente",
         "Modelo radial Brown-Conrady para corrigir distorção de Barril (grande-angular) e Almofada (teleobjetiva), aliado à compensação dedicada de Vinheta da Lente antes da revelação de cor."),
    ]
    for idx, (gt, gd) in enumerate(geom_mods):
        gy = 386 - idx * 147
        draw_card(c, 694, gy, 538, 130, r=10, fill=C_CARD, stroke=C_BORDER_HI)
        c.setFont("Helvetica-Bold", 14)
        c.setFillColor(C_AMBER)
        c.drawString(716, gy + 98, gt)
        draw_wrapped_text(c, gd, 716, gy + 74, 494, size=11, leading=16.5, color=C_TEXT2)

    c.showPage()

    # --- SLIDE 6: VÍDEO & RESGATE SONY CYBER-SHOT .AVI ---
    start_slide(c, 6, TOTAL, "05 · Vídeo & Cyber-shot .AVI")
    c.setFont("Helvetica-Bold", 34)
    c.setFillColor(C_TEXT1)
    c.drawString(48, 594, "Edição de Vídeo & Resgate de .AVI Cyber-shot")
    draw_wrapped_text(
        c,
        "Câmeras compactas digitais dos anos 2000 (como a Sony Cyber-shot) gravam clipes em .AVI MJPEG + áudio PCM que celulares e navegadores modernos não reproduzem. O Pixelar decodifica esses arquivos nativamente e aplica todo o motor de filmes e Lab ao vivo.",
        48, 554, 960, size=13, leading=19, color=C_TEXT2
    )

    # Visual Pipeline Flow Diagram
    steps = [
        ("ENTRADA", ".AVI / MP4 / MOV / WebM", "Parser binário RIFF/AVI em JS extrai cada frame MJPEG + trilha de áudio PCM 16-bit/8-bit."),
        ("MOTOR GPU", "Shaders em Tempo Real", "Cada frame passa pelos 6 estágios WebGL2: filmes, Vencido, grão, halação, Lab e geometria."),
        ("PLAYER", "Scrubbing + Áudio Sync", "Reprodução fluida com Web Audio API sincronizada e barra de tempo flutuante em todas as telas."),
        ("EXPORTAÇÃO", "MP4 / WebM Moderno", "Gravação quadro a quadro na resolução original com efeitos e áudio prontos para compartilhar."),
    ]
    for i, (tag, head, desc) in enumerate(steps):
        sx = 48 + i * 300
        draw_card(c, sx, 260, 276, 226, r=12, fill=C_CARD, stroke=C_AMBER if i == 1 else C_BORDER_HI)
        draw_pill(c, sx + 18, 444, tag, bg=C_AMBER_DIM if i == 1 else C_SURFACE, fg=C_AMBER, border=C_AMBER_DIM, size=8, h=18, pad_x=8)
        c.setFont("Helvetica-Bold", 14)
        c.setFillColor(C_TEXT1)
        c.drawString(sx + 18, 412, head)
        draw_wrapped_text(c, desc, sx + 18, 384, 240, size=10.8, leading=16.5, color=C_TEXT2)
        if i < 3:
            # Connector arrow
            ax = sx + 281
            ay = 372
            c.setStrokeColor(C_AMBER)
            c.setLineWidth(1.6)
            c.line(ax, ay, ax + 14, ay)
            c.line(ax + 10, ay + 4, ax + 14, ay)
            c.line(ax + 10, ay - 4, ax + 14, ay)

    # Bottom highlight card with real B&W + Gold visual contrast
    draw_card(c, 48, 78, SLIDE_W - 96, 150, r=12, fill=C_SURFACE, stroke=C_BORDER)
    draw_clipped_image(c, photos["bw"], 68, 96, 174, 114, r=7, border=C_BORDER_HI)
    draw_clipped_image(c, photos["gold"], 256, 96, 174, 114, r=7, border=C_AMBER)
    c.setFont("Helvetica-Bold", 15)
    c.setFillColor(C_TEXT1)
    c.drawString(458, 180, "Mesma Receita em Foto e Vídeo — Sem Reconfigurar Nada")
    draw_wrapped_text(
        c,
        "Ajuste um look analógico em uma foto da sessão e aplique exatamente a mesma receita em um vídeo MP4 ou clipe .AVI da Cyber-shot. Se quiser levar o grade para o DaVinci Resolve ou Premiere, exporte uma 3D LUT padrão (.cube 17×17×17) em 1 segundo.",
        458, 152, 748, size=11.5, leading=17.5, color=C_TEXT2
    )

    c.showPage()

    # --- SLIDE 7: EXPERIÊNCIA MULTIPLATAFORMA SOB MEDIDA ---
    start_slide(c, 7, TOTAL, "06 · UX/UI Nativa Multiplataforma")
    c.setFont("Helvetica-Bold", 34)
    c.setFillColor(C_TEXT1)
    c.drawString(48, 594, "Três Interfaces Sob Medida. Um Único Coração.")
    draw_wrapped_text(
        c,
        "Projetado com rigor de interface nativa: zero emojis improvisados, ícones vetoriais pixel-art unificados, cantos concêntricos, feedback háptico no iOS e preservação exata da posição de rolagem em todos os carrosséis.",
        48, 554, 1020, size=12.8, leading=18.5, color=C_TEXT2
    )
    draw_device_mockups(c, photos)

    c.showPage()

    # --- SLIDE 8: ENGENHARIA & ARQUITETURA (COMO FOI FEITO) ---
    start_slide(c, 8, TOTAL, "07 · Arquitetura & Engenharia")
    c.setFont("Helvetica-Bold", 34)
    c.setFillColor(C_TEXT1)
    c.drawString(48, 594, "Como Foi Construído: Engenharia Limpa e Modular")
    draw_wrapped_text(
        c,
        "Sem frameworks pesados, sem backend e sem dependências externas em tempo de execução. Uma base modular enxuta compila automaticamente para todas as plataformas.",
        48, 554, 960, size=13, leading=19, color=C_TEXT2
    )

    # Top Diagram: 6-Pass WebGL2 GPU Pipeline
    draw_card(c, 48, 360, SLIDE_W - 96, 156, r=12, fill=C_SURFACE, stroke=C_BORDER_HI)
    c.setFont("Courier-Bold", 10)
    c.setFillColor(C_AMBER)
    c.drawString(68, 490, "PIPELINE GRÁFICO WEBGL2 (GLSL ES 3.00  ·  FLOAT PING-PONG FRAMEBUFFERS)")

    passes = [
        ("PASS 0", "Geometria", "Homografia, Lente, Auto-Corte"),
        ("PASS 1", "Revelação", "Luz, Curva LUT, HSL, Química"),
        ("PASS 2", "Bloom H", "Extração & Blur Horizontal"),
        ("PASS 3", "Halação V", "Blur Vertical + Halo Vermelho"),
        ("PASS 4", "Óptica", "Grão, Vinheta, Flare, Flash"),
        ("PASS 5", "Lab Criativo", "18 FX, Paletas, Pixel, Dither"),
    ]
    pw_box = 176
    for i, (ptag, ptitle, psub) in enumerate(passes):
        px = 68 + i * 194
        draw_card(c, px, 382, pw_box, 92, r=8, fill=C_CARD, stroke=C_AMBER if i in (0, 5) else C_BORDER_HI)
        c.setFont("Courier-Bold", 9)
        c.setFillColor(C_AMBER)
        c.drawString(px + 12, 452, ptag)
        c.setFont("Helvetica-Bold", 12)
        c.setFillColor(C_TEXT1)
        c.drawString(px + 12, 432, ptitle)
        draw_wrapped_text(c, psub, px + 12, 414, pw_box - 22, size=8.8, leading=12.5, color=C_TEXT2)
        if i < 5:
            ax = px + pw_box + 4
            c.setStrokeColor(C_AMBER)
            c.setLineWidth(1.3)
            c.line(ax, 428, ax + 10, 428)

    # Bottom 2 Cards: Modular Source -> Multi-Target Build
    draw_card(c, 48, 80, 578, 250, r=12, fill=C_CARD, stroke=C_BORDER)
    c.setFont("Courier-Bold", 10)
    c.setFillColor(C_AMBER)
    c.drawString(70, 302, "BASE MODULAR ÚNICA (ZERO DEPENDÊNCIAS)")
    modules = [
        ("state.js + presets.js", "Estado imutável, histórico Undo/Redo, catálogo de filmes e 24 receitas do Lab."),
        ("gpu.js", "6 shaders GLSL ES 3.00 com pooling de texturas, fallback CPU e gerador 3D LUT .cube."),
        ("video.js", "Decodificador binário RIFF/AVI (MJPEG + PCM) e gravador MP4/WebM com áudio."),
        ("controller.js + adaptive.js", "Controlador Desktop/macOS + camada adaptativa iPhone Modelo D & iPad 10 Layout 5."),
    ]
    for idx, (mname, mdesc) in enumerate(modules):
        my = 270 - idx * 46
        c.setFont("Courier-Bold", 10.5)
        c.setFillColor(C_TEXT1)
        c.drawString(70, my, mname)
        c.setFont("Helvetica", 9.8)
        c.setFillColor(C_TEXT2)
        c.drawString(70, my - 15, mdesc)

    draw_card(c, 654, 80, 578, 250, r=12, fill=C_CARD, stroke=C_BORDER)
    c.setFont("Courier-Bold", 10)
    c.setFillColor(C_AMBER)
    c.drawString(676, 302, "COMPILAÇÃO NATIVA PARA 4 ENTREGÁVEIS")
    targets = [
        ("Pixelar Studio.app (macOS)", "Binário nativo arm64 em Swift + AppKit + WKWebView, menu macOS, atalhos Command e ícone .icns."),
        ("PixelarStudio-iPhone.xcodeproj", "App SwiftUI travado em Modelo D Glass Pro, Taptic Engine e salvamento no Rolo da Câmera."),
        ("PixelarStudio-iPad10.xcodeproj", "App SwiftUI travado em Layout 5 Darkroom, suporte a multitarefa e compartilhamento nativo."),
        ("HTML Unificado (GitHub / Web)", "Arquivo único autossuficiente que alterna automaticamente entre Desktop, iPad e iPhone."),
    ]
    for idx, (tname, tdesc) in enumerate(targets):
        ty = 270 - idx * 46
        c.setFont("Helvetica-Bold", 11)
        c.setFillColor(C_TEXT1)
        c.drawString(676, ty, tname)
        c.setFont("Helvetica", 9.8)
        c.setFillColor(C_TEXT2)
        c.drawString(676, ty - 15, tdesc)

    c.showPage()

    # --- SLIDE 9: EXPORTAÇÃO PROFISSIONAL & WORKFLOW ---
    start_slide(c, 9, TOTAL, "08 · Exportação & Fluxo Profissional")
    c.setFont("Helvetica-Bold", 34)
    c.setFillColor(C_TEXT1)
    c.drawString(48, 594, "Exportação Sem Perdas & Ecossistema Aberto")
    draw_wrapped_text(
        c,
        "Seu trabalho nunca fica preso dentro do aplicativo. O Pixelar exporta na resolução original da câmera e integra com ferramentas profissionais do mercado.",
        48, 554, 960, size=13, leading=19, color=C_TEXT2
    )

    formats = [
        ("PNG", "Qualidade Máxima Sem Perdas",
         "Renderiza em 100% da resolução original da foto e injeta a receita completa em um chunk PNG tEXt com checksum CRC32 válido — compatível com qualquer visualizador."),
        ("JPEG / WebP", "Editorial & Web Com Controle",
         "Slider de compressão de 60% a 100% preservando dimensões originais. Ideal para portfólios, redes sociais e entrega rápida a clientes."),
        ("3D LUT .cube", "Ponte Para Cinema & Lightroom",
         "Exporta tabela tridimensional 17×17×17 padrão da indústria para aplicar o mesmo look no Adobe Lightroom, DaVinci Resolve, Premiere e Final Cut."),
        ("Receita .json", "Fluxo Não-Destrutivo Portável",
         "Copie, importe e compartilhe receitas completas (curvas, HSL, química, Lab e geometria) entre macOS, iPhone, iPad e colaboradores."),
    ]
    for i, (badge, title, desc) in enumerate(formats):
        col = i % 2
        row = i // 2
        fx = 48 + col * 604
        fy = 320 - row * 212
        draw_card(c, fx, fy, 580, 190, r=12, fill=C_CARD, stroke=C_BORDER_HI)
        draw_pill(c, fx + 24, fy + 144, badge, bg=C_AMBER_DIM, fg=C_AMBER, border=C_AMBER, font="Courier-Bold", size=10, h=24, pad_x=12)
        c.setFont("Helvetica-Bold", 16)
        c.setFillColor(C_TEXT1)
        c.drawString(fx + 24, fy + 110, title)
        draw_wrapped_text(c, desc, fx + 24, fy + 84, 530, size=11.5, leading=17.5, color=C_TEXT2)

    c.showPage()

    # --- SLIDE 10: ENCERRAMENTO EDITORIAL ---
    c.setFillColor(C_BG)
    c.rect(0, 0, SLIDE_W, SLIDE_H, stroke=0, fill=1)
    c.setStrokeColor(C_BORDER)
    c.setLineWidth(0.8)
    c.line(48, 668, SLIDE_W - 48, 668)
    c.line(48, 56, SLIDE_W - 48, 56)

    # Center editorial showcase strip (5 small visual frames across the top)
    strip_keys = ["orig", "gold", "vencido", "riso", "pixel"]
    sw = 220
    for idx, k in enumerate(strip_keys):
        draw_clipped_image(c, photos[k], 48 + idx * 241, 466, sw, 146, r=8, border=C_AMBER if idx == 1 else C_BORDER_HI)

    # Center Lockup
    draw_pixelar_logo(c, SLIDE_W / 2.0 - 38, 344, 76, bg_box=True, radius=18)
    c.setFont("Helvetica-Bold", 44)
    c.setFillColor(C_TEXT1)
    c.drawCentredString(SLIDE_W / 2.0, 282, "Pixelar Studio")
    c.setFont("Helvetica", 16)
    c.setFillColor(C_AMBER)
    c.drawCentredString(SLIDE_W / 2.0, 248, "Fotografia analógica, laboratório criativo e precisão editorial em qualquer tela.")

    # Deliverable badges row
    deliverables = [
        "Pixelar Studio.app (macOS)",
        "pixelar_studio_unified.html (Web)",
        "PixelarStudio-iPhone (Xcode)",
        "PixelarStudio-iPad10 (Xcode)",
    ]
    total_w = sum(stringWidth(d, "Courier-Bold", 9.5) + 28 for d in deliverables) + 12 * 3
    dx = (SLIDE_W - total_w) / 2.0
    for d in deliverables:
        pw = draw_pill(c, dx, 168, d, bg=C_CARD, fg=C_TEXT1, border=C_BORDER_HI, font="Courier-Bold", size=9.5, h=26, pad_x=14)
        dx += pw + 12

    c.setFont("Courier", 10)
    c.setFillColor(C_TEXT3)
    c.drawCentredString(SLIDE_W / 2.0, 96, "PRONTO PARA USO LOCAL, PUBLICAÇÃO NO GITHUB E TESTE DIRETO NO XCODE (IPHONE & IPAD 10)")
    c.drawRightString(SLIDE_W - 48, 22, "10 / 10")
    c.drawString(48, 22, "PIXELAR STUDIO  ·  APRESENTAÇÃO OFICIAL")

    c.showPage()
    c.save()
    print(f"Built Keynote PDF: {out_path}")

# =========================================================================
# BUILD DELIVERABLE 2: A4 1-PAGE EXECUTIVE SHOWCASE SHEET
# =========================================================================
def build_executive_pdf(photos, out_path):
    W, H = A4  # 595.28 x 841.89 pt
    c = canvas.Canvas(out_path, pagesize=A4)
    c.setTitle("Pixelar Studio — Resumo Executivo")
    c.setAuthor("Pixelar Studio")

    # Background
    c.setFillColor(C_BG)
    c.rect(0, 0, W, H, stroke=0, fill=1)

    # Top Header Band
    c.setFillColor(colors.HexColor("#111116"))
    c.rect(0, H - 122, W, 122, stroke=0, fill=1)
    c.setStrokeColor(C_BORDER)
    c.setLineWidth(0.9)
    c.line(0, H - 122, W, H - 122)

    draw_pixelar_logo(c, 34, H - 94, 54, bg_box=True, radius=12)
    c.setFont("Helvetica-Bold", 26)
    c.setFillColor(C_TEXT1)
    c.drawString(102, H - 64, "Pixelar Studio")
    c.setFont("Helvetica-Bold", 10)
    c.setFillColor(C_AMBER)
    c.drawString(102, H - 82, "Estúdio Analógico, Lab Criativo & Geometria em GPU")
    c.setFont("Courier", 8.2)
    c.setFillColor(C_TEXT3)
    c.drawString(102, H - 98, "RESUMO EXECUTIVO  ·  VERSÃO 2.0  ·  100% LOCAL & ZERO ASSINATURA")

    # Right KPI badge in header
    draw_card(c, W - 150, H - 96, 116, 56, r=8, fill=C_CARD, stroke=C_AMBER_DIM)
    c.setFont("Courier-Bold", 15)
    c.setFillColor(C_AMBER)
    c.drawCentredString(W - 92, H - 64, "WebGL2")
    c.setFont("Helvetica", 8)
    c.setFillColor(C_TEXT2)
    c.drawCentredString(W - 92, H - 80, "6 Passes · 60 FPS")

    # Visual 4-Panel Before / After Contact Strip
    c.setFont("Courier-Bold", 8.5)
    c.setFillColor(C_AMBER)
    c.drawString(34, H - 144, "TRANSFORMAÇÕES REAIS EM TEMPO REAL  (AMOSTRA: PINACOTECA · OCTÓGONO)")

    strip = [
        ("orig", "Original"),
        ("gold", "Kodak Gold 200"),
        ("riso", "Lab · Risograph"),
        ("pixel", "Lab · Pixel Art 8c"),
    ]
    tw = 125
    for idx, (k, lbl) in enumerate(strip):
        tx = 34 + idx * 134
        ty = H - 252
        draw_card(c, tx, ty, tw, 98, r=7, fill=C_CARD, stroke=C_AMBER if idx == 1 else C_BORDER_HI)
        draw_clipped_image(c, photos[k], tx + 4, ty + 20, tw - 8, 74, r=5, border=None)
        c.setFont("Helvetica-Bold", 8)
        c.setFillColor(C_AMBER if idx == 1 else C_TEXT1)
        c.drawCentredString(tx + tw / 2, ty + 6.5, lbl)

    # Key Numbers Bar
    kpis = [
        ("13", "Químicas 35mm"),
        ("24", "Receitas Lab"),
        ("18", "Texturas GPU"),
        ("6", "Grades Geom."),
        ("4", "Plataformas"),
    ]
    draw_card(c, 34, H - 314, W - 68, 48, r=8, fill=C_SURFACE, stroke=C_BORDER)
    kw = (W - 68) / len(kpis)
    for i, (v, l) in enumerate(kpis):
        kx = 34 + i * kw + kw / 2
        if i > 0:
            c.setStrokeColor(C_BORDER)
            c.line(34 + i * kw, H - 306, 34 + i * kw, H - 274)
        c.setFont("Courier-Bold", 14)
        c.setFillColor(C_AMBER)
        c.drawCentredString(kx, H - 288, v)
        c.setFont("Helvetica", 7.8)
        c.setFillColor(C_TEXT2)
        c.drawCentredString(kx, H - 303, l)

    # Two-Column Editorial Content
    col_w = 256
    left_x = 34
    right_x = 305

    # LEFT COLUMN: POSSIBILIDADES DO APP
    draw_card(c, left_x, 96, col_w, 418, r=10, fill=C_CARD, stroke=C_BORDER_HI)
    c.setFont("Courier-Bold", 8.8)
    c.setFillColor(C_AMBER)
    c.drawString(left_x + 14, 492, "RECURSOS & POSSIBILIDADES")

    features = [
        ("Filmes 35mm & Química Vencida",
         "Emulação de películas clássicas, P&B Prata, Redscale, Film Soup, Raio-X e Vencido Viva com camadas R/G/B, véu químico, manchas e light leak."),
        ("Câmara Escura Completa",
         "Histograma RGB vivo, Auto Luz, Curva de Tons RGB/R/G/B, Misturador HSL (8 cores), Rodas 3-Vias, Halação, Pro-Mist, Orton Dream e Anamorphic Flare."),
        ("Laboratório Criativo Modular",
         "4 módulos colapsáveis (Receitas, 18 Texturas com 5 blend modes, Paletas 2–256 cores/Duotone/Tritone, Pixel Art & Dither Bayer/Atkinson) + Remix."),
        ("Geometria & Lente (Lightroom)",
         "Horizonte ±45°, Keystone V/H, Skew, Alongar, Distorção Barril/Almofada, Auto-Corte sem bordas pretas e 6 grades vetoriais de composição."),
        ("Vídeo & Resgate Cyber-shot .AVI",
         "Decodificador RIFF/AVI (MJPEG + áudio PCM) embutido para assistir, editar com efeitos GPU e converter em MP4/WebM moderno."),
    ]
    cy = 468
    for title, desc in features:
        c.setFont("Helvetica-Bold", 10)
        c.setFillColor(C_TEXT1)
        c.drawString(left_x + 14, cy, title)
        cy = draw_wrapped_text(c, desc, left_x + 14, cy - 13, col_w - 28, size=8.4, leading=11.8, color=C_TEXT2)
        cy -= 12

    # RIGHT COLUMN TOP: COMO FOI FEITO (PIPELINE GPU)
    draw_card(c, right_x, 312, col_w, 202, r=10, fill=C_CARD, stroke=C_BORDER_HI)
    c.setFont("Courier-Bold", 8.8)
    c.setFillColor(C_AMBER)
    c.drawString(right_x + 14, 492, "ARQUITETURA & COMO FOI FEITO")
    draw_wrapped_text(
        c,
        "Motor gráfico autoral em WebGL2 (GLSL ES 3.00) sem servidor nem nuvem. Cada frame percorre 6 passes sequenciais em memória de vídeo:",
        right_x + 14, 474, col_w - 28, size=8.5, leading=12, color=C_TEXT2
    )
    gpu_steps = [
        ("P0", "Geometria & Lente (Homografia + Auto-Corte)"),
        ("P1", "Revelação (Luz, Curva, HSL, Grading, Química)"),
        ("P2-3", "Bloom Pro-Mist & Halação Separável"),
        ("P4", "Óptica (Grão Orgânico, Vinheta, Flare, Flash)"),
        ("P5", "Lab (18 FX, Paletas, Pixel Art & Dither)"),
    ]
    py = 428
    for code, txt in gpu_steps:
        draw_pill(c, right_x + 14, py - 3, code, bg=C_AMBER_DIM, fg=C_AMBER, border=C_AMBER_DIM, font="Courier-Bold", size=7.5, h=15, pad_x=6)
        c.setFont("Helvetica", 8.3)
        c.setFillColor(C_TEXT1)
        c.drawString(right_x + 56, py + 1.5, txt)
        py -= 22

    # RIGHT COLUMN BOTTOM: ECOSSISTEMA MULTIPLATAFORMA & EXPORTAÇÃO
    draw_card(c, right_x, 96, col_w, 204, r=10, fill=C_CARD, stroke=C_BORDER_HI)
    c.setFont("Courier-Bold", 8.8)
    c.setFillColor(C_AMBER)
    c.drawString(right_x + 14, 278, "ECOSSISTEMA & EXPORTAÇÃO")

    plats = [
        ("macOS App (.app arm64)", "Swift + WKWebView + NSSavePanel nativo, UI Desktop pura."),
        ("iPhone (Xcode · Modelo D)", "Glass Pro, Área Livre Inteligente, régua tátil e Haptics."),
        ("iPad 10 (Xcode · Layout 5)", "Sessão lateral, palco amplo, régua larga e popovers."),
        ("Web Single-File (.html)", "Arquivo único autossuficiente pronto para GitHub Pages."),
        ("Exportação Sem Perdas", "PNG (receita em chunk tEXt CRC32), JPEG, WebP, 3D LUT .cube e vídeo MP4/WebM."),
    ]
    ey = 256
    for ptitle, pdesc in plats:
        c.setFont("Helvetica-Bold", 9)
        c.setFillColor(C_TEXT1)
        c.drawString(right_x + 14, ey, ptitle)
        ey = draw_wrapped_text(c, pdesc, right_x + 14, ey - 11.5, col_w - 28, size=8.1, leading=11, color=C_TEXT2)
        ey -= 9

    # Footer Band
    c.setStrokeColor(C_BORDER)
    c.line(34, 72, W - 34, 72)
    draw_pixelar_logo(c, 34, 34, 24, bg_box=True, radius=5)
    c.setFont("Helvetica-Bold", 9.5)
    c.setFillColor(C_TEXT1)
    c.drawString(66, 46, "Pixelar Studio")
    c.setFont("Helvetica", 8)
    c.setFillColor(C_TEXT3)
    c.drawString(66, 35, "Projetado com UX nativa para macOS, Web, iPhone e iPad 10")
    c.setFont("Courier-Bold", 8.2)
    c.setFillColor(C_AMBER)
    c.drawRightString(W - 34, 42, "100% LOCAL · GPU 60 FPS · QUALIDADE ORIGINAL")

    c.showPage()
    c.save()
    print(f"Built Executive PDF: {out_path}")

if __name__ == "__main__":
    photos = generate_photo_samples()
    build_keynote_pdf(photos, os.path.join(ROOT, "Pixelar_Studio_Apresentacao.pdf"))
    build_executive_pdf(photos, os.path.join(ROOT, "Pixelar_Studio_Resumo_Executivo.pdf"))
