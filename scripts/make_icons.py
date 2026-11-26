#!/usr/bin/env python3
"""إعادة توليد أيقونات «تجارة» من android/icons/source.png (اختياري).
   python3 scripts/make_icons.py      يحتاج: pip install Pillow
الأيقونات الناتجة مُضمّنة في المستودع، لذا لا يلزم تشغيل هذا أثناء بناء APK.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "android" / "icons" / "source.png"
if not SRC.exists():
    raise SystemExit("الملف المصدر مفقود: android/icons/source.png")

im = Image.open(SRC).convert("RGBA").resize((1024, 1024), Image.LANCZOS)
for size in (48, 72, 96, 144, 192):
    out = ROOT / "android" / "icons" / f"icon-{size}.png"
    im.resize((size, size), Image.LANCZOS).save(out, optimize=True)
for size in (180, 192, 512):
    out = ROOT / "web" / "icons" / f"icon-{size}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    im.resize((size, size), Image.LANCZOS).save(out, optimize=True)
print("✓ تم توليد 8 أحجام للأيقونة")
