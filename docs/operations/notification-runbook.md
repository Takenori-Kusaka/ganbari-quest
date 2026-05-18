# 通知機能 動作確認ランブック (#2190)

| 項目 | 内容 |
|------|------|
| ステータス | accepted（EPIC #2190 統括 doc、子 Issue NO-1 / NO-2 / NO-3 で詳細化）|
| 最終更新 | 2026-05-18 |
| 対象通知 | #2 Push 通知（`web-push` + VAPID）/ #3 メール通知（`@aws-sdk/client-ses`）|
| 想定実行者 | PO（動作確認） / Dev（runbook 更新）|
| 関連 ADR | ADR-0006（assertion 弱体化禁止 / 配布証跡）/ ADR-0010（Pre-PMF）/ ADR-0012（anti-engagement）|
| 関連 Issue | #2190（EPIC、本書）/ NO-1（#2 Push 4 系統 E2E + VAPID 配布証跡）/ NO-2（#3 メール 4 系統 E2E + SES デリバラビリティ）/ NO-3（動作確認 runbook 整備）|
| 関連 Issue（過去） | #293（Push 基盤）/ #1593（anti-engagement 適合化）/ #1666（Push subscription DB）/ #1689（DynamoDB / SES）/ #2114（Phase Push）/ #2167（Phase Milestone-Notification-UX）|

---

## 0. 本書の位置づけ

通知 3 種類（#1 チャレンジ達成 / #2 Push / #3 メール）のうち、**#2 Push + #3 メール が正しく動作していること自体が未確認** な状態（PO 報告 2026-05-17）を解消する EPIC #2190 の統括 SSOT。

Phase A / B 補佐確認結果:
- **OSS 採用**: `web-push`（#2）+ `@aws-sdk/client-ses`（#3）→ 業界標準、独自実装なし、ADR-0014 整合
- **anti-engagement guard 整備済**（#1593: subscriber_role / 親端末限定 / 1 日 3 通 cap / quiet hours）
- **動作確認 / E2E 部分的**（`push-subscribe-anti-engagement.spec.ts` 等）、4 + 4 = 8 通知種別の網羅性は未確認
- **runbook 未整備**（本書で SSOT 化）

#1 チャレンジ達成通知（MilestoneBanner）は Phase Milestone-Notification-UX #2167 で対応中、本 runbook 対象外。

---

## 1. 通知種別マップ（4 + 4 = 8 種別）

### 1.1 #2 Push 通知（4 系統）

| 通知種別 | トリガー | 配信先 | 実装 service | E2E spec |
|---|---|---|---|---|
| `reminder` | cron 日次 / ユーザー設定時刻 | 親端末（subscriber_role='parent'） | `push-subscription-service.ts` + `web-push` | `tests/e2e/push-reminder.spec.ts`（NO-1 で整備）|
| `streak-warning` | streak 中断検出（前日活動なし） | 親端末 | 同上 | `tests/e2e/push-streak-warning.spec.ts`（NO-1 で整備）|
| `achievement` | バッジ / 称号 / レベル up 達成 | 親端末（quiet hours 適用） | 同上 | `tests/e2e/push-achievement.spec.ts`（NO-1 で整備）|
| `webhook-linked` | 子供がアプリで活動 record したとき（任意 opt-in） | 親端末 | 同上 | `tests/e2e/push-webhook-linked.spec.ts`（NO-1 で整備）|

**anti-engagement guard（#1593）**:
- subscriber_role='parent' 限定（子供端末への配信禁止）
- 1 日 3 通 cap（`marketing_email_counter` の Push 版）
- Quiet hours: 21:00-07:00 は配信抑止（家族時間優先）

### 1.2 #3 メール通知（4 系統）

| 通知種別 | トリガー | 配信先 | 実装 service | E2E spec |
|---|---|---|---|---|
| `weekly-report` | cron 週次（毎週月曜 09:00 JST） | 親 email（owner） | `weekly-report-service.ts` + `@aws-sdk/client-ses` | `tests/e2e/email-weekly-report.spec.ts`（NO-2 で整備）|
| `lifecycle` | signup / trial / 課金変更等のイベント | 親 email（owner） | `lifecycle-email-service.ts` | `tests/e2e/email-lifecycle.spec.ts`（NO-2 で整備）|
| `trial` | トライアル 7d/3d/1d/満了 | 親 email（owner） | `trial-notification-service.ts` | `tests/e2e/email-trial.spec.ts`（NO-2 で整備）|
| `marketing` | キャンペーン / 機能告知（opt-in 必須） | 親 email（owner、`marketing_email_counter` で頻度制限） | `marketing-email-counter.ts` | `tests/e2e/email-marketing.spec.ts`（NO-2 で整備）|

