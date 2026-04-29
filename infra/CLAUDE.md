# infra/ — デプロイ手順

## AWS リソース別 region 一覧（SSOT — #1606 / #1649）

本プロジェクトの本番 AWS リソースは **すべて `us-east-1` (米国バージニア北部)** に配置されている。
過去のドキュメント（設計書 25・runbook 等）に `ap-northeast-1` の記述が残っていたが、これは
誤記であり、実態は CDK ソースコード (`infra/bin/app.ts` L13-16) で `region: 'us-east-1'` 固定。
すべての stack (`Storage` / `Auth` / `Compute` / `Network` / `Ops` / `Ses`) が同一 env で deploy される。

| リソース | 種別 | region | 実装箇所 / 確認コマンド |
|---------|------|--------|---------------------|
| Lambda (アプリ本体) | `ganbari-quest-app` | `us-east-1` | `infra/lib/compute-stack.ts` / `.github/workflows/deploy.yml` L31 `AWS_REGION: us-east-1` |
| Lambda (cron-dispatcher) | `ganbari-quest-cron-dispatcher` | `us-east-1` | `infra/lib/compute-stack.ts` L233 (CronDispatcherFn) |
| Lambda (Cognito custom message) | `ganbari-quest-cognito-custom-message` | `us-east-1` | `infra/lib/auth-stack.ts` L101 |
| Lambda (SES receive) | `ganbari-quest-ses-*` | `us-east-1` | `infra/lib/ses-stack.ts` |
| ECR Repository | `ganbari-quest` | `us-east-1` | `infra/lib/storage-stack.ts` L87 (`ecr.Repository(this, 'AppRepo')`) |
| DynamoDB Table | `ganbari-quest` | `us-east-1` | `infra/lib/storage-stack.ts` |
| S3 Bucket (assets) | `ganbari-quest-assets-*` | `us-east-1` | `infra/lib/storage-stack.ts` |
| Cognito User Pool | `ganbari-quest-users-v2` | `us-east-1` | `infra/lib/auth-stack.ts` L43 (UserPoolV2) |
| Cognito Domain | `auth.ganbari-quest.com` | `us-east-1` | `infra/lib/auth-stack.ts` L128-132（ACM cert は us-east-1 必須） |
| EventBridge Rules (cron) | `ganbari-quest-cron-*` | `us-east-1` | `infra/lib/compute-stack.ts` L264 |
| CloudWatch Log Groups | `/aws/lambda/ganbari-quest-*` | `us-east-1` | 全 Lambda が同一 region のため自動的に us-east-1 |
| CloudFront Distribution | (Edge グローバル) | グローバル / `us-east-1` 制御 | `infra/lib/network-stack.ts`。geoRestriction('JP') 設定あり |
| Route 53 | `ganbari-quest.com` | グローバル | `infra/lib/network-stack.ts` |
| ACM Certificate (auth) | `auth.ganbari-quest.com` | `us-east-1` | Cognito custom domain は us-east-1 ACM が必須 (`auth-stack.ts` L128) |
| SES (送信 / 受信) | `noreply@ganbari-quest.com` | `us-east-1` | `auth-stack.ts` L54 `sesRegion: 'us-east-1'`, `ses-stack.ts` L82 `inbound-smtp.us-east-1.amazonaws.com` |
| SSM Parameters | `/ganbari-quest/*` | `us-east-1` | 各 stack から SSM 参照（同一 region） |
| Secrets Manager (license) | `/ganbari-quest/license/secret` | `us-east-1` | `docs/operations/license-key-secrets.md` |

### legitimate な ap-northeast-1 言及（変更不要）

以下は実態と無関係な「テスト fixture / 架空例」のため `ap-northeast-1` 記述は維持する:

- `tests/unit/e2e-helpers/cognito-admin-client.test.ts` — production guard のテストで使用する架空 Pool ID 例
- `tests/unit/e2e-helpers.test.ts` — execute-api host 検証の URL 例

新たに region 名を文書に書く場合は本表を SSOT として `us-east-1` を使用すること。
関連 Issue: #1606（LP / 文書間整合）/ #1649（ECR / EventBridge / Cognito 第二次棚卸 — 本表で解消）。

---

## production 環境変数チェックリスト（#911, #806）

production に新しい env を追加した場合は以下 **4 経路すべて** に配布すること。
いずれかが欠けると「CI は通るが本番デプロイで起動失敗」の典型パターンに陥る（#911 で 25 連続失敗の原因）。

