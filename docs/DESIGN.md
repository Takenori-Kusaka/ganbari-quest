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
- **Action（操作）**: `--color-action-primary`=`var(--theme-primary)` / `--color-action-primary-hover`=`var(--color-brand-700)` / `--color-action-secondary`=`var(--theme-secondary)` / `--color-action-accent`=`var(--theme-accent)` / `--color-action-danger`=`var(--color-danger)` / `--color-action-success`=`var(--color-success)` / `--color-action-ghost`=`transparent` / `--color-action-trial`=`var(--color-premium-light)` / `--color-action-trial-hover`=`var(--color-premium)` / `--color-action-trial-upgrade`=`var(--color-warning)` / `--color-action-trial-upgrade-hover`=`var(--color-warning-hover)`
- **Surface（背景）**: `--color-surface`=`white` / `--color-surface-base`=`var(--color-bg)` / `--color-surface-card`=`white` / `--color-surface-overlay`=`rgba(0, 0, 0, 0.5)` / `--color-surface-elevated`=`white` / `--color-surface-muted`=`var(--color-neutral-50)` / `--color-surface-secondary`=`var(--color-neutral-100)` / `--color-surface-accent`=`var(--color-feedback-info-bg)` / `--color-surface-info`=`var(--color-feedback-info-bg)` / `--color-surface-success`=`var(--color-feedback-success-bg)` / `--color-surface-warning`=`var(--color-feedback-warning-bg)` / `--color-surface-warm`=`#fef3c7` / `--color-surface-themed`=`var(--theme-bg)` / `--color-surface-nav`=`var(--theme-nav)` / `--color-surface-trial`=`var(--color-premium-50)` / `--color-surface-trial-urgent`=`var(--color-feedback-warning-bg)` / `--color-surface-trial-expired`=`var(--color-neutral-50)` / `--color-surface-muted-strong`=`var(--color-neutral-100)` / `--color-surface-tertiary`=`var(--color-neutral-200)` / `--color-surface-error`=`var(--color-feedback-error-bg)` / `--color-surface-error-strong`=`var(--color-feedback-error-bg-strong)`
- **Border（枠線）**: `--color-border`=`var(--color-neutral-200)` / `--color-border-default`=`var(--color-neutral-200)` / `--color-border-light`=`var(--color-neutral-100)` / `--color-border-strong`=`var(--color-neutral-300)` / `--color-border-focus`=`var(--theme-primary)` / `--color-border-accent`=`var(--theme-accent)` / `--color-border-warm`=`rgba(251, 191, 36, 0.3)` / `--color-border-warning`=`var(--color-feedback-warning-border)` / `--color-border-premium`=`color-mix(in srgb, var(--color-premium) 20%, transparent)` / `--color-border-danger`=`color-mix(in srgb, var(--color-danger) 20%, transparent)` / `--color-border-success`=`color-mix(in srgb, var(--color-success) 20%, transparent)` / `--color-border-success-strong`=`color-mix(in srgb, var(--color-success) 40%, transparent)` / `--color-border-trial`=`var(--color-premium-200)` / `--color-border-trial-urgent`=`var(--color-feedback-warning-border)` / `--color-border-trial-expired`=`var(--color-neutral-200)`
- **Text（文字）**: `--color-text`=`#2d2d2d` / `--color-text-muted`=`#6b6b6b` / `--color-text-inverse`=`white` / `--color-text-accent`=`var(--theme-accent)` / `--color-text-link`=`var(--color-brand-700)` / `--color-text-primary`=`var(--color-neutral-700)` / `--color-text-secondary`=`var(--color-neutral-600)` / `--color-text-tertiary`=`var(--color-neutral-400)` / `--color-text-disabled`=`#9ca3af` / `--color-text-warm`=`#92400e` / `--color-text-warm-muted`=`#a16207`
- **Feedback（フィードバック）**: `--color-feedback-success-bg`=`#f0fdf4` / `--color-feedback-success-bg-strong`=`#dcfce7` / `--color-feedback-success-text`=`#15803d` / `--color-feedback-success-border`=`#bbf7d0` / `--color-feedback-error-bg`=`#fef2f2` / `--color-feedback-error-bg-strong`=`#fee2e2` / `--color-feedback-error-text`=`#dc2626` / `--color-feedback-error-border`=`#fecaca` / `--color-feedback-warning-bg`=`#fffbeb` / `--color-feedback-warning-bg-strong`=`#fef3c7` / `--color-feedback-warning-text`=`#b45309` / `--color-feedback-warning-border`=`#fde68a` / `--color-feedback-info-bg`=`#eff6ff` / `--color-feedback-info-bg-strong`=`#dbeafe` / `--color-feedback-info-text`=`#1d4ed8` / `--color-feedback-info-border`=`#bfdbfe`
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

