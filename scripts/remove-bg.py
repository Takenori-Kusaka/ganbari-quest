#!/usr/bin/env python3
"""
背景除去スクリプト
rembg (isnet-anime) を使用してAI生成画像の背景を透過させる。
"""

import sys
from pathlib import Path
from PIL import Image
from rembg import remove, new_session

INPUT_DIR = Path(__file__).parent.parent / "docs" / "design" / "logo-candidates"

# Process these files
TARGETS = [
    "D3-hero-child.png",
    "icon-clean-1.png",
    "icon-clean-2.png",
    "favicon-pixel-1.png",
    "favicon-pixel-2.png",
    "favicon-pixel-3.png",
]


def main():
    print("Initializing rembg with isnet-anime model...")
    session = new_session("isnet-anime")
    print("Model loaded.\n")

    for filename in TARGETS:
        input_path = INPUT_DIR / filename
        if not input_path.exists():
            print(f"SKIP: {filename} not found")
            continue

        output_name = input_path.stem + "-transparent" + input_path.suffix
        output_path = INPUT_DIR / output_name

        print(f"Processing: {filename}")
        try:
            img = Image.open(input_path).convert("RGB")
            result = remove(img, session=session)
            result.save(output_path, "PNG")
            size_kb = output_path.stat().st_size / 1024
            print(f"  -> {output_name} ({size_kb:.1f} KB)")
        except Exception as e:
            print(f"  ERROR: {e}")

    print("\nDone.")


if __name__ == "__main__":
    main()
