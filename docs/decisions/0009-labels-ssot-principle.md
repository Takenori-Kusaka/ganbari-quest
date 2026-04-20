# 0009. labels.ts SSOT 化原則

- **Status**: Accepted
- **Date**: 2026-04-20
- **Related Issue**: #1262 / #1265
- **統合元**: 旧 ADR-0037（本 PR で削除、詳細は git 履歴）

## コンテキスト

> 旧 ADR-0037 を renumber した新採番。ADR 10 枠再構成（#1262）の一環。

LP および本番アプリに露出する文言（プラン名・年齢モード名・機能名・固有名詞）が複数箇所にハードコードされており、用語変更のたびに手作業で置換する PR が繰り返し発生している。

直近の実害:

- PR #1139（#1126）— LP で「フリープラン」→「無料プラン」の全置換目的だったが、`pricing.html` の OG meta description と FAQ 2 箇所に残存し PR #1149 で後始末
- PR #1140（#1133）— FAQ リライトでハードコード文言がさらに追加。「SSOT 化すべきでは？」の観点が抜けた
- PR #1141（#1134）— `site/index.html` 料金セクション簡素化で `check-lp-plan-sync.mjs` の検証ロジックが drift

**根本原因**: SSOT（`src/lib/domain/labels.ts` + `site/shared-labels.js`）の適用方針が暗黙ルールで、開発者・レビュアーが一貫して適用できていない。

## 決定

本プロジェクトにおいて **ユーザーに露出する全ての固有名詞・機能名・プラン名・年齢モード名** は `src/lib/domain/labels.ts` を Single Source of Truth (SSOT) とする。

### 適用原則

1. **アプリ側（`src/**`）**: `labels.ts` の export 定数 / 関数を直接 import して使う。文字列リテラル禁止
2. **LP 側（`site/**`）**: `site/shared-labels.js` を介して `data-label="*"` 属性経由で DOM に注入。HTML 内に日本語固有名詞を直接書かない
3. **新規 label 追加**: `labels.ts` に追加 → `scripts/generate-lp-labels.mjs` で `site/shared-labels.js` を再生成（自動生成ファイルを直接編集しない）
4. **用語変更**: `labels.ts` の値を変えるだけで、LP・アプリ両方に一括反映される状態を常に保つ

### 例外（ハードコード許容）

- **SEO 対象の静的 meta タグ**（クローラーは JS 実行しないため `data-label` 注入では反映されない） — `labels.ts` の値と完全一致するよう人間が手動同期。違反は `check-lp-plan-sync.mjs` の BANNED_TERMS で検出
- **法的文書**（`site/tokushoho.html` の条項番号・社名等） — 法務要件で固定
- **一時的なマーケコピー**（キャンペーン告知等） — `labels.ts` を汚染しないよう個別管理、PR 本文でスコープ明示

### 検出・強制

- **CI gate (T1)**:
  - `scripts/check-lp-plan-sync.mjs --check` — BANNED_TERMS 検出で red
  - `scripts/generate-lp-labels.mjs --check` — `shared-labels.js` が SSOT から再生成可能であることを保証
  - `scripts/check-forbidden-terms.mjs` — プロジェクト横断の禁止語チェック
- **レビュー観点**: 「LP の置換 PR を見たら SSOT 化できないか問う」を明記
- **PR テンプレ**: SSOT チェック項目を追加

## 結果

- 用語変更 1 回で全画面・全 LP ページが同期される
- レビュー時に「SSOT 化すべきか」の判断軸が明確化
- 野良用語の混入を CI で機械的に検出

## 関連

- ADR-0001（設計書 SSOT）— 本 ADR は labels 領域への具体化
- Issue #1126 / PR #1139 — LP SSOT パイプライン修復の原点
