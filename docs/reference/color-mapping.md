# カラーマッピング表 — Tailwindデフォルト → ブランドカラー

本ドキュメントは、Tailwindデフォルトカラーからブランドカラー（CSS変数）への移行基準を定義する。

## 背景

`app.css` で3層トークンアーキテクチャ（Base → Semantic → Component）を定義しているが、
実際のコンポーネントではTailwindデフォルトカラーが直接使用されており、ブランドカラーと不整合が発生している。

## テーマコンテキスト一覧

本プロジェクトには以下のテーマコンテキストがあり、それぞれカラーパレットが必要:

### 子供カラーテーマ (`[data-theme]`)

各テーマは `--theme-50` 〜 `--theme-900` の 10 段階スケールを持つ。
コンポーネントからは `--theme-primary`, `--theme-secondary`, `--theme-accent`, `--theme-bg`, `--theme-nav` で参照する。

| テーマ | 基調色 | primary | accent | 用途 |
|--------|--------|---------|--------|------|
| pink | ピンク系 | --theme-400 (#ff69b4) | --theme-600 (#e91e7b) | 子供の個人カラー設定 |
| blue | 水色系 | --theme-300 (#4fc3f7) | --theme-600 (#039be5) | 子供の個人カラー設定 |
| green | 緑系 | --theme-400 (#66bb6a) | --theme-700 (#388e3c) | 子供の個人カラー設定 |
| orange | オレンジ系 | --theme-400 (#ffa726) | --theme-700 (#f57c00) | 子供の個人カラー設定 |
| purple | 紫系 | --theme-400 (#ab47bc) | --theme-700 (#7b1fa2) | 子供の個人カラー設定 |
| admin | ブランドブルー | brand-600 | brand-800 | 親管理画面・ポータル画面 |

### プラン別テーマ (`[data-plan]`)
| プラン | 基調色 | ナビ色 | バッジ |
|--------|--------|--------|--------|
| free | ブランドブルー | brand-100/200 | なし |
| standard | バイオレット | premium-50/100 | バイオレット |
| family | バイオレット＋ゴールド | gold-100/200 | ゴールド |

### 適用箇所
- **子供画面** (`/kinder/home`, `/upper/home` 等): `data-theme` + `data-age-tier`
- **親管理画面** (`/admin/*`): `data-theme="admin"` + `data-plan`
- **ポータル画面** (`/switch`): `data-theme="admin"` + `data-plan`

---

## Phase 1: Tailwind @theme 上書き（即効策）

Tailwind v4 の `@theme` でデフォルト色スケールをブランドカラーに上書きする。
既存の `bg-blue-500` 等のクラスがブランドカラーに解決されるようになる。

### Blue → Brand Blue（ロゴ・アクション）

| Tailwind | デフォルト hex | → ブランド変数 | ブランド hex |
|----------|-------------|--------------|------------|
| blue-50 | #eff6ff | --color-brand-50 | #f2f9ff |
| blue-100 | #dbeafe | --color-brand-100 | #e8f4fd |
| blue-200 | #bfdbfe | --color-brand-200 | #c9e2f8 |
| blue-300 | #93c5fd | --color-brand-300 | #a3cef3 |
| blue-400 | #60a5fa | --color-brand-400 | #7db8ed |
| blue-500 | #3b82f6 | --color-brand-500 | #5ba3e6 |
| blue-600 | #2563eb | --color-brand-600 | #4a90d9 |
| blue-700 | #1d4ed8 | --color-brand-700 | #3878b8 |
| blue-800 | #1e40af | --color-brand-800 | #2a5f9e |
| blue-900 | #1e3a8a | --color-brand-900 | #1a3a5c |

### Gray → Neutral（テキスト・ボーダー・背景）

| Tailwind | デフォルト hex | → ブランド変数 | ブランド hex |
|----------|-------------|--------------|------------|
| gray-50 | #f9fafb | --color-neutral-50 | #f8fafc |
| gray-100 | #f3f4f6 | --color-neutral-100 | #f1f5f9 |
| gray-200 | #e5e7eb | --color-neutral-200 | #e2e8f0 |
| gray-300 | #d1d5db | --color-neutral-300 | #cbd5e1 |
| gray-400 | #9ca3af | --color-neutral-400 | #8b8b8b |
| gray-500 | #6b7280 | --color-neutral-500 | #64748b |
| gray-600 | #4b5563 | --color-neutral-600 | #475569 |
| gray-700 | #374151 | --color-neutral-700 | #334155 |
| gray-800 | #1f2937 | --color-neutral-800 | #2d2d2d |
| gray-900 | #111827 | --color-neutral-900 | #1e293b |

### Amber → Gold（ポイント・報酬）

| Tailwind | デフォルト hex | → ブランド変数 | ブランド hex |
|----------|-------------|--------------|------------|
| amber-50 | #fffbeb | --color-gold-100 | #fffbe6 |
| amber-100 | #fef3c7 | --color-gold-200 | #fff4b3 |
| amber-200 | #fde68a | --color-gold-300 | #ffed80 |
| amber-300 | #fcd34d | --color-gold-400 | #ffe44d |
| amber-400 | #fbbf24 | --color-gold-500 | #ffcc00 |
| amber-500 | #f59e0b | --color-gold-600 | #d4ad00 |
| amber-600 | #d97706 | --color-gold-700 | #b8960a |
| amber-700 | #b45309 | --color-gold-700 | #b8960a |

### Red → Danger（エラー・削除）

| Tailwind | 用途 | → 対応するセマンティック |
|----------|------|---------------------|
| red-50 | エラー背景 | var(--color-danger) 10% opacity |
| red-100 | エラー背景（濃） | 新設: --color-danger-100 |
| red-200 | エラーボーダー | 新設: --color-danger-200 |
| red-500 | エラーテキスト | var(--color-danger) |
| red-600 | エラーテキスト（濃） | 新設: --color-danger-600 |
| red-700 | エラー見出し | 新設: --color-danger-700 |

### Green → Success（成功・完了）

| Tailwind | 用途 | → 対応するセマンティック |
|----------|------|---------------------|
| green-50 | 成功背景 | 新設: --color-success-50 |
| green-100 | 成功背景（濃） | 新設: --color-success-100 |
| green-200 | 成功ボーダー | 新設: --color-success-200 |
| green-500 | 成功テキスト | var(--color-success) |
| green-600 | 成功テキスト | 新設: --color-success-600 |
| green-700 | 成功見出し | 新設: --color-success-700 |

### Purple → Premium/Violet（プレミアム機能）

| Tailwind | 用途 | → 対応するセマンティック |
|----------|------|---------------------|
| purple-50 | プレミアム背景 | 新設: --color-premium-50 |
| purple-600 | プレミアムテキスト | var(--color-premium) |
| purple-700 | プレミアム見出し | 新設: --color-premium-700 |

---

## Phase 2: セマンティック変数の推奨使用法

### テキスト

| 用途 | 推奨 | 禁止 |
|------|------|------|
| 本文 | `var(--color-text)` | `text-gray-700` |
| 副テキスト | `var(--color-text-muted)` | `text-gray-500` |
| 三次テキスト | `text-[var(--color-neutral-400)]` | `text-gray-400` |
| リンク | `var(--color-text-link)` | `text-blue-500` |
| エラー | `var(--color-danger)` | `text-red-500` |
| 成功 | `var(--color-success)` | `text-green-500` |

### 背景

| 用途 | 推奨 | 禁止 |
|------|------|------|
| カード | `<Card>` コンポーネント | `bg-white rounded-xl shadow-sm` |
| ページ背景 | `var(--color-surface-base)` | `bg-gray-50` |
| アクションボタン | `<Button>` コンポーネント | `bg-blue-600 text-white` |

### ボーダー

| 用途 | 推奨 | 禁止 |
|------|------|------|
| デフォルト | `var(--color-border-default)` | `border-gray-200` |
| 強調 | `var(--color-border-strong)` | `border-gray-300` |

---

## Phase 3: lint ルール

### 禁止パターン

1. `<style>` ブロック内での hex カラー直書き → `stylelint color-no-hex`
2. Tailwind カラークラスの直接使用 → カスタム ESLint ルール
3. `bg-[#xxx]` 形式の arbitrary value → Biome/ESLint

### 許容パターン

1. `@theme` ブロック内の hex 定義（Base 層）
2. CSS 変数のフォールバック値: `var(--color-brand-500, #5ba3e6)`
3. `bg-[var(--color-*)]` 形式の CSS 変数参照
