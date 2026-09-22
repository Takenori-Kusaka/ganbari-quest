---
name: Deploy Verify
description: Use after deploying to production or staging. Runs post-deployment verification checklist including health checks, smoke tests, and rollback criteria.
---

# デプロイ検証手順（ADR-0024 / ADR-0048）

本リポジトリの 4 系統 (AWS Lambda 本番 / AWS staging / NUC 本番 / NUC staging) はいずれも **GitHub Actions workflow が
deploy + post-deploy health/smoke を自動実行**する。本 skill は各 workflow が叩く endpoint・schema 検証・
rollback 経路を再利用するための SSOT。手動で再確認する場合も同じ endpoint / 手順を使う。

## デプロイ系統と実機構

| 系統 | workflow | working-dir / 実行基盤 | health endpoint | migration |
|---|---|---|---|---|
| AWS Lambda 本番 | `.github/workflows/deploy.yml` (main push) | GitHub-hosted runner + OIDC、Lambda Function URL | `<FunctionUrl>api/health` | Aurora DSQL。workflow の `Provision DSQL schema` step (`npm run dsql:migrate`) が Lambda 更新前に適用する (lazy startup migration は SQLite 専用で呼ばれない) |
| AWS staging (#2873) | `.github/workflows/deploy-aws-staging.yml` (PR base=main / dispatch) | GitHub-hosted runner + OIDC、staging stack 群 (列挙は workflow の `STAGING_STACKS` env が SSOT) + `GanbariQuestDsqlStaging`、`ganbari-quest-staging` prefix、Lambda Function URL | `<StagingFunctionUrl>api/health` (Fn 名 `ganbari-quest-staging-app`) | Aurora DSQL。`Provision DSQL schema` step (`npm run dsql:migrate`) が適用。health step は 200 のみ assert (G-MIG の主担保は NUC staging) |
| NUC 本番 | `.github/workflows/deploy-nuc.yml` (main push / dispatch) | self-hosted `[self-hosted, Windows, X64, nuc]`、`C:\Docker\ganbari-quest`、docker compose、port 3000 | `http://localhost:3000/api/health` | PGlite (`DATA_SOURCE=pglite`)。boot 時に drizzle migrator が `drizzle/pglite/` を適用 (`src/lib/server/db/pglite/connection.ts`) |
| NUC staging | `.github/workflows/deploy-nuc-staging.yml` (PR base=main / dispatch) | self-hosted `[self-hosted, Windows, X64, nuc]`、`C:\Docker\ganbari-quest-staging`、docker compose project `ganbari-quest-staging`、port 3100 | `http://localhost:3100/api/health` | 統合 PR は PGlite lane: 旧 SQLite DB の snapshot → PGlite cutover rehearsal → boot 時 migration。dispatch は opt-in (`pgliteEnabled` / `syntheticSeed`) |

> NUC staging は本番 NUC とは **別 working-dir / 別 port (3100) / 別 compose project (`-p ganbari-quest-staging`) / 別 DB path** で隔離され、本番に影響しない (#2872 AC4)。本番 DB は online snapshot で read のみ。

## デプロイ前チェック

- [ ] CI 全緑（biome + svelte-check + vitest + playwright）
- [ ] PR がマージ済み
- [ ] main / develop ブランチが最新

## デプロイ実行

### AWS Lambda 本番（`deploy.yml`）

- main push で自動実行（build → ECR push → DSQL cluster deploy + `dsql:migrate` → CDK deploy → Lambda update → health → e2e-production smoke）
- 手動トリガー: `gh workflow run deploy.yml`

### NUC 本番（`deploy-nuc.yml`）

- main push で自動実行。手動トリガー: `gh workflow run deploy-nuc.yml`
- self-hosted runner が `C:\Docker\ganbari-quest` で app stop → `git reset --hard origin/main` → `.env` 再生成
  （`scripts/nuc/generate-env.ps1`）→ SQLite→PGlite cutover step（`data\pglite` 既存なら skip）
  → `docker compose --profile backup --profile scheduler build` → `up -d`（stop→build→up 順は WAL safety のため必須。
  profile を付けないと backup / scheduler service が更新されない、#4721）

### AWS staging（`deploy-aws-staging.yml`、#2873）

- main 向け PR で常に自動実行（paths filter は required 化のため撤去済、#2874）/ 手動: `gh workflow run deploy-aws-staging.yml`（develop HEAD を deploy）
- ADR-0019 gate (`check-cdk-replacement.mjs`) → StorageStaging deploy → ECR push (`ganbari-quest-staging:{sha,latest}`)
  → DsqlStaging deploy + `dsql:migrate` → ADR-0019 gate (staging stack 群) → staging stack 明示列挙 deploy（`STAGING_STACKS`、`--all` 不使用）
  → `dsql:grant` → `update-function-code ganbari-quest-staging-app` → health/smoke

### NUC staging（`deploy-nuc-staging.yml`）

- 統合 PR (base=main) で自動実行 / 手動: `gh workflow run deploy-nuc-staging.yml`（develop HEAD を deploy）
- self-hosted runner が `C:\Docker\ganbari-quest-staging` で対象 ref を reset → staging `.env` (PORT=3100) 生成
  → 本番 app container 内で `scripts/snapshot-prod-db.cjs`（旧 SQLite DB `/app/data/ganbari-quest.db` の snapshot。
  本番は PGlite cutover 済でこの file は cutover 時点で凍結されている。不在時 fixture fallback）
  → `docker compose -p ganbari-quest-staging build` → PGlite cutover rehearsal → `up -d`

## デプロイ後検証（5 分以内に完了）

### ヘルスチェック

- [ ] `/api/health` が 200 を返す（AWS 本番 / AWS staging = 各 Function URL / NUC 本番 = `localhost:3000` / NUC staging = `localhost:3100`）
- [ ] NUC (本番 / staging) は response body の `schema.schemaValid === true` を確認（migration 貫通 = `#2508` startup crash 再発防止）。pg 系 backend (dsql / pglite) の `schemaValid` は `probePg`（`src/lib/server/db/probe.ts`）が `children` への count 成功で立て、失敗時は 503 を返す。AWS (本番 / staging) の workflow health step は 200 のみ assert（schema は事前の `dsql:migrate` step が適用）
- [ ] トップページ（`/`）が 200 / 302 で応答する

### スモークテスト

- [ ] `/switch`（子供切替の入口）が到達する
- [ ] AWS は `deploy.yml` の e2e-production（post-deploy smoke on Lambda URL）+ demo Lambda smoke（#2130）が緑
- [ ] AWS は `deploy.yml` の DSQL backup smoke（#3808）が緑（vault / plan / selection 実在 + recovery point 鮮度 < 48h。初回 deploy 後の on-demand 実発火確認と alarm 実通知テストは [dsql-restore.md §post-deploy backup smoke](../../../docs/runbooks/dsql-restore.md)）
- [ ] 管理画面（`/admin`）: AWS（cognito 本番）は未ログインなら `/auth/login` へ redirect、ログイン後に親 PIN gate を経る。NUC（`AUTH_MODE=local`）は PIN gate 無効で直接表示される（有効化条件は `src/lib/server/auth/parent-gate.ts` `isParentGateActive`）。Function URL 直の `/admin` は front door 検査で 404 が正（`deploy.yml` `Front door enforcement check`、#4280）

### §3.8 step 9 = AWS + NUC 両 health を 1 run で確認（SSOT、4 系統形）

統合監査サイクル（`docs/sessions/audit-team.md` §3.8 step 9）の「本番 AWS 版・ローカル NUC 版の両方へ health check」は、
本 skill の health endpoint を再利用して **1 run 内で両系統を確認する**:

- AWS 本番: `deploy.yml` の Health check step（`<FunctionUrl>api/health` が 200）
- AWS staging: `deploy-aws-staging.yml` の Health check step（`<StagingFunctionUrl>api/health` が 200。統合 PR 検証時、#2873。schema は事前の `dsql:migrate` step が適用し、health step は 200 のみ assert — G-MIG は NUC staging が主担保）
- NUC 本番: `http://localhost:3000/api/health` が 200 + `schema.schemaValid=true`
- NUC staging: `http://localhost:3100/api/health` が 200 + `schema.schemaValid=true`（統合 PR 検証時、`deploy-nuc-staging.yml`）

片系統だけ緑の誤判定を防ぐため、両系統の health 結果を揃えて確認する（G-PD / §3.7 #5）。統合 PR では AWS staging + NUC staging の 2 系統が PR 上で、本番 2 系統が merge 後の main push で揃う。

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
docker compose --profile backup --profile scheduler build
docker compose --profile backup --profile scheduler up -d

# AWS staging: deploy-aws-staging.yml の "Rollback on failure" step が staging ECR previous digest に
#   自動で戻す。手動で正常 ref を流し直す場合 (本番に影響しない):
gh workflow run deploy-aws-staging.yml

# NUC staging: 本番に影響しないため、再 deploy（workflow_dispatch）で正常 ref を流し直す。
gh workflow run deploy-nuc-staging.yml
```