| # | 配布先 | 仕組み | 追加方法 |
|---|-------|-------|---------|
| 1 | CI 通常 (`ci.yml` e2e-test) | `env:` ブロック直書き（ダミー値） | `.github/workflows/ci.yml` の `Run E2E tests` ステップに env 追加 |
| 2 | CI デプロイ前 (`deploy.yml` test job) | `env:` ブロック直書き（ダミー値） | `.github/workflows/deploy.yml` の `E2E tests (local / cognito-dev mode)` ステップに env 追加 |
| 3 | AWS Lambda 本番 (`deploy.yml` deploy job → CDK) | GitHub Secrets → CDK context → Lambda environment | `.github/workflows/deploy.yml` の `CDK Deploy all stacks` に `-c xxxKey=${{ secrets.XXX }}` 追加 + `infra/lib/compute-stack.ts` で `tryGetContext('xxxKey')` と `environment` に投入 |
| 4 | NUC ローカル本番 (`deploy-nuc.yml`) | GitHub Secrets → self-hosted runner が `.env` を生成 → docker compose `env_file` で読込 | `.github/workflows/deploy-nuc.yml` の `Generate .env from GitHub Secrets` ステップに env 追加 + `gh secret set <NAME> --body <value> --repo Takenori-Kusaka/ganbari-quest` で値登録 |

### 現時点の必須 production env 一覧

| env | 用途 | #1 ci.yml | #2 deploy.yml test | #3 Lambda (CDK) | #4 NUC (GHA Secrets) | 生成方法 |
|-----|-----|:---:|:---:|:---:|:---:|------|
| `AWS_LICENSE_SECRET` | ライセンスキー HMAC 署名（#806, ADR-0026（archive）） | ダミー OK | ダミー OK | **本番値必須** | **本番値必須** | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `STRIPE_SECRET_KEY` | Stripe 課金 | 未設定可 | 未設定可 | 本番値必須 | （NUC は Stripe 無効） | Stripe Dashboard |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook 検証 | 未設定可 | 未設定可 | 本番値必須 | （NUC は Stripe 無効） | Stripe Dashboard |
| `GEMINI_API_KEY` | Gemini API (任意) | 未設定可 | 未設定可 | 任意 | 任意 | https://aistudio.google.com/ |
| `CRON_SECRET` | `/api/cron/*` 認証トークン（#820 / ADR-0033（archive） / #1375 NUC scheduler） | 未設定可 | 未設定可 | OPS_SECRET_KEY と排他で必須 | **本番値必須**（scheduler コンテナで使用） | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `OPS_SECRET_KEY` | `CRON_SECRET` 後方互換フォールバック（ADR-0033（archive）、PR-D-2 で削除予定）。**#1586: cron-dispatcher Lambda が `CRON_SECRET ?? OPS_SECRET_KEY` で参照するため、`CRON_SECRET` 未登録なら必須** | 未設定可 | 未設定可 | CRON_SECRET と排他で必須 | （NUC は無効） | 既存値を維持 |

> **重要**: #3 と #4 は **同一値** を使うこと（両環境で署名したライセンスキーが相互に検証できるように）。GitHub Secrets に登録した同一値が、CDK context 経由で Lambda env に注入されると同時に、self-hosted runner 経由で NUC の `.env` にも書き出される。

### 新規 env 追加時の PR チェックリスト

- [ ] `.env.example` に placeholder とコメントを追加
- [ ] `.github/workflows/ci.yml` に env 追加（ダミー値で可）
- [ ] `.github/workflows/deploy.yml` の test job に env 追加（ダミー値で可）
- [ ] `.github/workflows/deploy.yml` の deploy job の CDK deploy に `-c` 追加
- [ ] `infra/lib/compute-stack.ts` (or 該当スタック) に `tryGetContext` + Lambda `environment` 追加
- [ ] `.github/workflows/deploy-nuc.yml` の `Generate .env from GitHub Secrets` ステップに env を追加（`env:` ブロックで `${{ secrets.XXX }}` を渡し、PowerShell の Set-Content 配列に `"XXX=$env:XXX"` を追加）
- [ ] 本ファイル（`infra/CLAUDE.md`）の env 一覧表に追記
- [ ] PR 本文の "PO action required" セクションで `gh secret set XXX --body <value> --repo Takenori-Kusaka/ganbari-quest` を明記（GitHub Secrets 1 回登録するだけで Lambda + NUC 両方に配布される）

## AWS Cost Explorer API 使用制限

Cost Explorer API (`ce:GetCostAndUsage` 等) には以下の制約がある。
自動化スクリプトや /ops ダッシュボードから呼び出す際は注意すること。

| 制約 | 値 | 補足 |
|------|---|------|
| リクエスト数上限 | 25 回/秒（アカウント単位） | スロットリング (`ThrottlingException`) |
| API コスト | **$0.01 / リクエスト** | 無料枠なし。月 100 回で $1、1000 回で $10 |
| データ反映遅延 | 12〜24 時間 | 当日分は翌日まで取得不可 |

