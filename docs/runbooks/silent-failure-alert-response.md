# 沈黙する障害の alert 一次対応 runbook

「エラーが飛ばないまま壊れている」種類の障害 2 件について、**何を見て何を判断するか**を定める。
どちらも例外にならないため、Lambda Errors / 5xx といった既存 alarm では表面化しない。

| alert | 何が起きている | 通知経路 |
|---|---|---|
| `ganbari-quest-auth-entitlement-db-unavailable` (CloudWatch Alarm) | 課金状態を DB から解決できず、認証済みユーザーが 503 を受けている (#3998) | SNS `ganbari-quest-ops-alerts` (既存 alarm と同一) |
| `stripe-webhook-undelivered` (Discord alert) | Stripe webhook がアプリに届かず、支払い済みのプランが反映されていない (#3959) | Discord (`sendDiscordAlert` 経由) |
| `stripe-webhook-monitor-failed` (Discord alert) | 上の未達検知 cron 自体が失敗しており、未達を検知できていない (#3959) | Discord (`sendDiscordAlert` 経由) |

triage に必要な id (`oldestEventId` / `sampleCheckoutEventId` 等) は Discord embed の
**Details field** と CloudWatch の log 本文の両方に `key=value` 形式で出る。

---

## 1. `auth-entitlement-db-unavailable` — entitlement 解決の fail-closed

### 1.1 何が起きているか

`resolveTenantEntitlement` (`src/lib/server/auth/tenant-entitlement.ts`) は毎リクエストで
テナントの課金状態を DB から引く。引けなかった場合、**古い Cookie の値で有料機能を通し続けない**ため
context を発行せず (fail-closed)、`hooks.server.ts` が 503 を返す。

したがってこの alarm は「**DB が読めていない間、認証済みユーザーが軒並み弾かれている**」ことを意味する。
ユーザーには「一時的にご利用いただけません」が表示され、ログアウトはされていない。

### 1.2 発火条件

この事象は `hooks.server.ts` から Discord にも通知される。ただし Discord 側は同一 `errorSummary` で
5 分 3 件までにまとめられ以降は無音になるため、**件数と継続の判断は SNS (本 alarm) が正**。
Discord だけを見て「収まった」と判断しない。

`GanbariQuest/Auth` / `EntitlementDbUnavailable` が **15 分 (5 分 window × 3) のうち 2 つの window で
1 件以上**（`threshold: 1` / `evaluationPeriods: 3` / `datapointsToAlarm: 2`、`infra/lib/ops-stack.ts`）。
1 件 = 503 になったリクエスト 1 本。**件数ではなく継続時間で判定する**ため、契約世帯が少なく
夜間に 1 件しか出ない規模でも 5 分以上続けば鳴り、DSQL の瞬断・OCC 競合による単発失敗
（1 window で収まる）では鳴らない。

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

### 1.5 実機での発火確認 (deploy 直後に 1 度実行する)

filter は「定義されているが 1 件もマッチしない」形で壊れうる。deploy 後、**アプリを壊さずに
log を 1 行注入して metric が立つこと**を確かめる。

> **注入は監査証跡を汚す**。この LogGroup は課金 path の post-mortem 用に 30 日保持されており、
> 注入した行は本物の障害行と文字列上区別できない。実行するときは (a) 専用 log stream
> (`alarm-firecheck-*`) にのみ書く (b) 確認後にその stream を消す (c) 実行日時と実行者を
> 本節に追記するのではなく PR / Issue に残す、の 3 点を守る。後日の調査で「その時刻の
> `[auth-alert]` は本物か」を判定できる状態にしておくこと。

```bash
# 1. 注入先の log stream を 1 本用意する
LG=/aws/lambda/ganbari-quest-app
LS="alarm-firecheck-$(date +%s)"
aws logs create-log-stream --log-group-name "$LG" --log-stream-name "$LS"

# 2. hooks.server.ts が 503 時に出すのと同じ形の行を入れる。
#    alarm は `datapointsToAlarm: 2` = **異なる 2 つの 5 分 window** で 1 件以上を要求するため、
#    1 回の put では (何行入れても同一 window に落ちるので) 永久に ALARM にならない。
#    **6 分あけて 2 回 put する**こと。
put_firecheck() {
  aws logs put-log-events --log-group-name "$LG" --log-stream-name "$LS" --log-events "$(
    printf '[{"timestamp":%d,"message":"[ERROR] [auth-alert] auth-entitlement-db-unavailable: firecheck"}]' \
      "$(($(date +%s) * 1000))"
  )"
}

put_firecheck            # window 1
sleep 360                # 5 分 window をまたぐ (6 分)
put_firecheck            # window 2 → ここで datapointsToAlarm=2 を満たす

# 3. 2 つの 5 分 window それぞれに値が立つことを確認 (反映まで数分)
#    Sum が 1 の datapoint が 2 つ並んでいなければ window をまたげていない → 2 回目の put をやり直す
aws cloudwatch get-metric-statistics \
  --namespace GanbariQuest/Auth --metric-name EntitlementDbUnavailable \
  --start-time "$(date -u -d '30 minutes ago' +%Y-%m-%dT%H:%M:%SZ)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --period 300 --statistics Sum

# 4. alarm が ALARM に遷移し SNS が飛んだことを確認 → 数分後に OK へ戻る
aws cloudwatch describe-alarms --alarm-names ganbari-quest-auth-entitlement-db-unavailable \
  --query 'MetricAlarms[0].[StateValue,StateReason]'
```

注入した log stream は確認後に削除してよい (`aws logs delete-log-stream`)。
metric が 0 のままなら、filter pattern と実 log 行の形が合っていない
(`ENTITLEMENT_FAIL_CLOSED_LOG_TERM` と `hooks.server.ts` の出力を突き合わせる)。

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

#### どちらの alert も鳴らない穴 (#4108、既知)

**handler が例外を握り潰して 200 を返す経路では、上の表のどちらの alert も鳴らない。**

| | 理由 |
|---|---|
| `stripe-webhook-handler-failed` が鳴らない | 同 alert は handler の throw を前提にしている。#4108 の経路 (`resolveSubscriptionContext` の bare catch → 呼び出し側が正常終了) では throw しない |
| `stripe-webhook-undelivered` が鳴らない | 200 を返したので Stripe 側は配信成功扱い = `pending_webhooks = 0` → S1 (滞留) が偽。本 alert は S1 ∧ S2 を条件にするため、S2 (plan 未反映) 単独では発火しない |

したがって **「支払い済みなのに plan が反映されない」という顧客申告が来たのに alert が 1 つも
鳴っていない**場合、それは「異常が無い」ことを意味しない。#4108 の経路を疑い、§2.3 の手順 3
(checkout session → `metadata.tenantId` → 実プラン照合) を **alert を待たずに**実行する。

恒久対処 (throw しない障害経路の re-throw + fitness function) は #4108 が所有する。

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

なお本 alert は 5 分 window の throttle 対象だが cron は毎時実行のため throttle は効かない。
**未達が続く間は 1 時間に 1 通鳴り続ける** (止めたい場合は原因を直すか cron を止める)。

### 2.5 `stripe-webhook-monitor-failed` — 検知器が動いていない

未達検知 cron が例外で終了した (Stripe API 障害 / rate limit / DB 障害)。**検知が止まっている間の
未達は誰も気づけない**ため、未達そのものと同じ重さで扱う。

alert には例外クラス名しか載せていない (接続情報を Discord に出さないため)。詳細は CloudWatch:

```
fields @timestamp, @message
| filter @message like "stripe-webhook-delivery-check] cron failed"
| sort @timestamp desc
| limit 20
```

- Stripe 側の一時障害 / rate limit → 次の実行 (1 時間後) で自然復旧するか見る。復旧しなければ
  Stripe の status を確認する。
- DB (DSQL) 側 → `docs/runbooks/dsql-alert-response.md`。
- 復旧まで未達検知は動いていないため、**その間の課金は §2.3 の手順で手動確認する**。

---

## 関連

- `docs/design/13-AWSサーバレスアーキテクチャ設計書.md` §3.3 (Cron ジョブ一覧) / §3.4 (監視)
- `docs/runbooks/dsql-alert-response.md` (DB 側の一次対応)
- `docs/operations/stripe-post-mortem-runbook.md` (課金 incident の事後分析)
