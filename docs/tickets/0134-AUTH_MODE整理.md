# 0134 AUTH_MODE 整理（local認証なし / cognito）

### ステータス

`Done`

### メタ情報

| 項目 | 値 |
|------|-----|
| フェーズ | Phase 2: 開発 |
| 難易度 | 中 |
| 優先度 | 高 |
| 親チケット | #0123 |
| 依存チケット | #0126（ログインフロー） |

---

### 概要

AUTH_MODE 環境変数で認証・テナントの動作を切り替える仕組みを整理する。既存の PIN 認証を廃止し、local モード（認証なし）と cognito モード（Email/Password + MFA）の2モードに統一する。

### AUTH_MODE 定義

| AUTH_MODE | 認証 | テナント | DB | 想定環境 |
|-----------|------|---------|-----|---------|
| `local` | なし（全ルート許可） | 単一（tenantId='local'） | SQLite | NUC, Docker, LAN内 |
| `cognito` | Email/Password + MFA | マルチテナント | DynamoDB | AWS Lambda, インターネット公開 |

### local モード（AUTH_MODE=local）

```
- ログイン画面なし
- アクセス時に即座に管理画面/子供画面を表示
- Identity: { type: 'local' }（常に認証済み扱い）
- Context: { tenantId: 'local', role: 'owner', licenseStatus: 'none' }
- 現行の PIN 認証は廃止（LAN 内アクセス制限で十分）
- SQLite を使用（既存のまま）
```

### cognito モード（AUTH_MODE=cognito）

```
- Cognito Email/Password + MFA
- Identity: { type: 'cognito', userId, email }
- Context: { tenantId, role, licenseStatus }
- DynamoDB を使用
- テナント分離あり
```

### 変更対象

#### 1. hooks.server.ts

```typescript
const provider = createAuthProvider();

export const handle: Handle = async ({ event, resolve }) => {
  const identity = await provider.resolveIdentity(event);
  const context = await provider.resolveContext(event, identity);

  event.locals.authenticated = identity !== null && identity.type !== 'anonymous';
  event.locals.identity = identity;
  event.locals.context = context;

  const authResult = provider.authorize(event.url.pathname, identity, context);
  if (!authResult.allowed) redirect(302, authResult.redirect);

  return resolve(event);
};
```

#### 2. AuthProvider ファクトリ

```typescript
export function createAuthProvider(): AuthProvider {
  const mode = (process.env.AUTH_MODE ?? 'local') as AuthMode;
  switch (mode) {
    case 'local': return new LocalAuthProvider();
    case 'cognito': return new CognitoAuthProvider();
    default: throw new Error(`Unknown AUTH_MODE: ${mode}`);
  }
}
```

#### 3. LocalAuthProvider（PIN 認証廃止後）

```typescript
class LocalAuthProvider implements AuthProvider {
  async resolveIdentity(): Promise<Identity> {
    return { type: 'local' }; // 常に認証済み
  }

  async resolveContext(): Promise<AuthContext> {
    return {
      tenantId: 'local',
      role: 'owner',
      licenseStatus: 'none',
    };
  }

  authorize(path: string): AuthResult {
    return { allowed: true }; // 全ルート許可
  }
}
```

#### 4. 廃止するもの

- PIN 認証（/login の PIN 入力画面）
- sessionToken Cookie
- auth-service.ts の PIN 関連ロジック（hashPin, verifyPin, createSession 等）
- settings DB の session 関連カラム

### マイグレーション手順

```
1. AUTH_MODE=local を新設（PIN 認証の代替）
2. LocalAuthProvider を実装（全ルート許可）
3. 既存の hooks.server.ts を Provider 委譲に書き換え
4. 全既存テストが通ることを確認
5. PIN 認証関連コードを削除
6. /login ルートを /auth/login に移動（cognito 用）
7. local モードでは /login を非表示に
```

### ゴール

- [x] AUTH_MODE 環境変数の導入（デフォルト: local）
- [x] AuthProvider インターフェース実装
- [x] LocalAuthProvider 実装（認証なし、全ルート許可）
- [x] CognitoAuthProvider スケルトン実装
- [x] hooks.server.ts を Provider 委譲に書き換え
- [x] PIN 認証の廃止（auth-service.ts のPIN関連ロジック削除）
- [x] /login → /auth/login へのルート移行
- [x] app.d.ts の Locals 拡張（identity, context）
- [x] 既存テスト全通過の確認
- [x] NUC デプロイで local モード動作確認

### 完了条件

1. AUTH_MODE=local で NUC が認証なしで動作する（現行同等の UX）
2. AUTH_MODE=cognito で Cognito 認証が動作する
3. PIN 認証のコードが完全に削除されている
4. 既存の E2E テストが全通過する
5. hooks.server.ts が AuthProvider 経由で認証を処理する

---

### 成果・結果

- AUTH_MODE整理 — PIN廃止・viewer/device削除・型統一。コミット: 4e265f1
