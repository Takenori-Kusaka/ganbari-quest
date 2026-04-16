# がんばりクエスト API設計書

| 項目 | 内容 |
|------|------|
| 版数 | 2.14 |
| 作成日 | 2026-02-19 |
| 更新日 | 2026-04-12 |
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
| GET | /api/health | ヘルスチェック | 不要 |
| POST | /api/v1/auth/login | Cognito ログイン（Email/Password） | 不要 |
| POST | /api/v1/auth/logout | ログアウト（Cookie クリア） | 不要 |
| GET | /auth/callback | Cognito OAuth コールバック | 不要 |
| POST/GET | /auth/logout | ログアウト（Cookie クリア + リダイレクト） | 不要 |

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
| GET | /api/v1/activities/export | 活動パック形式でエクスポート | owner/parent |
| POST | /api/v1/activities/import | 活動パック形式でインポート | owner/parent |

### 特別報酬

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| GET | /api/v1/special-rewards/[childId] | 子供の特別報酬一覧 | 全ロール |
| POST | /api/v1/special-rewards/[childId] | 特別報酬作成 | owner/parent |
| POST | /api/v1/special-rewards/[rewardId]/shown | 報酬表示済みマーク | 全ロール |
| GET | /api/v1/special-rewards/templates | 報酬テンプレート一覧 | owner/parent |
| PUT | /api/v1/special-rewards/templates | 報酬テンプレート更新 | owner/parent |
| POST | /api/v1/special-rewards/suggest | ごほうびサジェスト（AI推定） | owner/parent |

### チェックリスト

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| POST | /api/v1/checklists/suggest | チェックリストサジェスト（AI推定） | owner/parent |

### おうえんメッセージ

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| GET | /api/v1/messages/[childId] | メッセージ履歴取得 | 全ロール |
| GET | /api/v1/messages/[childId]?mode=unshown | 未表示メッセージ取得 | 全ロール |
| POST | /api/v1/messages/[childId] | メッセージ送信 | owner/parent |
| POST | /api/v1/messages/[messageId]/shown | メッセージ表示済みマーク | 全ロール |

### おやすみ日・減少設定

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| GET | /api/v1/rest-days/[childId] | おやすみ日一覧取得（月別） | owner/parent |
| POST | /api/v1/rest-days/[childId] | おやすみ日登録 | owner/parent |
| DELETE | /api/v1/rest-days/[childId] | おやすみ日削除 | owner/parent |
| GET | /api/v1/settings/decay | 減少強度設定取得 | owner/parent |
| PUT | /api/v1/settings/decay | 減少強度設定更新 | owner/parent |

### 画像・エクスポート

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| GET | /api/v1/images | 画像取得（S3 プロキシ） | 全ロール |
| POST | /api/v1/images | 画像アップロード | owner/parent |
| GET | /api/v1/export | データエクスポート（JSON） | owner/parent |
| POST | /api/v1/import | データインポート（JSON） | owner/parent |
| GET | /api/v1/export/cloud | クラウドエクスポート一覧取得 | owner/parent |
| POST | /api/v1/export/cloud | クラウドエクスポート作成 | owner/parent |
| DELETE | /api/v1/export/cloud/[id] | クラウドエクスポート削除 | owner/parent |
| POST | /api/v1/import/cloud | PINコードでクラウドインポート | owner/parent |
| GET | /uploads/avatars/[filename] | アバター画像配信 | 不要 |

### 管理系 API

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| GET | /api/v1/admin/invites | 招待一覧取得 | owner/parent |
| POST | /api/v1/admin/invites | 招待リンク作成 | owner/parent |
| DELETE | /api/v1/admin/invites/[code] | 招待リンク取消 | owner/parent |
| GET | /api/v1/admin/license | ライセンス情報取得 | owner/parent |
| POST | /admin/license?/applyLicenseKey | ライセンスキー適用（form action） | owner |
| DELETE | /api/v1/admin/members/[userId] | メンバー削除 | owner |
| POST | /api/v1/admin/members/[userId]/transfer-ownership | owner権限移譲 | owner |
| POST | /api/v1/admin/members/leave | テナントから脱退 | 全ロール |
| GET | /api/v1/admin/tenant/status | テナントステータス取得 | owner/parent |
| POST | /api/v1/admin/tenant/cancel | テナント解約（graceful） | owner |
| POST | /api/v1/admin/tenant/reactivate | テナント再有効化 | owner |
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

