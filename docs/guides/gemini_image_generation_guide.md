# Gemini 画像生成ガイド — がんばりクエスト

本ドキュメントは、がんばりクエストのすべての画像アセット生成における SSOT。
LP・UI・ゲーム体験のどの画像を生成する際も、このガイドに従うこと。

**関連ドキュメント**:
- `docs/design/asset-catalog.md` — アセット一覧・命名規則・プロンプト差分
- `scripts/generate-image.mjs` — 汎用生成 CLI（`npm run generate:image`）
- `static/assets/brand/master-character-sheet.png` — ブランドアンカー参照画像

---

## A-1. ブランドスタイルブロック（コピペ用）

すべての画像生成プロンプトの**冒頭に必ず貼り付ける**スタイルブロック。
このブロックなしに生成するとブランドから逸脱した画像が生まれる。

```
[BRAND STYLE BLOCK — copy this verbatim at the start of every prompt]
Art style: kawaii chibi flat illustration. Head-to-body ratio 1:1.5.
Oversized round head with large expressive eyes (occupying 35-40% of face area).
Cel-shaded warm pastel palette. Clean 2-3px flat outlines, no complex gradients.
Warm white highlight dot on each eye. Chubby rounded cheeks with subtle pink blush circles.
Transparent background (PNG). No text, no watermarks, no UI elements in image.
Brand colors: Blue #5BA3E6→#3878B8, Gold #FFE44D→#FFCC00, Skin #FFE0B2→#FFCC80.
Reference character: D3 warrior (blue helmet + cape + gold magic wand + star emblem on chest).
Style must be consistent with existing assets: hero-default.png, common-slime.png, chukichi.png.
```

### nanobanana-mcp 使用時の参照画像の渡し方

```
mcp__nanobanana-mcp__gemini_generate_image または gemini_chat で
参照画像として static/assets/brand/master-character-sheet.png を提供する。
これにより自動的にブランドスタイルが反映される。
```

---

## A-2. レアリティ別視覚言語（シール・バッジ・称号共通）

| レアリティ | 記号 | 出現率 | 視覚強度 | プロンプト追加語彙 |
|-----------|------|--------|---------|-----------------|
| Normal | N | ~80% | シンプル | `simple clean design, single color accent, minimal details, soft colors` |
| Rare | R | ~12% | スパークル | `sparkle star accent, colored outline glow (subtle), 2 color accents, dynamic feel` |
| Super Rare | SR | ~5% | オーネイト | `ornate golden glow effect, particle sparkles around item, jewel accent, premium feel` |
| Ultra Rare | UR | ~3% | レジェンダリー | `legendary prismatic rainbow shimmer, aura glow, constellation particle effects, mythical sacred energy` |

**注**: `scripts/generate-image.mjs --category stamp --rarity SR` のように指定すると、
スタイルブロックにレアリティ語彙が自動付与される。

---

## A-3. カテゴリ別仕様とプロンプトテンプレート

### スタンプシール（stamp）

| 項目 | 仕様 |
|------|------|
| 出力サイズ | 128×128 px |
| アスペクト比 | 1:1 |
| 背景 | 透過 PNG |
| 特有注意 | ゲーム内で小さく表示されるため、シルエットが明確な単純形状が必須 |

```
[BRAND STYLE BLOCK]
A cute kawaii chibi stamp seal item for a children's gamification app.
The stamp depicts: {{SUBJECT_DESCRIPTION}}.
{{RARITY_KEYWORDS}}
128x128 pixels, square format, transparent background.
Negative: realistic, photorealistic, 3D render, shadow, text, watermark, adult, complex shading, dark theme.
```

### 実績バッジ（badge）

| 項目 | 仕様 |
|------|------|
| 出力サイズ | 256×256 px |
| アスペクト比 | 1:1 |
| 背景 | 透過 PNG |
| 特有注意 | バッジの外形（円形・盾形・星形）を明示すること。達成感を演出する描き込みが必要 |

