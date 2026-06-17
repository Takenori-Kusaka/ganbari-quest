# 監査基盤 gap 棚卸しレポート — テスト/CI/デプロイ/staging

> 外部品質監査チーム（EPIC #2861）初回事前準備ゲート（audit-team.md §3.7）の充足前提となる、テスト・CI・デプロイ・staging 基盤の現状と gap を事実ベースで棚卸しする。Issue #2878 成果物。
>
> **関連**: EPIC #2861 / #2872 (NUC staging) / #2873 (AWS staging) / #2874 (統合 PR 最重厚テスト) / #2871 (daily 自動化コスト) / ADR-0010 (Pre-PMF) / ADR-0019 / ADR-0024
>
> **PO 強調必須要件 (2026-06-11)**: ①「過去状態からマイグレーション込み起動」検証 ② AWS 版 + NUC 版両方の post-deploy health check — 本レポートでは Gap G-MIG / G-PD として独立に扱う。

## §1 現状インベントリ（事実表）

### §1.1 CI workflow（`.github/workflows/`、全 33 file）

主要 workflow:

| workflow | trigger | runs-on | 主な job / 役割 |
|---|---|---|---|
| `ci.yml` | push:main / PR:[main,develop] / dispatch | ubuntu-latest | changes(paths-filter) → lint-and-test / unit-test(2 shard) / e2e-test(3 shard) / a11y / storybook-test / e2e-cognito-dev / e2e-demo-lambda / docker-build / site-check / 各種 env・schema gate → ci-gate 集約 |
| `deploy.yml` | push:main(paths) / tag v*/ dispatch | ubuntu-24.04-arm | deploy(CDK 6 stack + ECR build/push + Lambda update) → e2e-production(smoke) → release/notify |
| `deploy-nuc.yml` | push:main(paths) / dispatch | **self-hosted [Windows,X64]**（runner label は deploy-nuc.yml 参照、#2987 で本 doc から具体 identifier を抽象化） | stop→pull→.env生成→build→up→health check |
| `audit-run.yml` | **dispatch のみ** | ubuntu-latest | a11y-scan / lp-metrics / rules-based-checks / coverage / pipeline-selftest（全 continue-on-error、起票せず artifact 化） |
| `lp-visual-regression.yml` / `child-home-visual-regression.yml` / `app-visual-regression.yml` | — | ubuntu-latest | pixelmatch 3 層（LP=hard-fail / child-home・app=warn） |
| `lp-metrics.yml` / `security-scan.yml` / `codeql.yml` / `dependency-review.yml` | — | ubuntu-latest | LP ratchet / SAST / 依存脆弱性 |

**develop 二層レーン分岐（`ci.yml`）**: 重量 job（`storybook-test` / `e2e-test` / `a11y` / `e2e-cognito-dev` / `e2e-demo-lambda` / `docker-build`）は `github.base_ref != 'develop'` 条件で develop 向け PR では skip。main 向け PR / push でのみ全量実行。

### §1.2 AWS インフラ（`infra/lib/`、CDK 6 stack）

`infra/bin/app.ts` が `region: 'us-east-1'` 固定で以下 6 stack を生成。**全て production 用。`-staging` suffix の stack・stage 分離は存在しない**（`infra/` 内 "staging" 出現は `compute-stack.ts` の Stripe doc コメント 1 件のみ）。

| stack | 役割 |
|---|---|
| `GanbariQuestStorage` | DynamoDB(single-table) + S3 + ECR |
| `GanbariQuestAuth` | Cognito User Pool v2 |
| `GanbariQuestCompute` | Lambda(app, DockerImageFunction) + demo Lambda(ADR-0048) + cron-dispatcher |
| `GanbariQuestNetwork` | CloudFront(geoRestriction JP) + Route53 + ACM |
| `GanbariQuestSes` | SES 送受信 |
| `GanbariQuestOps` | CloudWatch Alarm + Budgets + health-check Lambda |

`tests/unit/infra/multi-lambda-cdk.test.ts` が CDK 構成を assert（要 `cd infra && npm ci`）。

### §1.3 テスト基盤