### デモ

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| POST | /api/demo-analytics | デモ利用分析イベント記録 | 不要 |

### Stripe（決済）

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| POST | /api/stripe/checkout | Stripe Checkout セッション作成 | owner/parent |
| POST | /api/stripe/portal | Stripe カスタマーポータル作成 | owner/parent |
| POST | /api/stripe/webhook | Stripe Webhook 受信 | 不要（Stripe署名検証） |

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
- ファミリープラン以外では `403 PLAN_LIMIT_EXCEEDED` を返す

#### POST /api/v1/checklists/suggest

テキスト入力からチェックリストのテンプレート名・アイコン・アイテム一覧を AI で推定する。ファミリープラン限定（#720, #722）。

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
- ファミリープラン以外では `403 PLAN_LIMIT_EXCEEDED` を返す

### 3.10 画像・エクスポート

#### GET /api/v1/images

S3 からの画像取得プロキシ。`key` クエリパラメータで対象を指定。

#### POST /api/v1/images

画像をアップロードする（S3 へ保存）。

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
  - `avatars/{childId}/{filename}.png` 等、`tenants/{tenantId}/` prefix 配下のアップロード済みファイル
- ZIP 合計 100MB 到達時点で以降のファイルをスキップ（warn ログ出力）

**保持期間との関係:**
エクスポート対象は DB 上に残っている全データ（`applyRetentionFilter` によるプラン別の履歴表示フィルタは本 API には適用されない）。
プラン別履歴保持期間（free: 90 日 / standard: 365 日 / family: 無制限）は表示フィルタのみで、物理削除は行わない（ADR-0027）。

**エントリポイント:**
`/admin/settings` ページの「データエクスポート」セクションから実行可能。`compact` と `format=zip` のチェックボックスが UI に露出している。

#### POST /api/v1/import

エクスポートしたJSONデータをインポートする。

**クエリパラメータ:**

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| mode | string | いいえ | "preview"（プレビュー）、"execute"（追加インポート）、"replace"（置換インポート）。デフォルト: preview |

**リクエストボディ:** エクスポートされたJSON全体

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

**AIモデル:** AWS Bedrock Claude Haiku（画像入力 + tool_use）— レシート画像をマルチモーダル入力し、金額とテキストを構造化出力で抽出。Bedrock 未利用時は `NO_API_KEY` エラーを返す。

#### GET /api/v1/export/cloud (#0294)

テナントのクラウドエクスポート一覧を取得する。認可: owner/parent。

**プラン制限:** `PlanLimits.maxCloudExports > 0` が必須（free=0 / standard=3 / family=10）。UI 側は `/admin/settings` で free プランの場合にクラウド共有カードをアップセル表示に切り替え、paid プランでは `保管枠 {現在} / {maxCloudExports}` のスロット残量を併記する（#773）。

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
      "createdAt": "2026-04-03T10:00:00Z"
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

**レスポンス (201 Created):**
```json
{
  "ok": true,
  "export": {
    "id": 1,
    "pinCode": "ABC123",
    "exportType": "template",
    "expiresAt": "2026-04-10T00:00:00Z"
  }
}
```

- `template`: 活動マスタ・チェックリストテンプレート等の設定データのみ
- `full`: 子供プロフィール・活動記録・ポイント等の全データ

#### DELETE /api/v1/export/cloud/[id] (#0294)

クラウドエクスポートを削除する（S3上のファイルも削除）。認可: owner/parent。

**レスポンス (200):**
```json
{
  "ok": true
}
```

#### POST /api/v1/import/cloud (#0294)

PINコードを使って他テナントのクラウドエクスポートデータをインポートする。認可: owner/parent。

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

