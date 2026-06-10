---
name: Deploy Verify
description: Use after deploying to production or staging. Runs post-deployment verification checklist including health checks, smoke tests, and rollback criteria.
---

# デプロイ検証手順（ADR-0021 / ADR-0024 / ADR-0048）

本リポジトリの 3 系統 (AWS Lambda 本番 / NUC 本番 / NUC staging) はいずれも **GitHub Actions workflow が
deploy + post-deploy health/smoke を自動実行**する。本 skill は各 workflow が叩く endpoint・schema 検証・
rollback 経路を再利用するための SSOT。手動で再確認する場合も同じ endpoint / 手順を使う。

## デプロイ系統と実機構

| 系統 | workflow | working-dir / 実行基盤 | health endpoint | migration |
|---|---|---|---|---|
| AWS Lambda 本番 | `.github/workflows/deploy.yml` (main push) | GitHub-hosted runner + OIDC、Lambda Function URL | `<FunctionUrl>api/health` | DynamoDB backend のため lazy startup migration は呼ばれない |
| NUC 本番 | `.github/workflows/deploy-nuc.yml` (main push / dispatch) | self-hosted `[Windows, X64]`、`C:\Docker\ganbari-quest`、docker compose、port 3000 | `http://localhost:3000/api/health` | startup lazy migration (`applyLazyStartupMigrations`、SQLite) |
| NUC staging | `.github/workflows/deploy-nuc-staging.yml` (PR base=main / dispatch) | self-hosted `[Windows, X64]`、`C:\Docker\ganbari-quest-staging`、docker compose project `ganbari-quest-staging`、port 3100 | `http://localhost:3100/api/health` | snapshot-forward → startup lazy migration (本番 DB snapshot から起動) |

> NUC staging は本番 NUC とは **別 working-dir / 別 port (3100) / 別 compose project (`-p ganbari-quest-staging`) / 別 DB path** で隔離され、本番に影響しない (#2872 AC4)。本番 DB は online snapshot で read のみ。

## デプロイ前チェック

- [ ] CI 全緑（biome + svelte-check + vitest + playwright）
- [ ] PR がマージ済み
- [ ] main / develop ブランチが最新

## デプロイ実行

### AWS Lambda 本番（`deploy.yml`）

- main push で自動実行（build → ECR push → Lambda update → health → e2e-production smoke）
- 手動トリガー: `gh workflow run deploy.yml`

### NUC 本番（`deploy-nuc.yml`）

- main push で自動実行。手動トリガー: `gh workflow run deploy-nuc.yml`
- self-hosted runner が `C:\Docker\ganbari-quest` で `git reset --hard origin/main` → `.env` 再生成
  → `docker compose --profile backup build` → `up -d`（stop→build→up 順は WAL safety のため必須）

### NUC staging（`deploy-nuc-staging.yml`）

- 統合 PR (base=main) で自動実行 / 手動: `gh workflow run deploy-nuc-staging.yml`（develop HEAD を deploy）
- self-hosted runner が `C:\Docker\ganbari-quest-staging` で対象 ref を reset → staging `.env` (PORT=3100) 生成
  → `node scripts/snapshot-prod-db.cjs`（本番 DB snapshot、不在時 fixture fallback）
  → `docker compose -p ganbari-quest-staging build / up -d`

## デプロイ後検証（5 分以内に完了）

### ヘルスチェック

- [ ] `/api/health` が 200 を返す（AWS = Function URL / NUC 本番 = `localhost:3000` / NUC staging = `localhost:3100`）
- [ ] NUC (本番 / staging) は response body の `schema.schemaValid === true` を確認（lazy migration 貫通 = `#2508` startup crash 再発防止）
- [ ] トップページ（`/`）が 200 / 302 で応答する

### スモークテスト

- [ ] `/switch`（子供切替の入口）が到達する
- [ ] AWS は `deploy.yml` の e2e-production（post-deploy smoke on Lambda URL）+ demo Lambda smoke（#2130）が緑
- [ ] 管理画面（`/admin`）が PIN gate を返す

### §3.8 step 9 = AWS + NUC 両 health を 1 run で確認（SSOT）

統合監査サイクル（`docs/sessions/audit-team.md` §3.8 step 9）の「本番 AWS 版・ローカル NUC 版の両方へ health check」は、
本 skill の health endpoint を再利用して **1 run 内で両系統を確認する**:

- AWS 本番: `deploy.yml` の Health check step（`<FunctionUrl>api/health` が 200）
- NUC 本番: `http://localhost:3000/api/health` が 200 + `schema.schemaValid=true`
- NUC staging: `http://localhost:3100/api/health` が 200 + `schema.schemaValid=true`（統合 PR 検証時、`deploy-nuc-staging.yml`）

片系統だけ緑の誤判定を防ぐため、両系統の health 結果を揃えて確認する（G-PD / §3.7 #5）。

### E2E（本番向け）

```bash
npx playwright test --config playwright.production.config.ts
```

## ロールバック基準

以下のいずれかに該当する場合は即座にロールバック:

1. ヘルスチェック失敗（200 不達 / `schema.schemaValid !== true`）
2. ログイン不可
3. データ書き込み不可
4. 500 / 502 / 503 / 504 の連続発生

### ロールバック手順

```bash
# AWS Lambda: deploy.yml の "Rollback on failure" step が ECR previous digest に自動で戻す。
#   手動再 deploy で前コミットに戻す場合:
gh workflow run deploy.yml

# NUC 本番: 前コミットに reset → 再 build/up（self-hosted runner / C:\Docker\ganbari-quest 上）
git reset --hard <前のコミット>
docker compose --profile backup build
docker compose --profile backup up -d

# NUC staging: 本番に影響しないため、再 deploy（workflow_dispatch）で正常 ref を流し直す。
gh workflow run deploy-nuc-staging.yml
```
