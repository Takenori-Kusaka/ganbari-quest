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
- **OSS 採用**: `web-push`（#2）+ `@aws-sdk/client-ses`（#3）→ 業界標準、独自実装なし、`docs/decisions/README.md` §OSS 先調査ルール 整合
- **anti-engagement guard 整備済**（#1593: subscriber_role / 親端末限定 / 1 日 3 通 cap / quiet hours）
- **動作確認 / E2E 部分的**（`push-subscribe-anti-engagement.spec.ts` 等）、4 + 4 = 8 通知種別の網羅性は未確認
- **runbook 未整備**（本書で SSOT 化）

#1 チャレンジ達成通知（MilestoneBanner）は Phase Milestone-Notification-UX #2167 で対応中、本 runbook 対象外。

---

## 1. 通知種別マップ（5 + 4 = 9 種別）

### 1.1 #2 Push 通知（5 系統）

どの種別も `notification-service.ts` の `sendPushNotification`（`web-push`）で送り、サイレント時間帯と 1 日 3 通の上限（種類をまたいで共通）を通る。**止める設定**の列は、保護者が `/admin/settings/notifications` でオフにしたら送らなくなる設定。

| 通知種別 | トリガー | 止める設定 | 配信先 | 送信元 | テスト |
|---|---|---|---|---|---|
| `reminder` | 15 分ごとの cron（`notification-delivery`）で、設定時刻以降に 1 日 1 回。今日まだ記録していない子供がいるときだけ | リマインダー通知 | 親端末（subscriber_role='parent'） | `notification-delivery-service.ts` | `tests/e2e/push-notification-4-types.spec.ts` |
| `streak_warning` | 今日未記録かつストリーク継続中（19:00 JST 以降、15 分ごとの cron で 1 日 1 回） | ストリーク警告 | 親端末 | `notification-delivery-service.ts` | `tests/e2e/push-notification-4-types.spec.ts` |
| `achievement` | 子供が活動を記録した直後（レベルが上がった記録では代わりに `level_up`） | 達成通知 | 親端末 | `activity-log-service.ts` → `sendAchievementNotification` | `tests/unit/services/notification-service.test.ts` |
| `level_up` | 記録でレベルが上がった直後 | 達成通知 | 親端末 | `activity-log-service.ts` → `sendAchievementNotification` | `tests/unit/services/notification-service.test.ts` |
| `monthly_habit` | その月に記録した日数が 10 日に届いた日の、最初の記録の直後（月の習慣化の証明書。子供 1 人につき月 1 回） | 達成通知 | 親端末 | `certificate-service.ts` の `issueMonthlyHabitCertificateIfEligible` | `tests/unit/services/monthly-habit-certificate.test.ts` |

`monthly_habit` は記録の直後に届くので、設定画面の「達成通知（記録完了・レベルアップ時）」に含める（独立した設定は持たない）。達成通知をオフにしていても、証明書の発行・ポイントの付与・子供の次回起動時の告知は行う（止まるのは保護者への push だけ）。

**anti-engagement guard（#1593）**:
- subscriber_role='parent' 限定（子供端末への配信禁止）
- 1 日 3 通 cap（`marketing_email_counter` の Push 版）
- Quiet hours: 21:00-07:00 は配信抑止（家族時間優先）

### 1.2 #3 メール通知（4 系統）

| 通知種別 | トリガー | 配信先 | 実装 service | E2E spec |
|---|---|---|---|---|
| `weekly-report` | cron 週次（`weekly_report_day` の 09:00 JST 以降に週 1 回、standard 以上） | 親 email（owner） | `notification-delivery-service.ts` → `weekly-report-service.ts`（集計）+ `email-service.ts` の `sendWeeklyReportEmail`（`@aws-sdk/client-ses`） | `tests/e2e/email-notification-4-types.spec.ts` |
| `lifecycle` | signup / trial / 課金変更等のイベント | 親 email（owner） | `lifecycle-email-service.ts` | `tests/e2e/email-lifecycle.spec.ts`（NO-2 で整備）|
| `trial` | トライアル 7d/3d/1d/満了 | 親 email（owner） | `trial-notification-service.ts` | `tests/e2e/email-trial.spec.ts`（NO-2 で整備）|
| `marketing` | キャンペーン / 機能告知（opt-in 必須） | 親 email（owner、`marketing_email_counter` で頻度制限） | `marketing-email-counter.ts` | `tests/e2e/email-marketing.spec.ts`（NO-2 で整備）|

