# infra/ — デプロイ手順

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
| `AWS_LICENSE_SECRET` | ライセンスキー HMAC 署名（#806, ADR-0026） | ダミー OK | ダミー OK | **本番値必須** | **本番値必須** | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `STRIPE_SECRET_KEY` | Stripe 課金 | 未設定可 | 未設定可 | 本番値必須 | （NUC は Stripe 無効） | Stripe Dashboard |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook 検証 | 未設定可 | 未設定可 | 本番値必須 | （NUC は Stripe 無効） | Stripe Dashboard |
| `GEMINI_API_KEY` | Gemini API (任意) | 未設定可 | 未設定可 | 任意 | 任意 | https://aistudio.google.com/ |

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

> **重要**: `AWS_LICENSE_SECRET` は Lambda 本番と**同じ値**を使うこと（ADR-0026 §G2）。
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
