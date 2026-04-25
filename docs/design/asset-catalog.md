# 画像アセットカタログ — がんばりクエスト

本ドキュメントは、プロジェクト内で使用される視覚的資産の**現状と目標状態**を管理する。
Claude Code がUI実装時に「絵文字で済ませるか、画像アセットが必要か」を判断する際の基準となる。

---

## 判断基準

### 画像アセットが必要（絵文字NG）

| 条件 | 理由 |
|------|------|
| ユーザーが「コレクション」するもの | 収集体験の満足度は視覚品質に直結する |
| 達成感・報酬の核心となるもの | ゲーミフィケーションの動機付けエンジン |
| ブランドを表現するもの | プロダクトの識別性・信頼性 |
| OS/ブラウザ間で見た目が変わると困るもの | 絵文字はプラットフォームにより表示が異なる |
| 子供が「かっこいい」「かわいい」と感じるべきもの | ターゲットの感情体験が最優先 |

### 絵文字で許容

| 条件 | 例 |
|------|-----|
| 装飾的なアクセント | 通知テキスト内の ✨、メッセージの 💌 |
| ステータスラベル | ✅ 完了、❌ エラー |
| 開発中の一時的なプレースホルダー | TODO コメント付きで明示すること |
| 活動アイコン（ユーザーがカスタマイズする前提） | 🏃 うんどう、📚 べんきょう 等 |

---

## アセット一覧

### 優先度: 最高（コアゲーム体験）

| カテゴリ | 現状 | 目標 | 保存先 | サイズ | 数量 |
|---------|------|------|--------|--------|------|
| **シール（スタンプ）** | `emoji: string` で 16 種 | レアリティ別のイラスト画像 | `static/assets/stamps/` | 128×128 PNG | 16+ |
| **実績バッジ** | 絵文字 1 文字（🌟🔥📝 等） | 描き込みのあるバッジ画像 | `static/assets/badges/` | 256×256 PNG | 20+ |
| **称号アイコン** | 絵文字 1 文字（🏋️🧠👑 等） | 称号ごとの紋章風アイコン | `static/assets/titles/` | 128×128 PNG | 15+ |

### 優先度: 高（ブランド・初回体験）

