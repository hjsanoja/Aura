"""Crea mock/catalogo-demo.pdf: el PDF de ejemplo que "comparte" la demo (?mock=1).

Uso:  python3 tools/make_demo_pdf.py RUTA/A/CormorantGaramond.ttf
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H = 1240, 1754  # A4 a 150 ppp
DARK, CORAL, CREAM, INK = (24, 21, 18), (201, 123, 99), (250, 247, 242), (26, 26, 26)
OUT = Path(__file__).resolve().parent.parent / "mock" / "catalogo-demo.pdf"


def main():
    serif = sys.argv[1] if len(sys.argv) > 1 else "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf"
    sans = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    cover = Image.new("RGB", (W, H), DARK)
    d = ImageDraw.Draw(cover)
    big = ImageFont.truetype(serif, 220)
    d.text((W / 2, H / 2 - 120), "AURA", font=big, fill=(255, 255, 255), anchor="mm")
    d.rounded_rectangle((W / 2 - 70, H / 2 + 20, W / 2 + 70, H / 2 + 26), radius=3, fill=CORAL)
    d.text((W / 2, H / 2 + 90), "ACTIVEWEAR", font=ImageFont.truetype(sans, 34), fill=CORAL, anchor="mm")
    d.text((W / 2, H - 140), "CATÁLOGO DE DEMOSTRACIÓN", font=ImageFont.truetype(sans, 24), fill=(163, 149, 135), anchor="mm")

    page = Image.new("RGB", (W, H), CREAM)
    d = ImageDraw.Draw(page)
    d.text((110, 150), "Esto es un PDF de ejemplo", font=ImageFont.truetype(serif, 76), fill=INK)
    d.rectangle((110, 260, W - 110, 264), fill=CORAL)
    body = ImageFont.truetype(sans, 30)
    lines = [
        "En la app real, tu Apps Script genera aquí el catálogo",
        "completo con las fotos de Drive y lo deja listo para",
        "compartir por WhatsApp u otra app.",
    ]
    for i, t in enumerate(lines):
        d.text((110, 330 + i * 52), t, font=body, fill=(68, 68, 68))
    cover.save(OUT, "PDF", resolution=150, save_all=True, append_images=[page])
    print("Creado", OUT, OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
