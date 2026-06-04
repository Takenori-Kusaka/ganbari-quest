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

## 付録: 詳細動作確認 runbook (Push + Email 8 系統、#2227 PR-B 統合)

# Notification Runbook — Push + Email 配布証跡 + 動作確認

EPIC #2190 / 子 Issue #2191 (Push) + #2192 (Email) の動作確認・配布証跡 SSOT。
本ファイルが「Push 通知 + メール通知が正しく動作していること」を保証する手順の SSOT。

**SSOT**: ADR-0006 (assertion 弱体化禁止) / ADR-0010 (Pre-PMF scope) / ADR-0023 (Anti-engagement)

---

## 1. 通知 8 系統 全体マップ

| # | 系統 | 種類 | 実装 | cron / trigger | プラン gate |
|---|---|---|---|---|---|
| 1 | reminder | Push | `notification-service.sendPushNotification` | reminder cron (daily) | 全プラン |
| 2 | streak-warning | Push | 同上 (`streak_warning` type) | `analytics-aggregate` 内派生 | 全プラン |
| 3 | achievement | Push | `sendAchievementNotification` | `activity-log-service` 完了 hook | 全プラン |
| 4 | level_up | Push | 同上 (`level_up` type) | `activity-log-service` 完了 hook (level up 時) | 全プラン |
| 5 | weekly-report | Email | `email-service.sendWeeklyReportEmail` | `/api/v1/admin/weekly-report` (cron 想定) | standard 以上 (#735) |
| 6 | lifecycle (renewal + dormant) | Email | `lifecycle-email-service.runLifecycleEmails` | `/api/cron/lifecycle-emails` (daily) | 全プラン (年 6 回上限) |
| 7 | trial (3day/1day/today) | Email | `trial-notification-service.processTrialNotifications` | `/api/cron/trial-notifications` (daily) | trial 中のみ |
| 8 | pmf-survey | Email | `pmf-survey-service.runPmfSurveyDistribution` | `/api/cron/pmf-survey` (年 2 回) | owner 全件 (年 6 回上限と共有) |

---

## 2. 配布証跡 (ADR-0006 整合)

### VAPID 鍵 (#2191 AC2)

| 配布先 | 値の入手元 | 検証手段 |
|---|---|---|
| **NUC `.env.production`** | `npx web-push generate-vapid-keys` で生成 → 1Password / 物理金庫保管 | `node -e "console.log(!!process.env.VAPID_PUBLIC_KEY)"` で `true` |
| **Lambda env (SSM Parameter Store SecureString)** | 同上、`/ganbari-quest/prod/VAPID_PRIVATE_KEY` 等の path | CDK stack の `Secret.fromSecretCompleteArn` 参照 + `aws ssm get-parameter --with-decryption` |
| **GitHub Actions Secrets** | repository settings → Secrets and variables → Actions | `${{ secrets.VAPID_PUBLIC_KEY }}` で参照 (Lambda デプロイ時のみ必要、Pages デプロイは不要) |
| **ローカル dev `.env.local`** | `.env.example` template から生成、開発者個別保管 | 起動時に `notification-service` の warn ログを観察 |

**証跡確認コマンド**:

```bash
# NUC 上で
grep -c "VAPID_PUBLIC_KEY=" /opt/ganbari-quest/.env.production && echo "OK"

# Lambda / staging
aws ssm get-parameter --name /ganbari-quest/prod/VAPID_PUBLIC_KEY --with-decryption --region ap-northeast-1

# CI / Actions Secrets
gh secret list --repo Takenori-Kusaka/ganbari-quest | grep VAPID
```

**未配布時のフォールバック動作**:
- `notification-service.ts:170-174` が `warn` ログを出して `{ sent: 0, failed: 0 }` を返す (silent fail)
- web-push library への送信は試みない (鍵不在で web-push が throw する前にガード)
- 検出: `tests/unit/services/notification-service.test.ts` 8/24 がこの分岐を網羅

### SES sender ID + DKIM/SPF (#2192 AC2)

| 設定項目 | 設定値 / 確認手段 | 場所 |
|---|---|---|
| **Verified identity (sender domain)** | `ganbari-quest.com` を SES Verified identities に追加 | AWS Console: SES → Verified identities |
| **DKIM** | Easy DKIM (2048-bit) を有効化、`*._domainkey.ganbari-quest.com` CNAME 3 件を Route 53 等に登録 | 同上 + Route 53 |
| **SPF** | `v=spf1 include:amazonses.com ~all` TXT レコードを `ganbari-quest.com` ルートに登録 | Route 53 |
| **DMARC (optional)** | `v=DMARC1; p=quarantine; rua=mailto:postmaster@ganbari-quest.com` | Route 53 |
| **IAM 権限** | Lambda 実行ロールに `ses:SendEmail` / `ses:SendRawEmail` を付与 (RawEmail は #1601 List-Unsubscribe で必要) | CDK stack / IAM |
| **Configuration Set** | `ganbari-quest-default` (任意。バウンス/苦情 SNS 連携 hook 用) | SES → Configuration sets |
| **バウンス処理 (Pre-PMF: 任意)** | SES → SNS → Lambda 経路、または SES Mailbox Simulator (`bounce@simulator.amazonses.com`) でテスト | docs/operations/runbook.md §バウンス |

**確認コマンド**:

```bash
# Verified identities 一覧
aws ses list-verified-email-addresses --region ap-northeast-1
aws sesv2 get-email-identity --email-identity ganbari-quest.com --region ap-northeast-1

# DKIM 状態
aws sesv2 get-email-identity --email-identity ganbari-quest.com --region ap-northeast-1 \
  --query 'DkimAttributes.{Enabled:SigningEnabled,Tokens:Tokens}'

# 送信 quota (24h limit / max send rate)
aws ses get-send-quota --region ap-northeast-1
```

**未設定時の挙動**:
- sender ID 未 verify → SES が `MessageRejected` を投げ、`email-service.ts:111-114` が `false` を返す
- DKIM 未設定 → メール届くが Gmail / Outlook がスパム判定する可能性高
- バウンス処理未設定 → 送信成功率指標が悪化 (SES から警告メール来る)

---

## 3. 動作確認手順 (dogfood)

### #2191 AC3 — Push 通知 dogfood (PO 実機検証手順)

#### PC (Chrome / Edge / Firefox)

```bash
# 1. ローカル起動 (cognito-dev で owner ログイン)
npm run dev:cognito
# 別 terminal で:
open http://localhost:5174/admin

# 2. 「通知を有効化」を押す (NotificationPermissionBanner、#2115/#2116 で UX 改善済)
# 3. OS の通知許可ダイアログを承認
# 4. cron トリガー (手動)
curl -X POST http://localhost:5174/api/cron/reminder \
  -H "x-cron-secret: $CRON_SECRET" -d '{"dryRun":false}'
# 5. デスクトップ右上 (Mac) / 右下 (Win) に通知が出る → SS 撮影
```

#### Mobile (iOS Safari 16.4+ / Android Chrome)

```bash
# 1. iOS は「ホーム画面に追加」(PWA) してから「通知を許可」
# 2. Android はブラウザ通知許可ダイアログ → 「許可」
# 3. cron トリガーは同上
# 4. ロック画面 / 通知センターに表示される → SS 撮影
```

**期待動作**:
- reminder: 「きょうもがんばろう！」(quiet hours 21-07 JST 外、日次上限 3 通)
- streak-warning: 連続記録途切れ警告 (`analytics-aggregate` 経由)
- achievement: 「`{childName}`「`{activityName}`」を がんばったよ！ +`{points}`P」
- level_up: 「`{childName}` レベル`{n}`に なったよ！ すごい！」

### #2192 AC5 — メール通知 dogfood

```bash
# 1. ローカル起動
npm run dev
# AUTH_MODE=local では SES 送信は skip、tmp/emails/<timestamp>.html に HTML 書き出し
# 実 SES 送信は AUTH_MODE=cognito + .env.local に SES env を入れて起動

# 2. lifecycle (期限切れリマインド + 休眠復帰) を dryRun で集計
curl -X POST http://localhost:5174/api/cron/lifecycle-emails \
  -H "x-cron-secret: $CRON_SECRET" -d '{"dryRun":true}'
# → { ok: true, scanned, renewalSent, dormantSent, ... }

# 3. trial 通知を dryRun
curl -X POST http://localhost:5174/api/cron/trial-notifications \
  -H "x-cron-secret: $CRON_SECRET" -d '{}'

# 4. weekly-report (試験送信)
curl -X POST http://localhost:5174/api/v1/admin/weekly-report \
  -H "x-cron-secret: $CRON_SECRET" \
  -d '{"tenantId":"t-test","ownerEmail":"po@example.com","children":[...]}'

# 5. pmf-survey を dryRun
curl -X POST http://localhost:5174/api/cron/pmf-survey \
  -H "x-cron-secret: $CRON_SECRET" -d '{"dryRun":true,"round":"2026-H1"}'

# 6. unsubscribe one-click (RFC 8058)
# メール内の List-Unsubscribe URL を取得して
curl -X POST "http://localhost:5174/unsubscribe/<token>?/"
# → 200 + success: true、再送信時 skip される
```

**SES sandbox 解除 (本番デリバラビリティ前提)**:
- 初期状態は sandbox (verify 済 address のみ送信可、200 通/24h)
- production 移行: AWS Support → SES production access request
- 解除後: 任意宛先 + 50,000+通/24h (Pre-PMF には十分過ぎる)

---

## 4. トラブルシューティング

### Push 通知が届かない

| 症状 | 原因候補 | 確認 / 対処 |
|---|---|---|
| サーバ log `[notification] VAPID キーが設定されていません` | env 未配布 | §2 配布証跡で確認、再配布 |
| `[notification] レート制限またはサイレント時間帯のためスキップ` | 日次 3 通上限 / 21-07 JST | 設定画面でサイレント時間帯変更、または翌日待つ |
| `[notification] 非 parent/owner role の subscription への送信をスキップ` | child role で subscribe 済 (過去 bug 想定) | `push_subscriptions` テーブルから `subscriber_role='child'` 行を削除 |
| 410 / 404 で `stale subscription を削除` | ブラウザ側で通知許可解除済 | 正常動作、re-subscribe 必要 |
| sendNotification 失敗で 5xx | web-push 内部エラー / 鍵不正 / Service Worker 未登録 | `tmp/` log + ブラウザ DevTools Application → Service Workers |

### メールが届かない

| 症状 | 原因候補 | 確認 / 対処 |
|---|---|---|
| `[email] メール送信失敗` + `MessageRejected` | sender ID 未 verify / SES sandbox | §2 SES 確認 + sandbox 解除 |
| 送信成功だが受信側スパムフォルダ | DKIM 未設定 / SPF 不整合 | §2 DNS レコード再確認 |
| `[email] ローカルモード: メール送信スキップ` | `AUTH_MODE=local` で実 SES 呼ばれていない | `AUTH_MODE=cognito` + SES env 投入 |
| バウンス / 苦情率高 | 配信先リスト品質 / List-Unsubscribe 機能不全 | バウンス SNS 連携追加 (Pre-PMF は手動監視可) |
| List-Unsubscribe ヘッダ無し | `sendRawEmail` 経路使われていない / `listUnsubscribeUrl` 未指定 | `email-service.ts:73-89` 経路確認 |

---

## 5. E2E + Unit テスト網羅性 (#2191 AC1+AC5 / #2192 AC1+AC4)

| spec | scope | 系統数 |
|---|---|---|
| `tests/e2e/push-subscribe-anti-engagement.spec.ts` | subscribe API 構造防御 (401/400 smoke) | 全系統共通 |
| `tests/e2e/push-notification-4-types.spec.ts` (#2191) | 4 Push 系統のサービスレベル発火経路 + VAPID env smoke | 4 (reminder/streak/achievement/level_up) |
| `tests/e2e/cron-lifecycle-emails.spec.ts` | lifecycle cron auth + dryRun | 1 |
| `tests/e2e/cron-trial-notifications.spec.ts` (#2192) | trial cron auth + dryRun | 1 |
| `tests/e2e/cron-pmf-survey.spec.ts` (#2192) | pmf-survey cron auth + dryRun | 1 |
| `tests/e2e/email-notification-4-types.spec.ts` (#2192) | 4 メール cron 横断 smoke | 4 (lifecycle/trial/pmf/weekly-report) |
| `tests/e2e/email-unsubscribe.spec.ts` (#2192 AC4) | unsubscribe HMAC token + page server actions | 1 |
| `tests/unit/services/notification-service.test.ts` | 24 件 (quiet hours / role guard / 410 削除 / 二重防御) | 4 |
| `tests/unit/services/notification-service-vapid-distribution.test.ts` (#2191 AC5) | VAPID env 配布証跡 + 4 系統発火 unit | 4 |
| `tests/unit/services/email-service.test.ts` | 15 件 (各テンプレート + ローカルモード fallback) | 4 |
| `tests/unit/services/email-deliverability.test.ts` (#2192 AC2/AC3) | SES sender / DKIM env 証跡 unit + error path | 4 |

---

## 6. 関連 ADR / Issue

- **ADR-0006**: assertion 弱体化禁止 → VAPID/SES env 配布証跡を「あれば動く」前提にしない
- **ADR-0010**: Pre-PMF scope → バウンス SNS 連携 / WAF / 監査ログは Pre-PMF 過剰防衛として保留
- **ADR-0023 §3.3**: Anti-engagement / 接触頻度上限 (年 6 回マーケティング、日次 3 通 Push)
- **#1593**: child role subscribe 構造的禁止
- **#1601**: List-Unsubscribe (RFC 8058) 対応
- **#2115/#2116/#2221**: NotificationPermissionBanner UX 改善 (subscribe フロー silent fail 修正)

## 7. 更新ルール

- 新規通知系統追加時は §1 マップ + §5 テスト網羅性 を更新
- VAPID 鍵ローテーション時は §2 配布証跡 で全 4 配布先を更新 (1 つでも漏れると silent fail)
- SES sender ID 変更時は DKIM/SPF 再設定 + §2 確認コマンド再実行
