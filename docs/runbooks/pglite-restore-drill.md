# Runbook — NUC PGlite バックアップ運用 + 復元リハーサル (restore drill)

NUC 本番 (PGlite) のバックアップ取得・失敗検知・復元手順。#3950。
実装 SSOT: `src/lib/server/db/pglite/backup.ts` / `src/lib/server/services/pglite-backup-service.ts` /
`src/routes/api/cron/pglite-backup/+server.ts` / `scripts/backup-nuc.cjs` / `docker-compose.yml` (backup profile)。

## 方針 (オーナー決裁 2026-07-26)

| 項目 | 値 | 根拠 |
|---|---|---|
| RPO | **日次** (毎日 03:00 JST 取得) | オーナー決裁 |
| 保持世代 | **3 世代** | オーナー決裁 |
| 取得時ダウンタイム | **0 秒** | PGlite 公式 `dumpDataDir()` をアプリプロセス内で実行するため停止不要 |
| 保存先 | NUC ローカル `C:\Docker\ganbari-quest\data\backups\` | 現行運用の踏襲。オフサイト複製は未実施 (下記「残存リスク」) |

### なぜアプリプロセス内で採るのか

PGlite は dataDir を**単一プロセスで占有**する。外部プロセス (backup コンテナ等) から採れるのは
「稼働中ディレクトリの tar」= 取得中に書き換えが走り得るコピーだけで、復元できる保証がない。
DB を掴んでいるアプリプロセスから `dumpDataDir()` を呼ぶのが、**停止せずに整合したスナップショットを
得る唯一の経路**。よって backup コンテナ (crond) は `/api/cron/pglite-backup` を叩くだけの起動役に徹する。

## 日次バックアップの流れ

```
crond (backup コンテナ, 03:00 JST)
  └─ node scripts/backup-nuc.cjs
       ├─ DATA_SOURCE=pglite  → POST http://app:3000/api/cron/pglite-backup  (x-cron-secret)
       │    └─ runPgliteBackup()
       │         1. dumpDataDir('gzip')        取得 (ダウンタイム 0)
       │         2. 復元検証 V1/V2/V3          ← 落ちたらファイルを確定させない
       │         3. tmp へ書いて rename        確定 (半端なファイルを世代にしない)
       │         4. ローテーション (3 世代)     ← 確定後にのみ削除する
       │         5. backup-status-pglite.json  最終成功/失敗を記録
       └─ それ以外              → 従来の SQLite 経路 (backup-db.cjs + verify-backup-restore.cjs)
```

### 手動スナップショットの命名・退避方針 (CRITICAL)

障害調査や hotfix 前に手で採るスナップショットを、**日次バックアップと同じ `BACKUP_DIR` に
`pglite-*.tgz` の名前で置いてはならない**。

- 世代判定は `PGLITE_BACKUP_FILENAME_PATTERN` (`pglite-<YYYYMMDD>T<HHMMSS>Z.tgz` の完全一致) で行う。
  この形に一致しないファイルは世代に数えず、ローテーションでも削除しない
- 実例: `pglite-snapshot-20260726-0738-pre-pr3947.tgz` (#3950 の一次証跡) は本番 `BACKUP_DIR` に現存する。
  緩い一致 (prefix + 拡張子) で数えていた実装では、辞書順で `'s'` が数字より後ろに来るため
  **常に「最新世代」の位置に居座り、実保持が 3 → 2 世代に減る**状態だった (QA レビュー #3956 指摘)
- **運用ルール**: 手動スナップショットは `BACKUP_DIR` 直下ではなく `data/backups/manual/` へ置き、
  ファイル名は `manual-<用途>-<日時>.tgz` とする。既に `BACKUP_DIR` 直下にあるものは同ディレクトリへ移す
  (現行実装では世代として数えられないので緊急度は低いが、証跡と世代を混ぜない)

```bash
# 既存の手動スナップショットを退避する (削除しない — 一次証跡として保全)
ssh <NUC_USER>@<NUC_IP> "cd /d C:\Docker\ganbari-quest\data\backups && mkdir manual & move pglite-snapshot-*.tgz manual\"
```

### 復元検証 3 段 (取得物を実際に別インスタンスへ復元して確認する)

| 段 | 内容 | 落ちたときの意味 |
|---|---|---|
| **V1** | 復元 DB の public テーブル全件に `select count(*)` が通る | 取得物が壊れている / 空ダンプ |
| **V2** | `drizzle.__drizzle_migrations` が 1 行以上ある | schema 未適用の DB を掴んでいる |
| **V3** | journal (`drizzle/pglite/meta/_journal.json`) の全 entry が「適用済み最大 `created_at`」以下 | **復元後に永久 skip される migration がある** = #3946 同型。migration を足した直後にアプリ未再起動、または journal の `when` が書き換えられた疑い |

V3 は #3951 の gate (journal 内部の整合性のみ検証) が塞げていなかった
「journal と本番適用実績の関係」を、日次の復元経路で突合するもの (監査 residual [security/sev2])。

## 失敗の検知

- **Discord alert**: `scripts/backup-nuc.cjs` が失敗時に `DISCORD_ALERT_WEBHOOK_URL` へ通知する
- **状態ファイル**: `data/backups/backup-status-pglite.json` に `lastSuccessAt` / `lastFailureAt` /
  `lastFailureMessage` が残る。**失敗しても直前の成功時刻は保持される**ので「最後に成功したのはいつか」が失われない
- **確認コマンド**

```bash
ssh <NUC_USER>@<NUC_IP> "type C:\Docker\ganbari-quest\data\backups\backup-status-pglite.json"
ssh <NUC_USER>@<NUC_IP> "dir C:\Docker\ganbari-quest\data\backups\pglite-*.tgz"
ssh <NUC_USER>@<NUC_IP> "docker logs ganbari-quest-backup-1 --tail 50"
```

> #3950 の事故 (2026-07-12〜07-26) は「job は毎日動いていたが対象が更新停止した旧 SQLite で、しかも
> 毎日 fail していたのに誰も気づかなかった」。**「動いているように見える」を成功と読まない**こと。
> 確認は必ず `backup-status-pglite.json` の `lastSuccessAt` と `pglite-*.tgz` の実在で行う。

## 手動実行 (drill / 障害調査)

```bash
# backup コンテナから 1 回だけ実行する
ssh <NUC_USER>@<NUC_IP> "docker exec -w /app ganbari-quest-backup-1 node scripts/backup-nuc.cjs"
```

## 復元手順 (restore)

`pglite-*.tgz` は `dumpDataDir('gzip')` の出力 = PGlite dataDir の tarball。展開して
`PGLITE_DATA_DIR` に置けばそのまま起動できる。

```bash
# 1. アプリを止める (復元先ディレクトリを掴んだままにしない)
ssh <NUC_USER>@<NUC_IP> "cd /d C:\Docker\ganbari-quest && docker compose stop app"

