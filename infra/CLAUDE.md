# infra/ — デプロイ手順

## production 環境変数チェックリスト（#911, #806）

production に新しい env を追加した場合は以下 **4 経路すべて** に配布すること。
いずれかが欠けると「CI は通るが本番デプロイで起動失敗」の典型パターンに陥る（#911 で 25 連続失敗の原因）。

| # | 配布先 | 仕組み | 追加方法 |
|---|-------|-------|---------|
| 1 | CI 通常 (`ci.yml` e2e-test) | `env:` ブロック直書き（ダミー値） | `.github/workflows/ci.yml` の `Run E2E tests` ステップに env 追加 |
| 2 | CI デプロイ前 (`deploy.yml` test job) | `env:` ブロック直書き（ダミー値） | `.github/workflows/deploy.yml` の `E2E tests (local / cognito-dev mode)` ステップに env 追加 |
| 3 | AWS Lambda 本番 (`deploy.yml` deploy job → CDK) | GitHub Secrets → CDK context → Lambda environment | `.github/workflows/deploy.yml` の `CDK Deploy all stacks` に `-c xxxKey=${{ secrets.XXX }}` 追加 + `infra/lib/compute-stack.ts` で `tryGetContext('xxxKey')` と `environment` に投入 |
| 4 | NUC ローカル本番 (`deploy-nuc.yml`) | NUC マシン `C:\Docker\ganbari-quest\.env.production` に手動配置 → 起動時に `.env` へコピー | 人間が RDP / SSH で NUC にログインして `.env.production` を編集。自動化しない（secret を GitHub 経由で配らない設計） |

### 現時点の必須 production env 一覧

| env | 用途 | #1 ci.yml | #2 deploy.yml test | #3 Lambda (CDK) | #4 NUC `.env.production` | 生成方法 |
|-----|-----|:---:|:---:|:---:|:---:|------|
| `AWS_LICENSE_SECRET` | ライセンスキー HMAC 署名（#806, ADR-0026） | ダミー OK | ダミー OK | **本番値必須** | **本番値必須** | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `STRIPE_SECRET_KEY` | Stripe 課金 | 未設定可 | 未設定可 | 本番値必須 | （NUC は Stripe 無効） | Stripe Dashboard |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook 検証 | 未設定可 | 未設定可 | 本番値必須 | （NUC は Stripe 無効） | Stripe Dashboard |
| `GEMINI_API_KEY` | Gemini API (任意) | 未設定可 | 未設定可 | 任意 | 任意 | https://aistudio.google.com/ |

> **重要**: #3 と #4 は **同一値** を使うこと（両環境で署名したライセンスキーが相互に検証できるように）。別値を使うと NUC で発行したキーが Lambda 本番で検証失敗する。

### 新規 env 追加時の PR チェックリスト

- [ ] `.env.example` に placeholder とコメントを追加
- [ ] `.github/workflows/ci.yml` に env 追加（ダミー値で可）
- [ ] `.github/workflows/deploy.yml` の test job に env 追加（ダミー値で可）
- [ ] `.github/workflows/deploy.yml` の deploy job の CDK deploy に `-c` 追加
- [ ] `infra/lib/compute-stack.ts` (or 該当スタック) に `tryGetContext` + Lambda `environment` 追加
- [ ] `.github/workflows/deploy-nuc.yml` で `.env.production` に必須項目が含まれることを確認するステップを追加
- [ ] 本ファイル（`infra/CLAUDE.md`）の env 一覧表に追記
- [ ] PR 本文の "PO action required" セクションで手動配布タスクを明示（GitHub Secrets 作成 / SSM 投入 / NUC `.env.production` 配置）

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
- **secret 配置**: `C:\Docker\ganbari-quest\.env.production`（git 管理外・runner マシン常駐）

### `.env.production` 配置手順（初回セットアップ・secret 追加時）

NUC の secret は **GitHub Actions / AWS 経由で配らない**。NUC は LAN 内限定で外部露出しないため、
自動配布系統を持たない方が攻撃面が小さい。以下の手順で人間が手動配置する。

1. RDP または SSH で NUC にログイン
2. `C:\Docker\ganbari-quest\.env.production` を編集（存在しなければ新規作成）
3. 以下の形式で追記:
   ```
   AWS_LICENSE_SECRET=<Lambda 本番と同一の 64 文字 hex>
   # (将来追加する必須 env もここに書く)
   ```
4. ファイル権限を適切に設定（管理者と runner サービスアカウントのみ read 可）
5. `deploy-nuc.yml` を手動トリガー（`gh workflow run deploy-nuc.yml`）してデプロイ検証
6. `curl http://<NUC_HOST>:3000/api/health` が 200 を返すことを確認

> **重要**: `AWS_LICENSE_SECRET` は Lambda 本番と**同じ値**を使うこと。NUC と Lambda のどちらで
> 発行したライセンスキーも相互に検証できる必要がある（ADR-0026 §G2）。
> 別値を使うと NUC 経由で発行したキーが Lambda 本番で署名検証失敗する。

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
