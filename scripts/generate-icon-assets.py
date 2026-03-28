#!/usr/bin/env python3
"""
#0108 アイコン素材生成スクリプト
1. D3キャラの枠なし透過PNG版（アプリアイコン/Discordアイコン用）
2. 32x32ドット絵favicon
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

D3_PATH = OUTPUT_DIR / "D3-hero-child.png"


def load_image(path):
    with open(path, "rb") as f:
        data = f.read()
    return {"mime_type": "image/png", "data": data}


def generate_image(prompt, reference_images, output_path, retries=3):
    model = genai.GenerativeModel(MODEL_NAME)
    contents = list(reference_images) + [prompt]

    for attempt in range(retries):
        try:
            response = model.generate_content(contents)
            if not response.candidates:
                print(f"  Attempt {attempt+1}: No candidates")
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

            for part in response.candidates[0].content.parts:
                if hasattr(part, "text") and part.text:
                    print(f"  Text: {part.text[:200]}")

            print(f"  Attempt {attempt+1}: No image data")
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
    print("#0108 Icon Asset Generation")
    print("=" * 60)

    if not D3_PATH.exists():
        print(f"Error: D3 reference not found: {D3_PATH}")
        sys.exit(1)

    d3_img = load_image(D3_PATH)
    results = []

    # === 1. Clean character without card frame (transparent BG) ===
    print("\n[1] Generating clean character icon (no card frame)...")

    clean_prompts = [
        """Based on this reference image of a chibi hero character:
Create a CLEAN version of this EXACT same character with these requirements:
- Remove the rounded rectangle card/frame background completely
- Character only, on a PURE TRANSPARENT background (no card shape, no shadow, no border)
- Keep the EXACT same character design: blue cape with gold trim, gold helmet with star, magic wand with star, cream tunic, star emblem on chest, brown boots, rosy cheeks, big smile
- Keep all the small decorative stars and sparkles around the character
- Keep the blue motion lines behind the character
- The character should be centered in the image with some padding
- High quality, clean edges suitable for use as an app icon
- Output: 512x512 pixels, transparent/white background, NO card frame or rounded rectangle
- This will be used as PWA app icon and Discord avatar""",

        """Based on this reference image:
Recreate this EXACT chibi hero character but WITHOUT the rounded square card background.
- Just the character floating on a clean white/transparent background
- Same pose: jumping/flying, holding magic wand with star, blue cape flowing
- Same details: gold helmet with star, star chest emblem, cream outfit, rosy cheeks
- Include the small decorative stars around the character
- No border, no card shape, no drop shadow, no rounded rectangle frame
- Clean isolated character illustration
- 512x512 pixels""",
    ]

    for i, prompt in enumerate(clean_prompts, 1):
        print(f"\n  Variant {i}...")
        ok = generate_image(prompt, [d3_img], OUTPUT_DIR / f"icon-clean-{i}.png")
        results.append((f"icon-clean-{i}", ok))
        time.sleep(8)

    # === 2. 32x32 Pixel Art Favicon ===
    print("\n[2] Generating 32x32 pixel art favicon...")

    pixel_prompts = [
        """Based on this chibi hero character reference image:
Create a 32x32 PIXEL ART version of this character for use as a browser favicon.
Requirements:
- Strict 32x32 pixel grid, each pixel clearly defined
- Pixel art / retro game sprite style
- Capture the key features: blue helmet with gold star, blue cape, cream outfit, magic wand
- Simple but recognizable at tiny size
- Use the same color palette: blue (#3878B8, #5BA3E6), gold (#FFCC00, #FFE44D), cream (#F5E6C8)
- Transparent or light blue background
- The character should fill most of the 32x32 space
- Clean pixel art, no anti-aliasing, crisp edges
- Think of it like a retro RPG game character sprite""",

        """Create a 32x32 pixel art favicon based on this character reference.
- Pixel art style, like a classic RPG sprite or retro game icon
- Show the chibi hero: blue helmet+cape, gold star, magic wand
- Must be recognizable at 32x32 pixels
- Use limited color palette matching the reference: blues, golds, cream, brown
- Each pixel should be clearly defined (no blur or anti-aliasing)
- Transparent background
- The sprite should be centered and fill the canvas well""",

        """Based on this character, create a tiny 32x32 pixel art game sprite.
Like a character select icon from a classic JRPG or a browser favicon.
- Pixel art only, 32x32 grid
- Blue helmet with gold star on top
- Blue cape
- Cream/white tunic
- Holding a small wand with star
- Cheerful pose
- Clean pixel art with no smoothing
- Transparent background
- Must read clearly at 16x16 and 32x32 display sizes""",
    ]

    for i, prompt in enumerate(pixel_prompts, 1):
        print(f"\n  Variant {i}...")
        ok = generate_image(prompt, [d3_img], OUTPUT_DIR / f"favicon-pixel-{i}.png")
        results.append((f"favicon-pixel-{i}", ok))
        if i < 3:
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
