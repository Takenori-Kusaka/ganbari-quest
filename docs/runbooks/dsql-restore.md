# Runbook — DSQL 復元 (AWS Backup) + backup 役割分担

本番 Aurora DSQL (us-east-1) の災害復旧手順。#3437 / EPIC #3424。実装 SSOT: `infra/lib/dsql-stack.ts` (`DsqlBackupVault` / `DsqlBackupPlan`)。

## 2 層 backup の役割分担 (#3437 AC1)

| 層 | 実体 | 目的 | 粒度 | 復元先 |
|---|---|---|---|---|
| **物理 backup** | AWS Backup (cluster full snapshot) | **基盤災害復旧** (cluster 消失・破損・region 障害) | **cluster 全体のみ** (テーブル/行単位は不可) | **新 cluster** (source 上書きなし) |
| **論理 backup** | アプリ層 backup-archive (JSON/CSV、#3376) | **ユーザー操作・移行・per-tenant 復元** | tenant 単位の論理データ | 既存 cluster へ import |

- **DSQL の AWS Backup は full snapshot のみ (PITR / 継続 backup ではない)**。RPO = 直近の日次 backup 時刻 (02:00 UTC)。秒単位の point-in-time 復元は不可 (それは provisioned Aurora の機能で DSQL は非対応)。細かい復元要求はアプリ層 backup-archive で担保する。
- **backup / restore は AWS Backup (console / CLI / SDK) からのみ**。DSQL console からは実行不可。
- backup plan: 日次 02:00 UTC / 7 日保持 / vault = `ganbari-quest-dsql-vault` (RETAIN)。cluster ARN を明示 assign しているため AWS Backup の Service Opt-in は不要。

## 月額コスト設計 (< ¥10、マネタイズ整合)

backup は全 tenant 共有の 1 cluster 単位課金 (per-tenant ではない) のため、cluster 全体で月額 < ¥10 に抑える。

- **課金式**: AWS Backup warm storage = **$0.05/GB-month** (us-east-1、DSQL は cold tier 非対応)。月額 ≈ `retention_points(7) × ClusterStorageSize × $0.05`。
- **実測 (2026-07-17)**: ClusterStorageSize = **1.35 MiB** → 7 × 0.00132 GiB × $0.05 ≈ **$0.0005/月 ≈ ¥0.07/月** (¥10 の約 140 分の 1)。
- **¥10 到達点**: 7 日 retention では cluster ≈ **190 MiB** で ¥10 (≈$0.067)。現状の約 145 倍成長までは < ¥10。
- **hard 監視**: `DsqlBackupBudget` ($0.07 ≈ ¥10、AWS Backup service filter) が 80% / 100% で通知する。
- **¥10 接近時の対処**: budget 通知が来たら **retention_points を短縮** する (`dsql-stack.ts` の `deleteAfter` を 7→3 日等)。7→3 で月額 3/7 に、tenant 単位細粒度復元は論理 backup-archive が担保するため DR 実害は小。復元 RPO が要件を満たす範囲で最短化する。

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
# 上記 metadata (deletionProtectionEnabled 等) を渡して restore
aws backup start-restore-job --recovery-point-arn <RP_ARN> --region us-east-1 \
  --iam-role-arn <AWSBackupDefaultServiceRole ARN> \
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

## エスカレーション
| 状況 | 行動 |
|---|---|
| 本番 cluster 消失・全 500 | priority:critical + PO 即報告。本手順で最新 recovery point から新 cluster 復元 |
| tenant 単位の誤削除・巻戻し | AWS Backup ではなく **アプリ層 backup-archive (JSON/CSV) で該当 tenant を import** (物理 restore は cluster 全体を巻き戻すため不適) |
| restore job が失敗 | `describe-restore-job` の StatusMessage 確認。IAM role / metadata 不整合が典型 |

## 関連
- 実装: `infra/lib/dsql-stack.ts` (backup vault/plan) + `tests/unit/infra/dsql-cdk.test.ts` [I8][N4]
- 論理 backup: `src/lib/server/services/backup-archive.ts` (#3376) / データモデル §6.4
- alarm 一次対応: [dsql-alert-response.md](dsql-alert-response.md)
- AWS 公式: [Aurora DSQL backups](https://docs.aws.amazon.com/aws-backup/latest/devguide/backup-aurora.html) / [restore](https://docs.aws.amazon.com/aws-backup/latest/devguide/restore-auroradsql.html)
