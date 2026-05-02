# 0042. LP CSS Spacing/Layout 3 層トークン化 (Base → Semantic → Component SSOT)

| 項目 | 内容 |
|------|------|
| ステータス | **accepted (2026-05-02)** |
| 日付 | 2026-05-02 |
| 起票者 | Dev (PR #1850) |
| 関連 Issue | #1839 |
| 関連 PR | #1850 (Phase 1 実装) |
| 関連 ADR | ADR-0001 (設計書 SSOT) / ADR-0009 (LP labels.ts SSOT) / ADR-0013 (LP truth from implementation) / ADR-0025 (LP SSOT 注入機構) / ADR-0032 (LP 静的コンテンツ コンポーネント設計原則) |
| 関連監視機構 | #1840 / PR #1841 (`cumulative-lp-metrics` ジョブ — pre-merge cumulative gate) |

## 1. コンテキスト

LP (`site/index.html` ほか) の section padding / margin / heading 余白 / faq 内 padding 等の Layout 系設計値が、**過去 5 PR で多層的に圧縮**されている状態。

### 1.1 多層圧縮の経緯

| PR | 圧縮対象 | Before → After |
|----|--------|---------------|
| #1759 | hero / soft-features padding | 初期 |
| #1798 | `.cta-bottom` padding-bottom | 56 → 80 (拡大、後に再圧縮) |
| #1827 | LP copy / IA bundle 全般 | section padding 微調整 |
| #1831 | `.cta-bottom` / `.faq-item` padding | 56 → 40 / 18 → 14 |
| #1836 | `.section` / `.section-desc` / `.cta-bottom` padding | 40 → 28 / 16 → 14 / 40 → 28 |

5 PR にわたる漸進的圧縮の結果、`site/index.html` `<style>` ブロック内に同種設計値（`28px` / `14px` / `36px` 等）が**散在**し、次回 ratchet 違反時に**どこを削るべきか判断不能**な状態に陥っていた。

### 1.2 同種多層化の前例 (Color)

§2 カラートークンは既に **Base → Semantic → Component の 3 層 SSOT** で運用済み（`docs/DESIGN.md` §2）。Spacing/Layout も同水準の設計品質に揃えるべき、という観点で本 ADR を起票。

### 1.3 累積監視機構との関係 (#1840)

Issue #1840 で「PR ごとの累積 desktopHeight 監視機構（pre-merge cumulative gate）」が PR #1841 で実装済み。`.github/workflows/lp-metrics.yml` に `cumulative-lp-metrics` ジョブが追加され、過去 N PR の累積膨張を pre-merge で検出する設計。

**本リファクタは累積監視機構と相補的に機能する**:

| 防御層 | 役割 | 担当 |
|-------|------|------|
| 実装側 (本 ADR) | 多層化を**防ぐ** (Semantic トークンに集約させ、Component 側に値を散らさない) | Dev / PR レビュー |
| CI 側 (#1840) | 累積膨張を**検出する** (Semantic トークン値の変化が累積で閾値を超えたら fail) | CI / pre-merge gate |

実装側だけでは新規 Component 追加で散在を再発する可能性があり、CI 側だけでは多層化の温床（散在した直書き値）を残してしまう。両者を組み合わせて**多層防御**とする。

## 2. 検討した選択肢（OSS / 確立パターン 2 件以上 — #1350）

調査した一次資料:

- **MDN — CSS custom properties (variables)** — `:root` 変数で base token 化、変数差替えで variant を実現する確立パターン
- **Tailwind CSS spacing scale** — 4px グリッド (0 / 1 / 2 / ... / 16) を utility class で提供。industry de facto standard
- **Material Design — spacing system** — 8dp grid をベースに `dp1` / `dp2` / ... の token 体系を提供
- **Bootstrap 5 — spacers utility** — `$spacer * 0.25` / `$spacer * 0.5` / ... を Sass 変数で管理
- **CUBE CSS / Every Layout (Andy Bell)** — utility class (`u-stack-md` 等) で spacing variant を表現

### 選択肢 1: CSS Custom Properties で 3 層トークン化 (採用)

- 概要: `site/shared.css` の `:root` に Base spacing (`--space-0` 〜 `--space-16`、4px グリッド 14 段階) と Semantic LP トークン (`--lp-section-padding-y` 等 12 種) を定義し、`site/index.html` の `<style>` から Semantic 経由で参照
- メリット:
  - **build pipeline ゼロ** — LP は GitHub Pages 静的配信のため、PostCSS / Tailwind 等の build step 追加は Pre-PMF 過剰投資 (ADR-0010 バケット C)
  - **既存 Color 3 層と同じパターン** — DESIGN.md §2 に既存記述があり、設計同型
  - **ADR-0025 SSOT 注入機構と無干渉** — `data-lp-key` 注入経路に影響なし
- デメリット: stylelint で hard-fail 化するまでは直書きを禁止できない（Phase 2 で対応）
- Pre-PMF コスト: `:root` 定義 14 + 12 行追加 + Component 側の置換のみ。build 影響ゼロ

### 選択肢 2: PostCSS / Sass のビルドパイプライン導入

- 概要: `site/` 専用の PostCSS ビルドステップを追加し、`@spacing(7)` 等の関数で spacing を解決
- メリット: コンパイル時に静的な spacing 計算ができる
- デメリット:
  - **build pipeline 追加が Pre-PMF 過剰投資** — ADR-0010 バケット C (Pre-PMF スコープ外)
  - GitHub Pages の現行配信方式と相性悪い (静的 HTML を直接 push する設計を崩す)
  - bundle size が増える可能性
- 不採用: ADR-0010 Pre-PMF スコープ判断、build pipeline ゼロ原則を維持

### 選択肢 3: Tailwind CSS 全面移行

- 概要: LP に Tailwind を導入し `class="py-7 px-4"` 等の utility class で spacing 表現
- メリット: industry standard / utility-first で DRY
- デメリット:
  - アプリ側 (`src/`) も Tailwind 移行する必要がある (現状 Tailwind 部分採用)
  - LP は SSOT 注入機構 (ADR-0025) で `data-lp-key` 経由で文言注入しており、class 列が長くなると `data-lp-key` の付け替えが複雑化
  - GitHub Pages 静的配信と Tailwind build pipeline の同居が複雑
- 不採用: ADR-0010 Pre-PMF 過剰投資

## 3. 決定

`site/shared.css` の `:root` ブロックに以下の 3 層トークンを定義し、`site/index.html` `<style>` から Semantic 経由で参照する。

### 3.1 Base Spacing (4px グリッド、14 段階)

`--space-0` (0) / `--space-1` (4px) / `--space-2` (8px) / `--space-3` (12px) / `--space-4` (16px) / `--space-5` (20px) / `--space-6` (24px) / `--space-7` (28px) / `--space-8` (32px) / `--space-9` (36px) / `--space-10` (40px) / `--space-12` (48px) / `--space-14` (56px) / `--space-16` (64px)

Tailwind / Material Design 系列に整合。4px グリッド外の値（14px = `--space-3` と `--space-4` の中間）は Semantic 側で直値定義する。

### 3.2 Semantic LP Spacing (12 種)

| トークン | 値 | 用途 |
|---------|----|------|
| `--lp-section-padding-y` | `var(--space-7)` | `.section` 縦 padding (28px、#1836 圧縮済み) |
| `--lp-section-padding-x` | `var(--space-4)` | `.section` 横 padding (16px) |
| `--lp-section-title-mb` | `var(--space-1)` | `.section-title` 下マージン (4px、#1831 圧縮済み) |
| `--lp-section-desc-mb-default` | `14px` | `.section-desc` 下マージン (#1836、4px グリッド外のため直値) |
| `--lp-faq-item-padding-y` | `14px` | `.faq-item` 上下 padding (#1831、4px グリッド外のため直値) |
| `--lp-hero-padding-top` | `var(--space-12)` | `.hero` 上 padding (48px) |
| `--lp-hero-padding-bottom` | `var(--space-9)` | `.hero` 下 padding (36px) |
| `--lp-card-padding-y` | `var(--space-5)` | card 系 (`.tour-card` / `.soft-card` 等) 縦 padding 標準値 (20px) |
| `--lp-card-padding-x` | `var(--space-4)` | card 系 横 padding 標準値 (16px) |
| `--lp-card-gap` | `var(--space-5)` | grid 間隔 (20px) |
| `--lp-container-max` | `1080px` | section-inner / header-inner / footer-inner の最大幅 |
| `--lp-container-max-wide` | `1280px` | hero / machine-tour / guide 用ワイド版 |

### 3.3 Component (置換対象)

Phase 1 で `site/index.html` の主要 6 セレクタを Semantic 経由参照に置換: `.section` / `.section-title` / `.section-desc` / `.hero` / `.faq-item` / `#core-loop`。

**注**: 当初は 7 セレクタ目に `.cta-bottom` を含んでいたが、PR #1842 (#1838) で `.cta-bottom` セクション自体が全削除されたため、本 PR の rebase 時に `.cta-bottom` 関連 CSS ルールおよび Semantic トークン (`--lp-cta-bottom-padding-top/-bottom`) も併せて削除。Phase 1 完了時点で `.cta-bottom` は LP に存在しない。

### 3.4 段階適用

| Phase | 対象 | 担当 |
|-------|------|------|
| Phase 1 (本 PR #1850) | `:root` トークン整備 + 主要 6 セレクタ置換 | Dev |
| Phase 2 (別 Issue) | stylelint で直書き padding/margin を hard-fail 化、残りの直書き値を全置換 | Dev (別 Issue 起票予定) |
| Phase 3 (別 Issue) | `pricing.html` / `pamphlet.html` / `faq.html` へ同パターンで波及 | Dev (別 Issue 起票予定) |

## 4. 帰結 (Consequences)

### 4.1 ポジティブ

- **再圧縮時の散在修正が不要**: 次回 desktopHeight ratchet 違反が起きても `--lp-section-padding-y` 等を 1 行更新するだけで全箇所反映
- **Color 3 層と設計同型**: `docs/DESIGN.md` §2 で既に確立した 3 層パターンを Spacing にも適用、設計の一貫性向上
- **#1840 累積監視機構と相補的に機能**: 多層化を実装側で防ぎ、CI 側で累積膨張を検出する 2 層防御
- **Pre-PMF コストゼロ**: build pipeline 追加なし、bundle 影響ゼロ、CSS 変数のみ

### 4.2 ネガティブ / リスク

- Phase 2 完了まで直書きと Semantic 経由が混在する（リスク低、Phase 2 で stylelint hard-fail 化により恒久解消）
- Semantic トークン名 (`--lp-*`) の命名規約が緩いと variant 爆発のリスク → 命名規則「`--lp-<部位>-<軸 or 用途>`」を本 ADR §3.2 で固定

### 4.3 維持すべき不変条件

- `--lp-*` Semantic トークンは `site/shared.css` の `:root` 定義のみで定義する (SSOT)
- `site/index.html` `<style>` 内に padding/margin の数値直書き禁止 (Phase 2 で stylelint hard-fail 化)
- 値変更時は **Semantic トークンを更新する**（Component class の値を直接書き換えない）

## 5. 関連 ADR との関係

| ADR | 関係 |
|-----|------|
| ADR-0001 (設計書 SSOT) | DESIGN.md §4 LP Spacing/Layout 章を SSOT として整合 |
| ADR-0009 (LP labels.ts SSOT) | 用語の SSOT、本 ADR は **設計値の SSOT**。直交関係 |
| ADR-0013 (LP truth from implementation) | 本 ADR の Spacing 値は実装事実 (`#1836` 圧縮値) を写像、aspirational ではない |
| ADR-0025 (LP SSOT 注入機構) | `data-lp-key` 注入経路には影響しない（CSS 変数は class セレクタ側のみ） |
| ADR-0032 (LP 静的コンテンツ コンポーネント設計原則) | ADR-0032 の SOLID 原則 + 共通化方針 (`lp-card` 等の base class 集約) と整合。本 ADR は ADR-0032 の **CSS 変数 variant** 部分を Spacing 軸で具体化したもの |
| #1840 / PR #1841 (累積監視機構) | 相補関係。本リファクタ (実装側) で多層化を防ぎ、CI 側 (#1840) で累積膨張を検出する 2 層防御 |

## 6. 検証

- LP メトリクス: cta-bottom 削除済み main を base としても `mobileHeight ≤ 15000` / `desktopHeight ≤ 8000` / `forbiddenTerms=0` / `ctaVariants ≤ 3` 全閾値内
- before/after スクリーンショット: 視覚的差異ゼロ（mobile / desktop の md5 ハッシュ完全一致を Phase 1 で担保）
- `npm run pre-ready -- --pr 1850` の 7 Step 全 PASS

## 7. 改訂履歴

| 日付 | 改訂内容 |
|------|---------|
| 2026-05-02 | 初版（Phase 1 実装に伴う ADR 起票） |
