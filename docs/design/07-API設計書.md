# がんばりクエスト API設計書

| 項目 | 内容 |
|------|------|
| 版数 | 1.0 |
| 作成日 | 2026-02-19 |
| 作成者 | 日下武紀 |

---

## 1. API設計方針

- **SvelteKit ファイルシステムルーティング**: `src/routes/api/v1/**/+server.ts` で定義
- **JSON API**: リクエスト・レスポンスは全てJSON
- **Zodバリデーション**: 全エンドポイントでリクエストボディをZodでバリデーション
- **一貫したエラーレスポンス**: `{ error: { code: string, message: string } }` 形式
- **認証**: `(parent)` グループのみ hooks.server.ts でPIN認証チェック

---

## 2. エンドポイント一覧

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| GET | /api/v1/children | 子供一覧取得 | 不要 |
| GET | /api/v1/children/[id] | 子供詳細取得 | 不要 |
| GET | /api/v1/activities | 活動一覧取得 | 不要 |
| POST | /api/v1/activities | 活動追加 | PIN |
| PATCH | /api/v1/activities/[id] | 活動更新 | PIN |
| GET | /api/v1/activity-logs | 活動ログ取得 | 不要 |
| POST | /api/v1/activity-logs | 活動記録 | 不要 |
| DELETE | /api/v1/activity-logs/[id] | 活動記録キャンセル | 不要 |
| GET | /api/v1/points/[childId] | ポイント残高取得 | 不要 |
| GET | /api/v1/points/[childId]/history | ポイント履歴取得 | 不要 |
| POST | /api/v1/points/convert | ポイント変換 | PIN |
| GET | /api/v1/status/[childId] | ステータス取得 | 不要 |
| GET | /api/v1/evaluations/[childId] | 評価履歴取得 | 不要 |
| POST | /api/v1/auth/pin/verify | PIN認証 | 不要 |
| POST | /api/v1/auth/pin/setup | PIN初期設定 | 不要(初回のみ) |
| PATCH | /api/v1/activities/[id]/visibility | 活動表示/非表示切替 | PIN |
| GET | /api/health | ヘルスチェック | 不要 |

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
  "points": 5,
  "recordedAt": "2026-02-19T18:30:00Z",
  "cancelableUntil": "2026-02-19T18:30:05Z"
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

### 3.6 認証関連

#### POST /api/v1/auth/pin/verify

PIN認証を行う。

**リクエストボディ:**
```json
{
  "pin": "1234"
}
```

**レスポンス (200):**
```json
{
  "authenticated": true,
  "expiresAt": "2026-02-19T19:30:00Z"
}
```

**エラー (401):**
```json
{
  "error": {
    "code": "INVALID_PIN",
    "message": "PINがちがいます",
    "remainingAttempts": 3
  }
}
```

**エラー (429):**
```json
{
  "error": {
    "code": "LOCKED_OUT",
    "message": "5分間ロックされています",
    "unlocksAt": "2026-02-19T18:35:00Z"
  }
}
```

### 3.7 ヘルスチェック

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
| INSUFFICIENT_POINTS | 400 | ポイント残高不足 |
| INVALID_PIN | 401 | PIN不一致 |
| UNAUTHORIZED | 401 | 認証が必要 |
| LOCKED_OUT | 429 | ロックアウト中 |
| NOT_FOUND | 404 | リソースが見つからない |
| INTERNAL_ERROR | 500 | サーバー内部エラー |

---

## 5. 認証フロー

### hooks.server.ts の処理

```
リクエスト受信
    │
    ├── /api/v1/auth/* → 認証チェック不要、そのまま通過
    ├── /api/v1/* (GET) → 認証チェック不要
    ├── /(child)/* → 認証チェック不要
    ├── /(parent)/* → セッションCookie検証
    │       ├── 有効 → event.locals.authenticated = true → 通過
    │       └── 無効 → /admin/login にリダイレクト
    └── POST/PATCH/DELETE で PIN認証が必要なエンドポイント
            ├── セッション有効 → 通過
            └── セッション無効 → 401 Unauthorized
```

### セッション管理

| 項目 | 仕様 |
|------|------|
| Cookie名 | `ganbari_session` |
| 有効期限 | 30分（操作ごとに延長） |
| 属性 | HTTP-only, SameSite=Strict, Path=/ |
| 値 | ランダムトークン（crypto.randomUUID()） |
| サーバー保存 | settings テーブルにトークンと有効期限を保存 |
