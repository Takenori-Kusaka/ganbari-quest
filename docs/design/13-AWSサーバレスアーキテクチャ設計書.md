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
| `GanbariQuestOps` | CloudWatch Alarms/Dashboard, SNS, Budgets, Cost Anomaly Detection | Compute, Storage, Network |
| `GanbariQuestSes` | SES Email Identity, Configuration Set, 受信パイプライン (S3 + Lambda) | なし |

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
- イメージ保持: 最新10個（ロールバック用 ~2週間分）
- 未タグイメージ: 1日で自動削除
- GitHub ActionsからCI/CDでpush

### 3.4 OpsStack（監視・コスト防衛）

**SNS 通知基盤:**
- トピック名: `ganbari-quest-ops-alerts`
- サブスクリプション: メール（`-c opsEmail=xxx` で指定）

**CloudWatch Alarms（9/10 無料枠使用）:**

| # | アラーム名 | メトリクス | 閾値 | 優先度 |
|---|----------|-----------|------|--------|
| 1 | Lambda-Errors | Lambda Errors | ≥ 3回/5分 | P0 |
| 2 | Lambda-Throttles | Lambda Throttles | ≥ 1回/5分 | P0 |
| 3 | Lambda-Duration-p99 | Lambda Duration | ≥ 10秒 | P1 |
| 4 | Lambda-Concurrent | ConcurrentExecutions | ≥ 50 | P1 |
| 5 | DynamoDB-Throttles | ThrottledRequests | ≥ 1回/5分 | P1 |
| 6 | DynamoDB-SystemErrors | SystemErrors | ≥ 1回/5分 | P0 |
| 7 | Lambda-URL-5xx | Url5xxCount | ≥ 5回/5分 | P0 |
| 8 | Lambda-URL-4xx-Spike | Url4xxCount | ≥ 50回/5分 | P1 |
| 9 | CloudFront-5xx | 5xxErrorRate | ≥ 5% | P0 |

**CloudWatch Dashboard:** `ganbari-quest-ops`
- Lambda: Invocations/Errors, Duration p50/p99, Throttles/Concurrent
- DynamoDB: Read/Write Capacity Units
- Alarm Status: SingleValueWidget

**AWS Budgets:**
- 月額予算: $5
- 3段階アラート: 実績50%, 実績80%, 予測100%超過

**Cost Anomaly Detection:**
- モニタータイプ: DIMENSIONAL (SERVICE)
- 通知閾値: $1以上の異常

**AWS Health EventBridge:**
- 対象サービス: LAMBDA, DYNAMODB, CLOUDFRONT, COGNITO, S3
- イベントカテゴリ: issue（障害）, scheduledChange（計画メンテ）
- 通知先: SNS Topic（OpsAlerts）

**外部ヘルスチェック Prober（#1121 / #1214）:**

本番の稼働監視は **2 層構成** で行う。どちらか片方で検知できない障害があるため、役割分担を明示する:

| 層 | 実装 | 対象 | 検知できる障害 | 検知できない障害 |
|----|------|------|--------------|----------------|
| L1: アプリ層 | Health Check Lambda (`ganbari-quest-health-check`) → **Lambda Function URL** を 1 時間ごとに GET | Lambda / DynamoDB / アプリケーションコード | 500 / タイムアウト / DynamoDB スロットル | CloudFront 障害 / WAF 誤検知 / DNS 障害 / TLS 証明書期限切れ |
| L2: エッジ層 | （別 Issue で補完予定。CloudWatch Synthetics を JP 許可リージョンで、または UptimeRobot 等を `ganbari-quest.com` 宛に設定） | CloudFront / Route 53 / ACM / geoRestriction | L1 で検知できないエッジ層の失敗 | アプリ層の内部障害（L1 の役割） |

**なぜ L1 が Function URL 直叩きなのか（#1214）**: CloudFront に `geoRestriction('JP')` (`infra/lib/network-stack.ts`) が掛かっているため、us-east-1 の Lambda IP から `https://ganbari-quest.com/api/health` を叩くと常時 403 になる（#1121 導入時の盲点）。Function URL (`authType: NONE`) を直接叩くことで地理制限を迂回し、「L1 = アプリ層の生存確認」という責務に集中させる。Function URL は CloudFront 背後の実体なので公開 URL としては露出しない方針を維持する。

