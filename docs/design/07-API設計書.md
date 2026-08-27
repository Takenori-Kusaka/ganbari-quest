# がんばりクエスト API設計書

| 項目 | 内容 |
|------|------|
| 版数 | 2.17 |
| 作成日 | 2026-02-19 |
| 更新日 | 2026-04-17 |
| 作成者 | 日下武紀 |

---

## 1. API設計方針

- **SvelteKit ファイルシステムルーティング**: `src/routes/api/v1/**/+server.ts` で定義
- **JSON API**: リクエスト・レスポンスは全てJSON
- **Zodバリデーション**: 全エンドポイントでリクエストボディをZodでバリデーション
- **一貫したエラーレスポンス**: `{ error: { code: string, message: string } }` 形式
- **認証**: 二層認証（Identity + Context）。cognito モードでは全 API にロールベース認可を適用。local モードでは管理画面のみ PIN 認証
- **レートリミット**: cognito モードで API 100 req/min、認証 10 req/min per IP

---

## 2. エンドポイント一覧

### 認証・ヘルスチェック

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| GET | /api/health | ヘルスチェック（deep、監視用） | 不要 |
| GET | /api/ready | readiness probe（shallow、LWA 用 #3657） | 不要 |
| POST | /api/v1/auth/login | Cognito ログイン（Email/Password） | 不要 |
| POST | /api/v1/auth/logout | ログアウト（Cookie クリア） | 不要 |
| GET | /auth/callback | Cognito OAuth コールバック | 不要 |
| POST/GET | /auth/logout | ログアウト（Cookie クリア + リダイレクト） | 不要 |

### 親ゲート（PIN）認証（#2310 / #3070）

保護者専用画面（`/admin/*` / `/switch`）を子供から保護する PIN ゲート。session は `cookie-signature` 署名 httpOnly cookie（ADR-0050）。PIN reset は本人確認方式を識別タイプで分岐する: **password ユーザは再認証 password**、**federated（Google）ユーザは登録メールへの 6 桁 email-OTP**（#3070、子はメールを読めないため silent SSO 通過の穴を塞ぐ）。

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| POST | /api/v1/parent-gate/setup | 初回 PIN 設定（`{ pin }`、4〜6 桁。未設定時のみ。設定済は 403 `ALREADY_CONFIGURED`） | cognito（tenant 一致） |
| POST | /api/v1/parent-gate/verify | PIN 検証 → 親 session cookie 発行（`{ pin }`。不一致 401） | cognito（tenant 一致） |
| POST | /api/v1/parent-gate/logout | 親 session cookie クリア | cognito |
| POST | /api/v1/parent-gate/reset-request-code | **federated 専用**（#3070）。登録メール（`locals.identity.email`）へ 6 桁 OTP を送信し、署名 httpOnly cookie（`pin_reset_otp`、stateless）に格納。enumeration 防止のため送信成否に依らず常に `{ ok: true }`。code はログに残さない。非 federated / 非 cognito は 400 `NOT_SUPPORTED` | cognito（federated、tenant 一致） |
| POST | /api/v1/parent-gate/reset-verified | PIN reset 実行 + 本人確認（`{ newPin, password?, code? }`）。federated は `code`（OTP cookie 照合）、password ユーザは `password`（アカウント再認証）で検証 → `setupPin` で再設定 → 親 session 発行。`newPin` 不正は 400 `PIN_FORMAT` | cognito（tenant 一致） |

- **email-OTP フロー（federated）**: `reset-request-code`（OTP 発行 → メール送信 + `pin_reset_otp` 署名 cookie set）→ `reset-verified`（`{ newPin, code }` で cookie 照合）。OTP 形式は `^\d{6}$`。
- **レートリミット**: `reset-request-code` / `reset-verified` とも IP 単位 **5 回 / 15 分**（超過 429 `RATE_LIMITED`）。brute force 防止。
- **対象外**: local / anonymous モード（local の PIN 救済は operator reset #2994）。

### 子供関連

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| GET | /api/v1/activities | 活動一覧取得 | 全ロール |
| POST | /api/v1/activities | 活動追加 | owner/parent |
| GET | /api/v1/activities/[id] | 活動詳細取得 | 全ロール |
| PATCH | /api/v1/activities/[id] | 活動更新 | owner/parent |
| DELETE | /api/v1/activities/[id] | 活動削除 | owner/parent |
| PATCH | /api/v1/activities/[id]/visibility | 活動表示/非表示切替 | owner/parent |
| POST | /api/v1/activities/suggest | 活動名サジェスト（AI推定） | 不要 |
| GET | /api/v1/activity-logs | 活動ログ取得 | 全ロール |
| POST | /api/v1/activity-logs | 活動記録 | 全ロール |
| DELETE | /api/v1/activity-logs/[id] | 活動記録キャンセル | 全ロール |
| GET | /api/v1/points/[childId] | ポイント残高取得 | 全ロール |
| GET | /api/v1/points/[childId]/history | ポイント履歴取得 | 全ロール |
| POST | /api/v1/points/convert | ポイント変換 | owner/parent |
| POST | /api/v1/points/ocr-receipt | レシートOCR読取 | owner/parent |
| GET | /api/v1/status/[childId] | ステータス取得 | 全ロール |
| GET | /api/v1/evaluations/[childId] | 評価履歴取得 | 全ロール |
| GET | /api/v1/achievements/[childId] | 実績一覧取得 | 全ロール |
| GET | /api/v1/login-bonus/[childId] | ログインボーナス状態取得 | 全ロール |
| POST | /api/v1/login-bonus/[childId]/claim | ログインボーナス受取 | 全ロール |
| POST | /api/v1/children/[id]/activities/[activityId]/pin | ピン留め設定 | 全ロール |
| DELETE | /api/v1/children/[id]/activities/[activityId]/pin | ピン留め解除 | 全ロール |
| POST | /api/v1/children/[id]/avatar | アバター画像アップロード | owner/parent |
| GET | /api/v1/children/[id]/voices | カスタム音声一覧取得 | 全ロール |
| POST | /api/v1/children/[id]/voices | カスタム音声アップロード | owner/parent |
| PATCH | /api/v1/children/[id]/voices/[voiceId] | カスタム音声アクティブ切替 | owner/parent |
| DELETE | /api/v1/children/[id]/voices/[voiceId] | カスタム音声削除 | owner/parent |
| GET | /api/v1/activities/export | 個別バックアップ（#3079 AC4 で v2 統一）。**`?childId=<id>` 必須（#4692）**でその子 1 人分の活動を marketplace v2 envelope（activity-pack）JSON でダウンロード（reward-set / checklist と同型、checksum 付き）。childId 未指定は 400。復元は admin/activities `?/importFile` action（同じく childId 必須）。旧 v1（formatVersion='1.0'）ファイルからの復元は後方互換で受理（`migrateV1ActivityPackToV2`） | owner/parent |
| POST | /api/v1/activities/import | 活動パック形式でインポート。**取込先 child は body `childIds`（省略時は家族全員）で明示する（#4692）** — 「tenant 最初の子に silent bind」は廃止。子供 0 人の tenant は 400 | owner/parent |

### 特別報酬

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| GET | /api/v1/special-rewards/[childId] | 子供の特別報酬一覧 | 全ロール |
| POST | /api/v1/special-rewards/[childId] | 特別報酬作成 | owner/parent |
| POST | /api/v1/special-rewards/[rewardId]/shown | 報酬表示済みマーク（`selectedChildId` cookie 必須、`(childId, rewardId)` 複合キーで所有権検証 #2845。cookie 不在 400 / 不一致 404） | 全ロール |
| GET | /api/v1/special-rewards/templates | 報酬テンプレート一覧 | owner/parent |
| PUT | /api/v1/special-rewards/templates | 報酬テンプレート更新 | owner/parent |
| GET | /api/v1/special-rewards/export | 個別バックアップ（#3079）。`?childId=<n>` の reward 全件を marketplace v2 envelope（reward-set）JSON でダウンロード（`Content-Disposition: attachment`）。復元は admin/rewards `?/restoreFile` action | owner/parent |
| POST | /api/v1/special-rewards/suggest | ごほうびサジェスト（AI推定） | owner/parent |
| POST | /api/v1/cheer/suggest | 応援サジェスト（AI推定、family 限定、#2273） | owner/parent (family) |

### ごほうびショップ 交換申請（#1337）

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| POST | /api/v1/reward-redemption-requests | 交換申請作成（子供） | 全ロール（child 含む） |
| GET | /api/v1/reward-redemption-requests | 申請一覧取得（親用管理画面） | owner/parent |
| PATCH | /api/v1/reward-redemption-requests/:id | 申請承認/却下（親） | owner/parent |
| POST | /api/cron/expire-redemptions | 30 日経過申請を expired に移行（手動 / 外部呼び出し。`scheduleRegistry` / EventBridge / dispatcher には未登録） | cron 認証 |

### チェックリスト

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| POST | /api/v1/checklists/suggest | チェックリストサジェスト（AI推定） | owner/parent |
| GET | /api/v1/checklists/export | 個別バックアップ（#3079）。`?templateId=<id>` の family checklist テンプレート 1 件を marketplace v2 envelope（checklist）JSON でダウンロード。復元は admin/checklists `?/restoreFile` action（payload-driven、marketplace-import-flow.md §3.4） | owner/parent |

### おうえんメッセージ

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| GET | /api/v1/messages/[childId] | メッセージ履歴取得 | 全ロール |
| GET | /api/v1/messages/[childId]?mode=unshown | 未表示メッセージ取得 | 全ロール |
| POST | /api/v1/messages/[childId] | メッセージ送信 | owner/parent |
| POST | /api/v1/messages/[messageId]/shown | メッセージ表示済みマーク | 全ロール |

### 減少設定

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| GET | /api/v1/settings/decay | 減少強度設定取得 | owner/parent |
| PUT | /api/v1/settings/decay | 減少強度設定更新 | owner/parent |

### 使用時間ログ（#1292 / #2338）

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| POST | /api/v1/usage | セッション開始記録 | 全ロール |
| PATCH | /api/v1/usage | セッション終了記録 | 全ロール |

