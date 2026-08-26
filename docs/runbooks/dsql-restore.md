# Runbook — DSQL + S3 assets 復元 (AWS Backup) + backup 役割分担

本番 Aurora DSQL (us-east-1) と、子供の写真・声を置く S3 `ganbari-quest-assets-<account>` の災害復旧手順。#3437 / #4724 / EPIC #3424。実装 SSOT: `infra/lib/dsql-stack.ts` (`DsqlBackupVault` / `DsqlBackupPlan` / 2 selection) + `infra/lib/storage-stack.ts` (`AssetsBucket` のバージョニング)。

**DSQL だけ復元しても顧客の復元にはならない。** アバター写真と録音は S3 にあり、DSQL の行だけ戻しても画面には出ない。本 runbook の復元は §復元手順 の 1〜5 (DSQL) と §S3 assets の復元 の両方を通して初めて完了する。

## 2 層 backup の役割分担 (#3437 AC1)

| 層 | 実体 | 目的 | 粒度 | 復元先 |
|---|---|---|---|---|
| **物理 backup (DB)** | AWS Backup (cluster full snapshot) | **基盤災害復旧** (cluster 消失・破損・region 障害) | **cluster 全体のみ** (テーブル/行単位は不可) | **新 cluster** (source 上書きなし) |
| **物理 backup (ファイル、#4724)** | AWS Backup (S3 backup) + バケットのバージョニング | **子供の写真・声の誤削除 / 誤上書きからの復旧** | オブジェクト単位 (バージョニング) / バケット・prefix 単位 (AWS Backup) | 同一バケット (バージョン復元) or 別 prefix / 別バケット (AWS Backup restore) |
| **論理 backup** | アプリ層 backup-archive (JSON/CSV、#3376) | **ユーザー操作・移行・per-tenant 復元** | tenant 単位の論理データ | 既存 cluster へ import |

- **DSQL の AWS Backup は full snapshot のみ (PITR / 継続 backup ではない)**。RPO = 直近の日次 backup 時刻 (02:00 UTC)。秒単位の point-in-time 復元は不可 (それは provisioned Aurora の機能で DSQL は非対応)。細かい復元要求はアプリ層 backup-archive で担保する。
- **backup / restore は AWS Backup (console / CLI / SDK) からのみ**。DSQL console からは実行不可。
- backup plan: 日次 02:00 UTC / 7 日保持 / vault = `ganbari-quest-dsql-vault` (RETAIN)。**selection は 2 本** — DSQL cluster ARN と S3 `ganbari-quest-assets-<account>` (#4724)。同じ plan / vault に載せることで復元時点が揃い、失敗通知 rule も 1 本で両方を拾う。
- **S3 backup の前提 2 つ** (#4724、CDK では表現できないので deploy 時に確認する):
  1. バケットのバージョニングが有効 (`infra/lib/storage-stack.ts` の `versioned: true`)。Storage stack を先に deploy する
  2. リージョンの Service opt-in で S3 が有効。**false のままだと backup job が走らず、失敗すらせず何も取れない** (一番気付けない壊れ方)

  ```bash
  aws backup describe-region-settings --region us-east-1     --query 'ResourceTypeOptInPreference.S3'                 # true であること
  aws backup update-region-settings --region us-east-1     --resource-type-opt-in-preference S3=true                # false だったら有効化
  ```
- **IAM role**: backup / restore とも CDK が確定生成する **`ganbari-quest-dsql-backup-role`** を使う (`AWSBackupServiceRolePolicyForBackup` + `AWSBackupServiceRolePolicyForRestores` + S3 用の `AWSBackupServiceRolePolicyForS3Backup` + `AWSBackupServiceRolePolicyForS3Restore` の 4 managed policy を付与済。S3 用 2 本が無いと S3 backup job は AccessDenied で落ち続ける)。console 初回操作でしか作られない `AWSBackupDefaultServiceRole` には依存しない (IaC 環境で未 provision の事故を防止、#3437 F-4)。ARN は `DsqlStack` の `BackupRoleArn` output で配布される。
- **backup 失敗の検知**: 日次 backup ジョブが失敗すると EventBridge Rule `ganbari-quest-dsql-backup-failed` が `Backup Job State Change` (state=FAILED/ABORTED/EXPIRED) を捕捉し `DsqlAlerts` SNS (opsEmail) へ通知する。DSQL の唯一の DR 手段が silent fail するのを防ぐ (ADR-0024 (d))。

## 月額コスト設計 (< ¥10、マネタイズ整合)

backup は全 tenant 共有の 1 cluster 単位課金 (per-tenant ではない) のため、cluster 全体で月額 < ¥10 に抑える。

- **課金式**: AWS Backup warm storage = **$0.05/GB-month** (us-east-1、DSQL は cold tier 非対応)。月額 ≈ `retention_points(7) × ClusterStorageSize × $0.05`。
- **実測 (2026-07-17)**: ClusterStorageSize = **1.35 MiB** → 7 × 0.00132 GiB × $0.05 ≈ **$0.0005/月 ≈ ¥0.07/月** (¥10 の約 140 分の 1)。
- **¥10 到達点**: 7 日 retention では cluster ≈ **190 MiB** で ¥10 (≈$0.067)。現状の約 145 倍成長までは < ¥10。
- **hard 監視**: `DsqlBackupBudget` ($0.07 ≈ ¥10、AWS Backup service filter) が 80% / 100% で通知する。
- **¥10 接近時の対処**: budget 通知が来たら **retention_points を短縮** する (`dsql-stack.ts` の `deleteAfter` を 7→3 日等)。7→3 で月額 3/7 に、tenant 単位細粒度復元は論理 backup-archive が担保するため DR 実害は小。復元 RPO が要件を満たす範囲で最短化する。

## post-deploy backup smoke (#3808 / ADR-0024 (c))

CDK 単体テストは synth 段階のみの検証のため、AWS 上の backup 構成は `deploy.yml` の
`DSQL backup smoke test (#3808)` step が deploy 毎に機械検証する (fail = deploy fail 扱い):

| assert | 内容 | 失敗時の意味 |
|---|---|---|
| vault 実在 | `describe-backup-vault ganbari-quest-dsql-vault` | vault 消失 / stack drift |
| plan 実在 | `list-backup-plans` に `ganbari-quest-dsql-daily` | plan 消失 / rename drift |
| selection 整合 | selection が本番 DSQL cluster ARN + `ganbari-quest-dsql-backup-role` を指す | 対象外れ = backup が空回り |
| recovery point 鮮度 (条件付き) | 未生成なら正常 (日次 02:00 UTC のため deploy 直後に無いのが通常)。存在するのに最新が 48h 超なら hard fail | 日次 backup の沈黙停止 (DR 空白) |

### 初回 deploy 後の実発火確認 (one-time、on-demand backup)

日次 backup を待たずに「recovery point が実際に生成できる」ことを初回 deploy 後に 1 回確認する
(lifecycle 1 日で自動削除されるため恒常コストなし。CI には組み込まない — deploy 毎の full backup はコスト/時間の無駄):

```bash
ROLE_ARN=$(aws cloudformation describe-stacks --stack-name GanbariQuestDsql --region us-east-1 \
  --query "Stacks[0].Outputs[?OutputKey=='BackupRoleArn'].OutputValue" --output text)
CLUSTER_ARN=$(aws cloudformation describe-stacks --stack-name GanbariQuestDsql --region us-east-1 \
  --query "Stacks[0].Outputs[?OutputKey=='ClusterArn'].OutputValue" --output text)
JOB_ID=$(aws backup start-backup-job --region us-east-1 \
  --backup-vault-name ganbari-quest-dsql-vault \
  --resource-arn "$CLUSTER_ARN" --iam-role-arn "$ROLE_ARN" \
  --lifecycle DeleteAfterDays=1 --query 'BackupJobId' --output text)
aws backup describe-backup-job --backup-job-id "$JOB_ID" --region us-east-1 \
  --query '{state:State,message:StatusMessage}'   # COMPLETED まで数分間隔で再実行
```

### alarm (SNS→opsEmail) 実通知テスト (one-time)

`ganbari-quest-dsql-backup-failed` rule は実際の backup 失敗でしか発火しないため、経路を分けて確認する:

1. **rule pattern**: `aws events test-event-pattern` に `{"source":["aws.backup"],"detail-type":["Backup Job State Change"],"detail":{"state":["FAILED"],"backupVaultName":["ganbari-quest-dsql-vault"]}}` 相当のテストイベントを渡し match を確認
2. **SNS→email 疎通**: `aws sns publish --topic-arn <DsqlAlerts topic ARN> --subject "test" --message "DsqlAlerts 疎通テスト (#3808)"` を実行し opsEmail 受信を実確認 (subscription が PendingConfirmation のままだと届かない)

## 復元手順 (#3437 AC2)

> **前提**: 同時 restore は最大 4。復元は新 cluster を作成し **source cluster を上書きしない** (= 常にロールバック可能)。full-cluster 単位のみ。

### 1. recovery point を特定
```bash
aws backup list-recovery-points-by-backup-vault --backup-vault-name ganbari-quest-dsql-vault \
  --region us-east-1 --query 'RecoveryPoints[].{arn:RecoveryPointArn,created:CreationDate,status:Status}' --output table
```
復元したい時刻直前の `COMPLETED` な recovery point の ARN を選ぶ。

### 2. restore job を起動 (新 cluster が作られる)
```bash
# metadata は describe-recovery-point の RestoreMetadata を雛形にする
aws backup get-recovery-point-restore-metadata --backup-vault-name ganbari-quest-dsql-vault \
  --recovery-point-arn <RP_ARN> --region us-east-1
# --iam-role-arn は DsqlStack の BackupRoleArn output (= ganbari-quest-dsql-backup-role) を使う:
ROLE_ARN=$(aws cloudformation describe-stacks --stack-name GanbariQuestDsql --region us-east-1 \
  --query "Stacks[0].Outputs[?OutputKey=='BackupRoleArn'].OutputValue" --output text)
# 上記 metadata (deletionProtectionEnabled 等) を渡して restore
aws backup start-restore-job --recovery-point-arn <RP_ARN> --region us-east-1 \
  --iam-role-arn "$ROLE_ARN" \
  --resource-type AuroraDsql --metadata '<RestoreMetadata JSON>'
```
`aws backup describe-restore-job --restore-job-id <id>` で `COMPLETED` を待つ。

### 3. 新 cluster の endpoint を取得
```bash
aws dsql list-clusters --region us-east-1 --output table   # 新 cluster identifier を確認
# endpoint = <new-cluster-id>.dsql.us-east-1.on.aws
```

### 4. アプリを新 cluster へ切替 (DSQL_ENDPOINT 差替 + 再 deploy)
`compute-stack` は `-c dsqlEndpoint=<...>` / `-c dsqlClusterArn=<...>` context で Lambda の `DSQL_ENDPOINT` と `dsql:DbConnect` resource 限定を配線する (`infra/lib/compute-stack.ts`)。復元 cluster の endpoint / ARN を渡して再 deploy する:
```bash
gh workflow run deploy.yml --ref main   # deploy が DsqlStack Output から endpoint/ARN を解決
# 復元 cluster が別 stack 外の場合は手動 -c dsqlEndpoint=<new> -c dsqlClusterArn=<new> で cdk deploy
```
migration (schema) は cold start / deploy 時に `applyLazyStartupMigrations` が適用する。

### 5. 検証 + 旧 cluster 保持
```bash
curl -s https://ganbari-quest.com/api/health   # dataSource:dsql / schemaValid:true を確認
```
- 検証 OK まで **旧 cluster は削除しない** (即ロールバック可)。
- 復元が誤りだった場合は DSQL_ENDPOINT を旧 cluster に戻して再 deploy。

## S3 assets の復元 (#4724)

対象は `ganbari-quest-assets-<account>` の `tenants/<tenantId>/avatars|voices|generated/` と `exports/`。
**症状に応じて 2 経路がある。誤削除・誤上書きは (A) の方が速く、粒度も細かい。**

### (A) バージョン復元 — 誤削除 / 誤上書き 1 件〜数件

バージョニングが有効なので、上書き前のバイトと削除前のバイトはバケットに残っている
(非現行バージョンは 30 日で expire する = **気付いてから 30 日以内**)。

```bash
BUCKET=ganbari-quest-assets-$(aws sts get-caller-identity --query Account --output text)
KEY="tenants/<tenantId>/avatars/<childId>/<uuid>.webp"

# 1. そのキーの全バージョンを見る (削除されていれば DeleteMarkers に出る)
aws s3api list-object-versions --bucket "$BUCKET" --prefix "$KEY"   --query '{versions:Versions[].{id:VersionId,mtime:LastModified,latest:IsLatest},markers:DeleteMarkers[].{id:VersionId,mtime:LastModified,latest:IsLatest}}'

# 2-a. 削除された場合: delete marker を消せば直前のバージョンが現行に戻る
aws s3api delete-object --bucket "$BUCKET" --key "$KEY" --version-id <DeleteMarker の VersionId>

# 2-b. 上書きされた場合: 戻したいバージョンを同じキーへコピーし直す
aws s3api copy-object --bucket "$BUCKET" --key "$KEY"   --copy-source "$BUCKET/$KEY?versionId=<戻したい VersionId>"
```

**prefix ごと消えた場合** (退会処理の `deleteByPrefix` 誤爆) は、対象 prefix の delete marker を列挙して一括で消す:

```bash
aws s3api list-object-versions --bucket "$BUCKET" --prefix "tenants/<tenantId>/"   --query 'DeleteMarkers[?IsLatest==`true`].{Key:Key,VersionId:VersionId}' --output json > /tmp/markers.json
# 件数を目視してから実行する (消す対象が tenantId で正しく絞れているかを必ず確認)
# **prefix を打ち間違えると復旧手段そのものを永久破壊する** — delete-object --version-id は不可逆で、
# 誤って現行バージョンの VersionId を渡すと実体が消える。
# 上の list 結果が「DeleteMarkers かつ IsLatest==true」だけであることを目視してから進める。
jq -r '.[] | [.Key, .VersionId] | @tsv' /tmp/markers.json | while IFS=$'\t' read -r key vid; do
  aws s3api delete-object --bucket "$BUCKET" --key "$key" --version-id "$vid"
done
```

### (B) AWS Backup からの復元 — バケットごと失った / 30 日を超えた

```bash
ROLE_ARN=$(aws cloudformation describe-stacks --stack-name GanbariQuestDsql --region us-east-1   --query "Stacks[0].Outputs[?OutputKey=='BackupRoleArn'].OutputValue" --output text)
BUCKET=ganbari-quest-assets-$(aws sts get-caller-identity --query Account --output text)

# 1. S3 の recovery point を選ぶ (DSQL と同じ vault に入っている)
aws backup list-recovery-points-by-backup-vault --backup-vault-name ganbari-quest-dsql-vault   --region us-east-1 --by-resource-type S3   --query 'RecoveryPoints[].{arn:RecoveryPointArn,created:CreationDate,status:Status}'

# 2. **別 prefix へ復元する** (現行データを上書きしない)。metadata は describe-recovery-point で確認
aws backup start-restore-job --region us-east-1   --recovery-point-arn <上で選んだ ARN> --iam-role-arn "$ROLE_ARN" --resource-type S3   --metadata "DestinationBucketName=$BUCKET,NewBucket=false,ItemsToRestore=[],RestoreTime=,Encrypted=false"

aws backup describe-restore-job --restore-job-id <JobId> --region us-east-1   --query '{state:Status,message:StatusMessage}'
```

### (C) 復元の完了判定 — 子供の写真が実際に表示されるまで

**ファイルが S3 に戻っただけでは完了ではない。** 配信は `/tenants/[...path]` が認証 + tenantId 一致を
検査して返すため、以下まで確認する (#4580 G7 の実演範囲):

1. `aws s3api head-object --bucket "$BUCKET" --key "tenants/<tenantId>/avatars/<childId>/<uuid>.webp"` が 200
2. DSQL 側の `children` 行が同じキーを指している (DSQL を別時点に復元した場合、キーが食い違うことがある)
3. **その tenant の保護者アカウントでログインし、`/admin/children` でアバターが表示される**
4. 子供画面 (`/switch`) でもアバターが出る

3 と 4 が通って初めて「復元できた」と言える。1 だけで完了扱いにしない。

## エスカレーション
| 状況 | 行動 |
|---|---|
| 本番 cluster 消失・全 500 | priority:critical + PO 即報告。本手順で最新 recovery point から新 cluster 復元 |
| tenant 単位の誤削除・巻戻し | AWS Backup ではなく **アプリ層 backup-archive (JSON/CSV) で該当 tenant を import** (物理 restore は cluster 全体を巻き戻すため不適) |
| restore job が失敗 | `describe-restore-job` の StatusMessage 確認。metadata 不整合が典型 (IAM role は `ganbari-quest-dsql-backup-role` = backup/restore 両権限付きを使う) |
| 日次 backup ジョブが失敗 | `ganbari-quest-dsql-backup-failed` の SNS 通知が来る。`aws backup describe-backup-job --backup-job-id <id>` で原因確認 (cluster busy / 権限 / vault full 等)。連日失敗 = DR 空白のため priority:high |
| 子供の写真・声が消えた | まず §S3 assets の復元 (A) バージョン復元。**30 日以内かつ、バージョンを名指しで消す操作 (`purgeByPrefix` = 退会 / エクスポート削除) を経ていなければ**戻せる。バージョニングが守るのはアプリのバグと通常削除であって、version 指定削除や資格情報漏洩には無力である (Object Lock / MFA Delete は未導入)。30 日を超えている / バケットごと失った場合は (B) AWS Backup。復元後は (C) の 4 点まで確認する |
| backup job が PARTIAL で終わる | 一部オブジェクトだけ失敗している。`aws backup describe-backup-job` の StatusMessage を見る。`logs/` 配下の Glacier オブジェクトは AWS Backup for S3 の対象外で skip されるのが正常。**`tenants/` / `exports/` のオブジェクトが失敗していたら顧客ファイルが入っていない**ので priority:high |
| S3 の recovery point が 1 件も無い | リージョンの Service opt-in で S3 が false になっている可能性が高い (`aws backup describe-region-settings`)。この状態は job が失敗すらしないため失敗通知も出ない。有効化して次の日次を待つ |

## 関連
- 実装: `infra/lib/dsql-stack.ts` (backup vault/plan/role + 2 selection + 失敗検知 rule) + `infra/lib/storage-stack.ts` (assets バケットのバージョニング + 非現行 30 日 expire) + `tests/unit/infra/dsql-cdk.test.ts` [I8][I8c][I8d][N4] + `tests/unit/infra/assets-backup.test.ts` [V][B][S]
- 論理 backup: `src/lib/server/services/backup-archive.ts` (#3376) / データモデル §6.4
- alarm 一次対応: [dsql-alert-response.md](dsql-alert-response.md)
- AWS 公式: [Aurora DSQL backups](https://docs.aws.amazon.com/aws-backup/latest/devguide/backup-aurora.html) / [restore](https://docs.aws.amazon.com/aws-backup/latest/devguide/restore-auroradsql.html)
