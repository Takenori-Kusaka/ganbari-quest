# DESIGN.md — がんばりクエスト デザインシステム SSOT

> **AI エージェントへ**: 新規画面・コンポーネントを作成する前に、このファイルを最初に読んでください。
> ここに記載されたルール・トークン・コンポーネントが実装の基準です。

---

## 1. ブランドアイデンティティ

- **ターゲット**: 3-15歳の子供 × 保護者
- **トーン**: 明るい・温かい・親しみやすい・冒険的
- **テーマ**: RPG / 冒険（ポイント、レベル、クエスト）
- **対象年齢ごとのスタイル**: 幼児向けは丸く大きく、中高生向けはシャープで情報密度を上げる
- **詳細**: [docs/design/15-ブランドガイドライン.md](design/15-ブランドガイドライン.md)

---

## 2. カラートークン（3 層アーキテクチャ）

### 設計原則

色は **Base → Semantic → Component** の 3 層で管理する。

| 層 | 使用可能場所 | 例 |
|----|------------|------|
| **Semantic** | routes / features / components すべて | `var(--color-action-primary)` |
| **Base** | `app.css` の Semantic 定義内のみ | `var(--color-brand-500)` |
| **Hex 値** | `app.css` の `@theme` / `:root` 定義ブロック内のみ | `#5ba3e6` |

### 禁忌

- **routes / features 配下で hex カラー直書き禁止** (`#fff`, `#667eea` 等)
- **Tailwind arbitrary hex 禁止** (`bg-[#667eea]`)
- **Base トークンを routes で直接使用禁止** (`var(--color-brand-500)` を routes に書かない)
- 検出: `stylelint color-no-hex` + `eslint svelte/no-inline-styles`

### Semantic Tokens（優先使用）

<!-- AUTOGEN:colors -->
#### Action（操作）

| トークン | 値 |
|---------|----|
| `--color-action-primary` | `var(--theme-primary)` |
| `--color-action-primary-hover` | `var(--color-brand-700)` |
| `--color-action-secondary` | `var(--theme-secondary)` |
| `--color-action-accent` | `var(--theme-accent)` |
| `--color-action-danger` | `var(--color-danger)` |
| `--color-action-success` | `var(--color-success)` |
| `--color-action-ghost` | `transparent` |
| `--color-action-trial` | `var(--color-premium-light)` |
| `--color-action-trial-hover` | `var(--color-premium)` |
| `--color-action-trial-upgrade` | `var(--color-warning)` |
| `--color-action-trial-upgrade-hover` | `var(--color-warning-hover)` |

#### Surface（背景）

| トークン | 値 |
|---------|----|
| `--color-surface` | `white` |
| `--color-surface-base` | `var(--color-bg)` |
| `--color-surface-card` | `white` |
| `--color-surface-overlay` | `rgba(0, 0, 0, 0.5)` |
| `--color-surface-elevated` | `white` |
| `--color-surface-muted` | `var(--color-neutral-50)` |
| `--color-surface-secondary` | `var(--color-neutral-100)` |
| `--color-surface-accent` | `var(--color-feedback-info-bg)` |
| `--color-surface-info` | `var(--color-feedback-info-bg)` |
| `--color-surface-success` | `var(--color-feedback-success-bg)` |
| `--color-surface-warning` | `var(--color-feedback-warning-bg)` |
| `--color-surface-warm` | `#fef3c7` |
| `--color-surface-themed` | `var(--theme-bg)` |
| `--color-surface-nav` | `var(--theme-nav)` |
| `--color-surface-trial` | `var(--color-premium-50)` |
| `--color-surface-trial-urgent` | `var(--color-feedback-warning-bg)` |
| `--color-surface-trial-expired` | `var(--color-neutral-50)` |
| `--color-surface-muted-strong` | `var(--color-neutral-100)` |
| `--color-surface-tertiary` | `var(--color-neutral-200)` |
| `--color-surface-error` | `var(--color-feedback-error-bg)` |
| `--color-surface-error-strong` | `var(--color-feedback-error-bg-strong)` |

#### Border（枠線）

