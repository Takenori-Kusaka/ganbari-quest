# #0137 Cognito本番認証切替（COGNITO_DEV_MODE=false）

## Status: Done


### 概要

COGNITO_DEV_MODE=true（ダミーユーザー）から本番Cognito認証に切り替える。
ユーザー登録・メール認証・MFAチャレンジ・初回ログイン自動プロビジョニングを実装。

### 背景・動機

#0124 で Cognito User Pool を作成し、Dev Mode で動作確認済み。
SaaS展開に向け、実際の Cognito Email/Password + MFA 認証に切り替える。

### ゴール

- [x] 初回ログイン時の自動プロビジョニング（AuthUser + Tenant + Membership を DynamoDB に自動作成）
- [x] サインアップフロー（/auth/signup）— Email/Password 登録 + メール認証
- [x] MFA チャレンジ対応（TOTP コード入力 UI + RespondToAuthChallenge）
- [x] MFA セットアップ（/auth/mfa-setup）— QR コード表示 + TOTP 検証
- [x] COGNITO_DEV_MODE=false への切替 + CDK デプロイ
- [x] 初期オーナーユーザー作成手順書
- [x] 全テスト合格（vitest + playwright）

### 作業メモ

-

### 成果・結果

- Cognito本番認証の実装 — サインアップ・MFA・自動プロビジョニング。コミット: d190da5, 1ea88f0, d68c5a7, ceee199

### 残課題・次のアクション

- Google OAuth (Social Login) — 別チケット
- Stripe ライセンス管理 — 別チケット