**anti-engagement guard**:
- 各 email に unsubscribe link 必須（`unsubscribe-token.ts` で署名付きトークン発行）
- `marketing` のみ opt-in 必須（COPPA / 特定電子メール法整合）
- 1 日合計 3 通 cap（type 横断）

---

## 2. 動作確認手順（Push: 5 系統）

### 2.1 VAPID 鍵配布証跡確認（ADR-0006 整合）

配布経路は **GitHub Actions Secrets → `deploy.yml` の `-c vapidPublicKey` / `-c vapidPrivateKey` → CDK (`infra/lib/compute-stack.ts`) → 本番 app Lambda env** の 1 本だけ（SSM Parameter Store は使わない）。本番で鍵が未指定 / 形式不正 / 組になっていないなら、`deploy.yml` の `Validate required secrets` が deploy の最初に止める（CDK synth と同じ判定 `isVapidKeyPair` を呼ぶ）。CDK synth も `addError` で止める。`判定を実行できませんでした` で止まったときは鍵の不備とは限らない（node の起動・読み込みの失敗）ので、鍵を作り直さずにログを確認する（作り直すと全保護者の購読が無効になる）。

```bash
# GitHub Actions Secrets (登録の有無)
gh secret list --repo Takenori-Kusaka/ganbari-quest | grep VAPID

# 本番 Lambda env (キー名だけを見る。値は出さない)
aws lambda get-function-configuration --function-name ganbari-quest-app --region us-east-1 \
  --query 'keys(Environment.Variables)' --output text | tr '\t' '\n' | grep VAPID
```

- **公開鍵と秘密鍵は同じ `generateVAPIDKeys()` の出力を組で登録する**。本番の CDK synth は形式に加えて、秘密鍵から導いた公開鍵が一致するかを検査する（`infra/lib/vapid-context.ts`）。片方だけ作り直すと synth error になる
- **staging には配らない**。staging は公開鍵が無いので購読が作れず、push は届かない。cron-dispatcher も持たない（`infra/lib/env-config.ts` の `enableCronDispatcher: false`）。ただし記録時の achievement / level_up 送信は staging でも走るため、staging のログに出る `[push-alert] vapid-missing` は想定内（alarm が見るのは本番 app Lambda のログだけ）
- **NUC にも配らない**。NUC は `AUTH_MODE=local` で、`notification-service.ts` は push を送らずログ出力だけを行う
- **鍵ペアの控えは運営のパスワードマネージャ（1Password）に置く**。GitHub Secrets は値を読み出せないため、控えが無いと secret を消した・上書きしたときに作り直すしかなく、全保護者の購読が無効になる
- 鍵を作り直すと、既存の購読（`push_subscriptions`）は古い公開鍵で作られているため届かなくなる。作り直した場合は保護者に通知設定での再購読を案内する
- **本番に鍵を配る前（#4706 以前）は、購読が 1 件も作られていない**。`/api/v1/settings/vapid-key` が空文字を返し、`subscribeToPush()` が購読を作らずに抜けていたため。鍵の配布直後は `push_subscriptions` が 0 件で、`reminderSent` / `streakWarningSent` が 0 なのは想定どおり（ログは `[notification] 購読が 0 件のためスキップ`）。その間に「通知を受け取る」を押した保護者は OS の許可だけが済んだ状態で、ホームのバナーは再表示されない。`/admin/settings/notifications` で通知をオンにし直すと購読が作られる

鍵の生成と登録（値を画面に出さない）:

```bash
KEYS=$(node -e "const k=require('web-push').generateVAPIDKeys();process.stdout.write(k.publicKey+' '+k.privateKey)")
printf '%s' "${KEYS% *}" | gh secret set VAPID_PUBLIC_KEY --repo Takenori-Kusaka/ganbari-quest
printf '%s' "${KEYS#* }" | gh secret set VAPID_PRIVATE_KEY --repo Takenori-Kusaka/ganbari-quest
unset KEYS
```