| トークン | 値 |
|---------|----|
| `--color-border` | `var(--color-neutral-200)` |
| `--color-border-default` | `var(--color-neutral-200)` |
| `--color-border-light` | `var(--color-neutral-100)` |
| `--color-border-strong` | `var(--color-neutral-300)` |
| `--color-border-focus` | `var(--theme-primary)` |
| `--color-border-accent` | `var(--theme-accent)` |
| `--color-border-warm` | `rgba(251, 191, 36, 0.3)` |
| `--color-border-warning` | `var(--color-feedback-warning-border)` |
| `--color-border-premium` | `color-mix(in srgb, var(--color-premium) 20%, transparent)` |
| `--color-border-danger` | `color-mix(in srgb, var(--color-danger) 20%, transparent)` |
| `--color-border-success` | `color-mix(in srgb, var(--color-success) 20%, transparent)` |
| `--color-border-success-strong` | `color-mix(in srgb, var(--color-success) 40%, transparent)` |
| `--color-border-trial` | `var(--color-premium-200)` |
| `--color-border-trial-urgent` | `var(--color-feedback-warning-border)` |
| `--color-border-trial-expired` | `var(--color-neutral-200)` |

#### Text（文字）

| トークン | 値 |
|---------|----|
| `--color-text` | `#2d2d2d` |
| `--color-text-muted` | `#8b8b8b` |
| `--color-text-inverse` | `white` |
| `--color-text-accent` | `var(--theme-accent)` |
| `--color-text-link` | `var(--color-brand-700)` |
| `--color-text-primary` | `var(--color-neutral-700)` |
| `--color-text-secondary` | `var(--color-neutral-600)` |
| `--color-text-tertiary` | `var(--color-neutral-400)` |
| `--color-text-disabled` | `#9ca3af` |
| `--color-text-warm` | `#92400e` |
| `--color-text-warm-muted` | `#a16207` |

#### Feedback（フィードバック）

| トークン | 値 |
|---------|----|
| `--color-feedback-success-bg` | `#f0fdf4` |
| `--color-feedback-success-bg-strong` | `#dcfce7` |
| `--color-feedback-success-text` | `#15803d` |
| `--color-feedback-success-border` | `#bbf7d0` |
| `--color-feedback-error-bg` | `#fef2f2` |
| `--color-feedback-error-bg-strong` | `#fee2e2` |
| `--color-feedback-error-text` | `#dc2626` |
| `--color-feedback-error-border` | `#fecaca` |
| `--color-feedback-warning-bg` | `#fffbeb` |
| `--color-feedback-warning-bg-strong` | `#fef3c7` |
| `--color-feedback-warning-text` | `#b45309` |
| `--color-feedback-warning-border` | `#fde68a` |
| `--color-feedback-info-bg` | `#eff6ff` |
| `--color-feedback-info-bg-strong` | `#dbeafe` |
| `--color-feedback-info-text` | `#1d4ed8` |
| `--color-feedback-info-border` | `#bfdbfe` |
<!-- /AUTOGEN:colors -->

### 実体

- `src/lib/ui/styles/app.css` — `@theme` ブロックに全トークン定義

---

## 3. タイポグラフィ

- **基本フォント**: system-ui (OS デフォルト)
- **スケール**: 年齢帯ごとに `fontScale` が変動
  - baby: 1.5 (最大)
  - preschool: 1.2
  - elementary: 1.0 (基準)
  - junior: 1.0
  - senior: 1.0 (最小)
- **詳細**: [docs/design/22-タイポグラフィ・スペーシングガイドライン.md](design/22-タイポグラフィ・スペーシングガイドライン.md)

---

## 4. スペーシング

- **基本グリッド**: 4px base
- **タップサイズ**: 年齢帯ごとに可変
  - baby: 120px (大きなタップ領域)
  - preschool: 80px
  - elementary: 56px
  - junior: 48px
  - senior: 44px (Material Design 最小推奨)
- **実体**: `src/lib/domain/validation/age-tier.ts`

---

## 5. コンポーネントプリミティブ（再実装禁止）

以下のコンポーネントは `$lib/ui/primitives/` に定義済み。routes で再実装禁止。

