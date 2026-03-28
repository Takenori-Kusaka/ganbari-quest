# がんばりクエスト API設計書

| 項目 | 内容 |
|------|------|
| 版数 | 2.0 |
| 作成日 | 2026-02-19 |
| 更新日 | 2026-03-27 |
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

### 特別報酬

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| GET | /api/v1/special-rewards/[childId] | 子供の特別報酬一覧 | 全ロール |
| POST | /api/v1/special-rewards/[childId] | 特別報酬作成 | owner/parent |
| POST | /api/v1/special-rewards/[rewardId]/shown | 報酬表示済みマーク | 全ロール |
| GET | /api/v1/special-rewards/templates | 報酬テンプレート一覧 | owner/parent |
| PUT | /api/v1/special-rewards/templates | 報酬テンプレート更新 | owner/parent |

### キャリアプラン

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| GET | /api/v1/career-fields | キャリア分野一覧取得 | 全ロール |
| GET | /api/v1/career-plans/[childId] | キャリアプラン取得 | 全ロール |
| POST | /api/v1/career-plans/[childId] | キャリアプラン作成 | owner/parent |
| PUT | /api/v1/career-plans/[childId] | キャリアプラン更新 | owner/parent |

### 画像・エクスポート

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| GET | /api/v1/images | 画像取得（S3 プロキシ） | 全ロール |
| POST | /api/v1/images | 画像アップロード | owner/parent |
| GET | /api/v1/export | データエクスポート（JSON） | owner/parent |
| POST | /api/v1/import | データインポート（JSON） | owner/parent |
| GET | /uploads/avatars/[filename] | アバター画像配信 | 不要 |

### 管理系 API

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| GET | /api/v1/admin/invites | 招待一覧取得 | owner/parent |
| POST | /api/v1/admin/invites | 招待リンク作成 | owner/parent |
| DELETE | /api/v1/admin/invites/[code] | 招待リンク取消 | owner/parent |
| GET | /api/v1/admin/license | ライセンス情報取得 | owner/parent |

### Stripe（決済）

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| POST | /api/stripe/checkout | Stripe Checkout セッション作成 | owner/parent |
| POST | /api/stripe/portal | Stripe カスタマーポータル作成 | owner/parent |
| POST | /api/stripe/webhook | Stripe Webhook 受信 | 不要（Stripe署名検証） |

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

### 3.10 キャリアプラン関連

#### GET /api/v1/career-fields

キャリア分野の一覧を取得する。

**クエリパラメータ:**

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| ageGroup | string | いいえ | "child" / "teen" / "adult" |

#### GET /api/v1/career-plans/[childId]

子供のキャリアプランを取得する。

#### POST /api/v1/career-plans/[childId]

キャリアプランを新規作成する。

#### PUT /api/v1/career-plans/[childId]

キャリアプランを更新する。

### 3.11 画像・エクスポート

#### GET /api/v1/images

S3 からの画像取得プロキシ。`key` クエリパラメータで対象を指定。

#### POST /api/v1/images

画像をアップロードする（S3 へ保存）。

#### GET /api/v1/export

家族データをJSON形式でエクスポートする。子供プロフィール・活動記録・ポイント・ステータス・実績等の全データを含む。

**クエリパラメータ:**

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| childIds | string | いいえ | カンマ区切りの子供ID（省略時は全子供） |

**レスポンス:** JSON ファイル（Content-Disposition: attachment）

#### POST /api/v1/import

エクスポートしたJSONデータをインポートする。

**クエリパラメータ:**

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| mode | string | いいえ | "preview"（プレビュー）または "execute"（実行）。デフォルト: preview |

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

#### POST /api/v1/points/ocr-receipt

レシート画像を OCR で読み取り、金額を抽出する。

### 3.12 管理系 API

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

### 3.13 Stripe（決済）

#### POST /api/stripe/checkout

Stripe Checkout セッションを作成し、リダイレクト URL を返す。

#### POST /api/stripe/portal

Stripe カスタマーポータルの URL を作成して返す。

#### POST /api/stripe/webhook

Stripe からの Webhook イベントを受信する。Stripe 署名ヘッダ（`stripe-signature`）で検証。

### 3.14 活動ピン留め

#### POST /api/v1/children/[id]/activities/[activityId]/pin

活動をピン留めする（ホーム画面の先頭に表示）。

#### DELETE /api/v1/children/[id]/activities/[activityId]/pin

活動のピン留めを解除する。

### 3.15 活動サジェスト

#### POST /api/v1/activities/suggest

テキスト入力から活動名・カテゴリを AI で推定する。

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

### 3.16 ヘルスチェック

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
| ALREADY_CLAIMED | 409 | ログインボーナス受取済み |
| INSUFFICIENT_POINTS | 400 | ポイント残高不足 |
| INVALID_PIN | 401 | PIN不一致 |
| UNAUTHORIZED | 401 | 認証が必要 |
| LOCKED_OUT | 429 | ロックアウト中 |
| NOT_FOUND | 404 | リソースが見つからない |
| INTERNAL_ERROR | 500 | サーバー内部エラー |

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
    │       ├── 公開ルート（/, /auth/*, /switch, /legal/*, /api/health, /api/stripe/webhook）→ 通過
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
