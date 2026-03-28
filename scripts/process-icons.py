#!/usr/bin/env python3
"""
アイコン処理スクリプト
1. D3透過版から各サイズのアプリアイコンを生成
2. ドット絵faviconのチェッカーパターン背景を透過に変換
3. D3透過版から32x32 faviconを生成
"""

from pathlib import Path
from PIL import Image
import numpy as np

INPUT_DIR = Path(__file__).parent.parent / "docs" / "design" / "logo-candidates"
STATIC_DIR = Path(__file__).parent.parent / "static"


def resize_icon(src_path, dst_path, size, resample=Image.LANCZOS):
    """Resize image to square icon."""
    img = Image.open(src_path).convert("RGBA")
    resized = img.resize((size, size), resample)
    resized.save(dst_path, "PNG")
    print(f"  {dst_path.name}: {size}x{size} ({dst_path.stat().st_size / 1024:.1f} KB)")


def remove_checker_background(src_path, dst_path):
    """
    Remove checkered transparency pattern from pixel art.
    The checker pattern consists of light gray (#C0C0C0 / #808080 range)
    and white (#FFFFFF) alternating pixels.
    """
    img = Image.open(src_path).convert("RGBA")
    data = np.array(img)

    # The checkered pattern typically uses two alternating colors
    # Light squares: ~(255, 255, 255) or (240-255 range)
    # Dark squares: ~(192-204, 192-204, 192-204)

    # Strategy: Find pixels that match the checker pattern colors
    # and set them to transparent
    r, g, b, a = data[:, :, 0], data[:, :, 1], data[:, :, 2], data[:, :, 3]

    # Detect near-white pixels (light checker squares)
    is_light = (r > 230) & (g > 230) & (b > 230)

    # Detect gray checker pixels (dark checker squares)
    # These are typically around (192,192,192) to (204,204,204)
    is_gray_checker = (
        (r > 180) & (r < 210) &
        (g > 180) & (g < 210) &
        (b > 180) & (b < 210) &
        (np.abs(r.astype(int) - g.astype(int)) < 5) &
        (np.abs(g.astype(int) - b.astype(int)) < 5)
    )

    # Check if the pixel is part of a checker pattern
    # by looking at its neighbors
    h, w = data.shape[:2]
    is_checker = np.zeros((h, w), dtype=bool)

    for y in range(h):
        for x in range(w):
            if is_light[y, x] or is_gray_checker[y, x]:
                # Check if surrounding area has alternating pattern
                neighbors_light = 0
                neighbors_gray = 0
                for dy in range(-1, 2):
                    for dx in range(-1, 2):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < h and 0 <= nx < w:
                            if is_light[ny, nx]:
                                neighbors_light += 1
                            if is_gray_checker[ny, nx]:
                                neighbors_gray += 1
                # If this region has both light and gray checker pixels, it's a checker area
                if neighbors_light > 0 and neighbors_gray > 0:
                    is_checker[y, x] = True

    # Set checker pixels to transparent
    data[is_checker, 3] = 0

    result = Image.fromarray(data)
    result.save(dst_path, "PNG")
    removed = np.sum(is_checker)
    total = h * w
    print(f"  {dst_path.name}: Removed {removed}/{total} checker pixels ({100*removed/total:.1f}%)")
    return result


def main():
    print("=" * 60)
    print("Icon Processing")
    print("=" * 60)

    d3_transparent = INPUT_DIR / "D3-hero-child-transparent.png"
    if not d3_transparent.exists():
        print(f"Error: {d3_transparent} not found")
        return 1

    # === 1. Generate favicon by resizing D3 transparent ===
    print("\n[1] Generating 32x32 favicon from D3 transparent...")

    # Method A: Lanczos (smooth)
    favicon_smooth = INPUT_DIR / "favicon-from-d3-smooth.png"
    resize_icon(d3_transparent, favicon_smooth, 32, Image.LANCZOS)

    # Method B: Box (average, good for downscaling)
    favicon_box = INPUT_DIR / "favicon-from-d3-box.png"
    resize_icon(d3_transparent, favicon_box, 32, Image.BOX)

    # === 2. Process pixel art favicons (remove checker pattern) ===
    print("\n[2] Removing checker pattern from pixel art favicons...")

    for i in range(1, 4):
        src = INPUT_DIR / f"favicon-pixel-{i}.png"
        if src.exists():
            dst = INPUT_DIR / f"favicon-pixel-{i}-clean.png"
            try:
                remove_checker_background(src, dst)
                # Also create a 32x32 version
                dst32 = INPUT_DIR / f"favicon-pixel-{i}-32px.png"
                img = Image.open(dst).convert("RGBA")
                resized = img.resize((32, 32), Image.NEAREST)
                resized.save(dst32, "PNG")
                print(f"  favicon-pixel-{i}-32px.png: 32x32")
            except Exception as e:
                print(f"  Error processing {src.name}: {e}")

    # === 3. Generate app icon sizes from D3 transparent ===
    print("\n[3] Generating app icon sizes from D3 transparent...")

    sizes = {
        "icon-d3-192.png": 192,
        "icon-d3-512.png": 512,
        "icon-d3-180.png": 180,  # apple-touch-icon
    }

    for name, size in sizes.items():
        resize_icon(d3_transparent, INPUT_DIR / name, size)

    print("\nDone. Review the results and select the best favicon option.")
    return 0


if __name__ == "__main__":
    exit(main())
