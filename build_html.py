#!/usr/bin/env python3
"""Assembles modular src/ files into a standalone pixelar_studio_v2_pc.html."""
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
    "  </style>\n"
    + read("body.html").rstrip() + "\n"
    "  <!-- === EMBEDDED STUDY SAMPLES === -->\n"
    "  <script>\n"
    + read("samples.js").rstrip() + "\n"
    "  </script>\n"
    "  <!-- === CORE ENGINE (SHARED PC + MOBILE): STATE & LAB PRESETS === -->\n"
    "  <script>\n"
    + read("state.js").rstrip() + "\n"
    "  </script>\n"
    "  <!-- === CORE ENGINE (SHARED PC + MOBILE): FILM & CAMERA CATALOG === -->\n"
    "  <script>\n"
    + read("presets.js").rstrip() + "\n"
    "  </script>\n"
    "  <!-- === SMART PROCEDURAL RANDOMIZATION ENGINE === -->\n"
    "  <script>\n"
    + read("procedural.js").rstrip() + "\n"
    "  </script>\n"
    "  <!-- === CORE ENGINE (SHARED PC + MOBILE): WEBGL2 GPU + GEOMETRY + 18 LAB FX === -->\n"
    "  <script>\n"
    + read("gpu.js").rstrip() + "\n"
    "  </script>\n"
    "  <!-- === CORE ENGINE (SHARED PC + MOBILE): VIDEO & CYBER-SHOT AVI DECODER === -->\n"
    "  <script>\n"
    + read("video.js").rstrip() + "\n"
    "  </script>\n"
    "  <!-- === UI CONTROLLER & NATIVE MACOS BRIDGE === -->\n"
    "  <script>\n"
    + read("controller.js").rstrip() + "\n"
    "  </script>\n"
    "</body>\n"
    "</html>\n"
    "<!-- Pixelar Studio v2.0 PC & macOS Native Ready -->\n"
)

dest = os.path.join(ROOT, "pixelar_studio_v2_pc.html")
with open(dest, "w", encoding="utf-8") as f:
    f.write(out)

print(f"Built {dest} ({len(out):,} bytes, {out.count(chr(10)):,} lines)")
