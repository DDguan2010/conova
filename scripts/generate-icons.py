"""Generate platform icons from public/favicon.svg. Requires Pillow."""
from pathlib import Path
from xml.etree import ElementTree
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
source = ElementTree.parse(root / "public/favicon.svg").getroot()
frame = list(source)[1]
x, y, width, height, stroke = (float(frame.attrib[key]) for key in ("x", "y", "width", "height", "stroke-width"))


def rectangle_icon(size, transparent=False):
    scale = max(1024, size * 4) / 64
    pixels = round(64 * scale)
    image = Image.new("RGBA", (pixels, pixels), (0, 0, 0, 0) if transparent else (0, 0, 0, 255))
    draw = ImageDraw.Draw(image)
    draw.rectangle([(x - stroke / 2) * scale, (y - stroke / 2) * scale, (x + width + stroke / 2) * scale - 1, (y + height + stroke / 2) * scale - 1], fill="white")
    draw.rectangle([(x + stroke / 2) * scale, (y + stroke / 2) * scale, (x + width - stroke / 2) * scale - 1, (y + height - stroke / 2) * scale - 1], fill=(0, 0, 0, 0) if transparent else "black")
    return image.resize((size, size), Image.Resampling.LANCZOS)


build = root / "build"
build.mkdir(exist_ok=True)
master = rectangle_icon(1024)
master.save(build / "icon.png")
master.save(build / "icon.ico", format="ICO", sizes=[(size, size) for size in (16, 24, 32, 48, 64, 128, 256)])

resources = root / "android/app/src/main/res"
for density, size in [("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)]:
    folder = resources / f"mipmap-{density}"
    folder.mkdir(exist_ok=True)
    for name in ("ic_launcher", "ic_launcher_round"):
        rectangle_icon(size).save(folder / f"{name}.png")
    rectangle_icon(round(size * 108 / 48), transparent=True).save(folder / "ic_launcher_foreground.png")

# Match adaptive icons to the same geometry inside Android's safe region.
adaptive_scale = 1.5
vector = f'''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="#00000000" android:strokeColor="#FFFFFF"
        android:strokeWidth="{stroke * adaptive_scale:g}"
        android:pathData="M{54 + (x - 32) * adaptive_scale:g},{54 + (y - 32) * adaptive_scale:g}h{width * adaptive_scale:g}v{height * adaptive_scale:g}h{-width * adaptive_scale:g}Z" />
</vector>
'''
(resources / 'drawable-v24/ic_launcher_foreground.xml').write_text(vector, encoding='utf-8')
(resources / 'drawable/ic_launcher_background.xml').write_text('''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="#000000" android:pathData="M0,0H108V108H0Z" />
</vector>
''', encoding='utf-8')

for splash in resources.glob("drawable*/splash.png"):
    with Image.open(splash) as previous:
        dimensions = previous.size
    Image.new("RGB", dimensions, "black").save(splash)

print("Generated Conova rectangle icons for Windows and Android.")
