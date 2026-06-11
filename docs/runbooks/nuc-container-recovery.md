# Runbook — NUC コンテナのライフサイクルと復旧

NUC ローカル版 (`app` / `backup`) の構成・障害復旧手順。接続情報は `docs/design/05-開発指針書.md` / `infra/CLAUDE.md`。Windows Git Bash から SSH する場合は `MSYS_NO_PATHCONV=1` を付ける。

## 障害: host reboot 後に外部 (LAN) から `http://<NUC>:3000/` が無応答

### 症状と切り分け

コンテナ内部 health は OK なのに LAN からアクセスできない場合、**host reboot 後に Docker (WSL2) の port forwarding が再確立されていない**ことが多い (`restart: unless-stopped` でコンテナは復帰するが docker-proxy が host に bind し直らない)。

```bash
# 1. コンテナ内部は生きているか (内部 OK なら app 本体は正常)
ssh <NUC_USER>@<NUC_IP> "docker exec ganbari-quest-app-1 wget -qO- http://127.0.0.1:3000/api/health"

# 2. host に port が publish されているか
ssh <NUC_USER>@<NUC_IP> "docker port ganbari-quest-app-1"
#    空 → docker-proxy 未確立 (下記 recreate で復旧)

# 3. host 自身から localhost (302 なら host までは到達)
ssh <NUC_USER>@<NUC_IP> "curl.exe -s -m 8 -o NUL -w \"%{http_code}\n\" http://localhost:3000/"
```

> **注意**: host 自身から自分の LAN IP (`http://<NUC_IP>:3000`) を curl すると NAT hairpinning で `000` になることがあるが、**別端末からは到達できている**。LAN IP の最終確認は必ず別端末のブラウザで行う。

### 復旧 (WAL 安全順序、#0099)

```bash
# graceful stop で SQLite WAL flush → force-recreate で docker-proxy 貼り直し
ssh <NUC_USER>@<NUC_IP> "cd /d C:\Docker\ganbari-quest && docker compose stop app"
ssh <NUC_USER>@<NUC_IP> "cd /d C:\Docker\ganbari-quest && docker compose --profile backup up -d --force-recreate --no-build app"

# 検証: docker port に 0.0.0.0:3000 が出る + 別端末から到達
ssh <NUC_USER>@<NUC_IP> "docker port ganbari-quest-app-1"
```

`--no-build` で既存 image を再利用 (reboot 復旧では rebuild 不要)。health: starting → healthy まで ~40s 待つ。

### 恒久化 (推奨、host 設定)

reboot 毎に手動 recreate を避けるには、NUC の Windows タスクスケジューラに「スタートアップ + Docker 起動待ち遅延 (例 90s)」で以下を登録する (host 設定のため repo 管理外):

```powershell
cd C:\Docker\ganbari-quest ; docker compose --profile backup up -d --force-recreate
```

## backup コンテナの構成

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
ssh <NUC_USER>@<NUC_IP> "docker ps --filter name=ganbari --format \"{{.Names}} {{.Status}}\""
# app が healthy なら本番サービスは生存。backup のみの問題は本番停止ではない

# 起動中コンテナの crontab が compose 定義と一致するか
ssh <NUC_USER>@<NUC_IP> "docker exec ganbari-quest-backup-1 crontab -l"
# 古い command (backup-to-gdrive.cjs 直叩き 等) が出たら config drift
```

### 復旧 (backup のみ再作成、app 無傷)

```bash
ssh <NUC_USER>@<NUC_IP> "cd /d C:\Docker\ganbari-quest && docker compose --profile backup up -d --force-recreate backup"

# 検証: crontab が compose 定義 (backup-db.cjs && verify-backup-restore.cjs) に一致
ssh <NUC_USER>@<NUC_IP> "docker exec ganbari-quest-backup-1 crontab -l"

# 実バックアップ手動実行で MODULE_NOT_FOUND が消えたか確認
ssh <NUC_USER>@<NUC_IP> "docker exec -w /app ganbari-quest-backup-1 node scripts/backup-db.cjs"
```

ホスト repo に scripts が無い場合は先に `git fetch origin main && git reset --hard origin/main` で同期する (deploy-nuc.yml と同手順)。

## 関連

- #2985 (backup profile drift 恒久対処 + app reboot 後 port 復旧手順) / #2779 (stub 再配備 hotfix) / #2781 (graceful fallback) / #1442 (scripts 棚卸で元削除) / #0099 (WAL 破損防止順序)
- 接続情報: `docs/design/05-開発指針書.md` / `infra/CLAUDE.md`
