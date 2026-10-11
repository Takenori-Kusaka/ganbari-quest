# Stripe 障害 post-mortem runbook (#2735)

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 最終更新 | 2026-06-01 |
| 対象 | Stripe lookup_key 解決失敗 / webhook handler typeerror / unknown event type |
| 想定実行者 | Dev (障害発生時 即時 triage) / PO (kill switch 発動判断) |
| 関連 ADR | ADR-0010 (Pre-PMF Bucket A) / ADR-0049 (retention) / ADR-0059 (Phase 7 cutover) |
| 関連 docs | `docs/design/billing-redesign/phase6-rollback-and-kill-switches.md` §3 §6 §S5/S6 |
| 関連 PR | #2727 (alert wrapper) / #2747 (PII redaction) / #2753 (yearly 物理削除) |

---

## 0. 本書の位置づけ

PR #2727 で配備した `notifyStripeAlert` wrapper (kind `stripe-lookup-failed` / `stripe-webhook-unknown-type` / `stripe-webhook-handler-typeerror`) の **alert 受信時の即時 triage 手順** を SSOT 化する。

Phase 7 PR-3b cutover (`USE_LOOKUP_KEY=true` 切替) 後の障害対応 MTTR (Mean Time To Recovery) を 5 分以内に維持するための「最低限のオペレーション SOP」として位置付ける。`docs/design/billing-redesign/phase6-rollback-and-kill-switches.md` §3 がリスクごとの詳細な「設計書」であるのに対し、本書は **障害発生時の実行手順** に特化する。

---

## 1. Stripe 障害 3 種 alert kind マップ (PR #2727 SSOT 整合)

`src/lib/server/stripe/alert.ts` `StripeAlertKind` の 3 種類。`docs/design/billing-redesign/phase6-rollback-and-kill-switches.md` §6 R1/R4/R5 SSOT 整合。

