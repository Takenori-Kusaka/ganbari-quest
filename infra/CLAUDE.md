# infra/ — デプロイ手順

**SSOT**: ADR-0006（assertion 禁止）/ ADR-0020（NUC scheduler）/ ADR-0024（infra PR baseline）/ ADR-0026（force push）

## 局所テストコマンド (#2184)

infra 配下のみ修正時 (CDK stack / Lambda コード) は全体テストを待たず以下で高速検証:

```bash
cd infra && npx vitest run                                      # CDK 単体テスト (該当時)
cd infra && npx cdk synth                                       # CDK synth 検証 (template 出力)
cd infra && npx cdk diff                                        # 既存 stack との差分確認
```

Lambda 関数の unit test は `tests/unit/infra/` 配下 (該当時):

```bash
npx vitest run tests/unit/infra/                                # Lambda handler unit test
```

SSOT: `docs/CLAUDE.md` §「サブディレクトリ別局所テストコマンド SSOT」。

## AWS リソース region SSOT（#1606 / #1649）

**全リソース `us-east-1` 固定**（Cognito custom domain ACM が us-east-1 必須のため統一）。CDK source `infra/bin/app.ts` L13-16 が `region: 'us-east-1'` で全 stack (`Storage` / `Auth` / `Compute` / `Network` / `Ops` / `Ses`) を deploy。

主要リソース: Lambda (アプリ / cron-dispatcher / cognito custom message / SES) / ECR / Aurora DSQL (DsqlStack) / S3 / AWS Backup vault (`ganbari-quest-vault`、RETAIN-orphan、prod のみ) / Cognito User Pool v2 (`auth.ganbari-quest.com`) / EventBridge cron rules / CloudWatch Logs / Route 53 (`ganbari-quest.com`) / SES (`noreply@ganbari-quest.com`) / SSM / Secrets Manager。DynamoDB `MainTable` は #3438 → #3850 → #3854 の 2-deploy strangler で**撤去済** (DB backend は DSQL 一本化)。cross-stack export の in-use 削除制約により、Deploy-1 (#3850 / #3855 / #3864) で StorageStack が table + **旧 consumer が import する全 export = `exportValue(table.tableName)` (Ref) + `exportValue(table.tableArn)` (Arn) の 2 本**を保持しつつ consumer(ComputeStack) 側だけ import を落とし、Deploy-2 (#3854) で consumer の import 消失が本番反映された後に table + AWS Backup **plan / selection / role** + 両 export を撤去した (この時点で export は in-use でないため削除成功。prod は RETAIN のため物理 table + データは orphan 保全、物理削除は別 ops)。詳細: `docs/design/13-AWSサーバレスアーキテクチャ設計書.md §3.1` / `infra/lib/*-stack.ts`。

### AWS Backup vault RETAIN-orphan (#3881 class 回避)

`ganbari-quest-vault` は旧 MainTable の日次 backup 用 vault。#3854 が vault も撤去しようとしたが、この vault は旧 daily plan が作成した **recovery point 2 件を保持**しており **AWS Backup は「recovery point 有り vault の削除」を API レベルで拒否する** (CloudFormation も同じ)。撤去すると deploy 失敗 → StorageStack rollback → 本番 deploy 停止 (#3881 と同一クラス) になる。canonical 解 = 破壊的な backup データ削除を避け **vault を残しつつ `removalPolicy: RETAIN` に是正** (旧 `DESTROY` = CDK 既定 RETAIN に反していた元凶)。plan / selection / role のみ撤去 (= 新規 backup は取らない)。staging (`enableBackup=false`) は vault 自体を構築しない。vault の物理 empty→delete は移行安定後の **gated out-of-band ops (PO 承認必須)**: `aws backup list-recovery-points-by-backup-vault` → `aws backup delete-recovery-point` ×2 → `aws backup delete-backup-vault` (手順 SSOT は設計書 §3.1)。不変条件は `tests/unit/infra/staging-cdk.test.ts` P-1 (vault RETAIN 1 本 / Plan・Selection 0 本) が fitness function として固定する。