| カテゴリ | 現状 | 目標 | 保存先 | サイズ | 数量 |
|---------|------|------|--------|--------|------|
| **冒険開始キャラクター** | 🧒 絵文字 | 勇者キャラクターのイラスト | `static/assets/characters/` | 512×512 PNG | 1+ |
| **カテゴリアイコン（5 軸）** | 🏃📚🏠🤝🎨 | 統一デザインのカテゴリアイコン | `static/assets/categories/` | 128×128 SVG/PNG | 5 |
| **レベルアップ演出** | ✨🌟 絵文字パーティクル | エフェクト画像 or Lottie アニメ | `static/assets/effects/` | 可変 | 3-5 |
| **特別報酬アイコン** | 🎓🏆🎤🎨🙏 | 報酬種別ごとのイラスト | `static/assets/rewards/` | 256×256 PNG | 6 |
| **持ち物チェックリスト LP スクショ** (#1164) | `site/screenshots/feature-belongings-checklist{,-desktop}.webp` (`/demo/checklist` 撮影) | 高解像度の持ち物タブ実画面 | `site/screenshots/` | 780×1688 (mobile@2x) / 2880×1800 (desktop@2x) WebP | 2 |

### 優先度: 中（体験向上）

| カテゴリ | 現状 | 目標 | 保存先 | サイズ | 数量 |
|---------|------|------|--------|--------|------|
| **おみくじ演出素材** | テキスト＋絵文字 | おみくじ札のイラスト | `static/assets/omikuji/` | 256×512 PNG | 5 |
| **年齢モード背景** | CSS グラデーションのみ | 年齢別のイラスト背景 | `static/assets/backgrounds/` | 1920×1080 WebP | 5 |
| **チェックリストアイコン** | 📋 絵文字 | カスタムチェックリストアイコン | `static/assets/ui/` | 64×64 SVG | 5-10 |

### 絵文字のまま維持（画像化不要）

| 要素 | 理由 |
|------|------|
| 活動アイコン（🤲💧 等） | ユーザーが自由にカスタマイズする設計。絵文字の多様性が利点 |
| ヘッダーの ⭐ ポイント表示 | 装飾的ラベル。テキストと同列で十分 |
| エラー/完了表示（✅❌） | ステータスインジケーター。画像化の意味がない |
| 通知テキスト内の装飾（💌✨🎉 等） | メッセージ内の感情表現。絵文字が適切 |
| 紙吹雪パーティクル（🎊💫 等） | CSS アニメーション素材として絵文字が軽量で実用的 |

---

## 現在のシールマスタ（画像化対象）

生成コマンド例:
```bash
npm run generate:image -- --prompt "<生成プロンプト差分>" --category stamp --rarity <レアリティ> \
  --output static/assets/stamps/<ファイル名>.png
```

| ID | 名前 | 現状 emoji | レアリティ | ファイル名 | 生成プロンプト差分 |
|----|------|-----------|-----------|-----------|----------------|
| 1 | にこにこ | 😊 | N | `n-nikonikoSmile.png` | `A smiley face with big round eyes and a wide smile, simple circular design, warm yellow color` |
| 2 | グッジョブ | 👍 | N | `n-goodJob.png` | `A thumbs-up hand gesture, cute and round, soft blue-green color, encouragement feel` |
| 3 | スター | ⭐ | N | `n-star.png` | `A cute 5-pointed star with a happy face, golden yellow color, simple clean design` |
| 4 | ハート | ❤️ | N | `n-heart.png` | `A cute heart shape with a small happy face, soft pink-red color, rounded and puffy` |
| 5 | がんばった | 💪 | N | `n-ganBatta.png` | `A cute flexing arm muscle emoji style, warm orange-peach color, energetic and encouraging` |
| 6 | ロケット | 🚀 | R | `r-rocket.png` | `A cute chibi rocket ship launching with sparkle trails, blue and white with gold accents` |
| 7 | おうかん | 👑 | R | `r-crown.png` | `A cute golden crown with three points and small jewels, bright gold with red/blue gems` |
| 8 | トロフィー | 🏆 | R | `r-trophy.png` | `A cute golden trophy cup with a star on top, shiny gold color with sparkling highlight` |
| 9 | にじ | 🌈 | R | `r-rainbow.png` | `A cute rainbow arc with small fluffy clouds on each end, vibrant multi-color stripes` |
| 10 | たいよう | ☀️ | R | `r-sun.png` | `A cute smiling sun with rounded triangular rays, bright yellow-orange with happy face` |
| 11 | ドラゴン | 🐉 | SR | `sr-dragon.png` | `A cute chibi dragon with small wings, scales, and friendly expression, green with gold accents` |
| 12 | ユニコーン | 🦄 | SR | `sr-unicorn.png` | `A cute chibi unicorn with a sparkly spiral horn and flowing mane, white with rainbow pastel highlights` |
| 13 | たからばこ | 📦 | SR | `sr-treasureBox.png` | `A cute treasure chest with golden hardware, slightly open revealing glowing light inside, brown and gold` |
| 14 | まほうのつえ | 🪄 | SR | `sr-magicWand.png` | `A cute magic wand with a shining star on tip, gold wand with sparkle particles around the star` |
| 15 | でんせつのけん | ⚔️ | UR | `ur-legendSword.png` | `A legendary glowing sword with ornate golden crossguard, radiant light emanating from blade, mythical sacred energy` |
| 16 | きせきのほし | 🌟 | UR | `ur-miracleStar.png` | `A special miraculous star with multiple light rays, prismatic rainbow shimmer, constellation effects around it` |

**注**: SR/UR は出現率が低い（SR: 12%、UR: 3%）ため、レア感を演出する描き込みの密度が必要。絵文字では不可能。

---

## 実績バッジ一覧（画像化対象）

生成コマンド例:
```bash
npm run generate:image -- --prompt "<生成プロンプト差分>" --category badge \
  --output static/assets/badges/<ファイル名>.png
```

| コード | 名前 | 現状 emoji | レアリティ | ファイル名 | 生成プロンプト差分 |
|--------|------|-----------|-----------|-----------|----------------|
| `first_step` | はじめのいっぽ | 🌟 | common | `first-step.png` | `First step footprints badge — two cute footprints on a circular medal, soft green color, "first time!" feel` |
| `streak_master` | れんぞくチャレンジ | 🔥 | common | `streak-master.png` | `Streak badge with a cute flame and number 3, fire element in orange-red, chain/streak visual` |
| `streak_2days` | れんぞく2にちめ | 🔥 | common | `streak-2days.png` | `Two-day streak badge, small flame with "2" element, warm orange color, beginner streak feel` |
| `activity_master` | かつどうマスター | 📝 | common | `activity-master.png` | `Activity master badge with a cute notepad and checkmark, blue color, 10 activities milestone` |
| `category_scout` | カテゴリたんけんか | 🧭 | common | `category-scout.png` | `Explorer badge with a cute compass rose, adventure theme, warm brown and gold colors` |
| `category_explorer` | カテゴリたんけん | 🌈 | rare | `category-explorer.png` | `All-categories explorer badge with 5 small colored icons in a circle (sports/study/life/social/creative), rainbow border` |
| `level_climber` | レベルアップ | ⭐ | common | `level-climber.png` | `Level up badge with upward arrow and star, Lv.3 milestone, bright yellow with upward energy` |
| `point_collector` | ポイントコレクター | 💰 | common | `point-collector.png` | `Point collector badge with a cute coin stack, golden coins with star symbols, 100 points milestone` |
| `exercise_fan` | うんどうがんばった | 🏃 | common | `exercise-fan.png` | `Exercise fan badge with cute running figure and motion lines, energetic blue-green color` |
| `study_fan` | べんきょうがんばった | 📚 | common | `study-fan.png` | `Study fan badge with cute book stack and graduation element, calm blue color, knowledge feel` |
| `life_fan` | せいかつマスター | 🏠 | common | `life-fan.png` | `Life skills badge with a cute house icon and leaf, warm home feeling, soft orange color` |
| `social_fan` | こうりゅうのたつじん | 🤝 | common | `social-fan.png` | `Social skills badge with two cute hands shaking, friendship theme, warm pink-purple color` |
| `creative_fan` | そうぞうのてんさい | 🎨 | common | `creative-fan.png` | `Creative genius badge with a cute artist palette and paintbrush, colorful paint splashes, rainbow colors` |
| `first_combo` | はじめてのコンボ | 💥 | common | `first-combo.png` | `First combo badge with a cute lightning bolt and "COMBO!" explosive design, bright yellow-orange` |
| `first_mission` | はじめてのミッション | 🎯 | common | `first-mission.png` | `First mission badge with a cute target/bullseye, red center with concentric rings, achievement feel` |
| `first_purchase` | はじめてのおかいもの | 🛒 | common | `first-purchase.png` | `First purchase badge with a cute shopping cart icon, soft teal color, small gift sparkle on cart` |
| `focus_complete` | 3つのミッション | 🎯 | common | `focus-complete.png` | `Three missions complete badge with 3 checkmarks in a circle, triforce-like arrangement, purple achievement color` |
| `first_checklist` | チェックリストマスター | ✅ | common | `first-checklist.png` | `Checklist master badge with a cute clipboard and big green checkmark, organized and accomplished feel` |
| `kindergarten_grad` | ほいくえんそつえん | 🎓 | legendary | `kindergarten-grad.png` | `Kindergarten graduation badge with a tiny cute graduation cap and diploma ribbon, celebratory gold and red, legendary milestone` |
| `elementary_grad` | しょうがっこうそつぎょう | 🎓 | legendary | `elementary-grad.png` | `Elementary school graduation badge with graduation cap, diploma scroll, and stars bursting outward, grand legendary gold` |

---

## 称号アイコン一覧（画像化対象）

生成コマンド例:
```bash
npm run generate:image -- --prompt "<生成プロンプト差分>" --category title \
  --output static/assets/titles/<ファイル名>.png
```

| 名前 | テーマ | レアリティ | ファイル名 | 生成プロンプト差分 |
|------|--------|-----------|-----------|----------------|
| 運動マスター | 運動・体力 | common | `exercise-master.png` | `Athletic shield crest with a running figure and laurel wreath border, blue and green energy colors` |
| 勉強の天才 | 学習・知識 | common | `study-genius.png` | `Academic crest with open book and owl motif, wisdom theme, deep blue and gold scholarly colors` |
| せいかつ名人 | 生活スキル | common | `life-expert.png` | `Home skills crest with a small house and leaf sprout, warm cozy colors, orange and green` |
| 友達の達人 | 社交・コミュニティ | common | `social-master.png` | `Social crest with two stars connected by a heart, friendship bond theme, soft purple and pink` |
| 創造の王 | 創造・アート | common | `creative-king.png` | `Creative crown crest with paint palette and artist star, colorful paint splash crown design` |
| 3日坊主卒業 | 継続・習慣 | rare | `no-more-3days.png` | `Streak crest with a calendar and unbroken chain, consistency theme, warm amber and determined orange` |
| ポイント王 | ポイント収集 | rare | `point-king.png` | `Point king crest with a treasure pile of stars/coins and crown, golden abundance theme` |
| コンボの鬼 | コンボ達成 | rare | `combo-demon.png` | `Combo master crest with lightning bolt and flame combo meter, electric blue and red power colors` |
| ミッションハンター | ミッション達成 | rare | `mission-hunter.png` | `Mission hunter crest with a target and arrow, hunter/ranger theme, forest green and brown` |
| チェックリスト博士 | チェックリスト | rare | `checklist-doctor.png` | `Checklist scholar crest with a clipboard and graduation ribbon, organized teal and scholarly gold` |
| レベル10達成 | レベル成長 | rare | `level-10.png` | `Level 10 milestone crest with "Lv.10" and rising star, achievement glow, bright yellow and white` |
| たんけん家 | カテゴリ探索 | rare | `explorer.png` | `Explorer crest with a compass and map, adventure theme, warm leather brown and compass gold` |
| 卒業生 | 卒業マイルストーン | legendary | `graduate.png` | `Graduate legendary crest with cap and diploma on a grand ornate shield, celebratory gold and royal purple` |
| でんせつのぼうけんしゃ | 最高レベル到達 | legendary | `legendary-adventurer.png` | `Legendary adventurer crest at maximum splendor — prismatic shield with D3 warrior silhouette, mythical rainbow energy` |
| がんばりクエスト勇者 | 総合達成 | legendary | `quest-hero.png` | `Quest hero ultimate crest with the D3 warrior emblem on a grand royal shield, legendary aura, gold and blue` |

---

## 画像生成仕様

### スタイルガイド

| 項目 | 仕様 |
|------|------|
| 対象年齢 | 3-15 歳の子供 |
| スタイル | フラットデザイン、明るく温かい色使い、丸みのある形 |
| テイスト | ゲーム風（RPG/冒険テーマ）、親しみやすい |
| 背景 | 透過（PNG）推奨 |
| カラーパレット | プロジェクトのブランドカラー（`--brand-*`, `--gold-*`）と調和 |

### 生成方法

- **ツール**: Gemini 3 Pro Image Preview（Nano Banana Pro）
- **ガイド**: `docs/reference/gemini_image_generation_guide.md`
- **プロンプトの基本構造**:
  1. スタイル参照（「cute kawaii game item」「RPG fantasy badge」等）
  2. 具体的な描写（何が描かれているか）
  3. 技術要件（透過背景、サイズ、品質）
  4. 否定指示（テキスト不要、リアル調不要）

### ファイル命名規則

```
static/assets/
  stamps/
    n-nikonikoSmile.png      # {rarity}-{英語名}.png
    r-rocket.png
    sr-dragon.png
    ur-legendSword.png
  badges/
    first-step.png            # {英語slug}.png
    combo-challenge.png
  titles/
    exercise-master.png
    study-genius.png
  categories/
    undou.svg                 # {カテゴリコード}.svg
    benkyou.svg
  characters/
    hero-default.png
```

---

## 画像アセット追加時のレビューチェックリスト

新しいアセットを `static/assets/` にコミットする前に以下を確認する:

- [ ] `docs/reference/gemini_image_generation_guide.md` の**スタイルブロック（A-1）**を使用したか
- [ ] **参照画像**（`static/assets/brand/master-character-sheet.png` または同カテゴリの既存画像）を Gemini に提供したか
- [ ] **レアリティ別視覚言語（A-2）**に従っているか（N はシンプル、UR はレジェンダリー）
- [ ] **transparent background (PNG)** になっているか（背景アート・マーケティング画像を除く）
- [ ] 人間の目で「**ブランドキャラクターと同一アート調**」と判断できるか（青 #5BA3E6 / 金 #FFE44D / kawaii chibi 頭身）
- [ ] **ファイル名が命名規則**（`{rarity}-{camelCaseEn}.png` for stamps/badges, `{kebab-slug}.png` for others）に従っているか

---

## 更新ルール

- 新しいシール/実績/称号をスキーマに追加する際は、このカタログも更新すること
- 「絵文字のまま維持」リストに該当しないものは、画像アセットの検討が必要
- 画像未生成の場合は、チケットに画像生成要件と上記チェックリストを明記すること
- `npm run generate:image` の使用例は本カタログの各セクションを参照
