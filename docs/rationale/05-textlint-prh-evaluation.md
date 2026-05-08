# textlint-rule-prh 必要性評価 設計経緯 (Phase 5 F4)

## 議論の発端

- **日時**: 2026-05-08
- **発端 Issue / セッション**: #1921 (Phase 5 F4) / supersede 候補 #1909 (TECH-MAJ-1)
- **問題意識**: SSOT 2 階層化 (Phase 1 #1916) + リテラル直書き禁止 CI 強化 (Phase 5 F1 #1918) で、用語表記揺れの構造的再発防止が達成可能なら、textlint-rule-prh + 用語白リスト CI (#1909) は重複機構となる。Phase 5 F1 完成後に必要性を再評価し、重複している場合は close する判断が必要。

## 背景: Phase 1〜5 の SSOT 2 階層化全体像

#1909 起票時点（中期 follow-up）の前提では、`labels.ts` 単一ファイル内で atom（プラン名・価格）と compound（表示文字列）が混在しており、新規追加時に同概念の表記揺れが発生する構造的問題があった（PO 4 回連続「FAQ 用語 SSOT」指摘の根本原因）。

その後 Phase 1 (#1916) で `src/lib/domain/terms.ts` (atom) → `src/lib/domain/labels.ts` (compound) への 2 階層分離が実装され、atom は terms.ts 単一ファイルが SSOT となった。labels.ts は terms.ts を `import` + `${...}` template literal で参照する compound 専用構造に変更済み（ADR-0045 で正式化）。

この結果、**labels.ts 内で同概念の表記揺れが発生し得る経路は構造的に閉じられた**。残るリスクは「terms.ts に集約された atom を labels.ts 以外で直書きする経路」のみ。

## 検討した代替案

| 案 | 概要 | 検討した理由 |
|----|------|-----------|
| **採用案: F1 単独 + #1909 close** | `check-no-plan-literals.mjs` を強化し、terms.ts atom 値（PLAN / PRICE / TRIAL / CANCEL / FREE 各 namespace）を `src/lib/server` / `src/routes` / `src/hooks.server.ts` / `src/lib/domain/labels.ts` 以外でリテラル直書き禁止 (hard-fail) | terms.ts 集約済み atom の検出は機械的に regex で十分。labels.ts 内表記揺れは Phase 1 で構造的に解消済 |
| 案 B: F1 + #1909 両方採用 | F1（atom 直書き検出）+ textlint-rule-prh（labels.ts 内表記揺れ検出） | 両者で対象層が違うため理論的には共存可能 |
| 案 C: #1909 単独採用（F1 cancel） | textlint-rule-prh + prh.yml で全体カバー | 既存検出機構との統一感（標準 OSS 採用） |

## 棄却理由

### 案 B 棄却理由（F1 + #1909 両方採用）

- **labels.ts 内表記揺れ検出の必要性が消失**: Phase 1 #1916 で atom が terms.ts に集約され、labels.ts は `${TERMS.foo}` 経由参照となった。同概念の表記揺れは labels.ts レベルで構造的に発生しない（terms.ts の atom を変更すれば全 labels に伝播）
- **terms.ts 内の表記揺れ検出は機械検証不要**: terms.ts は atom の単一定義場所であり、同概念に複数 key を作ること自体がレビューで弾かれる（例: `PLAN_TERMS.standard` と別に `PLAN_TERMS.standardAlt` を作る運用は禁止）
- **dev 依存追加の Pre-PMF コスト**: textlint + textlint-rule-prh + prh.yml の導入 / 学習 / 例外運用は ~50MB dev 依存 + 設定保守 + 例外承認フロー。labels.ts 内表記揺れがゼロの状態で導入する ROI が成立しない（ADR-0010 Pre-PMF スコープ判断）
- **重複 CI による保守コスト**: F1 と textlint で「同じ atom 値（'スタンダード' 等）」を 2 つの正規表現 SSOT に書く必要が生じ、片方更新漏れの bug 余地を増やす

### 案 C 棄却理由（#1909 単独採用）

- **F1 のスコープが textlint で代替不能**: F1 は `src/lib/server` / `src/routes` 配下の `.ts` / `.svelte` で atom 直書きを検出する。textlint は markdown / プレーンテキスト向けで、TypeScript / Svelte ファイル内の文字列リテラルに対する型認識・AST 解析が弱い（`textlint-plugin-html` 等で部分対応するが、Svelte template の `<script lang="ts">` や `$:` reactive statement 内の文字列リテラルを正確に追えない）
- **既存 ESLint 統合との整合**: F1 は既存 `check-no-plan-literals.mjs` (#972) の延長で、ESLint plugin (`local/no-hardcoded-jp-text` #1452) と並列の SSOT 検証層を構成する。textlint を追加導入すると検証ツールが 3 系統（ESLint / 独自 mjs / textlint）に分散する

## 採用案とその理由（F1 単独 + #1909 close）

### 1. F1 vs textlint-rule-prh 機能比較表

| 観点 | F1 (#1918) check-no-plan-literals.mjs 強化 | textlint-rule-prh (#1909) |
|------|---|---|
| **対象範囲** | `src/lib/server` / `src/hooks.server.ts` / `src/routes` の `.ts` / `.svelte` | `src/lib/domain/labels.ts`（中期: `site/**` 拡張も視野） |
| **検出対象** | terms.ts atom 値の直書き（プラン名 / 価格 / トライアル / 解約 / 無料訴求） | 同概念の複数表記（"FAQ" / "FAQ 専用ページ"、"子供" / "子ども" / "こども" 等の banned terms） |
| **正準形 SSOT** | `src/lib/domain/terms.ts`（既存、Phase 1 #1916 で確立） | 新規 `scripts/lp-canonical-terms.yml`（13+ ドメイン） |
| **例外機構** | 既存 `EXCLUDE_PATTERNS` (constants 本体・stripe-service・schema・migrations・tests) | 新規 `exceptions:` 節（key path + reason） |
| **学習コスト** | regex の追加のみ。既存 mjs の延長 | textlint + prh.yml 別エコシステムの理解 |
| **既存依存** | Node.js 標準のみ（既存 mjs と同経路） | `textlint` + `textlint-rule-prh` (~50MB dev only) |
| **bundle 影響** | dev / CI のみ、production 0 KB | 同左（dev only） |
| **メンテコスト** | 検出ルール = terms.ts 値と 1:1（自動同期可能） | prh.yml = 別 SSOT、terms.ts と手動同期が必要 |
| **Pre-PMF コスト (ADR-0010)** | 低（既存機構延長） | 中（新エコシステム + 例外承認フロー） |
| **labels.ts 内表記揺れ検出力** | 対象外（#1916 で構造的解消済のため不要） | 対象（しかし対象自体が消失している） |

### 2. 採用根拠

- **Phase 1 #1916 で labels.ts 内表記揺れが構造的に消失**: terms.ts atom 化により、labels.ts は `${PLAN_TERMS.standard}` 等の参照のみとなり、同概念の複数表記が並存する余地が無い。textlint-rule-prh の主目的（PO 4 回連続再発した「FAQ 用語 SSOT」表記揺れ検出）は、Phase 1 完了時点で対象自体が消失している
- **F1 が atom 直書き検出層をカバー**: terms.ts atom 値を `src/lib/server` / `src/routes` で直書きする経路は F1 が hard-fail で塞ぐ。これが残る唯一の表記揺れリスク経路
- **「OSS / 確立パターン」要件の充足**: ADR-0014 / #1350 OSS 先調査ルールに照らし、F1 は ESLint custom rule (`no-hardcoded-jp-text` #1452) + 独自 mjs (`check-no-plan-literals.mjs` #972) という既存 OSS / 確立パターン延長で実装可能。「独自実装が 10 行超えそうなら OSS を探す」は本件で既に既存機構の延長線上のため適合
- **Pre-PMF コスト最小化（ADR-0010）**: dev 依存 50MB 増 + prh.yml 別 SSOT + 例外承認フローを Pre-PMF で導入する ROI が、対象消失により成立しない

### 3. リスクと残留懸念

| リスク | 評価 | 対応 |
|---|---|---|
| terms.ts に集約されていない用語の表記揺れ（例: 「子供」/ 「子ども」/ 「こども」、「お子さま」/ 「お子様」） | 中 | Phase 3 D-3 / D-4a/b で SSOT 13 ドメイン正規化を完了予定。完了後、F1 の検出対象に追加するか、再度 textlint-rule-prh の必要性を Phase 6 等で再評価する（本判断は「現時点では不要」） |
| Phase 3 D 完了後に再び表記揺れが発生する経路 | 低 | terms.ts に集約後は Phase 1 と同じ構造的解消が効く。集約自体を妨げる要因が出れば再評価 |
| 法的注記の短縮形（"FAQ" 単独許容）等の例外管理 | 低 | terms.ts に `XX_TERMS.fooShort` を別 atom として追加すれば集約可能。例外フローは不要 |

### 4. 結論

**採用案: F1 (#1918) 単独で十分。#1909 close**。

#1909 は Phase 1 #1916 完成前の前提（labels.ts 単一層に atom + compound 混在）で起票された妥当な提案だったが、Phase 1 完了 + ADR-0045 supersede により**前提が変わった**。supersede 構造として F1 (#1918) が #1909 の検出意図を構造的に上回る形でカバーするため、#1909 は「completed (前提変更により対象消失)」として close する。

## 残された懸念・フォローアップ

- [ ] **Phase 3 D-3 / D-4a/b 完了後の再評価**: 「子供」/ 「子ども」等の SSOT 13 ドメイン正規化完了後、terms.ts に集約された atom を F1 検出対象に追加するか、または textlint-rule-prh の再導入を検討する判断点を Phase 6 で設ける。関連: #1914 (TECH-F)
- [ ] **terms.ts 内表記揺れ自体の発生監視**: terms.ts 内に「同概念に複数 key」が増えた場合（例: `noCreditCard` / `noCreditCardShort` / `noCreditCardMid` のように長さ違い variants を独立 atom として持つ運用）、レビュー観点で「不要 variant ではないか」を確認する原則を ADR-0045 補足として記録する
- [ ] **F1 (#1918) 完成版の AC1 リテラル一覧**: 本評価は F1 sketch（Issue 本文 AC1 列挙）を前提に判定したため、F1 PR 完成時に検出範囲が AC1 列挙より狭まった場合は本判断を再評価する

## 関連

- **議論源 Issue / PR**: #1921 (Phase 5 F4) / #1909 (TECH-MAJ-1) / #1918 (Phase 5 F1) / #1916 (Phase 1 基盤) / #1922 (ADR-0045 起票)
- **影響を受ける設計書**: `docs/DESIGN.md` §6（用語辞書 2 階層 SSOT 図）
- **関連 ADR**: [ADR-0010](../decisions/0010-pre-pmf-scope-judgment.md)（Pre-PMF スコープ判断）/ [ADR-0014](../decisions/0014-labels-i18n-mechanism.md)（OSS 先調査）/ [ADR-0045](../decisions/0045-terms-ssot-2-layer.md)（terms.ts SSOT 2 階層化）/ ADR-0009 (archived, superseded by 0045)
