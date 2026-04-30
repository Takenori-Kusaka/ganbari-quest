# 0009. labels.ts SSOT 化原則

- **Status**: Accepted（機構 Phase 1 進行中、#1346 + ADR-0014）
- **Date**: 2026-04-20（改訂: 2026-04-21 機構完成ステータス追補）
- **Related Issue**: #1262 / #1265 / #1346
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

- **SEO 対象の静的 meta タグ**（クローラーは JS 実行しないため `data-label` 注入では反映されない） — `labels.ts` の値と完全一致するよう人間が手動同期。違反は `check-lp-plan-sync.mjs` の BANNED_TERMS で検出。`<title>` タグも本例外に含む（#1703 で `check-lp-ssot.mjs` に明示的免除を追加）
- ~~**法的文書**（`site/tokushoho.html` の条項番号・社名等） — 法務要件で固定~~ — **正式 supersede: ADR-0025 (accepted 2026-04-30, #1683 sub-D / #1704)**: 法的文書も SSOT 化対象。`LP_LEGAL_PRIVACY_LABELS` (17 keys) / `LP_LEGAL_TERMS_LABELS` (23 keys) / `LP_LEGAL_SLA_LABELS` (11 keys) / `LP_LEGAL_TOKUSHOHO_LABELS` (3 keys) = 計 54 keys を `src/lib/domain/labels.ts` に追加済（PR #1717）。`data-lp-key="legalPrivacy.section8" 等` の属性経由で innerHTML + DOMPurify sanitize で注入する。法務要件の固定文言は `labels.ts` を SSOT として人間が管理し、用語ドリフトを防ぐ。`scripts/lp-ssot-baseline.json` は `count: 0` 達成済（PR #1718/#1717）、`EXCLUDED_LEGAL_FILES` は撤廃済（PR #1717）。pamphlet.html の印刷タイミング保証は `tests/e2e/pamphlet-print-ssot.spec.ts` (#1704) で E2E 担保。
- **一時的なマーケコピー**（キャンペーン告知等） — `labels.ts` を汚染しないよう個別管理、PR 本文でスコープ明示

### 検出・強制

- **CI gate (T1)**:
  - `scripts/check-lp-plan-sync.mjs --check` — BANNED_TERMS 検出で red
  - `scripts/generate-lp-labels.mjs --check` — `shared-labels.js` が SSOT から再生成可能であることを保証
  - `scripts/check-forbidden-terms.mjs` — プロジェクト横断の禁止語チェック
- **レビュー観点**: 「LP の置換 PR を見たら SSOT 化できないか問う」を明記
- **PR テンプレ**: SSOT チェック項目を追加

## 機構完成ステータス（2026-04-21 追補、#1346）

原則（本 ADR）と機構（runtime 束縛 + CI 検出）は別ものである。両者の Phase 進捗を明示する:

| Phase | 内容 | ステータス | 関連 |
|-------|------|-----------|------|
| Phase 0 | 原則確立（本 ADR） | ✅ 完了 2026-04-20 | #1150 |
| Phase 1 | OSS / 機構選定 ADR | 🟡 進行中 | #1346 / ADR-0014 |
| Phase 2 | App 側 FEATURE_LABELS runtime 束縛 + CI 検出 | ⏳ Phase 1 承認待ち | 未起票 |
| Phase 3 | LP 側 `shared-labels.js` 廃止 → 選定 OSS 経路移行 | ⏳ 同上 | 未起票 |
| Phase 4 | 英語化対応（多言語化） | ⏳ 同上 | 未起票 |

### 暫定ハードコード規則（Phase 2 完了まで）

Phase 2 の機構完成までは以下を守ること:

1. **辞書値と一致させる**: ハードコードでも `labels.ts` 定義値と完全一致させる（最低限の手動同期）
2. **実装前に labels.ts に追加**: 新規 UI 機能追加時は実装の先に `labels.ts` へ定義を追加する（「用語を先に確定」を強制）。PR レビューで「先に labels.ts を更新してから実装」の往復を許容する
3. **野良用語の起票義務**: PR レビューで辞書外の新語を発見したら、その PR で即 labels.ts に追加するか、follow-up Issue で追補予定を明示する
4. **#1311 等の機構先行 PR**: 機構完成前でも「暫定ハードコードで labels.ts 値一致」を満たせば進行可（PO 合意済）

## 結果

- 用語変更 1 回で全画面・全 LP ページが同期される（Phase 2 完了後）
- Phase 進捗が ADR に明示され、「原則だけあって機構がない」状態の再発を防ぐ
- レビュー時に「SSOT 化すべきか」の判断軸が明確化
- 野良用語の混入を CI で機械的に検出（Phase 2-3 成果物）

## 関連

- ADR-0001（設計書 SSOT）— 本 ADR は labels 領域への具体化
- ADR-0014（labels / i18n 機構選定）— 本 ADR Phase 1 の成果
- Issue #1346（機構完成 Umbrella）/ #1350（OSS 先調査プロセス化）
- Issue #1126 / PR #1139 / #566 — LP SSOT パイプライン半完成の原点
