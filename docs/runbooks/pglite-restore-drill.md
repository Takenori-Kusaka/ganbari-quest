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

## オフサイト複製 (#3970)

> **先に読んでください**: `HOST_BACKUP_DIR` を NAS 等に向けても、**それだけでは off-site になりません。**
> 差し替えたのは「バックアップの置き場」であって、**別の場所に控えが増えるわけではありません**。
> NAS を指定しただけなら、その NAS が壊れれば同じことです。**複製 (2 箇所以上に存在させること) は
> 運用者がファイルシステム層で行ってください。**

**責任分界**: アプリ側は **バックアップを docker compose の volume 指定領域に出すところまで**を担う。
そこから先 (NAS / SAMBA / クラウドへの複製) は **運用者がファイルシステム層で行う**。

この切り分けを採るのは、複製先の選択 (どの NAS か / どのクラウドか / どの頻度か) が家庭ごとに異なり、
アプリ側で 1 つに決め打つと合わない家庭で無効化されるためである。**ファイルシステム層に委ねれば、
運用者が既に使っている仕組み (NAS の同期 / OS のバックアップ機能) をそのまま流用できる。**

### 差し替えられるのは「バックアップだけ」— 稼働中の DB は動かさない

`HOST_BACKUP_DIR` が差し替えるのは **バックアップ (`/app/backups`) だけ**である。
**稼働中の DB (`/app/data`) はローカルディスク固定**で、差し替える手段を用意していない。

**埋め込み型 DB (PGlite / SQLite) をネットワーク共有上で直接稼働させると、書き込み中の切断で
DB ファイルが破損する**（既知の危険パターン）。off-site 化のために推奨した設定が、本番 DB の破損という
別の全損経路を開いてはならない。この不変条件は `tests/unit/infra/compose-backup-volume.test.ts` の
`[CV4]` が機械で固定している。

### 複製先を指定する

`.env` の `HOST_BACKUP_DIR` で、compose を書き換えずにバックアップの置き場を差し替えられる。

```env
# 既定 (未設定時) は ./data/backups
HOST_BACKUP_DIR=/mnt/nas/ganbari-quest-backups
```

`app` / `backup` の両サービスが同じ値を参照する。**片方だけ差し替えてはいけない** —
backup コンテナが別ディレクトリを見て「取れているのに実データではない」状態になり、
#3950 (PGlite 移行後も旧 SQLite を複製し続けた) と同型の事故になる。

変更後は `docker compose --profile backup up -d` でコンテナを作り直す。
**既存世代を新しい場所へ移すのは手作業**である (compose は mount 先を変えるだけで中身を移さない)。

### マウントが外れたまま起動すると、書き込みは成功する

`HOST_BACKUP_DIR` を NAS に向けても、**その NAS がダウンしている / マウントが外れている状態で
compose を上げると、Docker はその path に空のローカルディレクトリを作って bind する**。
書き込みは成功し、バックアップは「取れた」と記録され、**控えが NUC 内にしか無い状態が無音で続く**。

path 文字列は `/mnt/nas/...` のままなので、**設定を見ても気づけない**。#3950 (「毎晩成功していたが、
実際は更新の止まった SQLite を 18 回コピーしていた」) と同型の事故が、一段上の粒度で起きる経路である。

#### 退避先に目印を 1 つ置く (必須。これが検出の土台)

退避先を用意したら、**そこに目印ファイルを 1 つ作る**。中身は何でもよい (空でも通る)。
どの機械かを後で思い出せる一言を書いておくと復旧時に助かる。

```bash
echo "書斎の NAS" > /mnt/nas/ganbari-quest-backups/.ganbari-offsite
```

バックアップのたびに「保存先からこの目印が読めるか」だけを見る。

| 状態 | 目印 | 挙動 |
|---|---|---|
| 正しくマウントされている | 読める | 何も出さない |
| **マウントが外れて Docker が空ディレクトリを作った** | 無い | **alert** |
| **別のディレクトリを掴んでいる** | 無い | **alert** |
| 権限 / I/O エラーで読めない | 判定不能 | alert (「問題なし」に丸めない) |

#### なぜ「別のディスクか」で判定しないのか

初版は保存先と稼働中 DB の `stat().dev` を比較していたが、**採用しなかった**。

