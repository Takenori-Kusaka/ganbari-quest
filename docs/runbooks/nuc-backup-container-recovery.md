# Runbook — NUC backup コンテナのライフサイクルと復旧

NUC ローカル版の `backup` コンテナ (日次 DB バックアップ + restore 検証) の構成・障害復旧手順。

## 構成

- **service**: `docker-compose.yml` の `backup` (profile `backup` でゲート)
- **役割**: crond で毎日 3:00 JST に `node scripts/backup-db.cjs && node scripts/verify-backup-restore.cjs` を実行
- **scripts 供給**: `./scripts:/app/scripts:ro` でホスト repo (`C:\Docker\ganbari-quest\scripts`) を read-only マウント。runtime image には scripts を同梱しない (live mount で rebuild 不要、ADR-0010)
- **GDrive upload**: `.env` の `BACKUP_POST_HOOK` 経由で `backup-db.cjs` が呼ぶ (未設定なら skip + success、#2781 graceful fallback)
- **healthcheck**: `pgrep crond` で crond 稼働を確認 (#2985)。Dockerfile の web server 用 HEALTHCHECK は backup には不適のため override 済

## 設計上の注意 — profile ゲートと deploy

`backup` service は `profiles: [backup]` でゲートされる。**`docker compose up -d` を `--profile backup` なしで実行すると backup コンテナは build / 再作成の対象外**になり、`docker-compose.yml` を更新しても旧コンテナ (古い crontab) が凍結されたまま残る (config drift)。

- `deploy-nuc.yml` は `docker compose --profile backup build` / `up -d` で profile を明示し、デプロイ毎に backup を再作成する (#2985)
- 手動操作でも profile 指定を忘れない

## 障害: `Cannot find module '/app/scripts/backup-to-gdrive.cjs'` 等の MODULE_NOT_FOUND

### 原因切り分け

```bash
# Windows Git Bash では MSYS_NO_PATHCONV=1 必須
ssh kusaka-server@192.168.68.79 "docker ps --filter name=ganbari --format \"{{.Names}} {{.Status}}\""
# app が healthy なら本番サービスは生存。backup のみの問題は本番停止ではない

# 起動中コンテナの crontab が compose 定義と一致するか
ssh kusaka-server@192.168.68.79 "docker exec ganbari-quest-backup-1 crontab -l"
# 古い command (backup-to-gdrive.cjs 直叩き 等) が出たら config drift
```

### 復旧 (backup のみ再作成、app 無傷)

```bash
ssh kusaka-server@192.168.68.79 "cd /d C:\Docker\ganbari-quest && docker compose --profile backup up -d --force-recreate backup"

# 検証: crontab が compose 定義 (backup-db.cjs && verify-backup-restore.cjs) に一致
ssh kusaka-server@192.168.68.79 "docker exec ganbari-quest-backup-1 crontab -l"

# 実バックアップ手動実行で MODULE_NOT_FOUND が消えたか確認
ssh kusaka-server@192.168.68.79 "docker exec -w /app ganbari-quest-backup-1 node scripts/backup-db.cjs"
```

ホスト repo に scripts が無い場合は先に `git fetch origin main && git reset --hard origin/main` で同期する (deploy-nuc.yml と同手順)。

## 関連

- #2985 (profile drift 恒久対処) / #2779 (stub 再配備 hotfix) / #2781 (graceful fallback) / #1442 (scripts 棚卸で元削除)
- 接続情報: `docs/design/05-開発指針書.md` / `infra/CLAUDE.md`
