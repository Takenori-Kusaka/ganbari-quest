---
name: Deploy Verify
description: Use after deploying to production or staging. Runs post-deployment verification checklist including health checks, smoke tests, and rollback criteria.
---

# デプロイ検証手順（ADR-0021）

## デプロイ前チェック

- [ ] CI 全緑（biome + svelte-check + vitest + playwright）
- [ ] PR がマージ済み
- [ ] main ブランチが最新

## デプロイ実行

### NUC（自宅サーバー）
```bash
ssh nuc
cd /opt/ganbari-quest
git pull origin main
npm ci
npx drizzle-kit push
npm run build
pm2 restart ganbari-quest
```

### AWS Lambda
- GitHub Actions の `deploy.yml` が main push で自動実行
- 手動トリガー: `gh workflow run deploy.yml`

## デプロイ後検証（5分以内に完了）

### ヘルスチェック
- [ ] `/api/v1/health` が 200 を返す
- [ ] トップページが正常に表示される

### スモークテスト
- [ ] ログインできる
- [ ] 子供画面でポイント付与ができる
- [ ] 管理画面が表示される

### E2E（本番向け）
```bash
npx playwright test --config playwright.production.config.ts
```

## ロールバック基準

以下のいずれかに該当する場合は即座にロールバック:

1. ヘルスチェック失敗
2. ログイン不可
3. データ書き込み不可
4. 500 エラーの連続発生

### ロールバック手順
```bash
# NUC
git checkout <前のコミット>
npm ci && npm run build && pm2 restart ganbari-quest

# Lambda
gh workflow run deploy.yml -f ref=<前のコミット>
```
