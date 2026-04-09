# 0008. Cognito + Google OAuth 認証

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-02-25 |
| 起票者 | 日下武紀 |

## コンテキスト

SaaS 版の認証基盤を選定。LAN 版は PIN コードのみだが、SaaS 版は安全なユーザー認証が必要。子育て世代がターゲットのため、ソーシャルログインの利便性が重要。

## 検討した選択肢

### 選択肢 A: Auth0
- メリット: 機能豊富、ソーシャルログイン簡単
- デメリット: 有料（無料枠 7,000 MAU）、外部サービス依存

### 選択肢 B: Amazon Cognito
- メリット: AWS 統合、無料枠 50,000 MAU、Google OAuth 標準サポート
- デメリット: UI カスタマイズが難しい（Hosted UI）

### 選択肢 C: 自前実装 (passport.js 等)
- メリット: 完全な制御
- デメリット: セキュリティリスク、メンテナンスコスト

## 決定

Amazon Cognito User Pool + Google OAuth を採用。理由:
- 50,000 MAU 無料は個人開発 SaaS に十分
- AWS CDK でインフラ管理が完結
- Google アカウントでのソーシャルログインで子育て世代の導入障壁を下げる

## 結果

- Hosted UI は使わず、カスタム UI + Cognito SDK で実装
- Google Sign-In ボタンは公式ブランドガイドライン準拠（ADR なし、CLAUDE.md に記載）
- LAN 版は PIN 認証のまま（Cognito 不使用）
