"""Frames raw simulator screenshots into App Store images with a caption.
usage: python3 store/frame.py <raw dir> <out dir> <width> <height> <prefix>"""
import json, sys, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter
raw, out, W, H, prefix = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
os.makedirs(out, exist_ok=True)
listing = json.load(open('store/listing.json'))
font = ImageFont.truetype('apple/Bearings/Fonts/Geist-Bold.ttf', int(W * 0.068))
top, bottom = (0x3D, 0x30, 0x78), (0x1C, 0x16, 0x36)
for i, (name, _, caption) in enumerate(listing['screens']):
    src = os.path.join(raw, f'{prefix}-{name}.png')
    if not os.path.exists(src):
        continue
    bg = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(bg)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(top[k] + (bottom[k] - top[k]) * t) for k in range(3)))
    # caption, wrapped to two lines at most
    words, lines, cur = caption.split(), [], ''
    for w in words:
        test = (cur + ' ' + w).strip()
        if d.textlength(test, font=font) > W * 0.84 and cur:
            lines.append(cur); cur = w
        else:
            cur = test
    lines.append(cur)
    y = int(H * 0.06)
    for ln in lines:
        d.text(((W - d.textlength(ln, font=font)) / 2, y), ln, font=font, fill=(0xF4, 0xF1, 0xFF))
        y += int(font.size * 1.18)
    # the screen, scaled with rounded corners and a soft shadow
    shot = Image.open(src).convert('RGB')
    avail_h = H - y - int(H * 0.05)
    scale = min(W * 0.86 / shot.width, avail_h / shot.height)
    sw, sh = int(shot.width * scale), int(shot.height * scale)
    shot = shot.resize((sw, sh), Image.LANCZOS)
    r = int(sw * 0.07)
    mask = Image.new('L', (sw, sh), 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, sw - 1, sh - 1), r, fill=255)
    x0, y0 = (W - sw) // 2, y + int(H * 0.025)
    shadow = Image.new('L', (W, H), 0); ImageDraw.Draw(shadow).rounded_rectangle((x0, y0 + 20, x0 + sw, y0 + sh + 20), r, fill=150)
    bg.paste((10, 6, 24), mask=shadow.filter(ImageFilter.GaussianBlur(40)))
    bg.paste(shot, (x0, y0), mask)
    bg.save(os.path.join(out, f'{prefix}-{i + 1:02d}.png'))
    print('framed', name)
