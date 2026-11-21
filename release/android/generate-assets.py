"""Generate Android launcher icons and splash screens from the source artwork.

Usage:
  python release/android/generate-assets.py

The source image carries a provider watermark in the bottom-right corner;
the first step crops it away before producing any store assets.
"""

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
RES = REPO / "mobile" / "android" / "app" / "src" / "main" / "res"
SOURCE = ROOT / "assets" / "icon-source.png"

INDIGO = (79, 70, 229)
MIPMAP_SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
FOREGROUND_SIZES = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}


def load_icon() -> Image.Image:
    image = Image.open(SOURCE).convert("RGB")
    width, height = image.size
    # 裁掉右下角水印，同时保持水平居中
    image = image.crop((62, 0, width - 62, height - 124))
    return image.resize((1024, 1024), Image.LANCZOS)


def rounded(image: Image.Image, radius_ratio: float = 0.22) -> Image.Image:
    size = image.size[0]
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=int(size * radius_ratio), fill=255
    )
    result = image.convert("RGBA")
    result.putalpha(mask)
    return result


def full_square(icon: Image.Image) -> Image.Image:
    """商店图标要求不透明方图：圆角外的白底换成与源图一致的渐变底色。"""
    width, height = icon.size
    mask = rounded(icon).getchannel("A")
    top = icon.getpixel((width // 2, 8))
    bottom = icon.getpixel((width // 2, height - 9))
    canvas = Image.new("RGB", icon.size)
    draw = ImageDraw.Draw(canvas)
    for y in range(height):
        ratio = y / (height - 1)
        color = tuple(round(top[i] + (bottom[i] - top[i]) * ratio) for i in range(3))
        draw.line((0, y, width, y), fill=color)
    canvas.paste(icon, (0, 0), mask)
    return canvas


def extract_logo(icon: Image.Image) -> Image.Image:
    """把白色图形从蓝色底上抠出来，保留抗锯齿边缘。"""
    red, green, blue = icon.split()
    darkest = ImageChops.darker(ImageChops.darker(red, green), blue)
    alpha = darkest.point(lambda value: 0 if value < 140 else min(255, (value - 140) * 255 // 100))
    # 源图四个圆角外是白底，裁掉边界残留，避免启动图上出现孤立白点
    inner = Image.new("L", icon.size, 0)
    ImageDraw.Draw(inner).rectangle((96, 96, icon.width - 97, icon.height - 97), fill=255)
    alpha = ImageChops.multiply(alpha, inner)
    logo = Image.new("RGBA", icon.size, (255, 255, 255, 0))
    logo.putalpha(alpha)
    box = alpha.getbbox()
    if box is None:
        raise SystemExit("图标抠图失败：源图里没有找到白色图形")
    return logo.crop(box)


def place_logo(canvas_size: int, logo: Image.Image, fraction: float) -> Image.Image:
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    target = canvas_size * fraction
    scale = min(target / logo.width, target / logo.height)
    resized = logo.resize(
        (max(1, round(logo.width * scale)), max(1, round(logo.height * scale))),
        Image.LANCZOS,
    )
    canvas.alpha_composite(
        resized,
        ((canvas_size - resized.width) // 2, (canvas_size - resized.height) // 2),
    )
    return canvas


def make_splash(logo: Image.Image, size: tuple[int, int], path: Path) -> None:
    canvas = Image.new("RGB", size, INDIGO)
    target = min(size) * 0.28
    scale = min(target / logo.width, target / logo.height)
    resized = logo.resize(
        (max(1, round(logo.width * scale)), max(1, round(logo.height * scale))),
        Image.LANCZOS,
    )
    canvas.paste(
        resized,
        ((size[0] - resized.width) // 2, (size[1] - resized.height) // 2),
        resized,
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(path)


def main() -> None:
    icon = load_icon()
    logo = extract_logo(icon)

    assets = ROOT / "assets"
    full_square(icon).save(assets / "icon-1024.png")
    logo.save(assets / "logo-white.png")
    make_splash(logo, (1242, 2688), assets / "splash-1242x2688.png")

    for density, size in MIPMAP_SIZES.items():
        folder = RES / f"mipmap-{density}"
        folder.mkdir(parents=True, exist_ok=True)
        launcher = rounded(icon).resize((size, size), Image.LANCZOS)
        launcher.save(folder / "ic_launcher.png")
        round_icon = launcher.copy()
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
        round_icon.putalpha(mask)
        round_icon.save(folder / "ic_launcher_round.png")

    for density, size in FOREGROUND_SIZES.items():
        folder = RES / f"mipmap-{density}"
        folder.mkdir(parents=True, exist_ok=True)
        place_logo(size, logo, 0.55).save(folder / "ic_launcher_foreground.png")

    for splash in RES.glob("drawable*/splash.png"):
        with Image.open(splash) as current:
            make_splash(logo, current.size, splash)

    colors = RES / "values" / "ic_launcher_background.xml"
    colors.write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<resources>\n"
        '    <color name="ic_launcher_background">#4F46E5</color>\n'
        "</resources>\n",
        encoding="utf-8",
    )

    print(f"[assets] icon -> {assets / 'icon-1024.png'}")
    print(f"[assets] mipmaps -> {RES}")
    print(f"[assets] splash -> {assets / 'splash-1242x2688.png'}")


if __name__ == "__main__":
    main()