自動 cross-stack export/import の全集合 (実測 13 = prod 9 + staging 4、#3854 で MainTable Ref/Arn 4 本を撤去し 17 → 13) は `tests/unit/infra/cross-stack-export-ratchet.test.ts` が allowlist ratchet で PR 時点に機械検出する (#3858、ADR-0061 shift-left / §3.1.1)。新規自動 export の混入は CI fail、SSM 疎結合化 / 撤去で allowlist から一方通行に減らす。

CloudFront はグローバル（geoRestriction `JP`）。新規 region 言及は本ファイルを SSOT として `us-east-1`。`tests/unit/e2e-helpers/*` の `ap-northeast-1` 言及はテスト fixture（変更不要）。

## CDK deploy 失敗の層別 未然防止（#3874、どの層で最初に落ちるか SSOT）

「synth 成功・unit test 通過・staging すり抜けで**本番 deploy の実 AWS で初めて失敗**する」CDK トラブル（第16回リリースで 2 class 連続発生）を、人の注意ではなく CI で未然に捕捉する層別防御。AWS 推奨の shift-left（synth 静的検査）→ fitness function → rehearsal（staging 実 deploy）の重ねに整合。**新しい deploy 失敗に遭遇したら、まず「どの層が最初に捕捉すべきか」を本表で判定してから対策を実装する**。

| 層 | 検証 | 実体 | 何を最初に捕捉するか |
|---|---|---|---|
| **Layer 1: synth 静的 lint** | `cdk synth --all` 出力 template を **cfn-lint** で検査し AWS schema 由来の property 制約違反（charset / allowed-value / type）を synth 時点で hard-fail | `scripts/check-cdk-cfn-lint.mjs` + `infra/.cfnlintrc` + ci.yml `cdk-cfn-lint` job（`infra/**` 変更時、develop 向け PR でも発火） | **Class ①（静的プロパティ制約違反）**。例: IAM Role/ManagedPolicy `Description` の非-ASCII（cfn-lint **E3031**、#3870）を含む全リソースの pattern / allowed-value / type 違反を**カスタムコードなしで**網羅捕捉 |
| **Layer 2: project 固有 fitness** | 「本 project が壊してはいけない不変条件」を `Template.fromStack` synth 後に assert（AWS schema には無い project 固有の意図） | `tests/unit/infra/iam-role-description-ascii.test.ts`（IAM description ASCII、#3870）/ `tests/unit/infra/cross-stack-export-ratchet.test.ts`（自動 export/import allowlist ratchet、#3858）/ `tests/unit/infra/physical-name-ratchet.test.ts`（明示物理名 allowlist ratchet、#3881） | **Class ②（stateful なデプロイ順序制約）の一部 + Class ③（rollback-orphan → named resource `already exists`）**。cross-stack export / 明示物理名の新規混入を PR 時点で検出（deployed-state 依存の in-use 削除ロックの残りは Layer 3 が担う）。Layer 1 と冗長化する IAM ASCII assertion は上位互換の fallback として保持 |
| **Layer 3: rehearsal（staging 実 deploy）** | prod 経路（CDK synth → ECR push → Lambda update → health）を統合 PR で実 AWS 貫通。ADR-0019 replacement gate（`scripts/check-cdk-replacement.mjs`）も staging diff に適用 | `.github/workflows/deploy-aws-staging.yml`（AWS staging 3 stack）/ `.github/workflows/deploy-nuc-staging.yml`（NUC staging） | **Class ②（export-in-use ロック等 deployed-state 依存の失敗）**。静的では原理的に catch 不能なため実 deploy でのみ露見する class を統合監査で捕捉 |

**役割分担の要点**: cfn-lint（Layer 1）は「AWS が受け付けない template」を汎用・自動で、assertion（Layer 2）は「本 project の不変条件」を、rehearsal（Layer 3）は「deployed-state 依存の失敗」を守る。3 層は補完関係で、上位ほど安価・高速・shift-left。

**ローカル実行**:

```bash
npm run check:cfn-lint                 # cdk synth --all → cfn-lint（要 pip install cfn-lint）
node scripts/check-cdk-cfn-lint.mjs --skip-synth   # 既存 cdk.out を再 synth せず lint のみ
CFN_LINT_BIN=<path> npm run check:cfn-lint          # Windows で Scripts が PATH 外の場合
```

cfn-lint は Python dev tool（`pip install "cfn-lint==1.53.0"`）。本番 bundle には含まれず、AWS 認証・ネット不要で offline 動作する。CI の `cdk-cfn-lint` job が pin 版を install する。`.cfnlintrc` の `ignore_checks`（W3005 等）は CDK 生成テンプレのノイズ抑制で false-positive をゼロにする（error = E ルールのみ hard-fail）。

## production env 必須配布 4 経路（#911 / #806）

新規 env 追加時は以下 4 経路すべてに配布。欠けると本番デプロイで起動失敗（#911 で 25 連続失敗の原因）:

| # | 配布先 | 仕組み | 追加箇所 |
|---|---|---|---|
| 1 | CI 通常 (`ci.yml`) | `env:` ダミー値 | `Run E2E tests` ステップ |
| 2 | CI deploy 前 (`deploy.yml` test) | `env:` ダミー値 | `E2E tests (local / cognito-dev mode)` ステップ |
| 3 | Lambda 本番 (`deploy.yml` deploy → CDK) | GitHub Secrets → CDK context → Lambda env | `CDK Deploy all stacks` の `-c` + `compute-stack.ts` `tryGetContext` + `environment` |
| 4 | NUC ローカル (`deploy-nuc.yml`) | GitHub Secrets → self-hosted runner → `.env` 生成 | `Generate .env from GitHub Secrets` ステップ + `gh secret set <NAME>` |

**注**: Epic #2525 Phase 7 PR-L5 (#2860) で license key 全廃に伴い `AWS_LICENSE_SECRET` (Lambda / NUC 同値必須だった HMAC 署名鍵) を撤去。現在 Lambda / NUC 同値必須の env はない。

### 必須 production env

| env | 用途 | 本番要否 |
|---|---|---|
| `PARENT_GATE_COOKIE_SECRET` | /admin/* PIN gate cookie 署名 (#2310 / ADR-0050 / #2337) | Lambda + NUC 必須、同値不要 |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe 課金 | Lambda 必須 / NUC 無効 |
| `GEMINI_API_KEY` | Gemini API | 任意。ただし **NUC は `AI_PROVIDER=gemini` 固定**のため、未設定だと AI 提案 (活動 / ごほうび / チェックリスト / 応援・レシート OCR) が全て無効になり、キーワード提案へ縮退する (#4330)。`deploy-nuc.yml` → `generate-env.ps1` が未設定時に `::warning::` を出す (deploy は続行) |
| `CRON_SECRET` | `/api/cron/*` 認証 (#820 / #1375) | OPS_SECRET_KEY と排他必須 |
| `OPS_SECRET_KEY` | CRON_SECRET 後方互換 (#1586) | 同上 |
| `ORIGIN_VERIFY_SECRET` | CloudFront → origin の front door header (`x-origin-verify`、#4280) | **Lambda 必須 / NUC には配布しない** |

生成: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` / Stripe Dashboard / aistudio.google.com

#### `ORIGIN_VERIFY_SECRET` を NUC に配布しない理由 (#4280)

`/admin` ・ `/api/v1/admin` ・ `/ops` は「CloudFront を通ってきたこと」を `x-origin-verify` header で要求する。**NUC セルフホストは CloudFront を持たず LAN 内で直接配信する**ため、NUC の `.env` にこの secret を入れると「front door が無いのに検査が有効」になり、保護者の見守り画面が全 404 になる。未設定 = 検査無効 (fail-open) が NUC の正しい状態である。

AWS 側の設定漏れは別レイヤで止める: `infra/bin/app.ts` の `resolveOriginVerifySecret()` が context 未指定の synth を throw し、`deploy.yml` / `deploy-aws-staging.yml` の `Validate required secrets` が GitHub Secret 未登録の deploy を止める (ADR-0024)。仕様と rotate 手順の SSOT は `docs/design/14-セキュリティ設計書.md` §11.5.1。

### 新規 env 追加時 PR チェックリスト

`.env.example` 追加 / `ci.yml` env 追加 / `deploy.yml` test job env 追加 / `deploy.yml` deploy job `-c` 追加 / `compute-stack.ts` `tryGetContext` + `environment` 追加 / `deploy-nuc.yml` env 追加 / 本ファイル env 表追記 / PR 本文の "PO action required" に `gh secret set XXX --body <value> --repo Takenori-Kusaka/ganbari-quest` 明記。

## AWS Cost Explorer API 使用制限

| 制約 | 値 |
|---|---|
| リクエスト上限 | 25 回/秒 (`ThrottlingException`) |
| API コスト | $0.01 / リクエスト（無料枠なし） |
| データ反映遅延 | 12-24 時間 |

定期取得は **1 日 1 回上限**、結果をキャッシュ/DB 保存。`/ops` リアルタイムクエリ禁止、CI/CD からの呼出は原則禁止。コスト監視は AWS Budgets アラート（無料）優先。

## Lambda Runtime ポリシー (#1828)

- メインアプリ: `DockerImageFunction` で `Dockerfile.lambda` が `FROM node:22-alpine` を pin
- インライン Lambda (auth/compute/ops/ses): CDK `lambda.Runtime.NODEJS_22_X` を SSOT 参照
- EOL 通知時は 4 stack の `lambda.Runtime.NODEJS_*_X` 一括置換 + Dockerfile を同 LTS

直近: 2026-05-01 (#1828) NODEJS_20_X → NODEJS_22_X (Node 20.x EOL 2026-04-30)。

## AWS Lambda 本番（ganbari-quest.com）

main push で GitHub Actions 自動実行 (`deploy.yml`)。フロー: test → Storage CDK → Docker build (ARM64) → ECR push → CDK deploy all → Lambda update。

**手動 Docker build / ECR push 禁止**（GHA 経由）。CDK の SSM パラメータ作成等は必要時のみ手動。確認: `gh run list` / `gh run watch`

## NUC ローカルサーバー（LAN 内）

- ssh `<NUC_USER>@<NUC_HOST>` / Docker `<NUC_APP_DIR>` (`C:\Docker\ganbari-quest`) / DB `<NUC_DB_PATH>` (SQLite WAL)
- 認証: 親管理画面のみ PIN、子供画面は LAN 内認証なし
- secret 配布: GitHub Secrets → self-hosted runner (NUC 常駐) → `.env` 自動生成

### Secret 配布フロー（PR #913 改訂後）

```bash
gh secret set PARENT_GATE_COOKIE_SECRET --body "<64桁hex>" --repo Takenori-Kusaka/ganbari-quest
# → 次回 deploy-nuc.yml 実行時に self-hosted runner が C:\Docker\ganbari-quest\.env を再生成
# → curl http://<NUC_HOST>:3000/api/health で 200 確認
```

GitHub Secrets 1 回登録で deploy.yml + deploy-nuc.yml 両方に配布される。Epic #2525 Phase 7 PR-L5 (#2860) で `AWS_LICENSE_SECRET` (Lambda / NUC 同値必須だった HMAC 鍵) は license key 全廃に伴い撤去済。

### NUC デプロイ順序（必須）

SQLite WAL 破損防止のため `stop → migrate → build → up` 順序必須（#0099 障害教訓）:

```bash
ssh <NUC_USER>@<NUC_HOST> "cd <NUC_APP_DIR> && docker compose stop app"  # graceful shutdown で WAL flush
ssh <NUC_USER>@<NUC_HOST> "cd <NUC_APP_DIR> && node scripts/add-xxx.cjs data/ganbari-quest.db"  # マイグレーション
ssh <NUC_USER>@<NUC_HOST> "cd <NUC_APP_DIR> && git pull && docker compose build && docker compose up -d"
ssh <NUC_USER>@<NUC_HOST> "curl -s http://localhost:3000/api/health"
```

### NUC Scheduler コンテナ (#1375 / ADR-0020)

cron ジョブは `profiles: scheduler` 有効化:

```bash
docker compose --profile scheduler up -d  # CRON_SECRET が .env に必要
docker compose logs -f scheduler
# 手動テスト: curl -X POST http://localhost:3000/api/cron/retention-cleanup -H "x-cron-secret: <CRON_SECRET>" -d '{"dryRun": true}'
```

`docker compose up -d` のみでは scheduler 起動しない。`--profile scheduler` 必須。app コンテナ起動後に起動。

### NUC Backup コンテナ (#2519 / #2985)

日次 DB バックアップ + restore 検証は `profiles: backup`。`scheduler` と同じく **`docker compose up -d` のみでは更新されない** — `--profile backup` を付けないと build / 再作成の対象外になり、古い crontab が凍結されて config drift する (#2985 で `deploy-nuc.yml` に `--profile backup` を追加して恒久対処)。MODULE_NOT_FOUND 等の障害切り分け・復旧手順は [docs/runbooks/nuc-container-recovery.md](../docs/runbooks/nuc-container-recovery.md)。

### NUC staging 系統 (#2872 / EPIC #2861 D 系)

統合 PR (develop→main) を本番取込前に検証する staging 系統。本番 NUC と**同一マシン上**に同居させつつ、別 working-dir / 別 port / 別 compose project / 別 DB path で完全隔離する (本番不変条件)。

| 項目 | 本番 NUC | NUC staging |
|---|---|---|
| workflow | `deploy-nuc.yml` | `deploy-nuc-staging.yml` |
| working-dir | `C:\Docker\ganbari-quest` | `C:\Docker\ganbari-quest-staging` |
| compose project | (既定) | `-p ganbari-quest-staging`（`docker-compose.yml` 無改変、CLI flag 隔離） |
| port | 3000 | 3100 (`.env` の `PORT=3100`) |
| trigger | main push / dispatch | 統合 PR (base=main) / dispatch (develop HEAD) |
| DB 起点 | 既存 `data/ganbari-quest.db` | 本番 DB の online snapshot (`scripts/snapshot-prod-db.cjs`、本番不在時 fixture fallback) |
| health | `localhost:3000/api/health` | `localhost:3100/api/health` (200 + `schema.schemaValid=true` assert) |

- **snapshot-forward 起動**: staging は本番 DB snapshot から起動し `applyLazyStartupMigrations` を貫通させる (過去状態からのマイグレーション込み実機起動の実機担保、#2872 AC6)。snapshot は本番 DB を read のみで取得 (本番 DB へ write しない)。
- **self-provisioning**: staging working-dir 未 provision でも workflow Step 0 が自動 clone する (NUC runner の global git credential 流用、物理 NUC 上の手作業不要)。health check は runner 自身からの `localhost:3100` のため Firewall 設定も不要 (LAN 越しにブラウザで見たい場合のみ任意で許可)。
- **当面 advisory**: required check 未登録。staging 初回緑を確認するまで develop→main 取込をブロックしない。merge blocker 化 (#2872 AC3) は初回緑確認後に audit-manager が main ruleset の `required_status_checks` へ `deploy-nuc-staging` を追加して行う。
- 検証手順 SSOT: [.claude/skills/deploy-verify/SKILL.md](../.claude/skills/deploy-verify/SKILL.md) / 構成詳細: [docs/design/13-AWSサーバレスアーキテクチャ設計書.md §4.2](../docs/design/13-AWSサーバレスアーキテクチャ設計書.md)。

### AWS staging 系統 (#2873 / EPIC #2861 D 系)

本番 deploy 経路 (CDK synth → ECR push → Lambda update → health) を統合 PR で貫通検証する AWS staging 系統。同一アカウント・同一リージョン (us-east-1) に物理名 prefix で分離する (本番 6 stack の stack 名・論理 ID・物理名は一切変えない)。

| 項目 | 本番 AWS | AWS staging |
|---|---|---|
| workflow | `deploy.yml` | `deploy-aws-staging.yml` |
| stack | 6 stack (`--all`) | 4 stack (`GanbariQuest{Storage,Auth,Compute,Network}Staging`、明示列挙) |
| 物理名 prefix | `ganbari-quest` | `ganbari-quest-staging` (Lambda `ganbari-quest-staging-app` / SSM `/ganbari-quest-staging/`) |
| ECR repo | `ganbari-quest` (maxImageCount:10) | `ganbari-quest-staging` 専用 (maxImageCount:3、prod repo 共有不採用) |
| 外部サービス | Stripe / Discord / Gemini / SES 注入 | 非注入 (副作用ゼロ。SES / CE の IAM grant も無し) |
| CDK gate | context 無し (staging stack は instantiate されない) | `-c stagingEnabled=true` (`infra/bin/app.ts` context gate) |
| trigger | main push | 統合 PR (base=main、paths filter) / dispatch (develop HEAD) |
| health | `<FunctionUrl>api/health` | `<StagingFunctionUrl>api/health` (200 のみ。schema assert の G-MIG 主担保は NUC staging) |
| 入口 (ORIGIN / smoke) | CloudFront | **CloudFront** (#4204)。Function URL 直では SvelteKit の名前付き form action (`?/action`) が通らずログインもサインアップもできないため |

- **実装方式**: 既存 stack class に optional `envConfig` props (`infra/lib/env-config.ts`、default = `PROD_ENV_CONFIG`)。prod 不変 guard は `tests/unit/infra/staging-cdk.test.ts`。
- **ADR-0019 gate**: `scripts/check-cdk-replacement.mjs` を staging diff にも適用 (StorageStaging / staging 3 stack の 2 段)。
- **当面 advisory**: 初回 deploy 緑実証後に audit-manager が main ruleset required へ `deploy-aws-staging` を追加。
- 構成詳細: [docs/design/13-AWSサーバレスアーキテクチャ設計書.md §4.3](../docs/design/13-AWSサーバレスアーキテクチャ設計書.md) / 検証手順 SSOT: [.claude/skills/deploy-verify/SKILL.md](../.claude/skills/deploy-verify/SKILL.md)。

## EventBridge Cron Rules (#1376)

定期ジョブは `EventBridge Rule → ganbari-quest-cron-dispatcher Lambda → HTTP POST → SvelteKit /api/cron/:job`。
(#2818 Phase 7 PR-L3: license key 全廃に伴い `license-expire` ジョブ + CronRuleLicenseExpire を撤去済)

- スケジュール SSOT: `src/lib/server/cron/schedule-registry.ts`
- CDK: `infra/lib/compute-stack.ts` (CRON_JOBS は SSOT 参照)
- Lambda 実装: `infra/lambda/cron-dispatcher/index.ts`

```bash
aws events list-rules --name-prefix ganbari-quest-cron --region us-east-1
aws logs tail /aws/lambda/ganbari-quest-cron-dispatcher --region us-east-1 --follow
aws lambda invoke --function-name ganbari-quest-cron-dispatcher --payload '{"cronJob":"retention-cleanup","dryRun":true}' --cli-binary-format raw-in-base64-out --region us-east-1 response.json
```

### Secret 注入 (#1586)

cron-dispatcher は **CRON_SECRET** または **OPS_SECRET_KEY** 最低 1 本必須。CDK 両方注入、Lambda 側は `CRON_SECRET ?? OPS_SECRET_KEY` fallback。両方未登録なら CDK synth が throw（ADR-0006 silent fail 防止）。

現状: `OPS_SECRET_KEY` のみ登録。CRON_SECRET 分離時は `gh secret set CRON_SECRET --body "$(node -e 'console.log(require(\"crypto\").randomBytes(32).toString(\"hex\"))')"`

### Post-deploy smoke test (#1586)

`deploy.yml` の `Cron dispatcher smoke test` step が deploy 後 dryRun invoke。`{"statusCode":200,"dryRun":true}` を返さないと deploy 失敗扱い。

### CloudWatch Alarm

`ganbari-quest-cron-dispatcher-errors` (`ops-stack.ts` L237-249) が dispatcher Lambda Errors metric 監視。5 分内 1 回以上で SNS topic `ganbari-quest-ops-alerts` 通知。

### 自動リトライは全 cron で無効 (#4327)

EventBridge target は `retryAttempts: 0`。cron は 30 秒 self-limiting + 翌日持ち越し前提で設計されているため、途中まで進んだ job の自動再送は非冪等な再走 (部分削除されたテナントに purge が再走する等) を生む。取りこぼしは翌日の実行が回収し、失敗は上記 alarm で観測される。**新規 job を足すときも target に retry を復活させない**。

### 顧客データ物理削除 (grace-period-deletion) の緊急停止 (#4327)

**不可逆な処理**であり、止める手段を 2 層持つ。手順・観測・復旧の限界の SSOT は
[docs/runbooks/grace-period-deletion-operations.md](../docs/runbooks/grace-period-deletion-operations.md)。

```bash
# 層 1: cron を呼ばせない (即時。ただし次回 deploy で ENABLED に戻る)
aws events disable-rule --name ganbari-quest-cron-grace-period-deletion --region us-east-1

# 層 2: 呼ばれても消させない (手動 POST も止まる。deploy でも戻らない)
gh variable set GRACE_PERIOD_DELETION_DISABLED --body true --repo Takenori-Kusaka/ganbari-quest
```

**注意**: `cdk deploy` は PO が実行する（GHA `deploy.yml` または手動 `cdk deploy --all`）。

## CDK Replacement gate の既知良性パターン (ADR-0019 運用)

- `ErrorPagesDeploy/AwsCliLayer` の `may-cause-replacement` は aws-cdk-lib の version bump で BucketDeployment 補助 layer (deploy 時ツーリング) が再生成されるもの。**ユーザー向けリソースの置換ではなく良性** — 検出時は **branch の commit message (body) に** `replacement-approved: <ID>` を記載して承認する (squash message は commit message 由来 — PR body は乗らない) (初出: aws-cdk-lib 2.257→2.258、#2963)。

## 明示物理名は auto-naming が既定 (rollback-orphan 予防、#3881)

明示物理名 (`roleName` / `bucketName` / `functionName` / `backupVaultName` 等) を持つリソースは、create 失敗 → stack rollback の際に削除できず **orphan 化** し、次 deploy が **`already exists`** (名前衝突) で block される (第16回リリースで `DsqlBackupVault` = `ganbari-quest-dsql-vault` が実際に orphan 化し手動削除を要した、#3870 / #3872 / #3881)。これは AWS CloudFormation の設計上の既知挙動で、明示物理名を残す限り任意の create 失敗要因 (quota / IAM 結果整合性 / service エラー / dependency 失敗) で再発する。

**AWS 公式一次情報 (SSOT)**:

- rollback は作成物を削除するが、削除できないリソースは orphan 化する ("Resource removed from stack but not deleted"): <https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/troubleshooting.html>
- 物理名は "unique across all your active stacks"。名前衝突は deploy 失敗。**AWS 推奨回避 = 物理名を明示せず CloudFormation auto-naming に委ねる** ("CloudFormation generates a unique physical ID"): <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-name.html>
- BackupVault は recovery point があると削除自体が失敗し特に固着する: <https://docs.aws.amazon.com/aws-backup/latest/devguide/deleting-backups.html> / <https://github.com/aws/aws-cdk/issues/33711>

**運用ルール**:

- **新規リソースは物理名 prop を省略する** (CFN auto-naming = ランダム suffix 付き生成名。rollback-orphan が残っても次 deploy と衝突しない)。
- 明示名が本当に必要な場合 (外部から固定名で参照される契約 / SSM path 規約等) のみ、stack 側に justification コメントを書き、`tests/unit/infra/physical-name-ratchet.test.ts` の `NAMED_RESOURCE_ALLOWLIST` に reason 付き entry を追加する (allowlist 外の明示物理名は CI fail、#3874 Layer 2)。
- **既存の RETAIN stateful named (vault / UserPool / S3 / ECR / backup-role) は rename しない** (rename = replacement = データ喪失。ADR-0019 gate 対象)。allowlist は一方通行で減らす (リソース撤去時に entry 削除)。
- orphan 化して deploy が block された場合の掃除手順: [docs/runbooks/rollback-orphan-cleanup.md](../docs/runbooks/rollback-orphan-cleanup.md)。`deploy.yml` の「Orphan-block detection」step が `already exists` 検知時に本 runbook link を fail message に出力する。

## IAM Role description は ASCII/Latin-1 のみ (AWS 制約、#3870)

`iam.Role` / `iam.ManagedPolicy` の `description` は AWS IAM 制約により **ASCII / Latin-1 (U+00FF 以下) のみ許容**。日本語 (U+3000 以上) を入れると deploy 時に `InvalidRequest` → `CREATE_FAILED` → **stack rollback** になる (第16回リリースで `DsqlBackupRole` の日本語 description が本番 deploy を rollback させた回帰、staging は backup role 非生成のためすり抜けた)。

- **IAM Role / ManagedPolicy の `description` は英語 ASCII で書く**。日本語で説明したい背景はコード直上の `// コメント` に書く (コメントは synth 対象外なので日本語可)。
- **`CfnOutput` / CloudWatch `Alarm` (AlarmDescription) / SSM Parameter の `description` は ASCII 制約が無い** ため日本語のままで良い (過剰に ASCII 化しない)。
- **fitness guard**: `tests/unit/infra/iam-role-description-ascii.test.ts` が全 stack を synth し、全 `AWS::IAM::Role` / `AWS::IAM::ManagedPolicy` の `Description` が `^[\t\n\r\x20-\x7E\xA1-\xFF]*$` にマッチすることを CI で assert する。新 stack を追加したら同 test の対象本数を増やす。
