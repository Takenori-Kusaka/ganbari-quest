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

主要リソース: Lambda (アプリ / cron-dispatcher / cognito custom message / SES) / ECR / DynamoDB / S3 / Cognito User Pool v2 (`auth.ganbari-quest.com`) / EventBridge cron rules / CloudWatch Logs / Route 53 (`ganbari-quest.com`) / SES (`noreply@ganbari-quest.com`) / SSM / Secrets Manager。詳細は `infra/lib/*-stack.ts` 参照。

CloudFront はグローバル（geoRestriction `JP`）。新規 region 言及は本ファイルを SSOT として `us-east-1`。`tests/unit/e2e-helpers/*` の `ap-northeast-1` 言及はテスト fixture（変更不要）。

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
| `GEMINI_API_KEY` | Gemini API | 任意 |
| `CRON_SECRET` | `/api/cron/*` 認証 (#820 / #1375) | OPS_SECRET_KEY と排他必須 |
| `OPS_SECRET_KEY` | CRON_SECRET 後方互換 (#1586) | 同上 |

生成: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` / Stripe Dashboard / aistudio.google.com

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
- **当面 advisory**: required check 未登録。staging working-dir 未 provision 時に develop→main 取込をブロックしない。物理 provision (staging dir / port 3100 / ruleset) は PO 手作業。
- 検証手順 SSOT: [.claude/skills/deploy-verify/SKILL.md](../.claude/skills/deploy-verify/SKILL.md) / 構成詳細: [docs/design/13-AWSサーバレスアーキテクチャ設計書.md §4.2](../docs/design/13-AWSサーバレスアーキテクチャ設計書.md)。

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

**注意**: `cdk deploy` は PO が実行する（GHA `deploy.yml` または手動 `cdk deploy --all`）。

## CDK Replacement gate の既知良性パターン (ADR-0019 運用)

- `ErrorPagesDeploy/AwsCliLayer` の `may-cause-replacement` は aws-cdk-lib の version bump で BucketDeployment 補助 layer (deploy 時ツーリング) が再生成されるもの。**ユーザー向けリソースの置換ではなく良性** — 検出時は **branch の commit message (body) に** `replacement-approved: <ID>` を記載して承認する (squash message は commit message 由来 — PR body は乗らない) (初出: aws-cdk-lib 2.257→2.258、#2963)。
