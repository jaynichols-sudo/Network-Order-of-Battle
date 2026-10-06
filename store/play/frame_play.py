"""Frames raw Android screenshots (from store/play/shoot.mjs) into 1080x1920 Google Play
phone screenshots with a caption, in the same style as store/frame.py, and draws the
1024x500 feature graphic.
usage: python3 store/play/frame_play.py <raw dir>   (run from the repo root)"""
import sys, os, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

raw = sys.argv[1] if len(sys.argv) > 1 else 'store/play/raw'
out = 'store/play/screenshots'
os.makedirs(out, exist_ok=True)
FONTS = 'apple/Bearings/Fonts'
BG, AMBER, INK = (0x12, 0x0F, 0x22), (0xFF, 0xB0, 0x20), (0xF6, 0xF3, 0xFF)

# raw name, eyebrow, caption
SCREENS = [
    ('01-today', 'THIS WEEK', 'Who needs you this week'),
    ('02-person', 'EVERY RELATIONSHIP', 'The whole story on one card'),
    ('03-people', 'PLAIN-ENGLISH SEARCH', 'Search the way you think'),
    ('04-compass', 'THE COMPASS', 'Your whole network on one compass'),
    ('05-event', 'EVENT MODE', 'Meet people, then follow up'),
    ('06-catchup', 'SWIPE TO TRIAGE', 'Catch up in two minutes'),
]


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


def backdrop(W, H, cx, cy, ring_scale):
    bg = Image.new('RGB', (W, H), BG)
    glow = Image.new('L', (W, H), 0)
    ImageDraw.Draw(glow).ellipse((cx - W * 0.4, cy - W * 0.4, cx + W * 0.4, cy + W * 0.4), fill=90)
    bg.paste((0x3A, 0x2C, 0x6E), mask=glow.filter(ImageFilter.GaussianBlur(W * 0.18)))
    rings = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rings)
    s = ring_scale
    for i, r in enumerate([0.22, 0.38, 0.54, 0.70, 0.86]):
        rr = s * r
        rd.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), outline=(255, 176, 32, 40 if i < 4 else 60), width=max(2, int(s) // 600))
    for k in range(12):
        a = k / 12 * 2 * math.pi
        rd.line((cx + math.cos(a) * s * 0.22, cy + math.sin(a) * s * 0.22, cx + math.cos(a) * s * 0.86, cy + math.sin(a) * s * 0.86), fill=(255, 255, 255, 14), width=max(1, int(s) // 900))
    bg.paste(rings, (0, 0), rings)
    return bg


def wrap(d, text, f, width):
    lines, cur = [], ''
    for w in text.split():
        test = (cur + ' ' + w).strip()
        if d.textlength(test, font=f) > width and cur:
            lines.append(cur); cur = w
        else:
            cur = test
    lines.append(cur)
    return lines


def phone(bg, shot, x0, top, sw, radius_frac=0.09, bottom=None):
    scale = sw / shot.width
    sh = int(shot.height * scale)
    shot = shot.resize((sw, sh), Image.LANCZOS)
    if bottom is not None and top + sh > bottom:
        sh = bottom - top
        shot = shot.crop((0, 0, sw, sh))
    r = int(sw * radius_frac)
    mask = Image.new('L', (sw, sh), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, sw - 1, sh - 1), r, fill=255)
    W, H = bg.size
    shadow = Image.new('L', (W, H), 0)
    ImageDraw.Draw(shadow).rounded_rectangle((x0, top + 30, x0 + sw, top + sh + 30), r, fill=170)
    bg.paste((4, 2, 12), mask=shadow.filter(ImageFilter.GaussianBlur(50)))
    bezel = max(8, int(W * 0.012))
    ImageDraw.Draw(bg).rounded_rectangle((x0 - bezel, top - bezel, x0 + sw + bezel, top + sh + bezel), r + bezel, fill=(0x2A, 0x26, 0x3A))
    bg.paste(shot, (x0, top), mask)


def screenshots():
    W, H = 1080, 1920
    big, mono = font('Geist-Bold.ttf', int(W * 0.074)), font('GeistMono-SemiBold.ttf', int(W * 0.026))
    n = 0
    for i, (name, brow, caption) in enumerate(SCREENS):
        src = os.path.join(raw, f'{name}.png')
        if not os.path.exists(src):
            print('missing', src); continue
        bg = backdrop(W, H, W * 0.5, H * 0.62, W)
        d = ImageDraw.Draw(bg)
        margin, y = int(W * 0.08), int(H * 0.05)
        d.text((margin, y), brow, font=mono, fill=AMBER)
        y += int(mono.size * 1.9)
        for ln in wrap(d, caption, big, W - margin * 2)[:2]:
            d.text((margin, y), ln, font=big, fill=INK)
            y += int(big.size * 1.12)
        sw = int(W * 0.80)
        phone(bg, Image.open(src).convert('RGB'), (W - sw) // 2, y + int(H * 0.03), sw)
        bg.save(os.path.join(out, f'phone-{i + 1:02d}.png'))
        n += 1
        print('framed', name)
    return n


def feature_graphic():
    W, H = 1024, 500
    bg = backdrop(W, H, W * 0.77, H * 0.56, W * 0.62)
    d = ImageDraw.Draw(bg)
    mark = Image.open('brand/bearings-mark-1024.png').convert('RGBA').resize((92, 92), Image.LANCZOS)
    bg.paste(mark, (64, 70), mark)
    d.text((64, 196), 'Bearings', font=font('Geist-Bold.ttf', 76), fill=INK)
    sub = font('Geist-Medium.ttf', 30)
    y = 296
    for ln in ['Your professional network, mapped.', 'Private, on your phone.']:
        d.text((66, y), ln, font=sub, fill=(0xC9, 0xC2, 0xE6)); y += 42
    d.text((66, 410), 'WHO NEEDS YOU  ·  WHO MOVED  ·  WHO’S NEARBY', font=font('GeistMono-SemiBold.ttf', 15), fill=AMBER)
    # a slice of Today on the right, tilted a touch
    src = os.path.join(raw, '01-today.png')
    if os.path.exists(src):
        shot = Image.open(src).convert('RGB')
        sw = 300
        sh = int(shot.height * sw / shot.width)
        shot = shot.resize((sw, sh), Image.LANCZOS).crop((0, 0, sw, 560))
        card = Image.new('RGBA', (sw + 16, 576), (0x2A, 0x26, 0x3A, 255))
        m = Image.new('L', card.size, 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, card.width - 1, card.height - 1), 34, fill=255)
        inner = Image.new('L', (sw, 560), 0); ImageDraw.Draw(inner).rounded_rectangle((0, 0, sw - 1, 559 + 40), 28, fill=255)
        card.paste(shot, (8, 8), inner)
        card.putalpha(m)
        card = card.rotate(-6, resample=Image.BICUBIC, expand=True)
        sh_ = Image.new('L', (W, H), 0)
        sh_.paste(card.split()[3], (650, 64))
        bg.paste((4, 2, 12), mask=sh_.filter(ImageFilter.GaussianBlur(24)))
        bg.paste(card, (640, 48), card)
    bg.save('store/play/feature-graphic.png')
    print('feature graphic')


if __name__ == '__main__':
    screenshots()
    feature_graphic()