**anti-engagement guard**:
- 各 email に unsubscribe link 必須（`unsubscribe-token.ts` で署名付きトークン発行）
- `marketing` のみ opt-in 必須（COPPA / 特定電子メール法整合）
- 1 日合計 3 通 cap（type 横断）

---

## 2. 動作確認手順（Push: 4 系統）

### 2.1 VAPID 鍵配布証跡確認（ADR-0006 整合）

```bash
# SSM Parameter Store
aws ssm get-parameter \
  --name "/ganbari-quest/prod/VAPID_PUBLIC_KEY" \
  --query 'Parameter.Value' --output text | head -c 20
aws ssm get-parameter \
  --name "/ganbari-quest/prod/VAPID_PRIVATE_KEY" \
  --with-decryption --query 'Parameter.Value' --output text | head -c 20

# NUC .env
ssh nuc cat /opt/ganbari-quest/.env | grep VAPID

# GitHub Actions Secrets
gh secret list --repo Takenori-Kusaka/ganbari-quest | grep VAPID
```

3 箇所すべてに同じ key pair が配備されていること（key pair 不一致は配信即失敗 = サイレント障害）。

### 2.2 Push 受信確認手順

1. 親端末（Chrome / Edge）で `https://ganbari-quest.com/auth/login` ログイン
2. `/admin/settings` → 「通知設定」→ 「ブラウザ通知を有効にする」を ON（ブラウザ permission grant）
3. 開発者ツール > Application > Service Workers で `service-worker.js` が active 確認
4. 各通知種別ごとに以下を実行:

#### `reminder`
- `/admin/settings` で reminder 時刻を「現時刻 +5 分」に設定
- 5 分待つ → 親端末で OS 通知が表示されることを確認

#### `streak-warning`
- 子供アカウントで前日に活動 record を残し、今日活動なしの状態にする
- 翌日 09:00 JST 前後で OS 通知が表示されることを確認

#### `achievement`
- 子供アカウントでバッジ獲得条件を満たす活動 record
- 即座に親端末に OS 通知が表示されることを確認
- Quiet hours（21:00-07:00）の場合は遅延配信され、07:00 過ぎに配信されることを確認

#### `webhook-linked`
- 子供アカウントで活動 record（任意の活動 1 件）
- 親端末に「○○さんが活動を記録しました」OS 通知が表示されることを確認（opt-in 設定済の場合）

### 2.3 トラブルシューティング

| 現象 | 原因 | 対応 |
|---|---|---|
| permission grant したのに通知来ない | VAPID 鍵不一致 | §2.1 で 3 箇所配備を再確認、不一致なら再配備 |
| 通知来るが Title / Body が空 | service-worker.js の payload parse 失敗 | DevTools Console でエラー確認、`push-service-payload.test.ts` 再実行 |
| 子供端末にも配信される | subscriber_role guard 失効 | `push-subscription-service.ts` の filter 確認、`push-subscribe-anti-engagement.spec.ts` 再実行 |
| 1 日に 5 通超来る | 1 日 3 通 cap 失効 | `marketing_email_counter` の Push 版実装確認、回帰テスト追加 |

---

## 3. 動作確認手順（Email: 4 系統）

### 3.1 SES 配布証跡確認

```bash
# AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY（SES IAM user）
aws ssm get-parameter \
  --name "/ganbari-quest/prod/AWS_SES_ACCESS_KEY_ID" \
  --query 'Parameter.Value' --output text | head -c 10

# SES sender identity 検証状態
aws ses get-identity-verification-attributes \
  --identities noreply@ganbari-quest.com \
  --region us-east-1
# 期待: VerificationStatus=Success
```

### 3.2 SES デリバラビリティ確認

1. **DKIM**: AWS SES Console > Verified identities > `ganbari-quest.com` > Authentication > DKIM Status = `Verified`
2. **SPF**: Route 53 / DNS で `v=spf1 include:amazonses.com ~all` レコード確認
3. **DMARC**: Route 53 / DNS で `v=DMARC1; p=quarantine; rua=mailto:dmarc@ganbari-quest.com` 確認
4. **Bounce / Complaint 監視**: SNS topic `arn:aws:sns:us-east-1:xxx:ses-bounces` / `ses-complaints` で CloudWatch Alarm 設定済確認