| 種別 | 置き場所 / コマンド | CI 組込状況 |
|---|---|---|
| unit / integration | `tests/unit/` `tests/integration/` / `vitest run`（2 shard + coverage ratchet） | **○**（`ci.yml` unit-test、ADR-0005 閾値 merge 後検証） |
| E2E（既定） | `tests/e2e/` / `playwright test`（3 shard） | **○**（main 向け / push のみ、重量レーン） |
| E2E matrix（mode×plan） | `test:e2e:matrix`（`playwright.matrix.config.ts`、4 project port 5201-5204） | **○ CI 組込済**（`ci.yml` `e2e-matrix` job、main 向け PR + push:main、§7.1 で実測再確認。本行は #2874 完了前 snapshot で当初「✕」と誤記） |
| E2E cognito-dev | `playwright.cognito-dev.config.ts` | **○**（cognito フィルタ該当時のみ） |
| E2E demo Lambda | `tests/e2e/demo-lambda/` / `test:e2e:demo` | **△**（`area:demo` label / push / dispatch のみ） |
| Storybook play | `test:storybook` | **○**（stories 変更時、main 向けのみ） |
| a11y（axe-core WCAG2.2AA） | `tests/e2e/a11y-critical-cuj.spec.ts` | **○**（critical CUJ 7 page、main 向けのみ） |
| visual regression 3 層 | pixelmatch（LP/child-home/app） | **○**（LP=hard / 他=warn） |
| API integration | `tests/integration/api/`（point / activity / activity-log の 3 spec のみ） | **○**（vitest 同梱） |
| 仮ユーザテスト POC | `scripts/ai-evaluation/`（Stagehand v3 + axe-core + 5 persona、6 layer pipeline） | **✕ CI 非組込（POC、opt-in）** |

### §1.4 DB migration

- **Drizzle file-based migration（`drizzle/` ディレクトリ）は不在**。`db:generate`/`db:migrate` script は定義のみで運用は別機構。
- 実機構 = **startup-time lazy migration**: `src/lib/server/db/migration/lazy-startup-migrations.ts`（SQLite/NUC のみ）。`applyLazyStartupMigrations()` → `SQL_CREATE_TABLES`（create-tables.ts）→ `validateAndMigrate()`（schema-validator.ts、`ALTER TABLE ADD COLUMN` 自動）の 3 段。shadow-table recreation / DROP COLUMN / FK switch / cross-table data copy を冪等 guard + transaction で実行。
- **過去状態起動の自動検証（既存）**: `tests/integration/db/legacy-schema-upgrade.test.ts`（`tests/fixtures/legacy-schema/*.sql` snapshot 駆動、現状 `2026-05.sql` 1 世代）+ `startup-upgrade-path.test.ts`（#2508 inline seed 回帰）。`ci.yml` の `schema-migration-completeness-check` が破壊的 schema diff 時に lazy-migration 同期を hard-fail。
- **deploy 経路の migration step**: AWS Lambda は DynamoDB バックエンドで lazy-migration を呼ばない。NUC は container 起動時（`client.ts` SQLite mode）に自動実行。deploy.yml / deploy-nuc.yml に明示的な「過去 DB snapshot からの migrate 込み起動」検証 step は無い（unit/integration 層のみ）。

## §2 監査体制が要求する水準 vs 現状の gap 一覧

audit-team.md §3.7（初回事前準備 5 項目）/ §3.8（毎回 9 ステップ）が要求する水準との差分。severity: 1=軽微 … 4=ブロッカー。Bucket は ADR-0010。