登録した組は、同じ手順の中でパスワードマネージャの控えにも保存する（値を画面・ログ・チャットに出さない）。

#### 鍵の作り直し（ローテーション）

1. 上の「鍵の生成と登録」で新しい組を登録し、控えを新しい組に差し替える
2. `deploy.yml` で本番デプロイする。**手元で `cdk diff` / `cdk deploy` を実行しない**（手元の出力は伏せ字にならず、新旧の秘密鍵がそのまま端末に出る）
3. デプロイのログで `Mask deployed VAPID private key` が `deploy 済みの VAPID 秘密鍵を、以降のログで伏せ字にしました` を出していることを確認する。この step が deploy 済みの（旧い）秘密鍵を伏せ字に登録してから `cdk diff --all` を出すので、diff の `[-]` 行に旧い秘密鍵は出ない（新しい秘密鍵は secret なので `[+]` 行でも伏せ字になる）。Actions のログは公開されているため、この step が error で止まったら再実行する（伏せ字にできないまま diff を出さない）
4. デプロイ後、既存の購読は無効になるので、保護者に `/admin/settings/notifications` で通知をオンにし直すよう案内する

#### 送信実績の確認（本番ログ）

`/api/cron/notification-delivery` は 15 分ごとに 1 回、集計を `[notification-delivery] 配信バッチ完了` として出す（ルート側も同じ集計を `cron completed` として出すので、数えるのはこの行だけにする）。`reminderSent` / `streakWarningSent` / `weeklyReportSent` が送信できた家庭の数。鍵が配られていない場合は `[push-alert] vapid-missing` が、push サービスが送信を受け付けなかった場合は `[push-alert] send-failed status=<HTTP status | none>` が出る。

```bash
# CloudWatch Logs Insights (/aws/lambda/ganbari-quest-app)
fields @timestamp, @message
| filter @message like /配信バッチ完了/ and @message like /"dryRun":false/
| parse @message /"weeklyReportSent":(?<w>\d+),"reminderSent":(?<r>\d+),"streakWarningSent":(?<s>\d+)/
| stats count(*) as batches, sum(w) as weekly, sum(r) as reminder, sum(s) as streak
```

週次メールの配達は SES の CloudWatch メトリクス（`AWS/SES` の `Send` / `Delivery` / `Bounce`、us-east-1）で確認する。

#### push 不達の alarm

`[push-alert] vapid-missing` / `[push-alert] send-failed` の 2 行は CloudWatch alarm になっていて、鳴ると Discord の障害通知に届く（`infra/lib/ops-stack.ts`、通知方針は `infra/lib/ops-alert-policy.ts`）:

| alarm | 鳴る条件 | 見ること |
|---|---|---|
| `ganbari-quest-push-vapid-missing` | 5 分に 1 件以上 | 本番 Lambda env のキー名（上の確認コマンド）。無ければ `deploy.yml` で再デプロイ |
| `ganbari-quest-push-send-failed` | 1 時間に 2 件以上 | ログの `status=`。401 / 403 は鍵の組違い（控えの組と Secrets の組を照合し、組で登録し直す）、`none` は timeout / 接続失敗、5xx は push サービス側 |

どちらも送信を試みたときにしかログが出ないので、送信の無い時間帯には alarm が OK に戻る。OK に戻ったことは復旧を意味しないため、OK の通知は出さない（直ったかどうかは次の送信のログで確かめる）。

### 2.2 Push 受信確認手順

1. 親端末（Chrome / Edge）で `https://ganbari-quest.com/auth/login` ログイン
2. `/admin/settings` → 「通知設定」→ 「ブラウザ通知を有効にする」を ON（ブラウザ permission grant）
3. 開発者ツール > Application > Service Workers で `service-worker.js` が active 確認
4. 各通知種別ごとに以下を実行:

> **前提（既定設定のとき）**: 送信は `canSendNotification` を通る。サイレント時間帯（既定 21:00〜07:00 JST）と 1 日 3 通の上限（種類をまたいで共通。送信に失敗した分も数える）に当たると送信 0 件になる（ログは `レート制限またはサイレント時間帯のためスキップ`）。reminder と streak-warning はそれぞれ 1 日 1 回で、送れた時点で `notification_reminder_sent_date` / `notification_streak_sent_date` に今日の日付が入るため、同じ日に 2 回目は送られない。reminder は既定で ON・09:00 なので、確認する日にすでに送られていることがある

