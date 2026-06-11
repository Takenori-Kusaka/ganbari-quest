# AWSサーバレスアーキテクチャ設計書

## 1. 概要

がんばりクエストのSaaS版を、AWSフルサーバレスアーキテクチャで構築する。
月額無リクエスト時1,000円未満を目標とし、自動スケーリング・高可用性を実現する。

## 2. アーキテクチャ構成図

```
[ユーザー (本番)]                              [ユーザー (デモ — anonymous)]
    │                                                │
    ▼                                                ▼
[CloudFront CDN (prod)] ── [Lambda (SvelteKitFn)]   [CloudFront CDN (demo)] ── [Lambda (SvelteKitDemoFn)]
    │                            │                       │                              │
    │                            ├── DynamoDB           │                              └── (CloudWatch Logs のみ、本番リソースアクセスなし)
    │                            ├── S3                 │
    │                            ├── Cognito           │
    │                            ├── Secrets Manager  │
    │                            └── SES              │
    │                                                   │
[Route 53] ─ ganbari-quest.com                [Route 53] ─ demo.ganbari-quest.com
```

**Multi-Lambda Demo トポロジ (ADR-0048 / #2097 week 4)**:
- 本番と demo は**完全に独立した CloudFront Distribution + Lambda Function + IAM Role**
- 同じ ECR Docker image を共有 (`DATA_SOURCE` / `AUTH_MODE` 環境変数で動作切替)
- demo Lambda の IAM Role は CloudWatch Logs write 権限のみ — DynamoDB / Cognito / Secrets Manager / SES へのアクセス権限を一切持たない (blast radius 最小化)
- 詳細は §3.7 (DemoStack コンポーネント) 参照

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

**Lambda (SvelteKitFn):**
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

**Lambda (CronDispatcherFn) (#1376):**
- 関数名: `ganbari-quest-cron-dispatcher`
- ランタイム: NodejsFunction (Node.js 20, esbuild バンドル)
- メモリ: 128MB
- タイムアウト: 5分
- アーキテクチャ: ARM64 (Graviton2)
- 役割: EventBridge ペイロードを HTTP POST に変換して SvelteKit `/api/cron/:job` を呼び出す
  - LWA は HTTP イベントのみ処理するため、EventBridge → Lambda Web Adapter の直接接続は不可
- 環境変数: `FUNCTION_URL` (SvelteKitFn の Function URL), `CRON_SECRET` または `OPS_SECRET_KEY` (#1586)
  - dispatcher 側は `CRON_SECRET ?? OPS_SECRET_KEY` の順で fallback 参照する
  - CDK は両方 inject、最低 1 本必須 (compute-stack.ts L218-235 で synth-time に throw)
  - `dryRun: true` payload で env 注入確認のみ実行可 (副作用なし、smoke test 用)
- 実装: `infra/lambda/cron-dispatcher/index.ts`

**Cron ジョブ一覧 (#1376):**

スケジュール SSOT は `src/lib/server/cron/schedule-registry.ts`。本表は registry の全 8 ジョブと 1:1 で対応する。
「EventBridge」列は AWS 本番でジョブを駆動する EventBridge Rule (`infra/lib/compute-stack.ts` の `CRON_JOBS`) の有無、
「dispatcher」列は cron-dispatcher Lambda の `KNOWN_ENDPOINTS` (`infra/lambda/cron-dispatcher/index.ts`) への登録有無を示す。
NUC セルフホスト版は AWS を経由せず `scripts/scheduler.ts` が registry 全 8 ジョブを node-cron で直接駆動するため、
EventBridge / dispatcher 未登録のジョブも NUC では起動する。

| ジョブ (registry name) | スケジュール (UTC) | JST 換算 | EventBridge | dispatcher | 概要 |
|---------|-----------------|---------|:-:|:-:|----------|
| retention-cleanup | `cron(0 16 * * ? *)` | 毎日 01:00 | ✓ | ✓ | 保存期間超過データの自動削除バッチ (#717 / #729) |
| trial-notifications | `cron(0 0 * * ? *)` | 毎日 09:00 | ✓ | ✓ | トライアル終了通知バッチ (#737) |
| age-recalc | `cron(0 15 * * ? *)` | 毎日 00:00 | ✗ | ✗ | 子供の年齢自動インクリメント (#1381)。**AWS EventBridge / dispatcher 未登録のため AWS 本番では未駆動、現状は NUC scheduler のみで起動** (`schedule-consistency.test.ts` で既知 drift として明示) |
| lifecycle-emails | `cron(30 0 * * ? *)` | 毎日 09:30 | ✓ | ✓ | 期限切れ前リマインド + 休眠復帰メール (#1601, ADR-0023 §5 I11) |
| grace-period-deletion | `cron(0 17 * * ? *)` | 毎日 02:00 | ✗ | ✓ | グレースピリオド期限切れテナントの物理削除バッチ (#1648 R43, `grace-period-service.ts`)。**dispatcher には登録済だが AWS EventBridge Rule 未作成のため AWS 本番では未駆動、現状は NUC scheduler のみで起動** |
| pmf-survey | `cron(0 0 1 6,12 ? *)` | 6/1・12/1 09:00 | ✓ | ✓ | PMF 判定アンケート (Sean Ellis Test) 年 2 回配信 (#1598, ADR-0023 §5 I7) |
| analytics-aggregator-daily | `cron(0 18 * * ? *)` | 毎日 03:00 | ✓ | ✓ | 前日分 funnel + cancellation 事前集計バッチ (#1693, #1639 follow-up) |
| challenge-aggregator-daily | `cron(30 18 * * ? *)` | 毎日 03:30 | ✓ | ✓ | 当日分の全テナント `questionnaire_challenges` スナップショット集計、`/ops/analytics` プリセット分布画面の N+1 移行用 (#1742, #1602) |

- ターゲット: AWS では `ganbari-quest-cron-dispatcher` Lambda (JSON payload `{ cronJob: "<job-name>" }`) が EventBridge から起動され `/api/cron/:job` を HTTP POST する
- AWS EventBridge Rule 名は `ganbari-quest-cron-<job-name>` (例: `ganbari-quest-cron-retention-cleanup`)
- `ganbari-quest-cron-license-expire` は license key 全廃 (#2822 / Epic #2525 Phase 7 PR-L3) で撤去済。期限管理は Stripe `customer.subscription.deleted` webhook に代替
- `lifecycle-emails` (#1601, ADR-0023 §5 I11): 親オーナー宛のみ送信。年 6 回マーケティングメール上限を遵守。List-Unsubscribe ヘッダ + 配信停止リンク必須。Anti-engagement 整合 (中立トーン)。
- **registry 外の endpoint**: `/api/cron/expire-redemptions` (#1337, 30 日以上 pending の交換申請を expired に移行) は endpoint として存在するが registry / EventBridge / dispatcher いずれにも未登録のため、自動スケジュール駆動はされない (手動 / 外部呼び出し前提)
- **検証手順 / runbook**: [`docs/runbooks/cron-3-endpoints-verification.md`](../runbooks/cron-3-endpoints-verification.md) (#1377 Sub A-3)
- **認証ヘッダ**: dispatcher は `Authorization: Bearer <CRON_SECRET>` を送信。endpoint 側は `verifyCronAuth` (`src/lib/server/auth/cron-auth.ts`) で `Authorization: Bearer` と `x-cron-secret` の両ヘッダを受理する (#1377 で統一、NUC scheduler / AWS dispatcher 双方互換)
- **Sub A-3 検証層** (#1377): `tests/unit/cron/schedule-consistency.test.ts` が registry / CDK / dispatcher の整合性を検証する。Sub A-3 対象 endpoint (retention-cleanup / trial-notifications) は 0 tolerance で厳密検証する一方、`age-recalc` は EventBridge / dispatcher 未反映の既知 drift として `KNOWN_DRIFT_OUT_OF_SCOPE` で除外している (上表「✗」と整合)。`scripts/check-cron-observability.mjs` (`npm run check:cron-observability`) が logger / Alarm 定義の存在を静的検査する

### 3.4 OpsStack（監視・コスト防衛）

**SNS 通知基盤:**
- トピック名: `ganbari-quest-ops-alerts`
- サブスクリプション: メール（`-c opsEmail=xxx` で指定）

**CloudWatch Alarms（10/10 無料枠使用）:**

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
| 10 | **CronDispatcherErrors** (#1376) | CronDispatcherFn Errors | ≥ 1回/5分 | P0 |

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

### 3.7 Multi-Lambda Demo Deployment (ADR-0048 / #2097 week 4)

#### 設計背景

過去 8 回の demo/prod UI 統一試行が shim ベースのアプローチで全て regression していた (feedback_demo_prod_ui_unification_blocker.md)。9 回目として、UI レイヤーではなく**インフラレイヤーで分離する** multi-Lambda 構成を採用する。

| 課題 | 解決方針 |
|------|---------|
| shim による UI 分岐が複雑化 | DATA_SOURCE 環境変数 1 つで全ファイル切替 (PR #2120 で 34 demo Repository + AnonymousAuthProvider 完備) |
| デモが本番 DynamoDB を汚染するリスク | IAM Role を物理分離 — demo Fn は本番リソースに**アクセス権限が無い** |
| 1 人運用でセキュリティインシデント対応不可 | demo URL が本番 secret を返す事故を IAM レイヤーで構造的に不可能にする |
| demo 用のサブセット機能維持コスト | demo は**本番と機能 100% 同等**。差は AUTH (anonymous) + DATA (in-memory fixture) のみ |

#### ComputeStack 追加リソース

**Lambda (SvelteKitDemoFn):**
- 関数名: `ganbari-quest-app-demo`
- ランタイム: Docker (`Dockerfile.lambda` を本番 Fn と共有)
- メモリ: 256MB (本番 512MB の半分、anonymous + stateless fixture で十分)
- タイムアウト: 30 秒
- アーキテクチャ: ARM64
- Function URL: `authType: NONE`, `invokeMode: BUFFERED` (本番と同一)
- Provisioned Concurrency: **未採用** (AWS アカウント Lambda concurrent execution quota 不足 + 予算制約、PO 判断 2026-05-15)。cold start ~1-2s で運用。Quota 増額後に `lambda.Alias` + `provisionedConcurrentExecutions: 1` 追加で +$2.74/月

**環境変数 (本番との差分):**

| キー | 本番 Fn | demo Fn | 用途 |
|------|--------|--------|------|
| `DATA_SOURCE` | `dynamodb` | `demo` | PR #2120 demo Repository / Auth Provider 起動 trigger |
| `AUTH_MODE` | `cognito` | `anonymous` | AnonymousAuthProvider 起動 |
| `ORIGIN` | `https://ganbari-quest.com` | `https://demo.ganbari-quest.com` | absolute URL 解決 |
| `DYNAMODB_TABLE` / `TABLE_NAME` | (注入) | **未注入** | demo は in-memory fixture |
| `COGNITO_*` / `CONTEXT_TOKEN_SECRET` | (注入) | **未注入** | demo は anonymous |
| `STRIPE_*` / `GEMINI_API_KEY` / `AWS_LICENSE_SECRET` | (注入) | **未注入** | demo は課金/外部 API なし |
| `CRON_SECRET` / `OPS_SECRET_KEY` / `DISCORD_WEBHOOK_*` / `SES_*` | (注入) | **未注入** | demo は ops / 通知系なし |

**IAM Role (DemoLambdaRole):**
- Role 名: `ganbari-quest-app-demo-role`
- Managed Policies: `service-role/AWSLambdaBasicExecutionRole` のみ
- Inline Policies: 0
- 付与しない権限 (synth-time に test で assertion):
  - DynamoDB (`dynamodb:*`)
  - Cognito (`cognito-idp:*` / `cognito-identity:*`)
  - Secrets Manager (`secretsmanager:*`)
  - SES (`ses:*`)
  - S3 (CloudWatch Logs 用 S3 を除く)

#### NetworkStack 追加リソース

**CloudFront Distribution (DemoCDN):**
- Origin: demo Function URL (HTTPS_ONLY)
- 別名: `demo.ganbari-quest.com`
- ACM 証明書: `props.demoCertificateArn` (未指定時は本番 `certificateArn` を fallback、wildcard `*.ganbari-quest.com` が apex と sub-domain 双方をカバー)
- キャッシュポリシー: 本番と同一 (`CACHING_DISABLED` 本系 + `/_app/*` 365 日キャッシュ)
- セキュリティヘッダ: 本番と同一 (`SECURITY_HEADERS` policy)
- CloudFront Function: query slash encode のみ (admin IP 制限は demo に適用しない、anonymous public demo のため)
- geoRestriction: `JP` (本番と同一、Pre-PMF 段階)

**Route 53:**
- A レコード: `demo.ganbari-quest.com` → DemoCDN (ALIAS)
- AAAA レコード: 同上

#### IAM 分離検証

`tests/unit/infra/multi-lambda-cdk.test.ts` が CDK synth 時点で以下を強制:

1. **C-1 (load-bearing security control)**: DemoLambdaRole の `Policy.PolicyDocument` に DynamoDB / Cognito / Secrets Manager / SES の action が一切含まれない
2. **C-2**: NetworkStack に CloudFront Distribution が 2 本ある (alias `ganbari-quest.com` と `demo.ganbari-quest.com`)
3. **C-3**: demo Fn の env に DATA_SOURCE='demo' + AUTH_MODE='anonymous' が含まれる、本番 secret が含まれない

将来「demo に DynamoDB アクセスを追加した方が楽」と誤って `props.table.grantReadData(this.demoFn)` を追加した瞬間に CI が落ちる構造になっている。これがこの設計の最大の load-bearing 保証。

#### コスト試算

- Provisioned Concurrency: **$0** (PO 判断で未採用、cold start ~1-2s で運用。将来採用時 ~$2.74/月)
- demo Function URL: 無料 (Lambda Function URL は追加料金なし)
- CloudFront Distribution 追加: ~$0/月 (Free tier 内、リクエストごと従量)
- Route 53 ALIAS レコード追加: $0 (ALIAS は同一 hosted zone 内無料)
- demo 経由のリクエスト: anonymous demo のためトラフィックは限定的 (~$0.10/月)

**合計増分: ~$2.84/月** (本番 $0.50/月 → 合計 $3.34/月)

#### 本番 / demo の関係

- 本番 deploy 時に `cdk deploy --all` が両 Fn を同時更新 (同じ ECR image、tag は本番デプロイで `latest` に push される)
- 本番 Lambda 環境変数を変更しても demo Fn の env には影響しない (CDK 上で別オブジェクト)
- IAM Role は完全分離。本番 Role の権限を増減しても demo Role には影響しない

#### demo 検出ロジック — env-only 単一化 (PR-B4 / #2189)

`src/hooks.server.ts` の `event.locals.isDemo` 判定は **env 1 軸のみ** で決定される:

```typescript
// src/lib/server/demo/demo-mode.ts
export function resolveDemoActive(env: Pick<TypedEnv, 'AUTH_MODE' | 'DATA_SOURCE'>): boolean {
  return env.AUTH_MODE === 'anonymous' && env.DATA_SOURCE === 'demo';
}
```

| Lambda | `AUTH_MODE` | `DATA_SOURCE` | `event.locals.isDemo` |
|---|---|---|---|
| Production (`ganbari-quest.com`) | `cognito` | `dynamodb` (本番) / `sqlite` (NUC) | `false` |
| Demo (`demo.ganbari-quest.com`) | `anonymous` | `demo` | `true` |
| 開発者 misconfiguration 防御 | `anonymous` | `sqlite` | `false` (実 DB を no-op writer 化しない) |

**経緯 (legacy 3 signal の撤去)**:

- ADR-0039 (2026-04-18 #1180) 当初: cookie `gq_demo=1` / query `?mode=demo` / path `/demo/*` の 3 signal で single Lambda 上に demo を hoist
- ADR-0048 PR-B1 (#2143 merged): Pattern A (env-only fallback) として `isDemoLambda(authMode)` を OR 合流追加
- ADR-0048 PR-B3 (#2188 merged): `src/routes/demo/**` 物理撤去 → path signal が dead
- ADR-0048 PR-B4 (本セクション、#2189): cookie / query signal も demo Lambda subdomain で代替済のため撤去、`resolveDemoActive(env)` 1 行に単一化。`DEMO_MODE_COOKIE` / `DEMO_MODE_COOKIE_MAX_AGE` / `isDemoLambda()` / `/demo/exit` 専用ハンドラ全削除

**維持される機構**: `?plan=` クエリ + `demo_plan` cookie (#760 demo 内プラン切替 UI) は demo Lambda 上で意味があるため維持。`?screenshot=*` (LP capture 用、`src/routes/CLAUDE.md` 参照) も独立した別概念で維持。

**legacy URL 救済**: `/demo/exit` / `/demo` / `/demo/admin/*` 等の bookmark / 外部リンクは `src/lib/server/routing/legacy-url-map.ts` の 308 redirect entries で本番 path に救済 (永久保持)。

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

### 4.1 NUC self-hosted runner actor ガード (Issue #2356 / EPIC #2354)

`deploy-nuc.yml` は public repo の self-hosted runner で動作するため、**self-hosted NUC runner 上で実行できる actor を ADR-0022 体制で想定済みの actor に限定する** ために actor 許可リストで gate する (`if: contains(fromJSON('["Takenori-Kusaka", "ganbariquestsupport-lab"]'), github.actor)`)。本 workflow の trigger は `push: branches=[main]` + `workflow_dispatch` のみであり、fork PR からの直接 push は GitHub の保護 (fork 側に upstream main への push 権限がない) により発生せず、`workflow_dispatch` も upstream リポジトリの権限がある actor からしか発火しない。したがって本 gate の目的は「fork PR 防御」ではなく、**想定外の actor (誤って付与された collaborator / 将来の admin bypass / bot 等) による NUC 本番マシン上での任意コード実行を防ぐ**こと。許可は (1) **Takenori-Kusaka** (PO / repo owner) と (2) **ganbariquestsupport-lab** (ADR-0022 QA merge 体制の squash merge actor) の 2 account のみ。AWS Lambda 側 `deploy.yml` は GitHub-hosted runner + OIDC で動くため本 gate は不要。新たな信頼 account を追加する場合は本リストに 1 行追記すれば足り、構造変更は伴わない。

### 4.2 NUC staging 環境 (Issue #2872 / EPIC #2861 D 系)

統合 PR (develop→main) を本番取込**前**に本番近似環境で検証するため、本番 NUC とは独立した NUC staging 系統を `deploy-nuc-staging.yml` で構築する。本番への副作用ゼロ (本番不変条件) を前提とした隔離構成:

| 項目 | 本番 NUC (`deploy-nuc.yml`) | NUC staging (`deploy-nuc-staging.yml`) |
|---|---|---|
| working-dir | `C:\Docker\ganbari-quest` | `C:\Docker\ganbari-quest-staging` |
| compose project | (既定) | `-p ganbari-quest-staging`（CLI flag で隔離、`docker-compose.yml` は無改変・`name:` 不追加） |
| port | 3000 | 3100（staging `.env` の `PORT=3100` → compose `${PORT:-3000}`） |
| DB path | `data\ganbari-quest.db` | `data\ganbari-quest.db`（別 working-dir のため物理的に別 file） |
| trigger | `push: [main]` + dispatch | `pull_request: [main]`（統合 PR）+ dispatch（develop HEAD） |
| health | `localhost:3000/api/health` | `localhost:3100/api/health` |

- **snapshot-forward migration 貫通 (G-MIG / #2872 AC6)**: staging container を「**直近本番 DB snapshot から起動**」させ、`applyLazyStartupMigrations` (`src/lib/server/db/migration/lazy-startup-migrations.ts`) を貫通させて「過去状態からマイグレーション込み実機起動」を実機担保する。snapshot は `scripts/snapshot-prod-db.cjs` が better-sqlite3 online backup (`db.backup()`) で本番 DB を **read のみ**で取得し staging DB path に書き出す。本番 DB 不在時は exit 0 + fixture fallback で継続し、staging は fresh DB から lazy migration で起動する。post-deploy で `/api/health` 200 + response body `schema.schemaValid === true` を assert し、migration 失敗を検出する (#2508 startup crash 再発防止)。
- **本番不変条件 (#2872 AC4)**: staging は別 working-dir / 別 port / 別 compose project / 別 DB path で完全隔離され、本番 container を停止せず、本番 DB へ write しない (online snapshot は source read-only)。
- **当面 advisory**: 本 workflow は当面 required check に登録しない (staging working-dir が物理 NUC 上に未 provision の間、develop→main 取込をブロックしないため)。merge blocker 化 (#2872 AC3) は staging provision + branch ruleset 配線後に行う。
- **§3.8 step 9 連携 (G-PD / #2872 AC8)**: staging health (`localhost:3100/api/health`) は `docs/sessions/audit-team.md` §3.8 step 9「AWS + NUC 両 health check」の NUC 側として配線する (AWS 側は §4.3 AWS staging)。検証手順 SSOT は `.claude/skills/deploy-verify/SKILL.md`。

### 4.3 AWS staging 環境 (Issue #2873 / EPIC #2861 D 系)

本番 deploy 経路 (CDK synth → ECR push → Lambda update → health) そのものを統合 PR で検証するため、本番 6 stack の staging 版を `deploy-aws-staging.yml` で構築する。staging は **3 stack のみ** (`GanbariQuestStorageStaging` / `GanbariQuestAuthStaging` / `GanbariQuestComputeStaging`)。Network / Ses / Ops は省略し Function URL 直アクセスで検証する (CloudFront は geoRestriction JP のため本番 e2e も Function URL 直の実績パターン踏襲)。

| 項目 | 本番 (`deploy.yml`) | AWS staging (`deploy-aws-staging.yml`) |
|---|---|---|
| stack | 6 stack (`GanbariQuest{Storage,Auth,Compute,Network,Ses,Ops}`) | 3 stack (`GanbariQuest{Storage,Auth,Compute}Staging`)、明示列挙 deploy (`--all` 不使用) |
| 物理名 prefix | `ganbari-quest` | `ganbari-quest-staging`（table / Lambda `ganbari-quest-staging-app` / log group / pool / bucket / ECR repo） |
| SSM prefix | `/ganbari-quest/` | `/ganbari-quest-staging/`（`context-token-secret` は workflow が冪等 put） |
| ECR repo | `ganbari-quest`（maxImageCount:10） | `ganbari-quest-staging` 専用 repo（maxImageCount:3。prod repo 共有は rollback `[-2]` digest 選択 + lifecycle を staging push が侵食するため不採用） |
| Cognito | custom domain `auth.ganbari-quest.com` + Google IdP | default domain（prefix `ganbari-quest-staging`）。Google IdP / Route53 省略。SSM `cognito/domain` param は default domain 値で必ず書く |
| 外部サービス env | Stripe / Discord / Gemini / SES 注入 | **非注入**（本番外部サービスへの副作用ゼロ。SES / Cost Explorer の IAM grant も付与しない） |
| Backup / demo Lambda / cron-dispatcher / log archiving | あり | なし（`enableDemoLambda` / `enableCronDispatcher` / `enableBackup` / `enableLogArchiving` = false） |
| RemovalPolicy | RETAIN | DESTROY（使い捨て可能） |
| trigger | `push: [main]` + tag + dispatch | `pull_request: [main]`（統合 PR、paths filter 付き）+ dispatch（develop HEAD） |
| ADR-0019 gate | `check-cdk-replacement.mjs` ×2（Storage / all） | 同 script 再利用 ×2（StorageStaging / staging 3 stack） |
| tag | — | `gq-env=staging`（staging 3 stack に付与） |

実装方式: 既存 stack class に optional `envConfig` props（`infra/lib/env-config.ts` の `GqEnvConfig`、default = `PROD_ENV_CONFIG` = 現行 prod 値）を追加。staging 専用 class の複製は二重管理のため不採用。`infra/bin/app.ts` は `-c stagingEnabled=true` の context gate でのみ staging 3 stack を instantiate するため、本番 `cdk deploy --all` / `cdk diff --all` の挙動は不変。

- **prod template 不変 3 重防御**: ① optional props + prod default で diff ゼロ設計 ② `tests/unit/infra/staging-cdk.test.ts` の prod 不変 guard（synth-time、`ganbari-quest` table / `ganbari-quest-app` Fn / `ganbari-quest-users-v2` pool 等の物理名 assert）③ 本番 `deploy.yml` の ADR-0019 gate（deploy-time）。
- **ORIGIN 解決**: Function URL は synth 時未確定（自己参照）のため CDK は placeholder を注入し、workflow が `get-function-url-config` で解決して jq read-modify-write で `update-function-configuration` する（health / smoke は GET のみで ORIGIN 非依存のため縮退可）。
- **責務分界 (G-PD / G-MIG)**: AWS Lambda は DynamoDB backend で `applyLazyStartupMigrations` を呼ばないため、**migration 込み起動 (G-MIG) の主担保は NUC staging (§4.2 / #2872)**。#2873 の責務は「本番 deploy 経路の貫通 + post-deploy health (G-PD AWS 側)」であり、migration 検証を AWS に重複実装しない。
- **データ戦略**: staging table は空作成（health / smoke はデータ非依存）。demo fixture (`DATA_SOURCE=demo`) は DynamoDB repository 経路を通らず staging の存在意義が消えるため不採用。PITR / Backup restore 自動化は不採用 (ADR-0010 Bucket C)。本番相当データが必要になった場合の手動 runbook: 本番 table を AWS Backup の on-demand backup から `ganbari-quest-staging-restore` 等の別名 table に restore し、`aws dynamodb scan` + `batch-write-item`（または S3 export/import）で staging table に流し込む。終了後は restore table を削除する（本番 table へは一切 write しない）。
- **コスト (idle≈¥0、PO 承認済 #2873)**: 固定費 = staging ECR repo ≈$0.05〜0.15/月のみ（一次情報: https://aws.amazon.com/ecr/pricing/ — $0.10/GB-月、Lambda image 0.5〜1.5GB × maxImageCount:3 の差分 layer 共有後実効）。他は DynamoDB on-demand / Lambda リクエスト課金 / Cognito 10k MAU free / CW Logs free tier で idle $0。従量は 1 日 1 run で月数円未満。既存 budget（$5/月、OpsStack）が包含するため staging 専用 budget alarm は追加しない。
- **当面 advisory**: 初回 deploy 緑実証後に audit-manager が main ruleset required_status_checks へ `deploy-aws-staging` を追加する（merge blocker 化）。
- **§3.8 step 9 連携 (G-PD AWS 側)**: staging health（`<StagingFunctionUrl>api/health` 200）は `docs/sessions/audit-team.md` §3.8 step 9 の AWS 側として配線する。検証手順 SSOT は `.claude/skills/deploy-verify/SKILL.md`。

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
| **Lambda Demo (on-demand のみ、Provisioned Concurrency 未採用、ADR-0048)** | **~$0.10** | **~$0.10** | **~$0.10** |
| **合計** | **~$0.60（≈90円）** | **~$0.60** | **~$0.80** |

ドメイン費用（年額÷12 = ~117円/月）を加えて、実質月額 **~207円〜237円**。

**ADR-0048 増分内訳 (#2097 week 4)**: demo Lambda はリクエスト課金のみ (~$0.10/月)。Provisioned Concurrency は AWS アカウント Lambda concurrent execution quota 不足 + 予算制約により未採用 (PO 判断 2026-05-15)。cold start ~1-2s で運用、demo 訪問頻度が増えた段階で AWS Service Quotas 経由で増額申請 → Provisioned Concurrency 1 unit (+$2.74/月) 追加の運用切替を検討。

## 7. ファイル構成

```
infra/
├── bin/app.ts           # CDKエントリポイント (demoDomainName / demoCertificateArn context 追加 #2097)
├── lib/
│   ├── storage-stack.ts  # DynamoDB + S3 + ECR + AWS Backup
│   ├── auth-stack.ts     # Cognito User Pool + SSM Parameters
│   ├── compute-stack.ts  # Lambda (本番 + demo #2097) + Function URL + IAM Role 分離
│   ├── network-stack.ts  # CloudFront (本番 + demo #2097) + Route53 + ACM + S3エラーページ
│   ├── ops-stack.ts      # CloudWatch Alarms/Dashboard + Budgets + Cost Anomaly + Health通知
│   └── ses-stack.ts      # SES Email Identity + Configuration Set + メール受信パイプライン
├── error-pages/            # CloudFrontカスタムエラーページHTML（S3にデプロイ）
├── package.json
├── tsconfig.json
└── cdk.json

tests/unit/infra/
├── health-check-lambda.test.ts        # #1257 / #1469 Health Check Lambda 通知品質
└── multi-lambda-cdk.test.ts           # #2097 ADR-0048 IAM 分離回帰テスト (load-bearing)

Dockerfile.lambda        # Lambda Web Adapter用
.github/
├── workflows/
│   ├── ci.yml           # テスト・ビルド（main push / PR）
│   ├── deploy.yml       # AWS デプロイ（deploy → e2e-production smoke → release → notify; #1277 以降 pre-deploy test は ci.yml）
│   └── pages.yml        # GitHub Pages LP デプロイ（site/ 変更時）
├── dependabot.yml       # 依存パッケージ自動更新（Actions + npm + infra）
└── release.yml          # リリースノートカテゴリ設定
```

## 7.2 アナリティクス基盤（DynamoDB 一本化, #1591 / ADR-0023 I2）

### 採用方針

**外部 SaaS analytics は採用しない**。子供データ究極ミニマリズム原則 (ADR-0023 §4.4 / A-Q1(C)) に従い、業務イベントは AWS 内完結 (DynamoDB 単一テーブル) に閉じる。

| 項目 | 内容 |
|------|------|
| 採用 provider | DynamoDB のみ (`src/lib/analytics/providers/dynamo.ts`) |
| 削除済 provider | umami / Sentry (#1591 で `src/lib/analytics/providers/` から物理削除) |
| 外部送信 | ゼロ (CSP `connect-src 'self'` で構造的に保証) |
| イベント保持期間 | 90 日 (DynamoDB TTL 自動削除) |

### Key 設計

| 項目 | 値 |
|------|----|
| PK | `ANALYTICS#<YYYY-MM-DD>` |
| SK | `<ISO timestamp>#<random>` |
| GSI2PK | `ANALYTICS#EVENT#<eventName>` (イベント別時系列) |
| GSI2SK | `<YYYY-MM-DD>#<tenantId>` (日付 → テナントで絞込) |
| TTL | 取込時刻 + 90 日 (epoch seconds) |

メインテーブル (`ganbari-quest`) に同居させる single-table design。専用テーブルは作らない (ADR-0010 過剰防衛禁止)。

### 環境変数

| 変数 | 設定値 | 説明 |
|------|--------|------|
| `ANALYTICS_ENABLED` | `'true'` (本番固定) | DynamoDB provider の有効化トグル。CDK が Lambda env にハードコード注入 (#1591) |
| `ANALYTICS_TABLE_NAME` | `props.table.tableName` | 書込先テーブル名。メイン DynamoDB を流用 |

### CSP との整合

`hooks.server.ts` `buildCspHeader()` は外部送信先を一切ホワイトリストしない (`connect-src 'self'` 固定)。新たな外部 SaaS analytics を導入する場合は、本セクションと ADR-0023 §3.4 ホワイトリストの両方を更新する PR を先に通すこと (ADR-0006 安全弁削除禁止)。

### 可視化 (~~`/admin/analytics`~~ → `/ops/analytics`, #1639 / #2283 EPIC で集約先変更)

> **2026-05-19 更新 (#2283 EPIC Analytics-Removal)**: `/admin/analytics` を全面撤去し、運用者向け 4 種可視化は **`/ops/analytics` に集約**。詳細は `06-UI設計書.md §11 全ページ一覧` および `tmp/research/analytics-removal-result.md` §1 機能差分マトリクスを参照。本表は run-time の実装方式を継続保持（cron / DynamoDB schema 変更なし）。

`/ops/analytics` ページは **#1639 + #2285 EPIC #2283 で 4 種可視化を実装済み**（Pre-PMF Bucket A 範囲、`ops_users` group 認証必須）。

| セクション | 実装方式 | データ源 |
|-----------|---------|---------|
| Activation Funnel (4 step) | DynamoDB GSI2 query (`GSI2PK=ANALYTICS#EVENT#<name>`、`GSI2SK >= <since-date>`) を 4 events 並列実行、テナント単位 unique 件数を集計。**#2285 で `/admin/analytics` から `/ops/analytics` へ移動**、`funnelPeriod=30d` 固定 | `ANALYTICS#` partition |
| Retention Cohort (月次) | `cohort-analysis-service.getCohortAnalysis` を再利用。Day 単位は本 EPIC scope 外 (PO 確定 OQ1 α: 月単位で十分) | tenant 一覧（`auth.listAllTenants()`） |
| Sean Ellis スコア | `pmf-survey-service.aggregateSurveyResponses` を再利用 | settings KV (`pmf_survey_response_<round>`) |
| 解約理由分布 | `cancellation-service.getCancellationReasonAggregation` を再利用 | `CANCEL_REASON` partition |

**事前集計レコード（`PK=ANALYTICS_AGG#<YYYY-MM-DD>`, #1693 で導入）**: テナント数増加に備え、cron `gq-analytics-aggregator-daily` (毎日 03:00 JST = 18:00 UTC) で前日分の funnel + cancellation reason を集計し DynamoDB に書き込む。

| 集計種別 | PK | SK | 内容 | TTL |
|---------|----|----|------|-----|
| Activation Funnel | `ANALYTICS_AGG#<YYYY-MM-DD>` | `FUNNEL` | その日の event 別 unique tenantId 一覧（最大 4 events） | 365 日 |
| Cancellation 30d | `ANALYTICS_AGG#<YYYY-MM-DD>` | `CANCELLATION_30D` | その日時点での過去 30 日 rolling-window 集計結果 | 365 日 |
| Cancellation 90d | `ANALYTICS_AGG#<YYYY-MM-DD>` | `CANCELLATION_90D` | その日時点での過去 90 日 rolling-window 集計結果 | 365 日 |

**Read 側のフォールバック構造（`analytics-service.ts`）:**
1. 集計レコードを期間内日付分取得（`PK BETWEEN ANALYTICS_AGG#<since> AND ANALYTICS_AGG#<yesterday> AND SK=<kind>`）
2. **Funnel**: 集計済み日付分の tenantId 一覧を union し、不足日付（当日 / cron 失敗で歯抜けの日）のみライブ計算で補う
3. **Cancellation**: 前日分 rolling-window スナップショットがあれば即採用、無ければ既存ライブ集計 (`getCancellationReasonAggregation`) で fallback
4. service の interface (`getActivationFunnel` / `getCancellationReasons`) は不変。呼出側 (`+page.server.ts`) は変更不要

**Pre-PMF (ADR-0010) スコープ**:
- Sean Ellis / retention cohort は集計頻度が低い（半年に 1 round / 月次）ため事前集計対象外
- HyperLogLog 等の近似 sketch は post-PMF に持ち越し（~100 テナント規模では tenantId 一覧の保持が数 KB で十分）
- DynamoDB TTL 属性 (`ttl`) を有効化し、365 日経過したレコードは自動失効

**部分縮退方式**: `+page.server.ts` で `Promise.allSettled` を使い、1 セクションが失敗しても他セクションは表示する。`getActivationFunnel` / `getCancellationReasons` 内部の DynamoDB query 失敗時は zero counts / 空 breakdown で fallback（個別エラーログのみ、画面全体は崩さない）。

### 運営内部分析 (`/ops/analytics`, #1602 ADR-0023 I13)

`/ops/analytics` は **DynamoDB のメインテーブル**から直接ライブ集計する。`ANALYTICS#` パーティションは使わない（運営内部の集計対象は tenant 状態と settings のスナップショットであり、event log ではないため）。

| 集計項目 | 集計元 | 取得方法 | 計算量 |
|---------|--------|---------|--------|
| LTV / 月次獲得 / コホート / プラン別 MRR | tenant 一覧 | `auth.listAllTenants()`（全 tenant scan） | O(N tenants) |
| **setup チャレンジ選択分布**（#1602 / #1742） | 集計レコード優先 → 不足時ライブ計算 | 二段構造 (下記) | 通常 O(1)、cron 未稼働時のみ O(N tenants) |

**setup チャレンジ選択分布の事前集計レコード（`PK=CHALLENGE_AGG#<YYYY-MM-DD>`, #1742 で導入）**:

cron `gq-challenge-aggregator-daily` (毎日 03:30 JST = 18:30 UTC、analytics-aggregator-daily と被らないよう 30 分ずらし) で当日時点の全テナント `questionnaire_challenges` 設定値を CSV 配列に集約し、DynamoDB に書き込む。

| 集計種別 | PK | SK | 内容 | TTL |
|---------|----|----|------|-----|
| Preset Distribution | `CHALLENGE_AGG#<YYYY-MM-DD>` | `AGGREGATE` | `payload.challengesPerTenant`: 全テナントの `questionnaire_challenges` CSV 配列。`payload.totalTenants`: 集計時のテナント総数 | 365 日 |

**Read 側のフォールバック構造（`ops-analytics-service.fetchChallengesPerTenant`）:**
1. 直近 7 日分の集計レコードを Scan (`PK BETWEEN CHALLENGE_AGG#<7日前> AND CHALLENGE_AGG#<今日> AND SK=AGGREGATE`) し、最新の `payload.challengesPerTenant` を採用
2. 集計レコードが見つからない (cron 未稼働 / 障害 / 7 日以上停止) 場合のみ、テナントごと `settings.getSetting('questionnaire_challenges', tenantId)` を呼ぶ N+1 ライブ集計で fallback
3. `getAnalyticsData` の interface (`presetDistribution`) は不変。呼出側 (`+page.server.ts`) は変更不要

**Pre-PMF (ADR-0010) スコープ**:
- テナント数 ≦ 数百を想定 → cron 未稼働段階でも N+1 fallback で動作する設計
- テナント数 1,000+ で N+1 GetItem の表示遅延が顕在化する想定。cron が走り始めれば自然移行
- DynamoDB TTL 属性 (`ttl`) 365 日で自動失効
- HyperLogLog 等の近似 sketch は post-PMF (~10,000+ tenants) で再検討
- 関連: PR #1696 (analytics 事前集計 cron) と同パターン

---

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
| 2026-04-25 | #1376 §3.3 に CronDispatcherFn Lambda・EventBridge Rules 3件を追記。§3.4 に CronDispatcherErrors CloudWatch Alarm (P0, SNS 通知付き) を追記 |
| 2026-04-27 | #1586 §3.3 に cron-dispatcher の CRON_SECRET / OPS_SECRET_KEY fallback と dryRun mode を追記。CDK synth 時の必須 secret throw + deploy.yml の Validate required secrets / Cron dispatcher smoke test step も合わせて整備 |
| 2026-04-27 | #1591 §7.2 アナリティクス基盤を新設。DynamoDB 一本化 (umami / Sentry 削除)、CSP 単純化、Lambda env (ANALYTICS_ENABLED / ANALYTICS_TABLE_NAME) のハードコード注入を追記 |
| 2026-04-29 | #1639 §7.2 可視化セクションを Coming soon から実装済みに更新。4 種可視化（activation funnel / retention cohort / Sean Ellis / 解約理由）の実装方式・データ源・部分縮退方式を追記 |
| 2026-04-29 | #1693 §3.3 EventBridge Rules に `pmf-survey` / `analytics-aggregator-daily` を追記。§7.2 に事前集計レコード `PK=ANALYTICS_AGG#<date>` のキー設計 + read 側フォールバック構造（集計優先 → ライブ計算 fallback）を追記。DynamoDB TTL `ttl` 属性を有効化し集計レコードは 365 日保持 |
| 2026-04-30 | #1742 §3.3 EventBridge Rules に `challenge-aggregator-daily` を追記 (cron(30 18 * * ? *) UTC = 03:30 JST)。§6.x 「運営内部分析」節の setup チャレンジ選択分布表を、ライブ集計（cron バッチ非採用）から事前集計レコード `PK=CHALLENGE_AGG#<date>` 優先 → ライブ集計 fallback の二段構造に更新。`ops-analytics-service.fetchChallengesPerTenant` を `queryLatestChallengeAggregate` 呼出 → 既存 N+1 fallback 構造に改修 (#1602 follow-up)。analytics-aggregate と同じ TTL 365 日方針 |
