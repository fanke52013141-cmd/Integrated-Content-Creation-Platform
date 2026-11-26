from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "fixtures" / "assets"
ASSETS.mkdir(parents=True, exist_ok=True)

font = ImageFont.load_default(size=28)
small = ImageFont.load_default(size=20)
large = ImageFont.load_default(size=48)

image = Image.new("RGB", (1080, 640), "#F6F8FC")
draw = ImageDraw.Draw(image)
draw.text((60, 42), "WECHAT POC PIPELINE", font=large, fill="#16324F")
boxes = [
    (60, 190, 270, 400, "RENDER", "#DCEBFA"),
    (320, 190, 530, 400, "VALIDATE", "#E3F4E8"),
    (580, 190, 790, 400, "WRITE", "#FFF0D9"),
    (840, 190, 1020, 400, "READBACK", "#F1E5F6"),
]
for left, top, right, bottom, label, color in boxes:
    draw.rounded_rectangle((left, top, right, bottom), radius=22, fill=color, outline="#52718F", width=3)
    draw.text((left + 28, top + 82), label, font=font, fill="#16324F")
for x in (280, 540, 800):
    draw.line((x, 295, x + 30, 295), fill="#52718F", width=5)
    draw.polygon([(x + 30, 285), (x + 45, 295), (x + 30, 305)], fill="#52718F")
draw.text((60, 500), "Local fixture image - no external image dependency", font=small, fill="#425466")
image.save(ASSETS / "poc-diagram.png", format="PNG", optimize=True)

cover = Image.new("RGB", (900, 383), "#16324F")
draw = ImageDraw.Draw(cover)
draw.rectangle((45, 45, 855, 338), outline="#78A6D0", width=3)
draw.text((80, 105), "WECHAT POC", font=large, fill="#FFFFFF")
draw.text((82, 190), "RENDER  /  VALIDATE  /  READBACK", font=small, fill="#C9E4F7")
draw.text((82, 260), "TEST DRAFT ONLY - NO AUTO PUBLISH", font=small, fill="#A9C8E2")
cover.save(ASSETS / "cover-thumb.jpg", format="JPEG", quality=72, optimize=True, progressive=True)

for path in sorted(ASSETS.iterdir()):
    print(f"{path.name}: {path.stat().st_size} bytes")