```
[BRAND STYLE BLOCK]
A cute achievement badge for a children's gamification app.
Badge shape: circular medal / shield shape / star shape (choose one).
The badge represents: {{ACHIEVEMENT_DESCRIPTION}}.
{{RARITY_KEYWORDS}}
256x256 pixels, square format, transparent background.
Negative: realistic, photorealistic, 3D render, shadow, text, watermark.
```

### 称号アイコン（title）

| 項目 | 仕様 |
|------|------|
| 出力サイズ | 128×128 px |
| アスペクト比 | 1:1 |
| 背景 | 透過 PNG |
| 特有注意 | 紋章・エンブレム調。その称号の意味を象徴するシンボルを中心に据える |

```
[BRAND STYLE BLOCK]
A cute heraldic emblem / crest icon for a children's gamification title system.
The title represents: {{TITLE_DESCRIPTION}}.
Emblem style: shield or circular crest with {{SYMBOL}} as central motif.
{{RARITY_KEYWORDS}}
128x128 pixels, square format, transparent background.
Negative: realistic, photorealistic, 3D render, text overlay, watermark.
```

### キャラクター（character）

| 項目 | 仕様 |
|------|------|
| 出力サイズ | 512×512 px 以上 |
| アスペクト比 | 1:1 |
| 背景 | 透過 PNG |
| 特有注意 | D3キャラクターと頭身・目の大きさ・配色を必ず一致させる。参照画像（master-character-sheet.png）を必ず提供 |

```
[BRAND STYLE BLOCK]
A cute kawaii chibi character for a children's gamification app.
Character description: {{CHARACTER_DESCRIPTION}}.
Must match the reference character's head-to-body ratio, eye size, and brand colors exactly.
512x512 pixels or larger, transparent background.
Negative: realistic proportions, anime screenshot style, dark theme, complex background.
```

### 背景アート（background）

| 項目 | 仕様 |
|------|------|
| 出力サイズ | 1920×1080 px |
| アスペクト比 | 16:9 |
| 背景 | 不透過（グラデーション背景） |
| 特有注意 | キャラクターが前景に配置されることを考慮し、中央〜下部をやや空けたレイアウトにする |

```
[BRAND STYLE BLOCK]
A cute kawaii background illustration for a children's app, age group: {{AGE_GROUP}}.
Scene description: {{SCENE_DESCRIPTION}}.
Soft gradient background (no transparent), pastel colors matching brand palette.
Leave center-bottom area relatively uncluttered for UI overlay.
1920x1080 pixels, landscape format.
Negative: dark theme, realistic photo, 3D render, scary elements, adult content.
```

### マーケティング画像（marketing）

| 項目 | 仕様 |
|------|------|
| OGP | 1200×630 px |
| Twitter ヘッダー | 1500×500 px |
| 背景 | 不透過（グラデーション背景） |
| 特有注意 | テキストは一切含めない（後から追加）。キャラクターを左寄りに配置してテキスト領域を確保 |

---

## A-4. セッション管理・一貫性維持

### セッションリセット閾値

**同一テーマの画像を1セッションで10枚以上生成しない**。
10枚を超えると Gemini のコンテキストが薄れ、スタイルが徐々にブランドから逸脱する。
→ 10枚を超えたら新しいセッションを開始し、参照画像を再提供する。

### nanobanana-mcp での手順

```
1. mcp__nanobanana-mcp__set_model("gemini-2.0-flash-preview-image-generation") を実行
2. mcp__nanobanana-mcp__set_aspect_ratio(ratio) でカテゴリに合わせたアスペクト比を設定
3. gemini_generate_image または gemini_chat を呼ぶ際に以下を含める:
   - スタイルブロック（A-1）
   - カテゴリテンプレート（A-3）
   - 参照画像: static/assets/brand/master-character-sheet.png
4. 生成後の目視確認（A-4 チェックポイント参照）
```

### scripts/generate-image.mjs での手順

