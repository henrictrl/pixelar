#!/usr/bin/env python3
"""Generates Pixelar Studio's official yellow sunset macOS AppIcon.png (1024x1024) and AppIcon.icns."""
import os, struct, zlib, math, subprocess, shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
PNG_1024 = os.path.join(ROOT, "AppIcon_1024.png")
ICONSET = os.path.join(ROOT, "AppIcon.iconset")
ICNS_OUT = os.path.join(ROOT, "AppIcon.icns")

SIZE = 1024

# Official Pixelar Studio 12x11 Sunset Logo (exact 1:1 grid extracted from official artwork)
SUNSET_GRID = [
    "....####....",
    "..########..",
    ".##########.",
    ".##########.",
    "############",
    "............",
    "############",
    "............",
    ".##########.",
    "............",
    "...######...",
]

def write_png(path, w, h, rgba_bytes):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)
        raw.extend(rgba_bytes[y * stride:(y + 1) * stride])
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 6)))
        f.write(chunk(b"IEND", b""))

def superellipse_sdf(x, y, rx, ry, n=4.8):
    ax = abs(x) / rx
    ay = abs(y) / ry
    return (ax ** n + ay ** n) ** (1.0 / n) - 1.0

def generate_1024():
    buf = bytearray(SIZE * SIZE * 4)
    cx = SIZE * 0.5
    cy = SIZE * 0.5
    outer_r = 412.0

    # Exact 12x11 logo centered inside the macOS 824x824 squircle
    cell = 48.0
    logo_w = 12.0 * cell
    logo_h = 11.0 * cell
    ox = cx - logo_w * 0.5
    oy = cy - logo_h * 0.5

    for y in range(SIZE):
        dy = y - cy
        row_off = y * SIZE * 4
        for x in range(SIZE):
            dx = x - cx
            sd = superellipse_sdf(dx, dy, outer_r, outer_r, 4.8)
            if sd > 0.008:
                continue
            alpha = 1.0 if sd < -0.004 else max(0.0, min(1.0, (0.008 - sd) / 0.012))

            # Deep obsidian darkroom chassis (#131317 -> #09090B) with subtle warm radial glow behind sun
            gy = max(0.0, min(1.0, (y - 100.0) / 824.0))
            r = 18.0 - gy * 9.0
            g = 18.0 - gy * 9.0
            b = 21.0 - gy * 10.0

            # Subtle warm studio glow radiating softly behind the official yellow sunset
            dist = math.hypot(dx, dy) / 380.0
            if dist < 1.0:
                glow = ((1.0 - dist) ** 2.2) * 0.14
                r += 253.0 * glow
                g += 175.0 * glow
                b += 10.0 * glow

            # Subtle crisp metallic bezel rim
            if sd > -0.020:
                rim = (sd + 0.020) / 0.020
                r += 36.0 * rim
                g += 33.0 * rim
                b += 30.0 * rim

            # Exact official yellow sunset logo (#FDAF00)
            gx = int(math.floor((x - ox) / cell))
            gy_idx = int(math.floor((y - oy) / cell))
            if 0 <= gx < 12 and 0 <= gy_idx < 11 and SUNSET_GRID[gy_idx][gx] == "#":
                r, g, b = 253.0, 175.0, 0.0

            idx = row_off + x * 4
            buf[idx] = max(0, min(255, int(r + 0.5)))
            buf[idx + 1] = max(0, min(255, int(g + 0.5)))
            buf[idx + 2] = max(0, min(255, int(b + 0.5)))
            buf[idx + 3] = max(0, min(255, int(alpha * 255.0 + 0.5)))

    write_png(PNG_1024, SIZE, SIZE, buf)
    print("Generated", PNG_1024)

def build_icns():
    if os.path.exists(ICONSET):
        shutil.rmtree(ICONSET)
    os.makedirs(ICONSET, exist_ok=True)
    chunks_spec = [
        (b"icp4", 16),
        (b"icp5", 32),
        (b"icp6", 64),
        (b"ic07", 128),
        (b"ic08", 256),
        (b"ic09", 512),
        (b"ic10", 1024),
        (b"ic11", 32),
        (b"ic12", 64),
        (b"ic13", 256),
        (b"ic14", 512),
    ]
    png_cache = {}
    for px in sorted(set(p for _, p in chunks_spec)):
        dst = os.path.join(ICONSET, f"icon_{px}.png")
        if px == SIZE:
            shutil.copyfile(PNG_1024, dst)
        else:
            subprocess.run(["sips", "-s", "format", "png", "-z", str(px), str(px), PNG_1024, "--out", dst], check=True, stdout=subprocess.DEVNULL)
        with open(dst, "rb") as f:
            png_cache[px] = f.read()

    body = bytearray()
    for tag, px in chunks_spec:
        data = png_cache[px]
        body.extend(tag)
        body.extend(struct.pack(">I", 8 + len(data)))
        body.extend(data)

    with open(ICNS_OUT, "wb") as f:
        f.write(b"icns")
        f.write(struct.pack(">I", 8 + len(body)))
        f.write(body)
    shutil.rmtree(ICONSET, ignore_errors=True)
    print("Built", ICNS_OUT, f"({8 + len(body):,} bytes)")

if __name__ == "__main__":
    generate_1024()
    build_icns()
