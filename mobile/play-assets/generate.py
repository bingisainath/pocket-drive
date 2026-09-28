"""Generate the Play Store icon and feature graphic from the app's own adaptive icon.

The glyph is the Material "backup" path used in
mobile/android/app/src/main/res/drawable/ic_launcher_foreground.xml, redrawn with primitives so it
matches the installed app: white cloud with an upload arrow cut out of it, on brand blue #2563EB.
Everything is drawn at 4x and downscaled, which is what keeps the curves from looking jagged.
"""
from PIL import Image, ImageDraw, ImageFont

BLUE = (0x25, 0x63, 0xEB)
WHITE = (255, 255, 255)
SS = 4  # supersample factor
BOLD = "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf"
REG = "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf"


def draw_glyph(d, x, y, size):
    """Cloud-with-up-arrow in a `size` box whose top-left is (x, y). 24-unit source grid."""
    u = size / 24.0
    def p(gx, gy):
        return (x + gx * u, y + gy * u)
    def circle(cx, cy, r, fill):
        d.ellipse([p(cx - r, cy - r), p(cx + r, cy + r)], fill=fill)

    # Cloud: three lobes whose lowest points all land exactly on y=20, plus a base joining them.
    # Letting any lobe overshoot the base by even 0.1 units leaves a visible step on the bottom edge.
    circle(6, 14, 6, WHITE)      # left lobe:  spans x 0..12, bottom y=20
    circle(19, 15, 5, WHITE)     # right lobe: spans x 14..24, bottom y=20
    circle(12, 9.8, 5.9, WHITE)  # top lobe
    d.rectangle([p(6, 14), p(19, 20)], fill=WHITE)  # joins the lobes; same bottom edge

    # The arrow is a hole in the original path; drawing it in the background colour is equivalent.
    d.polygon([p(7, 13), p(12, 8), p(17, 13)], fill=BLUE)
    d.rectangle([p(10, 13), p(14, 17)], fill=BLUE)


def icon(path, size=512):
    im = Image.new("RGB", (size * SS, size * SS), BLUE)
    d = ImageDraw.Draw(im)
    # Same proportion as the adaptive icon: the 24dp glyph scaled 2.6x inside 108dp => 57.8%.
    g = size * SS * 0.578
    draw_glyph(d, (size * SS - g) / 2, (size * SS - g) / 2, g)
    im.resize((size, size), Image.LANCZOS).save(path, "PNG")
    print("wrote", path, f"{size}x{size}")


def feature(path, w=1024, h=500):
    im = Image.new("RGB", (w * SS, h * SS), BLUE)
    d = ImageDraw.Draw(im)
    g = h * SS * 0.46
    gx, gy = w * SS * 0.09, (h * SS - g) / 2
    draw_glyph(d, gx, gy, g)
    tx = gx + g + w * SS * 0.06
    title = ImageFont.truetype(BOLD, int(h * SS * 0.155))
    sub = ImageFont.truetype(REG, int(h * SS * 0.072))
    # Baselines chosen so the text block's optical centre sits on the icon's centre line; at 0.34 the
    # whole composition floated above the middle and left dead space along the bottom edge.
    d.text((tx, h * SS * 0.42), "Pocket Drive", font=title, fill=WHITE, anchor="ls")
    d.text((tx, h * SS * 0.58), "Your own private cloud drive", font=sub, fill=(0xDB, 0xE4, 0xFF), anchor="ls")
    d.text((tx, h * SS * 0.70), "Self-hosted. No ads. No tracking.", font=sub, fill=(0xDB, 0xE4, 0xFF), anchor="ls")
    im.resize((w, h), Image.LANCZOS).save(path, "PNG")
    print("wrote", path, f"{w}x{h}")


icon("play-icon-512.png")
feature("play-feature-1024x500.png")
