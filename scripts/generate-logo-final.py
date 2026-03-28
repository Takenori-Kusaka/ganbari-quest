#!/usr/bin/env python3
"""
#0108 最終ロゴ生成スクリプト
Gemini 3 Pro Image でコンパクトロゴとフルロゴを生成する。
- compact: compact-2スタイル（ブルー＋ゴールド縁取り）でキャラと文字サイズを揃える
- full: compact-3ベースにサブタイトル追加
"""

import os
import sys
import time
import base64
from pathlib import Path

import google.generativeai as genai

API_KEY = os.environ.get("GEMINI_API_KEY", "")
if not API_KEY:
    print("Error: GEMINI_API_KEY environment variable is required")
    sys.exit(1)

OUTPUT_DIR = Path(__file__).parent.parent / "docs" / "design" / "logo-candidates"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

genai.configure(api_key=API_KEY)
MODEL_NAME = "gemini-3-pro-image-preview"

# Load reference images
D3_PATH = OUTPUT_DIR / "D3-hero-child.png"
COMPACT2_PATH = OUTPUT_DIR / "logo-compact-2.png"
COMPACT3_PATH = OUTPUT_DIR / "logo-compact-3.png"


def load_image(path):
    """Load image as Gemini-compatible Part."""
    with open(path, "rb") as f:
        data = f.read()
    return {"mime_type": "image/png", "data": data}


def generate_image(prompt, reference_images, output_path, retries=3):
    """Generate an image using Gemini with reference images."""
    model = genai.GenerativeModel(MODEL_NAME)

    contents = []
    for img in reference_images:
        contents.append(img)
    contents.append(prompt)

    for attempt in range(retries):
        try:
            response = model.generate_content(contents)

            if not response.candidates:
                print(f"  Attempt {attempt+1}: No candidates returned")
                if attempt < retries - 1:
                    time.sleep(10)
                continue

            for part in response.candidates[0].content.parts:
                if hasattr(part, "inline_data") and part.inline_data:
                    image_data = part.inline_data.data
                    if isinstance(image_data, str):
                        image_data = base64.b64decode(image_data)
                    with open(output_path, "wb") as f:
                        f.write(image_data)
                    size_kb = len(image_data) / 1024
                    print(f"  Saved: {output_path.name} ({size_kb:.1f} KB)")
                    return True

            # Print text response if any
            for part in response.candidates[0].content.parts:
                if hasattr(part, "text") and part.text:
                    print(f"  Text: {part.text[:200]}")

            print(f"  Attempt {attempt+1}: No image data in response")

        except Exception as e:
            err_str = str(e)
            print(f"  Attempt {attempt+1} error: {err_str[:200]}")
            if "429" in err_str or "quota" in err_str.lower() or "rate" in err_str.lower():
                wait = 30 * (attempt + 1)
                print(f"  Rate limited. Waiting {wait}s...")
                time.sleep(wait)
            elif attempt < retries - 1:
                time.sleep(10)

    return False


def main():
    print("=" * 60)
    print("#0108 Final Logo Generation")
    print(f"Model: {MODEL_NAME}")
    print("=" * 60)

    # Verify reference images exist
    for p in [D3_PATH, COMPACT2_PATH, COMPACT3_PATH]:
        if not p.exists():
            print(f"Error: Reference image not found: {p}")
            sys.exit(1)

    d3_img = load_image(D3_PATH)
    compact2_img = load_image(COMPACT2_PATH)
    compact3_img = load_image(COMPACT3_PATH)

    results = []

    # === Generate compact logo variants ===
    print("\n[1] Generating compact logo (compact-2 style, balanced sizes)...")
    compact_prompt = """Based on the reference images provided:
- First image: The character design (D3 hero child icon) - use this exact character style
- Second image: The text styling reference (blue text with gold outline) - use this exact text styling

Create a NEW compact logo for "がんばりクエスト" (Ganbari Quest) app:
- Place the character on the LEFT side, taking up about 35-40% of the width
- Place "がんばり" on top line and "クエスト" on bottom line, to the RIGHT of the character
- The CHARACTER HEIGHT and TEXT HEIGHT should be approximately the SAME size (balanced, harmonious)
- Text style: Bold rounded Japanese font, blue (#3878B8) fill with gold (#FFCC00) outline/stroke, exactly like the reference
- The character should be the same chibi hero (blue cape, gold helmet with star, magic wand) as the reference
- White/transparent background
- Clean horizontal layout, suitable for app header/navigation
- No subtitle, just the character + "がんばりクエスト" title
- Professional logo quality, clean and crisp
- Output size: 1024x512 pixels (2:1 horizontal ratio)"""

    for i in range(1, 4):
        print(f"\n  Variant {i}...")
        extra = ""
        if i == 2:
            extra = " Make the text slightly larger relative to the character."
        elif i == 3:
            extra = " Make the character slightly larger, with text centered vertically next to it."

        ok = generate_image(
            compact_prompt + extra,
            [d3_img, compact2_img],
            OUTPUT_DIR / f"logo-compact-final-{i}.png",
        )
        results.append(("compact-final-" + str(i), ok))
        if i < 3:
            print("  Waiting 8s...")
            time.sleep(8)

    print("\n  Waiting 10s before full logo generation...")
    time.sleep(10)

    # === Generate full logo variants ===
    print("\n[2] Generating full logo (compact-3 style + subtitle)...")
    full_prompt = """Based on the reference images provided:
- First image: The character design (D3 hero child icon) - use this exact character style
- Second image: The horizontal layout reference - use this character size and font size as reference

Create a NEW full logo for "がんばりクエスト" (Ganbari Quest) app:
- Place the character on the LEFT side (same size as in the reference image)
- To the RIGHT of the character, place TWO lines of text:
  - Line 1 (main title, UPPER): "がんばりクエスト" in bold rounded font, blue (#3878B8) with gold (#FFCC00) outline
  - Line 2 (subtitle, LOWER, smaller): "こどもの がんばりを ぼうけんに" in a lighter/thinner font, gray (#666666) or dark blue
- The main title should be positioned slightly ABOVE center, with the subtitle below it
- Same font size for the main title as the reference image
- The subtitle should be about 40-50% the size of the main title
- White/transparent background
- Clean horizontal layout, suitable for login screens and landing pages
- Professional logo quality, clean and crisp
- Output size: 1024x512 pixels (2:1 horizontal ratio)"""

    for i in range(1, 4):
        print(f"\n  Variant {i}...")
        extra = ""
        if i == 2:
            extra = " Make the subtitle in a softer blue color (#5BA3E6) instead of gray."
        elif i == 3:
            extra = " Add small star decorations between the character and the text."

        ok = generate_image(
            full_prompt + extra,
            [d3_img, compact3_img],
            OUTPUT_DIR / f"logo-full-final-{i}.png",
        )
        results.append(("full-final-" + str(i), ok))
        if i < 3:
            print("  Waiting 8s...")
            time.sleep(8)

    # Summary
    print("\n" + "=" * 60)
    success = sum(1 for _, ok in results if ok)
    print(f"Complete: {success}/{len(results)} images generated")
    for name, ok in results:
        status = "OK" if ok else "FAILED"
        print(f"  {name}: {status}")
    print("=" * 60)

    return 0 if success > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
