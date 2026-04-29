# Cron 3 endpoints 検証手順 (Sub A-3 / #1377)

> **目的**: Umbrella A 統一 scheduler 基盤 (`#1374`) の Sub A-3 として、既存 3 cron endpoint
> (`license-expire` / `retention-cleanup` / `trial-notifications`) が NUC 側 (#1375) と
> AWS 側 (#1376) の両基盤で正しく動作することを検証する手順を定める。

## §1. 設計背景

Sub A-1 (#1375 NUC scheduler) と Sub A-2 (#1376 AWS EventBridge) で基盤は構築されたが、
**既存 3 endpoint が新基盤経由で正しく呼ばれているか** は別レイヤの検証が必要。
特に以下の silent fail パターンを想定:

| シナリオ | 過去事例 | 検出方法 |
|---------|---------|---------|
| 認証ヘッダ不一致で 401 silent fail | #1377 で発見 (verifyCronAuth が `x-cron-secret` のみ受け付け、AWS dispatcher の `Authorization: Bearer` を弾いていた) | unit test + dryRun smoke test |
| 環境変数未設定で起動時 throw | #1586 (CRON_SECRET 不在で dispatcher が 2 日間 fail) | CDK synth-time validation |
| schedule SSOT drift (registry / CDK / dispatcher の三者) | #1377 で恒久対策 | `tests/unit/cron/schedule-consistency.test.ts` |

## §2. 設計原則

| 原則 | 理由 |
|------|------|
| **CRON_SECRET の bypass 禁止** | Issue #1377 禁止事項。bypass すると本番で誰でも /api/cron/* を叩ける |
| **idempotent 保証** | 1 日に複数回起動しても安全 (リトライ・手動 invoke 用) |
| **両ヘッダ受け入れ** (`x-cron-secret` / `Authorization: Bearer`) | NUC scheduler / AWS dispatcher の双方互換 |
| **Dev 自動検証 + PO AWS 手動検証の責務分離** | Dev は Issue 仕様で AWS CLI 権限なし。AWS 実機検証は PO が PR comment で実施 |
| **silent fail 検出を CDK synth + smoke test で 2 段に** | post-deploy 即時検出 (#1586 教訓) |

## §3. 検証手順

### §3.1. Dev (ユニットテスト + 静的検査)

PR レビュー時 + ローカル開発時に必ず実行する。

```bash
# 1. consistency 検証 (registry / CDK / dispatcher の三者整合性)
npx vitest run tests/unit/cron/schedule-consistency.test.ts

# 2. 認証ヘッダ受け入れ (Authorization: Bearer + x-cron-secret 両対応)
npx vitest run tests/unit/routes/cron-auth-3-endpoints.test.ts

# 3. idempotency (2 回連続実行で副作用が増えないこと)
npx vitest run tests/unit/services/cron-idempotency.test.ts

# 4. observability 静的検査 (logger / Alarm 定義の存在確認)
npm run check:cron-observability

# 5. 既存 service テスト (退行確認)
npx vitest run tests/unit/services/retention-cleanup-service.test.ts
npx vitest run tests/unit/services/trial-notification-service.test.ts
```

期待値: すべて pass。1 件でも fail したら本基盤が壊れている。

### §3.2. NUC (docker-compose scheduler コンテナ)

```bash
# 前提: CRON_SECRET が .env に設定されていること
# (deploy-nuc.yml の Generate .env ステップで自動設定済み)

# scheduler コンテナを含めて起動
ssh <NUC_USER>@<NUC_HOST> "cd <NUC_APP_DIR> && docker compose --profile scheduler up -d"

# scheduler 登録確認 (起動ログに 9 jobs registered と出る)
ssh <NUC_USER>@<NUC_HOST> "cd <NUC_APP_DIR> && docker compose logs scheduler | head -30"

# 期待出力:
#   [scheduler] registered: license-expire (0 0 * * * JST) → http://app:3000/api/cron/license-expire
#   [scheduler] registered: retention-cleanup (0 1 * * * JST) → http://app:3000/api/cron/retention-cleanup
#   [scheduler] registered: trial-notifications (0 9 * * * JST) → http://app:3000/api/cron/trial-notifications
#   ...
#   [scheduler] started. APP_URL=http://app:3000, jobs=9

# 手動 dryRun テスト (副作用なし)
ssh <NUC_USER>@<NUC_HOST> "curl -s -X POST http://localhost:3000/api/cron/retention-cleanup \
  -H 'x-cron-secret: <CRON_SECRET>' -H 'Content-Type: application/json' -d '{\"dryRun\": true}'"

# 期待: HTTP 200, body: { "ok": true, "dryRun": true, ... }
```

### §3.3. AWS (PO 責務 — Issue #1377 仕様で designated)

> Dev session には AWS CLI 権限がないため、以下のコマンドは **PO が実行し PR comment に貼付** する。
> これは「申し送り」ではなく Issue 設計時点で PO scope として明示済み (#1377 本文「開発チームへの注記 (AWS CLI 権限)」参照)。

```bash
# 1. EventBridge Rule の登録確認 (Sub A-3 対象 3 rule 含む全 6 rule)
aws events list-rules --name-prefix ganbari-quest-cron --region us-east-1

# 期待: 以下の name で 6 件以上 (#1377 時点 6 rule, #1601/#1598/#1693 で増加)
#   - ganbari-quest-cron-license-expire
#   - ganbari-quest-cron-retention-cleanup
#   - ganbari-quest-cron-trial-notifications
#   - ganbari-quest-cron-lifecycle-emails
#   - ganbari-quest-cron-pmf-survey
#   - ganbari-quest-cron-analytics-aggregator-daily

# 2. dispatcher Lambda の dryRun smoke test (deploy.yml で自動実行済みだが手動でも可能)
for job in license-expire retention-cleanup trial-notifications; do
  aws lambda invoke \
    --function-name ganbari-quest-cron-dispatcher \
    --payload "{\"cronJob\":\"$job\",\"dryRun\":true}" \
    --cli-binary-format raw-in-base64-out \
    --region us-east-1 \
    "/tmp/cron-${job}.json"
  echo "=== $job ==="
  cat "/tmp/cron-${job}.json"
  echo
done

# 期待: 各 invoke で {"statusCode":200,"jobName":"<job>","dryRun":true}

# 3. CloudWatch Logs での実行ログ確認 (schedule 時刻前後)
aws logs tail /aws/lambda/ganbari-quest-cron-dispatcher --region us-east-1 \
  --since 24h | grep -E "(license-expire|retention-cleanup|trial-notifications)"

# 期待: schedule 時刻に dispatcher → endpoint が呼ばれた形跡 (status 200)

# 4. 本番 invoke (dryRun なし — 実ジョブ実行)
# 注意: retention-cleanup / license-expire は副作用あり。本番で手動 invoke する際は注意
aws lambda invoke \
  --function-name ganbari-quest-cron-dispatcher \
  --payload '{"cronJob":"trial-notifications"}' \
  --cli-binary-format raw-in-base64-out \
  --region us-east-1 \
  /tmp/trial-notif-result.json
cat /tmp/trial-notif-result.json
```

### §3.4. 共通検証 (failure / idempotency)

```bash
# A. 認証エラー (CRON_SECRET 不一致)
curl -s -X POST <APP_URL>/api/cron/retention-cleanup \
  -H 'Authorization: Bearer wrong-secret' -H 'Content-Type: application/json' -d '{}'
# 期待: HTTP 401 / body: { "error": "Unauthorized" }

# B. 認証ヘッダなし
curl -s -X POST <APP_URL>/api/cron/retention-cleanup
# 期待: HTTP 401 (production) / 200 or 500 (AUTH_MODE=local)

# C. 冪等性 (2 回連続 dryRun=false で副作用が増えないこと)
# license-expire: 1 回目で revoke=N, 2 回目で revoke=0 になる
# retention-cleanup: 1 回目で activityLogsDeleted=N, 2 回目で 0
# trial-notifications: 同じ日付で再実行しても sent が増えない
#   (notification-service が `getNotificationSchedule` で日付閾値判定)
```

### §3.5. CloudWatch Alarm の確認 (PO)

```bash
aws cloudwatch describe-alarms \
  --alarm-names ganbari-quest-cron-dispatcher-errors \
  --region us-east-1
# 期待: StateValue=OK (エラーが連続発生していない)
```

異常時 (`StateValue=ALARM`) は SNS topic `ganbari-quest-ops-alerts` から通知が届く。

## §4. 検証完了の判定

以下が **すべて** 通れば Sub A-3 検証完了。

- [x] §3.1 Dev unit tests 全 pass (PR CI で自動検証)
- [ ] §3.2 NUC scheduler ログに 3 endpoint 登録確認
- [ ] §3.3 AWS EventBridge rule list-rules で 3 rule 確認 (PO)
- [ ] §3.3 dispatcher dryRun smoke test 全 200 (PO, deploy.yml で自動化済み)
- [ ] §3.3 CloudWatch Logs に schedule 時刻の実行ログ (PO)
- [ ] §3.4 認証エラー / idempotency の挙動確認

## §5. 関連ファイル

| ファイル | 役割 |
|---------|------|
| `src/lib/server/cron/schedule-registry.ts` | スケジュール SSOT (name / endpoint / cron 式) |
| `src/lib/server/auth/cron-auth.ts` | `verifyCronAuth` (#1377 で両ヘッダ受け入れ拡張) |
| `src/routes/api/cron/license-expire/+server.ts` | endpoint (#1377 で verifyCronAuth に統一) |
| `src/routes/api/cron/retention-cleanup/+server.ts` | endpoint |
| `src/routes/api/cron/trial-notifications/+server.ts` | endpoint |
| `infra/lib/compute-stack.ts` | CDK CRON_JOBS インライン定義 + EventBridge Rule + dispatcher Lambda |
| `infra/lambda/cron-dispatcher/index.ts` | dispatcher Lambda (KNOWN_ENDPOINTS) |
| `infra/lib/ops-stack.ts` | CronDispatcherErrors Alarm |
| `scripts/scheduler.ts` | NUC scheduler コンテナ entrypoint |
| `docker-compose.yml` | scheduler service (profile=scheduler) |
| `tests/unit/cron/schedule-consistency.test.ts` | registry / CDK / dispatcher 整合性 |
| `tests/unit/routes/cron-auth-3-endpoints.test.ts` | 認証共通テスト |
| `tests/unit/services/cron-idempotency.test.ts` | idempotency テスト |
| `scripts/check-cron-observability.mjs` | observability 静的検査 |

## §6. 関連 Issue / ADR

- #1374 Umbrella A 統一 scheduler 基盤
- #1375 Sub A-1 NUC scheduler (CLOSED)
- #1376 Sub A-2 AWS EventBridge (CLOSED)
- #1377 Sub A-3 既存 3 endpoint 検証 (本 runbook)
- #1586 dispatcher silent fail 修復 + post-deploy smoke test 追加
- ADR-0006 Safety Assertion Erosion Ban (silent skip 禁止)
- ADR-0010 Pre-PMF スコープ判断 (過剰な scheduler library 採用禁止)
- ADR-0020 NUC スケジューラ方式選定 (node-cron + 専用コンテナ)
- ADR-0024 インフラ PR 必須要件 (silent skip 禁止 / smoke test / Alarm 必須)