LP (`site/index.html`) の section padding / margin / heading / faq-item など Layout 系設計値は、§2 カラートークンと同じ **Base → Semantic → Component** の 3 層で管理する。再圧縮時に散在 padding を手作業で削るのを避けるための SSOT。意思決定根拠は [ADR-0042](decisions/0042-lp-spacing-layout-tokens.md)。

- **2 層防御 (#1840)**: 実装側 (本ガイドライン) で多層化を防ぎ、CI 側 `cumulative-lp-metrics` ジョブで累積 desktopHeight 膨張を検出する。

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
- 適用範囲: index / pricing / pamphlet / faq / selfhost / graduation 等 LP 全 HTML に波及済 (Phase 1〜3、#1839 / #1851 / #2395)。content 共通 spacing は `--lp-content-*` に集約。残ローカル装飾値は `scripts/lp-inline-style-baseline.json` で pin し、新規 violation 1 件で CI fail (`lp-metrics.yml` `inline-style-check`)。詳細経緯は [ADR-0042](decisions/0042-lp-spacing-layout-tokens.md)

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
| ChildSelectionDialog | `$lib/ui/primitives/ChildSelectionDialog.svelte` |
| Dialog | `$lib/ui/primitives/Dialog.svelte` |
| Divider | `$lib/ui/primitives/Divider.svelte` |
| FormField | `$lib/ui/primitives/FormField.svelte` |
| IconButton | `$lib/ui/primitives/IconButton.svelte` |
| Menu | `$lib/ui/primitives/Menu.svelte` |
| NativeSelect | `$lib/ui/primitives/NativeSelect.svelte` |
| OverflowMenu | `$lib/ui/primitives/OverflowMenu.svelte` |
| PinInput | `$lib/ui/primitives/PinInput.svelte` |
| Progress | `$lib/ui/primitives/Progress.svelte` |
| Select | `$lib/ui/primitives/Select.svelte` |
| Tabs | `$lib/ui/primitives/Tabs.svelte` |
| Toast | `$lib/ui/primitives/Toast.svelte` |
| VisibilityChipGroup | `$lib/ui/primitives/VisibilityChipGroup.svelte` |
<!-- /AUTOGEN:primitives -->

### ルール

- **ボタンは必ず `Button.svelte` を使用** — `<button class="px-3 py-1 ...">` の直書き禁止
- **フォーム要素は `FormField.svelte`** を使用
- **カードは `Card.svelte`** を使用
- **アラートは `Alert.svelte`** を使用
- 新しい UI パターンが必要な場合は **先に primitives に追加してから** routes で使う
- 実体: `src/lib/ui/primitives/`

### Button の `loading` prop（#2632、NN/G #1 visibility of system status）

非同期処理 (取込 / 保存 / 送信 等) を起動するボタンは `loading` prop で「処理中である」visible feedback を出す。クリック後に何も変化しないと「動作したか不明」になり再クリック誤動作を招くため (CX-DoR #9 NN/G #1 違反)、await を伴う操作は必ず loading を反映する。

```svelte
<Button variant="primary" loading={isImporting} onclick={handleImport}>
	{isImporting ? '追加しています…' : '追加'}
</Button>
```

- `loading=true` → spinner 表示 + `disabled` + `aria-busy="true"` を強制（スクリーンリーダーにも「処理中」を伝える）
- `<button>` 描画時のみ有効。`href` 指定の `<a>` (navigation) には loading 非対応 — ページ遷移系の feedback は遷移先で担保する
- `ChildSelectionDialog` の取込確定ボタンは `confirmLoading` prop で本機構を内包する。marketplace 5 type 取込 (`?import=` 受領 admin 画面) の `handleChildSelectionConfirm` 中は `confirmLoading={isImporting}` + `closeOnConfirm={false}` で「取込実行中」を表示し、完了後 (finally) に親が `open=false` する
- 旧 `components/LoadingButton.svelte` は文言固定の限定 variant。新規実装は `Button` の `loading` prop を優先する

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

- **使う**: 保存・削除・操作完了の成功フィードバック / dialog ほど侵襲的でない軽量エラー告知 / 自動消滅 (3s) で十分なもの
- **使わない**: 確認を要する操作 → `Dialog.svelte` / 永続する警告 → `Alert.svelte`
- **使用法**: `showToast('タイトル', '説明 (任意)', 'success'|'error'|'info')`。root layout に `<Toast />` を一度配置する
- **2 層防御パターン (admin 取込/配信 feedback、#2745/#2748 / Round 18 CX-DoR #9)**: marketplace 取込・per-child copy・配信先保存の結果は `showToast()` (`role="alert"`、primary) + in-page banner (`role="status"`、`data-testid="<resource>-action-message"`) を**同期 set する 2 層構成**で出す。Toast は module-level `$state` push でリアクティブ更新されるが `await invalidateAll()` 後の DOM 反映と micro-task race で `expect(toast).toContainText(...)` が timeout するケースがあるため、同 page state の banner を保険として併置する。E2E は banner testid を `toBeVisible` で待つため、Toast / banner どちらが先に表示されても PASS する
- **活用状況 (2026-06-03、Round 18 CX-DoR #9 NN/G #4 consistency)**: `admin/activities` (#2745/#2748) / `admin/rewards` / `admin/checklists` の取込・copy・配信結果が本 2 層パターンに統一済。独自 toast 実装 (`ActivityCard` 等 child 画面側) の primitive 置換は別 follow-up

#### PinInput（数値 PIN 入力）

- **使う**: 家族 / 保護者 PIN 等、数値のみの短い認証入力 / `onComplete` で即時バリデーションが欲しい UI
- **使わない**: 通常のパスワード入力・任意長コード → `FormField.svelte`
- **使用法**: `<PinInput length={6} mask onComplete={({ valueAsString }) => verify(valueAsString)} />`

### interactive primitive の play coverage（CX-DoR #8）

`Dialog` / `Menu` / `OverflowMenu` / `FormField` / `PinInput` / `VisibilityChipGroup` / `ChildSelectionDialog` の操作回帰は `*.stories.svelte` の `play` 関数で component 層検証する（操作 → callback 発火 / disabled 制御 / role / aria）。詳細マトリクスと Portal 経由 query 原則は `tests/CLAUDE.md` §「Storybook interaction test」を参照。新規 interactive primitive を追加する際は play 関数も同時に追加すること（story のみで play 0 件は CX-DoR #8 違反）。

### UnifiedEmptyState（empty state SSOT、#2362 / CX-DoR #11）

admin リソース一覧 (活動 / ごほうび / チェックリスト / ルール / チャレンジ 等) の「データ 0 件」表示は
`src/lib/marketplace/ui/UnifiedEmptyState.svelte` を SSOT として使う。各 page で独自の `<Card>` + 絵文字 +
message を直書きしない (NN/G #4 consistency / `tests/CLAUDE.md` 条件 11 = 3 状態統一)。

- **使う**: admin 一覧の genuine-empty / filter-empty 表示。icon + 本文 (+ 補足 desc) + bridge link を統一レイアウトで描画
- **文言は override props で渡す**: `noItemsText` / `descText` / `filteredText` / `addBtnLabel` / `importLinkLabel` / `icon`。既定は `UNIFIED_EMPTY_STATE_LABELS` (labels.ts SSOT)。page 固有文言を渡せば視覚回帰最小で統一できる
- **secondary link の 2 mode**: `secondaryMode='callback'` (既定、`onAdd('import')` を呼ぶ `<button>`) / `secondaryMode='link'` (form 不要 page 用、`browseHref` への `<a>` 遷移)。bulk import bridge は §10「bulk import bridge ルール」整合で `/marketplace?type=<typeCode>` へ誘導する
- **CTA の出し分け**: `showPrimary` / `canImport` / `canAdd` / `hasFilter` で primary CTA・import link の表示を制御 (上限到達 / filter 下 / browse-only page)
- **testid 互換**: `testid` / `importTestid` で page 既存 testid (`rules-empty-state` 等) を維持し E2E 互換を保つ
- **活用状況 (2026-06-03、Round 18)**: 全 5 admin page (activities は `ActivityEmptyState.svelte` thin wrapper 経由 / rewards / checklists / challenges / settings/rules) が本 SSOT 経由に統一済

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
- **PLAN_TERMS**: `free`=`'無料'` / `standard`=`'スタンダード'` / `premium`=`'プレミアム'` / `family`=`'プレミアム'`
- **PLAN_FULL_TERMS**: `free`=`'無料プラン'` / `standard`=`'スタンダードプラン'` / `premium`=`'プレミアムプラン'` / `family`=`'プレミアムプラン'`
- **PRICE_TERMS**: `standard`=`'¥500'` / `family`=`'¥780'` / `free`=`'¥0'` / `taxNote`=`'（税込）'` / `monthlyPrefix`=`'月 '` / `fromSuffix`=`'〜'`
- **TRIAL_TERMS**: `duration`=`'7日間'` / `durationSpaced`=`'7 日間'` / `durationDays`=`7` / `noCreditCard`=`'クレジットカード登録不要'` / `noCreditCardShort`=`'クレカ登録不要'` / `noCreditCardMid`=`'カード登録不要'` / `noCreditCardDetailed`=`'無料体験中もカード情報は不要。有料プラン切替時に初めて入力します'`
- **CANCEL_TERMS**: `canonical`=`'解約'` / `canonicalVerb`=`'解約する'` / `anytime`=`'いつでも解約'` / `anytimeOk`=`'いつでも解約できます（契約期間の縛りなし）'` / `account`=`'退会'`
- **FREE_TERMS**: `base`=`'基本無料'` / `start`=`'まずは無料'` / `tryFree`=`'無料で始める'` / `suffix`=`'無料'` / `priceGate`=`'必要なら'`
- **CTA_TERMS**: `freeTrialNoun`=`'無料体験'` / `freeTrialVerb`=`'無料で試す'` / `freeTrialDesc`=`'無料で試せます'`
- **LP_FAQ_TERMS**: `canonicalLong`=`'よくあるご質問'` / `canonicalShort`=`'FAQ'` / `linkLabel`=`'よくあるご質問'` / `faqHtmlTitle`=`'よくあるご質問'` / `inlineCtaSentence`=`'他のご質問は <a href="faq.html" class="nav-text">よくあるご質問</a> をご覧ください。'`
- **AGE_RANGE_TERMS**: `short`=`'3〜18 歳'` / `long`=`'3 歳から 18 歳まで'` / `numericShort`=`'3〜18'` / `juniorShort`=`'13〜18 歳'` / `juniorNumericShort`=`'13〜18'`
- **POINT_TERMS**: `unit`=`'pt'` / `unitFull`=`'ポイント'` / `unitSymbol`=`'P'`
- **CURRENCY_TERMS**: `yen`=`'¥'` / `yenFull`=`'円'`
- **FREE_PLAN_TERMS**: `forever`=`'永久無料'` / `foreverDot`=`'永久無料 ・ '` / `planSelfNoun`=`'フリー'`
- **AUTONOMY_TERMS**: `selfMotivated`=`'自分から動きだす'` / `selfMotivatedPast`=`'自分から動きだした'` / `selfPlanning`=`'自分で計画する'` / `selfPlanningAble`=`'自分で計画できる'`
- **ADMIN_VIEW_TERMS**: `canonical`=`'ご家族の見守り画面'` / `short`=`'見守り画面'` / `parent`=`'保護者の見守り画面'`
- **STRIPE_PORTAL_TERMS**: `canonical`=`'Stripe の請求管理ページ'` / `short`=`'請求管理ページ'` / `billingPortal`=`'請求管理ページ'`
- **CHILD_TERMS**: `honorific`=`'お子さま'` / `neutral`=`'子供'` / `hiragana`=`'こども'`
- **PARENT_TERMS**: `honorific`=`'保護者'` / `neutral`=`'親'`
- **SIGNUP_TERMS**: `canonical`=`'お申し込み'` / `canonicalVerb`=`'お申し込みする'` / `signup`=`'サインアップ'`
- **LOGIN_TERMS**: `canonical`=`'ログイン'` / `signin`=`'サインイン'`
- **TRIAL_PERIOD_TERMS**: `full`=`'7 日間無料トライアル'` / `shortNoSpace`=`'7日間無料トライアル'`
- **UPGRADE_TERMS**: `canonical`=`'プラン変更'` / `actionVerb`=`'アップグレード'` / `higherPlan`=`'上位プラン'`
- **PLAN_CHANGE_TERMS**: `changeVerb`=`'プランを変更'` / `changeNoun`=`'プラン変更'` / `scheduledChange`=`'切り替わります'` / `archive`=`'アーカイブ'` / `archiveVerb`=`'アーカイブされます'` / `restore`=`'復活'`
- **GRADUATION_TERMS**: `canonical`=`'卒業'` / `finalGoal`=`'最終ゴール'`
- **ADVENTURE_TERMS**: `canonical`=`'冒険'` / `mainQuest`=`'メインクエスト'`
- **MECHANISM_TERMS**: `canonical`=`'仕組み'` / `device`=`'工夫'` / `blueprint`=`'設計'`
- **LIFESTAGE_TERMS**: `canonical`=`'年齢'` / `tier`=`'年齢区分'` / `schoolGrade`=`'学年'`
- **CHEER_TERMS**: `canonical`=`'応援'` / `action`=`'応援する'` / `reasonField`=`'できごと'`
- **REWARD_TERMS**: `menu`=`'ごほうび管理'` / `shop`=`'ごほうびショップ'` / `preset`=`'プリセット'` / `canonical`=`'ごほうび'`
- **TEMPLATE_TERMS**: `userFacing`=`'みんなのテンプレート'` / `short`=`'テンプレート'` / `browse`=`'みんなのテンプレートを見る'`
- **CHECKOUT_TERMS**: `chosenPlanFeature`=`'お選びのプランの機能'`
- **TOKUSHOHO_TERMS**: `heading1Quantity`=`'分量'` / `heading2Price`=`'販売価格'` / `heading3Payment`=`'支払時期・方法'` / `heading4Delivery`=`'引渡時期・自動更新'` / `heading5Cancel`=`'申込撤回・解約方法'` / `heading6Important`=`'重要事項'` / `cancelButtonLabel`=`'やめる'`
- **CHECKOUT_SUCCESS_TERMS**: `successHeading`=`'ご利用ありがとうございます'` / `goHomeButton`=`'ホームへ移動'` / `preparingHeading`=`'準備中'` / `processingHeading`=`'お支払いの確認をしています'` / `goHomeBackButton`=`'ホームへ戻る'` / `failedHeading`=`'お支払いが完了していません'` / `backToPlanButton`=`'プランページに戻る'` / `timeoutHeading`=`'処理に時間がかかっています'` / `reloadButton`=`'再読込'`
- **NUC_EDITION_TERMS**: `selfHosted`=`'セルフホスト版'` / `fullAccess`=`'全機能利用可能'` / `unlimited`=`'無制限'` / `editionEmoji`=`'🏠'`
- **OYAKAGI_TERMS**: `name`=`'おやカギコード'` / `shortName`=`'おやカギ'`
- **PIN_DEFAULT_TERMS**: `hintFull`=`'初期値は 5086（がんばり）です'` / `hintCompact`=`'初期 5086（がんばり）'`
- **OVERFLOW_MENU_TERMS**: `openLabel`=`'メニューを開く'` / `itemMarketplace`=`'みんなのテンプレから取込'` / `itemAiSuggest`=`'AI で提案してもらう'` / `itemRestore`=`'バックアップから復元'` / `itemRestoreIcon`=`'⬇'` / `itemExport`=`'エクスポート'` / `itemExportIcon`=`'⬆'` / `itemHelp`=`'このページのヘルプ'`
- **CHILD_SELECTION_TERMS**: `dialogTitleSuffix`=`'に追加?'` / `dialogTitleQuestion`=`'どの'` / `allOptionLabel`=`'全員に追加'` / `confirmLabel`=`'追加'` / `confirmLoadingLabel`=`'追加しています…'` / `cancelLabel`=`'キャンセル'` / `listAriaLabel`=`'お子さま一覧'` / `ageUnitSuffix`=`'歳'`
- **VISIBILITY_CHIP_TERMS**: `sectionTitle`=`'配信するお子さま'` / `toggleOn`=`'表示'` / `toggleOff`=`'非表示'` / `allOnLabel`=`'全員 ON'` / `allOffLabel`=`'全員 OFF'` / `groupAriaLabel`=`'配信お子さま選択'`
<!-- /AUTOGEN:terms -->

### labels.ts エクスポート一覧（compound）

> **全 export の一覧はこのファイルに掲載しない**（135+ namespace を持つ `src/lib/domain/labels.ts` が SSOT）。DESIGN.md は「使う前に SSOT を確認する」ルールのみを定義し、発見性は `grep` / IDE 補完、SSOT 整合性は CI (`check-no-plan-literals` / `check-hardcoded-strings`) が担保する。掲載をミラーしない方針は [ADR-0045](decisions/0045-terms-ssot-2-layer.md) §「補遺」参照。

**確認手順**: 新規ラベルを追加する前に `grep -n "_LABELS" src/lib/domain/labels.ts` で既存 compound を確認する。代表的な namespace / 関数:

- 取得関数: `getAgeTierLabel` / `getAgeTierShortLabel` / `getPlanLabel` / `getThemeLabel` / `getThemeOptions` / `getActivityPriorityLabel` / `getCancellationCategoryLabel` / `getMilestoneLabel`
- 整形関数: `formatCount` / `formatAge` / `formatAgeRange` / `formatStreak` / `formatTimes` / `formatPeople` / `formatDateRange`
- 主要 namespace: `PLAN_LABELS`（プラン名フル）/ `AGE_TIER_LABELS`（年齢区分）/ `THEME_LABELS`（テーマ名）/ `FEATURE_LABELS`（機能名）/ `NAV_*_LABELS`（ナビ）/ `LP_*_LABELS`（LP 各セクション）/ `*_PAGE_LABELS`（各画面）/ `DEMO_*_LABELS`（デモ）/ `OPS_*_LABELS`（運用）

### ルール

- **新規 atom 追加は `terms.ts` に**（プラン名 / 価格 / 期間 / 解約 / 無料訴求 / CTA 動詞句などの単一用語）— `labels.ts` に直接書かない（ADR-0045 §3.3）
- **新規 compound 追加は `labels.ts` に**（複数 atom を組み立てた表示文字列）— `terms.ts` から `import` し template literal で参照する
- **同じ概念を複数箇所にハードコード禁止** — 用語辞書の定数を使う
- 用語を変更する場合は `grep` で全出現箇所を確認し、atom 1 行修正だけで全画面に反映されることを確認
- デモ版 (`/demo`) と本番で異なるラベルを使ってはならない

### marketplace type 命名規則（#2899）

`MARKETPLACE_TYPE_LABELS`（`src/lib/domain/marketplace-item.ts`）/ marketplace registry descriptor の `displayLabel`（`src/lib/marketplace/`）に並ぶ 5 type 名は、以下を守る:

- **ページタイトルと重複させない**: type カードはページタイトル「みんなのテンプレート」と並んで表示されるため、type 名に `みんなのテンプレート` を含めない（旧「みんなのテンプレート（活動）」は重複で不適切だったため「活動セット」に是正）
- **兄弟 type と同型の単独名詞にする**: `活動セット` / `ごほうびセット` / `チェックリスト` / `とくべつルール` / `チャレンジ集` のように「<内容物> + セット / 集 / リスト」型の単独名詞で統一する。説明句や括弧付きサブ識別子を足さない
- **2 つの SSOT を一致させる**: `MARKETPLACE_TYPE_LABELS`（marketplace top の type カード）と registry `displayLabel`（`UnifiedImportHub` タブ）の同 type 名は一致させる

### 概念アイコン SSOT（CONCEPT_ICONS、#2899）

システム上の固定概念（活動 / ごほうび / チェックリスト / ルール / チャレンジ / みんなのテンプレート / AI 提案 / ヘルプ）に紐づくアイコン絵文字は `src/lib/domain/terms.ts` の `CONCEPT_ICONS` atom を SSOT とする（カラー 3 層トークン / terms.ts 2 層と同型）。「同一概念 = 同一アイコン」を 1 箇所で保証する。

| 概念 (key) | アイコン | 値の根拠 |
|---|---|---|
| `activity` | 📝 | 実績バッジ `activity_master` が 📝 を使用（asset-catalog.md）。記録する行為のメタファ。📋 は checklist と衝突するため不採用 |
| `reward` | 🎁 | ごほうび = ギフト |
| `checklist` | 📋 | `src/lib/domain/icons.ts` の `ICON_CHECKLIST`（子供ナビ /checklist タブ + DB default）と**同値**。checklist 概念の正規アイコンに整合（✅ は activity との混同回避のため不採用） |
| `rule` | 📜 | ルール = 巻物 |
| `challenge` | 🎯 | チャレンジ = 的 |
| `template` | 🏪 | みんなのテンプレート = 取込元 marketplace（旧 📦 を統一） |
| `aiSuggest` | 🤖 | AI 提案 |
| `help` | ❓ | ヘルプ |

- **対象**: システム文言に付く固定概念アイコンのみ（marketplace type / overflow menu / 各 admin 一覧の「概念を指すアイコン」）
- **対象外**: ユーザーがカスタマイズする活動・チェックリスト項目のアイコン（`item.icon` / `COMMON_ICONS` picker / stamp emoji 等のデータ値）。§7「活動アイコンはユーザーがカスタマイズする前提」整合のため、データ値の絵文字は固定化しない
- **既存アイコン層との整合**: `icons.ts` は子供ナビアイコン層、`CONCEPT_ICONS` は marketplace / overflow 概念アイコン層で責務が異なるため import 共有はしないが、同一概念（checklist）には同値（📋）を割り当て、コメントで紐付ける（層を跨ぐ循環 import を避ける）
- **検出**: marketplace 取込導線で template 概念アイコンを SSOT を介さず直書きする pattern（旧 `📦 {TEMPLATE_TERMS.browse}` 等）は `scripts/check-no-plan-literals.mjs`（kind=concept-icon）で検出。修正は `{CONCEPT_ICONS.template} {TEMPLATE_TERMS.browse}` の形にする。本 lint は template 概念の特定アンチパターンの regression guard であり、全 8 概念アイコンの全面ガードではない（他概念アイコンはユーザーデータ値と判別不能なため bare emoji 検出を行わず、SSOT 集約はコードレビューで担保）

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
| `--z-reward` | `90` | reward | 誕生日ボーナス等の祝福 modal（旧 `MonthlyRewardDialog` は #2295 で撤去済、現状は誕生日演出のみ） |
| `--z-tutorial` | `100` | tutorial | `TutorialOverlay` / `PageGuideOverlay` / `SiblingCheerOverlay` 等の操作ガイド系 |
| `--z-celebration` | `200` | celebration | `SiblingCelebration` 等の最上位演出 |
| `--z-debug` | `9999` | debug | `DebugPlanIndicator` / `NavigationProgress`（dev / 内部用、本番ビルドでは表示されない） |

### 重畳ルール

- **同時表示時の優先順位**: celebration > tutorial > reward > modal > overlay > banner > dropdown > sticky > base
- **#2295 (EPIC #2294 ①) で `MonthlyRewardDialog` 撤去済 (2026-05-19)**:
  - 旧シーケンス: 月初に reward modal (`--z-reward = 90`) が前面 → 閉じて背面 `MilestoneBanner` 表示
  - 現状: reward 層は誕生日ボーナス等の限定的な祝福のみ。月替わりプレゼント機構はシーズン機構撤去に伴い廃止
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
  - reward (`--z-reward`): 誕生日ボーナス系 modal (旧 `MonthlyRewardDialog` は #2295 で撤去済)
  - banner: `src/lib/features/value-preview/MilestoneBanner.svelte`（flow 配置のため z-index 未使用）

### 構造的ルール (EPIC #2253 admin-activities add UX、#2258)

#### 画面あたり FAB は最大 1 個

Material Design 3「画面 FAB 1 個原則」+ Notion / Linear / Asana / Todoist / Slack の業界収束に整合。

- **admin layout に常設 FAB は置かない (現状 0 個、#2904)**。フィードバック導線は 設定 > サポート (`/admin/settings/support`) の**単独 SSOT** (#2904 PO 判断: 各ページには不要、設定 > サポートにあれば OK)。各画面に個別のフィードバック導線 (FAB / ︙ menu item 等) を増設しない (ADR-0012 anti-engagement / Clippy 型常時露出の回避)
- 画面別ローカル FAB を追加したい場合は、まず header `+` dropdown / menu への集約で代替できないかを評価する (EPIC #2253 / #2255 で `AddActivityFab` を header `+` dropdown に統合した前例)。置く場合も画面あたり最大 1 個を厳守する

#### add 経路 ≤ 4 ルール (Hick's Law)

同一リソース (活動 / 子供 / 報酬 / 等) の add 経路 (CTA 種別 × UI 配置) が 4 を超えたら、menu / dropdown / command palette のいずれかで集約する。

同一リソースの add 系操作は **1 つの `+ 追加` dropdown menu に集約**する (Notion / Linear の `+` パターン)。並列の独立ボタンは顧客混乱を招くため不可。適用済: admin/activities (#2558)・admin/checklists (#2778 → #2903、`Menu` primitive で統合)。

#### admin リソース管理画面の標準構成 = AdminResourceHeader + + 追加 dropdown + UnifiedEmptyState (#2998、EPIC #2897)

活動管理 / チェックリスト管理 / ごほうび管理 など admin リソース管理画面は、**同一の正準構成**で実装する。ヘッダー構造・add 経路・AI 起動・empty state がページごとにバラバラだと顧客が画面ごとに操作を学び直す (NN/G #4 consistency 違反、PO 再三指摘「UI を統一してくれというのはずっと言ってきた」) ため、構成要素を共通コンポーネント / SSOT に集約する。

| 要素 | 正準実装 | 配置 |
|---|---|---|
| **ヘッダー** | `AdminResourceHeader.svelte` (`src/lib/features/admin/components/`) を全画面で共有 | title + 1 行説明 + 右側 toolbar (+ 追加 dropdown / ︙ overflow) |
| **+ 追加 dropdown** | `AdminResourceHeader` の `addMenuItems` (Menu primitive)。先頭 3 経路 = 手動 / AI で提案 / みんなのテンプレートから探す を**同一 id・同一順序**で揃える | header 右側 (本文に独立 add ボタンを置かない) |
| **AI 提案** | + 追加 dropdown の選択肢 → Dialog で起動。**ページ本文に AI パネルを直置きしない** | Dialog 内 |
| **みんなのテンプレートから探す** | admin 内 browse UI を出さず `/marketplace?type=<typeCode>` へ画面遷移 | dropdown 選択 → goto |
| **︙ overflow menu** | `AdminResourceHeader` の `overflowItems` (内蔵 Menu) または `overflowSnippet`。復元 / エクスポート / 全削除 等の補助操作を集約する (任意。item 0 件なら ︙ を出さない)。フィードバック item は置かない (フィードバック導線 = 設定 > サポート単独 SSOT、#2904 PO 判断) | header 右端 |
| **empty state** | `UnifiedEmptyState.svelte` (SSOT、CX-DoR #11)。genuine-empty では bulk import bridge link を出す (下記「bulk import bridge ルール」整合)。primary CTA は header `+ 追加` に集約済のため重複させない | 一覧 0 件時 |
| **page タイトル** | `PAGE_TITLES.*` (svelte:head) + `AdminResourceHeader` の title。リソース名は単独名詞 (「チェックリスト管理」等、「持ち物」等の限定語を付けない) | — |

新規の admin リソース管理画面を作る際は、独自ヘッダーを inline で組まず **`AdminResourceHeader` を使う**。`ActivitiesHeader.svelte` は本コンポーネントの thin wrapper (活動固有の menu item 構成のみ担当)。`?` ページガイド trigger は `AdminLayout` (全 admin 共通) が担うため本コンポーネント scope 外。

#### admin リソース管理ページの add 経路は同型に揃える (#2903 / #2998、PO 指摘 #6b)

複数の admin リソース管理ページ (活動 / チェックリスト / ごほうび / 等) の「+ 追加」dropdown は、**先頭 3 経路 (手動 / AI で提案 / みんなのテンプレートから探す) を同一順序で揃える** (NN/G #4 consistency)。AI 提案は dropdown 内の選択肢 → Dialog で開く方式に統一し、ページ本文に AI パネルを直置きしない (操作の入口がページ間で異なると顧客が混乱するため)。「みんなのテンプレートから探す」は admin 内 browse UI を出さず `/marketplace?type=<typeCode>` へ画面遷移する (マーケットプレイス一本化、本 §10 上記ルール整合)。同型性は **3 画面 (活動 / チェックリスト / ごほうび)** を対象に `tests/e2e/admin-add-path-isomorphism.spec.ts` が assert する (経路「数」でなく dropdown item の種類・順序の配置パターン同型性、#2998 AC6)。

#### marketplace 取込はマーケットプレイス画面に一本化 (admin 内ブラウズ UI 二重管理禁止、#2558)

プリセット (みんなのテンプレート) の **閲覧・選択 UI は `/marketplace` 配下でのみ実装**する。親管理画面内に marketplace 風のブラウズ UI を埋め込む (= 二重管理) ことは禁止する。

- admin 画面の「みんなのテンプレートから探す」は `/marketplace?type=<typeCode>` への**画面遷移**とし、in-page ブラウズ UI を出さない。取込実行は marketplace 詳細 → `?import=<presetId>` → `ChildSelectionDialog` の正規経路 (`marketplace-import-flow.md` §3.1) に合流させる。
- **ファイル復元 (JSON / CSV import) はマーケットプレイスとは別概念**。`UnifiedImportHub` がブラウズ UI とファイル復元を兼ねている場合、ブラウズ UI のみ撤去し、ファイル復元は独立した導線 (例: `︙` overflow menu の「バックアップから復元」+ 専用ダイアログ、`OVERFLOW_MENU_TERMS.itemRestore`) として保持する。
- **適用範囲**: #2558 段階2 (activities) + 段階3 (rewards / challenges / checklists / settings/rules) で**全 5 type の admin 画面で in-page browse UI を撤去完了**。`UnifiedImportHub.svelte` component 自体は Storybook / unit test / 将来用途 (LP 経由公開ブラウズ等) のため存続させる。詳細は [marketplace-import-flow.md §5.1](design/marketplace-import-flow.md)。

#### marketplace 取込 CTA 5 type 統一原則 (#2774 + #2775 で完遂、User 指摘 #2/#4 根治)

marketplace 詳細 (`/marketplace/<typeCode>/<itemId>`) の認証済取込 CTA は、**全 5 type で `<a href="/admin/<page>?import=${itemId}">` 形式に統一**する (server action 経由は不採用、admin 側 `?import=` query → `ChildSelectionDialog` auto-open に合流)。testid は `<typeCode>-import-cta` 命名。type に応じた Strategy 分岐は `importPresetToChildren` action が担う。詳細・命名一覧は [marketplace-import-flow.md §3.1](design/marketplace-import-flow.md) (#2774 / #2775)。

#### bulk import bridge ルール

bulk import / 一括取込機能がある場合、以下の両方を提供する:
1. **empty state からの secondary link** (初期 setup 期の発見性、#2558 段階2 以降は `/marketplace` 遷移トリガ)
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
| `labels.ts` に export 追加 | （DESIGN.md 更新不要） | `labels.ts` 自体が SSOT。DESIGN.md は全列挙をミラーしない（ADR-0045 補遺） |
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
