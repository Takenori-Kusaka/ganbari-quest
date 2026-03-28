#!/usr/bin/env python3
"""
#0108 ロゴ候補画像生成スクリプト
Gemini 3 Pro Image (gemini-3-pro-image-preview) を使用して
6コンセプト×3バリエーションのロゴ候補画像を生成し、
docs/design/logo-candidates/ に保存する。
"""

import os
import sys
import time
import base64
from pathlib import Path

import google.generativeai as genai

# Configuration
API_KEY = os.environ.get("GEMINI_API_KEY", "")
if not API_KEY:
    print("Error: GEMINI_API_KEY environment variable is required")
    sys.exit(1)
OUTPUT_DIR = Path(__file__).parent.parent / "docs" / "design" / "logo-candidates"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

genai.configure(api_key=API_KEY)

# Use Gemini 3 Pro Image model (Nano Banana Pro)
MODEL_NAME = "gemini-3-pro-image-preview"

# Prompts from ticket #0108
PROMPTS = {
    "A": {
        "name": "sprout-hand",
        "label": "芽が出る子供の手 — 成長・育てる",
        "base": """Create a minimal app icon for a Japanese children's gamification app called "がんばりクエスト" (Ganbari Quest).
Design concept: A small sprout growing from a child's open palm, glowing with warm golden light.
The sprout has a few stars or sparkles around it.
Art style: Flat vector, clean and modern, suitable for an app icon.
Color palette: Warm gradient from sky blue (#5BA3E6) to green (#4CAF50), with gold/yellow accent (#FFCC00).
The icon should feel: joyful, warm, encouraging, child-friendly.
Background: Soft gradient circle or rounded square shape.
No text. Icon only. 512x512px transparent background.""",
        "variations": [
            " The sprout is larger with 3 leaves, more emphasis on growth.",
            " The hand is more stylized and abstract, minimal detail. The sprout has a single leaf with a star at the tip.",
            " Warmer color palette leaning towards orange and gold. The sprout has a tiny flower bud opening.",
        ],
    },
    "B": {
        "name": "mountain-flag",
        "label": "旗を立てた山の頂上 — 達成・冒険",
        "base": """Create a minimal app icon for a Japanese children's gamification app called "がんばりクエスト" (Ganbari Quest - meaning "Effort Quest").
Design concept: A cute cartoon child silhouette (gender-neutral, small rounded form) standing on a mountain peak, planting a star-shaped flag.
Art style: Flat vector minimalism, like a modern app icon.
Color palette: Blue gradient sky (#3878B8 to #5BA3E6), warm orange/yellow mountain, gold star flag (#FFCC00).
Mood: Triumphant, cheerful, adventurous. For children and parents.
No text. Icon only. 512x512px transparent background.""",
        "variations": [
            " The mountain has a winding path leading to the top. Clouds in the background.",
            " More emphasis on the flag — it's large and flowing. The child is very small but visible.",
            " Nighttime scene with the flag star glowing brightly. Deep blue background.",
        ],
    },
    "C": {
        "name": "star-tower",
        "label": "星が積み重なる塔 — 積み重ね・レベルアップ",
        "base": """Create a minimal app icon for a Japanese children's gamification app.
Design concept: A tower or staircase made of ascending gold stars, glowing from bottom to top.
Bottom star is small, top star is large and radiating light. Like leveling up.
Art style: Flat vector. Clean geometric shapes. Suitable for app icon (32px to 512px).
Colors: Deep blue background (#2C5282), gold stars with gradient (#FFE44D to #FFCC00), subtle glow effect.
Mood: Achievement, progress, magic, excitement.
No text. Icon only. 512x512px transparent background.""",
        "variations": [
            " Stars arranged in a spiral pattern going upward.",
            " Stars form a staircase with a tiny figure climbing to the top.",
            " The top star is much larger and has a radiant burst. More contrast between small and large stars.",
        ],
    },
    "D": {
        "name": "hero-child",
        "label": "勇者の子供キャラクター — RPG・クエスト感",
        "base": """Create a cute mascot/icon character for a Japanese children's habit-tracking RPG app called "Ganbari Quest" (がんばりクエスト).
Design concept: An adorable chibi-style child hero character, gender-neutral, wearing a small cape and holding a glowing wand or sword.
The character is mid-jump or in a heroic pose, with a big smile and sparkles around.
Art style: Flat vector illustration, kawaii (Japanese cute), app icon-ready.
Colors: Blue cape, gold/yellow accents, warm skin tones, star motifs.
White or transparent background. No text. 512x512px.""",
        "variations": [
            " The hero wears a small crown and holds a shield with a star emblem.",
            " The hero is running forward with determination, cape flying behind. More dynamic pose.",
            " Simplified version — just the hero's face/head with a helmet, suitable for small favicon sizes.",
        ],
    },
    "E": {
        "name": "family-tree",
        "label": "家族の木 — 家庭・育ち・つながり",
        "base": """Create a minimal app icon for a Japanese family-use children's growth tracking app "Ganbari Quest".
Design concept: A stylized tree where each branch has colorful stars or leaves, representing different children's achievements.
A small house or shelter shape is visible in the trunk, suggesting family.
Art style: Modern minimal vector, suitable for app icon at all sizes.
Colors: Warm green (#4CAF50), blue sky (#5BA3E6), yellow stars (#FFCC00), warm brown trunk.
Mood: Warm, safe, growing, family-focused.
No text. Icon only. 512x512px transparent background.""",
        "variations": [
            " The tree has a more rounded, full canopy with stars scattered like fruit.",
            " The tree is stylized like a family crest — symmetrical, with a heart shape in the center.",
            " The tree is small and young (sapling) but has one bright star at the top, symbolizing potential.",
        ],
    },
    "F": {
        "name": "diamond-star",
        "label": "ダイヤモンドに輝く星 — 輝き・特別感・シンプル",
        "base": """Create a bold, memorable app icon for a Japanese children's gamification app.
Design concept: A single large multi-pointed star (8-pointed or classic 5-pointed) with a radiant, gem-like quality.
Inside the star, a subtle upward arrow or small heart shape suggesting growth and love.
Not a typical star — it should look special, crystalline, glowing.
Art style: Flat vector with subtle inner gradients. Bold and recognizable even at 16px.
Colors: Core gradient from bright sky blue to royal blue (#3878B8), star in warm gold (#FFE44D), glow effect.
No text. Icon only. 512x512px transparent background.""",
        "variations": [
            " The star has a more crystalline, diamond-like faceted appearance.",
            " The star is surrounded by a subtle circular halo. More minimalist.",
            " The star has a warmer palette — orange to gold — with a small sprout or leaf emerging from the top.",
        ],
    },
}