```bash
# 基本
npm run generate:image -- --prompt "ハートのスタンプ、かわいいピンクのハート" \
  --category stamp --rarity N \
  --output static/assets/stamps/n-heart.png

# SR スタンプ（レアリティ語彙が自動付与される）
npm run generate:image -- --prompt "ドラゴンのスタンプ" \
  --category stamp --rarity SR \
  --output static/assets/stamps/sr-dragon.png

# --dry-run でプロンプト確認のみ（API 未呼び出し）
npm run generate:image -- --prompt "テスト" --category badge --rarity R --dry-run

# 高品質モデル
npm run generate:image -- --prompt "キャラクター" --category character --model pro \
  --output static/assets/characters/hero-v2.png
```

### スタイル確認チェックポイント

生成後、以下を目視で確認してから `static/assets/` にコミットする:

- [ ] 頭身比が 1:1.5 程度（頭が大きいキャラクター）か
- [ ] 目がキャラクターの顔の 35-40% 程度の大きさか
- [ ] ブランドカラー（青 #5BA3E6、金 #FFE44D）が使われているか
- [ ] 背景が透過（PNG）になっているか（背景アート・マーケティング画像を除く）
- [ ] テキストや透かしが含まれていないか
- [ ] 他の既存アセットと並べてアート調が一致しているか

---

## A-5. ネガティブプロンプト（標準セット）

すべての生成で**必ず含める**ネガティブプロンプト:

```
Negative prompts (always include):
realistic human proportions, photorealistic, 3D render, CGI, 3D modeling,
heavy shadows, dramatic lighting, dark or gloomy mood,
text overlay, watermark, logo, signature,
adult content, violence, scary imagery,
complex background (unless background art category),
anime screenshot style, manga screentone
```

`scripts/generate-image.mjs` はこれを自動的にプロンプトに追加する。

---

## A-6. 生成モデル選択ガイド

| モデル | CLI での指定 | 用途 | 品質 | 速度 |
|--------|------------|------|------|------|
| `gemini-2.0-flash-preview-image-generation` | `--model flash`（デフォルト） | スタンプ・バッジ・称号（量産系） | ⭐⭐⭐ | 高速 |
| `gemini-2.5-flash-image`（現 stamp スクリプトが使用） | — | おみくじスタンプ（既存スクリプト） | ⭐⭐⭐ | 高速 |
| `gemini-2.5-pro` | `--model pro` | 複雑なシーン・背景アート・キャラクター | ⭐⭐⭐⭐ | 中速 |

**注**: `imagen-3.0-generate-002`（Vertex AI）はキャラクター品質が最高だが、
別途 Vertex AI API 設定が必要。Pre-PMF 段階では flash / pro で十分。

---

## ファイル命名規則

```
static/assets/
  stamps/
    n-nikonikoSmile.png      # {rarity}-{camelCaseEn}.png
    r-rocket.png
    sr-dragon.png
    ur-legendSword.png
  badges/
    first-step.png            # {kebab-slug}.png
    combo-challenge.png
  titles/
    exercise-master.png       # {kebab-slug}.png
    study-genius.png
  categories/
    undou.svg                 # {category-code}.svg
    benkyou.svg
  characters/
    hero-default.png
  brand/
    master-character-sheet.png   # ブランドアンカー参照画像
  marketing/
    ogp.png
    twitter-header.png
```

---

## 既存スクリプトとの関係

| スクリプト | 用途 | 状態 |
|-----------|------|------|
| `generate-image.mjs` | 汎用生成 CLI（本 Issue で新規作成） | `scripts/lib/brand-style-guide.js` を参照 |
| `generate-stamp-images.mjs` | おみくじスタンプ6種専用 | 専用プロンプトのため独立維持 |
| `generate-marketing-images.mjs` | OGP・SNSバナー専用 | `brand-style-guide.js` の COMMON_STYLE を参照 |
| `generate-stripe-product-images.mjs` | Stripe商品画像専用 | 独立維持 |
| `regenerate-all-stamps.mjs` | スタンプ一括再生成 | `generate-image.mjs` のバッチラッパーへ移行推奨 |
