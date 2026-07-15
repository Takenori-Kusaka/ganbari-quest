# Runbook — DSQL dashboard / Alarm 閾値超過時の一次対応

本番 DSQL (Aurora DSQL、us-east-1) の可観測性 dashboard `ganbari-quest-dsql` と alarm (#3431/#3432、`infra/lib/dsql-stack.ts` が SSOT) の閾値超過時に行う一次対応。staging は `-staging` suffix の同型 dashboard。メトリクスは CloudWatch 15 ヶ月保持のため過去比較は console で直接行える。

```bash
# dashboard を開く (us-east-1 固定)
# https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards/dashboard/ganbari-quest-dsql
# cluster 状態
aws dsql list-clusters --region us-east-1 --output table
# 直近 1h の対象 metric 実値 (例: OccConflicts)
aws cloudwatch get-metric-statistics --region us-east-1 --namespace AWS/AuroraDSQL \
  --metric-name OccConflicts --dimensions Name=ClusterId,Value=<cluster-id> \
  --start-time $(date -u -d '1 hour ago' +%FT%TZ) --end-time $(date -u +%FT%TZ) \
  --period 300 --statistics Sum
```

## Alarm: TotalDPU 日次 3,225 超過 (無料枠 10 万 DPU/月ペース超過)

**意味**: 使用量が無料枠ペースを超え課金が発生する軌道。Write DPU は Read の約 27 倍単価 (ADR-0065) のため、write 系の異常増が典型原因。

1. dashboard の TotalDPU (Sum) を日次で遡り、増加開始時点を特定する
2. 増加開始とアプリ側イベントを突合する: 直近 deploy / restore 実行 (772 行規模で ~80 DPU 相当) / cron 異常連打 (`aws logs tail /aws/lambda/ganbari-quest-cron-dispatcher --region us-east-1`)
3. 典型原因と対処:
   - **restore / import の多重実行** → 実行者確認。fail-atomic のため中断済みなら追加対応不要
   - **フルスキャン系クエリの混入** → 直近 merge の repo 変更を ADR-0065 原則 1 (PK prefix 必須) で review
   - **OccConflicts 同時増** → 下記 OccConflicts 項の retry 嵐と同根。そちらを先に収束させる
4. 課金軌道が継続する場合は Budgets alarm (下記) の 80% 通知を待たず PO へ報告

## Alarm: ClusterStorageSize 0.8 GiB 超過 (無料枠 1 GB の 80%)

**意味**: storage が無料枠に接近。単調増加 metric のため放置で必ず 100% に到達する。

1. 増加ペースを確認 (急増 = 異常データ、緩増 = 自然成長)
2. 急増時: 直近の restore 多重実行 / retention-cleanup cron の停止を疑う
   ```bash
   curl -X POST https://ganbari-quest.com/api/cron/retention-cleanup -H "x-cron-secret: <CRON_SECRET>" -d '{"dryRun": true}'
   ```
3. 自然成長時: プラン別 retention (ADR-0049) の物理削除対象拡張を PO と検討 (無料枠超過は月額数十円規模のため priority は低)

## Budgets: ganbari-quest-dsql-guardrail $1 の 80% / 100% 通知

**意味**: DSQL 由来コストの絶対上限ガード (月 $1)。TotalDPU alarm より遅い確定値ベース。

1. Cost Explorer は使わず (API $0.01/回、`infra/CLAUDE.md`)、Billing console → Budgets で内訳確認
2. TotalDPU / Storage の両 alarm 履歴と突合し原因 metric を特定 → 該当項の手順へ
3. 100% 通知時は PO 報告必須 (Pre-PMF のコスト規律)

## Dashboard 観測: OccConflicts 急増 (alarm なし、目視/調査起点)

**意味**: OCC write-write 衝突が commit 時に多発。正常値はほぼ 0 (実測 baseline: 通常運用で単発、#3425)。

1. 同時に CommitLatency / TotalDPU が増えていれば「retry 嵐」— occ-retry (maxAttempts=3) が同一 txn を反復している
2. 典型原因: **同一行への並行 write** (2026-07-15 の restore 障害と同 class — 共有行 update を持つ txn の並列実行)。直近 merge で `runConcurrent` / `Promise.all` に write txn を入れた変更がないか review
3. アプリ症状の確認: `VALIDATION_ERROR` / `Failed query: commit` がユーザー操作で出ていないか (Discord alert / CloudWatch Logs)
4. 恒久対処は「child/行単位の直列化 or write 束ね」(ADR-0065 原則 2)。`tests/integration/db/dsql-staging-concurrency.test.ts` で staging 再現→修正検証する

## Dashboard 観測: QueryTimeouts 発生 (5 分上限)

**意味**: DSQL の txn 5 分上限に接触するクエリがある。正常値 0。

1. 発生時刻と cron / restore / export の実行を突合 (長時間 txn の筆頭は一括処理)
2. ADR-0065 原則 5 (一括 3,000 行・10MiB チャンク) 違反の新規コードを疑う — `bulk-import.ts` の chunkByLimits を bypass した経路がないか
3. 再発時は該当経路をチャンク化 or 非同期 saga (#3692) へ寄せる

## Dashboard 観測: CommitLatency P50 劣化

**意味**: 正常 baseline は 2.87ms (staging 実測、#3425)。10ms 超が継続するなら異常。

1. OccConflicts 同時増 → retry 嵐 (上記)。単独劣化 → AWS 側事象の可能性、[AWS Health Dashboard](https://health.aws.amazon.com/) を確認
2. アプリ外形への影響を確認: `curl -s https://ganbari-quest.com/api/health` の応答時間 / e2e-production の直近結果

## Dashboard 観測: ClusterConnectionCount 上昇 (上限 10,000 / DbConnect 100 回/秒)

**意味**: 接続リーク or Lambda 同時実行の異常スパイク。connector pool (Lambda 実行コンテキスト再利用、#3426) では通常一桁。

1. Lambda 同時実行数と突合: `aws lambda get-function --function-name ganbari-quest-app --region us-east-1` + CloudWatch `ConcurrentExecutions`
2. 単調増加 (実行数と乖離) なら接続リーク — `dsql/connection.ts` の pool 生成が唯一の集約点のため、直近の接続系変更を review
3. 緊急時は Lambda の再 deploy (`gh workflow run deploy.yml --ref main`) でコンテキストを世代交代させる

## エスカレーション基準

| 状況 | 行動 |
|---|---|
| ユーザー操作にエラーが露出 (restore 失敗 / 500 系) | priority:critical Issue 起票 + PO 報告 |
| コスト系 (DPU/Storage/Budgets) のみで外形正常 | Issue 起票 (priority:medium)、月次で消化 |
| AWS 側事象疑い | AWS Health 確認 → 収束待ち。30 分超継続で PO 報告 |

## 関連

- 実装 SSOT: `infra/lib/dsql-stack.ts` (dashboard / alarm / budget) + `tests/unit/infra/dsql-cdk.test.ts` (閾値の回帰 pin)
- クエリ規約: [ADR-0065](../decisions/0065-dsql-dpu-query-rules.md) (DPU 5 原則、実測 baseline)
- テナント分離: [ADR-0063](../decisions/0063-dsql-pool-multitenant-isolation.md)
- 並行検証手段: `tests/integration/db/dsql-staging-concurrency.test.ts` / `dsql-staging-import-restore.test.ts` (DSQL_ENDPOINT gate、#3683)