#### `reminder`
- `/admin/settings/notifications` で「リマインダー通知」を ON にし、時刻を現時刻の直前に設定する（時刻はサイレント時間帯の外に置く）
- 今日まだ記録していない子供がいる状態にする（全員が記録済みの日は送らない、ADR-0012）
- cron は 15 分ごとなので最大 15 分待つ → 親端末で OS 通知が表示されることを確認

#### `streak-warning`
- 子供アカウントで前日に活動 record を残し、今日活動なしの状態にする
- 19:00〜21:00 JST（サイレント時間帯の開始前）の cron（15 分ごと）で OS 通知が表示されることを確認する。21:00 以降は送られず、翌日には前日のストリークが途切れているため、この状態は作り直しになる

#### `achievement` / `level_up`
- `/admin/settings/notifications` で「達成通知」を ON にする
- 子供アカウントで活動を 1 件記録する → 親端末に「きろく完了！」の OS 通知が表示されることを確認（その記録でレベルが上がったときは「レベルアップ！」）
- サイレント時間帯（既定 21:00〜07:00）に記録した分は送られない（あとから送り直さない）

#### `monthly_habit`
- `/admin/settings/notifications` で「達成通知」を ON にする
- その月に記録した日数が 10 日に届く日に、子供アカウントでその日最初の記録をする → 親端末に月の習慣化の証明書の OS 通知が表示されることを確認（子供 1 人につき月 1 回）
- 「達成通知」を OFF にした状態では push は届かず、証明書・ポイント・子供の次回起動時の告知だけが出ることを確認

### 2.3 トラブルシューティング

| 現象 | 原因 | 対応 |
|---|---|---|
| permission grant したのに通知来ない | 購読が作られていない（鍵の配布前に許可だけ済ませた）/ VAPID 鍵が Lambda env に無い / 鍵を作り直した後の古い購読 / その種類を止める設定がオフ（§1.1）/ サイレント時間帯・1 日 3 通の上限・当日送信済み | `/admin/settings/notifications` で通知と種類の設定を確認し、オンにし直す。§2.1 で Lambda env のキー名・送信実績ログ・alarm を確認する |
| 通知来るが Title / Body が空 | service-worker.js の payload parse 失敗 | DevTools Console でエラー確認、`push-service-payload.test.ts` 再実行 |
| 子供端末にも配信される | subscriber_role guard 失効 | `notification-service.ts` の `sendPushNotification` の filter 確認、`push-subscribe-anti-engagement.spec.ts` 再実行 |
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
- `/admin/reports` の週次タブで「週次レポートを有効にする」を ON にし、配信曜日を今日にして保存する（standard 以上）
- 今日の 09:00 JST 以降の cron（15 分ごと）で送信される。件名は「🌟 <子供の名前>の今週のがんばり（<期間>）」（子供ごとに 1 通、`email-service.ts` の `sendWeeklyReportEmail`）
- 受信を確認
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
- **OSS 先調査ルール**（`docs/decisions/README.md` §OSS 先調査ルール）: Phase B で `web-push` / `@aws-sdk/client-ses` を業界標準として採用済
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

## 1. 通知 9 系統 全体マップ

