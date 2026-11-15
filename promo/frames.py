# Builds the still frames Higgsfield animates from: a screenshot as a rounded, shadowed card on a backdrop.
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent
SHOTS = ROOT.parent / "e2e" / "screenshots" / "out"
OUT = ROOT / "frames"

def backdrop(w, h, dark):
    top, bot = ((14, 17, 22), (30, 35, 44)) if dark else ((236, 239, 243), (210, 216, 225))
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / (h - 1)
        d.line([(0, y), (w, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(top, bot)))
    return img

def card(shot, width, radius, dark, bezel=0):
    im = Image.open(shot).convert("RGB")
    im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    if bezel:
        frame = Image.new("RGB", (im.width + bezel * 2, im.height + bezel * 2), (18, 20, 24))
        frame.paste(im, (bezel, bezel), rounded_mask(im.size, max(radius - bezel, 8)))
        im = frame
    return im, rounded_mask(im.size, radius)

def rounded_mask(size, r):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], r, fill=255)
    return m

def compose(shot, out, w, h, width, radius, dark, bezel=0):
    bg = backdrop(w, h, dark)
    im, mask = card(shot, width, radius, dark, bezel)
    x, y = (w - im.width) // 2, (h - im.height) // 2
    shadow = Image.new("L", (w, h), 0)
    shadow.paste(mask, (x, y + 30))
    shadow = shadow.filter(ImageFilter.GaussianBlur(40))
    bg.paste(Image.new("RGB", (w, h), (0, 0, 0)), (0, 0), shadow.point(lambda v: int(v * (0.7 if dark else 0.35))))
    bg.paste(im, (x, y), mask)
    bg.save(out, quality=95)

for theme in ("dark", "light"):
    dark = theme == "dark"
    compose(SHOTS / f"desktop-{theme}" / "05-dashboard.png", OUT / f"desktop-{theme}.png", 1920, 1080, 1500, 18, dark)
    compose(SHOTS / f"mobile-{theme}" / "05-dashboard.png", OUT / f"mobile-{theme}.png", 1080, 1920, 620, 64, dark, bezel=14)
print("ok")