**Lambda 環境変数**:
- `HEALTH_CHECK_URL`: `compute.functionUrl.url`（CDK cross-stack 参照）。末尾スラッシュは Lambda 側で trim するため、何が来ても `/api/health` 連結が破綻しない
- `DISCORD_WEBHOOK_HEALTH`: 通知先 webhook（`-c discordWebhookHealth=...`、未設定時は通知スキップ）

### 3.5 NetworkStack

**CloudFront:**
- デフォルト動作: Lambda Function URL (SSR + API)
  - キャッシュ無効（動的コンテンツ）
  - 全HTTPメソッド許可
- `/_app/*`: SvelteKitの静的アセット
  - 365日キャッシュ（immutable）
  - Gzip + Brotli圧縮
- `/error/*`: S3 エラーページ（OAC経由、Lambda障害時でもS3から配信）
- カスタムエラーレスポンス: 500/502/503/504 → S3の子供向けエラーページ
- Price Class: PriceClass_100（北米+欧州+アジア）
- HTTP/2 + HTTP/3

**メンテナンスモード:**
- Lambda 環境変数 `MAINTENANCE_MODE=true` で切替
- 全リクエスト（`/api/health` 除く）が 503 を返す
- CloudFront が 503 → S3 メンテページ（`/error/503.html`）に差し替え

**Route 53（ドメイン設定時のみ）:**
- ホストゾーン作成
- A/AAAA レコード → CloudFront Alias
- www CNAME → apex ドメイン

**ACM（ドメイン設定時のみ）:**
- ワイルドカード証明書: `*.ganbari-quest.com` + `ganbari-quest.com`
- DNS検証（Route 53自動連携）

### 3.6 SesStack（メール送信・受信基盤）

**SES Email Identity:**
- ドメイン検証: `ganbari-quest.com`（Easy DKIM自動設定）
- Mail-From ドメイン: `mail.ganbari-quest.com`
- 送信元: `noreply@ganbari-quest.com`（アプリ通知用）

**Configuration Set:** `ganbari-quest-config`
- レピュテーション監視有効
- バウンス/リジェクト → SNS Topic `ses-bounce-notifications`
- 苦情 → SNS Topic `ses-complaint-notifications`

**メール受信パイプライン（support@ganbari-quest.com）:**

```
[顧客] → MXレコード → [SES Receipt Rule]
  ├→ S3保存（ganbari-quest-support-mail-{account}/incoming/）
  └→ Lambda（ganbari-quest-ses-receive）
       ├→ Discord通知（お問い合わせ受信チャネル）
       └→ 自動応答メール送信
```

- Route 53 MXレコード → `inbound-smtp.us-east-1.amazonaws.com`
- S3バケット: 暗号化(SSE-S3)、公開アクセスブロック、1年自動削除
- Lambda: Node.js 20, ARM64, 256MB, 30秒タイムアウト, 同時実行上限5
- スパム/ウイルス判定FAIL → スキップ
- 自動応答ループ防止（Auto-Reply/noreply検出）

## 4. デプロイパイプライン

```
[GitHub main branch push / v*.*.* tag push]
    │
    ├── [test] lint + svelte-check + vitest + E2E(local) + E2E(cognito-dev) + build
    │
    ├── [deploy]
    │    ├── バージョン判定（tag → semver / main → dev-<sha>）
    │    ├── AWS OIDC認証
    │    ├── CDK deploy Storage
    │    ├── Docker build (ARM64) → ECR push（sha + version + latest タグ）
    │    ├── CDK deploy all
    │    ├── Lambda 関数イメージ更新 + wait
    │    ├── ヘルスチェック（5回リトライ、失敗時 exit 1）
    │    └── ロールバック（ヘルスチェック失敗時、前イメージに自動復旧）
    │
    ├── [e2e-production] 本番E2Eスモークテスト（Cognito認証）
    │
    ├── [release] ※tag push時のみ: GitHub Release自動生成（リリースノート）
    │
    └── [notify] Discord通知（成功/失敗、バージョン、コミット情報）
```

- 認証: GitHub OIDC → IAM Role（長期キー不要）
- リージョン: us-east-1
- 並行制御: `concurrency` で同時デプロイ防止
- バージョニング: Git tag (`v*.*.*`) でセマンティックバージョン管理、main push は dev ビルド
- 自動更新: Dependabot（GitHub Actions + npm + infra npm の3エコシステム週次更新）

## 5. セキュリティ（WAFなし構成）

