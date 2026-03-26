# 0123 認証方式見直し — Email/Password 追加・Apple 除外

### ステータス

`Done`

### メタ情報

| 項目 | 値 |
|------|-----|
| フェーズ | Phase 2: 開発 |
| 難易度 | 中 |
| 優先度 | 最高（他の全チケットの前提） |
| 親チケット | #0066 |
| 依存チケット | なし |

---

### 概要

#0066 の認証方式を以下のように修正する:

- **Apple Sign-In を除外**（Apple Developer Program 未加入のため）
- **Cognito ネイティブ Email/Password 認証を追加**（外部依存なし）
- **Google OAuth はオプション**（GCP 設定後に有効化）

### 背景・動機

- Google OAuth は GCP Console での OAuth クライアント設定が必要
- Apple Sign-In は Apple Developer Program ($99/年) への加入が必要
- Cognito Email/Password は外部設定なしで即座に動作する
- E2E テストでも実 Google アカウント不要で自動化可能

### ゴール

- [ ] CDK AuthStack を修正: selfSignUp 有効化、Email/Password 認証を主軸に
- [ ] Cognito Hosted UI で Email/Password サインイン表示
- [ ] パスワードポリシー設定（8文字以上、大文字小文字数字）
- [ ] メール検証フロー有効化（確認コード送信）
- [ ] Google IdP は環境変数が設定済みの場合のみ有効化（現行通り）
- [ ] Apple IdP 関連のコード・設定があれば削除
- [ ] CDK デプロイして Cognito User Pool が更新されることを確認

### 対応方針

**CDK AuthStack の変更点:**

```typescript
// 変更前
selfSignUpEnabled: false,  // OAuth のみ

// 変更後
selfSignUpEnabled: true,   // Email/Password サインアップを許可
autoVerify: { email: true },
userVerification: {
  emailSubject: 'がんばりクエスト — メール確認コード',
  emailBody: '確認コード: {####}',
  emailStyle: VerificationEmailStyle.CODE,
},
```

**Google IdP の条件付き有効化（現行のまま）:**
- `googleClientId` と `googleClientSecret` が CDK context で渡された場合のみ有効化
- 未設定時は Email/Password のみで動作

### 完了条件

1. `npx cdk deploy` で Cognito User Pool が更新される
2. Cognito Hosted UI にアクセスすると Email/Password 入力フォームが表示される
3. テストユーザーを手動で作成してログインできる
4. 全既存テスト（vitest + playwright）が通過する

---

### 成果・結果

成果: #0124でCognito Email/Password認証を実装、#0137で本番切替完了
