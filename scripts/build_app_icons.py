from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "design" / "superpoe2-app-icon-v1.png"
BUILD_DIR = ROOT / "build"
PNG_OUTPUT = BUILD_DIR / "icon.png"
ICO_OUTPUT = BUILD_DIR / "icon.ico"
UI_OUTPUT = ROOT / "public" / "assets" / "ui" / "superpoe2-logo.png"
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)


def main() -> None:
    with Image.open(SOURCE) as source:
        image = source.convert("RGBA")

    if image.width != image.height or image.width < max(ICO_SIZES):
        raise ValueError(f"App icon source must be square and at least 256px: {SOURCE}")

    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    image.save(PNG_OUTPUT, format="PNG", optimize=True)
    image.save(ICO_OUTPUT, format="ICO", sizes=[(size, size) for size in ICO_SIZES])
    ui_logo = image.resize((128, 128), Image.Resampling.LANCZOS)
    ui_logo.save(UI_OUTPUT, format="PNG", optimize=True)
    print(f"[ok] {PNG_OUTPUT.relative_to(ROOT)}")
    print(f"[ok] {ICO_OUTPUT.relative_to(ROOT)} ({len(ICO_SIZES)} sizes)")
    print(f"[ok] {UI_OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