- 本番 NUC は **Windows 上の Docker** で、bind mount は仮想ファイルシステム層を経由する。
  そこで報告される device id がホスト側の物理デバイスの違いを反映する保証が無い。
  両 bind が同一の仮想 FS 由来なら NAS が正常でも毎晩誤報、bind ごとに別 device が振られるなら
  NAS 断のローカル fallback も「別デバイス」で素通りする。**どちらでも検出器として価値が無い**
- 仮に device が正しく取れても、**NUC が OS ディスク + データディスクの 2 台構成なら
  「別デバイス」= 期待どおり**と判定してしまう。筐体が 1 つである以上、
  #3970 が防ごうとした「機器の喪失で控えごと全損」はまったく防げていない

目印方式は仮想 FS の device 意味論にも、内蔵ディスクの本数にも依存しない。
**「自分が用意したその場所か」**だけを問う。

#### alert は失敗 alert と分ける

取得自体は成功しているため、失敗として通知すると運用者が実在する控えを無いものとして扱う。
伝えるべきは「取れたが置き場に届いていない」。連続失敗カウンタ (#4129) にも載せない。

**同じ判定が続く間は再送しない**。同じ警告が毎晩届くと数日で無視され、
同じ通知先を共有している本物の失敗 alert (#4129 / #4087) まで一緒に見られなくなる。
判定は毎回行い、状態が変わったときだけ通知する。

判定は `src/lib/domain/backup-offsite.ts` (純粋関数) が持つ。
`tests/unit/domain/backup-offsite.test.ts` が判定を、
`tests/unit/services/pglite-backup-offsite-wiring.test.ts` が **service 層への配線**を、
`tests/unit/infra/compose-backup-volume.test.ts` `[CV5]` が **compose の起動条件**を固定する。
判定だけを test すると、配線を切っても CI が緑になる (ADR-0061 fitness function)。

**off-site を運用しない家庭では検査しない** (`BACKUP_OFFSITE_EXPECTED` が立たない)。ローカル 1 箇所を
受容する選択まで警告すると、警告が常態化して読まれなくなる。

#### この検査が保証しないこと

**「控えが安全な場所にあるか」は見ていない。** 見ているのは「自分が用意した場所に届いているか」だけである。
バックアップは**個人情報を含む家族の記録が暗号化されずに**入っており (#3971)、
LAN 内の誰でも読める共有フォルダを退避先にしても、この検査は ok を返す。
**誰が読めるかは次節の条件で運用者が担保する** — 機械は代われない。

### 複製先を選ぶときの必須条件

> **複製先は運用者本人のみがアクセスできる場所にすること。**

バックアップには**個人情報を含む家族の記録がそのまま入っており、暗号化していない** (#3971 で
「NUC は非マルチテナントで、控えは運用者自身の機器内に留まる」ことを根拠に暗号化しない決定をした)。

**この前提は、複製先を家庭内 LAN の共有領域やクラウドに置いた瞬間に崩れる。** 家族以外がアクセス
できる共有フォルダ / 認証のない NAS / 共有アカウントのクラウドストレージは選ばないこと。

### 確認手順

複製が実際に効いているかは、**NUC の外から見て確認する**。

```powershell
# 1. NUC 側で最新世代のファイル名とサイズを確認する
#    (HOST_BACKUP_DIR 未設定なら C:\Docker\ganbari-quest\dataackups)
Get-ChildItem 'C:\Docker\ganbari-quest\dataackups' -Filter 'pglite-*.tgz' |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1 Name, Length
```

```bash
# 2. 複製先で同名・同サイズのファイルが見えることを確認する
#    (確認コマンドは運用者の環境による — NAS のファイラ / rclone ls 等)
```

**サイズまで一致していることを見ること。** ファイル名だけの一致は、途中で切れた複製を成功と誤認する。

## 残存リスク (本 Runbook 時点で塞げていないもの)

- **複製そのものはアプリ側で検証していない**。`HOST_BACKUP_DIR` を複製先に向けても、**その先の同期が
  止まっていることをアプリは検知できない**。検知できるのは「バックアップが取れているか」までで、
  「複製されているか」は運用者が上記の確認手順で見る必要がある
- **定期的な restore drill が自動化されていない**。日次の復元検証 (V1/V2/V3) は取得物を毎回別インスタンスへ
  復元して行うため「復元可能性」は毎日確認されるが、**本番ディレクトリへ戻す手順そのもの**の実行は
  本 Runbook の手動実施に依存する
