"""Frames raw simulator screenshots into App Store images with a caption.
usage: python3 store/frame.py <raw dir> <out dir> <width> <height> <prefix>"""
import json, sys, os, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter
raw, out, W, H, prefix = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
os.makedirs(out, exist_ok=True)
listing = json.load(open('store/listing.json'))
eyebrows = listing.get('eyebrows', {})
pad = prefix == 'pad'
big = ImageFont.truetype('apple/Bearings/Fonts/Geist-Bold.ttf', int(W * (0.058 if pad else 0.082)))
mono = ImageFont.truetype('apple/Bearings/Fonts/GeistMono-SemiBold.ttf', int(W * (0.018 if pad else 0.026)))
BG, AMBER, INK = (0x12, 0x0F, 0x22), (0xFF, 0xB0, 0x20), (0xF6, 0xF3, 0xFF)


def backdrop():
    bg = Image.new('RGB', (W, H), BG)
    glow = Image.new('L', (W, H), 0)
    ImageDraw.Draw(glow).ellipse((W * 0.1, H * 0.28, W * 0.9, H * 0.28 + W * 0.8), fill=90)
    bg.paste((0x3A, 0x2C, 0x6E), mask=glow.filter(ImageFilter.GaussianBlur(W * 0.18)))
    # compass rings behind the phone, a nod to the app
    rings = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rings)
    cx, cy = W * 0.5, H * 0.62
    for i, r in enumerate([0.22, 0.38, 0.54, 0.70, 0.86]):
        rr = W * r
        rd.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), outline=(255, 176, 32, 40 if i < 4 else 60), width=max(2, W // 600))
    for k in range(12):
        a = k / 12 * 2 * math.pi
        rd.line((cx + math.cos(a) * W * 0.22, cy + math.sin(a) * W * 0.22, cx + math.cos(a) * W * 0.86, cy + math.sin(a) * W * 0.86), fill=(255, 255, 255, 14), width=max(1, W // 900))
    bg.paste(rings, (0, 0), rings)
    return bg


for i, (name, _, caption) in enumerate(listing['screens']):
    src = os.path.join(raw, f'{prefix}-{name}.png')
    if not os.path.exists(src):
        continue
    bg = backdrop()
    d = ImageDraw.Draw(bg)
    margin = int(W * 0.08)
    y = int(H * 0.055)
    brow = eyebrows.get(name, '')
    if brow:
        d.text((margin, y), brow, font=mono, fill=AMBER)
        y += int(mono.size * 1.9)
    words, lines, cur = caption.split(), [], ''
    for w in words:
        test = (cur + ' ' + w).strip()
        if d.textlength(test, font=big) > W - margin * 2 and cur:
            lines.append(cur); cur = w
        else:
            cur = test
    lines.append(cur)
    for ln in lines[:2]:
        d.text((margin, y), ln, font=big, fill=INK)
        y += int(big.size * 1.12)
    # the screen, large, running off the bottom edge
    shot = Image.open(src).convert('RGB')
    top = y + int(H * 0.035)
    sw = int(W * (0.80 if pad else 0.86))
    scale = sw / shot.width
    sh = int(shot.height * scale)
    shot = shot.resize((sw, sh), Image.LANCZOS)
    r = int(sw * (0.035 if pad else 0.11))
    mask = Image.new('L', (sw, sh), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, sw - 1, sh - 1), r, fill=255)
    x0 = (W - sw) // 2
    shadow = Image.new('L', (W, H), 0)
    ImageDraw.Draw(shadow).rounded_rectangle((x0, top + 30, x0 + sw, top + sh + 30), r, fill=170)
    bg.paste((4, 2, 12), mask=shadow.filter(ImageFilter.GaussianBlur(50)))
    bezel = int(W * 0.012)
    ImageDraw.Draw(bg).rounded_rectangle((x0 - bezel, top - bezel, x0 + sw + bezel, top + sh + bezel), r + bezel, fill=(0x2A, 0x26, 0x3A))
    bg.paste(shot, (x0, top), mask)
    bg.save(os.path.join(out, f'{prefix}-{i + 1:02d}.png'))
    print('framed', name)
