# ADR-0037: 全ユーザー向け文言の SSOT 化原則

- **Status**: Accepted
- **Date**: 2026-04-18
- **Context**: Issue #1150 / #1126 / #1149
- **Deciders**: PO (Takenori Kusaka) + Dev セッション合意

## 背景

LP および本番アプリに露出する文言（プラン名・年齢モード名・機能名・固有名詞）が
複数箇所にハードコードされており、用語変更のたびに手作業で置換する PR が繰り返し発生している。

直近の実害:

- PR #1139 (#1126) — LP で「フリープラン」→「無料プラン」の全置換を目的とした PR。
  しかし `pricing.html` の OG meta description と FAQ 2 箇所に残存し、PR #1149 で後始末。
- PR #1140 (#1133) — FAQ リライトでハードコード文言がさらに追加された。
  レビュー時に「SSOT 化すべきでは？」の観点が抜けた。
- PR #1141 (#1134) — `site/index.html` の料金セクション簡素化で
  `check-lp-plan-sync.mjs` の検証ロジックが drift し、fa591e07 時点で CI red 化。

root cause: SSOT (`src/lib/domain/labels.ts` + `site/shared-labels.js`) の
適用方針が暗黙ルールで、開発者・レビュアーが一貫して適用できていない。

## 決定

本プロジェクトにおいて **ユーザーに露出する全ての固有名詞・機能名・プラン名・
年齢モード名 (以下 "ユーザー向け文言")** は `src/lib/domain/labels.ts` を
Single Source of Truth (SSOT) とする。

### 適用原則

1. **アプリ側 (`src/**`)**: `labels.ts` の export 定数 / 関数を直接 import して使う。
   文字列リテラルを書いてはならない。
2. **LP 側 (`site/**`)**: `site/shared-labels.js` を介して
   `data-label="*"` 属性経由で DOM に注入する。**HTML 内に日本語固有名詞を
   直接書かない**。
3. **新規 label の追加**: `labels.ts` に定数/関数を追加 → `scripts/generate-lp-labels.mjs`
   を実行して `site/shared-labels.js` を再生成する (自動生成ファイルを
   直接編集しない)。
4. **用語変更**: `labels.ts` の値を変えるだけで、LP・アプリ両方に一括反映される
   状態を常に保つ。

### 例外 (ハードコード許容)

以下は labels SSOT 対象外:

- **SEO 対象の静的 meta タグ** (`<meta property="og:description" content="...">` など)
  — クローラーは JS 実行しないため `data-label` 注入では反映されない。
  この場合は `labels.ts` の値と**完全一致**するよう人間が手動同期する。
  違反があれば `check-lp-plan-sync.mjs` の BANNED_TERMS で検出される。
- **法的文書** (`site/tokushoho.html` の条項番号・社名等) — 法務要件で固定。
- **一時的なマーケコピー** (キャンペーン告知など期限付き) — `labels.ts` を
  汚染しないよう個別に管理。PR 本文で明示的にスコープを宣言する。

### 検出・強制

- **CI gate (T1)**:
  - `scripts/check-lp-plan-sync.mjs --check` — `BANNED_TERMS` 検出で red
    (#1149 で導入)
  - `scripts/generate-lp-labels.mjs --check` — `shared-labels.js` が SSOT から
    再生成可能であることを保証
  - `scripts/check-forbidden-terms.mjs` — プロジェクト横断の禁止語チェック
- **レビュー観点**: `docs/sessions/qa-session.md` / `dev-session.md` に
  「LP の置換 PR を見たら SSOT 化できないか問う」を明記 (本 ADR で追加)
- **PR テンプレ**: `.github/PULL_REQUEST_TEMPLATE.md` に SSOT チェック項目を追加
  (本 ADR で追加)

## 影響

### Positive
- 用語変更 1 回で全画面・全 LP ページが同期される
- レビュー時に「SSOT 化すべきか」の判断軸が明確化
- 野良用語の混入を CI で機械的に検出

### Negative / Risk
- 既存ハードコードの一括 SSOT 化には工数が必要 (段階的に対応)
- OG meta description など例外ケースの判定は引き続きレビュアー責任
- BANNED_TERMS リストのメンテコストが発生 (canonical と合わせて継続メンテ)

## 関連

- ADR-0003 (設計書は Single Source of Truth) — 本 ADR は labels 領域への具体化
- ADR-0014 (3層 CSS トークンアーキテクチャ) — 同じ SSOT 原則を CSS に適用したもの
- Issue #1126 / PR #1139 — LP SSOT パイプライン修復の原点
- Issue #1149 — BANNED_TERMS 検出機構の追加
- Issue #1150 — 本 ADR 起票の元 Issue