| 対策 | 実装 | コスト |
|------|------|--------|
| HTTPS強制 | CloudFront redirect | 無料 |
| セキュリティヘッダ | CloudFront ResponseHeadersPolicy | 無料 |
| Geo制限 | CloudFront（日本のみ、オプション） | 無料 |
| Lambda認可 | Cognito JWT検証 + ロールベース認可 | 無料 |
| DynamoDB制限 | オンデマンド上限設定 | 無料 |
| CloudWatch Alarms | 9アラーム（Lambda/DynamoDB/CloudFront） | 無料枠10個中9個使用 |
| CloudWatch Dashboard | 運用ダッシュボード | 無料枠3個中1個使用 |
| AWS Budgets | $5/月予算・3段階アラート | 無料枠2個中1個使用 |
| Cost Anomaly Detection | ML異常検知 | 完全無料 |

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
│   ├── network-stack.ts  # CloudFront + Route53 + ACM + S3エラーページ
│   ├── ops-stack.ts      # CloudWatch Alarms/Dashboard + Budgets + Cost Anomaly + Health通知
│   └── ses-stack.ts      # SES Email Identity + Configuration Set + メール受信パイプライン
├── error-pages/            # CloudFrontカスタムエラーページHTML（S3にデプロイ）
├── package.json
├── tsconfig.json
└── cdk.json

Dockerfile.lambda        # Lambda Web Adapter用
.github/
├── workflows/
│   ├── ci.yml           # テスト・ビルド（main push / PR）
│   ├── deploy.yml       # AWS デプロイ（test → deploy → e2e → release → notify）
│   └── pages.yml        # GitHub Pages LP デプロイ（site/ 変更時）
├── dependabot.yml       # 依存パッケージ自動更新（Actions + npm + infra）
└── release.yml          # リリースノートカテゴリ設定
```

## 7.1 AI推論基盤（AWS Bedrock）(#721)

### モデル選定

| 項目 | 内容 |
|------|------|
| サービス | Amazon Bedrock (Converse API) |
| モデル | Claude Haiku 4.5 (`us.anthropic.claude-haiku-4-5-20251001-v1:0`) |
| 推論方式 | Cross-region inference profile |
| 構造化出力 | tool_use (function calling) でJSONスキーマ準拠の出力を保証 |
| 認証 | Lambda 実行ロールの IAM ポリシーで `bedrock:InvokeModel` を許可 |

### モデル選定理由

1. **EoLリスク低減**: Gemini のモデルIDは頻繁にEoLとなり追従が運用負荷。Bedrock はマネージドサービスとしてモデルバージョン管理が安定
2. **インフラ統一**: Lambda + DynamoDB + Cognito + S3 の AWS 構成に Bedrock を追加することで、IAM ベースの認証に統一。API キー管理（SSM 等）が不要に
3. **構造化出力の信頼性**: Claude の tool_use で JSON スキーマを定義し、確実に構造化された出力を取得。`extractJson()` のような手動パースが不要
4. **コスト**: 活動提案・レシートOCR は高度な推論不要。Haiku は最安クラスで、tool_use によりリトライ不要（実効コスト同等以下）

### 使用箇所

| サービス | 用途 | Bedrock 機能 |
|---------|------|------------|
| `activity-suggest-service.ts` | 活動名→カテゴリ・アイコン推定 | テキスト + tool_use |
| `receipt-ocr-service.ts` | レシート画像→金額抽出 | 画像入力 + tool_use |
| `image-service.ts` | 画像生成 | **Gemini 維持**（Bedrock に画像生成なし） |

### 環境変数

| 変数 | デフォルト | 説明 |
|------|----------|------|
| `BEDROCK_MODEL_ID` | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | 使用モデルID |
| `BEDROCK_REGION` | `AWS_REGION` or `us-east-1` | Bedrock リージョン |
| `BEDROCK_DISABLED` | (未設定) | `true` でBedrock無効化（フォールバック使用） |

---

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
| 2026-03-27 | OpsStack 追加（監視・アラート・コスト防衛）、ECR lifecycle 更新 |
| 2026-03-27 | 障害対応基盤追加（CloudFrontエラーページ・Health通知・メンテナンスモード） |
| 2026-03-27 | デプロイパイプライン改善（タグトリガー・ヘルスチェック強化・ロールバック・Release/通知・Dependabot） |
| 2026-03-27 | GitHub Pages LP デプロイワークフロー追加 |
| 2026-04-12 | #721 AI推論基盤（AWS Bedrock）セクション追加。モデル選定理由・使用箇所・環境変数を記載 |
