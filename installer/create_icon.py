"""
Generate installer/icon.ico — the app icon for PDF Annotation Studio.
Run once: python installer/create_icon.py
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

OUT = Path(__file__).parent / "icon.ico"

SIZES = [256, 128, 64, 48, 32, 16]

def make_frame(size):
    img  = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    pad  = int(size * 0.06)
    r    = int(size * 0.18)   # corner radius

    # Background rounded rect — deep indigo
    def rounded_rect(xy, radius, fill):
        x0, y0, x1, y1 = xy
        draw.rectangle([x0 + radius, y0, x1 - radius, y1], fill=fill)
        draw.rectangle([x0, y0 + radius, x1, y1 - radius], fill=fill)
        draw.ellipse([x0, y0, x0 + radius*2, y0 + radius*2], fill=fill)
        draw.ellipse([x1 - radius*2, y0, x1, y0 + radius*2], fill=fill)
        draw.ellipse([x0, y1 - radius*2, x0 + radius*2, y1], fill=fill)
        draw.ellipse([x1 - radius*2, y1 - radius*2, x1, y1], fill=fill)

    rounded_rect([pad, pad, size - pad, size - pad], r, (30, 30, 50, 255))

    # White page shape
    pw   = int(size * 0.46)
    ph   = int(size * 0.58)
    px   = (size - pw) // 2
    py   = int(size * 0.16)
    fold = int(size * 0.12)
    page_pts = [
        (px, py),
        (px + pw - fold, py),
        (px + pw, py + fold),
        (px + pw, py + ph),
        (px, py + ph),
    ]
    draw.polygon(page_pts, fill=(240, 240, 248, 255))
    # fold crease
    draw.polygon([
        (px + pw - fold, py),
        (px + pw - fold, py + fold),
        (px + pw, py + fold),
    ], fill=(180, 180, 200, 255))

    # Green annotation region line
    lw  = int(pw * 0.6)
    ly  = py + int(ph * 0.44)
    lx  = px + int(pw * 0.12)
    lh  = int(ph * 0.14)
    draw.rectangle([lx, ly, lx + lw, ly + lh], fill=(34, 197, 94, 200))

    # Small orange heading bar
    hw = int(pw * 0.7)
    hy = py + int(ph * 0.22)
    hx = px + int(pw * 0.12)
    hh = int(max(2, ph * 0.09))
    draw.rectangle([hx, hy, hx + hw, hy + hh], fill=(245, 158, 11, 220))

    return img


def main():
    frames = [make_frame(s) for s in SIZES]
    frames[0].save(
        str(OUT),
        format="ICO",
        sizes=[(s, s) for s in SIZES],
        append_images=frames[1:],
    )
    print(f"Icon saved → {OUT}")


if __name__ == "__main__":
    main()