| alert kind | 起因 | severity | 課金 path 状態 | kill switch |
|---|---|---|---|---|
| `stripe-lookup-failed` | `getPriceByLookupKey()` で Stripe API 障害 / Price 未発行 | warning (fallback 成功) / error (致命) | `tags.fallbackUsed=true` で env var fallback 成功 = 継続 / `false` で停止 | `USE_LOOKUP_KEY=false` で env var 直読に戻す (Lambda env update、約 30 秒で反映) |
| `stripe-webhook-unknown-type` | webhook handler が未知の event type を受信 | warning | 該当 event のみ skip、他 event は継続 | (なし、新 event type のため別途対応) |
| `stripe-webhook-handler-typeerror` | webhook handler 内の typeerror (typo / data shape mismatch) | error | 該当 event 処理失敗、台帳に残さず 500 を返すため Stripe が再送する | (なし) 受信口の kill switch は持たない (#4128)。**再送で復旧する 3 日以内にコードを直す**のが唯一の対処 |
| `stripe-webhook-ledger-gap` (#4128) | Stripe が配信成功 (`pending_webhooks=0`) として扱っているのに `stripe_webhook_events` に記録が無い | error | **受け取った event を処理していない** = 課金状態が反映されない | (なし) §3.2 参照 |

---

## 2. 障害検知時の triage 手順 (5 分以内目標)

### Step 1. Discord channel で alert 受信確認

`#stripe-alerts` channel (運用 SOP の Discord webhook 配信先) に alert message が届く。kind prefix `[stripe-lookup-failed]` 等で即時識別。

PII redaction 済 (PR #2747、`src/lib/server/stripe/pii-redaction.ts`) のため customer email / phone / card last4 は含まれない。Stripe 内部 ID (`cus_*` / `sub_*` 等) は debug 用途で維持されている。

### Step 2. CloudWatch Logs Insights で関連 log 検索

AWS Console → CloudWatch → Logs Insights → log group `/aws/lambda/ganbari-quest-app` で以下 query 実行 (遡れる期間は §4 の保持期間まで):

```text
fields @timestamp, message, service, context.kind, context.plan, context.lookupKey, context.fallbackUsed, context.errorSummary
| filter service = "stripe"
| filter context.kind = "stripe-lookup-failed"
| sort @timestamp desc
| limit 50
```

- 直近 1 時間に絞る場合: query 上部の time range で「Last 1 hour」選択
- kind 別の集計: `| stats count(*) by context.kind` を末尾追加
- fallback 成功率: `| stats count(*) by context.fallbackUsed` で `true` / `false` 分布確認

### Step 3. severity 判定

| 観測内容 | severity | 即時アクション |
|---|---|---|
| `context.fallbackUsed=true` のみ (env var fallback 成功) | warning | Stripe Dashboard で lookup_key / Price 状態確認、必要に応じ Stripe support にチケット起票 |
| `context.fallbackUsed=false` (致命、課金 path 停止) | critical | kill switch 即時発動 (Step 4) + Stripe Dashboard 緊急復旧 + PO escalation |
| `stripe-webhook-handler-typeerror` 連続 | error | webhook handler 暫定停止判断 (Step 5)、handler バグ修正 PR を緊急 merge |
| `stripe-webhook-unknown-type` 1-2 件 | warning | Stripe 公式 changelog で新 event type 確認、handler 追加 PR を planning |

---

## 3. kill switch 発動手順 (MTTR < 5 min)

### 3.1 `USE_LOOKUP_KEY=false` 切替 (lookup_key → env var 直読)

`docs/design/billing-redesign/phase6-rollback-and-kill-switches.md` §5 + §S5/S6 SSOT 整合。

```bash
# 前提: AWS CLI 認証済、リージョン us-east-1
aws lambda update-function-configuration \
  --function-name ganbari-quest-app \
  --environment "Variables={USE_LOOKUP_KEY=false, ...既存 env...}" \
  --region us-east-1

# 反映確認 (約 30 秒以内に次 invocation で適用)
aws lambda get-function-configuration \
  --function-name ganbari-quest-app \
  --region us-east-1 \
  --query 'Environment.Variables.USE_LOOKUP_KEY'
# → "false" が返れば反映完了
```

**注意**: Lambda env update は **既存 env を全置換** する API のため、必ず既存 env を取得してから `USE_LOOKUP_KEY=false` だけ書き換えた set を投入する。間違って他 env を消すと別 incident になる。

### 3.2 `stripe-webhook-ledger-gap` (受信口が event を捨てている) — kill switch は無い (#4128)

**この alert は「受信口が壊れている」ことを意味する。env を戻して直す種類の障害ではない。**
webhook shadow mode の kill switch (`STRIPE_WEBHOOK_SHADOW_MODE`) は #4128 で撤去した — 受信口を止める switch は
「課金 event を捨てる switch」でしかなく、押した瞬間に本 alert が指す状態そのものを作るため。

手順:

1. **Stripe Dashboard で destination の URL を確認する。** `https://ganbari-quest.com/api/stripe/webhook` 以外を向いていたら戻す
   (受信口はこの 1 本のみ。`tests/unit/architecture/stripe-webhook-single-entrypoint.test.ts` が実装側を固定している)
2. 落ちた event を特定する。alert の `tags.sampleEventId` を起点に、CloudWatch Logs Insights で `[STRIPE]` を検索し
   dispatch されているかを見る
3. **Stripe Dashboard から該当 event を Resend する。** 台帳に無い = dedup されないので、再送すれば正規経路で処理される
   (`stripe events resend <event_id>` でも可)
4. 反映を `/ops` の「プラン判定できていない契約」と `/admin/subscription` の表示で確認する

```bash
# 台帳に無いことの確認 (DSQL)
# SELECT event_id, handler_result, processed_at FROM stripe_webhook_events WHERE event_id = 'evt_...';
```

---

## 4. CloudWatch Logs の保持期間 (#2735)

### 4.1 どこに値があるか

保持期間の値は **CDK の各 LogGroup の `retention` が SSOT** で、本書には写さない（写すと CDK を変えたときに本書だけが古くなる。[17b-ログ設計書.md](../design/17b-ログ設計書.md) §8 と同じ扱い）。

| log group | 定義（`retention` の場所） | 本書との関係 |
|---|---|---|
| `/aws/lambda/ganbari-quest-app`（本番 app。Stripe webhook / checkout を含む） | `infra/lib/compute-stack.ts` の `AppLogGroup` | §2 の query の対象。**課金経路の post-mortem を遡れるよう、ほかの log group より長く保持する**。保持期間を過ぎた log は S3 archive（assets bucket の `logs/`、翌日 Glacier へ移る。`setupLogArchiving`）にしか無く、Logs Insights では引けない |
| `/aws/lambda/ganbari-quest-cron-dispatcher` | `infra/lib/compute-stack.ts` の `CronDispatcherLogGroup` | cron は HTTP POST を送るだけで Stripe API を呼ばない。Stripe 関連の log は app 側に集まる |
| `/aws/lambda/ganbari-quest-app-demo` | `infra/lib/compute-stack.ts` の `DemoAppLogGroup` | demo Lambda は課金経路に到達しない（IAM 分離、`tests/unit/infra/multi-lambda-cdk.test.ts` C-1） |
| `/aws/lambda/ganbari-quest-health-check` | `infra/lib/ops-stack.ts` の `HealthCheckLogGroup` | 死活監視のみ。Stripe 関連なし |
| `/aws/lambda/ganbari-quest-ops-alert-forwarder` | `infra/lib/ops-stack.ts` の `OpsAlertForwarderLogGroup` | alert の転送のみ。Stripe 関連なし |

`ganbari-quest-cognito-custom-message`（`infra/lib/auth-stack.ts`）と `ganbari-quest-ses-receive`（`infra/lib/ses-stack.ts`）は CDK で LogGroup を定義しておらず、log group は Lambda が初回実行時に自動で作る。CDK が保持期間を持たないため、§4.2 の出力で `retentionInDays` が空（無期限）になる。

長さの考え方（ADR-0010）: 本番 app は、障害に気づいてから §2 の query を打つまでの猶予が取れる長さにする。それ以上の長期保存は S3 archive が担うので、CloudWatch 側を延ばさない（Stripe の webhook event 自体は Stripe 側にも保持されている）。

### 4.2 確認コマンド（CDK deploy 後）

```bash
aws logs describe-log-groups \
  --log-group-name-prefix /aws/lambda/ganbari-quest \
  --region us-east-1 \
  --query 'logGroups[*].[logGroupName, retentionInDays]' \
  --output table
```

§4.1 の表にある各行の `retentionInDays` が、表の場所にある CDK の `retention` と一致することを確かめる。一致しない場合は、コンソールや CLI で変えずに CDK deploy をやり直す（手で変えた値は次の deploy で CDK の値に戻る）。

---

## 5. post-mortem report テンプレート (障害後 24h 以内に記載)

障害 1 件ごとに `tmp/post-mortem-stripe-<YYYY-MM-DD>.md` を起票し、以下 6 項目を記録する。Pre-PMF 期間中は formal な incident management tool (PagerDuty / Statuspage 等) は導入しないため、git tracked tmp/ で代用する (`docs/operations/runbook.md` 整合)。

```markdown
# Stripe 障害 post-mortem <YYYY-MM-DD>

| 項目 | 内容 |
|---|---|
| 発生日時 | YYYY-MM-DD HH:MM (JST) |
| 検知 method | Discord alert / CloudWatch alarm / 顧客報告 |
| 検知から rollback 完了までの時間 | XX 分 (MTTR target: 5 分) |

## 1. 起因 (root cause)

(Stripe API 障害 / handler バグ / env var 配備漏れ 等)

## 2. 影響範囲

- 影響顧客数: X 件
- 影響期間: HH:MM - HH:MM (Y 分)
- 課金 path 状態: 継続 (fallback 成功) / 停止

## 3. 取った rollback action

(本書 §3 のどの kill switch を発動したか、または手動 Stripe Dashboard 操作)

## 4. CloudWatch Logs Insights query 結果 evidence

(本書 §2 の query 結果スクリーンショット or log entry sample)

## 5. 再発防止 action

- (a) コード修正 PR (#XXXX)
- (b) test 追加 (tests/unit/.../)
- (c) docs 改訂 (docs/design/billing-redesign/...)

## 6. follow-up Issue

- #XXXX (再発防止 PR)
- #XXXX (回帰 test 追加)
```

---

## 6. 関連

- 検知側: `src/lib/server/stripe/alert.ts` (PR #2727、`notifyStripeAlert` wrapper)
- PII redaction: `src/lib/server/stripe/pii-redaction.ts` (PR #2747)
- fallback 経路: `src/lib/server/stripe/config.ts` L189-232 (`getPriceId`) + `src/lib/server/stripe/price-cache.ts`
- 設計 SSOT: `docs/design/billing-redesign/phase6-rollback-and-kill-switches.md` §3 §6 §S5/S6
- ADR: ADR-0010 (Pre-PMF) / ADR-0049 (retention 統合方針) / ADR-0059 (Phase 7 cutover)
- 既存 runbook: `docs/operations/runbook.md` (汎用) / `docs/operations/stripe-dashboard-runbook.md` (Stripe Dashboard 手順)
- 課金 critical 取扱: `feedback_billing_critical_extra_caution` (course-MEMORY)
