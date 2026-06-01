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
| `stripe-webhook-handler-typeerror` | webhook handler 内の typeerror (typo / data shape mismatch) | error | 該当 event 処理失敗、Stripe 側 retry 対象 | `STRIPE_WEBHOOK_SHADOW_MODE=true` で旧 handler に戻す (Lambda env update) |

---

## 2. 障害検知時の triage 手順 (5 分以内目標)

### Step 1. Discord channel で alert 受信確認

`#stripe-alerts` channel (運用 SOP の Discord webhook 配信先) に alert message が届く。kind prefix `[stripe-lookup-failed]` 等で即時識別。

PII redaction 済 (PR #2747、`src/lib/server/stripe/pii-redaction.ts`) のため customer email / phone / card last4 は含まれない。Stripe 内部 ID (`cus_*` / `sub_*` 等) は debug 用途で維持されている。

### Step 2. CloudWatch Logs Insights で関連 log 検索

AWS Console → CloudWatch → Logs Insights → log group `/aws/lambda/ganbari-quest-app` で以下 query 実行 (retention 30 日、本 issue #2735 で SSOT 化済):

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

### 3.2 `STRIPE_WEBHOOK_SHADOW_MODE=true` 切替 (新 handler → 旧 handler 巻き戻し)

```bash
aws lambda update-function-configuration \
  --function-name ganbari-quest-app \
  --environment "Variables={STRIPE_WEBHOOK_SHADOW_MODE=true, ...既存 env...}" \
  --region us-east-1
```

shadow mode 切替後は新 handler は DB write せず log のみ、旧 handler が DB write 継続する (`docs/design/billing-redesign/phase6-rollback-and-kill-switches.md` §5.1 整合)。

---

## 4. CloudWatch Logs retention 30 日 SSOT (#2735)

### 4.1 設計判断

| 項目 | 値 | 根拠 |
|---|---|---|
| `/aws/lambda/ganbari-quest-app` (本番 + Stripe webhook + checkout 経路) | **30 日** (`RetentionDays.ONE_MONTH`) | 本書 §2 query 実行に必要な期間、Pre-PMF Bucket A 課金別格 (`feedback_billing_critical_extra_caution`) |
| `/aws/lambda/ganbari-quest-cron-dispatcher` | 3 日 (現状維持) | cron は HTTP POST のみで Stripe API call せず、Stripe 関連 log は AppLogGroup 側に集約される |
| `/aws/lambda/ganbari-quest-app-demo` | 3 日 (現状維持) | demo Lambda は課金 path に到達しない (IAM isolation、`tests/unit/infra/multi-lambda-cdk.test.ts` C-1) |
| `/aws/lambda/ganbari-quest-health-check` | 3 日 (現状維持) | 死活監視のみ、Stripe 関連なし |

ADR-0010 整合: 30 日 retention は AWS CloudWatch Logs 標準料金 ($0.03/GB/月) で 1 ヶ月分 = Pre-PMF coverage で十分。それ以上 (60/90/365 日) は Pre-PMF Bucket B/C の過剰防衛 (Stripe 公式 webhook event 自体は Stripe 側に 90 日保持されているため、CloudWatch には post-mortem triage 用の 30 日で十分)。

### 4.2 retention 確認コマンド (CDK deploy 後の post-deploy verification)

```bash
aws logs describe-log-groups \
  --log-group-name-prefix /aws/lambda/ganbari-quest \
  --region us-east-1 \
  --query 'logGroups[*].[logGroupName, retentionInDays]' \
  --output table
```

期待される出力:

```text
+--------------------------------------------------+--------+
|  /aws/lambda/ganbari-quest-app                   |  30    |
|  /aws/lambda/ganbari-quest-app-demo              |  3     |
|  /aws/lambda/ganbari-quest-cron-dispatcher       |  3     |
|  /aws/lambda/ganbari-quest-health-check          |  3     |
+--------------------------------------------------+--------+
```

CDK deploy 後 (PR #2735 merge 後) に retention=30 になっていない場合は CDK synth/deploy をやり直す。手動で `aws logs put-retention-policy --log-group-name ... --retention-in-days 30` を打って暫定復旧することも可能。

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
