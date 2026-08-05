from pathlib import Path
from collections import deque

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "design" / "superpoe2-app-icon-v2.png"
BUILD_DIR = ROOT / "build"
PNG_OUTPUT = BUILD_DIR / "icon.png"
ICO_OUTPUT = BUILD_DIR / "icon.ico"
UI_OUTPUT = ROOT / "public" / "assets" / "ui" / "superpoe2-logo.png"
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)
CHECKERBOARD_LUMA_THRESHOLD = 215
CHECKERBOARD_CHROMA_THRESHOLD = 14


def is_checkerboard_pixel(red: int, green: int, blue: int) -> bool:
    return min(red, green, blue) >= CHECKERBOARD_LUMA_THRESHOLD \
        and max(red, green, blue) - min(red, green, blue) <= CHECKERBOARD_CHROMA_THRESHOLD


def trim_edge_background(source: Image.Image) -> Image.Image:
    image = source.convert("RGBA")
    width, height = image.size
    pixels = image.load()
    visited = bytearray(width * height)
    queue = deque()

    for x in range(width):
        queue.append((x, 0))
        queue.append((x, height - 1))
    for y in range(height):
        queue.append((0, y))
        queue.append((width - 1, y))

    while queue:
        x, y = queue.popleft()
        index = y * width + x
        if visited[index]:
            continue
        red, green, blue, alpha = pixels[x, y]
        if alpha == 0 or not is_checkerboard_pixel(red, green, blue):
            continue
        visited[index] = 1
        pixels[x, y] = (red, green, blue, 0)
        for next_x, next_y in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= next_x < width and 0 <= next_y < height:
                queue.append((next_x, next_y))

    content_box = image.getchannel("A").getbbox()
    if not content_box:
        return image

    left, top, right, bottom = content_box
    side = max(right - left, bottom - top)
    padding = max(12, round(side * 0.02))
    center_x = (left + right) // 2
    center_y = (top + bottom) // 2
    crop_left = max(0, center_x - (side + padding * 2) // 2)
    crop_top = max(0, center_y - (side + padding * 2) // 2)
    crop_side = min(width - crop_left, height - crop_top, side + padding * 2)
    crop_left = max(0, min(crop_left, width - crop_side))
    crop_top = max(0, min(crop_top, height - crop_side))
    return image.crop((crop_left, crop_top, crop_left + crop_side, crop_top + crop_side))


def main() -> None:
    with Image.open(SOURCE) as source:
        image = trim_edge_background(source)

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