**backend 別挙動 (#4719)**:
`usage-log-service` は backend 分岐を持たず、facade `usage-log-repo.ts` → factory `getRepos().usageLog` (`IUsageLogRepo`) が backend を選ぶ。sqlite (NUC local / dev) と pg-core (cloud DSQL / NUC PGlite、`dsql/usage-log-repo.ts`、`usage_logs` 表) は記録・集計を行い `201 Created` + `{ id }` / PATCH は `200 OK` + `{ durationSec }`。`DATA_SOURCE=demo` は stub repo (永続化なし) で POST は dummy id `'0'` を返し、PATCH は行が無いため `204 No Content`。DB エラー時は service が `null` に正規化し endpoint は `204`（client は fire-and-forget、5xx alarm 抑止）。

### 画像・エクスポート

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| GET | /api/v1/images | favicon の現在パス取得（`?type=favicon`） | owner/parent |
| GET | /api/v1/export | データエクスポート（JSON / ZIP）。ZIP は `data.json` + 静的ファイル（avatars/voices/generated）+ `manifest.json` を同梱。#3375: `manifest.json` に全エントリの SHA-256 + バイト数を記録し、画像含む同梱バイナリの**偶発的破損**を import 前に照合可能にする（既存 `data.json` checksum は論理内容のみを保護）。`itemCounts`（主要エンティティ件数）も記録し **#3386 で import 側が data.json 実件数と照合**（部分欠損検出）。`dataVersion` は将来用メタデータ（復元 migration dispatch 未実装）。`manifest` は未署名のため意図的改竄の防止は対象外（将来スコープ）。圧縮は per-entry 制御（既圧縮画像=store / 構造化=deflate） | owner/parent |
| POST | /api/v1/import | データインポート（JSON / ZIP、静的ファイル復元）。#3375: ZIP に `manifest.json` があれば SHA-256 / サイズ / 存在を復元前に照合し、**偶発的破損（SHA-256/バイト数/存在の不一致）と manifest 記載ファイルの欠落、manifest 記載外ファイルの混入（注入）、#3386: itemCounts と data.json 実件数の不一致（部分欠損）を明示エラー化**（記載外ファイル・件数不一致は fail-closed で復元拒否）。#3386 / ADR-0062: エラー文言は内部 reason コード / 生パスを露出せず `labels.ts` 汎用文言を返す（内部詳細は logger のみ）。#3382: 設定値は allowlist キーでも import 時に値域/型/enum/制御文字を検証し不正値は skip。`manifest` は未署名のため**意図的改竄の防止は対象外**（manifest 再計算 / manifest 削除での downgrade が可能、将来スコープ）。`manifest.json` 無しの旧 ZIP / 旧 JSON は検証スキップで後方互換 | owner/parent |
| GET | /api/v1/export/cloud | クラウドエクスポート一覧取得 | owner/parent |
| POST | /api/v1/export/cloud | クラウドエクスポート作成 | owner/parent |
| DELETE | /api/v1/export/cloud/[id] | クラウドエクスポート削除 | owner/parent |
| GET | /api/v1/export/cloud/[id]/download | クラウドエクスポートの一時ダウンロード（presigned redirect / proxy stream、#3504） | owner/parent |
| POST | /api/v1/import/cloud | PINコードでクラウドインポート | owner/parent |
| GET | /uploads/avatars/[filename] | アバター画像配信 | 不要 |

### 管理系 API

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| GET | /api/v1/admin/invites | 招待一覧取得 | owner/parent |
| POST | /api/v1/admin/invites | 招待リンク作成 | owner/parent |
| DELETE | /api/v1/admin/invites/[id] | 招待リンク取消 | owner/parent |
| GET | /api/v1/admin/license | ライセンス情報取得 (Epic #2525 で削除済、§3.X 参照) | — |
| POST | /admin/license?/applyLicenseKey | ライセンスキー適用 (Epic #2525 で削除済、§3.X 参照) | — |
| DELETE | /api/v1/admin/members/[userId] | メンバー削除 | owner |
| POST | /api/v1/admin/members/[userId]/transfer-ownership | owner権限移譲 | owner |
| POST | /api/v1/admin/members/leave | テナントから脱退 | 全ロール |
| GET | /api/v1/admin/tenant/status | テナントステータス取得 | owner/parent |
| POST | /api/v1/admin/tenant/cancel | 解約申請（期末解約を予約、`cancel_at_period_end=true`。DB は書かない、#3991） | owner |
| POST | /api/v1/admin/tenant/reactivate | 解約の取り消し（`cancel_at_period_end=false`。予約が無ければ 409、#3986） | owner |
| POST | /api/v1/admin/tenant-cleanup | テナントクリーンアップ（管理用） | 内部API |
| POST | /api/v1/admin/cleanup-orphans | 孤立データクリーンアップ | 内部API |
| GET | /api/v1/admin/migration | マイグレーション統計取得 | 内部API |
| POST | /api/v1/admin/weekly-report | 週次レポート生成トリガー | 内部API |
| POST | /api/v1/admin/notifications/reminder | リマインダー通知送信 | 内部API |
| POST | /api/v1/admin/notifications/streak-warning | ストリーク途切れ警告送信 | 内部API |
| POST | /api/v1/admin/account/delete | アカウント（テナント）完全削除 | owner |
| GET | /api/v1/admin/account/deletion-info | 削除対象データ概要取得 | owner |
| GET | /api/v1/admin/viewer-tokens | 閲覧専用トークン一覧取得 | owner/parent |
| POST | /api/v1/admin/viewer-tokens | 閲覧専用トークン作成 | owner/parent |
| DELETE | /api/v1/admin/viewer-tokens/[id] | 閲覧専用トークン無効化 | owner/parent |

### フィードバック

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| POST | /api/v1/feedback | アプリ内フィードバック送信（Discord webhook 転送） | 必須 |

### 設定 API

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| GET | /api/v1/settings/vapid-key | VAPID公開鍵取得（Push通知用） | 不要 |
| POST | /api/v1/settings/tutorial | チュートリアル完了マーク | owner/parent |
| POST | /api/v1/notifications/subscribe | Push通知購読登録 | owner/parent |
| POST | /api/v1/notifications/unsubscribe | Push通知購読解除 | owner/parent |

### Stripe（決済）

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| POST | /api/stripe/checkout | Stripe Checkout セッション作成 | owner/parent |
| POST | /api/stripe/portal | Stripe カスタマーポータル作成 | owner/parent |
| POST | /api/stripe/webhook | Stripe Webhook 受信 | 不要（Stripe署名検証） |

### 解約フロー（#1596 / ADR-0023 §3.8 / I3）

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| GET  | /admin/subscription/cancel | 解約理由ヒアリングフォーム表示 | owner/parent |
| POST | /admin/subscription/cancel | 解約理由送信（form action）→ Stripe Portal リダイレクト or thanks | owner/parent |
| GET  | /admin/subscription/cancel/thanks | 送信完了画面 | owner/parent |

**form action body (form-data):**
- `category` (必須): `'graduation'` \| `'churn'` \| `'pause'`
- `freeText` (任意, 0〜1000 文字)

**処理:**
1. `cancellation-service.submitCancellationReason()` を呼び出して DB 永続化
2. Discord には通知しない（`churn` チャネルは持たない。理由は `23-Discordサーバー設計書.md §4.5`。理由・自由記述は `cancellation_reasons` に残り ops dashboard から集計する）
3. 課金プランかつ `stripeCustomerId` 存在 → Stripe Customer Portal セッションを作成して 303 リダイレクト
4. 無料プラン or Portal 不可 → `/admin/subscription/cancel/thanks` に 303 リダイレクト

**バリデーション:**
- `category` が 3 分類いずれでもない → 400 + `INVALID_CATEGORY`
- `freeText` が 1000 文字超 → 400 + `FREE_TEXT_TOO_LONG`

**`category='graduation'` 選択時の追加分岐（#1603 / ADR-0023 §5 I10）:**

`submitCancellationReason()` 完了後、Stripe Portal リダイレクトの前に専用ページへ 303 redirect:
- `redirect(303, '/admin/subscription/cancel/graduation')`

### 卒業フロー（#1603 / ADR-0023 §3.8 / §5 I10）

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| GET  | /admin/subscription/cancel/graduation | 卒業専用ページ表示 | owner/parent |
| POST | /admin/subscription/cancel/graduation | 事例公開承諾送信 → 解約完了 | owner/parent |

**load 戻り値:**
- `totalPoints: number` — 全子供の getBalance() 合計
- `yenAmount: number` — 還元提案表示用の現金換算想定額（pt × 1）
- `usagePeriodDays: number` — テナント作成日からの利用日数
- `isPaidPlan: boolean`, `hasStripeCustomer: boolean` — リダイレクト分岐用
- `nicknameMaxLength: number = 30`, `messageMaxLength: number = 500`

**form action body (form-data):**
- `consented` (任意): チェックボックス値 `'on'` で承諾扱い
- `nickname` (consented=true 時必須, 1〜30 文字): 公開時の表示名（実名禁止）
- `message` (任意, 0〜500 文字): 任意の卒業メッセージ
- `totalPoints` (hidden): load で取得した残ポイント値（保存用）
- `usagePeriodDays` (hidden): load で取得した利用日数（保存用）

**処理:**
1. `graduation-service.recordGraduationConsent()` で graduation_consent テーブル / DynamoDB に保存
2. 課金プラン（stripeCustomerId あり）→ `/admin/subscription` に 303 redirect
3. 無料プラン → `/admin/subscription/cancel/thanks` に 303 redirect

**バリデーション:**
- nickname が空 (consented=true 時) → 400 + `errorKey='errorNicknameRequired'`
- nickname > 30 文字 → 400 + `errorKey='errorNicknameTooLong'`
- message > 500 文字 → 400 + `errorKey='errorMessageTooLong'`

#### graduation-service 関数定義

| 関数 | 引数 | 戻り値 | 副作用 |
|------|------|--------|--------|
| `recordGraduationConsent(input)` | `{ tenantId, nickname, consented, userPoints, usagePeriodDays, message? }` | `{ ok: true, record } \| { ok: false, error: 'NICKNAME_REQUIRED' \| 'NICKNAME_TOO_LONG' \| 'MESSAGE_TOO_LONG' }` | graduation_consent テーブルに insert |
| `getGraduationStats(days=90)` | `days: number` | `GraduationStats { totalGraduations, consentedCount, avgUsagePeriodDays, totalCancellations, graduationRate, publicSamples[] }` | なし |
| `calculateUsagePeriodDays(tenantCreatedAt, now?)` | `tenantCreatedAt: string, now?: Date` | `number` (日数) | なし（純関数） |

#### ops-analytics-service 拡張

`OpsAnalyticsData.graduation` フィールドを追加。`/ops/analytics` の load 時に
`repos.graduationConsent.aggregateRecent(90)` を呼び、`cancellationReasons.total` を分母に
`graduationRate` を計算する（循環 import 回避のため `getGraduationStats()` ではなく
直接 repo を呼ぶ）。

### バトルアドベンチャー

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| GET | /api/v1/battle/[childId] | 今日のバトル情報取得（未生成なら自動生成） | 全ロール |
| POST | /api/v1/battle/[childId] | バトル実行（サーバ側で状態検証） | 全ロール |

### アナリティクス

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| POST | /api/v1/analytics | クライアント側イベント記録 | 不要（tenantIdは自動付与） |
| GET | /api/v1/analytics/status | アナリティクス設定状態取得 | 全ロール |

#### analytics-service 集計 API（service 層、HTTP 経由ではなく `+page.server.ts` から直接呼出）

`/admin/analytics` 画面 (#1639) が消費する 4 種集計関数。Pre-PMF (ADR-0010) のため事前集計レコードは未導入で直接 query（~100 テナント想定）。

| 関数 | 引数 | 戻り値 | 集計元 | キャッシュ |
|------|------|--------|--------|---------|
| `getActivationFunnel(period)` | `'7d' \| '30d'` | `ActivationFunnelResult { period, steps[4], scannedDates, fetchedAt }` | DynamoDB GSI2 (`GSI2PK=ANALYTICS#EVENT#<name>`、4 events × 期間内日付) | なし |
| `getRetentionCohort(period)` | `'weekly' \| 'monthly'` | `RetentionCohortResult { period, dayPoints, cohorts[], fetchedAt }` | `cohort-analysis-service.getCohortAnalysis` を再利用（Day 1/7/14/30/60/90） | なし |
| `getSeanEllisScore(round?)` | `'YYYY-H1' \| 'YYYY-H2' \| undefined` | `PmfSurveyAggregation` (既存型、totalResponses / seanEllisScore / pmfAchieved 等) | `pmf-survey-service.aggregateSurveyResponses` を再利用 | なし |
| `getCancellationReasons(period)` | `'30d' \| '90d'` | `CancellationReasonResult { period, total, breakdown[], fetchedAt }` | `cancellation-service.getCancellationReasonAggregation` を再利用 | なし |

**エラー方針**: 各関数の失敗は `+page.server.ts` 側で `Promise.allSettled` を使い部分縮退（1 セクションが落ちても他セクションは表示）。`getActivationFunnel` 内部の DynamoDB query 失敗時は zero counts で fallback（Pre-PMF: 個別エラーログのみ、画面全体は崩さない）。

**Follow-up（事前集計）**: 集計頻度が高くなれば cron で `PK=ANALYTICS_AGG#<date>` を書く設計に移行する（別 Issue）。

---

## 3. エンドポイント詳細

### 3.1 子供関連

#### GET /api/v1/children

子供一覧を取得する。

**レスポンス:**
```json
{
  "children": [
    {
      "id": 1,
      "nickname": "おじょうさま",
      "age": 4,
      "theme": "pink",
      "level": 4,
      "totalPoints": 1250,
      "createdAt": "2026-01-01T00:00:00Z"
    }
  ]
}
```

#### GET /api/v1/children/[id]

子供の詳細情報を取得する。

**レスポンス:**
```json
{
  "id": 1,
  "nickname": "おじょうさま",
  "age": 4,
  "theme": "pink",
  "level": 4,
  "levelTitle": "つよつよチャレンジャー",
  "totalPoints": 1250,
  "statuses": {
    "うんどう": { "value": 72, "deviationScore": 58, "stars": 3 },
    "べんきょう": { "value": 58, "deviationScore": 52, "stars": 2 },
    "おてつだい": { "value": 85, "deviationScore": 65, "stars": 3 },
    "コミュニケーション": { "value": 45, "deviationScore": 48, "stars": 2 },
    "せいかつ": { "value": 62, "deviationScore": 55, "stars": 3 }
  },
  "characterImage": "/images/characters/hero-1.png",
  "createdAt": "2026-01-01T00:00:00Z"
}
```

### 3.2 活動関連

#### GET /api/v1/activities

活動一覧を取得する。

**クエリパラメータ:**

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| childId | number | いいえ | 子供IDでフィルタ（年齢・表示設定考慮） |
| category | string | いいえ | カテゴリでフィルタ |
| includeHidden | boolean | いいえ | 非表示活動も含める（管理画面用） |

**レスポンス:**
```json
{
  "activities": [
    {
      "id": 1,
      "name": "たいそうした",
      "category": "うんどう",
      "icon": "exercise",
      "basePoints": 5,
      "ageMin": null,
      "ageMax": null,
      "isVisible": true,
      "dailyLimit": null
    }
  ]
}
```

#### POST /api/v1/activities（PIN認証必要）

活動を追加する。

**リクエストボディ:**
```json
{
  "name": "さんすうをした",
  "category": "べんきょう",
  "icon": "math",
  "basePoints": 5,
  "ageMin": 5,
  "ageMax": null,
  "targetChildIds": null
}
```

**Zodスキーマ:**
```typescript
const createActivitySchema = z.object({
  name: z.string().min(1).max(50),
  category: z.enum(['うんどう', 'べんきょう', 'おてつだい', 'コミュニケーション', 'せいかつ']),
  icon: z.string().min(1),
  basePoints: z.number().int().min(1).max(100),
  ageMin: z.number().int().min(0).max(20).nullable(),
  ageMax: z.number().int().min(0).max(20).nullable(),
  targetChildIds: z.array(z.number()).nullable(),
});
```

### 3.3 活動ログ関連

#### POST /api/v1/activity-logs

活動を記録する（子供が操作）。

**リクエストボディ:**
```json
{
  "childId": 1,
  "activityId": 3
}
```

**レスポンス (201 Created):**
```json
{
  "id": 42,
  "childId": 1,
  "activityId": 3,
  "activityName": "しょっきをはこんだ",
  "basePoints": 5,
  "streakDays": 3,
  "streakBonus": 2,
  "totalPoints": 7,
  "recordedAt": "2026-02-19T18:30:00Z",
  "cancelableUntil": "2026-02-19T18:30:05Z"
}
```

**エラー (409 Conflict):**
```json
{
  "error": {
    "code": "ALREADY_RECORDED",
    "message": "きょうはもうやったよ！"
  }
}
```

#### DELETE /api/v1/activity-logs/[id]

活動記録をキャンセルする（5秒以内）。

**レスポンス (200):**
```json
{
  "message": "記録をキャンセルしました",
  "refundedPoints": 5
}
```

**エラー (400):**
```json
{
  "error": {
    "code": "CANCEL_EXPIRED",
    "message": "キャンセル期限を過ぎています"
  }
}
```

#### GET /api/v1/activity-logs

活動ログを取得する。

**クエリパラメータ:**

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| childId | number | はい | 子供ID |
| period | string | いいえ | "week" / "month" / "year"（デフォルト: "week"） |
| from | string | いいえ | 開始日（ISO 8601） |
| to | string | いいえ | 終了日（ISO 8601） |

**レスポンス:**
```json
{
  "logs": [
    {
      "id": 42,
      "activityName": "しょっきをはこんだ",
      "activityIcon": "dish",
      "category": "おてつだい",
      "points": 5,
      "recordedAt": "2026-02-19T18:30:00Z"
    }
  ],
  "summary": {
    "totalCount": 8,
    "totalPoints": 36,
    "byCategory": {
      "うんどう": { "count": 3, "points": 15 },
      "おてつだい": { "count": 5, "points": 21 }
    }
  }
}
```

### 3.4 ポイント関連

#### GET /api/v1/points/[childId]

ポイント残高を取得する。

**レスポンス:**
```json
{
  "childId": 1,
  "balance": 1250,
  "convertableAmount": 1000,
  "nextConvertAt": 1500
}
```

#### POST /api/v1/points/convert（PIN認証必要）

ポイントをお小遣いに変換する。

**リクエストボディ:**
```json
{
  "childId": 1,
  "amount": 500
}
```

**Zodスキーマ:**
```typescript
const convertPointsSchema = z.object({
  childId: z.number().int().positive(),
  amount: z.number().int().positive().multipleOf(500),
});
```

**レスポンス (200):**
```json
{
  "message": "500ポイントをおこづかいにかえました",
  "convertedAmount": 500,
  "remainingBalance": 750
}
```

### 3.5 ステータス関連

#### GET /api/v1/status/[childId]

子供のステータスを取得する。

**レスポンス:**
```json
{
  "childId": 1,
  "level": 4,
  "levelTitle": "つよつよチャレンジャー",
  "expToNextLevel": 12,
  "statuses": {
    "うんどう": {
      "value": 72,
      "deviationScore": 58,
      "stars": 3,
      "trend": "up",
      "lastActivityAt": "2026-02-19T18:30:00Z"
    },
    "べんきょう": {
      "value": 58,
      "deviationScore": 52,
      "stars": 2,
      "trend": "stable",
      "lastActivityAt": "2026-02-18T15:00:00Z"
    }
  },
  "characterType": "hero",
  "characterImage": "/images/characters/hero-1.png"
}
```

### 3.6 ログインボーナス関連

#### GET /api/v1/login-bonus/[childId]

ログインボーナスの状態を取得する。

**レスポンス:**
```json
{
  "childId": 1,
  "claimedToday": false,
  "consecutiveLoginDays": 5,
  "lastClaimedAt": "2026-02-18T07:00:00Z"
}
```

#### POST /api/v1/login-bonus/[childId]/claim

ログインボーナスを受け取る（1日1回）。

**レスポンス (201 Created):**
```json
{
  "childId": 1,
  "rank": "中吉",
  "basePoints": 7,
  "consecutiveLoginDays": 6,
  "multiplier": 1.0,
  "totalPoints": 7,
  "message": "中吉！7ポイントゲット！"
}
```

**連続ログイン倍率適用時 (3日連続):**
```json
{
  "childId": 1,
  "rank": "小吉",
  "basePoints": 5,
  "consecutiveLoginDays": 3,
  "multiplier": 1.5,
  "totalPoints": 8,
  "message": "小吉！3にちれんぞくで1.5ばい！8ポイントゲット！"
}
```

**エラー (409):**
```json
{
  "error": {
    "code": "ALREADY_CLAIMED",
    "message": "きょうのボーナスはもうもらったよ！"
  }
}
```

### 3.7 認証関連

#### POST /api/v1/auth/login

Cognito モードのログイン。Email + Password で Cognito に認証し、JWT を Cookie に設定。

**リクエストボディ:**
```json
{
  "email": "parent@example.com",
  "password": "Password123"
}
```

**レスポンス (200):**
```json
{
  "success": true,
  "redirectTo": "/admin"
}
```

**レスポンス（確認コード要求時）:**
```json
{
  "challenge": "CONFIRM_SIGN_UP",
  "email": "parent@example.com"
}
```

#### POST /api/v1/auth/logout

セッション Cookie をクリアしてログアウト。

**レスポンス (200):**
```json
{
  "success": true
}
```

#### GET /auth/callback

Cognito OAuth コールバック。認可コードを受け取り、トークンを Cookie に設定してリダイレクト。

> **Cognito User Pool の email 属性は `mutable: true`** (ADR-0017 / #1366)。Google OAuth 再認証時に IdP から同じ email を「属性更新」として処理する Cognito の既定挙動に合わせるための設定。`mutable: false` 運用時は `user.email: Attribute cannot be updated` エラーで再ログインが不能になる。

### 3.8 実績関連

#### GET /api/v1/achievements/[childId]

子供の実績一覧を取得する。

**レスポンス:**
```json
{
  "achievements": [
    {
      "id": 1,
      "achievementId": "first-activity",
      "name": "はじめてのきろく",
      "description": "はじめてかつどうをきろくした",
      "icon": "🌟",
      "unlockedAt": "2026-02-20T10:00:00Z"
    }
  ]
}
```

### 3.9 特別報酬関連

#### GET /api/v1/special-rewards/[childId]

子供の特別報酬（マイルストーン報酬）一覧を取得する。

#### POST /api/v1/special-rewards/[childId]

特別報酬を作成する（保護者が設定）。

**リクエストボディ:**
```json
{
  "title": "ゲーム30分",
  "description": "10日連続達成のごほうび",
  "triggerType": "streak",
  "triggerValue": 10
}
```

#### GET /api/v1/special-rewards/templates

報酬テンプレート一覧を取得する。

#### PUT /api/v1/special-rewards/templates

報酬テンプレートを一括更新する。

#### POST /api/v1/special-rewards/suggest

テキスト入力からごほうびのタイトル・カテゴリ・ポイント・アイコンを AI で推定する。スタンダードプラン以上限定（#719）。

**リクエストボディ:**
```json
{
  "text": "おもちゃを買ってもらう"
}
```

**レスポンス:**
```json
{
  "title": "すきなおもちゃ",
  "points": 500,
  "icon": "🧸",
  "category": "もの",
  "source": "gemini"
}
```

- `category`: `もの` | `たいけん` | `おこづかい` | `とくべつ`
- `source`: `gemini`（Gemini API 推定）| `fallback`（キーワードマッチング）
- Gemini API が利用不可の場合はキーワード＋プリセットマッチングにフォールバック
- プレミアムプラン以外では `403 PLAN_LIMIT_EXCEEDED` を返す

#### POST /api/v1/cheer/suggest

子供のがんばり出来事テキストから応援内容（理由要約・カテゴリ・応援 P・アイコン）を AI で推定する。プレミアムプラン限定（#2273）。

**リクエストボディ:**
```json
{
  "text": "運動会で1位"
}
```

**レスポンス:**
```json
{
  "reason": "運動会で1位",
  "points": 500,
  "icon": "🥇",
  "category": "うんどう",
  "source": "gemini"
}
```

- `category`: `うんどう` | `べんきょう` | `せいかつ` | `こうりゅう` | `そうぞう` | `とくべつ`
- `points`: 出来事のすごさ評価（50/100/150/200/300/500/1000 から選択）
- `source`: `gemini`（Gemini API 推定）| `fallback`（キーワードマッチング）
- 既存 LLM 連携機構 (special-rewards/suggest と同基盤) を再利用、プロンプト/出力スキーマのみ別
- Gemini API が利用不可の場合はキーワードマッチングにフォールバック
- プレミアムプラン以外では `403 PLAN_LIMIT_EXCEEDED` を返す

#### POST /api/v1/checklists/suggest

テキスト入力からチェックリストのテンプレート名・アイコン・アイテム一覧を AI で推定する。プレミアムプラン限定（#720, #722）。

**リクエストボディ:**
```json
{
  "text": "小学3年生の月曜日の持ち物"
}
```

**レスポンス:**
```json
{
  "templateName": "がっこうのもちもの",
  "templateIcon": "🏫",
  "items": [
    { "name": "きょうかしょ", "icon": "📚", "frequency": "daily", "direction": "both" },
    { "name": "ノート", "icon": "📓", "frequency": "daily", "direction": "both" }
  ],
  "source": "gemini"
}
```

- `items[].frequency`: `daily` | `weekday:月` | `weekday:火` | ... | `weekday:土`
- `items[].direction`: `bring`（持参）| `return`（持帰）| `both`（往復）
- `source`: `gemini`（AI 推定）| `fallback`（プリセット/キーワードマッチング）
- Bedrock API が利用不可の場合は 5 種のプリセット（がっこう/たいいく/プール/えんそく/おとまり）＋キーワード分割にフォールバック
- プレミアムプラン以外では `403 PLAN_LIMIT_EXCEEDED` を返す

### 3.10 画像・エクスポート

#### GET /api/v1/images

favicon の現在パスを返す（`?type=favicon`）。生成済み favicon があればそのパス、無ければ静的アイコン
`/icon-character.png`、いずれも無ければ `null`。`type` が `favicon` 以外なら 400。

アバター画像のアップロードは `POST /api/v1/children/[id]/avatar` が担う。

**アバター / favicon の AI 生成（旧 `POST /api/v1/images`）は #4397 で廃止した。** 子供のニックネームと
年齢を運営者の環境の外にある生成 AI（Gemini）へ送る配線であり、プライバシーポリシー第 3 条 / 第 10 条の
開示と食い違っていたため、機能ごと撤去している。アバターの設定手段は写真アップロードのみ。

#### GET /api/v1/export

家族データを JSON 形式、または画像ファイルを同梱した ZIP 形式でエクスポートする（#780）。
子供プロフィール・活動記録・ポイント・ステータス・実績・シール獲得履歴・チェックリスト・特別報酬設定の全データを含む。

**認可:** owner/parent。

**プラン制限:** `PlanLimits.canExport=true` が必須。free プランは 403 `PLAN_LIMIT_EXCEEDED` を返す
（メッセージ: 「エクスポート機能はスタンダードプラン以上でご利用いただけます」）。standard / family は利用可能。

**UI ゲート（#773）:** `/admin/settings` の `+page.server.ts` が `PlanLimits.canExport` と `PlanLimits.maxCloudExports` を load データに含めて配布し、Svelte 側は free の場合にボタンを `disabled` にしつつ `PremiumBadge` と `/pricing` への CTA を表示する（「ボタンを押したら 403」という体験を事前に遮る）。バックエンド側のプランゲートは本 API の正仕様として保持。

**クエリパラメータ:**

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| childIds | string | いいえ | カンマ区切りの子供ID（省略時は全子供） |
| compact | `"1"` | いいえ | `"1"` のとき JSON を整形なし（改行・インデント無し）で出力。デフォルトは 2 スペース整形 |
| format | `"json"` \| `"zip"` | いいえ | `"zip"` のとき data.json + アップロード済み画像（avatar 等）を ZIP に同梱。デフォルト `"json"` |

**レスポンス（format=json）:**
- `Content-Type: application/json; charset=utf-8`
- `Content-Disposition: attachment; filename="ganbari-quest-backup-YYYY-MM-DD.json"`
- body は `exportFamilyData()` が返す `ExportData` 形式: `{ format, version, exportedAt, checksum, master, family, data }`。`data` 内に `activityLogs` / `pointLedger` / `statuses` / `childAchievements` / `childTitles` / `checklistTemplates` / `checklistLogs` / `specialRewards` / `dailyMissions` 等を含む（型定義: `src/lib/domain/export-format.ts`）

**レスポンス（format=zip）:**
- `Content-Type: application/zip`
- `Content-Disposition: attachment; filename="ganbari-quest-backup-YYYY-MM-DD.zip"`
- ZIP の中身:
  - `data.json`（JSON ファイルと同内容）
  - `avatars/{childId}/{filename}.png` / `voices/{childId}/{filename}` 等、`tenants/{tenantId}/` prefix 配下のアップロード済みファイル
- ZIP 同梱対象（`data.json` + 静的ファイル）の合計が 100MB を超える場合は、残りを silent skip せず **fail-closed で 400 を返す**（#3376）。不完全な ZIP を「フルバックアップ」として返すと、再生成不能な avatar/voice が無警告で欠落し manifest も truncated set で整合してしまうため。ユーザーには「バックアップ対象のデータが上限（100MB）を超えています」と明示する
- **#3694 (Function URL response 6MB cap 整合)**: AWS（aws-prod）は Lambda Function URL（BUFFERED）の response payload も 6MB hard cap のため、100MB fail-closed の**手前**で、構築 ZIP が実効上限（`resolveMaxSyncResponseBytes`、SSOT: `src/lib/server/services/function-url-limit.ts`）を超えた場合は **400 VALIDATION_ERROR で「クラウド共有（PIN コード）経由のバックアップ」を案内**する（edge の沈黙切断 = 「ダウンロードできない」状態を根絶）。NUC / local は Function URL 制約が無いため従来通り直 DL（100MB まで）を許可する
- **#3775 ① (JSON export 直 DL の 6MB cap 整合)**: `format=json`（既定）の直 DL body も同一の Function URL response 6MB cap 対象。#3694 は ZIP response のみ guard していたため残余だった。JSON body（マルチバイト JP を含むため `Buffer.byteLength` で byte 長判定）が `resolveMaxSyncResponseBytes` を超えた場合は同様に **400 VALIDATION_ERROR + クラウド共有導線**（`SETTINGS_LABELS.dataExportJsonTooLargeForDirectDownload`、JSON は画像・音声を含まないため専用文言）を返す。JSON はテキストのみで 6MB 超は稀だが、edge 沈黙切断の完全性のため塞ぐ。NUC / local は Infinity で従来通り直 DL

> **#3078**: `data.checklistLogs`（チェックリスト完了履歴）は `checklist-repo.findLogsByChild` で child 単位にバルク取得した実データを `templateName` 参照付きで含む（旧来の空配列固定を解消、activity ログと同様に往復対象）。

**保持期間との関係:**
エクスポート対象は DB 上に残っている全データ（`applyRetentionFilter` によるプラン別の履歴表示フィルタは本 API には適用されない）。
プラン別履歴保持期間（free: 90 日 / standard: 365 日 / family: 無制限）は表示フィルタのみで、物理削除は行わない（ADR-0027）。

**エントリポイント:**
`/admin/settings` ページの「データエクスポート」セクションから実行可能。`compact` と `format=zip` のチェックボックスが UI に露出している。

#### POST /api/v1/import

エクスポートした JSON または ZIP データをインポートする。

**クエリパラメータ:**

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| mode | string | いいえ | "preview"（プレビュー）、"execute"（追加インポート）、"replace"（置換インポート）。デフォルト: preview |

**リクエストボディ:**

- `Content-Type: application/json`: エクスポートされた JSON 全体（`ExportData`）。
- `Content-Type: application/zip`（#3077）: GET `/api/v1/export?format=zip` が出力した ZIP。`data.json` を export body として解析し、同梱の `avatars/{childId}/**` / `voices/{childId}/**` をインポート後の新 `childId` 配下（`tenants/{tenantId}/{type}/{newChildId}/...`）に復元する。子供の `avatarUrl` 参照は新 storage key（公開 URL）へ貼り替える。受理上限は実行環境で分岐する（#3325、SSOT: `src/lib/server/services/import-limit.ts`）: AWS（aws-prod）は Lambda Function URL（BUFFERED）の request payload 6MB hard cap に整合する 5.5MB、NUC / local は Function URL 制約が無いため export ZIP（`MAX_ZIP_SIZE`）と整合する 100MB。超過時は 400 VALIDATION_ERROR で「クラウド共有（PIN コード）経由の復元」を案内する（沈黙のハング禁止）。UI（settings/data）も同値を load 経由で受け取り、ファイル選択時に client-side pre-check する。JSON のみインポートは後方互換で動作する。

> **#3077 id 再マップ**: `ExportData.family.children[].sourceChildId`（v1.3.0 相当の追加フィールド、export 元の数値 childId）を介して ZIP 内パスの `{oldChildId}` を新 `childId` に解決する。`sourceChildId` が解決できない孤立ファイルはスキップする（`result.staticFilesSkipped`）。
>
> **#3078 checklistLogs**: `data.checklistLogs` の `templateName` をインポート後の新 `templateId` へ再マップして `checklist-repo.upsertLog` で復元する。重複（同一 `childId` × `templateId` × `checkedDate`）は事前スキップする（`result.checklistLogsImported` / `checklistLogsSkipped`）。

**replace モードの失敗時セマンティクス（#3326 / #4720）:**

| 状況 | HTTP / code | 文言 | 実際のデータ |
|---|---|---|---|
| 取込中に hard error（`errors > 0`） | 400 `VALIDATION_ERROR` | 「インポートに失敗したため中止しました（既存データは保全されています）」 | **旧データが復元済** |
| 置換前 snapshot の取得・保存に失敗 | 500 `INTERNAL_ERROR` | 「置換前のバックアップ取得に失敗したため、安全のため中止しました」 | **旧データ無傷**（置換を開始していない） |
| 取込失敗後の自動復元にも失敗（二次故障） | 500 `INTERNAL_ERROR` | 「インポートに失敗し、元のデータの自動復元にも失敗しました。運営に連絡してください（復旧用バックアップは保存されています）」 | `tenants/<tenantId>/recovery/*.zip` から手動復旧（Discord alert 送出） |

保全の実現手段は backend で異なる（sqlite = 単一 tx / pg 系 = clear 前 ZIP 退避の補償トランザクション）。SSOT: `backup-import-redesign.md` §atomicity。

**レスポンス（preview）:**
```json
{
  "ok": true,
  "preview": { "children": 2, "activityLogs": 150, "pointLedger": 80, ... }
}
```

**レスポンス（execute）:**
```json
{
  "ok": true,
  "result": { "childrenImported": 2, "activityLogsImported": 148, "errors": [] }
}
```

**レスポンス（replace）:**
```json
{
  "ok": true,
  "result": { "childrenImported": 2, "activityLogsImported": 148, "errors": [] },
  "cleared": { "children": 1, "activityLogs": 50, "pointLedger": 20, ... }
}
```

#### Marketplace export envelope schema v2 (#2372 / EPIC #2362 P4)

`src/lib/marketplace/export-schema.ts` で定義される 5 type 横断の統一 export envelope。個別 backup の export endpoint (`/api/v1/activities/export` #3079 AC4 / `/api/v1/special-rewards/export` / `/api/v1/checklists/export`) は全て本 v2 envelope を出力する。`/api/v1/activities/export` は当初 v1 (formatVersion='1.0') を出力していたが #3079 AC4 で v2 に統一した (v1 ファイルからの**復元**は後方互換で恒久受理)。

**envelope 構造**:

```json
{
  "schemaVersion": 2,
  "typeCode": "activity-pack" | "reward-set" | "checklist" | "rule-preset" | "challenge-set",
  "exportedAt": "2026-05-21T12:00:00.000Z",
  "payload": { ... type 別 SSOT schema (src/lib/marketplace/schemas/*) と完全一致 ... },
  "checksum": "<sha256-hex-64chars>"
}
```

**重要な性質**:

- **deterministic checksum**: `payload` を object key 再帰ソート (RFC 8785 簡易版) してから SHA-256。物理的な key 順違いでも同じ checksum が計算される (`src/lib/marketplace/checksum.ts`)
- **round-trip 保証**: `dispatchExport()` → `JSON.stringify` → `JSON.parse` → `parseExportEnvelopeV2()` → `MarketplacePayloadSchemaMap[typeCode]` で parse すれば元 payload と完全一致 (`tests/unit/marketplace/round-trip.test.ts` で 5 type 全網羅)
- **改竄検知**: checksum 不一致は import 経路 (`parseExportEnvelopeV2`) で fail-fast し、エラーメッセージは `[export-schema-v2] checksum mismatch — payload may be corrupted or tampered.`
- **後方互換**: 旧 v1 (`formatVersion: '1.0'`、#3079 AC4 以前の `/api/v1/activities/export` 出力 / 過去ユーザーが保存した活動 backup ファイル) は `migrateV1ActivityPackToV2()` で v2 envelope に変換可能。`parseAnyExportEnvelope()` は v1 / v2 を自動判別し、活動の `loadActivityPackFromFile` 復元経路で恒久受理する (回帰テストで削除を検知、ADR-0006)

**関連 ADR**:
- ADR-0052 (Marketplace Strategy + Registry) — type 別 Strategy が export envelope の `payload` を `parse()` で受理する契約
- ADR-0006 (後方互換性) — v1 → v2 migration を強制

#### export endpoint の Content-Disposition (RFC 5987、#3104)

ファイル名を user データ (テンプレート名 / ニックネーム等、非 ASCII 可) から動的に組む全 export endpoint は、`Content-Disposition` ヘッダを `src/lib/domain/export-format.ts` の `buildAttachmentContentDisposition(filename)` 経由で組む。HTTP ヘッダ値は ByteString (Latin-1, ≤ U+00FF) のため日本語名を直接入れると `new Response()` が TypeError で 500 になる (例: `/api/v1/checklists/export` の日本語テンプレ全滅)。

- **ASCII fallback**: `filename="..."` に出す値は非 ASCII (> U+007E) / 制御文字 / `"` / `\` を `_` に置換し、ByteString 安全 + ヘッダ injection 安全にする。
- **RFC 5987**: `filename*=UTF-8''<percent-encoded>` を併記し、modern browser が非 ASCII 名を復元する。percent-encoding は ext-value grammar の attr-char + pct-encoded のみで構成する。`encodeURIComponent` が escape しない `'` `(` `)` `*` `!` `~` は attr-char ではないため**追加で percent-encode** する (strict parser / proxy / WAF が不正値として reject するのを防ぐ)。
- 静的 ASCII 名 (例: `ganbari-quest-backup-YYYY-MM-DD.json`) は本 helper 不要だが、user 値を含む名は必ず本 helper を経由する。回帰テスト: `tests/unit/domain/export-format.test.ts`。

#### GET /api/v1/data/summary (#0205)

テナント内のユーザーデータ件数を取得する。認可: owner, parent。

**レスポンス:**
```json
{
  "ok": true,
  "summary": {
    "children": 2, "activityLogs": 347, "pointLedger": 892,
    "statuses": 2, "achievements": 5, "titles": 3,
    "loginBonuses": 10, "checklistTemplates": 2,
    "voices": 1
  }
}
```

#### POST /api/v1/data/clear (#0205)

テナント内の全ユーザーデータを削除する。システムマスタは保持。認可: owner のみ。

**リクエストボディ:**
```json
{ "confirm": "削除" }
```

**レスポンス:**
```json
{
  "ok": true,
  "deleted": {
    "children": 2, "activityLogs": 347, "pointLedger": 892,
    "statuses": 2
  }
}
```

#### POST /api/v1/points/ocr-receipt

レシート画像を OCR で読み取り、金額を抽出する。

**AIモデル:** AWS Bedrock Claude Haiku（画像入力 + tool_use）— レシート画像をマルチモーダル入力し、金額とテキストを構造化出力で抽出。provider は `AI_PROVIDER` で切替（`bedrock` 既定 / `gemini`）。

**失敗理由の区別（#4366）:** 顧客に伝える内容が変わるため、AI 側の事情と画像側の事情を混ぜない。

| 状況 | HTTP | `error.code` | 顧客向けの意味 |
|---|---|---|---|
| AI が設定されていない（`BEDROCK_MODEL_ID` / `GEMINI_API_KEY` 未配布、`BEDROCK_DISABLED=true`） | 503 | `AI_UNAVAILABLE` | 撮り直しを促さず手入力へ誘導する |
| AI 呼び出しが権限・資格情報・モデル未存在で失敗（`AccessDeniedException` 等） | 503 | `AI_UNAVAILABLE` | 同上（顧客の画像は無関係） |
| 画像から金額を読み取れなかった / 一時的失敗 | 422 | `OCR_FAILED` | 撮り直すか手入力する |

内部例外メッセージはレスポンスに載せない（ADR-0062 §2）。可用性の判定契約は `AiProvider.isAvailable()`（`src/lib/server/ai/provider.ts`）を参照。`false` は「呼んでも無駄」の確定、`true` は「設定が配られている」までの保証で、権限の有無は呼ぶまで確定しない。

**画像サイズ上限（#3694、Function URL 6MB request cap 整合）:** 画像は base64 JSON body で送信するため、AWS（aws-prod）では base64 化（デコード後 × 4/3）が Function URL 6MB request cap を超えると edge で沈黙拒否される。デコード後上限を runtime 実効値（約 4.14MB、`resolveMaxBase64DecodedBytes`、SSOT: `src/lib/server/services/function-url-limit.ts`）に下方整合し、超過は 400 VALIDATION_ERROR で明示する。NUC / local は Function URL 制約が無いため従来 5MB を維持する。受理上限の元定数は `RECEIPT_MAX_IMAGE_BYTES`（`src/lib/server/services/receipt-ocr-service.ts`、5MB）を SSOT とし、route の reject 判定と撮影ボタン note の表示値を同一値から導出する。

**撮影ボタン note の実効値同期（#3775 ②）:** 領収書撮影ボタンの note（`POINTS_LABELS.receiptCaptureButtonNote(maxMb)`）は、旧静的「5MB以下」が aws-prod の実効 reject 閾値（約 4.1MB）と乖離し「5MB と書いてあるのに 4.5MB が弾かれる」UX 齟齬を生んでいた。admin/points の load が `toDisplayMb(resolveMaxBase64DecodedBytes(RECEIPT_MAX_IMAGE_BYTES))` を解決して note に渡し、表示 MB を server の実効 reject 閾値（aws-prod 約 4.1MB / NUC・local 5MB）と一致させる。

#### GET /api/v1/export/cloud (#0294)

テナントのクラウドエクスポート一覧を取得する。認可: owner/parent。

**プラン制限:** `PlanLimits.maxCloudExports > 0` が必須（free=0 / standard=3 / family=10）。UI 側は `/admin/settings` で free プランの場合にクラウド共有カードをアップセル表示に切り替え、paid プランでは `保管枠 {現在} / {maxCloudExports}` のスロット残量を併記する（#773）。

**非同期 build 状態（#3504、async-backup-export.md §3.1/§3.3）:** `status` は `pending`（build 待ち）→ `building`（cron が生成中）→ `ready`（DL 可）/ `failed`（生成失敗、`failureReason` 併記）を遷移する。一覧は `expiresAt` / `downloadCount` 上限に加えて `pending`/`building`/`failed` も含めて返し、生成中の行が UI から消えないようにする。

**レスポンス:**
```json
{
  "ok": true,
  "exports": [
    {
      "id": 1,
      "exportType": "template",
      "pinCode": "ABC123",
      "label": "活動テンプレート共有用",
      "fileSizeBytes": 4096,
      "expiresAt": "2026-04-10T00:00:00Z",
      "downloadCount": 2,
      "maxDownloads": 10,
      "createdAt": "2026-04-03T10:00:00Z",
      "status": "ready",
      "failureReason": null
    }
  ]
}
```

#### POST /api/v1/export/cloud (#0294)

クラウドエクスポートを作成する。データをS3にアップロードし、共有用PINコードを発行する。認可: owner/parent。

**リクエストボディ:**
```json
{
  "exportType": "template",
  "label": "活動テンプレート共有用"
}
```

**Zodスキーマ:**
```typescript
const createCloudExportSchema = z.object({
  exportType: z.enum(['template', 'full']),
  label: z.string().max(100).optional(),
});
```

**レスポンス (201 Created、#3504 で非同期化):**
```json
{
  "ok": true,
  "export": {
    "id": 1,
    "pinCode": "ABC123",
    "exportType": "template",
    "expiresAt": "2026-04-10T00:00:00Z",
    "status": "pending"
  }
}
```

- `template`: 活動マスタ・チェックリストテンプレート等の設定データのみ（S3 には `data.json` として JSON 保存）
- `full`: 子供プロフィール・活動記録・ポイント等の全データ。**画像（アバター等の静的ファイル）を含む完全バックアップ ZIP（`backup.zip`）として S3 保存**（#3376）。zip 構築・解析・zip-bomb 防御・manifest 整合性検証は `src/lib/server/services/backup-archive.ts`（`buildFullBackupZip` / `parseBackupZip`）に一元化し、`/api/v1/export`・`/api/v1/import` と共有する
- **非同期 build（#3504、async-backup-export.md §3.2）**: 本 route は `cloud_exports` を `status='pending'` で insert して即座に返す（ZIP は同期生成しない）。生成本体は cron `export-build`（`/api/cron/export-build`、5 分毎）が `pending` レコードを拾い `building` → `buildFullBackupZip` → S3/ローカル FS 保存 → `ready`（失敗時 `failed` + `failureReason`）に遷移させる。クライアントは `GET /api/v1/export/cloud` の polling で状態変化を検知する

#### DELETE /api/v1/export/cloud/[id] (#0294)

クラウドエクスポートを削除する（S3上のファイルも削除）。認可: owner/parent。

**レスポンス (200):**
```json
{
  "ok": true
}
```

#### GET /api/v1/export/cloud/[id]/download (#3504)

生成済み（`status='ready'`）のクラウドエクスポートを一時ダウンロードする。認可: owner/parent + `record.tenantId` 一致（IDOR 遮断、CWE-598 対策は async-backup-export.md §3.4/§3.5 参照）。

**動作（runtime により配信経路が分岐）:**
- **AWS（S3）**: `storage.getDownloadUrl(s3Key, { expiresIn: 300 })` が presigned GET URL（TTL 300 秒）を返し、`302 Location` で redirect する。Lambda body 6MB / 30 秒制約を迂回する
- **NUC（ローカル FS）**: presigned 不在のため `storage.readFile` から認証済みで直接 stream する（`static/` 直配信はしない）

いずれの経路でも配信成功時に `downloadCount` を 1 消費する（`maxDownloads` 到達で 以後 `VALIDATION_ERROR`）。`status !== 'ready'` または `expiresAt` 経過時も `VALIDATION_ERROR` を返す。

**レスポンス:**
- 200（NUC proxy stream）: `content-type` / `content-disposition: attachment` 付き ZIP バイナリ
- 302（AWS redirect）: `Location` ヘッダに presigned URL
- エラー: `404 NOT_FOUND`（存在しない/他 tenant）、`400 VALIDATION_ERROR`（未準備・期限切れ・上限到達）

#### POST /api/v1/import/cloud (#0294)

PINコードを使って他テナントのクラウドエクスポートデータをインポートする。認可: owner/parent。`full` バックアップが画像込み ZIP（`backup.zip`）の場合は `isZipBytes` で判定し、`parseBackupZip` → `importFamilyData`（staticFiles 込み）で**画像を含む完全復元**を行う（#3376）。旧形式（`data.json` JSON、7 日以内に S3 残存）は非 ZIP として後方互換の JSON 復元経路にフォールバックする。ブラウザ DL を介さずアプリ内で取得するため、ZIP DL 時の Safe Browsing 警告が構造的に発生しない。

> **#3376 DL カウント消費タイミング**: ダウンロード回数（`downloadCount`）は **`mode=execute` / `replace` で validate 成功後の実取込時にのみ 1 消費**する。`mode=preview` および取込前の validation 失敗では消費しない。`fetchCloudExportByPin` は取得時に消費せず（quota チェックのみ）、`consumeCloudExportDownload` を取込実行直前に呼ぶことで、preview リトライや検証失敗で `maxDownloads` を食い潰して家族データを復元不能にする事故を防ぐ。

**クエリパラメータ:**

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| mode | string | いいえ | "preview"（プレビュー）、"execute"（追加インポート）、"replace"（置換インポート）。デフォルト: preview |

**リクエストボディ:**
```json
{
  "pinCode": "ABC123"
}
```

**レスポンス（preview）:**
```json
{
  "ok": true,
  "preview": { "activities": 15, "checklistTemplates": 3 },
  "source": { "exportType": "template", "label": "活動テンプレート共有用" }
}
```

**レスポンス（execute）:**
```json
{
  "ok": true,
  "result": { "activitiesImported": 15, "checklistTemplatesImported": 3, "errors": [] }
}
```

**エラー (404):**
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "PINコードが見つかりません。有効期限が切れているか、ダウンロード上限に達しています"
  }
}
```

**エラー (409、#4717): 生成待ち / 生成失敗**

クラウド共有は非同期 build (#3504) のため、PIN 発行直後は `status='pending'`（cron が拾うと `'building'`）で S3 実体がまだ無い。この窓で取り込もうとした場合は **409 + 待てば解決することが分かる案内**を返す（旧実装は 500「システムに問題が発生しました」を返し、受け取る側が障害と誤認していた）。

| status | code | HTTP | 意味 |
|---|---|---|---|
| `pending` / `building` | `EXPORT_NOT_READY` | 409 | まだ準備中（数分後に再試行で解決する。`action: retry`） |
| `failed` | `EXPORT_FAILED` | 409 | 生成に失敗している（共有した側が保管し直す必要がある。`action: none`） |

```json
{
  "error": {
    "code": "EXPORT_NOT_READY",
    "message": "このデータはまだ準備中です。数分後にもう一度お試しください。",
    "userMessage": "このデータはまだ準備中です。数分後にもう一度お試しください。",
    "severity": "info",
    "action": "retry"
  }
}
```

失敗理由は `CloudExportFetchError.reason`（型）で service → route に渡り、route の写像表 `FETCH_FAILURE_TO_ERROR_CODE` が HTTP 種別を決める。**message の文字列 match で分類しない**（新しい理由を足したときに分類から漏れて 500 に落ちるのを構造的に防ぐ）。

### 3.11 管理系 API

#### GET /api/v1/admin/invites

テナントの招待リンク一覧を取得する。

#### POST /api/v1/admin/invites

招待リンクを作成する。

**プラン別メンバー上限チェック (#1111):**

招待作成前に、テナントの現メンバー数がプラン別上限に達していないかチェックする。

| プラン | `maxFamilyMembers` | 説明 |
|--------|-------------------|------|
| Free | 1 | owner のみ（招待不可） |
| Standard | 4 | owner + 3人（核家族想定） |
| Premium | null（無制限） | 制限なし |

上限超過時は `403` を返す:

```json
{
  "error": "MEMBER_LIMIT_REACHED",
  "message": "メンバー上限（4人）に達しています。プランをアップグレードしてください。",
  "current": 4,
  "max": 4
}
```

**リクエストボディ:**
```json
{
  "role": "parent",
  "expiresInDays": 7
}
```

#### DELETE /api/v1/admin/invites/[id]

招待リンクを取り消す。パスセグメントは招待レコードの内部 ID（`inviteId`、`inv-<uuid v4>`）。取消（`revokeInvite` → `updateInviteStatus`）は query 層で `family_id` 述語により対象テナントの招待に限定され、cross-tenant mutation を物理排除する（ADR-0063 単一強制点）。

#### GET /api/v1/admin/license — deprecated (Epic #2525 で削除)

> **deprecated (Epic #2525 license key 全廃)**: 本 endpoint は物理削除された (PR-L3 PR #2822)。プラン情報は Stripe Subscription (`tenant.status`) から取得する。

テナントのライセンス情報を取得する。

#### POST /admin/license?/applyLicenseKey（SvelteKit form action）— deprecated (Epic #2525 で削除)

> **deprecated (Epic #2525 license key 全廃)**: 本 form action は物理削除された (PR-L1 PR #2812 で入力経路削除 → PR-L3 PR #2822 で route 削除)。有料化は Stripe Checkout webhook が唯一の経路。`license-subscription-causality.md` は deprecated (歴史記録)。

既存テナントにライセンスキーを適用する。owner ロール限定。

- **認可**: `requireRole(locals, ['owner'])`（parent/child → 403）
- **リクエスト**: FormData `licenseKey: string`
- **処理**: `validateLicenseKey` → `consumeLicenseKey(key, tenantId)`
- **成功レスポンス**: `{ apply: { success: true, plan, planExpiresAt } }`
- **エラーレスポンス**: `fail(400, { apply: { error, licenseKey } })` / `fail(500, { apply: { error } })`
- **因果関係**: `docs/design/license-subscription-causality.md` §2.8 を参照

### 3.12 Stripe（決済）

> 全エンドポイントの状態遷移と画面遷移は `docs/design/plan-change-flow.md` (#747) を SSOT とする。

#### POST /api/stripe/checkout

Stripe Checkout セッションを作成し、リダイレクト URL を返す。

- **認可**: `requireRole(locals, ['owner', 'parent'])`（child → 403）
- **リクエスト**: JSON `{ planId: 'monthly' | 'family-monthly', returnPath?: string }`（月額 2 種のみ。年額は新規購入の対象外。`returnPath` は相対パス（`/` 始まり）のみ許可し、それ以外は `/admin` に丸める）
- **成功レスポンス**: `{ url }`（Stripe Checkout URL。呼び出し側が遷移する）
- **`success_url`**: `returnPath` 指定時は `${origin}${returnPath}` + `session_id={CHECKOUT_SESSION_ID}`、未指定時は `${origin}/admin/subscription?session_id={CHECKOUT_SESSION_ID}`
- **`cancel_url`**: `returnPath` 指定時は `${origin}${returnPath}`、未指定時は `${origin}/pricing`
- **完了時の処理**: webhook `checkout.session.completed` → `handleCheckoutCompleted` でテナント plan を更新する
- **Price の解決 (#4286)**: `planId` → Price ID は **`getPriceId()`（`src/lib/server/stripe/config.ts`）単一経路**で解決する。`USE_LOOKUP_KEY=true` なら lookup_key（`standard_monthly` / `premium_monthly`）で解決し、解決に失敗したときだけ env var（`STRIPE_PRICE_STANDARD_MONTHLY` / `STRIPE_PRICE_FAMILY_MONTHLY`）へ fallback して alert を上げる。`false`（既定）なら env var 直読。**flag と env は両方効く** — flag が true でも env が設定されていれば lookup_key 失敗時の kill switch として機能し、env が無い配備でも lookup_key だけで購入が成立する。双方から解決できない場合のみ `PRICE_UNRESOLVED`
- **`USE_LOOKUP_KEY=true` でも price env を外さない**: env は lookup_key 解決が失敗したときの kill switch であり、外すと Stripe API 障害 / Price archive の瞬間に購入が 503 になる。env を落としてよいのは lookup_key 移行 Step 4（旧 Price archive、[phase6-context-decisions-6.md §4.1](billing-redesign/phase6-context-decisions-6.md)）に到達した時点
- **`getPlans().priceId`（env var 直読）を line_item に使わない**: 直読すると `USE_LOOKUP_KEY` がどの経路にも効かず、price env を注入しない配備で購入が必ず失敗する。`tests/unit/architecture/stripe-price-resolution-single-entrypoint.test.ts` が呼び出し構造を固定する
- **エラーコード**: `STRIPE_DISABLED` / `TENANT_NOT_FOUND` (404) / `ALREADY_SUBSCRIBED` (409) / `INVALID_PLAN` (400) / **`PRICE_UNRESOLVED` (503)**
  - `PRICE_UNRESOLVED` が **503** なのは、**配備の設定不備であって顧客の入力誤りではない**ため。4xx で返すと顧客側の操作ミスに見え、原因が運用側にあることが隠れる
  - `STRIPE_DISABLED`（決済機能自体が無効な配備）と `PRICE_UNRESOLVED`（lookup_key / env 双方から Price ID を解決できない設定不備）は **同一 503 だが文言を分ける**（#4286）。同一文言だと顧客が原因を区別できず離脱していたため。`PRICE_UNRESOLVED` の文言は `SUBSCRIPTION_PAGE_LABELS.checkoutErrorPriceUnresolved`（`src/lib/domain/labels.ts`、DESIGN.md §6 SSOT）を参照する。エラーレスポンス body は `{ message }` のみで機械可読なエラーコードは含まないため、両エラーは HTTP ステータス単体では判別できず、文言（または呼び出し元でのログ相関）でのみ判別できる

#### POST /api/stripe/portal

Stripe カスタマーポータルの URL を作成し、ユーザーをリダイレクトする。

- **認可**: `requireRole(locals, ['owner', 'parent'])`（child → 403）
- **PIN ゲート (#771)**:
  - `pinConfigured = true` のテナント: PIN（4-6 桁）入力 → `verifyPin`
  - `pinConfigured = false` のテナント: 確認フレーズ「`プランを変更します`」入力
  - 失敗時のエラーコード: `PIN_REQUIRED` (401) / `INVALID_PIN` (401) / `LOCKED_OUT` (423) / `CONFIRM_PHRASE_REQUIRED` (401)
- **`return_url`**: `${origin}/admin/subscription`
- **リクエストボディ `intent`（#4166 / #4270）**: `plan-change` | `plan-upgrade` | `billing-history`。
  portal の着地を決める。**allowlist で検証**し、外れた値・未指定は安全側（`plan-change` = portal ホーム）に倒し、
  拒否した事実だけを記録する（**顧客識別子はログに載せない**）。`plan-upgrade` のときだけ `flow_data`
  （`subscription_update`）でプラン変更画面へ直行させる
- **成功レスポンス**: `{ url, flowFallback }`。`flowFallback=true` は **flow を Stripe が受け付けず portal ホームで
  作り直した**ことを表す。画面は自動遷移せず、次の操作を示す通知を出す（`plan-change-flow.md` §3.2.2）
- **Customer Portal で実行可能な操作（Stripe ダッシュボード設定で有効化済）**:
  - プラン変更（standard ↔ family、月額 ↔ 年額）
  - 解約（次回更新日まで利用可能）
  - 支払い方法の追加・変更・削除
  - 請求先情報の変更
  - 請求書（invoice）履歴の閲覧・PDF ダウンロード

##### 月額 ↔ 年額切替と proration ポリシー (#786)

- **切替動線**: `/admin/subscription` → 「プラン管理ポータル」ボタン → Stripe Customer Portal → プラン変更 → 月額/年額の Price ID を選択
- **Stripe 設定**: `proration_behavior = 'create_prorations'`（Stripe デフォルト）
  - **アップグレード（月額 → 年額、standard → family）**:
    - 即時切替。残り期間の月額分を日割り返金 → 新プラン分を日割り課金 → 差額を次回請求にマージ
    - billing cycle anchor は新プランの開始日にリセット
  - **ダウングレード（年額 → 月額、family → standard）**:
    - 即時切替。残り期間の年額分は **返金しない**（LP `/pricing` FAQ §「年額プランを途中解約した場合は？」の運用に整合）
    - 次回請求日に新プラン料金で課金開始
- **解約 (`customer.subscription.deleted`)**: 期末まで現プランを継続し、期末で `status='suspended'` に遷移（テナント本体は残す）。詳細は `plan-change-flow.md` §3.4
- **顧客向け案内**: `site/pricing.html` の FAQ「プランの変更はできますか？」「年額プランを途中解約した場合は？」が SSOT。文言変更時は同 FAQ も同期更新

#### POST /api/stripe/webhook

Stripe からの Webhook イベントを受信する。Stripe 署名ヘッダ（`stripe-signature`）で検証。

**処理する event 種別と因果関係**: 現行 SSOT は `docs/design/billing-redesign/`。entitlement は Stripe Subscription (`tenant.stripeSubscriptionId` + `tenant.status`) を正とし license key を経由しない。`docs/design/license-subscription-causality.md` は deprecated (Epic #2525 で License Key 側全廃、歴史記録)。

**受信口はこの 1 本のみ**: Stripe Dashboard の destination はこの URL を指す。**署名検証だけして 200 を返す route を増やしてはならない** — Stripe は 200 を受けると再送しないため、event が台帳にも残らず消える。受信口が 1 本であること・すべての受信口が `handleWebhookEvent` に dispatch することは `tests/unit/architecture/stripe-webhook-single-entrypoint.test.ts` が CI で固定する。

**Idempotency**: Stripe webhook は at-least-once 配信のため、`stripe_webhook_events` テーブルで event ID ベースの重複排除を行う（§6 参照）。dedup は **insert-first**（先に `handler_result='processing'` の行で処理権を取り、handler 完了後に結果を確定する）。処理権を取れなかった側は handler を呼ばず 200 を返す。handler が失敗した場合は行を削除して 500 を返し、Stripe の再送に載せる（台帳は「**完了した** event」の記録である）。処理中に Lambda が落ちて `processing` が残った場合は 15 分後に次の到達が引き取る。

**乖離の検知**: Stripe 側で配信成功（`pending_webhooks=0`）なのに台帳に記録が無い event は、`/api/cron/stripe-webhook-delivery-check` が Discord に通知する（kind `stripe-webhook-ledger-gap`）。「受け取って 200 を返したのに処理していない」ことの唯一の外形的証拠。

### 3.13 活動ピン留め

#### POST /api/v1/children/[id]/activities/[activityId]/pin

活動をピン留めする（ホーム画面の先頭に表示）。

#### DELETE /api/v1/children/[id]/activities/[activityId]/pin

活動のピン留めを解除する。

### 3.14 活動サジェスト

#### POST /api/v1/activities/suggest

テキスト入力から活動名・カテゴリを AI で推定する。

**AIモデル:** AWS Bedrock Claude Haiku (US inference profile `us.anthropic.claude-haiku-4-5-20251001-v1:0`) — tool_use（構造化出力）で確実にJSONスキーマ準拠のレスポンスを返す。Bedrock 未利用時はキーワードベースのフォールバック。

**リクエストボディ:**
```json
{
  "text": "プールで泳いだ"
}
```

**レスポンス:**
```json
{
  "name": "プールでおよいだ",
  "categoryId": 1,
  "icon": "🏊"
}
```

### 3.15 ヘルスチェック

#### GET /api/health

liveness probe。**DATA_SOURCE に応じた実 backend への実接続検証**を行う (#3620 AC-C5 / EPIC #3424。probe 実体は `src/lib/server/db/probe.ts` facade、route↔DB 境界 #3184):

| DATA_SOURCE | probe | schema 検証 |
|---|---|---|
| `sqlite` (既定) | `probeSqlite` — rawSqlite `SELECT 1` | lazy migration の validation 結果 (`schemaValid` / `migrationsApplied` / `schemaWarnings`) |
| `dynamodb` | `probeDynamoDB` — DescribeTable ACTIVE | なし (`schema` は空 object) |
| `dsql` / `pglite` | `probePg` — 実 backend へ `SELECT 1` + `children` 表 count | children count 成功 = migration 適用済み schema 実在 (`schemaValid: true`) |

backend が不健全 (接続不可 / schema 不在) の場合は **503** + `{"status":"error", "error":..., "dataSource":...}` を返す (空 backend の偽陽性 200 を返さない)。

**レスポンス (200):**
```json
{
  "status": "ok",
  "timestamp": "2026-02-19T18:30:00Z",
  "version": "1.0.0",
  "dataSource": "pglite",
  "region": "local",
  "uptime": 123,
  "schema": { "schemaValid": true, "migrationsApplied": 0, "schemaWarnings": 0 }
}
```

**`backup` フィールド（`DATA_SOURCE=pglite` のときだけ付与、#3977）:**

```json
{
  "backup": {
    "lastSuccessAt": "2026-07-27T18:00:00.000Z",
    "lastSuccessFilename": "pglite-20260727-180000.tgz",
    "lastSuccessBytes": 1234567,
    "lastSuccessDurationMs": 4210,
    "lastFailureAt": null,
    "lastFailureMessage": null
  }
}
```

| 項目 | 仕様 |
|---|---|
| 付与条件 | `DATA_SOURCE === 'pglite'`（= NUC セルフホスト）のときのみ。**クラウド（`dsql`）の公開 Lambda のレスポンスは本フィールドを持たない** |
| なぜ pglite 限定か | 「いつからバックアップが止まっているか」は外部に教えうる運用情報で、`/api/health` は未認証公開のため。露出範囲の拡大は PO 決裁事項とし、NUC 内でしか成立しない分岐に閉じる |
| なぜ載せるか | `scripts/backup-nuc.cjs` が backend 同定のため既に `/api/health` を参照する（#3967）。バックアップの生死も同じ口から読めれば運用側の参照点が 1 つで済む。`getPgliteBackupStatus` は #3950 で export されたが caller 不在の dead export で、本配線がその caller |
| 取得失敗時 | **フィールドを省略するだけで 503 にしない**。状態ファイルが読めないことは DB の生死と無関係で、ここで落とすと「状態ファイルが無いだけで liveness が赤」になり監視の意味が変わる |

回帰は `tests/unit/routes/health-backup-status.test.ts`（付与条件と失敗時の省略）が固定する。

**`backupHealth` フィールド（`backup` と同条件で付与、#4087）:**

```json
{
  "backupHealth": {
    "level": "critical",
    "reason": "never-succeeded",
    "hoursSinceLastSuccess": null,
    "consecutiveFailures": 18,
    "lastFailureMessage": "CRON_SECRET が未設定です (/api/cron/pglite-backup の認証に必要)",
    "notificationMissing": true,
    "rotationPendingCount": 0
  }
}
```

`backup` が生の状態値であるのに対し、本フィールドは **「いま人間が行動すべきか」の判定結果**を載せる。判定は `src/lib/domain/backup-health.ts`（純粋関数）に集約し、**push（Discord alert）と pull（本 endpoint / admin 画面）が同じ結論を見る**。

| 項目 | 仕様 |
|---|---|
| 付与条件 | `backup` と同じ（`DATA_SOURCE === 'pglite'` かつ状態ファイルが読めたとき）。読めなければ `backup` ごと省略する |
| `level` | `ok` / `warn` / `critical`。UI の色分けと通知の強さを 1 箇所で決める |
| `reason` | `never-succeeded` / `stale-critical` / `stale-warn` / `consecutive-failures-critical` / `last-run-failed` / `rotation-blocked` / `rotation-blocked-critical` / `no-notification-channel` / `healthy`。**level だけでは人間が行動できない**ため、根拠を持たせる |
| `rotation-blocked` の昇格 | guard は**自己解除しない**（溢れは毎晩 1 世代ずつ増える）。放置すればディスクを食い潰して取得自体が失敗するため、`BACKUP_ROTATION_BLOCKED_CRITICAL_HOURS = 168`（7 晩）で `rotation-blocked-critical` へ昇格させる。**永久 warn は「消えない warn」として無視される** |
| `rotationPendingCount` | ローテーション guard（#4129 AC2）が止めている世代数。0 なら止まっていない。**取得の成否とは独立した事実**（#4162） |
| `notificationMissing` | 失敗通知の宛先（`DISCORD_ALERT_WEBHOOK_URL` / `DISCORD_WEBHOOK_INCIDENT`）が 1 つも無い状態。**`level` と独立に立つ** — critical のときも「届かない」ことは対処が変わるため独立に伝える |
| 判定順 | **深刻な方から**。stale（動いていない）を failure（落ちている）より先に見る。**job が起動しなかった場合、job 内から投げる push 通知は原理的に発火しない**ため、鮮度でしか捕まえられない |
| しきい値 | `BACKUP_STALE_WARN_HOURS = 26` / `BACKUP_STALE_CRITICAL_HOURS = 50` / `BACKUP_CONSECUTIVE_FAILURE_CRITICAL = 2`。日次 03:00 実行前提で「1 回飛んだ」「2 回連続で飛んだ」に対応。1 回で critical にすると再起動のたびに狼少年になる（ADR-0012 整合） |

**ローテーション保留は失敗として扱わない（#4162）**: `PgliteBackupRotationGuardError`（**取得自体は成功**しローテーションだけ止めた場合）は、throw の前に「取得は成功」を状態ファイルへ確定させ、`consecutiveFailures` を積まない。止まっている事実は `rotationPendingCount` / `rotationBlockedSince` に**独立した事実として**残す。

これを 1 つの状態に潰していた旧実装では、判定が `stale-critical`（= 「job が動いていない」）へ倒れ、**診断が真逆**になっていた。実際は毎晩正常に取れており、必要な行動は「古い世代を退避して手で削除する」である。判定を潰すと運用者が job の再起動へ向かい、**guard の意図（不可逆削除を止める）だけが失われる**。

判定順は `rotation-blocked` を stale / 連続失敗より**後**に置く。「取れていない」方が常に重く、「取れているが片付いていない」はその次だからである。guard は自己解除しない（溢れは毎晩 1 ずつ増える）ため、この warn は放置で消える類ではなく**行動を促すもの**として扱う。

回帰は `tests/unit/domain/backup-health.test.ts`（判定）/ `tests/unit/routes/health-backup-status.test.ts`（付与条件）/ `tests/unit/db/pglite-backup-3950.test.ts` `[BK12]` `[BK17]` `[BK18]`（実 status → verdict の経路と保留の解除）が固定する。

**`scheduler` フィールド（#4721、`backup` と同じ付与条件）:**

```json
{
  "scheduler": {
    "level": "critical",
    "summary": "定期ジョブが 1 つも実行されていません。scheduler コンテナが起動していない可能性があります (docker compose --profile scheduler up -d)",
    "staleJobs": ["retention-cleanup", "export-build"],
    "neverRanJobs": ["retention-cleanup", "export-build"],
    "lastRunAt": { "notification-delivery": "2026-08-20T09:50:00.000Z" }
  }
}
```

NUC の scheduler は `docker-compose.yml` の `profiles: [scheduler]` gate 配下にあり、`--profile scheduler` を付けない deploy では起動も更新もされない。**その状態は画面にも log にも出ない**（走っていないジョブは log を書かない）ため、cron endpoint が実際に呼ばれた時刻を記録して鮮度で判定する。

| 項目 | 仕様 |
|---|---|
| 付与条件 | `backup` と同じく `DATA_SOURCE === 'pglite'`（= NUC）のときのみ。AWS 側は EventBridge / cron-dispatcher の CloudWatch metric と `ganbari-quest-cron-dispatcher-errors` alarm が同じ役割を果たす |
| 記録の主体 | **cron endpoint を受けたアプリ側**（`src/hooks.server.ts` が `/api/cron/<name>` の 2xx 応答時に記録）。scheduler コンテナ自身に書かせると volume 共有が要るうえ「scheduler は生きているが app に届いていない」を検出できない |
| 記録先 | `data/cron-status.json`（pglite backup の状態ファイルと同じ考え方）。DB に書くと「DB が死んでいるときに cron の生死も見えない」になる |
| 想定間隔 | `schedule-registry.ts` の cron 式から導出（`expectedIntervalMinutes`）。**ジョブを足せば判定対象も自動で増える**（一覧を二重管理すると増えたジョブが黙って観測対象から漏れる） |
| 遅延判定 | 想定間隔の 3 倍を超えたら `staleJobs`。日次なら 3 日、15 分なら 45 分 |
| `level` | `ok` / `warning`（一部遅延）/ `critical`（全ジョブ遅延、または全ジョブ未実行） |
| 起動直後 | プロセス起動からの経過が猶予内なら未実行を正常扱い（deploy のたびに赤くなると本物の停止に気付けなくなる） |
| 取得失敗時 | **フィールドを省略するだけで 503 にしない**（`backup` と同方針） |

回帰は `tests/unit/domain/scheduler-health.test.ts`（判定）/ `tests/unit/cron/job-wiring-symmetry.test.ts` `[2]`（記録の配線と deploy profile）が固定する。

#### GET /api/ready

readiness probe（shallow、#3657）。**プロセスが HTTP を受けられることのみを証明し、DB には一切接触しない**。LWA（Lambda Web Adapter）の `AWS_LWA_READINESS_CHECK_PATH` が参照する（`Dockerfile.lambda`）。readiness を `/api/health`（deep DB probe）に結合すると DB 障害時に LWA が never-ready → 全リクエスト 502 + cold start init timeout ループになるため分離する（13-AWSサーバレスアーキテクチャ設計書 §3.3）。

- 常に **200** を返す（DB 状態に依存しない。メンテナンスモード中も 503 化しない）
- 監視・deploy smoke には使わない（deep 検証は `/api/health` が担う）

**レスポンス (200):**
```json
{ "status": "ok", "version": "1.0.0", "uptime": 123 }
```

---

### 3.16 運営管理ダッシュボード（#0176 / #820 / ADR-0033）

> `/ops` 配下は **Cognito User Pool の `ops` group メンバーのみがアクセス可能**（#820。MFA 追加要求は #4266 で導入し #4363 のオーナー決裁で撤去。判定と再評価トリガーは `docs/design/14-セキュリティ設計書.md` §5.2.9）。
> 非メンバーは 403 Forbidden。判定は `src/lib/server/auth/ops-authz.ts` の `requireOpsAccess(locals)` に集約する。
>
> **API endpoint（`+server.ts`）は自分で `requireOpsAccess(locals)` を呼ぶこと（#4309）**。`+layout.server.ts` の gate は
> page の load にしか適用されず `+server.ts` には走らないため、呼ばない endpoint は**認可ゼロで外部公開される**
> （実害: `GET /ops/export?type=sales` が未認証で 200 + 売上台帳 CSV を返していた）。適用範囲は
> `tests/unit/architecture/ops-route-auth-fitness.test.ts` が FS 列挙で機械強制する。詳細は 14-セキュリティ設計書 §5.2.9。
>
> 旧 `OPS_SECRET_KEY` Bearer token / `ops_token` Cookie / URL token 認証はすべて廃止済み。
> なお `/api/cron/retention-cleanup` / `/api/cron/license-expire` は EventBridge から呼ばれる別経路のため、独自の shared secret
> （`CRON_SECRET`、移行期は `OPS_SECRET_KEY` も後方互換で受け入れ）を使用する（ADR-0033）。

#### POST /api/cron/license-expire （期限切れライセンスキー自動失効バッチ #821）— deprecated (Epic #2525 で削除)

> **deprecated (Epic #2525 license key 全廃)**: 本 cron endpoint は物理削除された (PR-L3 PR #2822、EventBridge Scheduled Rule は PR-L5 PR #2879 で CDK から撤去)。期限管理は `customer.subscription.deleted` webhook が代替する。本節以降の license-expire 仕様は歴史記録。

**認証:** `Authorization: Bearer <CRON_SECRET>` （移行期は `OPS_SECRET_KEY` も許可）

**呼び出し元:** EventBridge Scheduled Rule（日次 JST 00:00）または運用手動

**処理:**

1. `auth.listActiveExpiredKeys(now)` で `status='active'` かつ `expiresAt <= now` のキーを全列挙
2. 各キーに `revokeLicenseKey({reason:'expired', revokedBy:'system'})` を順次実行
3. 失敗は `failures` に記録、1 件失敗しても他は続行
4. `license_events` に `revoked` イベントが記録される（#804）

**リクエストボディ (任意):**

```json
{ "dryRun": true }
```

`dryRun=true` のときは対象件数のみ返し、revoke は実行しない（ヘルスチェック用）。

**レスポンス (200):**

```json
{
  "ok": true,
  "scanned": 12,
  "revoked": 12,
  "failures": [],
  "dryRun": false
}
```

- `scanned`: 対象として抽出された active + expired なキー総数
- `revoked`: 実際に revoke 成功した件数
- `failures`: `{licenseKey, reason}` の配列。DynamoDB throttle 等で失敗したキー
- `dryRun`: リクエスト通りのフラグ

**エラー:**

- `401 Unauthorized`: Bearer token 不一致
- `404 Not Found`: `CRON_SECRET` / `OPS_SECRET_KEY` どちらも未設定（エンドポイント無効化）
- `500 Internal Error`: `listActiveExpiredKeys` 自体が throw（DynamoDB 障害等）。部分失敗は 200 に含める

**GET /api/cron/license-expire** はヘルスチェック用の dry-run 固定版（副作用なし）。

#### GET /ops （KPI サマリーページ）

**認証:** Cognito User Pool `ops` group メンバーであること（通常の Cognito ログインセッション）

**レスポンス:** HTML ページ（SSR）。テナント統計・プラン別内訳・MRR概算を表示。

**データ:**
- 総テナント数（active / grace_period / suspended / terminated）
- 今月の新規テナント数
- プラン別内訳（monthly / yearly / lifetime / noPlan）
- MRR 概算
- Stripe 連携状態

#### `/ops/license/*` 系統 (一覧 / 詳細 / 失効 / キャンペーン発行 / legacy-count) — deprecated (Epic #2525 で削除)

> **deprecated (Epic #2525 license key 全廃)**: 以下の `/ops/license` / `/ops/license/[key]` / `/ops/license/issue` / `/ops/license/legacy-count` 系統はすべて物理削除された (PR-L3 PR #2822)。割引・campaign 配布は Stripe Coupon / Promotion Code (Stripe Dashboard) で代替する。リンク先 `license-hmac-migration-plan.md` も deprecated (HMAC 移行は機構全廃により不要、歴史記録)。本節以降の `/ops/license/*` 仕様は歴史記録として残す。

#### GET /ops/license （ライセンスキー管理 - 一覧 / 検索 #805） — deprecated (Epic #2525 で削除)

**認証:** Cognito User Pool `ops` group メンバーであること

**機能:**
- 最近のライセンスイベント一覧 (`license_events` 最新 50 件) の表示
- 特定キーへの検索フォーム（POST → `/ops/license/[key]` へリダイレクト）

**URL パラメータ:**
- `limit` (query, number): イベント取得件数。デフォルト 50、最大 200

#### GET /ops/license/[key] （ライセンスキー詳細 #805） — deprecated (Epic #2525 で削除)

**認証:** Cognito User Pool `ops` group メンバーであること

**パラメータ:**
- `key` (path): ライセンスキー（URL エンコード。内部で upper-case に正規化）

**機能:**
- `LicenseRecord` の全フィールド表示（tenantId / plan / kind / createdAt / expiresAt / consumedBy / revokedAt 等）
- 当該キーの `license_events` 履歴（最新 200 件）
- `status='active'` のときのみ「失効」ボタンを表示

#### POST /ops/license/[key]?/revoke （ライセンスキー失効 form action #805） — deprecated (Epic #2525 で削除)

**認証:** Cognito User Pool `ops` group メンバーであること

**入力 (form-data):**
| フィールド | 型 | 必須 | 説明 |
|-----------|----|------|------|
| reason | `'ops-manual' \| 'leaked' \| 'refund' \| 'expired'` | ✓ | 失効理由 |
| note | string | - | CS チケット番号・状況メモ |

**レスポンス:**
| status | 意味 | ケース |
|--------|------|--------|
| 200 (form success) | `{ revoked: true, reason, revokedAt }` | 成功 |
| 400 (form failure) | `{ error: '失効理由が不正です' }` | reason が enum 外 |
| 403 | `Forbidden` | identity が ops group 未所属（layout で既に弾かれる想定） |
| 409 (form failure) | `{ error: string }` | `findLicenseKey` で記録が見つからない / 既に revoked / consumed |

**副作用:**
- `license-key-service.revokeLicenseKey` が `status='revoked'` + `revokedAt` + `revokedReason` + `revokedBy='ops:<userId>'` を更新
- `license_events` に `eventType='revoked'` を記録 (#804)
- `ops_audit_log` に `action='license.revoke'` / `target=<key>` / `metadata={reason, note}` を記録 (#820)

#### GET /ops/license/issue （キャンペーンキー一括発行ページ #802） — deprecated (Epic #2525 で削除)

**認証:** Cognito User Pool `ops` group メンバーであること

**機能:**
- Stripe を経由しないキャンペーン配布・サポート補償・プレゼント用のライセンスキーを一括発行する入力画面
- 発行結果は同一ページでテキスト表示 + CSV ダウンロード（`campaign-keys-YYYY-MM-DD.csv`）

#### POST /ops/license/issue?/issue （キャンペーンキー一括発行 form action #802） — deprecated (Epic #2525 で削除)

**認証:** Cognito User Pool `ops` group メンバーであること

**入力 (form-data):**
| フィールド | 型 | 必須 | 説明 |
|-----------|----|------|------|
| plan | `LicensePlan` (monthly / yearly / family-monthly / family-yearly / lifetime) | ✓ | 発行するキーのプラン |
| quantity | number (1-500) | ✓ | 発行件数。500 件/req が上限 |
| reason | string (1-200) | ✓ | キャンペーン名・理由。`ops_audit_log.metadata.reason` と `record.tenantId` の自動採番に使われる |
| expiresAt | `'default' \| 'never' \| ISO8601` | - | `default`=90日後、`never`=期限なし、その他は指定日時 |
| tenantId | string | - | `record.tenantId` に入る発行プール識別子。省略時は `campaign:<reason>` を自動採番 |

**レスポンス:**
| status | 意味 | ケース |
|--------|------|--------|
| 200 (form success) | `{ issued: true, plan, reason, tenantId, issuedBy, expiresAt, keys: string[], errors?: string[] }` | 全件または一部成功 |
| 400 (form failure) | `{ error: string }` | plan / quantity / reason / expiresAt の検証失敗 |
| 403 | `Forbidden` | identity が ops group 未所属 |
| 500 (form failure) | `{ error: string }` | 全件発行失敗（DB エラー等） |

**副作用:**
- `license-key-service.issueLicenseKey` を `quantity` 回呼び、`kind='campaign'` / `issuedBy='ops:<userId>'` のキーを生成
- `license_events` に `eventType='issued'` を各キー分記録 (#804)
- `ops_audit_log` に `action='license.issue'` / `target=<tenantId>` / `metadata={plan, quantity, reason, keys, errors?}` を 1 件記録 (#820)

#### GET /ops/license/legacy-count （legacy 形式 license key 残存数 集計 #2484） — deprecated (Epic #2525 で削除)

**認証:** Cognito User Pool `ops` group メンバーであること (`src/routes/ops/+layout.server.ts` の `isOpsMember(locals.identity)` で gate)

**機能:**
- HMAC 未署名 (legacy 形式 `GQ-XXXX-XXXX-XXXX`、17 文字) の license key 残存数を DB から集計
- HMAC 必須化計画 (`docs/operations/license-hmac-migration-plan.md`) Phase 1 — Phase 2 (新規 legacy 発行禁止) / Phase 3 (legacy code 物理削除) への移行判断材料を取得する ops 観測 endpoint

**実装:** `getRepos().auth.countLicenseKeys({ format: 'legacy' })` を呼ぶ。
- DynamoDB backend: `size(licenseKey) = 17` FilterExpression で legacy 形式を抽出
- SQLite backend: 既存 no-op (`return 0`)、migration plan §4 line 90「Phase 1 集計は SaaS DynamoDB only」整合

**レスポンス (200):**
```json
{
  "legacyCount": 42,
  "queriedAt": "2026-05-25T12:34:56.789Z",
  "backend": "dynamodb"
}
```

| フィールド | 型 | 説明 |
|-----------|----|------|
| `legacyCount` | number | legacy 形式 license key の総数 |
| `queriedAt` | ISO8601 | 集計実行時刻 |
| `backend` | `'dynamodb' \| 'sqlite'` | 集計対象 backend (DATA_SOURCE env 駆動) |

**レスポンス (403):** `Forbidden` — identity が ops group 未所属 (`/ops/*` layout gate)

### 3.x バトルアドベンチャー

#### GET /api/v1/battle/[childId]

今日のバトル情報を取得する。未登録の場合は自動生成する。

**パラメータ:**
- `childId` (path, number): 子供ID

**レスポンス (200):**
```json
{
  "battleId": 42,
  "enemy": {
    "id": 3,
    "name": "スライムん",
    "icon": "🟢",
    "stats": { "hp": 40, "atk": 8, "def": 5, "spd": 6, "luk": 3 },
    "dropPoints": 15,
    "consolationPoints": 5
  },
  "playerStats": { "hp": 50, "atk": 12, "def": 8, "spd": 7, "luk": 5 },
  "scaledEnemyMaxHp": 32,
  "completed": false,
  "result": null
}
```

**セキュリティ:**
- childId はサーバ側で tenant 所属を検証
- 並行リクエスト時は UNIQUE 制約で重複生成を防止（catch → 再取得）

#### POST /api/v1/battle/[childId]

バトルを実行する。サーバ側で今日の pending バトルを再取得し、整合性を検証してから実行する。

**パラメータ:**
- `childId` (path, number): 子供ID
- リクエストボディ不要（battleId/enemyId はサーバ側で決定）

**レスポンス (200):**
```json
{
  "battleResult": {
    "outcome": "win",
    "totalTurns": 5,
    "rewardPoints": 15,
    "turns": [
      {
        "turn": 1,
        "firstAttacker": "player",
        "playerAction": { "damage": 10, "critical": false },
        "enemyAction": { "damage": 6, "critical": false },
        "playerHpAfter": 44,
        "enemyHpAfter": 22
      }
    ]
  },
  "rewardPoints": 15,
  "enemy": { "id": 3, "name": "スライムん", "icon": "🟢" }
}
```

**エラー (400):**
- childId が不正: `{ "error": "IDが不正です" }`
- バトル未生成: `{ "error": "今日のバトルが見つかりません" }`
- 二重実行: `{ "error": "今日のバトルは既に完了しています" }`
### 3.17 アカウント管理

#### POST /api/v1/admin/account/delete

テナント（アカウント）の完全削除。全データを不可逆に削除する。

**認証:** owner のみ

**リクエスト:**
```json
{
  "confirmation": "DELETE"
}
```

**処理（#741）:** 以下の順序で実行する。順序は課金継続クレーム防止のため固定。

1. **Stripe Subscription キャンセル**（`stripeSubscriptionId` が存在する場合）
   - `stripe.subscriptions.cancel()` を即時呼び出し
   - 失敗時は例外を投げ、以降の DB 削除を**中断**（DB と Stripe の整合性を優先）
   - `resource_missing`（すでに削除済み）は冪等に成功扱い
2. S3 / ストレージのテナントプレフィックス以下を全削除
3. テナントスコープの DB データ削除（子供・活動・ログ等 20+ リポジトリ）
4. メンバー全員の Cognito + DB ユーザー削除
5. 招待リンクの物理削除
6. テナントレコード削除

移譲パターン（Pattern 2a: `transferOwnershipAndLeave`）では **Stripe キャンセルを実行しない**。
新オーナーが subscription を継承するため。

詳細: ADR-0022「課金サイクルとデータライフサイクルの整合性」

**レスポンス:** `200 { success: true }`

**エラー:** `500 { error: "Stripe cancellation failed" }` — Stripe 呼び出し失敗時（DB は未変更）

#### GET /api/v1/admin/account/deletion-info

削除前の影響範囲確認用。削除対象データの概要を返す。

**認証:** owner のみ

**レスポンス:**
```json
{
  "childrenCount": 2,
  "activitiesCount": 15,
  "activityLogsCount": 342,
  "membersCount": 1,
  "hasActiveSubscription": true
}
```

### 3.18 閲覧専用トークン

#### GET /api/v1/admin/viewer-tokens

テナントの閲覧専用トークン一覧を取得。

**認証:** owner/parent

**レスポンス:**
```json
{
  "tokens": [
    {
      "id": 1,
      "token": "abc123...",
      "label": "おばあちゃん用",
      "expiresAt": null,
      "createdAt": "2026-04-01T00:00:00Z",
      "revokedAt": null
    }
  ]
}
```

#### POST /api/v1/admin/viewer-tokens

閲覧専用トークンを新規作成。`/view/[token]` で子供の成長記録を閲覧可能にする。

**認証:** owner/parent

**リクエスト:**
```json
{
  "label": "おばあちゃん用",
  "expiresAt": "2026-12-31"
}
```

**レスポンス:** `201 { token: "abc123...", url: "/view/abc123..." }`

#### DELETE /api/v1/admin/viewer-tokens/[id]

閲覧専用トークンを無効化（revoke）。

**認証:** owner/parent

**レスポンス:** `200 { success: true }`

### 3.19 おうえんメッセージ

#### GET /api/v1/messages/[childId]

メッセージ履歴を取得。`?mode=unshown` で未表示のみフィルタ可能。

**認証:** 全ロール

**クエリパラメータ:** `mode` (optional): `'unshown'` — 未表示メッセージのみ

**レスポンス:**
```json
{
  "messages": [
    {
      "id": 1,
      "messageType": "stamp",
      "stampCode": "heart",
      "body": null,
      "icon": "💌",
      "sentAt": "2026-04-09T10:00:00Z",
      "shownAt": null
    }
  ]
}
```

#### POST /api/v1/messages/[childId]

親から子供へメッセージ送信。

**認証:** owner/parent

**リクエスト:**
```json
{
  "messageType": "stamp",
  "stampCode": "heart",
  "icon": "💌"
}
```
または
```json
{
  "messageType": "text",
  "body": "今日もがんばったね！",
  "icon": "💌"
}
```

#### POST /api/v1/messages/[messageId]/shown

メッセージを表示済みにマーク。子供画面でオーバーレイ表示後に呼ばれる。

**認証:** 全ロール

**childId 解決 (#2845):** `selectedChildId` cookie 必須。`(childId, messageId)` の複合キーで
repo 層が所有権を検証し、不一致は 404。cookie 不在は 400。

**レスポンス:** `200 { success: true }`

### 3.21 設定

#### GET /api/v1/settings/decay

ポイント減少強度設定を取得。

**認証:** owner/parent

**レスポンス:**
```json
{
  "decayEnabled": true,
  "decayRate": 0.05,
  "decayInterval": "weekly"
}
```

#### PUT /api/v1/settings/decay

ポイント減少強度設定を更新。

**認証:** owner/parent

#### POST /api/v1/settings/tutorial

チュートリアル完了をマーク（子供画面チュートリアルの最終ステップで送信）。

**認証:** owner/parent

**リクエスト:**
```json
{
  "action": "complete"
}
```

`action` は `complete` のみ受理する（それ以外は 400）。親の章立てチュートリアル撤去に伴い、開始マーク・バナー dismiss の action は受理しない。

#### GET /api/v1/settings/vapid-key

Web Push 通知用の VAPID 公開鍵を取得。

**認証:** 不要

**レスポンス:**
```json
{
  "publicKey": "BLa7..."
}
```

### 3.22 Push 通知

#### POST /api/v1/notifications/subscribe

Push 通知の購読登録。ブラウザの PushSubscription オブジェクトをサーバーに保存。

**認証:** owner/parent

**リクエスト:**
```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/...",
  "keys": {
    "p256dh": "...",
    "auth": "..."
  }
}
```

#### POST /api/v1/notifications/unsubscribe

Push 通知の購読解除。

**認証:** owner/parent

**リクエスト:**
```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/..."
}
```

### 3.23 評価

#### GET /api/v1/evaluations/[childId]

子供の評価履歴を取得。`?period=weekly|monthly` で期間フィルタ。

**認証:** 全ロール

**レスポンス:**
```json
{
  "evaluations": [
    {
      "id": 1,
      "childId": 1,
      "evaluatedAt": "2026-04-09",
      "scores": { "undou": 72, "benkyou": 58, "otetsudai": 85 }
    }
  ]
}
```

### 3.24 ポイント履歴

#### GET /api/v1/points/[childId]/history

ポイントの入出金履歴を取得。

**認証:** 全ロール

**クエリパラメータ:** `limit` (optional, default: 50), `offset` (optional, default: 0)

**レスポンス:**
```json
{
  "history": [
    {
      "id": 1,
      "amount": 5,
      "type": "earn",
      "source": "activity_log",
      "description": "たいそうした",
      "createdAt": "2026-04-09T10:00:00Z"
    }
  ],
  "total": 150
}
```

### 3.25 アナリティクス

#### POST /api/v1/analytics

クライアント側イベントを記録（ページビュー、ボタンクリック等）。

**認証:** 不要（tenantId は自動付与）

**リクエスト:**
```json
{
  "event": "page_view",
  "properties": { "path": "/admin" }
}
```

#### GET /api/v1/analytics/status

アナリティクスプロバイダーの設定状態を取得。

**認証:** 全ロール

**レスポンス:**
```json
{
  "providers": ["dynamo"],
  "dynamoEnabled": true
}
```

> #1591 (ADR-0023 I2): umami / Sentry プロバイダは削除済み。AWS 内完結 (DynamoDB) のみ。
> 詳細は `docs/design/13-AWSサーバレスアーキテクチャ設計書.md §7.2` を参照。

---

### 3.26 ごほうびショップ 交換申請 API (#1337)

> 設計詳細: `docs/design/06-UI設計書.md §15`  
> DB テーブル: `reward_redemption_requests` — `docs/design/08-データベース設計書.md §3`

#### POST /api/v1/reward-redemption-requests

子供が交換申請を作成する。

**認証:** 全ロール（child ロール含む）  
**プラン制限:** なし（全プランで利用可能）

**リクエストボディ:**
```json
{
  "rewardId": 42,
  "childId": 7,
  "quantity": 4
}
```

`quantity` は 1 申請が表す個数（#4407、省略時 1）。単位量のごほうび（「ゲーム時間 +30分」等）を「単価 × 個数」で消費するための値で、値域は domain 層 SSOT `REDEMPTION_QUANTITY_MIN`(1) / `REDEMPTION_QUANTITY_MAX`(99)（ADR-0066）。在庫・購入上限ではない（実効的な購入可能量は残高が決める）。

**処理:**
1. `reward_id` の `special_rewards` が `child_id` に紐付くか検証
2. `quantity` が値域内の整数か検証（範囲外 / 小数 / NaN は `400 INVALID_QUANTITY`）
3. 残高 >= `単価 × 個数` を確認（不足時は `400 INSUFFICIENT_POINTS`）
4. 同一 `(child_id, reward_id)` の pending 既存 / 直近 approved 窓に当たらないか確認（当たれば pending 実在時 `409 ALREADY_PENDING` / 直近 approved 由来なら `409 RECENTLY_EXCHANGED`。#4407: 即時交換 ON の家庭では pending が存在しないため「既に申請中」は事実と異なる）
5. `reward_redemption_requests` レコードを作成（repo は常に `status: 'pending_parent_approval'`, `requested_at: now()` で作成）
6. **即時交換分岐（#3339）**: 家庭設定 settings KVS `reward_auto_approve === 'true'` のとき（後述）、その場で承認確定（`approved` + ポイント減算）まで進め `instant: true` を返す。OFF（既定）なら申請は pending のまま据え置き、ポイントは減算しない

**レスポンス (201):**
```json
{
  "id": 101,
  "rewardId": 42,
  "childId": 7,
  "quantity": 4,
  "status": "pending_parent_approval",
  "requestedAt": 1714000000
}
```

**エラー:**
| コード | HTTP | 説明 |
|--------|------|------|
| `INSUFFICIENT_POINTS` | 400 | ポイント不足（判定は `単価 × 個数`） |
| `ALREADY_PENDING` | 409 | 同一報酬の申請が既に pending |
| `RECENTLY_EXCHANGED` | 409 | 直近 10 秒以内に同一報酬を交換済（連打 / 再送 dedup 窓、#3356 / #4407） |
| `INVALID_QUANTITY` | 400 | 個数が値域外（0 / 負 / 小数 / 上限超過、#4407） |
| `REWARD_NOT_FOUND` | 404 | 報酬が存在しない / 子供に属さない |

#### 即時交換モード（settings KVS `reward_auto_approve`、#3339 / #3347）

家庭一括設定で「ごほうび交換のしかた」を切り替える。UI は `/admin/settings/rules` のトグル（`06-UI設計書.md §15.4.4`）、子供側挙動は `§15.3.6`。

| 項目 | 仕様 |
|---|---|
| 設定キー | settings KVS `reward_auto_approve`（`sibling_ranking_enabled` と同じ bool 規約 = `'true'` のみ真。**DB スキーマ変更なし**）。取得 `getSetting` / 保存 `setSetting`、保存 action は `POST /admin/settings/rules ?/setRewardAutoApprove` |
| 既定 | OFF（未設定 = 保護者承認必須）。POST 申請は `pending_parent_approval` のまま、ポイント未減算 |
| ON | POST 申請を**即時 `approved` 確定 + その場でポイント減算**（親承認スキップ、`resolved_by_parent_id = null` = システム自動承認）。レスポンスに `instant: true` を付与 |
| 減算の原子性（#3347 TOCTOU 二重減算根治） | 減算は `point` repo の `spendPointsAtomic` で実行する。`getBalance`（残高読込）→ 非負確認 → `insertPointEntry`（台帳挿入）を service 層で await を跨いで行うと並行 / 二重 submit で二重減算・残高マイナスが起き得る（#3336 同型）ため、backend ごとの原子境界（**SQLite=同期トランザクション / DynamoDB=条件付き `TransactWrite`（`balance >= cost` 成立時のみ `ADD balance -cost` + 台帳 Put）/ demo=同期チェック**）で「再読込 → 非負確認 → 挿入」を 1 単位に閉じ込める。残高不足側は `INSUFFICIENT_POINTS` を返し、即時モードで作成済の幻の pending 行は `expired` に回収する |

---

#### GET /api/v1/reward-redemption-requests

親が申請一覧を取得する。

**認証:** owner / parent  
**クエリパラメータ:**

| パラメータ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `childId` | number | 任意 | 特定の子供に絞り込み |
| `status` | string | 任意 | `pending_parent_approval` / `approved` / `rejected` / `expired` |
| `limit` | number | 任意 | 最大件数（デフォルト 50） |

**レスポンス (200):**
```json
{
  "requests": [
    {
      "id": 101,
      "childId": 7,
      "childName": "はなこ",
      "rewardId": 42,
      "rewardTitle": "ゲーム30分",
      "rewardIcon": "🎮",
      "rewardPoints": 200,
      "status": "pending_parent_approval",
      "requestedAt": 1714000000,
      "resolvedAt": null,
      "parentNote": null
    }
  ]
}
```

---

#### PATCH /api/v1/reward-redemption-requests/:id

親が申請を承認または却下する。

**認証:** owner / parent

**リクエストボディ（承認）:**
```json
{
  "action": "approve"
}
```

**リクエストボディ（却下）:**
```json
{
  "action": "reject",
  "parentNote": "もう少しがんばってみよう"
}
```

**処理（承認時）:**
1. `status = 'pending_parent_approval'` であることを確認（他は `400 INVALID_STATUS`）
2. `child.points >= special_rewards.requiredPoints` を再確認（ポイント残高レースコンディション対策）
3. `point_ledger` に `type: 'reward_redemption'`、`amount: -requiredPoints` を記録
4. `status → approved`、`resolved_at = now()`、`resolved_by_parent_id = 操作者 ID` に更新
5. `shown_to_child_at = NULL`（次回子供アクセス時に通知表示させる）

**処理（却下時）:**
1. `status = 'pending_parent_approval'` であることを確認
2. `status → rejected`、`parent_note`、`resolved_at = now()` に更新
3. ポイント減算なし

**レスポンス (200):**
```json
{
  "id": 101,
  "status": "approved",
  "resolvedAt": 1714001234
}
```

**エラー:**
| コード | HTTP | 説明 |
|--------|------|------|
| `INVALID_STATUS` | 400 | 既に解決済み（approved / rejected / expired）の申請 |
| `INSUFFICIENT_POINTS` | 400 | 承認時のポイント残高不足（承認後に保護者がポイントを消費した場合等） |
| `REQUEST_NOT_FOUND` | 404 | 申請が存在しない / テナント外 |

---

#### POST /api/cron/expire-redemptions

30 日以上 `pending_parent_approval` の申請を `expired` に一括更新する日次 cron。

**認証:** `verifyCronAuth`（`07-API設計書.md §5` の cron 認証パターン）

**処理:**
1. `status = 'pending_parent_approval'` かつ `requested_at < NOW() - 2592000`（30 日）のレコードを取得
2. `status → expired` に一括更新
3. 更新件数をログ出力

**レスポンス (200):**
```json
{
  "expiredCount": 3
}
```

> ポイントは元々減算されていないため、期限切れ時の補償処理は不要。  
> 子供への `expired` 通知はしない（静かな失効）。

---

### 3.27 PMF 判定アンケート API (#1598 ADR-0023 §5 I7)

#### 1. 設計背景

ADR-0023 §3.6 が定める PMF 達成度の客観的判定（Sean Ellis 40%）を実装するため、年 2 回（半期ごと）親宛にアンケートメールを送信し、回答 / 集計を提供する API 群。

#### 2. 設計原則

- HMAC トークンベース回答（認証なしでも回答可。鍵は `OPS_SECRET_KEY` を unsubscribe-token と共有、ADR-0010 鍵配布経路を増やさない）
- 接触頻度上限は lifecycle-emails (#1601) と共有 (年 6 回上限カウンタ)
- 半期 round 内重複防止（PO 承認 2026-04-29、Issue #1598 AC4 更新済 — 60 日カウンタは半期 round (180 日 cycle) 重複防止で代替、実質的により厳しい制約。実装は半期 round 内重複ガードのみで 60 日カウンタロジックは持たない）

#### 3. エンドポイント一覧

| メソッド | パス | 認証 | 用途 |
|---------|------|------|------|
| POST | `/api/cron/pmf-survey` | `verifyCronAuth` | 年 2 回 (6/1, 12/1 09:00 JST) 全テナント走査して owner email へ配信 |
| GET | `/survey/sean-ellis/[token]` | HMAC トークン | 回答 UI レンダリング (SvelteKit `+page.server.ts` load) |
| POST | `/survey/sean-ellis/[token]?/submit` | HMAC トークン | 回答送信 form action |
| ops | `/ops/pmf-survey?round=<r>&q=<keyword>` | Cognito ops group | 集計表示 + 自由記述検索 (AC12) |

#### POST /api/cron/pmf-survey

EventBridge cron `cron(0 0 1 6,12 ? *)` (UTC) = 6/1 + 12/1 09:00 JST から起動される。

**認証:** `verifyCronAuth`（`07-API設計書.md §5` cron 認証パターン）

**リクエストボディ (任意):**
```json
{
  "dryRun": false,
  "round": "2026-H1"
}
```

| フィールド | 型 | 既定 | 説明 |
|-----------|----|------|------|
| `dryRun` | boolean | `false` | true なら実送信せず件数のみ返却 |
| `round` | string | `getCurrentRound(now)` | YYYY-H1 / YYYY-H2 形式。テスト用上書き |

**処理フロー:**
1. 全テナント走査（`auth.listAllTenants()`）
2. テナントごとに分岐:
   - 契約 14 日未満 → `skippedTenure++`
   - 同一 round 既送信 (`pmf_survey_sent_<round>` settings KV) → `skippedAlreadySent++`
   - owner email 取得不能 → `skippedNoOwner++`
   - 年 6 回上限到達 (lifecycle-emails 共有) → `skippedRateLimit++`
   - dryRun → `sent++` だけ計上
   - 上記すべてクリア → SES 送信 + `incrementMarketingEmailCount` + `setSetting(sentKey, ISO ts)` + `sent++`

**レスポンス (200):**
```json
{
  "round": "2026-H1",
  "scanned": 42,
  "sent": 18,
  "skippedTenure": 12,
  "skippedAlreadySent": 8,
  "skippedRateLimit": 0,
  "skippedNoOwner": 4,
  "errors": 0,
  "dryRun": false
}
```

#### GET /survey/sean-ellis/[token]

**認証:** HMAC トークン検証 (`survey-token.ts` `verifySurveyToken`)。鍵は `OPS_SECRET_KEY`。

**処理:**
1. token を `verifySurveyToken` で検証 → `{ tenantId, round }` 取得
2. 失敗 → `invalid: true` を返却（テンプレートで「無効なリンク」を表示）
3. 既に同 round で回答済み (`hasAnsweredSurvey`) → `alreadyAnswered: true` を返却
4. 正常 → 回答フォームをレンダリング

**ガード:** `hooks.server.ts` の setup gate に `/survey/` を bypass 追加（認証なしで到達可能）。

#### POST /survey/sean-ellis/[token]?/submit

**入力バリデーション:**
- `q1`: enum (`very` / `somewhat` / `not` / `na`) 必須
- `q2`: 1000 文字以内（任意）
- `q3`: enum (`lp` / `media` / `friend` / `google` / `sns` / `other`) 必須
- `q4`: 1000 文字以内（任意）

**処理:** `saveSurveyResponse({ tenantId, round, q1-q4, answeredAt: now })` で settings KV (`pmf_survey_response_<round>`) に JSON 永続化。

#### ops 集計画面 (内部のみ、API 公開なし)

- `src/routes/ops/pmf-survey/+page.server.ts` で `aggregateSurveyResponses(round)` を呼ぶ
- クエリパラメータ:
  - `round`: YYYY-H1 / YYYY-H2 (既定: 現在 round)
  - `q`: 自由記述検索キーワード — Q2 / Q4 + tenantId 部分一致 (case-insensitive substring)、最大 100 文字。AC12 (PO 承認 2026-04-29) で本 PR 実装。実装は `pmf-survey-service.ts::filterFreeTextByQuery` 純粋関数
- 認証: ops layout (`/ops/+layout.server.ts`) の Cognito ops group 所属チェック流用 (#820 PR-C)

#### エラーコード

| コード | HTTP | 説明 |
|--------|------|------|
| `INVALID_TOKEN` | 200 (テンプレート表示) | HMAC 検証失敗 / 形式不正 |
| `ALREADY_ANSWERED` | 200 (テンプレート表示) | 同 round で回答済み |
| 検証エラー | 400 | q1 / q3 enum 不正、q2 / q4 1000 文字超過 |

---

### 3.X ライセンスキー API (#808) — deprecated (Epic #2525 で全廃)

> **deprecated (Epic #2525 license key 全廃)**: 本節が記述する license validate / consume / 適用 API はすべて物理削除された (PR-L3 PR #2822)。entitlement は Stripe Subscription webhook が唯一の付与経路。`/admin/license` は `/admin/subscription` に統合 (LEGACY_URL_MAP redirect)、`/ops/license/*` / `/api/cron/license-expire` / `/api/v1/admin/license` は削除済。リンク先 `license-key-lifecycle.md` は deprecated (歴史記録)。本節は当時の API 仕様の歴史記録として残す。

| メソッド | パス | 説明 | 権限 |
|---------|------|------|------|
| POST | `/api/v1/license/verify` | キー検証（署名 + DB 照合） | 認証済みユーザー |
| POST | `/api/v1/license/consume` | キー消費 → 有料プラン昇格 | 認証済みユーザー |
| GET | `/api/v1/ops/license-keys` | Ops 一覧（フィルタ対応） | Ops ロール |
| POST | `/api/v1/ops/license-keys` | Ops 手動発行 | Ops ロール |
| POST | `/api/v1/ops/license-keys/:key/revoke` | Ops 失効 | Ops ロール |

関連エラーコード: `LICENSE_FORMAT_INVALID` / `LICENSE_SIGNATURE_INVALID` / `LICENSE_NOT_FOUND` / `LICENSE_ALREADY_CONSUMED` / `LICENSE_REVOKED` / `RATE_LIMITED` — §4 参照。

#### レート制限 (#813)

ライセンスキーの検証・消費および signup 時のキー適用には、ブルートフォース攻撃防止のための二次元レート制限が適用される。

| 次元 | 上限 | ウィンドウ | 超過時 |
|------|------|----------|--------|
| IP アドレス | 10 req/min | 1 分 | HTTP 429 + `Retry-After` ヘッダ |
| email アドレス | 20 req/hour | 1 時間 | HTTP 429 + `Retry-After` ヘッダ |

- **適用対象**: `/admin/license?/applyLicenseKey`（form action）、`/auth/signup`（signup 時のキー入力）
- **超過時のレスポンス**: `{ apply: { error: '試行回数が上限を超えました。N秒後にお試しください' } }`
- **Discord 通知**: レート制限超過時に incident チャネルへ自動通知（10 分間の重複抑制付き）
<!-- doc-code-refs: ignore-line -->
- **実装**: 旧 `src/lib/server/services/rate-limit-service.ts` は Phase 7 PR-L4 (#2836、QM 申し送り② #2818) で**物理削除済**（license key 全廃に伴い唯一の利用元 `/admin/license?/applyLicenseKey` が消滅。ADR-0001 設計書同期）。本節記載のレート制限仕様は license key 機構の歴史記録であり、現存実装ではない。

---

## 4. エラーレスポンス仕様

### 共通エラー形式

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "人間が読めるエラーメッセージ"
  }
}
```

### エラーコード一覧

| コード | HTTPステータス | 説明 |
|--------|--------------|------|
| VALIDATION_ERROR | 400 | リクエストバリデーション失敗 |
| CANCEL_EXPIRED | 400 | キャンセル期限超過 |
| ALREADY_RECORDED | 409 | 同日同活動の重複記録 |
| DAILY_LIMIT_REACHED | 409 | 1日あたりの記録上限到達 |
| ALREADY_CLAIMED | 409 | ログインボーナス受取済み |
| INSUFFICIENT_POINTS | 400 | ポイント残高不足 |
| INVALID_PIN | 401 | PIN不一致 |
| UNAUTHORIZED | 401 | 認証が必要 |
| LOCKED_OUT | 429 | ロックアウト中 |
| NOT_FOUND | 404 | リソースが見つからない |
| PLAN_LIMIT_EXCEEDED | 403 | プラン制限により拒否（§4.2 参照） |
| INTERNAL_ERROR | 500 | サーバー内部エラー |
| LICENSE_FORMAT_INVALID | 400 | ライセンスキー形式が不正 |
| LICENSE_SIGNATURE_INVALID | 400 | ライセンスキー HMAC 署名不一致 |
| LICENSE_NOT_FOUND | 404 | ライセンスキーが存在しない |
| LICENSE_ALREADY_CONSUMED | 409 | ライセンスキー消費済み |
| LICENSE_REVOKED | 410 | ライセンスキー失効済み |
| LICENSE_RATE_LIMITED | 429 | ライセンスキー検証/消費のレート制限超過（IP: 10 req/min, email: 20 req/hour） |

### 4.2 プラン制限エラー (`PLAN_LIMIT_EXCEEDED`) — #744

プラン制限（`PLAN_LIMITS` の boolean フラグまたは数値上限）によって拒否されたリクエストは、
**必ず HTTP 403** と以下の body で応答する。フロントエンドが「どのプランにすれば使えるか」を
一貫した UI で提示できるよう、`currentTier` / `requiredTier` / `upgradeUrl` を含める。

#### レスポンス body（正仕様）

```ts
// src/lib/domain/errors.ts
export interface PlanLimitError {
  code: 'PLAN_LIMIT_EXCEEDED';
  message: string;                              // 人間可読（日本語）
  currentTier: 'free' | 'standard' | 'family';  // リクエスト時点のテナントプラン
  requiredTier: 'standard' | 'family';          // 許可される最小プラン
  upgradeUrl: '/admin/subscription';            // アップグレード導線。固定
}
```

レスポンス例:

```json
{
  "error": {
    "code": "PLAN_LIMIT_EXCEEDED",
    "message": "AI 活動提案はスタンダードプラン以上でご利用いただけます",
    "currentTier": "free",
    "requiredTier": "standard",
    "upgradeUrl": "/admin/subscription"
  }
}
```

#### 使い分け（ステータスコード規約）

| コード | 用途 |
|-------|------|
| `400 VALIDATION_ERROR` | リクエストボディのバリデーション失敗（プラン制限以外） |
| `403 PLAN_LIMIT_EXCEEDED` | **プラン制限による拒否のみ**（boolean フラグ / 数値上限いずれも） |
| `403` （UNAUTHORIZED 系） | ロール不足 / 未認証などの認可エラー。`PLAN_LIMIT_EXCEEDED` とは別コード |
| `429 LOCKED_OUT` | レートリミット超過 |

#### トライアル中の扱い

- `currentTier` にはトライアル中のティア（`standard` / `family`）が入る。
- トライアル終了後にもう一度叩かれた場合は `currentTier: 'free'` で 403 が返る。
- クライアント側でトライアル残日数を表示するには `GET /api/v1/admin/plan-status`（別）を併用する。

#### 実装ヘルパー

- **API エンドポイント (`+server.ts`)**: `src/lib/server/errors.ts` の `planLimitError({ currentTier, requiredTier, message })` を使う。
- **フォームアクション (`+page.server.ts`)**: `fail(403, { error: createPlanLimitError(currentTier, requiredTier, message) })` を返す。`createPlanLimitError` は `src/lib/domain/errors.ts` から import する。
- **クライアント**: `isPlanLimitError(result.data?.error)` の型ガードで判定し、`requiredTier` からアップセル先プランのラベルを決定する。

#### プラン制限が適用される主要エンドポイント

現時点でプラン制限（`PLAN_LIMIT_EXCEEDED` 403 を返し得る）が実装済みのエンドポイントを整理する。
#787 で全 form action が `createPlanLimitError()` 形式に統一済み。

| エンドポイント / フォームアクション | 必要プラン | 根拠 | 実装状況 |
|----------|---------|------|---------|
| `POST /api/v1/activities/suggest` | family | AI 活動提案 (`tier !== 'family'`) | `planLimitError()` 済 |
| `GET /api/v1/export` | standard | `canExport` フラグ | `planLimitError()` 済 |
| `POST /api/v1/export/cloud` | standard | `canExport` + `maxCloudExports` | `planLimitError()` 済 |
| `POST /admin/children ?/addChild` | 上限付き | `free` は `maxChildren=2` まで | `createPlanLimitError()` 済 (#787) |
| `POST /admin/activities ?/create` | 上限付き | `free` は `maxActivities=3` まで | `createPlanLimitError()` 済 (#787) |
| `POST /admin/checklists ?/createTemplate` | 上限付き | `free` は `maxChecklistTemplates=3` まで (#723) | `createPlanLimitError()` 済 (#787) |
| `POST /admin/checklists ?/importMarketplace` | 上限付き | `free` は `maxChecklistTemplates=3` まで (#2137) | `createPlanLimitError()` 済 (#787) |
| `POST /admin/rewards ?/add` | standard | ごほうび管理 (`canCustomReward`, #728 / #2268 grant→add リネーム) | `createPlanLimitError()` 済 (#787) |
| `POST /admin/rewards ?/addPreset` | standard | ごほうび管理 プリセット取り込み (#728) | `createPlanLimitError()` 済 (#787) |
| `POST /admin/rewards/requests ?/approveRedemption` | — | 申請承認 (#2269 で /admin/rewards から分離) | — |
| `POST /admin/rewards/requests ?/rejectRedemption` | — | 申請却下 (#2269 で /admin/rewards から分離) | — |
| `POST /api/v1/special-rewards/suggest` | family | AI ごほうび提案 (`tier !== 'family'`, #719) | `apiError()` 済 |
| `POST /api/v1/cheer/suggest` | family | AI 応援提案 (`tier !== 'family'`, #2273) | `apiError()` 済 |
| `POST /api/v1/checklists/suggest` | family | AI チェックリスト提案 (`tier !== 'family'`, #720) | `apiError()` 済 |
| `POST /admin/messages ?/send` (text モード) | family | 自由テキストメッセージ (`canFreeTextMessage`, #772) | `createPlanLimitError()` 済 (#787) |
| `POST /admin/settings ?/updateSiblingSettings` (ranking ON) | family | きょうだいランキング (`canSiblingRanking`, #782) | `createPlanLimitError()` 済 (#787) |

**注意**: 上記以外のエンドポイント（GET 系・基本的な CRUD 等）は**全プラン利用可**。
新規にプラン制限を追加する際は、本表へ追記し `PlanLimitError` 形式で 403 を返すこと。

クライアント側では `getErrorMessage(form?.error)` ヘルパー（`src/lib/domain/errors.ts`）を使うと
`string | PlanLimitError | null` を一貫して表示用文字列へ正規化できる。

#### 移行計画

1. **Phase 1**（#744, 完了）: 仕様定義・型定義・ヘルパー追加。既存実装は変更しない。
2. **Phase 2** (#787, 完了): 全プラン制限箇所を `planLimitError()` / `createPlanLimitError()` に統一。`getErrorMessage()` ヘルパー追加によりクライアント側の表示を共通化。
3. **Phase 3**: フロント共通エラーハンドラで `isPlanLimitError` を使ったアップセルトーストを実装。

---

## 5. 認証フロー

### hooks.server.ts の処理（cognito モード）

```
リクエスト受信
    │
    ├── 0) レートリミットチェック（静的ファイル除外）
    │       └── 超過 → 429 Too Many Requests
    │
    ├── 1) 二層セッション解決
    │       ├── Layer 1: identity_token Cookie → Cognito JWT 検証 → Identity
    │       └── Layer 2: context_token Cookie → HMAC 検証 → AuthContext
    │
    ├── 2) ルート保護
    │       ├── 公開ルート（/, /auth/*, /switch, /legal/*, /api/health, /api/ready, /api/stripe/webhook, /ops/*）→ 通過
    │       ├── /admin/* → owner/parent ロール必須
    │       ├── /child/* → 全ロール
    │       ├── /api/v1/admin/* → owner/parent ロール必須
    │       └── /api/v1/* → 全ロール
    │
    ├── 3) セキュリティヘッダ付与
    │       └── X-Frame-Options, X-Content-Type-Options, HSTS, etc.
    │
    └── 4) リクエストログ記録
```

### hooks.server.ts の処理（local モード）

```
リクエスト受信
    │
    ├── 1) セットアップチェック（子供未登録 → /setup へ）
    ├── 2) PIN 認証（管理画面のみ）
    ├── 3) セキュリティヘッダ付与（HSTS 除外）
    └── 4) リクエストログ記録
```

### セッション管理（cognito モード）

| 項目 | 仕様 |
|------|------|
| Identity Cookie | `identity_token`（Cognito ID Token） |
| Context Cookie | `context_token`（HMAC-SHA256 署名付き） |
| 属性 | HttpOnly, Secure, SameSite=Lax, Path=/ |
| Identity 有効期限 | 1時間（Cognito 設定） |
| Context 有効期限 | 24時間（自動再発行） |

### トライアル終了検知（#770）

| 項目 | 仕様 |
|------|------|
| Cookie名 | `trial_was_active` |
| 有効期限 | 30日 |
| 属性 | HttpOnly, Secure（Lambda環境のみ）, SameSite=Lax, Path=/ |
| 値 | `1`（トライアル中のみ設定） |
| 遷移検知 | cookie `1` + `isTrialActive=false` → `trialJustExpired=true` をクライアントに返却し cookie 削除 |

### セッション管理（local モード）

| 項目 | 仕様 |
|------|------|
| Cookie名 | `ganbari_session` |
| 有効期限 | 30分（操作ごとに延長） |
| 属性 | HTTP-only, SameSite=Strict, Path=/ |
| 値 | ランダムトークン（crypto.randomUUID()） |
| サーバー保存 | settings テーブルにトークンと有効期限を保存 |

### cron エンドポイント認証パターン（`verifyCronAuth`）

EventBridge / 手動トリガー用の内部エンドポイントは、Cognito セッション認証の対象外であり、
独自の shared secret（`CRON_SECRET`）で認証する。共通ヘルパー `verifyCronAuth` を使用する。

> 参照: [14-セキュリティ設計書.md](14-セキュリティ設計書.md) §5 — `/ops` ダッシュボード認可と cron 認証の概念分離（旧 archive ADR-0033、git 履歴）

#### 実装（`src/lib/server/auth/cron-auth.ts`）

```ts
export function verifyCronAuth(request: Request): Response | null {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('x-cron-secret');
    if (authHeader !== cronSecret) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else if (process.env.AUTH_MODE !== 'local') {
    return json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  return null;
}
```

#### 呼び出しパターン（全 cron `+server.ts` で統一）

```ts
const authError = verifyCronAuth(request);
if (authError) return authError;
```

認証成功時は `null` を返し、失敗時は `Response` を返す。
呼び出し側はガード節で早期 return するだけでよい。

#### 環境別挙動

| 環境 | `CRON_SECRET` | `AUTH_MODE` | 挙動 |
|------|--------------|-------------|------|
| 本番（Lambda） | 設定済み | `cognito` | `x-cron-secret` ヘッダ必須。不一致で 401 Unauthorized |
| CI / E2E テスト | 未設定 | `local` | 認証スキップ（テスト実行を阻害しない） |
| ステージング | 未設定 | `cognito` | 500 Internal Server Error（`CRON_SECRET` 未設定は設定漏れ） |

#### 使用エンドポイント一覧

| パス | メソッド | 概要 |
|------|---------|------|
| `/api/cron/retention-cleanup` | POST / GET | 保持期間超過データの物理削除（ADR-0028） |
| `/api/cron/trial-notifications` | POST | トライアル通知の日次送信 |
| `/api/cron/grace-period-deletion` | POST / GET | グレースピリオド期限切れテナントの物理削除バッチ（#1648 R43, grace-period-service.ts findExpiredSoftDeletedTenants → account-deletion-service deleteOwnerOnlyAccount/deleteOwnerFullDelete 経由）。プラン別猶予期間（standard:7 / family:30 日）後に soft-delete されたテナントを物理削除し、個人情報保護法 22 条遵守 + DB 肥大化リスクを解消する。`scheduleRegistry` の 02:00 JST 定義に従い、AWS は EventBridge Rule `ganbari-quest-cron-grace-period-deletion`、NUC は scheduler が駆動する。**`dryRun=true` は 1 件も削除しないが、`tenantsProcessed` / `tenantsRemaining` は定数ではなく実行時と同じ打ち切り条件（`limit` / 時間予算）から算出した予測値を返す**（#4373。実績値である `tenantsDeleted` / `tenantsFailed` は削除を行わないため 0）|
| `/api/cron/deletion-warning-emails` | POST / GET | アカウント削除予告メールの日次バッチ（#2399, `deletion-warning-service.ts`）。EventBridge cron `cron(0 1 * * ? *)` (UTC) = 毎日 10:00 JST 実行。soft-delete 済テナントを走査し、物理削除予定日までの残日数（JST 暦日）がしきい値以下になった**保護者ロール (owner/parent) 全員**へ、削除予定日と復元導線を含むメールをそれぞれ送る（#4325 follow-up、オーナー決裁 2026-08-06。owner 1 名固定だと owner 不在 / アドレス失効時に予告が単一障害点で届かないため。`child` ロールは対象外、同一メールアドレスが複数ロールに登録されていれば 1 通にまとめる）。しきい値は family = 14 日 / standard = 1 日 / **free = 送信なし（猶予 0 日 = 即時物理削除のため予告する時間が存在しない）**。重複送信は `deletion_warning_sent_at` settings KV で防止し（1 通以上の送信成功でセット、復元 / 再予約時にクリア）、対象保護者が 1 件も見つからない場合は `skippedNoRecipients++`（削除自体は止めずログで観測可能にする）。全宛先で送信に失敗した場合のみ再試行対象（`errors++`、sent_at 未設定）。法務通知扱いのため `marketing-email-counter`（年 6 回上限）を経由せず List-Unsubscribe も付けない（購読解除で止まらない）。件数上限 + 時間予算（#3695）で 30 秒制約に収め、残件は `tenantsRemaining` で報告 |
| `/api/cron/pmf-survey` | POST | PMF 判定アンケート（Sean Ellis Test）の半期一括送信バッチ（#1598 / ADR-0023 §3.6）。EventBridge cron `0 0 1 6,12 ? *` (UTC) = 6/1 + 12/1 09:00 JST 実行。`pmf-survey-service.ts processTenant` が契約 14 日超のテナントの owner ロール宛に SES でアンケ URL を送信。同一 half-year round 内の重複送信を `pmf_survey_sent_<round>` settings KV キーで防止。年 6 回上限の `marketing-email-counter` を共有 |
| `/api/cron/export-build` | POST / GET | クラウドエクスポート非同期 build バッチ（#3504, async-backup-export.md §3.2）。EventBridge cron `cron(0/5 * * * ? *)` (UTC) = 5 分毎実行 (AWS cron-dispatcher / NUC scheduler container 双方が同一 endpoint を駆動)。`status='pending'` の `cloud_exports` レコードを拾い `building` → `buildFullBackupZip` → storage 保存 → `ready`（失敗時 `failed` + `failureReason`）に遷移させる。**`dryRun=true` と `GET`（ヘルスチェック）は build も status 書き換えも行わないが、`processed` は定数ではなく pending の実数を返す**（#4373。write を伴う stale reclaim は dryRun では実行しないため `reclaimed` は返さない）|
| `/api/cron/notification-delivery` | POST / GET | 通知 / 週次レポート配信バッチ（#4706, `notification-delivery-service.ts`）。EventBridge cron `cron(0/15 * * * ? *)` (UTC) = 15 分毎実行（AWS cron-dispatcher / NUC scheduler 双方が同一 endpoint を駆動）。設定 UI が保存した値を読んで 3 配信を送る: **(a) 週次メールレポート** = `weekly_report_enabled` かつ `weekly_report_day` が JST の今日、09:00 JST 以降、`resolveFullPlanTier` が standard 以上（#735 の有料特典 gate を送信 endpoint と共有）/ **(b) リマインダー push** = `notification_reminders_enabled` かつ `notification_reminder_time` を過ぎている / **(c) ストリーク警告 push** = `notification_streak_enabled` かつ 19:00 JST 以降で、今日未記録かつ連続記録が継続中の子供がいる。quiet hours と 1 日 3 通上限は `sendPushNotification` 内の `canSendNotification` が担う。重複送信は送信済マーカー（`weekly_report_sent_week` = 週頭の JST 暦日 / `notification_reminder_sent_date` / `notification_streak_sent_date` = JST 暦日）で防ぎ、**1 通以上の送信に成功したときだけマーカーを立てる**（失敗した回は次回再試行される）。判定用の設定は `getSettingForAllTenants` でキーごとに 1 クエリに畳むため、実行頻度を上げてもクエリ数はテナント数に比例しない（ADR-0065 原則 2）。件数上限 + 時間予算（#3695）で 30 秒制約に収め、残件は `tenantsRemaining` で報告。**`dryRun=true` と `GET`（ヘルスチェック）は送信もマーカー書き込みも行わないが、対象件数は実行時と同じ判定で数える** |
| `/api/cron/pglite-backup` | POST | **NUC 専用** PGlite 本番データの日次バックアップ（#3950）。NUC ローカルの crond（`docker-compose.yml` backup profile、03:00 JST）が `scripts/backup-nuc.cjs` 経由で起動する。`runPgliteBackup()` が PGlite 公式 `dumpDataDir()` でダウンタイム 0 の整合スナップショットを取得し、**取得物を別インスタンスへ実際に復元して検証**（V1 全テーブル `count(*)` / V2 `__drizzle_migrations` 非空 / V3 journal ↔ 適用実績の突合）した上で確定、3 世代へローテーションする。`DATA_SOURCE != pglite` では 409 を返す（AWS は DSQL のため対象外）。EventBridge / `scheduleRegistry` には登録しない（NUC 専用のため）。運用手順は `docs/runbooks/pglite-restore-drill.md` |
| `/api/v1/admin/tenant-cleanup` | POST | テナントクリーンアップ |
| `/api/v1/admin/cleanup-orphans` | POST | 孤立データクリーンアップ |
| `/api/v1/admin/migration` | GET / POST | マイグレーション統計取得・実行 |
| `/api/v1/admin/weekly-report` | POST | 週次レポート生成トリガー |
| `/api/v1/admin/notifications/reminder` | POST | リマインダー通知送信 |
| `/api/v1/admin/notifications/streak-warning` | POST | ストリーク途切れ警告送信 |

---

## 6. 更新履歴

| 日付 | 版数 | 内容 |
|------|------|------|
| 2026-02-19 | 1.0 | 初版作成 |
| 2026-03-27 | 2.0 | 全エンドポイント最新化（認証, Stripe, 招待, キャリア, 特別報酬, 画像, エクスポート, ピン留め, サジェスト等を追加）。認証フローを Cognito 二層認証に更新 |
| 2026-03-30 | 2.1 | #0176 運営管理ダッシュボード Phase 1（/ops KPIサマリー + Bearer認証）追加 |
| 2026-03-30 | 2.2 | #0205 データクリア/サマリーAPI追加、インポートにreplaceモード追加 |
| 2026-03-31 | 2.3 | #0257 廃止機能削除に伴い関連記述を除去（キャリアプランAPI、アバターアップロードAPI、データサマリーから廃止項目削除） |
| 2026-04-03 | 2.4 | #0294 クラウドエクスポート共有機能のAPI追加（export/cloud CRUD、import/cloud PINコードインポート） |
| 2026-04-04 | 2.5 | #344 実装とのAPI同期: メンバー管理（削除/移譲/脱退）、テナント操作（status/cancel/reactivate）、通知（reminder/streak-warning/subscribe/unsubscribe）、カスタム音声（voices CRUD）、アバター、活動パック export/import、設定（vapid-key/tutorial）、デモ分析、管理用内部API（cleanup-orphans/migration/weekly-report/tenant-cleanup）追加 |
| 2026-04-06 | 2.6 | #550 アナリティクス基盤: POST /api/v1/analytics（イベント記録）、GET /api/v1/analytics/status（設定確認）追加。3層プロバイダー（Sentry/Umami/DynamoDB）アーキテクチャ |
| 2026-04-10 | 2.7 | #605 バトルアドベンチャーAPI追加: GET/POST /api/v1/battle/[childId]（日次バトル取得・実行） |
| 2026-04-09 | 2.8 | #609 設計書同期: アカウント削除(2)・閲覧専用トークン(3)エンドポイントを一覧追加。未記載だった9カテゴリのエンドポイント詳細仕様（3.17-3.25）を追記 |
| 2026-04-12 | 2.9 | #744 プラン制限エラー仕様 (§4.2) 追加。`PLAN_LIMIT_EXCEEDED` の body フォーマット (`currentTier` / `requiredTier` / `upgradeUrl`) を正仕様化。型定義を `src/lib/domain/errors.ts` として新設し client/server で共有。既存実装の移行は #787 で追跡 |
| 2026-04-11 | 2.10 | #787 プラン制限エラー形式統一。全 form action (`/admin/children`, `/admin/activities`, `/admin/checklists`, `/admin/rewards`, `/admin/messages`, `/admin/settings`) が `createPlanLimitError()` 形式の `PlanLimitError` body を返すように統一。クライアント側表示を共通化する `getErrorMessage()` ヘルパーを `src/lib/domain/errors.ts` に追加 |
| 2026-04-12 | 2.11 | #721 AIモデルを Gemini → AWS Bedrock Claude Haiku に移行。活動サジェスト・レシートOCR の AI バックエンドを `@aws-sdk/client-bedrock-runtime` の Converse API (tool_use) に変更。構造化出力により `extractJson()` 手動パースを廃止。画像生成（`image-service.ts`）のみ Gemini 維持 |
| 2026-04-12 | 2.12 | #720 AI チェックリスト提案 API (`POST /api/v1/checklists/suggest`) 追加。Bedrock Claude Haiku + プリセット/キーワードフォールバック。ファミリープラン限定 |
| 2026-04-12 | 2.13 | #770 トライアル終了検知の cookie 仕様追加。admin layout server load で `trial_was_active` cookie（HttpOnly, Secure, SameSite=Lax, 30日有効）を使い、トライアル active → inactive 遷移を検出。遷移検知後は cookie を削除し、`trialJustExpired` フラグをクライアントに返却 |
| 2026-04-12 | 2.14 | #722 AI suggest 3 エンドポイントのプランゲートを `standard` → `family` 限定に変更。`createFromAi` form action も `tier !== 'family'` ガードに統一。デモ版 3 画面に AI 提案パネルを追加 |
| 2026-04-13 | 2.15 | #839 アプリ内フィードバック送信 API (`POST /api/v1/feedback`) 追加。種別（opinion/bug/feature/other）+ テキスト（1000文字以内）+ スクリーンショット（dataURL, 最大 2MB, 任意）を受け取り Discord webhook (inquiry チャネル) に転送。レート制限: 1テナント/5分1件（インメモリ Map、TTL 自動クリーンアップ付き） |
| 2026-04-13 | 2.16 | #813 ライセンスキー validate/consume API レート制限仕様追加。§3.X にレート制限表（IP: 10 req/min, email: 20 req/hour）、§4 に `LICENSE_RATE_LIMITED` (429) エラーコード追加 |
| 2026-04-17 | 2.17 | #1093 cron エンドポイント認証パターン（`verifyCronAuth`）を §5 に追加。実装コード・呼び出しパターン・環境別挙動・使用エンドポイント一覧を文書化。ADR-0033 への相互参照 |
| 2026-04-18 | 2.18 | #1111 POST /api/v1/admin/invites にプラン別メンバー上限チェック (`maxFamilyMembers`) と `MEMBER_LIMIT_REACHED` エラー仕様を追記 |
| 2026-04-26 | 2.19 | #1337 §3.26 ごほうびショップ交換申請 API 追加（POST /api/v1/reward-redemption-requests, GET /api/v1/reward-redemption-requests, PATCH /api/v1/reward-redemption-requests/:id, POST /api/cron/expire-redemptions）。エラーコード・ポイント減算タイミング・承認/却下フロー仕様を定義 |
| 2026-04-27 | 2.20 | #1591 §3.25 GET /api/v1/analytics/status のレスポンスを `providers: []` + `dynamoEnabled` 形式に更新。umami / Sentry プロバイダ削除に伴う ADR-0023 I2 対応。詳細は `docs/design/13-AWSサーバレスアーキテクチャ設計書.md §7.2` を参照 |
| 2026-04-28 | 2.21 | #1648 R43 §5 cron 使用エンドポイント一覧に `/api/cron/grace-period-deletion` を追加。grace-period-service.ts findExpiredSoftDeletedTenants → account-deletion-service の物理削除フロー。EventBridge 02:00 JST 実行。プラン別猶予期間 (standard:7 / family:30) 後の物理削除を担保 |
| 2026-04-29 | 2.22 | #1598 §5 cron 使用エンドポイント一覧に `/api/cron/pmf-survey` を追加。半期 (6/1 / 12/1 09:00 JST) PMF 判定アンケート (Sean Ellis Test) 一括送信バッチ。契約 14 日超 owner ロールが対象、round 内重複送信防止、`marketing-email-counter` 年 6 回上限と共有。ADR-0023 §3.6 PMF 判定 (40% 閾値) 連動 |
| 2026-04-29 | 2.23 | #1598 §3.27 PMF 判定アンケート API 詳細追加 — POST /api/cron/pmf-survey (リクエスト/レスポンス仕様)、GET/POST /survey/sean-ellis/[token] (HMAC トークン回答 UI)、ops 集計画面の `q` 自由記述検索パラメータ仕様。AC4 文言整合 (60 日カウンタ→半期 round 内重複防止 PO 承認 2026-04-29)。AC12 自由記述検索を本 PR で実装 (Q2/Q4 + tenantId 部分一致 case-insensitive substring) |
| 2026-04-29 | 2.24 | #1693 §5 cron 使用エンドポイント一覧に `/api/cron/analytics-aggregate` を追加。EventBridge `cron(0 18 * * ? *)` (UTC) = 03:00 JST 実行で前日分 funnel + cancellation reason を `PK=ANALYTICS_AGG#<date>` (TTL 365 日) に書き込み、`/admin/analytics` read 側の集計優先 → ライブ計算 fallback ロジックを駆動 (#1639 follow-up) |
| 2026-04-30 | 2.25 | #1742 §5 cron 使用エンドポイント一覧に `/api/cron/challenge-aggregate` を追加。EventBridge `cron(30 18 * * ? *)` (UTC) = 03:30 JST 実行で当日分の全テナント `questionnaire_challenges` 設定値スナップショットを `PK=CHALLENGE_AGG#<date>` (TTL 365 日) に書き込み、`/ops/analytics` プリセット選択分布画面の `fetchChallengesPerTenant` N+1 GetItem を集計テーブル方式へ移行（#1602 follow-up）。集計優先 → ライブ計算 fallback の二段構造で post-PMF テナント数 1,000+ 想定に対応 |
| 2026-05-17 | 2.26 | #2138 (MP-3) マーケットプレイス rule-preset 4 ruleType 全対応 API 追加。`POST /marketplace/[type]/[itemId] ?/importRulePreset` (4 ruleType 分岐: exchange→`special_rewards` 挿入 / bonus→`settings.rule_preset_bonus_overrides` JSON / penalty / special→audit log のみ)、`POST /admin/settings/rules ?/togglePreset` (bonus preset enabled 切替)、`POST /admin/settings/rules ?/removePreset` (bonus preset 削除)。`bonus-hook-service.ts` が `activity-log-service.recordActivity()` から呼ばれ、enabled な 6 bonus preset (streak-bonus / early-bird / weekend-special / category-challenge / sibling-coop / self-study-reward) を活動記録時に評価。ADR-0012 §6 細則表に penalty / special 行追加 |
| 2026-07-26 | 2.27 | #3950 §5 cron 使用エンドポイント一覧に `/api/cron/pglite-backup` を追加。NUC 専用の PGlite 日次バックアップ（RPO 日次 / 保持 3 世代 / ダウンタイム 0、オーナー決裁 2026-07-26）。PGlite は dataDir を単一プロセスで占有するため、整合スナップショットを採れるのは DB を掴んでいるアプリプロセスのみ = `dumpDataDir()` をアプリ内で実行し、外部の crond は本エンドポイントを起動するだけの役割に分離。取得物は毎回別インスタンスへ復元して V1/V2/V3 を検証し、通ったものだけを確定する（verify-then-commit）。V3 は journal と `__drizzle_migrations` の突合で、#3951 の gate が塞げていなかった「journal と本番適用実績の関係」を日次で担保する |