### 3.3 Email 受信確認手順

各通知種別ごとに以下を実行（受信先: 動作確認用 Gmail）:

#### `weekly-report`
- `tests/manual/trigger-weekly-report.mjs --tenantId=<test-tenant>` で即時送信
- Gmail で「がんばりクエスト週次レポート」件名のメール受信を確認
- HTML レンダリング崩れがないこと（Gmail Web / iOS Gmail App / Outlook で各 1 回）
- unsubscribe link クリックで unsubscribe page に遷移すること

#### `lifecycle`
- 新規 signup → 「ようこそメール」即時受信
- 課金プラン変更 → 「プラン変更完了メール」即時受信
- 解約 → 「解約完了メール」即時受信

#### `trial`
- トライアル開始 → 「7 日間無料体験スタート」メール受信
- トライアル開始 +5 日 → 「あと 2 日で体験終了」メール受信
- トライアル満了 → 「無料プランに移行しました」メール受信

#### `marketing`
- `/admin/settings` で marketing opt-in を ON
- `tests/manual/trigger-marketing.mjs --campaign=launch2026` で送信
- Gmail で受信確認、`marketing_email_counter` で 1 日 3 通 cap 動作確認

### 3.4 トラブルシューティング

| 現象 | 原因 | 対応 |
|---|---|---|
| メール届かない（Sandbox mode） | SES Production access 未申請 | AWS Support に Production access 申請（24-72h）|
| 迷惑メールフォルダに入る | DKIM / SPF / DMARC 未設定 | §3.2 確認、未設定なら DNS レコード追加 |
| Bounce 多発 | invalid email アドレスへの配信 | SES Bounce SNS で email を blacklist 化、`auth.users` の `email_verified` 必須化 |
| Complaint 多発 | unsubscribe link 機能不全 | `unsubscribe-token.ts` の signing 確認、E2E 回帰テスト追加 |
| 1 日 5 通超届く | marketing_email_counter 失効 | counter ロジック確認、回帰テスト追加 |

---

## 4. 関連 ADR / Issue

- **ADR-0006**: assertion 弱体化禁止 / 配布証跡 → §2.1 VAPID 配布証跡 + §3.1 SES 配布証跡
- **ADR-0010**: Pre-PMF → OSS（`web-push` / `@aws-sdk/client-ses`）採用、独自実装ゼロ
- **ADR-0012**: anti-engagement → subscriber_role + quiet hours + 1 日 3 通 cap
- **ADR-0014**: OSS 先調査 → Phase B で `web-push` / `@aws-sdk/client-ses` を業界標準として採用済
- **#1593**: anti-engagement 適合化（subscriber_role / quiet hours 実装、closed）
- **#2114**: Phase Push Notification（並行進行中）
- **#2167**: Phase Milestone-Notification-UX（#1 チャレンジ達成通知、本書対象外）
- **NO-1**（番号確定後挿入）: #2 Push 4 系統 E2E + VAPID 配布証跡 + dogfood
- **NO-2**（番号確定後挿入）: #3 メール 4 系統 E2E + SES デリバラビリティ + dogfood
- **NO-3**（番号確定後挿入）: 動作確認 runbook 整備（本書）

---

## 5. EPIC #2190 進捗確認

| AC | 内容 | ステータス |
|---|---|---|
| AC1 | 子 Issue 3 件（NO-1 / NO-2 / NO-3）all closed | 起票・進行中（番号は別 PR で確定）|
| AC2 | PO ドライラン: #2 Push + #3 メール本番送信受信 SS + receipt 添付 | 各子 Issue で実施 |
| AC3 | 本 runbook で 4 + 4 = 8 通知種別の動作確認手順 + トラブルシューティング SSOT 化 | **本書で達成（§2 / §3）** |
| AC4 | #2180（機能完成度 checklist）に「動作確認 / E2E 整備が AC 必須化」項目追加 | 本 PR で #2180 にコメント追加（別 follow-up）|

---

## 6. dogfood 観察期間

- 本 runbook merge 後 2 週間、Push / Email 配信成功率を retrospective
- 配信成功率 < 95% / Bounce rate > 5% / Complaint rate > 0.1% で root cause 調査 + Issue 起票

---

## 改訂履歴

| 日付 | 版数 | 内容 |
|------|------|------|
| 2026-05-18 | 1.0 | #2190 初版作成（EPIC 統括 doc、8 通知種別の動作確認手順 + トラブルシューティング SSOT 化）|
