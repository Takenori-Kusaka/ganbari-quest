# 0100 Docker環境でのGoogle Driveバックアップ復旧

### ステータス

`Done`

### メタ情報

| 項目 | 値 |
|------|-----|
| 種別 | 不具合修正 |
| 難易度 | 中 |
| 優先度 | 最高（データ保全に直結） |
| 発生日 | 2026-03-03（最終バックアップ日） |
| 未バックアップ期間 | 14日（3/3〜3/17 現在） |
| 関連チケット | #0042（バックアップ方式リファクタリング）、#0040（Docker化とCI/CD改善） |

---

### 概要

Docker化（#0040）への移行以降、Google Driveへの自動バックアップが停止している。最終バックアップは **2026年3月3日**。約2週間分のデータが外部バックアップされていない状態。

**バックアップ保持方針（確定）:**
- ローカル・Google Drive ともに **7世代**（約1週間分）をローテーション保持
- 直前のバックアップが最重要。破損リスク対策として1週間分だけ残す
- ※ 対応済み: `backup-db.cjs` デフォルト10→7、`backup-to-gdrive.cjs` ローカル10→7、GDrive 30→7

### 背景・発生経緯

#0040（Docker化）の過程で、バックアップ実行環境がホスト直接実行からDockerコンテナに変わったが、以下の理由でGoogle Driveバックアップが機能しなくなった。

### 原因分析

5つの原因が複合的に作用している。

| # | 原因 | 影響 | 重大度 |
|---|------|------|--------|
| ① | `docker-compose.yml` の backup サービスが `profiles: ["backup"]` のオプション指定 | `docker compose up -d` では起動しない。`--profile backup` の明示が必要 | 致命的 |
| ② | backup サービスで `scripts/hooks/` ディレクトリがマウントされていない | `gdrive-upload.cjs` が見つからず post-hook が失敗 | 致命的 |
| ③ | `BACKUP_POST_HOOK` 環境変数が backup サービスに設定されていない | post-hook が実行されず、ローカルバックアップのみで止まる | 致命的 |
| ④ | `.env` ファイルのマウントが `required: false` | Google Drive 認証情報（`GDRIVE_*`）がコンテナに渡されない可能性 | 重大 |
| ⑤ | Dockerfile が `scripts/` をコピーしていない（app サービス側） | app コンテナ内から直接バックアップ実行も不可 | 中 |

### 影響範囲

- **3/3〜現在**: Google Driveへの外部バックアップが一切行われていない
- **ローカルバックアップ**: ホスト側の `data/backups/` に残っている可能性あり（要確認）
- **データ消失リスク**: NUCサーバーのストレージ障害が発生した場合、3/3以降のデータが復旧不能

### ゴール

- [x] 即時対応: 手動でローカル+GDriveバックアップを実行
- [x] docker-compose.yml の backup サービスを修正（backup-to-gdrive.cjs直接実行、scripts/全マウント、.env required: true、retention 7）
- [x] backup-to-gdrive.cjs: DATABASE_URL/BACKUP_DIR 環境変数対応
- [x] googleapis パッケージをプロジェクト依存に追加
- [x] GDrive リフレッシュトークン再取得（gdrive-auth-setup.cjs で再認証完了）
- [x] backup プロファイルでの起動確認（`docker compose --profile backup up -d` で稼働中）
- [ ] 再発防止: バックアップ失敗時の通知メカニズム（別チケットで対応）

### 対応方針

#### Phase 1: 即時対応（手動バックアップ）

NUCサーバー上で直接スクリプトを実行し、まず未バックアップ分を解消する。

```bash
# NUCサーバーにSSH
ssh kusaka-server@192.168.68.79

# ホスト側から直接実行（Docker外）
cd /path/to/ganbari-quest
node scripts/backup-to-gdrive.cjs

# Google Drive上のバックアップ日時を確認
```

#### Phase 2: docker-compose.yml 修正

```yaml
# 修正案
  backup:
    build: .
    entrypoint: /bin/sh
    command:
      - -c
      - |
        echo "0 3 * * * cd /app && node scripts/backup-db.cjs >> /proc/1/fd/1 2>&1" | crontab -
        crond -f
    volumes:
      - ./data:/app/data
      - ./scripts:/app/scripts:ro          # ← hooks/ 含むディレクトリ全体をマウント
    env_file:
      - path: .env
        required: true                      # ← 必須に変更（認証情報がないと起動しない）
    environment:
      - BACKUP_POST_HOOK=node scripts/hooks/gdrive-upload.cjs  # ← 明示的に設定
    profiles:
      - backup
    restart: unless-stopped
```

**変更点:**
1. `scripts/` ディレクトリ全体をマウント（`hooks/` 含む）
2. `.env` を `required: true` に変更（認証情報必須）
3. `BACKUP_POST_HOOK` を明示的に environment に設定
4. `restart: unless-stopped` を追加

#### Phase 3: 起動方法の確立

```bash
# backup プロファイルを含めて起動
docker compose --profile backup up -d

# 動作確認（手動実行）
docker compose exec backup node scripts/backup-db.cjs

# ログ確認
docker compose logs backup --tail 50
```

**検討事項: profiles をやめてデフォルト起動にすべきか？**
- メリット: `docker compose up -d` だけでバックアップも起動、起動忘れ防止
- デメリット: .env に Google Drive 認証情報がない環境ではエラー起動
- **推奨**: profiles は維持しつつ、`deploy.sh` や README に `--profile backup` を明記

#### Phase 4: 再発防止

**バックアップ監視:**

```
1. backup-db.cjs にバックアップ結果をログファイルに記録する機能を追加
   → data/backups/backup.log に日時・結果・転送先を追記

2. ヘルスチェック的な仕組み:
   → 最新バックアップファイルのタイムスタンプを確認するAPIエンドポイント
   → /api/v1/admin/backup-status → { lastBackup: "2026-03-17T03:00:00", ageHours: 24 }

3. 管理画面に「最終バックアップ日時」を表示
   → 48時間以上バックアップがない場合は警告表示
```

### 作業メモ

- 現行の NUC デプロイでは `scripts/deploy.sh` で Docker 再起動しているが、`--profile backup` が含まれているか要確認
- `backup-db.bat` はホスト（Windows）用で Docker 内では使えない
- cron の代わりに Windows タスクスケジューラ + `docker exec` でも運用可能（NUCがWindows環境の場合）

### テスト方法

1. `docker compose --profile backup up -d` で backup コンテナが起動すること
2. `docker compose exec backup node scripts/backup-db.cjs` でバックアップが作成されること
3. `data/backups/` に `.db` ファイルが生成されること
4. Google Drive の指定フォルダにバックアップファイルがアップロードされること
5. cron スケジュール（毎日3:00）で自動実行されること
6. `.env` がない状態で backup サービスが起動しないこと（`required: true` の検証）

### 残課題・次のアクション

- [ ] `deploy.sh` に `--profile backup` を追加（未確認）
- [ ] backup-db.cjs にログ出力機能を追加
- [ ] 管理画面に「最終バックアップ日時」表示を追加（#0042 の未実装タスクと統合）
- [ ] NUC が Windows 環境の場合の cron 代替手段の整理