| ID | gap 項目 | 現状 | 要求水準（出典） | 影響 | 対応 issue | severity | Bucket |
|---|---|---|---|---|---|---|---|
| **G-STG-NUC** | NUC staging 不在 | NUC は main deploy 専用（`deploy-nuc.yml`、本番マシン直）。develop HEAD を本番前に検証する staging 系統なし | §3.7 #2「develop→main 取込**前**に検証できる staging stack（本番 deploy workflow とは別系統）」 | 統合 PR を本番不変条件を侵さず実機検証できない | **#2872** | 4 | A |
| **G-STG-AWS** | AWS staging stack 不在 | CDK 6 stack 全て production。stage/`-staging` 分離なし | §3.7 #2（AWS 側）。本番 deploy 経路（Lambda/DynamoDB/CloudFront/Cognito）は AWS staging でしか検証不能 | 本番 deploy 経路そのものの事前検証が不能 | **#2873** | 4 | A |
| **G-STG-GATE** | staging deploy → merge blocker 機構なし | 統合 PR が staging deploy 成功を merge 前提にする gate が未構成 | §3.7 #3 + §3.8 step 6-8「統合 PR の staging deploy 検証→失敗で merge blocker」 | 「緑でないと merge 不可」を機械強制できない | **#2872/#2873**（gate 配線）/ E1 系 | 3 | A |
| **G-MIG**（PO 必須①） | 過去状態からマイグレーション込み**実機**起動の post-deploy 検証なし | unit/integration 層（`legacy-schema-upgrade.test.ts` ほか）は存在。だが **deploy 後の実機**（NUC container / AWS）で旧 DB→migrate→起動を貫通する検証は無い | §3.7 #5 + §3.8 step 9「過去状態からマイグレーション込みで正常起動」 | 「テストは緑、実機 startup で migration crash」（#2508 と同型）を deploy 後に再発見 | **新規**（#2872 内 or 独立、§4 参照） | 4 | A |
| **G-PD**（PO 必須②） | AWS+NUC 両 post-deploy health check の統合監査未配線 | AWS=`deploy.yml` health check + e2e-production smoke / demo smoke あり。NUC=`deploy-nuc.yml` health check あり。だが **監査チームが step 9 で「両方を 1 run で確認」する配線・deploy-verify skill 更新**が無い | §3.7 #5 + §3.8 step 9「AWS 版・ローカル NUC 版の両方へ health check」 | 片系統のみ緑で「全体健全」と誤判定 | **新規**（deploy-verify skill 更新）/ #2872/#2873 | 3 | A |
| **G-E2E-MATRIX** | `test:e2e:matrix`（5 年齢モード, port 5201-5205）CI 未組込 | ローカル手動のみ | §3.8 #2874 AC1「E2E matrix（5 年齢モード）全量実行」 | 「最重厚テスト網羅」の前提が崩れる（年齢モード横断回帰が自動化されていない） | **#2874** | 3 | A |
| 〃（実体是正注記、#2874 実装時） | `test:e2e:matrix` の実体は **ADR-0040 mode×plan matrix（4 project、port 5201-5204）**であり「5 年齢モード matrix（5201-5205）」は誤認。5 年齢モード横断は通常 E2E（`multi-age-mode.spec.ts` 等）が重量レーンで既カバー。#2874 で `e2e-matrix` job として保証発火化済 | — | — | — | — | — | — |
| **G-HEAVY-DEV** | 重量検査が develop レーンで skip | `e2e-test`/`a11y`/`storybook`/visual 等が develop 向け PR で skip | §3.8 #2874 AC2「軽量レーンで省略した重量検査を統合 PR で実行」 | 統合状態でしか出ない回帰が main 取込まで未検出 | **#2874** | 3 | A |
| **G-API-COV** | API integration test の網羅が薄い | `tests/integration/api/` は point / activity / activity-log の 3 spec のみ（`07-API設計書.md` 全エンドポイントに対し極小） | §3.8 #2874 AC1「API 全網羅」 | API 契約回帰の検出漏れ | **#2874**（+ 拡充は別 feature issue） | 2 | A |
| **G-PERSONA** | 仮ユーザテスト基盤が POC 止まり | `scripts/ai-evaluation/` は CI 非組込の opt-in POC | §3.1 ユーザビリティ・a11y / EPIC D4「ブラックボックス + 仮ユーザテスト」 | 体験品質の横断監査が手動依存 | EPIC #2861 D4（#2874 とは別） | 2 | B |
| **G-DV-SKILL** | deploy-verify skill が stale | `/opt/ganbari-quest` `pm2` `/api/v1/health` `drizzle-kit push` 記載 = 実機構（NUC=`C:\Docker`/docker compose/`/api/health`、AWS=Lambda）と乖離 | §3.8 step 9 が deploy-verify skill 再利用を前提 | step 9 実行手順が誤り | **新規**（軽微、G-PD と同梱可） | 2 | A |
| **G-COV-MAP** | カバレッジ未計測領域の特定なし | vitest coverage ratchet はあるが「どの dir/機能が未カバーか」の棚卸し不在 | §3.5 #4「自動テストカバレッジ + 閾値割れなし」の判定根拠 | NG 0 件判定の盲点 | **#2874**（artifact 化）| 1 | A |

### gap 件数表（領域 × 件数 × severity 分布）