<!-- AUTOGEN:primitives -->
| コンポーネント | インポートパス |
|--------------|---------------|
| Alert | `$lib/ui/primitives/Alert.svelte` |
| Badge | `$lib/ui/primitives/Badge.svelte` |
| Button | `$lib/ui/primitives/Button.svelte` |
| Card | `$lib/ui/primitives/Card.svelte` |
| Dialog | `$lib/ui/primitives/Dialog.svelte` |
| Divider | `$lib/ui/primitives/Divider.svelte` |
| FormField | `$lib/ui/primitives/FormField.svelte` |
| IconButton | `$lib/ui/primitives/IconButton.svelte` |
| PinInput | `$lib/ui/primitives/PinInput.svelte` |
| Progress | `$lib/ui/primitives/Progress.svelte` |
| Select | `$lib/ui/primitives/Select.svelte` |
| Tabs | `$lib/ui/primitives/Tabs.svelte` |
| Toast | `$lib/ui/primitives/Toast.svelte` |
<!-- /AUTOGEN:primitives -->

### ルール

- **ボタンは必ず `Button.svelte` を使用** — `<button class="px-3 py-1 ...">` の直書き禁止
- **フォーム要素は `FormField.svelte`** を使用
- **カードは `Card.svelte`** を使用
- **アラートは `Alert.svelte`** を使用
- 新しい UI パターンが必要な場合は **先に primitives に追加してから** routes で使う
- 実体: `src/lib/ui/primitives/`

---

## 6. 用語辞書（SSOT）

UI に表示されるラベル・用語は `src/lib/domain/labels.ts` を Single Source of Truth とする。

### エクスポート一覧

<!-- AUTOGEN:labels -->
| エクスポート | 種類 | 用途 |
|------------|------|------|
| `NAV_CATEGORIES` | const | ナビゲーションカテゴリ名 |
| `NAV_ITEM_LABELS` | const | ナビゲーション項目ラベル |
| `AGE_TIER_LABELS` | const | 年齢区分ラベル（フル） |
| `AGE_TIER_SHORT_LABELS` | const | 年齢区分ラベル（短縮） |
| `PLAN_LABELS` | const | プラン名（フル） |
| `PLAN_SHORT_LABELS` | const | プラン名（短縮） |
| `PAID_PLAN_LABEL` | const | 有料プラン総称ラベル |
| `LICENSE_PLAN_LABELS` | const |  |
| `THEME_LABELS` | const | テーマ名 |
| `THEME_EMOJIS` | const | テーマ絵文字 |
| `FEATURE_LABELS` | const | 機能名ラベル |
| `CHECKLIST_KIND_LABELS` | const |  |
| `CHECKLIST_KIND_SHORT_LABELS` | const |  |
| `CHECKLIST_KIND_ICONS` | const |  |
| `ACTION_LABELS` | const |  |
| `TRIAL_LABELS` | const |  |
| `PREMIUM_MODAL_LABELS` | const |  |
| `MARKETPLACE_LABELS` | const |  |
| `TUTORIAL_LABELS` | const |  |
| `getAgeTierLabel` | function | 年齢区分ラベル取得 |
| `getAgeTierShortLabel` | function | 年齢区分短縮ラベル取得 |
| `getPlanLabel` | function | プランラベル取得 |
| `getLicensePlanLabel` | function |  |
| `getThemeLabel` | function | テーマラベル取得 |
| `getThemeOptions` | function | テーマ選択肢一覧 |
| `getChecklistKindLabel` | function |  |
| `getChecklistKindShortLabel` | function |  |
| `NavCategoryId` | type |  |
| `PlanKey` | type |  |
| `ThemeKey` | type |  |
| `ChecklistKind` | type |  |
<!-- /AUTOGEN:labels -->

### ルール

- **同じ概念を複数箇所にハードコード禁止** — 用語辞書の定数を使う
- 用語を変更する場合は `grep` で全出現箇所を確認し、辞書の値変更だけで全画面に反映されることを確認
- デモ版 (`/demo`) と本番で異なるラベルを使ってはならない

### 内部コード露出禁止

```svelte
<!-- NG -->
<span>{child.uiMode}</span>

<!-- OK -->
<span>{getAgeTierLabel(child.uiMode)}</span>
```

過去事例: #498, #573

---

## 7. 画像アセット方針

### 画像が必要な場面（絵文字 NG）

- ゲーミフィケーションの報酬 UI（シール、バッジ、トロフィー）
- キャラクター・アバター・マスコット
- ブランドアイデンティティ（ロゴ、アイコン）
- レベル/ランク表示
- OS/ブラウザ間で見た目が変わると困る要素

