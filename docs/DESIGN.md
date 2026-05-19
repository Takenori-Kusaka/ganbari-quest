# DESIGN.md — がんばりクエスト デザインシステム SSOT

> **AI エージェントへ**: 新規画面・コンポーネントを作成する前に、このファイルを最初に読んでください。
> ここに記載されたルール・トークン・コンポーネントが実装の基準です。

---

## 1. ブランドアイデンティティ

- **ターゲット**: 3-15歳の子供 × 保護者
- **トーン**: 明るい・温かい・親しみやすい・冒険的
- **テーマ**: RPG / 冒険（ポイント、レベル、クエスト）
- **対象年齢ごとのスタイル**: 幼児向けは丸く大きく、中高生向けはシャープで情報密度を上げる
- **Anti-engagement 原則 ([ADR-0012](decisions/0012-anti-engagement-principle.md))**: 子供側 UI の滞在時間は価値毀損指標。「記録する → 数秒で閉じる」最短経路を設計原則とし、連続ガチャ / インフィニットスクロール / 通知連打 / 自動再生 / サプライズ濫用は不採用。販促文言も同じ審査対象
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

### 日本語テキスト折り返し（ADR-0016）

日本語は空白区切りがないため、見出し・ボタン・カードタイトルが不自然な位置で折り返される問題への方針:

- **第一選択（CSS, 0KB）**: `h1`, `h2`, `h3`, `.heading`, `.tutorial-title`, `.btn-label` に `text-wrap: balance; word-break: auto-phrase;` を適用（`app.css`）
- **フォールバック（BudouX, ~15KB）**: 古いブラウザ / 長文段落 / チュートリアル本文で `use:budoux` Svelte action を必要箇所のみ適用（`$lib/ui/actions/budoux.ts`）
- **LP 側**: CDN Web Component (`<budoux-ja>`) で追加バンドルなし

SSR 二重適用は `data-budoux-applied` フラグで回避。詳細は [ADR-0016](decisions/0016-japanese-text-wrap.md)。

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

### LP Spacing/Layout 3 層トークン (#1839、ADR-0042)