### 運用ガイドライン

- **定期取得は 1 日 1 回を上限** とし、結果をキャッシュ/DB に保存して再利用する
- `/ops` ダッシュボードからのリアルタイムクエリは避け、バッチ取得済みデータを表示する
- CI/CD パイプラインからの CE API 呼び出しは原則禁止（コスト肥大化リスク）
- コスト監視は **AWS Budgets アラート** (無料) を優先し、CE API は月次レポート等に限定する

## AWS Lambda 本番（ganbari-quest.com）

- **自動デプロイ**: main ブランチへの push で GitHub Actions が自動実行
- ワークフロー: `.github/workflows/deploy.yml`
- フロー: test → Storage CDK → Docker build (ARM64) → ECR push → CDK deploy all → Lambda update
- 手動で Docker build/ECR push をしないこと（GitHub Actions が行う）
- CDK infra の手動デプロイ（SSM パラメータ作成等）は必要に応じて実行
- デプロイ状況確認: `gh run list` / `gh run watch`

## NUC ローカルサーバー（LAN 内）

- 対象: NUC サーバー (Windows) `ssh <NUC_USER>@<NUC_HOST>`
- Docker: `<NUC_APP_DIR>` (= `C:\Docker\ganbari-quest`)
- DB: `<NUC_DB_PATH>`（SQLite WAL モード）
- 認証: 親の管理画面のみ PIN コード、子供画面は認証なし（LAN 内限定）
- **secret 配布**: GitHub Actions Secrets → self-hosted runner (NUC 上に常駐) → 起動時に `.env` を自動生成

### Secret 配布フロー（GHA 経由 — PR #913 改訂後）

NUC の secret は **GitHub Actions Secrets から self-hosted runner 経由で自動配布**される。
runner は NUC 本番マシン上に常駐しているため、`runner プロセス → ファイル` の経路は
`SSM/RDP 手動配置` と同等のセキュリティ境界を持つ（runner マシンそのものが信頼境界）。

1. **登録**（初回 / rotation）:
   ```bash
   # 開発者の手元から GitHub Secrets に登録するだけでよい
   gh secret set AWS_LICENSE_SECRET --body "<64桁hex>" --repo Takenori-Kusaka/ganbari-quest
   ```
2. **自動配布**: 次回の `deploy-nuc.yml` 実行時（main push or `gh workflow run deploy-nuc.yml`）に、
   self-hosted runner の `Generate .env from GitHub Secrets` ステップが `C:\Docker\ganbari-quest\.env` を
   GitHub Secrets から再生成する（冪等・rotate 対応）
3. **検証**: `curl http://<NUC_HOST>:3000/api/health` が 200 を返すことを確認

> **重要**: `AWS_LICENSE_SECRET` は Lambda 本番と**同じ値**を使うこと（ADR-0026（archive） §G2）。
> GitHub Secrets に 1 つ登録するだけで、deploy.yml が CDK context 経由で Lambda env に、
> deploy-nuc.yml が `.env` 経由で NUC コンテナに、それぞれ同一値を注入する。
> 別値を使うと NUC 経由で発行したライセンスキーが Lambda 本番で署名検証失敗する。

> **過去の設計（PR #913 初版・撤回済み）**: かつて NUC は `.env.production` を NUC マシン上に
> 手動配置する設計だった（GHA に secret を通さない＝攻撃面最小化が動機）。しかし
> self-hosted runner が同じ NUC 上にある時点でこの分離は形式論で、運用負債だけが残った
> （#911 で 25 連続失敗した際、復旧に物理アクセスが必須となった）。現在は GHA 経由の
> 自動配布に統一している。

SQLite WAL破損防止のため、**必ず stop → migrate → build → up の順序**で実施すること。
`docker compose up -d` だけで済ませると、コンテナ再作成時に WAL 不整合で DB 破損するリスクがある（#0099 障害）。

```bash
# 1. コンテナを安全に停止（graceful shutdown で WAL flush）
ssh <NUC_USER>@<NUC_HOST> "cd <NUC_APP_DIR> && docker compose stop app"

# 2. DB マイグレーションがある場合はここで実行（コンテナ停止中＝競合なし）
ssh <NUC_USER>@<NUC_HOST> "cd <NUC_APP_DIR> && node scripts/add-xxx.cjs data/ganbari-quest.db"

# 3. pull → ビルド → 起動
ssh <NUC_USER>@<NUC_HOST> "cd <NUC_APP_DIR> && git pull && docker compose build && docker compose up -d"

# 4. 動作確認
ssh <NUC_USER>@<NUC_HOST> "curl -s http://localhost:3000/api/health"
```

