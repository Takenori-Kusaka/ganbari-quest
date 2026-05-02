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
| **trust-badges 信頼系 SVG** (#1796) | OS 依存絵文字 (🚫👪🔑🔍 を `font-size:2rem`) を実装中、Safari/iOS と Android で見た目が大きく異なる | ブランド `--brand-700` 単色のフラット SVG 4 種 | `site/assets/ui/` (LP 直接参照) と `static/assets/ui/` (アプリ側で参照したい場合の二重配置、現状は LP 専用) | 32×32 SVG | 4 |

#### trust-* SVG 一覧（#1796 で導入済み）

| ファイル | 用途 | LP 配置 (`site/index.html` `.trust-badge`) |
|---------|------|-----|
| `trust-no-ads.svg` | 広告ブロック (円 + 斜線 + AD 文字) | #1「広告なし」 |
| `trust-family-circle.svg` | 家族の輪 (4 人シルエット + 中央ハート) | #2「家族限定」 |
| `trust-lock.svg` | 南京錠 (鍵穴付き) | #3「保護者専用のカギ付き」 |
| `trust-data-local.svg` | 家のシルエット + データレイヤー 3 段 + 鍵穴 | #4「データを家族の手元に」（旧「広告ゼロ・データは家族の手元に」を #1 と訴求重複していたため `広告` を外しリフレーム） |

LP は GitHub Pages で `site/` がドキュメントルート扱い。`site/index.html` から `assets/ui/trust-*.svg` の相対パスで参照する。
アプリ側 (SvelteKit) で同じ SVG を使いたくなった場合は `static/assets/ui/` 配下を参照する想定（現時点で参照箇所は無し、二重配置は将来 ADR で整理）。

CSS では `.trust-badge .tb-icon{display:flex;...;height:32px}` + `.tb-icon img{width:32px;height:32px}` で配置。
旧来の `font-size:2rem` 絵文字依存は `site/index.html` 内 `.trust-badge .tb-icon` 定義から撤去済（#1796 R-MAJ-6）。

#### cta-trust-* SVG 一覧（#1824 で導入）

`#trust` 4 badges と並ぶ第 2 系統。hero CTA 直下の `.cta-trust-badges` 3 pill (旧絵文字 💳 🚫 🔄) を SVG に置換した。同じ `site/assets/ui/` ディレクトリ配下に配置し、命名で `cta-trust-*` を接頭辞として `#trust` 系統 (`trust-*`) と区別する。

| ファイル | 用途 | LP 配置 (`.cta-trust-badges li`) |
|---------|------|-----|
| `cta-trust-credit-card.svg` | カード本体 + マグネットストライプ + 数字行 + 不要を示す斜線 | #1「クレジットカード登録不要」 |
| `cta-trust-ad-free.svg` | 円 + 斜線 + AD 文字（`trust-no-ads.svg` と同モチーフ、CTA 系統用に独立配置） | #2「広告なし」 |
| `cta-trust-cancel-anytime.svg` | 循環矢印（recycle / refresh）で「いつでも切替・解約」を表現 | #3「いつでも解約 OK」 |

CSS では `.cta-trust-badges li img{width:18px;height:18px;display:block;flex-shrink:0}` で配置（テキスト `font-size:.82rem` と並ぶよう 18×18 表示、SVG viewBox は 32×32 を維持）。3 ファイル `site/index.html` / `site/faq.html` / `site/pricing.html` で同期参照。`docs/DESIGN.md` §7「OS/ブラウザ間で見た目が変わると困る要素」整合。

---

## LP スクショ — site/index.html 内の機能画像 (#1707 / #1712)

LP `site/index.html` の machine-tour / soft-features / growth-roadmap セクションで参照する実画面のスクリーンショット一覧。`scripts/capture-hp-screenshots.mjs` が `/demo/<mode>/<path>` のデモ画面から自動撮影し `site/screenshots/` に出力する。`.gitignore` で git 追跡対象外（GitHub Pages デプロイ時に CI が生成）。

| ファイル名 | LP セクション | 撮影元 URL（routes） | サイズ（mobile / desktop） |
|----------|------------|--------------------|--------------------------|
| `feature-point-level{,-desktop}.webp` | machine-tour ① | `/demo/lower/home` | 780×1688 / 2880×1800 |
| `feature-titles{,-desktop}.webp` | machine-tour ② | `/demo/lower/achievements` | 780×1688 / 2880×1800 |
| `feature-belongings-checklist{,-desktop}.webp` | machine-tour ② | `/demo/checklist?childId=904` | 780×1688 / 2880×1800 |
| **`feature-routine-checklist{,-desktop}.webp`** (#1707) | machine-tour ③（朝夜の習慣化） | `/demo/checklist?childId=904` | 780×1688 / 2880×1800 |
| **`feature-rpg-battle{,-desktop}.webp`** (#1707) | machine-tour ④（冒険のクライマックス） | `/demo/lower/battle` | 780×1688 / 2880×1800 |
| **`feature-monthly-report{,-desktop}.webp`** (#1707) | soft-features（月次レポート） | `/demo/admin/status` | 780×1688 / 2880×1800 |
| **`feature-auto-sleep{,-desktop}.webp`** (#1707) | soft-features（時間管理） | `/demo/admin` | 780×1688 / 2880×1800 |
| **`feature-cheer-message{,-desktop}.webp`** (#1707) | soft-features（おうえんメッセージ） | `/demo/lower/home` | 780×1688 / 2880×1800 |
| **`feature-settings{,-desktop}.webp`** (#1707) | soft-features（設定の自由度） | `/demo/admin/activities` | 780×1688 / 2880×1800 |
| **`growth-stage-preschool{,-desktop}.webp`** (#1712) | growth-roadmap preschool | `/demo/kinder/home` | 780×1688 / 2880×1800 |
| **`growth-stage-elementary{,-desktop}.webp`** (#1712) | growth-roadmap elementary | `/demo/lower/home` | 780×1688 / 2880×1800 |
| **`growth-stage-junior{,-desktop}.webp`** (#1712) | growth-roadmap junior | `/demo/upper/home` | 780×1688 / 2880×1800 |
| **`growth-stage-senior{,-desktop}.webp`** (#1712) | growth-roadmap senior | `/demo/teen/home` | 780×1688 / 2880×1800 |
| **`growth-stage-graduate{,-desktop}.webp`** (#1712) | growth-roadmap graduate | `/demo/lower/achievements` | 780×1688 / 2880×1800 |

### 撮影方法

```bash
# ローカル開発: dev server を起動した状態で
npm run dev

# 別ターミナルで全グループ撮影
npm run screenshots:lp

# 特定グループのみ撮影
node scripts/capture-hp-screenshots.mjs --webp --only feature
node scripts/capture-hp-screenshots.mjs --webp --only growth

# 個別 screenshot 単体撮り直し (#1783)
npm run capture:feature -- feature-belongings-checklist
npm run capture:feature -- feature-routine-checklist
# `npm run capture:feature -- <name>` は内部で
# `node scripts/capture-hp-screenshots.mjs --webp --only <name>` を呼ぶ
```

### CI gate（broken image 0 件保証 #1783）

- **GitHub Pages デプロイ**: `.github/workflows/pages.yml` が main push 時に preview server を立て、
  `capture-hp-screenshots.mjs --webp` で全 screenshots を撮影してから site/ を artifact 化する。
  - 撮影 1 件でも失敗 → `capture-hp-screenshots.mjs` が exit 1 → workflow fail（古い画像を黙って残さない）
  - 撮影完了後、`measure-lp-dimensions.mjs` が site/index.html 内の `<img src="screenshots/...">`
    全参照に対し物理ファイル存在を検証 → 1 件でも欠落で exit 1
- **lp-metrics ワークフロー**: PR 時にも `measure-lp-dimensions.mjs` を実行し、
  `site/screenshots/` がコミットされていない PR では `SKIP_SCREENSHOT_EXISTENCE_CHECK=1` で skip 可能（pages.yml の撮影直後検証で担保）

### 配置原則 (#1707 R2)

- **placeholder 禁止**: `tour-shot-placeholder` クラスは廃止（`#1707` で全機能を実画面に置換済み）
- **親が観測できること（1 行ベネフィット）併記**: 各 scrshot 直下に「親が観測できること: ...」を必ず併記し、機能の効果を保護者視点で言語化する
- **撮影元は実装の事実から逸脱させない**: ADR-0013 LP truth 原則に従い、実装にない機能や別の画面を撮影して LP に貼ることは禁止

---

## LP コアループ 1-shot summary 画像 (#1787)

`site/index.html` [03] core-loop セクションで全体像を 1 枚に圧縮提示するための summary 図解。
4 階層 (section → 2col → layer-grid → step) の旧構造を 1 階層 3 cards に圧縮した際に、
全体像を視覚的に保持するために導入した（規範 B mid トーン整合）。

| ファイル名 | 配置 | サイズ | 生成方法 |
|----------|------|--------|---------|
| `core-loop-summary.png` | `site/assets/lp/` (配信) + `static/assets/lp/` (アプリ側) | 1280×640 PNG | `npm run generate:coreloop-summary`（Gemini API）/ 暫定 SVG ベース PNG |
| `core-loop-summary.svg` | `static/assets/lp/`（暫定再現用） | 640×320 viewBox | 手書き（Gemini API 鍵が無い環境用のフォールバック）|

### 構図仕様

- 中心: D3 warrior キャラクター（青兜 + 金マントの星紋章）
- 周囲: 3 アイコンが等間隔（120 度刻み）で円環配置
  - 活動: ノート + チェック（ブランド青）
  - 習慣: スタンプカード + 星（ブランド青）
  - ごほうび: ギフトボックス + リボン（ブランドオレンジ + 金）
- 矢印: 3 つの円弧で「活動 → 習慣 → ごほうび → 活動」の循環を示す
- **画像内テキストは置かない**（HTML 側 `figcaption` + `alt` が SSOT、ブランド A-1 整合）
  - `static/assets/lp/core-loop-summary.svg` に存在していた `<text>` 3 要素（活動 / 習慣 / ごほうび）は #1821 で全削除済（ごほうびラベルが D3 キャラ星章 cy=160 r=56 領域と重なっていたため）

### 生成コマンド

```bash
# Gemini API 鍵があるとき（推奨）
npm run generate:coreloop-summary
#  → static/assets/lp/core-loop-summary.png + site/assets/lp/core-loop-summary.png に出力
#  → docs/reference/gemini_image_generation_guide.md A-1 / A-3 character category 整合

# Gemini API 鍵が無いとき（CI / Pages デプロイ時のフォールバック）
node -e "require('sharp')('static/assets/lp/core-loop-summary.svg').resize(1280,640).png().toFile('static/assets/lp/core-loop-summary.png')"
```

### 配置原則

- ADR-0013 LP truth: 画像は「実装の事実」を表現する（活動 → 習慣 → ごほうびは実機構と一致）
- ADR-0012 Anti-engagement: 演出を煽らない（loop は静止画 1 枚のみ、アニメーションなし）
- テキストオーバーレイは含めない（多言語対応・ブランド一貫性のため）

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
