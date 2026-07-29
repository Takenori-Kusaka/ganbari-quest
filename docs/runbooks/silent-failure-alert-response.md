# 沈黙する障害の alert 一次対応 runbook

「エラーが飛ばないまま壊れている」種類の障害 2 件について、**何を見て何を判断するか**を定める。
どちらも例外にならないため、Lambda Errors / 5xx といった既存 alarm では表面化しない。

| alert | 何が起きている | 通知経路 |
|---|---|---|
| `ganbari-quest-auth-entitlement-db-unavailable` (CloudWatch Alarm) | 課金状態を DB から解決できず、認証済みユーザーが 503 を受けている (#3998) | SNS `ganbari-quest-ops-alerts` (既存 alarm と同一) |
| `stripe-webhook-undelivered` (Discord alert) | Stripe webhook がアプリに届かず、支払い済みのプランが反映されていない (#3959) | Discord (`sendDiscordAlert` 経由) |

---

## 1. `auth-entitlement-db-unavailable` — entitlement 解決の fail-closed

### 1.1 何が起きているか

`resolveTenantEntitlement` (`src/lib/server/auth/tenant-entitlement.ts`) は毎リクエストで
テナントの課金状態を DB から引く。引けなかった場合、**古い Cookie の値で有料機能を通し続けない**ため
context を発行せず (fail-closed)、`hooks.server.ts` が 503 を返す。

したがってこの alarm は「**DB が読めていない間、認証済みユーザーが軒並み弾かれている**」ことを意味する。
ユーザーには「一時的にご利用いただけません」が表示され、ログアウトはされていない。

### 1.2 発火条件

`GanbariQuest/Auth` / `EntitlementDbUnavailable` が **5 分間に 5 件以上**。
1 件 = 503 になったリクエスト 1 本。DSQL の瞬断・OCC 競合による単発失敗では鳴らない。

### 1.3 一次対応

1. **範囲を測る**: CloudWatch Logs Insights で 503 の件数と対象テナント数を見る。

   ```
   fields @timestamp, @message
   | filter @message like "auth-entitlement-db-unavailable"
   | sort @timestamp desc
   | limit 50
   ```

   `[auth-alert] ...` の行が 503 応答、`[AUTH] ...` の行が DB 解決失敗そのもの。
   後者だけが出て前者が出ていない場合は、health probe 等の除外パス
   (`ENTITLEMENT_FAILURE_EXEMPT_PATHS`) のみで発生しており顧客影響は無い。

2. **DB 側を見る**: DSQL のメトリクスと `docs/runbooks/dsql-alert-response.md` を参照する。
   本 alarm は原因ではなく結果であり、ほぼ常に DB 側の事象が先にある。

3. **判断**:
   - DSQL 側に障害の裏付けがある → DB 復旧を待つ。アプリ側の対処は不要 (復旧すれば alarm は OK に戻り、
     OK 通知も同じ SNS に届く)。**fail-closed を外して古い権限で通す回避はしない** (課金・権限の
     正しさを可用性より優先する PO 判断、#3963)。
   - DSQL は健全なのに鳴っている → アプリ側の DB 接続・認証 (IAM token) を疑う。直近の deploy を確認する。

### 1.4 誤検知でないことの確認

alarm が鳴っているのに 503 が観測できない場合、metric filter と log の形が合っていない可能性がある。
両者の一致は `tests/unit/infra/entitlement-fail-closed-alarm.test.ts` が CI で検証しているため、
まず同 test が緑かを確認する。

---

## 2. `stripe-webhook-undelivered` — Stripe webhook の未達

### 2.1 何が起きているか

Stripe 側に「まだ 2xx を返していない」event が 30 分以上残っており、**かつ** 支払いが成立したはずの
tenant にプランが反映されていない。2026-07-26 の incident (CloudFront edge がリクエストを 403 で弾き、
リクエストが Lambda に 1 度も到達しなかった) と同型の状態。

検知は cron `stripe-webhook-delivery-check` (毎時 5 分) が行う。実装とその判定条件は
`src/lib/server/services/stripe-webhook-delivery-monitor.ts` が SSOT。

### 2.2 `stripe-webhook-handler-failed` との読み分け

| 見えているもの | 意味 | 次に見る場所 |
|---|---|---|
| `stripe-webhook-undelivered` のみ | event がアプリに届いていない | 配信経路 (CloudFront / WAF / DNS / Stripe の宛先設定) |
| `stripe-webhook-handler-failed` のみ | 届いているが handler が失敗している | アプリの例外 log |
| 両方 | 恒久的な handler 失敗で顧客影響も出ている | アプリの例外 log を優先 |

`stripe-webhook-undelivered` は「滞留」と「顧客影響」の両方が揃ったときだけ鳴るため、
**単独で鳴っているなら経路側を先に疑う**。

### 2.3 一次対応

1. **Stripe 側の事実を確認する**: Stripe Dashboard の Developers > Webhooks で対象 endpoint の
   最近の配信を見る。alert の `oldestEventId` を Events から開き、`pending_webhooks` と
   `webhooks_delivered_at` を確認する。

2. **経路を確認する**: webhook の宛先 URL に対して外部から到達できるか (403 / 404 / 5xx のどれか) を見る。
   CloudFront の geo restriction は Stripe (海外 IP) を弾くため、**日本国内からの疎通確認は根拠にならない**
   (2026-07-26 の原因がこれ)。CloudFront のアクセス log / メトリクスで 403 の増加を見る。

3. **顧客影響を確定させる**: alert の `sampleCheckoutEventId` から checkout session を開き、
   `metadata.tenantId` の tenant が実際に無料プランのままかを確認する。

4. **復旧**:
   - 経路を直した後、Stripe Dashboard または `stripe events resend <event_id>` で滞留分を再送する
     (Stripe の保持期間は 30 日)。
   - 再送で反映されたことを、対象 tenant のプラン表示で確認する。
   - 経路の恒久対処は #3957、取りこぼしの突合は #3958 が扱う。

### 2.4 鳴らない場合の確認

Stripe を持たない環境 (staging / NUC / ローカル) では検査自体を行わない (`skipped: 'stripe-disabled'`)。
本番で cron が動いているかは、cron endpoint の完了 log (`[stripe-webhook-delivery-check] endpoint completed`)
が毎時出ているかで確認する。出ていなければ EventBridge Rule / cron-dispatcher 側を疑う
(登録の drift は `tests/unit/cron/schedule-consistency.test.ts` が CI で検出する)。

---

## 関連

- `docs/design/13-AWSサーバレスアーキテクチャ設計書.md` §3.3 (Cron ジョブ一覧) / §3.4 (監視)
- `docs/runbooks/dsql-alert-response.md` (DB 側の一次対応)
- `docs/operations/stripe-post-mortem-runbook.md` (課金 incident の事後分析)