def generate_image(prompt, output_path, retries=3):
    """Generate an image using Gemini 3 Pro Image and save it."""
    model = genai.GenerativeModel(MODEL_NAME)

    for attempt in range(retries):
        try:
            response = model.generate_content(prompt)

            if not response.candidates:
                print(f"    Attempt {attempt+1}: No candidates returned")
                if attempt < retries - 1:
                    time.sleep(5)
                continue

            for part in response.candidates[0].content.parts:
                if hasattr(part, "inline_data") and part.inline_data:
                    image_data = part.inline_data.data
                    if isinstance(image_data, str):
                        image_data = base64.b64decode(image_data)
                    with open(output_path, "wb") as f:
                        f.write(image_data)
                    size_kb = len(image_data) / 1024
                    print(f"    ✓ Saved: {output_path.name} ({size_kb:.1f} KB)")
                    return True

            # Check text response
            for part in response.candidates[0].content.parts:
                if hasattr(part, "text") and part.text:
                    print(f"    Text: {part.text[:120]}...")

            print(f"    Attempt {attempt+1}: No image data in response")

        except Exception as e:
            err_str = str(e)
            print(f"    Attempt {attempt+1} error: {err_str[:150]}")
            if "429" in err_str or "quota" in err_str.lower() or "rate" in err_str.lower():
                wait = 30 * (attempt + 1)
                print(f"    Rate limited. Waiting {wait}s...")
                time.sleep(wait)
            elif attempt < retries - 1:
                time.sleep(5)

    return False


def main():
    print("=" * 60)
    print("#0108 ロゴ候補画像生成")
    print(f"Model: {MODEL_NAME}")
    print("=" * 60)
    print()

    # Verify model is accessible
    print("[1] Verifying model access...")
    try:
        model = genai.GenerativeModel(MODEL_NAME)
        response = model.generate_content("Generate a simple blue star icon. No text.")
        has_image = False
        if response.candidates:
            for part in response.candidates[0].content.parts:
                if hasattr(part, "inline_data") and part.inline_data:
                    has_image = True
        if has_image:
            print(f"  ✓ Model {MODEL_NAME} is working and returns images")
        else:
            print(f"  ⚠ Model returned response but no image. Proceeding anyway...")
    except Exception as e:
        print(f"  ✗ Model verification failed: {e}")
        print("  Proceeding with generation anyway...")

    print()
    print(f"[2] Generating 18 logo candidates (6 concepts × 3 variations)...")
    print(f"  Output: {OUTPUT_DIR}")
    print()

    total = 0
    success = 0
    failures = []

    for concept_key, concept in PROMPTS.items():
        print(f"\n{'='*50}")
        print(f"Concept {concept_key}: {concept['label']}")
        print(f"{'='*50}")

        for i, variation in enumerate(concept["variations"], 1):
            total += 1
            filename = f"{concept_key}{i}-{concept['name']}.png"
            output_path = OUTPUT_DIR / filename

            full_prompt = concept["base"] + variation
            print(f"\n  [{concept_key}{i}] {filename}")

            if generate_image(full_prompt, output_path):
                success += 1
            else:
                failures.append(filename)

            # Rate limit: wait between requests
            if total < 18:
                print("    Waiting 5s (rate limit)...")
                time.sleep(5)

    print()
    print("=" * 60)
    print(f"完了: {success}/{total} 画像を生成しました")
    if failures:
        print(f"失敗: {', '.join(failures)}")
    else:
        print("全候補の生成に成功しました！")
    print(f"保存先: {OUTPUT_DIR}")
    print("=" * 60)

    return 0 if success > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