| # | 系統 | 種類 | 実装 | cron / trigger | プラン gate |
|---|---|---|---|---|---|
| 1 | reminder | Push | `notification-delivery-service.runNotificationDelivery` → `notification-service.sendPushNotification` | `/api/cron/notification-delivery` (15 分毎、`notification_reminder_time` を過ぎた家庭に 1 日 1 回) | 全プラン |
| 2 | streak-warning | Push | 同上 (`streak_warning` type) | 同 cron (19:00 JST 以降、今日未記録かつストリーク継続中) | 全プラン |
| 3 | achievement | Push | `sendAchievementNotification` | `activity-log-service` 完了 hook | 全プラン |
| 4 | level_up | Push | 同上 (`level_up` type) | `activity-log-service` 完了 hook (level up 時) | 全プラン |
| 5 | monthly_habit | Push | `certificate-service.issueMonthlyHabitCertificateIfEligible` → `notification-service.sendPushNotification` (達成通知の設定がオンのときだけ) | `activity-log-service` 完了 hook (その日最初の記録で、月の記録日数が 10 日に届いたとき。子供 1 人につき月 1 回) | 全プラン |
| 6 | weekly-report | Email | `notification-delivery-service.runNotificationDelivery` → `email-service.sendWeeklyReportEmail` | `/api/cron/notification-delivery` (`weekly_report_day` の 09:00 JST 以降に週 1 回)。`/api/v1/admin/weekly-report` は body で対象を受け取る手動 / 外部呼び出し用の口として存続 | standard 以上 (#735) |
| 7 | lifecycle (renewal + dormant) | Email | `lifecycle-email-service.runLifecycleEmails` | `/api/cron/lifecycle-emails` (daily) | 全プラン (年 6 回上限) |
| 8 | trial (3day/1day/today) | Email | `trial-notification-service.processTrialNotifications` | `/api/cron/trial-notifications` (daily) | trial 中のみ |
| 9 | pmf-survey | Email | `pmf-survey-service.runPmfSurveyDistribution` | `/api/cron/pmf-survey` (年 2 回) | owner 全件 (年 6 回上限と共有) |

---

## 2. 配布証跡 (ADR-0006 整合)

### VAPID 鍵 (#2191 AC2)

配布経路・確認コマンド・鍵の生成と登録は本文 §2.1 が SSOT（GitHub Actions Secrets → `deploy.yml` の `-c vapidPublicKey` / `-c vapidPrivateKey` → CDK → 本番 app Lambda env の 1 本だけ。SSM は使わない。staging / NUC には配らない）。

**未配布時のフォールバック動作**:
- `notification-service.ts` の `sendPushNotification` が `[push-alert] vapid-missing` を warn し、`{ sent: 0, failed: 0 }` を返す。cron は 200 のままなので、本番では alarm `ganbari-quest-push-vapid-missing` で検知する (本文 §2.1)
- 本番では鍵が未指定 / 形式不正 / 組になっていないと `deploy.yml` の `Validate required secrets` と CDK synth が止めるため、この状態のまま deploy されることはない

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
curl -X POST http://localhost:5174/api/cron/notification-delivery \
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
- streak-warning: 連続記録途切れ警告 (`notification-delivery` cron 経由、19:00 JST 以降)
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
| サーバ log `[push-alert] vapid-missing` / alarm `ganbari-quest-push-vapid-missing` | 本番 Lambda env に鍵が無い（staging では想定内） | 本文 §2.1 で Secrets の登録と Lambda env のキー名を確認し、deploy.yml で再デプロイ |
| `[notification] レート制限またはサイレント時間帯のためスキップ` | 日次 3 通上限 / 21-07 JST | 設定画面でサイレント時間帯変更、または翌日待つ |
| `[notification] 非 parent/owner role の subscription への送信をスキップ` | child role で subscribe 済 (過去 bug 想定) | `push_subscriptions` テーブルから `subscriber_role='child'` 行を削除 |
| 410 / 404 で `stale subscription を削除` | ブラウザ側で通知許可解除済 | 正常動作、re-subscribe 必要 |
| サーバ log `[push-alert] send-failed status=<status>` / alarm `ganbari-quest-push-send-failed` | 401 / 403 = 公開鍵と秘密鍵の組違い（購読を作った公開鍵と署名する秘密鍵が合わない）/ `none` = timeout・接続失敗 / 5xx = push サービス側 | 401 / 403 は控えの組と Secrets の組を照合し、組で登録し直して deploy.yml で再デプロイ（本文 §2.1 の鍵の作り直し）。5xx / `none` が続くなら push サービスの障害情報を確認 |

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
- VAPID 鍵ローテーション時は本文 §2.1 の手順で GitHub Secrets の `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` を組で差し替え → deploy.yml で本番デプロイ → 既存の購読は無効になるため保護者に再購読を案内する
- SES sender ID 変更時は DKIM/SPF 再設定 + §2 確認コマンド再実行
