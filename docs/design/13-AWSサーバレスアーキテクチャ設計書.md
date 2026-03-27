# AWSサーバレスアーキテクチャ設計書

## 1. 概要

がんばりクエストのSaaS版を、AWSフルサーバレスアーキテクチャで構築する。
月額無リクエスト時1,000円未満を目標とし、自動スケーリング・高可用性を実現する。

## 2. アーキテクチャ構成図

```
[ユーザー]
    │
    ▼
[CloudFront CDN] ─── キャッシュ ─── [Lambda Function URL (SvelteKit SSR)]
    │                                     │
    │                                     ├── [DynamoDB (メインDB)]
    │                                     ├── [S3 (アバター・バックアップ)]
    │                                     └── [Cognito (認証)]
    │
[Route 53] → CloudFront（独自ドメイン + ACM証明書）
```

## 3. スタック構成（AWS CDK）

| スタック | リソース | 依存 |
|---------|---------|------|
| `GanbariQuestStorage` | DynamoDB テーブル, S3 バケット, ECR リポジトリ | なし |
| `GanbariQuestAuth` | Cognito User Pool, User Pool Client, SSM Parameters | なし |
| `GanbariQuestCompute` | Lambda (Docker), Function URL | Storage, Auth |
| `GanbariQuestNetwork` | CloudFront, Route 53, ACM | Compute |

### 3.1 StorageStack

**DynamoDB: シングルテーブル設計**

| PK | SK | 用途 |
|----|-----|------|
| `TENANT#t1` | `PROFILE` | テナント情報（家族単位） |
| `TENANT#t1#CHILD#c1` | `PROFILE` | 子供プロフィール |
| `TENANT#t1#CHILD#c1` | `ACT#2026-03-06#a1` | 活動記録 |
| `TENANT#t1#CHILD#c1` | `ACHIEVEMENT#ach1` | 実績 |
| `TENANT#t1#CHILD#c1` | `STATUS` | ステータス（レベル等） |
| `TENANT#t1` | `CATEGORY#cat1` | 活動カテゴリ |
| `TENANT#t1` | `ACTIVITY_DEF#ad1` | 活動定義 |
| `TENANT#t1` | `SETTINGS` | アプリ設定 |

**GSI:**
- **GSI1** (SK → PK): 逆引きクエリ用（例: 全テナントの特定SKを検索）
- **GSI2** (GSI2PK → GSI2SK): タイプ別時系列クエリ（例: 日付範囲の活動取得）

**設定:**
- 課金: オンデマンド（従量課金、Free Tier 25 RCU/WCU含む）
- Point-in-Time Recovery: 無効（AWS Backup で日次3日保持に代替）
- 削除保護: RETAIN

**S3バケット:**
- アバター画像: `avatars/{tenantId}/{childId}/`
- バックアップ: `backups/{date}/` （30日で自動削除）
- パブリックアクセス: 完全ブロック

### 3.2 AuthStack

**Cognito User Pool:**
- プール名: `ganbari-quest-users`
- サインイン: Email + Password
- MFA: OPTIONAL（TOTP 対応）
- パスワードポリシー: 8文字以上、大小英字+数字必須
- Email 自動検証（確認コード方式）
- カスタム属性: `tenantId`, `role`
- アカウント回復: Email のみ
- 削除保護: RETAIN

**User Pool Client:**
- クライアント名: `ganbari-quest-public`
- クライアントシークレット: なし（パブリッククライアント）
- 認証フロー: USER_PASSWORD_AUTH, USER_SRP_AUTH
- アクセストークン有効期限: 1時間
- ID トークン有効期限: 1時間
- リフレッシュトークン有効期限: 30日

**SSM Parameters（スタック間連携用）:**
- `/ganbari-quest/cognito/user-pool-id`
- `/ganbari-quest/cognito/client-id`

### 3.3 ComputeStack

**Lambda:**
- ランタイム: Docker (Node.js 22 + Lambda Web Adapter)
- メモリ: 512MB
- タイムアウト: 30秒
- アーキテクチャ: ARM64 (Graviton2、コスト20%削減)
- Function URL: RESPONSE_STREAM モード（SSR対応）

**Lambda Web Adapter:**
- AWS公式のWeb Adapterを使用
- SvelteKitのadapter-nodeをそのまま利用
- Lambda events → HTTP変換を透過的に処理
- Cold start: ~500ms（許容範囲）