### 3.11 管理系 API

#### GET /api/v1/admin/invites

テナントの招待リンク一覧を取得する。

#### POST /api/v1/admin/invites

招待リンクを作成する。

**リクエストボディ:**
```json
{
  "role": "parent",
  "expiresInDays": 7
}
```

#### DELETE /api/v1/admin/invites/[code]

招待リンクを取り消す。

#### GET /api/v1/admin/license

テナントのライセンス情報を取得する。

#### POST /admin/license?/applyLicenseKey（SvelteKit form action）

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
- **リクエスト**: FormData `planId: 'monthly' | 'yearly' | 'family-monthly' | 'family-yearly'`
- **成功レスポンス**: Stripe Checkout URL へリダイレクト
- **`success_url`**: `${origin}/admin/license?session_id={CHECKOUT_SESSION_ID}`
- **`cancel_url`**: `${origin}/pricing`
- **完了時の処理**: webhook `checkout.session.completed` → `handleCheckoutCompleted` でテナント plan を更新し、ライセンスキーを発行

#### POST /api/stripe/portal

Stripe カスタマーポータルの URL を作成し、ユーザーをリダイレクトする。

- **認可**: `requireRole(locals, ['owner', 'parent'])`（child → 403）
- **PIN ゲート (#771)**:
  - `pinConfigured = true` のテナント: PIN（4-6 桁）入力 → `verifyPin`
  - `pinConfigured = false` のテナント: 確認フレーズ「`プランを変更します`」入力
  - 失敗時のエラーコード: `PIN_REQUIRED` (401) / `INVALID_PIN` (401) / `LOCKED_OUT` (423) / `CONFIRM_PHRASE_REQUIRED` (401)
- **`return_url`**: `${origin}/admin/license`
- **Customer Portal で実行可能な操作（Stripe ダッシュボード設定で有効化済）**:
  - プラン変更（standard ↔ family、月額 ↔ 年額）
  - 解約（次回更新日まで利用可能）
  - 支払い方法の追加・変更・削除
  - 請求先情報の変更
  - 請求書（invoice）履歴の閲覧・PDF ダウンロード

##### 月額 ↔ 年額切替と proration ポリシー (#786)

- **切替動線**: `/admin/license` → 「プラン管理ポータル」ボタン → Stripe Customer Portal → プラン変更 → 月額/年額の Price ID を選択
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

**処理する event 種別と因果関係**: `docs/design/license-subscription-causality.md` §2 を参照（SSOT）。
本エンドポイントの全ての状態遷移は因果関係マップの定義に従う。実装差分がある場合は因果関係マップが正。

**Idempotency**: Stripe webhook は at-least-once 配信のため、`stripe_webhook_events` テーブルで event ID ベースの重複排除を行う（§6 参照）。

### 3.13 活動ピン留め

#### POST /api/v1/children/[id]/activities/[activityId]/pin

活動をピン留めする（ホーム画面の先頭に表示）。

#### DELETE /api/v1/children/[id]/activities/[activityId]/pin

活動のピン留めを解除する。

### 3.14 活動サジェスト

#### POST /api/v1/activities/suggest

テキスト入力から活動名・カテゴリを AI で推定する。

**AIモデル:** AWS Bedrock Claude Haiku (`us.anthropic.claude-haiku-4-5-20251001-v1:0`) — tool_use（構造化出力）で確実にJSONスキーマ準拠のレスポンスを返す。Bedrock 未利用時はキーワードベースのフォールバック。

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

**レスポンス:**
```json
{
  "status": "ok",
  "timestamp": "2026-02-19T18:30:00Z",
  "version": "1.0.0"
}
```

---

### 3.16 運営管理ダッシュボード（#0176 / #820 / ADR-0033）

> `/ops` 配下は **Cognito User Pool の `ops` group メンバーのみがアクセス可能**（#820 / ADR-0033）。
> 非メンバーは 403 Forbidden。実装は `src/routes/ops/+layout.server.ts` が `isOpsMember(locals.identity)` で判定する。
>
> 旧 `OPS_SECRET_KEY` Bearer token / `ops_token` Cookie / URL token 認証はすべて廃止済み。
> なお `/api/cron/retention-cleanup` は EventBridge から呼ばれる別経路のため、独自の shared secret
> （`CRON_SECRET`、移行期は `OPS_SECRET_KEY` も後方互換で受け入れ）を使用する（ADR-0033）。

#### GET /ops （KPI サマリーページ）

**認証:** Cognito User Pool `ops` group メンバーであること（通常の Cognito ログインセッション）

**レスポンス:** HTML ページ（SSR）。テナント統計・プラン別内訳・MRR概算を表示。

**データ:**
- 総テナント数（active / grace_period / suspended / terminated）
- 今月の新規テナント数
- プラン別内訳（monthly / yearly / lifetime / noPlan）
- MRR 概算
- Stripe 連携状態

#### GET /ops/license （ライセンスキー管理 - 一覧 / 検索 #805）

**認証:** Cognito User Pool `ops` group メンバーであること

**機能:**
- 最近のライセンスイベント一覧 (`license_events` 最新 50 件) の表示
- 特定キーへの検索フォーム（POST → `/ops/license/[key]` へリダイレクト）

**URL パラメータ:**
- `limit` (query, number): イベント取得件数。デフォルト 50、最大 200

#### GET /ops/license/[key] （ライセンスキー詳細 #805）

**認証:** Cognito User Pool `ops` group メンバーであること

**パラメータ:**
- `key` (path): ライセンスキー（URL エンコード。内部で upper-case に正規化）

**機能:**
- `LicenseRecord` の全フィールド表示（tenantId / plan / kind / createdAt / expiresAt / consumedBy / revokedAt 等）
- 当該キーの `license_events` 履歴（最新 200 件）
- `status='active'` のときのみ「失効」ボタンを表示

#### POST /ops/license/[key]?/revoke （ライセンスキー失効 form action #805）

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

**レスポンス:** `200 { success: true }`

### 3.20 おやすみ日

#### GET /api/v1/rest-days/[childId]

おやすみ日一覧取得。`?month=YYYY-MM` で月別フィルタ。

**認証:** owner/parent

**レスポンス:**
```json
{
  "restDays": [
    { "id": 1, "date": "2026-04-09", "reason": "sick" }
  ]
}
```

#### POST /api/v1/rest-days/[childId]

おやすみ日を登録。

**認証:** owner/parent

**リクエスト:**
```json
{
  "date": "2026-04-09",
  "reason": "rest"
}
```

#### DELETE /api/v1/rest-days/[childId]

おやすみ日を削除。

**認証:** owner/parent

**リクエスト:**
```json
{
  "date": "2026-04-09"
}
```

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

チュートリアル完了をマーク。

**認証:** owner/parent

**リクエスト:**
```json
{
  "completed": true
}
```

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
  "providers": {
    "sentry": { "enabled": true },
    "umami": { "enabled": false },
    "dynamodb": { "enabled": true }
  }
}
```

---

### 3.X ライセンスキー API (#808)

> **SSOT**: [license-key-lifecycle.md §4](./license-key-lifecycle.md#4-api-エンドポイント一覧) を参照。本セクションは要約。

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
- **実装**: `src/lib/server/services/rate-limit-service.ts`

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
  upgradeUrl: '/admin/license';                 // アップグレード導線。固定
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
    "upgradeUrl": "/admin/license"
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
| `POST /admin/rewards ?/grant` | standard | 特別なごほうび (`canCustomReward`, #728) | `createPlanLimitError()` 済 (#787) |
| `POST /admin/rewards ?/addPreset` | standard | 特別なごほうび取り込み (#728) | `createPlanLimitError()` 済 (#787) |
| `POST /api/v1/special-rewards/suggest` | family | AI ごほうび提案 (`tier !== 'family'`, #719) | `apiError()` 済 |
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
    │       ├── 公開ルート（/, /auth/*, /switch, /legal/*, /api/health, /api/stripe/webhook, /ops/*）→ 通過
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
