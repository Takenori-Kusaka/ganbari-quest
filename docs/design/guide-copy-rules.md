# ガイド文言 作成ルール SSOT（#3261 / EPIC #3260 F0）

> ページガイド（`?` オンデマンドガイド = `PageGuideOverlay` + `_guide.ts`）の文言を書く前に必読。
> ここに定義したルールが実装基準であり、機械検証可能なものは `scripts/check-guide-copy.ts`（CI hard-fail）が担保する。

## 1. 設計背景

ガイド文言が page ごとに自由記述されると、(a) LP・アプリで使う機能名/操作名/表示名と不統一になり読み手が混乱し、(b) 冗長・内部事情露出・新用語提示で認知負荷が上がる。本ルールは「**SSOT 統一・簡潔・読み手に新情報を増やさない**」を機械と規律で institutionalize する（自動生成の適当文言を排除）。

一般チュートリアル UX の deep-research（#3261、2026-06-24）に基づく:

- NN/g「Tooltip Guidelines」— tooltip は対象を隠さない / 簡潔 / a11y。https://www.nngroup.com/articles/tooltip-guidelines/
- Appcues「Product tours UI patterns」— 3-5 step / gradual / contextual。https://www.appcues.com/blog/product-tours-ui-patterns
- Material Design 3 Tooltips — positioning / consistency。https://m3.material.io/components/tooltips/guidelines
- UXPin / SaaS microcopy — ≤150 字 / 1-2 文 / jargon 回避 / specific>generic。https://www.uxpin.com/studio/blog/what-is-a-tooltip-in-ui-ux/

## 2. 設計原則（8 基本ポリシー）

| # | ポリシー | 根拠 | 機械検証 |
|---|---------|------|---------|
| 1 | **新たな用語を読み手に示さない** — 機能/操作/表示名は SSOT（`terms.ts` / `labels.ts`、ADR-0045）の atom を使い、非 SSOT の独自語・内部コード名を出さない | NN/g / UXPin（jargon 回避）/ DESIGN.md §6 | ○ 謎用語 banlist（`MYSTERY_TERMS`） |
| 2 | **簡潔・端的** — 1 step 1-2 文。`title` ≤40 / `what` ≤150 / `how` ≤200 / `goal` ≤130 字 | NN/g（≤150 字）/ SaaS microcopy | ○ 文字数上限 |
| 3 | **同じことを別表現にしない** — 同一概念は同一 SSOT 用語で統一（表記揺れ禁止） | NN/g / Material（terminology consistency）| ○（banlist の表記揺れ） |
| 4 | **内部事情を示さない** — route パス（`/admin/...`）/ コンポーネント名（`*.svelte`）/ `data-tutorial=` / プラン識別子 / 実装識別子を出さない | DESIGN.md §6 内部コード露出禁止 / `check-no-plan-literals` | ○ 内部露出パターン |
| 5 | **キーワードを強調** — 操作対象・結果の要語を視覚強調（specific > generic microcopy） | UXPin microcopy | △ review |
| 6 | **そのページの上から順に説明** — step の `selector` 対象が DOM 上で上→下の順になるよう step を並べる | reading order / contextual gradual | △ review + layout-invariant |
| 7 | **吹き出しが説明対象に被らない** — bubble は target を隠さない | NN/g（tooltip must not obscure）/ Material smart positioning | ○ `page-guide-layout-invariant.spec.ts`（#2926/#2971）|
| 8 | **3 部構成・≤5 step** — ①概要 →②画面の見方 →③最頻操作 | #2927 / ADR-0012 anti-engagement | ○ step 数 ≤5 |

## 3. 仕様

### 3.1 step の三部構成（narrative）

各ガイドは「①ページ概要 → ②画面の見方 → ③最頻操作」を基本に、**最大 5 step**。① は `selector` 省略の中央 modal、②③ は当該ページの実 DOM 要素を `selector: '[data-tutorial="…"]'` で指す（＝個別最適の実体）。

各 step の text フィールド:

- `title` — その step の見出し（≤40 字）
- `what` — 何の画面/要素か（≤150 字）
- `how` — どう操作するか（番号付き手順可、≤200 字）
- `goal` — その結果・得られる価値（≤130 字）
- `tips?` — 補足（任意）

### 3.2 文言の SSOT 参照

機能名/操作名/表示名は `terms.ts`（atom）/ `labels.ts`（compound）を `${...}` で参照する（例: `${ADMIN_VIEW_TERMS.canonical}` / `${TEMPLATE_TERMS.userFacing}`）。文字列リテラルでの直書き複製は禁止（用語変更の伝播が壊れる、ADR-0045）。

> F3（#3264）で PageGuide 文言を `labels.ts`（`PAGE_GUIDE_*`）へ集約し、linter の検査対象を一元化する。

### 3.3 linter（`scripts/check-guide-copy.ts`）

`src/routes/**/_guide.ts` を走査し以下を hard-fail（CI: `--fail-on-violation`、現行 baseline = 0）:

1. 謎用語 / 非 SSOT 用語（`MYSTERY_TERMS` を `check-terminology-coherence.ts` から共有）
2. 内部事情の露出（route パス / `.svelte` / `data-tutorial=` / 内部プラン識別子）
3. 文字数上限超過（`COPY_LIMITS`）
4. step 数 > 5（`MAX_STEPS`）

機械化が難しいポリシー（#5 キーワード強調 / #6 上→下順 / #7 非重複）は本 spec + review + `page-guide-layout-invariant.spec.ts` で担保する。

## 4. 禁忌

| 禁止 | 理由 | 検出 |
|------|------|------|
| 非 SSOT の独自語・内部コード名を文言に出す | 読み手に新用語を増やす（混乱） | `check-guide-copy.ts`（謎用語） |
| route パス / コンポーネント名 / `data-tutorial` を文言に書く | 内部事情露出 | `check-guide-copy.ts`（内部露出） |
| 上限超過の冗長な文言 | 認知負荷 | `check-guide-copy.ts`（文字数） |
| 6 step 以上 | anti-engagement 違反 | `check-guide-copy.ts`（step 数） |
| 同一概念を別表現で書く | 表記揺れ | `check-guide-copy.ts`（banlist）+ review |

## 5. 関連

- EPIC #3260 / F1（網羅 gate）/ F3（labels SSOT）/ #2927（narrative 3 部）/ #2555（`check-terminology-coherence`）/ ADR-0045（terms 2 層）/ ADR-0012（anti-engagement）
- 実体: `scripts/check-guide-copy.ts` / `tests/unit/scripts/check-guide-copy.test.ts` / `docs/design/06-UI設計書.md §4.13.1`
