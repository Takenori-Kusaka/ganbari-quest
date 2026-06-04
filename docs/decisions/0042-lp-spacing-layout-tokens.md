# 0042. LP CSS Spacing/Layout 3 層トークン化 (Base → Semantic → Component SSOT)

| 項目 | 内容 |
|------|------|
| ステータス | **accepted (2026-05-02)** |
| 日付 | 2026-05-02 |
| 起票者 | Dev (PR #1850) |
| 関連 Issue | #1839 (Phase 1 親) / #1851 (Phase 2 子) |
| 関連 PR | #1850 (Phase 1 実装) / #1851 PR (Phase 2 stylelint hard-fail + 残置換) |
| 関連 ADR | ADR-0001 (設計書 SSOT) / ADR-0009 (LP labels.ts SSOT) / ADR-0013 (LP truth from implementation) / ADR-0025 (LP SSOT 注入機構) / ADR-0032 (LP 静的コンテンツ コンポーネント設計原則) |
| 関連監視機構 | #1840 / PR #1841 (`cumulative-lp-metrics` ジョブ — pre-merge cumulative gate) |

> **詳細仕様の SSOT**: Base / Semantic トークンの一覧・値・用途、設計原則表、禁忌、適用範囲、実体（定義 / 参照ファイル）は [`docs/DESIGN.md` §4「LP Spacing/Layout 3 層トークン」](../DESIGN.md) を参照。全 `--lp-*` Semantic トークンの網羅列挙は実装の事実である `site/shared.css` の `:root` ブロックを正とする。本 ADR は**意思決定の核（なぜ 3 層化したか / 選択肢比較 / トレードオフ）**のみを記録する。

## 1. コンテキスト

LP (`site/index.html` ほか) の section padding / margin / heading 余白 / faq 内 padding 等の Layout 系設計値が、**過去 5 PR (#1759 / #1798 / #1827 / #1831 / #1836) で多層的に圧縮**された結果、`<style>` ブロック内に同種設計値（`28px` / `14px` / `36px` 等）が**散在**し、次回 ratchet 違反時に**どこを削るべきか判断不能**な状態に陥っていた。

§2 カラートークンは既に **Base → Semantic → Component の 3 層 SSOT** で運用済み（`docs/DESIGN.md` §2）。Spacing/Layout も同水準の設計品質に揃えるべき、という観点で本 ADR を起票した。

なお Issue #1840 で実装された累積 desktopHeight 監視機構（`cumulative-lp-metrics` ジョブ、PR #1841）とは**相補的に機能する**。実装側 (本 ADR) で多層化を**防ぎ**（Semantic トークンに集約させ Component 側に値を散らさない）、CI 側 (#1840) で累積膨張を**検出する**。実装側だけでは新規 Component 追加で散在が再発し、CI 側だけでは多層化の温床（散在した直書き値）を残してしまうため、両者を組み合わせて多層防御とする。

## 2. 検討した選択肢（OSS / 確立パターン 2 件以上 — #1350）

調査した一次資料: **MDN — CSS custom properties** (`:root` 変数で base token 化、変数差替えで variant 実現の確立パターン) / **Tailwind CSS spacing scale** (4px グリッド、industry de facto standard) / **Material Design — spacing system** (8dp grid token 体系) / **Bootstrap 5 — spacers utility** (Sass 変数で管理) / **CUBE CSS / Every Layout (Andy Bell)** (utility class での spacing variant)。

### 選択肢 1: CSS Custom Properties で 3 層トークン化 (採用)

- 概要: `site/shared.css` の `:root` に Base spacing (`--space-*`、4px グリッド) と Semantic LP トークン (`--lp-section-padding-y` 等) を定義し、`site/index.html` の `<style>` から Semantic 経由で参照
- メリット:
  - **build pipeline ゼロ** — LP は GitHub Pages 静的配信のため、PostCSS / Tailwind 等の build step 追加は Pre-PMF 過剰投資 (ADR-0010 バケット C)
  - **既存 Color 3 層と同じパターン** — DESIGN.md §2 に既存記述があり、設計同型
  - **ADR-0025 SSOT 注入機構と無干渉** — `data-lp-key` 注入経路に影響なし
- デメリット: stylelint で hard-fail 化するまでは直書きを禁止できない（Phase 2 で対応）
- Pre-PMF コスト: `:root` 定義 + Component 側の置換のみ。build 影響ゼロ

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

`site/shared.css` の `:root` ブロックに **Base Spacing トークン (4px グリッド)** と **Semantic LP Spacing トークン (`--lp-*`)** を定義し、`site/index.html` 等の `<style>` から **Semantic 経由でのみ参照**する。3 層 (Base → Semantic → Component) の責務分離は §2 カラートークンと同型とする。

- **Base / Semantic トークンの一覧・値・用途**、設計原則表、禁忌、適用範囲、実体（定義 / 参照ファイル）は [`docs/DESIGN.md` §4](../DESIGN.md) が SSOT。全 `--lp-*` Semantic トークンの網羅列挙は実装の事実である `site/shared.css` の `:root` ブロックを正とする（DESIGN.md §4 §実体）。
- 命名規約は「`--lp-<部位>-<軸 or 用途>`」に固定し、variant 爆発を防ぐ。
- baseline pin 機構: `scripts/check-lp-inline-style.mjs` + `scripts/lp-inline-style-baseline.json` で残ローカル装飾値 (gap / 微小余白 / 絵文字 padding 等) を pin し、新規違反 1 件で CI fail (`lp-metrics.yml` `inline-style-check` ジョブ、#1851)。意図的増減時のみ `--update-baseline` で更新する。

段階適用は Phase 1 (PR #1850、`:root` トークン整備 + 主要 6 セレクタ置換) → Phase 2 (#1851、残構造的 padding/margin の Semantic 化 + `pricing.html` 波及 + baseline pin 機構導入) → Phase 3 (#2395、`pamphlet.html` / `faq.html` / `selfhost.html` / `graduation.html` へ波及、4 HTML baseline 72 → 0) の順で完遂済み。各 Phase で追加された Semantic トークン群と baseline 数値は DESIGN.md §4 §実体および `site/shared.css` を参照。

## 4. 帰結 (Consequences)

### 4.1 ポジティブ

- **再圧縮時の散在修正が不要**: 次回 desktopHeight ratchet 違反が起きても `--lp-section-padding-y` 等を 1 行更新するだけで全箇所反映
- **Color 3 層と設計同型**: `docs/DESIGN.md` §2 で既に確立した 3 層パターンを Spacing にも適用、設計の一貫性向上
- **#1840 累積監視機構と相補的に機能**: 多層化を実装側で防ぎ、CI 側で累積膨張を検出する 2 層防御
- **Pre-PMF コストゼロ**: build pipeline 追加なし、bundle 影響ゼロ、CSS 変数のみ

### 4.2 ネガティブ / リスク

- Phase 2 完了まで直書きと Semantic 経由が混在する（リスク低、Phase 2 で stylelint hard-fail 化により恒久解消）
- Semantic トークン名 (`--lp-*`) の命名規約が緩いと variant 爆発のリスク → 命名規則「`--lp-<部位>-<軸 or 用途>`」を §3 で固定

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