# 2. 現状を退避してから展開する (復元に失敗したときに戻れるようにする)
ssh <NUC_USER>@<NUC_IP> "cd /d C:\Docker\ganbari-quest\data && ren pglite pglite.before-restore"
ssh <NUC_USER>@<NUC_IP> "cd /d C:\Docker\ganbari-quest\data && mkdir pglite && tar -xzf backups\pglite-<TS>.tgz -C pglite --strip-components=1"

# 3. 起動して health を確認する
ssh <NUC_USER>@<NUC_IP> "cd /d C:\Docker\ganbari-quest && docker compose --profile backup up -d app"
curl -s http://<NUC_IP>:3000/api/health
```

- 起動時に drizzle migrator が走るため、**バックアップ時点より新しい migration があれば復元後に自動適用される**
- 退避した `pglite.before-restore` は、復元後の動作確認が終わるまで消さないこと

## 復元リハーサル実測 (2026-07-26 実施)

### A. 2026-07-26 手動スナップショット (稼働中 tar / 案 1 相当) からの復元

`pglite-snapshot-20260726-0738-pre-pr3947.tgz` (5,662,497 bytes) を実際に展開し PGlite で開いた結果:

```
open + crash recovery : 866ms
public tables         : 59
total rows            : 2,063   (全テーブルの count(*) 合計、全件読めた)
children              : 2
__drizzle_migrations  : max created_at = 1784500000000  (id=35 / 2 / 1)
public tables 状態     : login_bonuses あり / login_streaks なし
```

- **復元できた**。取得と `tar -tzf` までしか確認していなかったものが、実際に開けて全件読めることを確認した
- ただしこれは **hotfix #3947 適用前の状態** (`login_streaks` 未作成 / `login_bonuses` 残存)。
  現行 journal (grandfather 3 値) で起動すれば 0003/0004 の `when` (…001 / …002) が
  適用済み最大 `created_at` (…000) より大きいため正しく適用され、#3947 相当の状態まで進む
  (下記 B で実測)。**grandfather 3 値を実生成時刻へ書き換えるとこの復旧が永久 skip される** ため、
  `scripts/lib/db/drizzle-journal-gate.mjs` の grandfather は外してはならない (#3951 `[WR7]`)

### B. 現行実装での full cycle (上記スナップショットを boot 相当まで進めた実データに対して)

```
boot migrate (0003/0004 適用)      :   79ms   → login_streaks 作成 / login_bonuses 撤去
backup (dump + 復元検証 + 確定)     : 1,256ms  → 5,898,260 bytes
  verification: tablesVerified=59 / migrationsApplied=5 / maxAppliedCreatedAt=1784500000002 / journalEntries=5
restore (取得物 → 別インスタンス)   :   447ms  → children=2 / login_streaks=2
```

### 実測 RTO / RPO

| 指標 | 実測 | 備考 |
|---|---|---|
| **RPO** | 最大 24 時間 | 日次 03:00 JST 取得 |
| **RTO (DB 復元のみ)** | **1 秒未満** (447ms〜866ms) | 現在のデータ量 (59 テーブル / 約 2,000 行 / 圧縮 5.7MB) での実測 |
| **RTO (実運用、手順込み)** | **数分** | 上記「復元手順」の stop → 展開 → 起動 → health 確認。DB 復元自体は支配的ではない |

> データ量が増えれば RTO も伸びる。**上記は 2026-07-26 時点のデータ量での実測値**であり、
> 桁が変わる規模になったら再測定すること。

## 残存リスク (本 Runbook 時点で塞げていないもの)

- **オフサイト複製が無い**。バックアップは NUC ローカルの同一ディスク上にあり、**NUC 本体・ディスクの
  物理故障では本体もバックアップも同時に失われる**。`scripts/backup-to-gdrive.cjs` / `BACKUP_POST_HOOK`
  の経路は存在するが PGlite 経路には未接続。保持 3 世代の決裁と合わせて、別途オーナー判断が要る
- **定期的な restore drill が自動化されていない**。日次の復元検証 (V1/V2/V3) は取得物を毎回別インスタンスへ
  復元して行うため「復元可能性」は毎日確認されるが、**本番ディレクトリへ戻す手順そのもの**の実行は
  本 Runbook の手動実施に依存する
