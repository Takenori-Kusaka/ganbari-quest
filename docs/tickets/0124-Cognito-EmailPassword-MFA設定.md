# 0124 Cognito Email/Password + MFA 設定

### ステータス

`Done`

### メタ情報

| 項目 | 値 |
|------|-----|
| フェーズ | Phase 2: 開発 |
| 難易度 | 高 |
| 優先度 | 最高 |
| 親チケット | #0123 |
| 依存チケット | なし |

---

### 概要

AWS Cognito User Pool を Email/Password + MFA（SMS/Email）で構築する。OAuth プロバイダ（Google/Apple）は使用しない。

### ゴール

- [ ] Cognito User Pool 作成（CDK）
- [ ] Email/Password 認証の有効化
- [ ] MFA 設定（SMS + Email OTP）
- [ ] パスワードポリシー設定（最低8文字、大小英数字+記号）
- [ ] メール検証フロー（サインアップ時の確認コード）
- [ ] カスタム属性追加: `custom:tenantId`, `custom:role`
- [ ] User Pool Client 作成（SRP 認証フロー）
- [ ] ローカル開発用のテスト設定

### 設計

#### Cognito User Pool 設定

```typescript
// CDK 設定
const userPool = new cognito.UserPool(this, 'GanbariQuestUserPool', {
  selfSignUpEnabled: true,
  signInAliases: { email: true },
  autoVerify: { email: true },
  mfa: cognito.Mfa.OPTIONAL,
  mfaSecondFactor: {
    sms: true,
    otp: true, // TOTP (Authenticator app)
  },
  passwordPolicy: {
    minLength: 8,
    requireLowercase: true,
    requireUppercase: true,
    requireDigits: true,
    requireSymbols: false, // ユーザビリティ優先
  },
  accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
  customAttributes: {
    tenantId: new cognito.StringAttribute({ mutable: true }),
    role: new cognito.StringAttribute({ mutable: true }),
  },
});
```

#### カスタム属性

| 属性 | 型 | 用途 |
|------|------|------|
| `custom:tenantId` | string | 所属する家族グループID |
| `custom:role` | string | `owner` / `parent` / `child` |

#### Lambda トリガー

| トリガー | 用途 |
|----------|------|
| Pre Sign-up | ライセンスキー検証 |
| Post Confirmation | テナント作成 or メンバー追加 |
| Pre Token Generation | JWT にカスタムクレーム追加（tenantId, role） |

### 完了条件

1. Cognito User Pool が CDK でデプロイ可能
2. Email/Password でユーザー登録・ログインできる
3. MFA が有効化でき、SMS/Email OTP で認証できる
4. JWT に `tenantId` と `role` が含まれる
5. パスワードリセットフローが動作する

---

### 成果・結果

成果: CDK AuthStack構築済み、Email/Password+MFA対応、JWT検証実装済み
