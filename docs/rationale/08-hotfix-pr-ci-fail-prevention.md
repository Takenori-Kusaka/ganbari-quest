# hotfix PR CI fail 連続再発 防止策 設計経緯

<!-- 命名規則: NN-機能名-rationale.md (NN は 2 桁連番) -->

## 議論の発端

- **日時**: 2026-05-20
- **発端 Issue / セッション**: #2343
- **問題意識**: 2026-05-19〜20 の 36 時間で production hotfix 4 PR (#2318 / #2340 / #2341 / #2342) が同じ CI gate に連続 fail。urgency 文脈で品質ゲート bypass の誘惑が常態化しつつあった。

### 4 PR の fail パターン実測

| PR | 内容 | 初回 fail した gate | 修正方法 | 根本原因 |
|---|---|---|---|---|
| #2318 | marketplace CTA `/auth/signup`→`/auth/login` data integrity 保護 | design-doc-check / 必須セクション | `refactor:internal-no-doc-impact` ラベル付与 + QM レビュー結果セクション追記 | URL 振替のみで設計書同期不要だが、`src/routes/marketplace/` 変更検出で design-doc-check が fail。 label exempt 機構 (#1985) を起票時に思い出せなかった |
| #2340 | 本番 loginStamp 500 hotfix - stamp_masters fallback SSOT 化 | design-doc-check | ラベル付与 (`refactor:internal-no-doc-impact` 相当の判断) | `src/lib/server/db/dynamodb/stamp-card-repo.ts` 変更で `src/routes/(child)/[uiMode]/home/+page.server.ts` も連動変更 → routes 変更扱い。fallback 値の修正で機能仕様変化なしだが exempt label が起票時に未付与 |
| #2341 | PARENT_GATE_COOKIE_SECRET 配布証跡 4 経路完備 | (lint-and-test 系で initial fail なし、design-doc-check は CDK 変更で適切に通過) | (大きな fail なし、env 配布 evidence セクション + ADR-0006 適切に記載) | 教訓: hotfix PR でも 4 経路配布証跡を最初から記載すれば 1 ラウンドで完結する好例 |
| #2342 | `/api/v1/usage` 500 本番 hotfix - DynamoDB no-op fallback | design-doc-check / 必須セクション / Verify AC map / lint-and-test (env 直接参照) | `docs/design/07-API設計書.md` 追記 + 必須セクション 13 件補完 + AC マップ 4 列埋め + `$lib/runtime/env` 経由化 | 4 種 gate 同時 fail。Skill 雛形を使わず手書きで起票してセクション欠落、`process.env.DATA_SOURCE` 直接参照 (ADR-0040 P1 違反) |

### 共通パターン (#2343 root cause)

**4 つの構造的問題**:

1. **hotfix urgency で Skill 雛形 (`init-pr-body.mjs --kind critical-fix`) を使わず手書き** → 必須セクション 13 件のうち複数欠落 (#2342)
2. **`refactor:internal-no-doc-impact` ラベル付与判断が PR 起票時に漏れる** → design-doc-check fail で再 push (#2318 / #2340)
3. **`src/lib/server/services/` 配下で `process.env.X` 直接参照** → lint-and-test fail (#2342)。ADR-0040 P1 で 2026-04 から禁止済だが hotfix 速度優先で見逃される
4. **設計書同期 (`docs/design/07-API設計書.md` 等) を初回 push で忘れる** → design-doc-check fail (#2342)

## 検討した代替案

| 案 | 概要 | 検討した理由 |
|----|------|-----------|
| 案 A: `dev-open-pr` Skill 強化 (#2343 Issue 推奨) | Skill 内 pre-push で `check-design-doc-sync.mjs` / `check-no-direct-env-access.mjs` / `check-pr-body.mjs` を必須実行 | 既存 Skill + check スクリプト群を活かせる、Pre-PMF 整合 |
| 案 B: hotfix 専用 PR template 新規追加 | hotfix 専用 PR template を .github 配下の PULL_REQUEST_TEMPLATE ディレクトリに新規追加し、?template=hotfix URL パラメータで起動 | hotfix urgency と CI gate の両立、必須項目を限定 |
| 案 C: CI gate を `priority:critical` で自動 exempt | `priority:critical` label PR では `必須セクション` / `Verify AC map` を info-only に降格 | hotfix 速度最大化 |
| **採用案: A の強化 + B の代替 (critical-fix template 強化)** | `check-pr-body.mjs` に `priority:critical` / `hotfix` label 検知ロジック追加 + critical-fix template に hotfix runbook checklist 統合 + dev-session.md に hotfix runbook 追加 + Skill の pre-push 検証を 4 種統合 | A の Skill 強化を中核に、B の hotfix 専用フローは critical-fix template の強化で代替 (template 複数化のメンテ負荷回避) |

## 棄却理由

- **案 A 単独棄却理由**: Skill 強化だけでは PR 起票時の「`refactor:internal-no-doc-impact` ラベル付与忘れ」「ADR-0006 配布証跡欄忘れ」が起こりやすい。template 側にチェックリストを内蔵する必要がある
- **案 B 棄却理由**: PR template を「default」と「hotfix」の 2 種類化すると、(1) 既存 13 セクション SSOT (`PR_TEMPLATE_SECTIONS.json`) との drift 検知が複雑化、(2) GitHub URL ベースの `?template=` 起動は Dev 側の意図的指定が必要で漏れやすい、(3) `pr-template-gate.yml` の 5 ジョブで両 template を検証する必要が生じる、というメンテ負荷が Pre-PMF 段階で過剰 (ADR-0010 Bucket B/C 判断)
- **案 C 棄却理由**: ADR-0002 §4「品質ゲートは Critical でも省略しない」と直接衝突。hotfix urgency でも AC マップ・必須セクションを満たしてこそ ADR-0002 5 要件 (E2E 回帰 / AC 全完了 / 提案全実装 / 5 年齢モード検証 / 直近 30 日重複変更) が機能する。**非推奨**

## 採用案とその理由

**4 層防御の構造化**:

1. **template 側 (`pr-body-critical-fix.md`)**: hotfix 必須チェックリストを内蔵 (`refactor:internal-no-doc-impact` ラベル判断 / ADR-0006 配布証跡 / ADR-0040 P1 env 経由化 / 設計書同期)
2. **Skill 側 (`SKILL.md` + `ready-gate-checklist.md`)**: pre-push で 4 種 check を必須実行 (`check-pr-body.mjs` / `check-design-doc-sync.mjs` / `check-no-direct-env-access.mjs` / `check-new-required-env.mjs`)
3. **Session runbook (`dev-session.md`)**: hotfix 緊急時の最短 checklist を別 section で明文化、Skill 経由を必須化
4. **スクリプト側 (`check-pr-body.mjs`)**: `priority:critical` / `hotfix` label PR では「ADR-0006 配布証跡欄が `N/A` でない場合の必須記載確認」を追加検出

採用案は ADR-0002 §4 (品質ゲート Critical 例外なし) と整合し、ADR-0010 Bucket B (Pre-PMF 過剰防衛回避) も満たす。template 複数化を回避することで PR_TEMPLATE_SECTIONS.json SSOT は 1 つに維持される。

## 残された懸念・フォローアップ

- [ ] **hotfix label の標準化**: GitHub label `hotfix` を `.github/labeler.yml` 経由で自動付与する仕組みは未整備。現状は `priority:critical` ラベルで代用判定。標準化は別 Issue で扱う
- [ ] **CDK Lambda env 配布の自動化**: PR #2341 のような env 配布証跡 4 経路完備を CDK SSOT に統合する自動化は別 Issue (`#2337` 関連) で扱う
- [ ] **CI gate 自動 exempt 判断**: `refactor:internal-no-doc-impact` label 付与判断を AI で自動推論する機構は将来検討事項 (Pre-PMF Bucket C、現時点は Dev 手動判断)

## 関連

- **議論源 Issue / PR**: #2343 (process Issue) / #2318 / #2340 / #2341 / #2342 (再発 PR 4 件)
- **影響を受ける設計書**: `docs/sessions/dev-session.md` (hotfix runbook 追加) / `.claude/skills/dev-open-pr/SKILL.md` / `.claude/skills/dev-open-pr/ready-gate-checklist.md` / `.claude/skills/dev-open-pr/templates/pr-body-critical-fix.md`
- **関連 ADR**: [ADR-0001](../decisions/0001-design-doc-as-source-of-truth.md) (設計書 SSOT) / [ADR-0002](../decisions/0002-critical-fix-quality-gate.md) (Critical 品質ゲート) / [ADR-0006](../decisions/0006-safety-assertion-erosion-ban.md) (assertion erosion ban) / ADR-0040 (env access policy、`docs/decisions/archive/` 配下)