LP (`site/index.html`) の section padding / margin / heading / faq-item など Layout 系設計値は、§2 カラートークンと同じ **Base → Semantic → Component** の 3 層で管理する。過去 5 PR (#1759 / #1798 / #1827 / #1831 / #1836) で section padding を多層的に圧縮 (40→28 等) してきた状態を SSOT 化し、再圧縮時の散在修正を不要にする。

**ADR-0042**: 本トークン体系の意思決定根拠は [docs/decisions/0042-lp-spacing-layout-tokens.md](decisions/0042-lp-spacing-layout-tokens.md) を参照。

**累積監視機構との相補関係 (#1840)**: 本リファクタは [#1840 累積 desktopHeight 監視機構](https://github.com/Takenori-Kusaka/ganbari-quest/pull/1841)（`cumulative-lp-metrics` ジョブ）と相補的に機能する。**実装側 (本ガイドライン) で多層化を防ぎ、CI 側 (#1840) で累積膨張を検出**する 2 層防御。Phase 1 は実装側ガード、Phase 2 (stylelint hard-fail) は両者を橋渡しする CI 強化となる。

#### 設計原則

| 層 | 使用可能場所 | 例 |
|----|------------|------|
| **Component** | `site/index.html` `<style>` 等の class セレクタ | `.section{padding-block: var(--lp-section-padding-y)}` |
| **Semantic** | `site/shared.css` の `:root` 定義のみ | `--lp-section-padding-y: var(--space-7);` |
| **Base** | 同上 | `--space-7: 28px;` |

#### Base Spacing トークン (4px グリッド)

| トークン | 値 |
|---------|----|
| `--space-0` | `0` |
| `--space-1` | `4px` |
| `--space-2` | `8px` |
| `--space-3` | `12px` |
| `--space-4` | `16px` |
| `--space-5` | `20px` |
| `--space-6` | `24px` |
| `--space-7` | `28px` |
| `--space-8` | `32px` |
| `--space-9` | `36px` |
| `--space-10` | `40px` |
| `--space-12` | `48px` |
| `--space-14` | `56px` |
| `--space-16` | `64px` |

#### Semantic LP Spacing トークン

| トークン | 値 | 用途 |
|---------|----|------|
| `--lp-section-padding-y` | `var(--space-7)` | `.section` 縦 padding (28px、#1836 で圧縮済み) |
| `--lp-section-padding-x` | `var(--space-4)` | `.section` 横 padding (16px) |
| `--lp-section-title-mb` | `var(--space-1)` | `.section-title` 下マージン (4px、#1831 で圧縮済み) |
| `--lp-section-desc-mb-default` | `14px` | `.section-desc` 下マージン (#1836 で 14px、4px グリッド外のため直値) |
| `--lp-faq-item-padding-y` | `14px` | `.faq-item` 上下 padding (#1831、4px グリッド外のため直値) |
| `--lp-hero-padding-top` | `var(--space-12)` | `.hero` 上 padding (48px) |
| `--lp-hero-padding-bottom` | `var(--space-9)` | `.hero` 下 padding (36px) |
| `--lp-card-padding-y` (#1911 B-1) | `var(--space-4)` | card 系統合 (`.tour-card` / `.soft-card` / `.core-loop-card`) 縦 padding 既定 (16px) |
| `--lp-card-padding-x` (#1911 B-1) | `14px` | card 系統合 横 padding 既定 (4px グリッド外、直値) |
| `--lp-card-padding-y-md` / `-x-md` (#1911 B-1) | `var(--space-6)` / `22px` | card 系統合 @≥1024px (24px / 22px) |
| `--lp-card-padding-y-lg` / `-x-lg` (#1911 B-1) | `var(--space-7)` / `var(--space-6)` | card 系統合 @≥1440px (28px / 24px) |
| `--lp-card-shot-aspect-ratio` (#1911 B-3) | `390/844` | card 系 scrshot 枠 (`.tour-shot` / `.soft-shot` / `.age-panel-shot`) aspect-ratio 統一値 |
| `--lp-card-gap` | `var(--space-5)` | `.machine-tour` / `.soft-grid` のグリッド間隔 (20px) |
| `--lp-container-max` | `1080px` | section-inner / header-inner / footer-inner の最大幅 |
| `--lp-container-max-wide` | `1280px` | hero / machine-tour / guide 用ワイド版 |

#### 禁忌

- **`site/index.html` `<style>` 内に padding/margin の数値直書き禁止** (例: `padding:40px 16px`、`margin-bottom:14px`) — Semantic トークン経由で参照する
- **Semantic トークン (`--lp-*`) を `:root` 以外で定義しない** (`site/shared.css` の SSOT 1 箇所のみ)
- **値を変更したいときは Component (class) を触らず Semantic / Base 値を更新する** — desktopHeight ratchet 違反のたびに散在 padding を手動で削るのではなく、`--lp-section-padding-y` 等を 1 行更新して全箇所に反映させる

#### 実体

- 定義: `site/shared.css` の `:root` ブロック (`--space-*` Base + `--lp-*` Semantic)
- 参照: `site/index.html` `<style>` ブロック (Component セレクタ)
- 段階適用 (Issue #1839 / #1851):
  - **Phase 1 (PR #1850、完了 2026-05-02)**: `:root` トークン整備 + 主要 6 セレクタ (`.section` / `.section-title` / `.section-desc` / `.hero` / `.faq-item` / `#core-loop`) の置換。当初 `.cta-bottom` も対象だったが PR #1842 (#1838) で section ごと削除されたため Phase 1 範囲外
  - **Phase 2 (#1851 PR、完了 2026-05-06)**: 残構造的 padding/margin の Semantic 化 (`.tour-card` / `.soft-card` / `.versus-card` / `.trust-badge` / `.floating-cta` / `.pp-band` / `.age-panel` / `.core-loop-card` / `#growth-roadmap` / `#versus` / `.trust-disclaimer` 等) + `pricing.html` への波及 (`.plan-card` / `.pricing-hero` / `.trial-box` / `.faq-section` / `.cta-bottom` / `.family-patterns` / `.pattern-card` / `.comparison-section` / `.plans-section` 等) + `scripts/check-lp-inline-style.mjs` baseline pin 機構の導入。残ローカル装飾値 (gap / 微小余白 / 絵文字 padding 等) は `scripts/lp-inline-style-baseline.json` で pin され、新規 violation 1 件で CI fail (`.github/workflows/lp-metrics.yml` `inline-style-check` ジョブ)
  - **Phase 3 (別 Issue 起票予定)**: `pamphlet.html` / `faq.html` / `selfhost.html` / `graduation.html` へ同パターンで波及 + baseline 縮小

---

## 5. コンポーネントプリミティブ（再実装禁止）

以下のコンポーネントは `$lib/ui/primitives/` に定義済み。routes で再実装禁止。

<!-- AUTOGEN:primitives -->
| コンポーネント | インポートパス |
|--------------|---------------|
| Alert | `$lib/ui/primitives/Alert.svelte` |
| Badge | `$lib/ui/primitives/Badge.svelte` |
| BirthdayInput | `$lib/ui/primitives/BirthdayInput.svelte` |
| Button | `$lib/ui/primitives/Button.svelte` |
| Card | `$lib/ui/primitives/Card.svelte` |
| Dialog | `$lib/ui/primitives/Dialog.svelte` |
| Divider | `$lib/ui/primitives/Divider.svelte` |
| FormField | `$lib/ui/primitives/FormField.svelte` |
| IconButton | `$lib/ui/primitives/IconButton.svelte` |
| Menu | `$lib/ui/primitives/Menu.svelte` |
| NativeSelect | `$lib/ui/primitives/NativeSelect.svelte` |
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

### FormField の `type` 一覧（#1191）

`<input>` / `<textarea>` 直書きの代替として `FormField.svelte` が以下 variant を提供する。

| type | 描画要素 | 用途 |
|------|---------|------|
| `text` (default) | `<input type="text">` | 汎用テキスト |
| `email` | `<input type="email">` | メールアドレス |
| `password` | `<input type="password">` | パスワード。`showToggle` で表示/非表示 (#587) |
| `number` | `<input type="number">` | 数値（`min` / `max` / `step` プロパティ併用） |
| `tel` | `<input type="tel">` | 電話番号 |
| `url` | `<input type="url">` | URL |
| `search` | `<input type="search">` | 検索 |
| `date` | `<input type="date">` | 日付 |
| `time` | `<input type="time">` | 時刻 |
| `datetime-local` | `<input type="datetime-local">` | 日時 |
| `textarea` | `<textarea>` | 複数行入力（`rows` でサイズ制御、既定 4） |

`label` / `error` / `hint` / `disabled` / `required` / `aria-invalid` / `aria-describedby` は全 type で一貫。
routes/features で `<input>` / `<textarea>` を直書きする前に、この表の type で賄えないかを先に確認する。

### 使用パターンガイド（Toast / PinInput）

`#1175` UI 監査で検出された未活用 primitive について、正しい使用場面を明記する。

#### Toast（一時通知）

- **現状の使用**: アプリ本体では未使用（`ActivityCard.svelte` / `demo/admin/license/+page.svelte` に独自の toast 実装が存在し、`showToast()` 経由の統一動線が無い）
- **使うべき場面**:
  - 保存・削除・操作完了の成功フィードバック（例: `showToast('保存しました', undefined, 'success')`）
  - 非同期操作のエラー告知（dialog ほど侵襲的でない軽量通知）
  - 自動消滅 (3s) で十分な情報量のもの
- **使わない場面**:
  - 確認を要する操作 → `Dialog.svelte`
  - 永続する警告・注意 → `Alert.svelte`
- **使用方法**:

  ```svelte
  <script>
  import { showToast } from '$lib/ui/primitives/Toast.svelte';
  // ...
  showToast('タイトル', '説明 (任意)', 'success' | 'error' | 'info');
  </script>
  ```
  root layout には `<Toast />` を一度配置する必要あり。

- **未活用箇所（follow-up 起票対象）**: `ActivityCard.svelte` の `frozen-toast`、`demo/admin/license` の `demo-toast` など独自実装箇所を Toast primitive に置換する

#### PinInput（数値 PIN 入力）

- **現状の使用**: 全体で 0 箇所（primitive 自身のみ）
- **使うべき場面**:
  - 家族 PIN / 保護者 PIN 等、数値のみの短い認証入力
  - onComplete callback で即時バリデーションが欲しい UI
- **使わない場面**:
  - 通常のパスワード入力 → `FormField.svelte` with `type="password"`
  - 任意長さのコード入力 → `FormField.svelte`
- **使用方法**:

  ```svelte
  <PinInput length={6} mask onComplete={({ valueAsString }) => verify(valueAsString)} />
  ```

- **未活用箇所（follow-up 起票対象）**: 保護者 PIN 設定 / 確認画面、家族招待コード入力、その他 4〜6 桁入力

---

## 6. 用語辞書（SSOT）

UI に表示されるラベル・用語は **`src/lib/domain/terms.ts` (atom) → `src/lib/domain/labels.ts` (compound)** の 2 階層 SSOT で管理する (#1916 / [ADR-0045](decisions/0045-terms-ssot-2-layer.md))。

### 階層図

```
┌────────────────────────────────────────────────────────────────┐
│ src/lib/domain/terms.ts          (atom — 用語集)               │
│   PLAN_TERMS       — プラン名（短縮）                          │
│   PLAN_FULL_TERMS  — プラン名（フル「〜プラン」付き）          │
│   PRICE_TERMS      — 価格 (¥500 / ¥780 / ¥0 / 月 / 〜 / 税込) │
│   TRIAL_TERMS      — トライアル (7日間 / カード登録不要)       │
│   CANCEL_TERMS     — 解約 (いつでも解約)                       │
│   FREE_TERMS       — 無料訴求 (基本無料 / まずは無料)          │
│   CTA_TERMS        — CTA 動詞句 (無料体験 / 無料で試す)        │
│   例: PLAN_TERMS.standard = 'スタンダード'                     │
└──────────────────────────┬─────────────────────────────────────┘
                           │ import + ${...} template literal 参照
                           ▼
┌────────────────────────────────────────────────────────────────┐
│ src/lib/domain/labels.ts         (compound — 表示文字列)       │
│   PLAN_LABELS / TRIAL_LABELS / LP_*_LABELS / 等               │
│   例: PLAN_LABELS.standard = `${PLAN_FULL_TERMS.standard}`     │
│       TRIAL_LABELS.upgradeGuard =                              │
│         `${PLAN_FULL_TERMS.standard}以上で…`                   │
└──────────────────────────┬─────────────────────────────────────┘
                           │
                           ▼
       *.svelte / *.html / shared-labels.js (LP) / 法務文書
```

**設計原則** (ADR-0045 §3.3):

- **atom (terms.ts)**: 単一の用語。1 行修正で全 LP・アプリ本体・法務文書に伝播。新規 atom は **必ず `terms.ts` に追加**
- **compound (labels.ts)**: 複数 atom を文に組み立てた表示文字列。**`${PLAN_FULL_TERMS.standard}` 等 template literal で参照**し、atom 値の文字列リテラル直書き禁止
- **LP 側** (`site/shared-labels.js`): `scripts/generate-lp-labels.mjs` で template literal を解決した後、文字列値として配信（Phase 1 B1 / #1917）
- **CSS 3 層トークン (ADR-0042) と同型**: Base (terms.ts atom) → Semantic (labels.ts compound) → Component (`*.svelte` / `*.html`) の責務分離パターン

### terms.ts エクスポート一覧（atom）

`src/lib/domain/terms.ts` の atom 定数。値の変更は本ファイル 1 行修正で全コンテンツに伝播する (ADR-0045)。

<!-- AUTOGEN:terms -->
#### PLAN_TERMS

| key | 値 |
|-----|----|
| `free` | `'無料'` |
| `standard` | `'スタンダード'` |
| `family` | `'ファミリー'` |

#### PLAN_FULL_TERMS

| key | 値 |
|-----|----|
| `free` | `'無料プラン'` |
| `standard` | `'スタンダードプラン'` |
| `family` | `'ファミリープラン'` |

#### PRICE_TERMS

| key | 値 |
|-----|----|
| `standard` | `'¥500'` |
| `family` | `'¥780'` |
| `free` | `'¥0'` |
| `taxNote` | `'（税込）'` |
| `monthlyPrefix` | `'月 '` |
| `fromSuffix` | `'〜'` |

#### TRIAL_TERMS

| key | 値 |
|-----|----|
| `duration` | `'7日間'` |
| `durationSpaced` | `'7 日間'` |
| `durationDays` | `7` |
| `noCreditCard` | `'クレジットカード登録不要'` |
| `noCreditCardShort` | `'クレカ登録不要'` |
| `noCreditCardMid` | `'カード登録不要'` |
| `noCreditCardDetailed` | `'無料体験中もカード情報は不要。有料プラン切替時に初めて入力します'` |

#### CANCEL_TERMS

| key | 値 |
|-----|----|
| `canonical` | `'解約'` |
| `canonicalVerb` | `'解約する'` |
| `anytime` | `'いつでも解約'` |
| `anytimeOk` | `'いつでも解約できます（契約期間の縛りなし）'` |
| `account` | `'退会'` |

#### FREE_TERMS

| key | 値 |
|-----|----|
| `base` | `'基本無料'` |
| `start` | `'まずは無料'` |
| `tryFree` | `'無料で始める'` |
| `suffix` | `'無料'` |
| `priceGate` | `'必要なら'` |

#### CTA_TERMS

| key | 値 |
|-----|----|
| `freeTrialNoun` | `'無料体験'` |
| `freeTrialVerb` | `'無料で試す'` |
| `freeTrialDesc` | `'無料で試せます'` |

#### LP_FAQ_TERMS

| key | 値 |
|-----|----|
| `canonicalLong` | `'よくあるご質問'` |
| `canonicalShort` | `'FAQ'` |
| `linkLabel` | `'よくあるご質問'` |
| `faqHtmlTitle` | `'よくあるご質問'` |
| `inlineCtaSentence` | `'他のご質問は <a href="faq.html" class="nav-text">よくあるご質問</a> をご覧ください。'` |

#### AGE_RANGE_TERMS

| key | 値 |
|-----|----|
| `short` | `'3〜18 歳'` |
| `long` | `'3 歳から 18 歳まで'` |
| `numericShort` | `'3〜18'` |
| `juniorShort` | `'13〜18 歳'` |
| `juniorNumericShort` | `'13〜18'` |

#### POINT_TERMS

| key | 値 |
|-----|----|
| `unit` | `'pt'` |
| `unitFull` | `'ポイント'` |
| `unitSymbol` | `'P'` |

#### CURRENCY_TERMS

| key | 値 |
|-----|----|
| `yen` | `'¥'` |
| `yenFull` | `'円'` |

#### FREE_PLAN_TERMS

| key | 値 |
|-----|----|
| `forever` | `'永久無料'` |
| `foreverDot` | `'永久無料 ・ '` |
| `planSelfNoun` | `'フリー'` |

#### AUTONOMY_TERMS

| key | 値 |
|-----|----|
| `selfMotivated` | `'自分から動きだす'` |
| `selfMotivatedPast` | `'自分から動きだした'` |
| `selfPlanning` | `'自分で計画する'` |
| `selfPlanningAble` | `'自分で計画できる'` |

#### ADMIN_VIEW_TERMS

| key | 値 |
|-----|----|
| `canonical` | `'ご家族の見守り画面'` |
| `short` | `'見守り画面'` |
| `parent` | `'保護者の見守り画面'` |

#### STRIPE_PORTAL_TERMS

| key | 値 |
|-----|----|
| `canonical` | `'Stripe の請求管理ページ'` |
| `short` | `'請求管理ページ'` |
| `billingPortal` | `'請求管理ページ'` |

#### CHILD_TERMS

| key | 値 |
|-----|----|
| `honorific` | `'お子さま'` |
| `neutral` | `'子供'` |
| `hiragana` | `'こども'` |

#### PARENT_TERMS

| key | 値 |
|-----|----|
| `honorific` | `'保護者'` |
| `neutral` | `'親'` |

#### SIGNUP_TERMS

| key | 値 |
|-----|----|
| `canonical` | `'お申し込み'` |
| `canonicalVerb` | `'お申し込みする'` |
| `signup` | `'サインアップ'` |

#### LOGIN_TERMS

| key | 値 |
|-----|----|
| `canonical` | `'ログイン'` |
| `signin` | `'サインイン'` |

#### TRIAL_PERIOD_TERMS

| key | 値 |
|-----|----|
| `full` | `'7 日間無料トライアル'` |
| `shortNoSpace` | `'7日間無料トライアル'` |

#### UPGRADE_TERMS

| key | 値 |
|-----|----|
| `canonical` | `'プラン変更'` |
| `actionVerb` | `'アップグレード'` |
| `higherPlan` | `'上位プラン'` |

#### GRADUATION_TERMS

| key | 値 |
|-----|----|
| `canonical` | `'卒業'` |
| `finalGoal` | `'最終ゴール'` |

#### ADVENTURE_TERMS

| key | 値 |
|-----|----|
| `canonical` | `'冒険'` |
| `mainQuest` | `'メインクエスト'` |

#### MECHANISM_TERMS

| key | 値 |
|-----|----|
| `canonical` | `'仕組み'` |
| `device` | `'工夫'` |
| `blueprint` | `'設計'` |

#### LIFESTAGE_TERMS

| key | 値 |
|-----|----|
| `canonical` | `'年齢'` |
| `tier` | `'年齢区分'` |
| `schoolGrade` | `'学年'` |

#### CHEER_TERMS

| key | 値 |
|-----|----|
| `canonical` | `'応援'` |
| `action` | `'応援する'` |
| `reasonField` | `'できごと'` |

#### REWARD_TERMS

| key | 値 |
|-----|----|
| `menu` | `'ごほうび管理'` |
| `shop` | `'ごほうびショップ'` |
| `preset` | `'プリセット'` |
| `canonical` | `'ごほうび'` |

#### TEMPLATE_TERMS

| key | 値 |
|-----|----|
| `userFacing` | `'みんなのテンプレート'` |
| `short` | `'テンプレート'` |
| `browse` | `'みんなのテンプレートを見る'` |
<!-- /AUTOGEN:terms -->

### labels.ts エクスポート一覧（compound）

<!-- AUTOGEN:labels -->
| エクスポート | 種類 | 用途 |
|------------|------|------|
| `APP_LABELS` | const |  |
| `PAGE_TITLES` | const |  |
| `UI_LABELS` | const |  |
| `SETUP_LABELS` | const |  |
| `NAV_CATEGORIES` | const | ナビゲーションカテゴリ名 |
| `NAV_ITEM_LABELS` | const | ナビゲーション項目ラベル |
| `AGE_TIER_LABELS` | const | 年齢区分ラベル（フル） |
| `AGE_TIER_SHORT_LABELS` | const | 年齢区分ラベル（短縮） |
| `PLAN_LABELS` | const | プラン名（フル） |
| `PLAN_SHORT_LABELS` | const | プラン名（短縮） |
| `PAID_PLAN_LABEL` | const | 有料プラン総称ラベル |
| `PLAN_GATE_LABELS` | const |  |
| `LICENSE_PLAN_LABELS` | const |  |
| `THEME_LABELS` | const | テーマ名 |
| `THEME_EMOJIS` | const | テーマ絵文字 |
| `FEATURE_LABELS` | const | 機能名ラベル |
| `ACTIVITY_PRIORITY_LABELS` | const |  |
| `ACTIVITY_PRIORITY_FORM_LABELS` | const |  |
| `ACTION_LABELS` | const |  |
| `TRIAL_LABELS` | const |  |
| `LIFECYCLE_EMAIL_LABELS` | const |  |
| `PMF_SURVEY_LABELS` | const |  |
| `PREMIUM_MODAL_LABELS` | const |  |
| `MARKETPLACE_LABELS` | const |  |
| `MARKETPLACE_FILTER_LABELS` | const |  |
| `TUTORIAL_LABELS` | const |  |
| `TUTORIAL_CHAPTER_LABELS` | const |  |
| `DEMO_LABELS` | const |  |
| `OYAKAGI_LABELS` | const |  |
| `IMPORT_LABELS` | const |  |
| `SETTINGS_LABELS` | const |  |
| `LICENSE_PAGE_LABELS` | const |  |
| `REPORTS_LABELS` | const |  |
| `OPS_LABELS` | const |  |
| `POINTS_LABELS` | const |  |
| `SIGNUP_LABELS` | const |  |
| `ANALYTICS_LABELS` | const |  |
| `BILLING_LABELS` | const |  |
| `CANCELLATION_CATEGORY` | const |  |
| `CANCELLATION_CATEGORIES` | const |  |
| `CANCELLATION_LABELS` | const |  |
| `GRADUATION_LABELS` | const |  |
| `OPS_GRADUATION_LABELS` | const |  |
| `OPS_CANCELLATION_LABELS` | const |  |
| `OPS_LICENSE_ISSUE_LABELS` | const |  |
| `OPS_REVENUE_LABELS` | const |  |
| `OPS_BUSINESS_LABELS` | const |  |
| `CHILD_HOME_LABELS` | const |  |
| `DEMO_SIGNUP_LABELS` | const |  |
| `CHALLENGES_LABELS` | const |  |
| `LOGIN_LABELS` | const |  |
| `MEMBERS_LABELS` | const |  |
| `DEMO_TOP_LABELS` | const |  |
| `GROWTH_BOOK_LABELS` | const |  |
| `OPS_ANALYTICS_LABELS` | const |  |
| `OPS_PRESET_DISTRIBUTION_LABELS` | const |  |
| `DEMO_SETTINGS_LABELS` | const |  |
| `ERROR_PAGE_LABELS` | const |  |
| `OPS_LICENSE_KEY_LABELS` | const |  |
| `STATUS_LABELS` | const |  |
| `PRICING_PAGE_LABELS` | const |  |
| `CONSENT_LABELS` | const |  |
| `DEMO_STATUS_LABELS` | const |  |
| `OPS_COSTS_LABELS` | const |  |
| `REWARDS_LABELS` | const |  |
| `DEMO_MEMBERS_LABELS` | const |  |
| `OPS_EXPORT_LABELS` | const |  |
| `CHEER_LABELS` | const |  |
| `OPS_COHORT_LABELS` | const |  |
| `SETUP_FIRST_ADVENTURE_LABELS` | const |  |
| `DEMO_POINTS_LABELS` | const |  |
| `ACTIVITIES_INTRODUCE_LABELS` | const |  |
| `EVENTS_LABELS` | const |  |
| `FORGOT_PASSWORD_LABELS` | const |  |
| `DEMO_REWARDS_LABELS` | const |  |
| `SETUP_COMPLETE_LABELS` | const |  |
| `CERTIFICATE_DETAIL_LABELS` | const |  |
| `DEMO_CHILD_HOME_LABELS` | const |  |
| `DEMO_ADMIN_HOME_LABELS` | const |  |
| `SETUP_CHILDREN_LABELS` | const |  |
| `ADMIN_CHILDREN_LABELS` | const |  |
| `ACTIVITY_FORM_LABELS` | const |  |
| `ADMIN_HOME_LABELS` | const |  |
| `DOWNGRADE_RESOURCE_SELECTOR_LABELS` | const |  |
| `CHILD_PROFILE_CARD_LABELS` | const |  |
| `DEMO_REPORTS_LABELS` | const |  |
| `ADMIN_CHILDREN_PAGE_LABELS` | const |  |
| `CERTIFICATES_PAGE_LABELS` | const |  |
| `PACKS_PAGE_LABELS` | const |  |
| `OPS_LAYOUT_LABELS` | const |  |
| `SETUP_QUESTIONNAIRE_LABELS` | const |  |
| `CHILD_STATUS_LABELS` | const |  |
| `AUTH_INVITE_LABELS` | const |  |
| `DEMO_LAYOUT_LABELS` | const |  |
| `SETUP_PACKS_LABELS` | const |  |
| `SETUP_REWARDS_LABELS` | const |  |
| `SETUP_RULES_LABELS` | const |  |
| `PARENT_LOGIN_LABELS` | const |  |
| `VIEW_PAGE_LABELS` | const |  |
| `DEMO_BATTLE_LABELS` | const |  |
| `CHILD_CHECKLIST_LABELS` | const |  |
| `DEMO_CHILD_CHECKLIST_LABELS` | const |  |
| `ADMIN_CHECKLISTS_PAGE_LABELS` | const |  |
| `ADMIN_RULES_PAGE_LABELS` | const |  |
| `DEMO_ACTIVITIES_LABELS` | const |  |
| `DEMO_CHECKLISTS_LABELS` | const |  |
| `DEMO_EVENTS_LABELS` | const |  |
| `SWITCH_PAGE_LABELS` | const |  |
| `OPS_LICENSE_PAGE_LABELS` | const |  |
| `DEMO_CHALLENGES_LABELS` | const |  |
| `DEMO_CHILD_ACHIEVEMENTS_LABELS` | const |  |
| `LP_NAV_LABELS` | const |  |
| `LP_FOOTER_LABELS` | const |  |
| `LP_HERO_PRICE_BAND_LABELS` | const |  |
| `LP_CTA_TRUST_BADGES_LABELS` | const |  |
| `LP_HERO_SPEC_BADGES_LABELS` | const |  |
| `LP_COMMON_LABELS` | const |  |
| `LP_LEGAL_DISCLAIMER_LABELS` | const |  |
| `LP_PRICING_LABELS` | const |  |
| `FOUNDER_INQUIRY_LABELS` | const |  |
| `LP_RETENTION_LABELS` | const |  |
| `BABY_HOME_LABELS` | const |  |
| `ONBOARDING_LABELS` | const |  |
| `LP_VERSUS_LABELS` | const |  |
| `LP_GROWTH_ROADMAP_LABELS` | const |  |
| `LP_CORELOOP_LABELS` | const |  |
| `CHILD_SHOP_LABELS` | const |  |
| `ADMIN_SHOP_REQUEST_LABELS` | const |  |
| `ADMIN_REWARDS_REQUESTS_LABELS` | const |  |
| `UI_PRIMITIVES_LABELS` | const |  |
| `STAMP_PRESS_N_MESSAGES` | const |  |
| `USAGE_TIME_LABELS` | const |  |
| `UI_COMPONENTS_LABELS` | const |  |
| `FEATURES_LABELS` | const |  |
| `LEGAL_LABELS` | const |  |
| `PUSH_NOTIFICATION_LABELS` | const |  |
| `LP_LICENSEKEY_LABELS` | const |  |
| `LP_FAQ_LABELS` | const |  |
| `LP_SELFHOST_LABELS` | const |  |
| `LP_FLOATING_CTA_LABELS` | const |  |
| `LP_INDEX_EXTRA_LABELS` | const |  |
| `LP_PAMPHLET_LABELS` | const |  |
| `LP_PRICING_EXTRA_LABELS` | const |  |
| `STORYBOOK_LABELS` | const |  |
| `MILESTONE_LABELS` | const |  |
| `VALUE_PREVIEW_LABELS` | const |  |
| `LP_INDEX_PHASEB_LABELS` | const |  |
| `LP_PRICING_PHASEB_LABELS` | const |  |
| `LP_FAQ_PHASEB_LABELS` | const |  |
| `LP_PAMPHLET_PHASEB_LABELS` | const |  |
| `LP_LEGAL_PRIVACY_LABELS` | const |  |
| `LP_LEGAL_TERMS_LABELS` | const |  |
| `LP_LEGAL_SLA_LABELS` | const |  |
| `LP_LEGAL_TOKUSHOHO_LABELS` | const |  |
| `formatCount` | function |  |
| `formatAge` | function |  |
| `formatAgeRange` | function |  |
| `formatStreak` | function |  |
| `formatTimes` | function |  |
| `formatPeople` | function |  |
| `formatDateRange` | function |  |
| `getAgeTierLabel` | function | 年齢区分ラベル取得 |
| `getAgeTierShortLabel` | function | 年齢区分短縮ラベル取得 |
| `getPlanLabel` | function | プランラベル取得 |
| `getLicensePlanLabel` | function |  |
| `getThemeLabel` | function | テーマラベル取得 |
| `getThemeOptions` | function | テーマ選択肢一覧 |
| `getActivityPriorityLabel` | function |  |
| `getCancellationCategoryLabel` | function |  |
| `getMilestoneLabel` | function |  |
| `getMilestoneBannerTitle` | function |  |
| `NavCategoryId` | type |  |
| `PlanKey` | type |  |
| `ThemeKey` | type |  |
| `ActivityPriority` | type |  |
| `PmfSurveyQ1` | type |  |
| `PmfSurveyQ3` | type |  |
| `MarketplaceGender` | type |  |
| `MarketplaceSortKey` | type |  |
| `ImportSkipReason` | type |  |
| `CancellationCategory` | type |  |
<!-- /AUTOGEN:labels -->

### ルール

- **新規 atom 追加は `terms.ts` に**（プラン名 / 価格 / 期間 / 解約 / 無料訴求 / CTA 動詞句などの単一用語）— `labels.ts` に直接書かない（ADR-0045 §3.3）
- **新規 compound 追加は `labels.ts` に**（複数 atom を組み立てた表示文字列）— `terms.ts` から `import` し template literal で参照する
- **同じ概念を複数箇所にハードコード禁止** — 用語辞書の定数を使う
- 用語を変更する場合は `grep` で全出現箇所を確認し、atom 1 行修正だけで全画面に反映されることを確認
- デモ版 (`/demo`) と本番で異なるラベルを使ってはならない

### 禁忌（terms.ts atom 関連、ADR-0045）

| 禁止事項 | 理由 | 検出方法 |
|---------|------|---------|
| **terms.ts atom 値の文字列リテラル直書き複製**（例: `*.svelte` 内に `'スタンダードプラン'` / `'¥500'` / `'7日間'` を直書き） | 用語変更時の伝播が壊れる。ADR-0045 §1.2 の実害 15+ 件再発 | `scripts/check-no-plan-literals.mjs` (#972 / #1918 で強化) |
| **labels.ts compound 内で atom 値を直書き**（例: `TRIAL_LABELS.foo: '7日間無料体験…'` を `${TRIAL_TERMS.duration}${FREE_TERMS.suffix}体験…` に置換しない） | atom 1 行伝播原則を壊す | コードレビュー + `check-no-plan-literals.mjs` |
| **terms.ts に compound（複数 atom 組立文）を追加** | atom / compound の責務分離違反（ADR-0045 §3.3） | コードレビュー（PR で `terms.ts` 差分が ≥ 2 atom 結合を含む場合は labels.ts へ移動） |
| **LP HTML / 法務文書で atom 値を直書き**（fallback `<span data-label-key="…">スタンダードプラン</span>` の手動更新を含む） | `scripts/generate-lp-labels.mjs` 経由の伝播が崩れる | `npm run pre-ready` Step 8 (`generate-lp-labels --check`) |

### 内部コード露出禁止

```svelte
<!-- NG -->
<span>{child.uiMode}</span>

<!-- OK -->
<span>{getAgeTierLabel(child.uiMode)}</span>
```

過去事例: #498, #573

### 5 ドメイン用語の文脈別使い分けルール（#1914 TECH-F、ADR-0045）

`labels.ts` 全体で多重表記が検出された 5 ドメイン（子供 / 親 / 解約 / 登録 / ログイン）の文脈別使い分け原則。`terms.ts` の atom で SSOT 集約し、`labels.ts` compound から `${...}` で参照する。

| ドメイン | atom | 文脈別使い分け |
|---|---|---|
| **子供** | `CHILD_TERMS.honorific` / `.neutral` / `.hiragana` | LP hero 主訴求・法務文書 = `honorific` (「お子さま」) / 機能説明・客観的記述 = `neutral` (「子供」) / 子供画面 UI (preschool/elementary) = `hiragana` (「こども」) |
| **親** | `PARENT_TERMS.honorific` / `.neutral` | 法務文書・利用規約 = `honorific` (「保護者」) / LP hero・機能説明文 = `neutral` (「親」) |
| **解約** | `CANCEL_TERMS.canonical` / `.canonicalVerb` / `.account` | サブスク終了 = `canonical` (「解約」) / 動詞 = `canonicalVerb` (「解約する」) / アカウント完全削除 = `account` (「退会」) / ボタン操作取消 = `UI_LABELS.cancel` (「キャンセル」、本 atom 対象外) |
| **登録（サブスク開設意味）** | `SIGNUP_TERMS.canonical` | サブスク契約・アカウント開設 = `canonical` (「お申し込み」) / 「お子さま登録」「活動登録」「メール登録」等のサブ機能登録は本 atom 対象外 |
| **ログイン** | `LOGIN_TERMS.canonical` | UI 表示 = `canonical` (「ログイン」)、`signin` (「サインイン」) は UI 表示で 0 件維持 |

**禁忌**:
- 同一画面・同一セクション内で 2 表記混在を避ける（hero=お子さま、機能説明=子供 を厳守）
- `UI_LABELS.cancel: 'キャンセル'` は **ボタン操作取消の意味で残存**。「サブスクリプションをキャンセル」のような解約意味の文では `${CANCEL_TERMS.canonical}` を参照する
- 「お子さま登録」「活動登録」等の **サブ機能登録は `SIGNUP_TERMS.canonical` 置換対象外**。サブスク開設文脈の「アカウント登録」「サインアップ」のみ `canonical` 経由化

### Storybook ラベル言語ポリシー（#1738、#1465 follow-up）

`src/lib/ui/**/*.stories.svelte` のラベル運用ルール。PR #1680 (SSOT 100% 完全化) Re-Review で観察された日英混在（Badge は英語化、LoadingButton は日本語維持）の一貫性問題への決定:

| 要素 | 言語 | 理由 |
|------|------|------|
| Story 名（サイドバー: `Primary` / `Default` / `AllVariants` 等） | 英語 | Storybook の慣習（`autodocs` 自動グルーピング・URL slug） |
| `argTypes` の制御メタ情報（`control: 'select'` 等） | 英語のまま | Storybook が解釈する設定値 |
| **コンポーネント表示テキスト**（子要素・`message` プロパティ・トースト本文・ボタンラベル・カードコンテンツ・フォームの `label`/`placeholder`/`error` 等） | **日本語** | アプリ本体 UI が日本語であり、Storybook の用途（実際の見た目検証）上日本語で揃える方が UI 折り返し（ADR-0016）・タイポ検証で有用 |

#### 強制ルール

- 表示テキストは `STORYBOOK_LABELS` 定数（`src/lib/domain/labels.ts`）経由で参照すること
- stories.svelte 内で表示テキストを文字列リテラル直書きしない（既存 Story の表示テキストを変更する場合は labels.ts に値を追加してから差し替え）
- 内部 namespace (`STORYBOOK_LABELS.button.primary` 等) は他の `LABELS` namespace と完全独立。LP / アプリ側 SSOT (ADR-0009) と用語が偶然一致してもリレーションは持たない（Storybook 自体は本番ビルド非搭載）

#### 例外

- `Logo` のように variant 名がそのまま視覚的識別子として意味を持つ場合（`symbol` / `compact` / `full` のキャプション等）は、ブランドコンポーネントの ID と一致させるため英語維持を許容（`STORYBOOK_LABELS.logo.captionXxx` で集約）
- `ProgressFill` / `Skeleton` 等、表示テキストを持たない純粋な視覚プリミティブのみで構成される stories は対象外

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

## 8. 年齢帯別 UI（4 コアモード + 準備モード）

コアターゲット: **3〜18 歳** (ADR-0011)。0〜2 歳は「準備モード」として親向け画面を提供。

| コード | 日本語名 | fontScale | tapSize | 特性 |
|--------|---------|-----------|---------|------|
| `baby` | 準備モード (0-2歳) | 1.5 | 120px | 親向け・子供向けゲーミフィケーション非適用 |
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

## 10. z-index 階層（#1722）

オーバーレイ系 UI（Modal / Dialog / Banner / Tutorial / Celebration）の重畳順を一元管理するため、`app.css` に `--z-*` トークンを定義し、各コンポーネントから参照する。生数値（`z-index: 90` 等）の直書きは禁止。

### 階層トークン

| トークン | 値 | 階層 | 用途 / 代表例 |
|---------|---|------|---------------|
| `--z-base` | `0` | base | 通常 flow（指定なし相当） |
| `--z-sticky` | `10` | sticky | 固定 header / sticky 要素 / 通常 stacking 内の前面要素 |
| `--z-dropdown` | `20` | dropdown | menu / popover（画面の一部を覆う非モーダル） |
| `--z-banner` | `30` | banner | FAB / inline banner（情報通知レベル、Modal 配下に隠れる）。`MilestoneBanner` は flow なので原則 z-index 不要だが、絶対配置にする派生では `--z-banner` を使う |
| `--z-overlay` | `40` | overlay | Dialog Backdrop（Ark UI primitive） |
| `--z-modal` | `50` | modal | Dialog Content（Ark UI primitive）／`AdminLayout` sidebar |
| `--z-reward` | `90` | reward | 月替わりプレゼント / 誕生日ボーナス等の祝福 modal（`MonthlyRewardDialog`） |
| `--z-tutorial` | `100` | tutorial | `TutorialOverlay` / `PageGuideOverlay` / `SiblingCheerOverlay` 等の操作ガイド系 |
| `--z-celebration` | `200` | celebration | `SiblingCelebration` 等の最上位演出 |
| `--z-debug` | `9999` | debug | `DebugPlanIndicator` / `NavigationProgress`（dev / 内部用、本番ビルドでは表示されない） |

### 重畳ルール

- **同時表示時の優先順位**: celebration > tutorial > reward > modal > overlay > banner > dropdown > sticky > base
- **MilestoneBanner と MonthlyRewardDialog のシーケンス（#1722 AC2）**:
  - 月初に reward modal（`--z-reward = 90`）が前面表示される
  - 半透明 backdrop（`--color-surface-overlay`）により背面の `MilestoneBanner` は意図的に視認不可
  - ユーザが reward を受け取って閉じると `showOpening = false` となり modal が即座に消える
  - 背面に常時 mount されている `MilestoneBanner` がそのまま視認可能になる（追加の遷移 / 再 mount は不要）
- **Anti-engagement 適合（ADR-0012）**: 重畳を増やすことで滞在時間を延伸しない。reward / tutorial / celebration は常時 1 件のみ表示され、連続演出を行わない

### 禁忌

| 禁止事項 | 理由 |
|---------|------|
| `z-index: 50;` 等の生数値直書き（`--z-*` 未使用） | 階層が散在し相互整合が壊れる。新規コンポーネントは必ずトークンから選ぶ |
| 9999 を新規追加 | debug 専用枠。本番 UI で 9999 を使う前に階層トークンの追加可否を ADR で議論する |
| reward と tutorial を同時表示 | 子供画面で侵襲的演出が重なる。どちらかを優先的に表示し他方を遅延させる |

### 実体

- トークン定義: `src/lib/ui/styles/app.css`（`@theme` ブロック）
- 既存利用箇所（参考）:
  - reward (`--z-reward`): `src/lib/ui/components/MonthlyRewardDialog.svelte`
  - banner: `src/lib/features/value-preview/MilestoneBanner.svelte`（flow 配置のため z-index 未使用）

### 構造的ルール (EPIC #2253 admin-activities add UX、#2258)

#### 画面あたり FAB は最大 1 個

Material Design 3「画面 FAB 1 個原則」+ Notion / Linear / Asana / Todoist / Slack の業界収束に整合。

- **admin layout の FAB は最大 1 個 (`FeedbackFab` のみ)**。`AddActivityFab` 等の画面別ローカル FAB は撤去し、header `+` dropdown menu に統合する (EPIC #2253 / #2255)
- 画面別ローカル FAB を追加したい場合は、既存 FAB との関係 (撤廃 / 統合 / page-aware 切替) を先に評価する
- 子画面でやむを得ず FAB が必要なら、その画面では `FeedbackFab` を非表示にすることで「画面 FAB 1 個」を維持する

#### add 経路 ≤ 4 ルール (Hick's Law)

同一リソース (活動 / 子供 / 報酬 / 等) の add 経路 (CTA 種別 × UI 配置) が 4 を超えたら、menu / dropdown / command palette のいずれかで集約する。

#### bulk import bridge ルール

bulk import / 一括取込機能がある場合、以下の両方を提供する:
1. **empty state からの secondary link** (初期 setup 期の発見性)
2. **header `+` メニュー内の 1 階層内アクセス** (運用期の到達性)

#### admin scope z-index トークン化

`AdminLayout.svelte` 等の admin 系コンポーネントは `z-index: 50` 等の生数値直書きを禁止し、`var(--z-modal)` 等のトークン経由に統一する (EPIC #2253 / #2258)。

---

## 11. AI エージェント向け指示

1. **新規画面作成時はこのファイルを最初に読む**
2. 色を使う場合は §2 のセマンティックトークンから選ぶ
3. UI 要素は §5 のプリミティブを先にチェック
4. ラベル・用語は §6 の用語辞書を使う
5. 画像が必要かは §7 の判断基準に従う
6. 年齢モードの差異は §8 を参照
7. §9 の禁忌事項に違反しない
8. **オーバーレイ / モーダル / バナーの z-index は §10 のトークンから選ぶ**（生数値直書き禁止）
9. **LP / pricing ページ文言を書く前に ADR-0013 の committed/aspirational 区別を確認する**（`docs/design/19-プライシング戦略書.md` 附則参照）。Aspirational は LP に記載しない

---

## 12. 更新ルール

| 変更 | 更新すべきセクション | 方法 |
|------|-------------------|------|
| `app.css` の `@theme` に CSS 変数追加 | §2 カラートークン | `node scripts/generate-design-md-sections.mjs` |
| `primitives/` にコンポーネント追加 | §5 プリミティブ | 同上 |
| `terms.ts` に atom 定数追加 (#1923 / ADR-0045) | §6 用語辞書（terms.ts エクスポート一覧） | 同上 |
| `labels.ts` に export 追加 | §6 用語辞書（labels.ts エクスポート一覧） | 同上 |
| z-index トークン追加・新オーバーレイ階層追加 | §10 z-index 階層 | 手動（ADR で階層変更を議論したうえで） |
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
