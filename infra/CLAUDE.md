# infra/ — デプロイ手順

## AWS Lambda 本番（ganbari-quest.com）

- **自動デプロイ**: main ブランチへの push で GitHub Actions が自動実行
- ワークフロー: `.github/workflows/deploy.yml`
- フロー: test → Storage CDK → Docker build (ARM64) → ECR push → CDK deploy all → Lambda update
- 手動で Docker build/ECR push をしないこと（GitHub Actions が行う）
- CDK infra の手動デプロイ（SSM パラメータ作成等）は必要に応じて実行
- デプロイ状況確認: `gh run list` / `gh run watch`

## NUC ローカルサーバー（LAN 内）

- 対象: NUC サーバー (Windows) `ssh <NUC_USER>@<NUC_HOST>`
- Docker: `<NUC_APP_DIR>`
- DB: `<NUC_DB_PATH>`（SQLite WAL モード）
- 認証: 親の管理画面のみ PIN コード、子供画面は認証なし（LAN 内限定）

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