| 領域 | gap 件数 | sev4 | sev3 | sev2 | sev1 |
|---|---|---|---|---|---|
| staging（NUC/AWS/gate） | 3 | 2 | 1 | 0 | 0 |
| migration 込み起動（PO 必須①） | 1 | 1 | 0 | 0 | 0 |
| post-deploy health（PO 必須②） | 2 | 0 | 1 | 1 | 0 |
| E2E（matrix / 重量レーン） | 2 | 0 | 2 | 0 | 0 |
| API / カバレッジ | 2 | 0 | 0 | 1 | 1 |
| 仮ユーザ / 体験 | 1 | 0 | 0 | 1 | 0 |
| **合計** | **11** | **3** | **5** | **3** | **2** |

## §3 業界ベストプラクティス調査（一次情報 URL 付き）

### §3.1 serverless staging（idle≈¥0 / 本番同型 stack 分離）
- **Stateful/Stateless stack 分離**: 長命・データ保持リソース（Cognito / DynamoDB）を Stateful stack に隔離し、Lambda/API を別 stack に。env ごとに billing model を切り替え dev コストを抑制する（AWS CDK best practices, [ranthebuilder.cloud](https://www.ranthebuilder.cloud/post/aws-cdk-best-practices-from-the-trenches)）。
- **stage / context での env 分離**: 同一/別アカウントに独立 stack を deploy。ただし PR ごとに Route53/CloudFront/Cognito/API GW/DynamoDB を全 provision するとデプロイ時間・コスト増 → ephemeral には platform stack を共有し application stack のみ使い捨てが推奨（[CDK Environment Management](https://dev.to/aws-heroes/cdk-environment-management-static-vs-dynamic-stack-creation-383l)、[Building Better CDK Stacks](https://jcdubs.medium.com/%EF%B8%8F-building-better-cdk-stacks-organise-resources-for-faster-and-safer-cloud-delivery-3ceeb6da60b2)）。
- **本リポ示唆**: 本番 Storage(DynamoDB on-demand) は idle 無課金、Lambda はリクエスト課金。staging も同型なら idle≈¥0（#2873 AC2 整合）。Cognito/CloudFront の固定費・ACM/Route53 の重複に注意。

### §3.2 過去状態からマイグレーション込み起動検証（PO 必須①）
- **Snapshot-Forward パターン**（Atlas）: ①空 DB → ②test 対象の直前 version まで migrate → ③旧 schema 形状の既知データ投入 → ④対象 migration 実行 → ⑤結果 assert。data 変換は「特にミスが致命的・不可逆」なため schema-only より厳格に検証する（[atlasgo.io/guides/testing/data-migrations](https://atlasgo.io/guides/testing/data-migrations)）。
- **ephemeral DB に本番 backup 復元 → migrate → smoke**: build pipeline で production backup から data-image を再生成しテストに使う / IaC で使い捨て DB を spin up（[Qovery: ephemeral migrations](https://www.qovery.com/blog/database-schema-migrations-in-ephemeral-environments-best-practices)、[Medium: Testing database migrations](https://medium.com/ingeniouslysimple/testing-database-migrations-5e86d7e47d2a)）。
- **rollback testing は forward testing が見落とす edge case を露出**（[Atlas](https://atlasgo.io/guides/testing/data-migrations)）。
- **本リポ整合**: 既存 `legacy-schema-upgrade.test.ts`（fixture SQL snapshot 駆動）は §3.2 を unit/integration 層で**既に実装**。gap は「**実機 deploy 後の貫通**」のみ（§4 で staging に配置）。

### §3.3 post-deploy smoke / health（self-hosted runner 注意点）
- smoke test は deploy 完了時に endpoint を叩いて機能性を検証。staging への deploy 完了で自動実行が定石（[Medium: Test Automation Pipeline](https://medium.com/@robert_mcbryde/building-a-best-practice-test-automation-pipeline-with-ci-cd-part-2-github-integration-and-eb6fb5545f73)）。
- **self-hosted runner**: runner の disk/memory/status を定期 health check で監視、systemd/journalctl で稼働確認。実機 e2e は環境の再現性確保が要点（[GitHub Docs: monitor self-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/monitor-and-troubleshoot)、[Red Hat: e2e with self-hosted runners](https://developers.redhat.com/articles/2023/07/25/end-end-testing-self-hosted-runners-github-actions)）。
- **本リポ整合**: NUC=`self-hosted [Windows,X64]` + actor allowlist（Takenori-Kusaka / ganbariquestsupport-lab）。両系統 health check（AWS Lambda Function URL `/api/health` + NUC `localhost:3000/api/health`）は個別には存在。

### §3.4 staging deploy gate（merge blocker 化）
- **Environment protection rules**: job が environment 参照時、required reviewers / wait timer / branch policy / custom rule（Datadog/Honeycomb 等）を全通過するまで開始しない・secret に到達しない（[GitHub Docs: deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)）。
- **「Require deployments to succeed before merging」**: branch protection rule で「特定 environment（例 staging）への deploy 成功」を merge 前提にできる（[GitHub Docs: about protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)、機能名 verbatim）。
- **本リポ整合**: `deploy.yml` は `environment: production`。develop→main 統合 PR に staging environment + 本 rule を組めば §3.7 #3 の「merge blocker」を機械強制できる（#2874 AC4 / E1 配線）。

## §4 推奨着手順とスコープ提言

事前準備ゲート（§3.7）5 項目のうち #1（ブランチ戦略）は cutover 済。残 #2-#5 を以下順で埋める。

1. **#2872（NUC staging 先行）= G-STG-NUC + G-MIG の主担保 + G-PD の NUC 側**
   - develop HEAD を本番 NUC とは独立な staging container（別 `C:\Docker\ganbari-quest-staging` / 別 port / 別 DB path）に deploy する系統を新設（本番不変条件を侵さない）。
   - **G-MIG をここに配置**: staging container を「**直近本番 DB snapshot（`tests/fixtures/legacy-schema/*.sql` 同系統の実 DB コピー）から起動**」させ、`applyLazyStartupMigrations` 貫通 → `/api/health` 200 を post-deploy で確認。これが「過去状態からマイグレーション込み実機起動」の実機担保（§3.2 snapshot-forward の deploy 層適用）。
   - deploy-verify skill を実機構に更新（G-DV-SKILL）。
2. **#2873（AWS staging stack）= G-STG-AWS + G-PD の AWS 側**
   - CDK を stage/context 分離（`-staging` suffix、§3.1）。DynamoDB on-demand + Lambda で idle≈¥0、Cognito/CloudFront 固定費は最小構成（demo Lambda は staging で省略可）。ADR-0019 Replacement gate を staging にも適用（#2873 AC3）。
   - **G-PD（AWS 側）**: staging Lambda の post-deploy health（`deploy.yml` の health/smoke step を staging environment で再利用）。NUC（#2872）と合わせ「AWS+NUC 両 health check」を §3.8 step 9 で 1 run 確認。
   - NUC で deploy-verify flow 実証後は並行着手可（#2873 本文の依存注記どおり）。
3. **#2874（統合 PR 最重厚テスト束ね）= G-E2E-MATRIX + G-HEAVY-DEV + G-STG-GATE 配線 + G-API-COV/G-COV-MAP の artifact 化**
   - develop→main 統合 PR レーンで `test:e2e:matrix`（5 年齢モード）+ 重量検査全量 + visual 3 層を実行。
   - #2872/#2873 の staging deploy 検証を統合 PR CI に接続し、staging environment への deploy 成功を **「Require deployments to succeed before merging」**で merge blocker 化（§3.4、G-STG-GATE）。
   - 結果 summary を E1 エビデンス表に渡せる artifact 化（カバレッジ未計測領域の可視化含む）。

**新規起票が要るもの**: G-MIG の実機貫通 step（#2872 のサブとして AC 化推奨、独立起票なら「post-deploy migration-from-snapshot smoke」）/ G-DV-SKILL（deploy-verify skill 更新、#2872 同梱可）。それ以外は #2872/#2873/#2874 で被覆。

## §5 Pre-PMF 判断（ADR-0010 整合）

| gap | Bucket | 根拠 |
|---|---|---|
| G-STG-NUC / G-STG-AWS / G-STG-GATE | **A** | 本番=push 即 deploy 不変条件下で「統合前に本番事故を止める唯一の構造的層」。AWS は idle≈¥0 + PO コスト承認済（#2873）→ 過剰防衛でない |
| G-MIG（PO 必須①） | **A** | #2508（NUC startup migration crash）の実害再発防止。unit 層だけでは実機 startup crash を捕捉できないことが実証済 |
| G-PD（PO 必須②） | **A** | 片系統緑の誤判定防止。既存 health step の再利用で増設コスト最小 |
| G-E2E-MATRIX / G-HEAVY-DEV | **A** | 統合状態回帰の機械検出。頻度抑制（1 日 1 回統合 PR のみ）でコスト管理（#2874 本文） |
| G-API-COV / G-COV-MAP | **A**（薄く） | 監査 NG 0 件判定の根拠。拡充自体は段階的 |
| G-DV-SKILL | **A** | skill 更新のみ、コスト 0 |
| G-PERSONA | **B** | 仮ユーザ基盤本格化は EPIC D4。Pre-PMF では opt-in POC で可、daily hard gate には載せない |

過剰防衛回避（Bucket C 不採用）: 別 AWS アカウント完全分離（[QuantCo の environment 悪用事例](https://tech.quantco.com/blog/github-actions-environments)で示される複雑性 + ソロ運用過剰）/ PR ごと ephemeral full stack / 多人数 user testing は Pre-PMF 段階で不採用。

## §6 出典一覧
- AWS CDK best practices — https://www.ranthebuilder.cloud/post/aws-cdk-best-practices-from-the-trenches
- Building Better CDK Stacks — https://jcdubs.medium.com/%EF%B8%8F-building-better-cdk-stacks-organise-resources-for-faster-and-safer-cloud-delivery-3ceeb6da60b2
- CDK Environment Management: Static vs Dynamic — https://dev.to/aws-heroes/cdk-environment-management-static-vs-dynamic-stack-creation-383l
- Atlas: Testing Data Migrations — https://atlasgo.io/guides/testing/data-migrations
- Qovery: DB migrations in ephemeral environments — https://www.qovery.com/blog/database-schema-migrations-in-ephemeral-environments-best-practices
- Testing database migrations (Medium) — https://medium.com/ingeniouslysimple/testing-database-migrations-5e86d7e47d2a
- GitHub Docs: Deployments and environments — https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- GitHub Docs: About protected branches (Require deployments to succeed before merging) — https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- GitHub Docs: Monitor self-hosted runners — https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/monitor-and-troubleshoot
- Red Hat: E2E testing with self-hosted runners — https://developers.redhat.com/articles/2023/07/25/end-end-testing-self-hosted-runners-github-actions
- Test Automation Pipeline with CI/CD (Medium) — https://medium.com/@robert_mcbryde/building-a-best-practice-test-automation-pipeline-with-ci-cd-part-2-github-integration-and-eb6fb5545f73

## §7 AC 完遂補完 + 現状再検証（2026-06-18）

> §1-§6 は 2026-06-11 の audit-manager snapshot。本節は Issue #2878 の AC4（matrix CI cost 概算）/ AC5（API 網羅率算出 + 未カバー一覧）を完遂し、その際に判明した §1-§2 の stale 記述を実測再確認で是正する。出典は本リポの実 file / 実 CI run（GitHub Actions API 実測値）。

### §7.1 stale 記述の是正（実測再確認）

| §1-§2 の記述 | 2026-06-18 実測 | 是正 |
|---|---|---|
| §1.3 L47「E2E matrix … ✕ CI 未組込（ローカル手動のみ）」 | `.github/workflows/ci.yml` の `e2e-matrix` job（`if: github.base_ref != 'develop'`、main 向け PR + push:main + dispatch で発火）が実在し `npm run test:e2e:matrix` を実行。直近 main run 3 件で **success**（後述 §7.2 の実測 wall-clock 参照） | **○ CI 組込済**。§2 L75 の「実体是正注記」が正、§1.3 L47 の「✕」は #2874（`e2e-matrix` job 化）完了前の旧状態。G-E2E-MATRIX は **解消済**（severity 3→0） |
| §1.2「`-staging` suffix の stack・stage 分離は存在しない」/ §2 G-STG-NUC・G-STG-AWS「staging 不在」 | `.github/workflows/deploy-aws-staging.yml`（実在、AWS staging 3 stack を `-c stagingEnabled=true` で deploy + health/smoke）/ `.github/workflows/deploy-nuc-staging.yml`（実在、本番 DB snapshot → staging container 起動の migration-forward step を含む）が両方実在 | G-STG-NUC / G-STG-AWS は **workflow 実装済（#2872 / #2873 の D 系成果）**。ただし infra/CLAUDE.md 記載どおり **当面 advisory（main ruleset の required_status_checks 未登録）**。残 gap は G-STG-GATE（merge blocker 化 = required 登録）に収斂 |
| §2 G-MIG「過去状態からの migration 込み実機起動の post-deploy 検証なし」 | `deploy-nuc-staging.yml` が `scripts/snapshot-prod-db.cjs` で本番 DB snapshot → staging で `applyLazyStartupMigrations` 貫通 → health の経路を実装 | G-MIG は **NUC staging 側で実装済**。AWS は DynamoDB backend のため対象外（§1.4 整合）。残 gap は「advisory → required 昇格」（G-STG-GATE に合流） |

**要点**: 2026-06-11 snapshot 時点の「未着手」前提の sev4/sev3 gap（G-STG / G-MIG / G-E2E-MATRIX）は、その後の D 系実装（#2872/#2873/#2874 workflow）で **構造は実装済**になり、残るのは **「advisory → required_status_checks 登録による merge blocker 化」**（G-STG-GATE、severity 3）に収斂した。これは audit-manager が main ruleset を更新する運用判断（infra/CLAUDE.md §NUC/AWS staging 系統「初回緑確認後に required 化」）であり、新規実装 issue ではない。

### §7.2 AC4 — `e2e-matrix` CI 取込コスト概算（実測）

`e2e-matrix` は既に CI 組込済（§7.1）のため、**概算ではなく実 CI run の実測値**を示す（#2871 cost 概算と整合する形式）。

- **構成**（`playwright.matrix.config.ts`）: ADR-0040 mode×plan の **4 project**（`demo-free`:5201 / `local-debug-family`:5202 / `aws-prod-trial-expired`:5203 / `nuc-prod-trust-based`:5204）、1 worker、retries:0、testMatch=`tests/e2e/adr-0040/matrix.spec.ts`（3 test）。
- **実測 wall-clock**（`ci.yml` の `e2e-matrix` job、直近 main run、GitHub Actions API `gh run view --json jobs`）:

| CI run 日時 | job wall-clock |
|---|---|
| 2026-06-16 07:35 | 2m16s |
| 2026-06-15 12:49 | 2m29s |
| 2026-06-11 06:57 | 1m33s |

- **GitHub Actions 分概算**: ubuntu-latest（1× 課金乗数）で 1 job ≈ **2–3 Actions-min/run**。発火頻度 = main 向け PR（≒1 日 1 回の統合 PR）+ push:main のみ（develop 向け feature PR では skip、§1.1 重量レーン方針）。月概算 ≈ 統合 PR 30 回 + main push 数十回 = **~100–150 Actions-min/月**（ubuntu free tier 2,000 min/月 に対し誤差レベル、ADR-0010 Pre-PMF 適合）。
- **結論**: AC4 が想定した「未組込 → 組込時の追加コスト」は **既に発生済みで実測 2–3 Actions-min/run と極小**。追加コスト懸念なし。#2874 が `e2e-matrix` を保証発火 job 化した判断は cost 面でも妥当。

### §7.3 AC5 — API テスト網羅率（`07-API設計書.md` 基準）+ 未カバー一覧

**母数**（実測、`find src/routes/api -name '+server.ts'` / handler は `export (const|async function) (GET|POST|PUT|PATCH|DELETE)` grep）:
- endpoint file（`+server.ts`）: **100**
- handler method（endpoint × method）: **129**

**直接テスト資産**（再現可能な定義 = endpoint 専用の unit/integration テストが存在）:
- `tests/integration/api/`: **3 file**（`activity-api` / `activity-log-api` / `point-api`）→ activities・activity-logs・points 系 ~8 endpoint を境界網羅
- `tests/unit/routes/*-api*.test.ts` ほか: **14 file**（`account-delete-api` / `activities-suggest-api` / `admin-tenant-cancel` / `api-stripe-webhook` / `api-stripe-webhook-v2` / `cron-analytics-aggregate-api` / `cron-auth-3-endpoints`（3 endpoint）/ `cron-challenge-aggregate-api` / `feedback-api` / `notifications-subscribe-api` / `parent-gate-reset-request-code-api` / `parent-gate-reset-verified-api` / `parent-gate-setup-api` / `weekly-report-api`）→ ~16 endpoint

**網羅率（2 指標、再現可能）**:

| 指標 | 分子/分母 | 率 | 定義 |
|---|---|---|---|
| **専用 unit/integration テスト網羅** | ~24 / 100 endpoint file | **~24%** | endpoint ごとの専用 API テスト（境界条件・認可・エラーを assert）が存在 |
| **何らかのテスト網羅（E2E smoke 含む）** | ~37 / 100 endpoint file | **~37%** | 上記 + E2E spec が経路を 1 回以上叩く（health / auth / battle / login-bonus / account-deletion / parent-gate-verify / stripe-checkout / usage 等の smoke） |

→ **API テスト網羅率 ≈ 24%（専用テスト）〜 37%（E2E smoke 込み）**。残 **63–76 endpoint が専用テスト不在**。G-API-COV（§2、severity 2）の定量化。

**未カバー endpoint 一覧（専用テスト不在、優先度別）**:

- **高（コア業務ロジック / AI）**: `special-rewards/[childId]`・`special-rewards/[rewardId]/shown`・`special-rewards/suggest`・`cheer/suggest`・`checklists/suggest`・`messages/[childId]`(POST)・`messages/[messageId]/shown`・`rest-days/[childId]`(CRUD)・`settings/decay`・`evaluations/[childId]`・`achievements/[childId]`・`points/ocr-receipt`・`children/[id]/voices`(CRUD)
- **中（admin / データライフサイクル）**: `admin/account/{export,grace-status,restore}`・`admin/downgrade-{archive,preview,restore}`・`admin/invites/[code]`(DELETE)・`admin/members/{[userId],transfer-ownership,leave}`・`admin/trial-expiration`・`admin/viewer-tokens`(CRUD)・`admin/migration`・`admin/cleanup-orphans`・`admin/notifications/{reminder,streak-warning}`
- **低（export/import / 設定）**: `activities/export`・`special-rewards/export`・`checklists/export`・`export/cloud`(CRUD)・`import/cloud`・`data/{summary,clear}`・`settings/{tutorial,pin-gate-onboarding,vapid-key}`・`notifications/unsubscribe`・`inquiry/founder`・`images`(GET/POST)・`analytics`系

**`07-API設計書.md` doc-vs-code 差分**（AC5 副産物、ADR-0001 同期 gap）:
- **doc 記載・code 不在の疑い**: `GET /api/v1/children` / `GET /api/v1/children/[id]`（設計書に table 記載あるが `+server.ts` 未検出 — 実体は `load` 経由の可能性、要 #2577 doc-code-references 精査）
- **code 実在・doc 未記載**: `admin/account/{export,grace-status,restore}` / `admin/downgrade-{archive,preview,restore}` / `admin/trial-expiration` / `settings/pin-gate-onboarding` / `inquiry/founder` 等 ~9 endpoint（07-API設計書.md の table に追補が必要）

→ doc-vs-code 同期は **別 feature issue 起票候補**（本 gap-list の scope は棚卸しまで、是正実装は #2874 の API 網羅拡充 or 専用 issue）。

### §7.4 AC → 充足 section 対応表（#2878 完遂確認）

| AC | 要求 | 充足 section | 状態 |
|---|---|---|---|
| AC1 | gap-list レポート新設 + path 報告 | 本 file（`docs/research/2026-06-11-audit-infra-gap-list.md`）。Issue へ path コメント報告 | ✅ |
| AC2 | gap 件数表（領域×件数×severity）5 領域網羅 | §2「gap 件数表」（staging / migration / post-deploy / E2E / API・カバレッジ / 仮ユーザの 6 区分、11 gap）+ §7.1 で sev 再評価 | ✅ |
| AC3 | 各 gap → 担当 issue 紐付け | §2 gap 表「対応 issue」列（#2872/#2873/#2874/新規）+ §7.1 で実装済 gap の収斂先明示 | ✅ |
| AC4 | matrix CI 取込 wall-clock + Actions 分概算（#2871 整合） | §7.2（実測 1m33s–2m29s / ~2–3 Actions-min/run / ~100–150 min/月） | ✅ |
| AC5 | API 網羅率（07-API設計書 基準）+ 未カバー一覧 | §7.3（24%専用 / 37%smoke 込み、母数 100 file・129 handler、未カバー 63–76 endpoint を優先度別列挙 + doc-vs-code 差分） | ✅ |

**残課題（本 gap-list scope 外、別 issue 判断）**: G-STG-GATE（staging advisory → required 昇格、audit-manager 運用判断）/ API 網羅拡充（G-API-COV 是正実装、#2874 or 専用 feature issue）/ 07-API設計書 doc-vs-code 同期（ADR-0001、専用 issue 候補）。