### 絵文字で許容

- ステータスラベル・通知テキスト内の装飾
- リスト項目の視覚的アクセント
- 活動アイコン（ユーザーがカスタマイズする前提）

### 生成方法

1. **Gemini API** で生成 — `docs/reference/gemini_image_generation_guide.md` 参照
2. チケット化 — 画像生成の要件を明記
3. プレースホルダー配置 — `<!-- TODO: 画像アセット必要: [要件] -->` コメント付き

**詳細**: [docs/design/asset-catalog.md](design/asset-catalog.md)

---

## 8. 年齢帯別 UI（5 モード）

| コード | 日本語名 | fontScale | tapSize | 特性 |
|--------|---------|-----------|---------|------|
| `baby` | 乳幼児 (0-2歳) | 1.5 | 120px | 大きなボタン、シンプルな色 |
| `preschool` | 幼児 (3-5歳) | 1.2 | 80px | 丸い形、ひらがなのみ |
| `elementary` | 小学生 (6-12歳) | 1.0 | 56px | 標準レイアウト、漢字最小限 |
| `junior` | 中学生 (13-15歳) | 1.0 | 48px | 情報密度やや高い |
| `senior` | 高校生 (16-18歳) | 1.0 | 44px | 情報密度高い、漢字 |

### 並行実装の注意

- routes は `src/routes/(child)/[uiMode=uiMode]/` にパラメータルートで統合済み（#664）
- 年齢モードの定義: `src/lib/domain/validation/age-tier.ts`
- 並行実装マップ: [docs/design/parallel-implementations.md](design/parallel-implementations.md)

---

## 9. 禁忌事項（Things Not To Do — デザイン関連）

| 禁止事項 | 理由 | 検出方法 |
|---------|------|---------|
| hex 直書き（routes/features 内） | 3 層トークン違反 | `stylelint color-no-hex` |
| プリミティブ再実装 | primitives と二重管理 | コードレビュー |
| 内部コード UI 露出 | ユーザーに意味不明 | `eslint` + レビュー |
| 用語ハードコード | labels.ts の SSOT 違反 | `grep` チェック |
| インラインスタイル（動的値以外） | メンテナンス困難 | `eslint svelte/no-inline-styles` |
| Tailwind arbitrary hex | 3 層トークン違反 | `stylelint` |
| `<style>` ブロック 50 行超え | コンポーネント分割が必要 | コードレビュー |

---

## 10. AI エージェント向け指示

1. **新規画面作成時はこのファイルを最初に読む**
2. 色を使う場合は §2 のセマンティックトークンから選ぶ
3. UI 要素は §5 のプリミティブを先にチェック
4. ラベル・用語は §6 の用語辞書を使う
5. 画像が必要かは §7 の判断基準に従う
6. 年齢モードの差異は §8 を参照
7. §9 の禁忌事項に違反しない

---

## 11. 更新ルール

| 変更 | 更新すべきセクション | 方法 |
|------|-------------------|------|
| `app.css` の `@theme` に CSS 変数追加 | §2 カラートークン | `node scripts/generate-design-md-sections.mjs` |
| `primitives/` にコンポーネント追加 | §5 プリミティブ | 同上 |
| `labels.ts` に export 追加 | §6 用語辞書 | 同上 |
| ブランド方針変更 | §1 | 手動 |
| 禁忌事項追加 | §9 | 手動 |

### 自動更新コマンド

```bash
node scripts/generate-design-md-sections.mjs
```

---

## 関連ドキュメント

| ドキュメント | 役割 |
|------------|------|
| [06-UI設計書.md](design/06-UI設計書.md) | UI コンポーネント仕様の詳細 |
| [15-ブランドガイドライン.md](design/15-ブランドガイドライン.md) | ブランドの詳細・歴史的背景 |
| [22a-アイコン・ラベル統一規約.md](design/22a-アイコン・ラベル統一規約.md) | アイコン・ラベルの統一規約 |
| [22b-タイポグラフィ・スペーシングガイドライン.md](design/22b-タイポグラフィ・スペーシングガイドライン.md) | タイポ・スペーシングの詳細 |
| [asset-catalog.md](design/asset-catalog.md) | 画像アセットカタログ |
| [parallel-implementations.md](design/parallel-implementations.md) | 並行実装ペア一覧 |