**ECRリポジトリ:**
- イメージ保持: 最新5つ
- GitHub ActionsからCI/CDでpush

### 3.3 NetworkStack

**CloudFront:**
- デフォルト動作: Lambda Function URL (SSR + API)
  - キャッシュ無効（動的コンテンツ）
  - 全HTTPメソッド許可
- `/_app/*`: SvelteKitの静的アセット
  - 365日キャッシュ（immutable）
  - Gzip + Brotli圧縮
- Price Class: PriceClass_100（北米+欧州+アジア）
- HTTP/2 + HTTP/3

**Route 53（ドメイン設定時のみ）:**
- ホストゾーン作成
- A/AAAA レコード → CloudFront Alias
- www CNAME → apex ドメイン

**ACM（ドメイン設定時のみ）:**
- ワイルドカード証明書: `*.ganbari-quest.com` + `ganbari-quest.com`
- DNS検証（Route 53自動連携）

## 4. デプロイパイプライン

```
[GitHub main branch push]
    │
    ├── [CI: lint + test + build]
    │
    └── [Deploy]
         ├── AWS OIDC認証
         ├── ECR ログイン
         ├── CDK deploy (インフラ)
         ├── Docker build → ECR push
         └── Lambda関数イメージ更新
```

- 認証: GitHub OIDC → IAM Role（長期キー不要）
- リージョン: us-east-1
- 並行制御: `concurrency` で同時デプロイ防止

## 5. セキュリティ（WAFなし構成）

| 対策 | 実装 | コスト |
|------|------|--------|
| HTTPS強制 | CloudFront redirect | 無料 |
| セキュリティヘッダ | CloudFront ResponseHeadersPolicy | 無料 |
| Geo制限 | CloudFront（日本のみ、オプション） | 無料 |
| Lambda認可 | Cognito JWT検証 + ロールベース認可 | 無料 |
| DynamoDB制限 | オンデマンド上限設定 | 無料 |
| CloudWatch | Lambda実行数の異常アラート | 最小構成 |

## 6. コスト試算（月額）

| 項目 | 無リクエスト時 | 100家庭 | 1,000家庭 |
|------|-------------|---------|----------|
| Route 53 | $0.50 | $0.50 | $0.50 |
| CloudFront | $0 | $0 | ~$0.10 |
| Lambda | $0 | $0 | ~$0.05 |
| DynamoDB | $0 | $0 | ~$0.03 |
| S3 | $0 | $0 | ~$0.01 |
| ECR | $0 | $0 | ~$0.01 |
| ACM | $0 | $0 | $0 |
| **合計** | **~$0.50（≈75円）** | **~$0.50** | **~$0.70** |

ドメイン費用（年額÷12 = ~117円/月）を加えて、実質月額 **~192円〜222円**。

## 7. ファイル構成

```
infra/
├── bin/app.ts           # CDKエントリポイント
├── lib/
│   ├── storage-stack.ts  # DynamoDB + S3 + ECR + AWS Backup
│   ├── auth-stack.ts     # Cognito User Pool + SSM Parameters
│   ├── compute-stack.ts  # Lambda + Function URL
│   └── network-stack.ts  # CloudFront + Route53 + ACM
├── package.json
├── tsconfig.json
└── cdk.json

Dockerfile.lambda        # Lambda Web Adapter用
.github/workflows/
├── ci.yml               # テスト・ビルド
└── deploy.yml           # AWS デプロイ（Storage CDK → Docker/ECR → CDK all → Lambda update）
```

## 8. 完了済み移行

### Phase 1: インフラ構築 ✅
- CDKプロジェクト作成・初回デプロイ
- GitHub ActionsデプロイパイプライN
- Lambda Dockerfile + Lambda Web Adapter
- ドメイン取得 + Route 53 + CloudFront + ACM

### Phase 2: データ層移行 ✅
- SQLite / DynamoDB デュアルバックエンド構成
- リポジトリインターフェース抽象化（17ファイル）
- テナント分離（全層に tenantId 必須化）

### Phase 3: 認証統合 ✅
- Cognito User Pool 設定（AuthStack）
- 二層認証（Identity JWT + Context Token）
- ロールベース認可（owner/parent/child）
- レートリミッター
- 招待システム + マルチテナント

---

## 9. 更新履歴

| 日付 | 内容 |
|------|------|
| 2026-02-19 | 初版作成 |
| 2026-03-27 | AuthStack 追加、Cognito 認証統合反映、移行計画を完了済みに更新 |
