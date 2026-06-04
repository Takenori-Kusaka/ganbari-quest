# ブランチ戦略 設計経緯

<!-- 結論・運用ルールの SSOT は docs/sessions/branch-strategy.md。本ファイルは「なぜそう決めたか」の経緯を残す。 -->

## 議論の発端

- **日時**: 2026-06-04
- **発端 Issue / セッション**: #2858
- **問題意識**: 個別 PR ごとに full CI gate（e2e×3 shard 最大 909s + a11y 745s + unit×2 259s + docker / storybook / visual regression）を毎回回すと 1 PR あたり 13〜16 分の CI 待ちが発生し、Pre-PMF のソロ開発スループットを直接削っていた（観測: `actions/runs/26935341287`、PR #2841）。一方で `main` push は `deploy.yml` / `deploy-nuc.yml` / `pages.yml` を即トリガーし本番 / NUC / LP へ反映されるため、gate を緩めて main に直接 merge すると本番品質が落ちる。「速度 vs 品質」の二者択一を避ける構造が要るという問題意識。

## 検討した代替案

deep research では git flow / GitHub flow / trunk-based + CI tiering / GitHub Merge Queue の一次情報を本プロダクト制約（ソロ開発 + QM 毎時レビュー + main 即 deploy + Pre-PMF）に照らして比較した。

| 案 | 概要 | 検討した理由 |
|----|------|-----------|
| 案 (a) develop 二層（git flow 簡略版） | `feature → develop → main` の 2 段。個別 PR は develop 向け軽量 gate、develop → main 統合 PR で full gate を集約 | git flow の release / hotfix 概念を Pre-PMF 規模に簡略化しつつ、「本番反映直前に総合検証を集約」できる |
| 案 (b) GitHub flow 維持 + CI tiering 強化 | branch 追加なし。per-PR は軽量、merge queue / nightly で重量検査 | branch 儀式ゼロで CI 設定だけで二層化できる。当初 deep research の推奨案 |
| 案 (c) trunk-based + GitHub Merge Queue | trunk（main）直開発 + Merge Queue で batch full-gate | 並行 PR の batch 検証では業界標準。CI 待ちを batch 化で償却できる |
| 採用案 | 案 (a) develop 二層 | PO が「外部品質監査チーム」体制を新設する方針を示し、前提が変わったため（下記） |

一次情報出典:

- git flow 原典（nvie, Vincent Driessen）: https://nvie.com/posts/a-successful-git-branching-model/ — 2020 reflection note（小規模・継続デリバリには GitHub flow 等を推奨）を含む
- Atlassian Gitflow Workflow: https://www.atlassian.com/git/tutorials/comparing-workflows/gitflow-workflow
- Trunk-Based Development: https://trunkbaseddevelopment.com/
- GitHub Merge Queue docs: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue

## 棄却理由

- **案 (b) GitHub flow + CI tiering 棄却理由**: deep research 時点では「branch 追加なしで二層化できる」点で推奨だったが、PO が **develop → main 統合 PR を 1 日 1 回・外部品質監査チーム role が運用 / merge する体制** を新設する方針を示したことで前提が変わった。外部品質監査チームの「全件発露 → Issue 起票 → 棄却」レビューを **明示的な統合ゲート PR** に紐付けるには、develop → main という physical な PR 境界がある方が役割・責任・cadence を明確に分離できる。tiering だけでは「誰がいつ何を集約検証するか」の境界が CI 設定に埋もれ、外部監査 role の運用単位（1 日 1 回の統合 PR）と一致しない。
- **案 (c) trunk-based + Merge Queue 棄却理由**: Merge Queue は並行 PR が常態化した規模で効く batch 機構。Pre-PMF のソロ開発では並行 PR が常時 1〜数本にとどまり、Merge Queue 導入の運用複雑性に対して償却効果が薄い。trunk 直開発は「本番反映前の集約バッファ」を持たないため、外部品質監査チームの統合レビュー単位を作れない。ただし将来並行 PR が増えた段階では重量レーンへの Merge Queue 導入を将来オプションとして残す。

## 採用案とその理由

案 (a) develop 二層を採用した。

- **外部品質監査チーム前提の出現が決定打**: 当初 deep research は (b) を推奨したが、PO が外部品質監査チーム体制（develop → main PR を 1 日 1 回、外部監査 role が発行・判定・merge）を新設する方針を示したことで、「本番反映直前の総合検証を **physical な統合 PR 単位** に集約する」必要が生じた。develop 二層なら、feature → develop（QM 毎時 / 軽量）と develop → main（外部監査 1 日 1 回 / 最重厚）で **レビュー role・cadence・gate を branch 境界で明確に分離** できる。
- **ADR-0007 §5 の branch 軸実装**: ADR-0007 §5 は「per-PR の軽量 targeted 検証 / EPIC-merge・顧客レビュー直前の総合検証」という 2 層 cadence を既に SSOT 化していた。develop 二層はこの cadence を branch 軸で具現化したもので、新しい哲学の追加ではなく既存方針の構造化。
- **main 不変条件を崩さない**: deploy トリガー（main push）に一切手を入れず、develop は deploy 経路を持たない集約バッファとして差し込む。ロールバックも develop branch 削除 + workflow revert のみで無停止。
- **Pre-PMF 整合**: 過剰な branch 儀式（release branch / version tagging 等の git flow フル機能）は採らず、main + develop + hotfix の最小二層に絞った（ADR-0010 整合）。

## 残された懸念・フォローアップ

- [ ] workflow trigger 改修（`branches: [main]` 固定 4 本の develop 向け発火 + 軽量 / 重量振り分け + main 向け base/head 検査 gate）— 本 SSOT merge 後の別 PR（cutover Step 2）
- [ ] develop 用 Branch Ruleset 新設 + main 向け base 制限（ユーザー手動、cutover Step 5）
- [ ] 外部品質監査チームのロール定義 doc 整備（外部品質監査チーム EPIC で実施）
- [ ] ADR-0022 への amendment（base branch 別 required reviews 適用）— workflow 改修 PR と同期
- [ ] 将来: 12 時間 cadence 化 / 重量レーンへの GitHub Merge Queue 導入 / NUC・AWS Staging 構築 CI（cdk deploy の CI wall-time と stack 命名・分離設計を要設計）

## 関連

- **議論源 Issue / PR**: #2858
- **結論 SSOT（運用ルール）**: [docs/sessions/branch-strategy.md](../sessions/branch-strategy.md)
- **関連 ADR**: [ADR-0007](../decisions/0007-static-analysis-tier-policy.md)（2 層 cadence）/ [ADR-0022](../decisions/0022-admin-bypass-disable-qm-approve.md)（QM Approve・Branch Ruleset）/ [ADR-0002](../decisions/0002-critical-fix-quality-gate.md)（Critical 品質ゲート）/ [ADR-0010](../decisions/0010-pre-pmf-scope-judgment.md)（Pre-PMF）