### NUC Scheduler コンテナ起動手順（#1375 — ADR-0020）

cron ジョブ（license-expire / retention-cleanup / trial-notifications）を NUC で実行するには
`profiles: scheduler` を有効化して起動する。

```bash
# 前提: CRON_SECRET が .env に設定されていること
# （deploy-nuc.yml の Generate .env ステップで自動設定される）

# scheduler コンテナを含めて起動
docker compose --profile scheduler up -d

# scheduler ログ確認
docker compose logs -f scheduler

# 手動で特定 cron ジョブをテスト実行（dryRun: true）
curl -s -X POST http://localhost:3000/api/cron/retention-cleanup \
  -H "x-cron-secret: <CRON_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}'
```

**注意**:
- `docker compose up -d` のみ（profiles なし）では scheduler は起動しない。`--profile scheduler` が必須
- Sub A-3 (#1377) の実装前は、`deploy-nuc.yml` への `--profile scheduler` 組込は行わない（手動有効化）
- scheduler コンテナは `app` コンテナに依存（`depends_on: app`）。app が起動していること確認後に起動すること

## EventBridge Cron Rules (#1376)

3 つの定期実行ジョブは EventBridge → `ganbari-quest-cron-dispatcher` Lambda 経由で実行される。
アーキテクチャ: `EventBridge Rule → CronDispatcherFn → HTTP POST → SvelteKit /api/cron/:job`

Lambda Web Adapter (LWA) は HTTP イベントのみ処理するため、ディスパッチャー Lambda が
EventBridge ペイロードを HTTP 呼び出しに変換する設計。

スケジュール SSOT: `src/lib/server/cron/schedule-registry.ts`
CDK 実装: `infra/lib/compute-stack.ts` (CRON_JOBS インライン定義はそこの SSOT 参照)
Lambda 実装: `infra/lambda/cron-dispatcher/index.ts`

```bash
# ルール一覧確認
aws events list-rules --name-prefix ganbari-quest-cron --region us-east-1

# ディスパッチャー Lambda ログ確認
aws logs tail /aws/lambda/ganbari-quest-cron-dispatcher --region us-east-1 --follow

# 手動テスト（本番: dryRun なし — 実ジョブ実行）
aws lambda invoke \
  --function-name ganbari-quest-cron-dispatcher \
  --payload '{"cronJob":"license-expire"}' \
  --cli-binary-format raw-in-base64-out \
  --region us-east-1 \
  response.json && cat response.json

# 手動テスト（dryRun mode — env 注入確認のみ、副作用なし、#1586）
aws lambda invoke \
  --function-name ganbari-quest-cron-dispatcher \
  --payload '{"cronJob":"license-expire","dryRun":true}' \
  --cli-binary-format raw-in-base64-out \
  --region us-east-1 \
  response.json && cat response.json
# 期待結果: {"statusCode":200,"jobName":"license-expire","dryRun":true}
```

### Secret 注入 (#1586 修復後)

cron-dispatcher Lambda は **CRON_SECRET** または **OPS_SECRET_KEY** のいずれか最低 1 本が
必要。CDK (compute-stack.ts) が env 両方を注入し、Lambda 側 (cron-dispatcher/index.ts) は
`CRON_SECRET ?? OPS_SECRET_KEY` の順で fallback する。

- **現状の本番 GitHub Secrets**: `OPS_SECRET_KEY` のみ登録 (`CRON_SECRET` は未登録)
- どちらも未登録の場合、CDK synth が `[ComputeStack] cron-dispatcher requires cronSecret or opsSecretKey context` で throw し deploy をブロックする (silent fail 防止 — ADR-0006)
- 将来的に `CRON_SECRET` を分離する場合は `gh secret set CRON_SECRET --body "$(node -e 'console.log(require(\"crypto\").randomBytes(32).toString(\"hex\"))')"` で登録

### Post-deploy smoke test (#1586)

`deploy.yml` の `Cron dispatcher smoke test` step が deploy 後に dryRun invoke を実行し、
env 注入の正常性を検証する。`{"statusCode":200,"dryRun":true}` を返さないと deploy 失敗扱い。

### CloudWatch Alarm

`ganbari-quest-cron-dispatcher-errors` (`infra/lib/ops-stack.ts` L237-249) が
dispatcher Lambda の Errors metric を監視する。5 分間に 1 回以上のエラーで既存 SNS
topic `ganbari-quest-ops-alerts` に通知。

**注意**: `cdk deploy` は PO が実行する（GitHub Actions `deploy.yml` または手動 `cdk deploy --all`）。
