"""Genera los íconos de la app (se ejecuta una sola vez).

Uso:  python3 tools/make_icons.py RUTA/A/CormorantGaramond.ttf
Crea en icons/: icon-192.png, icon-512.png, maskable-512.png,
apple-touch-icon.png (180) y favicon-32.png.
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

BG = (24, 21, 18)       # #181512
CORAL = (201, 123, 99)  # #c97b63
OUT = Path(__file__).resolve().parent.parent / "icons"


def draw_icon(size, font_path, scale, line=True):
    """scale = alto de la letra respecto al ícono (menor en maskable)."""
    big = size * 4  # dibujar grande y reducir para bordes suaves
    img = Image.new("RGB", (big, big), BG)
    d = ImageDraw.Draw(img)
    # brillo coral suave arriba a la derecha, como la portada
    glow = Image.new("L", (big, big), 0)
    ImageDraw.Draw(glow).ellipse((big * 0.35, -big * 0.45, big * 1.45, big * 0.65), fill=70)
    from PIL import ImageFilter
    glow = glow.filter(ImageFilter.GaussianBlur(big * 0.12))
    img.paste(Image.new("RGB", (big, big), CORAL), (0, 0), glow)

    font = ImageFont.truetype(font_path, int(big * scale * 1.35))
    l, t, r, b = d.textbbox((0, 0), "A", font=font)
    w, h = r - l, b - t
    gap = big * scale * 0.12 if line else 0
    lh = max(2, int(big * 0.018)) if line else 0
    total = h + gap + lh
    x = (big - w) / 2 - l
    y = (big - total) / 2 - t
    d.text((x, y), "A", font=font, fill=CORAL)
    if line:
        lw = big * scale * 0.42
        ly = (big - total) / 2 + h + gap
        d.rounded_rectangle(((big - lw) / 2, ly, (big + lw) / 2, ly + lh), radius=lh / 2, fill=CORAL)
    return img.resize((size, size), Image.LANCZOS)


def main():
    font = sys.argv[1] if len(sys.argv) > 1 else "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf"
    OUT.mkdir(exist_ok=True)
    draw_icon(192, font, 0.52).save(OUT / "icon-192.png", optimize=True)
    draw_icon(512, font, 0.52).save(OUT / "icon-512.png", optimize=True)
    draw_icon(512, font, 0.38).save(OUT / "maskable-512.png", optimize=True)  # zona segura 80%
    draw_icon(180, font, 0.50).save(OUT / "apple-touch-icon.png", optimize=True)
    draw_icon(32, font, 0.70, line=False).save(OUT / "favicon-32.png", optimize=True)
    print("Íconos creados en", OUT)


if __name__ == "__main__":
    main()
