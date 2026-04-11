# infra/ — デプロイ手順

## production 環境変数チェックリスト（必須 — #911 / ADR-0026）

新しい環境必須シークレットを追加した場合は、**必ず以下の 4 経路すべてに配布する**こと。
1 経路でも欠けると本番デプロイが完全停止する（#911 で 25 連続失敗の前例あり）。

| 経路 | 配布先 | 配布方法 | 担当 |
|---|---|---|---|
| ① test 用（GitHub Actions） | `deploy.yml` test job の `npx playwright test` env | `${{ secrets.NAME }}` を `env:` で渡す | dev |
| ② AWS Lambda（GitHub Actions 経由） | `compute-stack.ts` の Lambda environment | `deploy.yml` で `-c name=${{ secrets.NAME }}` → CDK context → environment | dev |
| ③ NUC 自宅サーバー（self-hosted runner） | `C:\Docker\ganbari-quest\.env` | `deploy-nuc.yml` の `Inject ... into .env` step で書き込み | dev |
| ④ 開発者ローカル | `.env.local` | `.env.example` に追記し、各開発者が個別配置 | dev |

### 必須シークレット一覧

| 環境変数名 | 用途 | 生成方法 | GitHub Secret 名 |
|---|---|---|---|
| `AWS_LICENSE_SECRET` | ライセンスキー HMAC 署名（#806, ADR-0026） | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | `AWS_LICENSE_SECRET` |
| `STRIPE_SECRET_KEY` | Stripe 決済 | Stripe ダッシュボード | `STRIPE_SECRET_KEY` |
| `STRIPE_WEBHOOK_SECRET` | Stripe Webhook 検証 | Stripe ダッシュボード | `STRIPE_WEBHOOK_SECRET` |
| `OPS_SECRET_KEY` | /ops ダッシュボード認証 | 任意のランダム値 | `OPS_SECRET_KEY` |
| `GEMINI_API_KEY` | Gemini API（リリースノート生成等） | Google AI Studio | `GEMINI_API_KEY` |

新しいシークレットを追加するときの手順:
1. **GitHub Secrets** に登録 (`gh secret set NAME`)
2. **`.env.example`** に追記してチームに周知
3. **`deploy.yml`** の test job env に追加 + `deploy.yml` の CDK deploy step に `-c` で渡す
4. **`infra/lib/compute-stack.ts`** で `tryGetContext` から読み Lambda environment に追加
5. **`deploy-nuc.yml`** の `Inject ... into .env` step に追加（NUC 用）
6. **本表に追記** し、PR description でチェック

> **PR マージ前チェック**: 「上記 5 ステップが揃っているか」を `.github/CLAUDE.md` の Done 基準に含めること（#911 再発防止）。

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
