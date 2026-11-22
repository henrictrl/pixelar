#!/usr/bin/env python3
"""Assembles the unified responsive Pixelar Studio HTML (Desktop + iPhone Modelo D + iPad 10 Layout 5)."""
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src")

def read(name):
    with open(os.path.join(SRC, name), "r", encoding="utf-8") as f:
        return f.read()

out = (
    read("head.html").rstrip() + "\n"
    "  <style>\n"
    + read("styles.css").rstrip() + "\n"
    + read("adaptive.css").rstrip() + "\n"
    "  </style>\n"
    + read("body.html").rstrip() + "\n"
    "  <!-- === EMBEDDED HIGH-RES SAMPLE (VIVEIRO CCD) === -->\n"
    "  <script>\n"
    + read("samples.js").rstrip() + "\n"
    "  </script>\n"
    "  <!-- === CORE ENGINE (SHARED DESKTOP + IPHONE + IPAD 10) === -->\n"
    "  <script>\n"
    + read("state.js").rstrip() + "\n"
    "  </script>\n"
    "  <script>\n"
    + read("presets.js").rstrip() + "\n"
    "  </script>\n"
    "  <script>\n"
    + read("procedural.js").rstrip() + "\n"
    "  </script>\n"
    "  <script>\n"
    + read("gpu.js").rstrip() + "\n"
    "  </script>\n"
    "  <script>\n"
    + read("video.js").rstrip() + "\n"
    "  </script>\n"
    "  <!-- === DESKTOP CONTROLLER + NATIVE BRIDGE === -->\n"
    "  <script>\n"
    + read("controller.js").rstrip() + "\n"
    "  </script>\n"
    "  <!-- === ADAPTIVE TOUCH UI (IPHONE MODELO D GLASS + IPAD 10 LAYOUT 5 DARKROOM) === -->\n"
    "  <script>\n"
    + read("adaptive.js").rstrip() + "\n"
    "  </script>\n"
    "</body>\n"
    "</html>\n"
    "<!-- Pixelar Studio Unified (Desktop + iPhone Modelo D + iPad 10 Layout 5) -->\n"
)

dest = os.path.join(ROOT, "pixelar_studio_unified.html")
with open(dest, "w", encoding="utf-8") as f:
    f.write(out)

print(f"Built {dest} ({len(out):,} bytes, {out.count(chr(10)):,} lines)")
