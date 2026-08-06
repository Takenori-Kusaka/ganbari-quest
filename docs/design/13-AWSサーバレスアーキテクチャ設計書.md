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
    │                            ├── Aurora DSQL       │                              └── (CloudWatch Logs のみ、本番リソースアクセスなし)
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
| `GanbariQuestStorage` | S3 バケット, ECR リポジトリ | なし |
| `GanbariQuestAuth` | Cognito User Pool, User Pool Client, SSM Parameters | なし |
| `GanbariQuestCompute` | Lambda (Docker), Function URL | Storage, Auth |
| `GanbariQuestNetwork` | CloudFront, Route 53, ACM | Compute |
| `GanbariQuestOps` | CloudWatch Alarms/Dashboard, SNS, Budgets, Cost Anomaly Detection | Compute, Network |
| `GanbariQuestDsql` | Aurora DSQL cluster (context gate `-c dsqlEnabled=true`) | なし |
| `GanbariQuestSes` | SES Email Identity, Configuration Set, 受信パイプライン (S3 + Lambda) | なし |

### 3.1 StorageStack

`StorageStack` は S3（assets）+ ECR（Lambda container image）+ AWS Backup vault（RETAIN-orphan、prod のみ）を
提供する。DB backend は Aurora DSQL（`DsqlStack`）が唯一の SSOT（EPIC #3424）。runtime で DynamoDB table を
参照する経路は無い（health は probePg、analytics は on-demand 化済）。DSQL のリレーショナルスキーマは
[dsql-data-model.md](dsql-data-model.md) を参照。

> **DynamoDB `MainTable` は撤去済（#3438 → #3850 → #3854）。** cross-stack export の in-use 削除制約
> （CloudFormation は「利用中の export は削除も値変更もできない」）により、producer（StorageStack）が
> export を消せるのは consumer（ComputeStack）の import 消失が本番反映された後に限られるため、CFN 標準の
> 2-deploy strangler で撤去した:
>
> - **Deploy-1（#3850 / #3855 / #3864）**: consumer（ComputeStack）は `MainTable` への参照（`grantReadWriteData`
>   + `TABLE_NAME` / `DYNAMODB_TABLE` / `ANALYTICS_TABLE_NAME` env）を全撤去（#3438）。producer（StorageStack）は
>   `MainTable` + AWS Backup + 旧 consumer が import する **Ref（table 名）+ Arn の両 `exportValue`** を保持した
>   （Arn だけの保持は #3855 で Ref 欠落による再 rollback を招いたため両方が必須）。
> - **Deploy-2（#3854）**: Deploy-1 が本番反映され consumer の import が消失した後、StorageStack から
>   `MainTable` + AWS Backup **plan / selection / role** + **両 `exportValue`** を撤去した（両 export とも
>   in-use でないため削除成功）。prod は removalPolicy=RETAIN だったため、table は CloudFormation の管理から
>   外れる（orphan）だけで物理 table + データは AWS 上に保全される（物理削除は別 ops 手順 / PO 承認）。
>
> **AWS Backup `BackupVault`（`ganbari-quest-vault`）だけは撤去せず RETAIN で残す（#3854 の是正）。** #3854 の
> 当初実装は vault も撤去しようとしたが、この vault は旧 daily plan が作成した **recovery point 2 件を保持** して
> おり、**AWS Backup は「recovery point を持つ vault の削除」を API レベルで拒否する**（CloudFormation も同じ）。
> よって vault 撤去は deploy 失敗 → StorageStack rollback → 本番 deploy 停止（#3881 と同一クラスの orphan 事故）を
> 招く。canonical 解は、移行中の backup データ削除（破壊的・不可逆）を避けて **vault を残しつつ `removalPolicy`
> を `RETAIN` に是正**することであり、これは旧 table を RETAIN-orphan で残した判断と一貫する（recovery point
> 2 件は移行安定までの安全網）。旧 vault は `removalPolicy: DESTROY`（= `DeletionPolicy: Delete`）で、これは
> AWS Backup の CDK 既定 RETAIN に反しており削除を試みさせていた元凶。RETAIN に是正することで将来 vault を
> template から外す時も orphan 化で安全に外せる。plan / selection / role は table を参照する stateless リソースの
> ため撤去済 = **新規 backup は取らない**。staging（`enableBackup=false`）は残すべき recovery point が無いため
> vault 自体を構築しない。
>
> **vault の物理 empty→delete（移行安定後の gated out-of-band ops、PO 承認必須）**: 移行が完全に安定し
> recovery point の安全網が不要と判断した後、次の手順で out-of-band に片付ける（CDK からは扱わず、CLI で明示実行）:
>
> ```bash
> # 1. vault 内の recovery point を列挙（2 件想定）
> aws backup list-recovery-points-by-backup-vault --backup-vault-name ganbari-quest-vault --region us-east-1
> # 2. recovery point を 1 件ずつ削除（PO 承認後、不可逆）
> aws backup delete-recovery-point --backup-vault-name ganbari-quest-vault \
>   --recovery-point-arn <arn> --region us-east-1   # ×2
> # 3. 空になった vault を削除
> aws backup delete-backup-vault --backup-vault-name ganbari-quest-vault --region us-east-1
> # 4. vault が RETAIN-orphan のため CDK template からの記述削除は別途（orphan なので deploy は失敗しない）
> ```
>
> 撤去完遂の不変条件（StorageStack が MainTable / BackupPlan / BackupSelection / MainTable 由来 export を一切
> 持たない / vault は prod で RETAIN 1 本 / consumer が MainTable 非参照）は `tests/unit/infra/staging-cdk.test.ts`
> （P-1 / B-3854a / B-3854b、prod + staging）が fitness function として固定する。BackupPlan や MainTable export が
> 復活したら（table 復元等）即 fail し、vault の DeletionPolicy が Retain 以外に変わっても fail する。

#### 3.1.1 cross-stack export allowlist ratchet（#3858、ADR-0061 shift-left）

自動 cross-stack export（producer 側 `CfnOutput` + Export / consumer 側 `Fn::ImportValue`）は **synth 時に初めて生成されソースに存在しない**ため、撤去時の in-use 削除制約（#3438 → #3850）は develop 軽量レーンをすり抜け release 統合監査（deploy-aws-staging）で初めて露見していた。`tests/unit/infra/cross-stack-export-ratchet.test.ts` が全 stack（prod 6 + staging 3）を `bin/app.ts` と同一に wire して synth し、`findOutputs('*')` の Export 名 + `Fn::ImportValue` を **allowlist と集合一致**で照合する fitness gate を PR 時点（unit-test 層）に前倒し配備する（cdk-nag / ESLint-AST は自動 export を取りこぼすため、synth 後の template 検査層が唯一確実）。

- **baseline（実測 13 = prod 9 + staging 4）**: prod StorageStack 4（AssetsBucket Ref/Arn + ECR AppRepo Ref/Arn）/ prod ComputeStack 4（main・demo Fn FunctionUrl + main・cron-dispatcher Fn Ref）/ prod NetworkStack 1（CloudFront Distribution Ref）/ staging StorageStack 4（prod Storage と同 hash、stack 名 prefix のみ差）。**属性ごとに別 entry**（#3855 = Ref を Arn と別本と認識する構造的再発防止）。#3854 Deploy-2 で MainTable Ref/Arn（prod + staging = 4 本）を撤去したため 17 → 13。
- **ratchet 運用（一方通行で減らす）**: cross-stack 境界を SSM 疎結合化 / 撤去したら該当 export を allowlist から削除する（= 疎結合の進捗計測器）。**新規自動 export の追加（allowlist 外）は CI fail** で止める。cross-stack 完全禁止は AWS 公式（同一 App の層状参照は正規手段）に反するため意図的残存を allowlist で管理する（`base-token-routes-ratchet` / `check-cdk-replacement` の承認マーカーと同一思想）。
- **#3854 撤去完遂の guard**: #3850 Deploy-1 で dangling export として allowlist に載せた MainTable Ref/Arn（prod + staging = 4 本）は、Deploy-2（#3854）で table + 両 export を撤去したため allowlist からも削除した。以後 MainTable 由来 export が synth に現れないことを本 test が断言し、export が復活したら（table 復元等）「新規 export = allowlist 外」assert が fail する。

**S3バケット:**
- アバター画像: `avatars/{tenantId}/{childId}/`
- バックアップ: `backups/{date}/` （30日で自動削除）
- パブリックアクセス: 完全ブロック

**ECR リポジトリ:**
- Lambda コンテナイメージ格納（prod `maxImageCount:10` / staging `maxImageCount:3`）

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

**LWA readiness と health の分離（#3657）:**

| probe | パス | 深さ | 用途 |
|-------|------|------|------|
| readiness | `/api/ready` | shallow（プロセスが HTTP を受けられるかのみ、DB 非接触） | LWA の `AWS_LWA_READINESS_CHECK_PATH`（`Dockerfile.lambda`）。トラフィック受入可否の判定 |
| health | `/api/health` | deep（DATA_SOURCE に応じた実 backend 接続 + schema 検証、07-API設計書 §3.15） | 監視専用: 外部ヘルスチェック Prober（§3.4 L1）/ post-deploy smoke（deploy.yml / deploy-aws-staging.yml）/ NUC Docker healthcheck（`Dockerfile`） |

- **readiness を deep DB probe に結合しない**。結合すると DB 障害時に LWA が never-ready となり、アプリの fail-close 503 が外に出ず Function URL 全体が 502 化する（外形の劣化 + 障害原因の不可視化）。さらに cold start の readiness 成立が DB 接続に律速されて Lambda init 10s 上限の `INIT_REPORT timeout` → 再 init ループを誘発する（DSQL 構成 staging 実測: probe 込み Init 3315ms）
- LWA 0.9.1 の readiness は HTTP status ≥ 500（`AWS_LWA_READINESS_CHECK_MIN_UNHEALTHY_STATUS` 既定値）を unhealthy と判定するため、/api/health の 503 fail-close はそのまま never-ready になる。LWA 既定の readiness path が `/`（軽量応答想定）である点とも整合し、shallow readiness + deep health の分離は Kubernetes の readiness/liveness 分離・AWS Builders' Library「Implementing health checks」（依存 deep check を起動 gate に使うと単一依存障害が全遮断へ増幅される）と同型の確立パターン
- **DB 障害時の外形と検出経路**: アプリは各リクエストで fail-close 503 / エラー応答を返し（assertion 弱体化なし、ADR-0006 整合）、Lambda-URL-5xx alarm（§3.4 #7、≥5回/5分 P0）+ 外部ヘルスチェック Prober（§3.4 L1、`/api/health` を 1 時間毎 GET → 503 検知 → Discord 通知）が検出する。CloudFront カスタムエラーレスポンス（§3.5）は 502/503 とも S3 エラーページに差し替えるため、ユーザー向け表示は劣化しない
- `/api/ready` はメンテナンスモード（§3.5）でも 503 化しない（`hooks.server.ts` で `/api/health` と同様に除外）。メンテ中の cold start が never-ready → 502 になり、メンテページ（503 → S3 差し替え）が出せなくなるのを防ぐ

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

スケジュール SSOT は `src/lib/server/cron/schedule-registry.ts`。本表は registry の全 9 ジョブと 1:1 で対応する。
「EventBridge」列は AWS 本番でジョブを駆動する EventBridge Rule (`infra/lib/compute-stack.ts` の `CRON_JOBS`) の有無、
「dispatcher」列は cron-dispatcher Lambda の `KNOWN_ENDPOINTS` (`infra/lambda/cron-dispatcher/index.ts`) への登録有無を示す。
NUC セルフホスト版は AWS を経由せず `scripts/scheduler.ts` が registry 全 9 ジョブを node-cron で直接駆動するため、
EventBridge / dispatcher 未登録のジョブも NUC では起動する。

| ジョブ (registry name) | スケジュール (UTC) | JST 換算 | EventBridge | dispatcher | 概要 |
|---------|-----------------|---------|:-:|:-:|----------|
| retention-cleanup | `cron(0 16 * * ? *)` | 毎日 01:00 | ✓ | ✓ | 保存期間超過データの自動削除バッチ (#717 / #729) |
| trial-notifications | `cron(0 0 * * ? *)` | 毎日 09:00 | ✓ | ✓ | トライアル終了通知バッチ (#737) |
| age-recalc | `cron(0 15 * * ? *)` | 毎日 00:00 | ✓ | ✓ | 子供の年齢自動インクリメント (#1381) |
| lifecycle-emails | `cron(30 0 * * ? *)` | 毎日 09:30 | ✓ | ✓ | 期限切れ前リマインド + 休眠復帰メール (#1601, ADR-0023 §5 I11) |
| grace-period-deletion | `cron(0 17 * * ? *)` | 毎日 02:00 | ✗ | ✓ | グレースピリオド期限切れテナントの物理削除バッチ (#1648 R43, `grace-period-service.ts`)。解約後の猶予期間 (プラン別保持期間) を過ぎたソフト削除済テナントを物理削除する。**EventBridge Rule は現在作成していない** — 第 21 回統合 (#4304) で #4327 の 4 条件 (予告なし / 観測不能 / 停止不能 / 復旧不能) を検出したため revert した。うち 3 条件は PR #4340 で解消済 (削除順序の是正で宙吊り行を封じ、部分失敗を HTTP 500 + 専用 alarm + Discord incident に載せ、EventBridge Rule disable と `GRACE_PERIOD_DELETION_DISABLED` env の 2 層の停止手段を持たせた)。残るのは復旧不能 (S3 versioning 無し・DSQL は cluster 単位 7 日のみ、#4338 で判断)。復活は dry-run の件数を出してオーナーが再有効化を承認してから。dispatcher の KNOWN_ENDPOINTS には残す (Rule が無ければ発火しないため無害で、復活時の追従漏れを防ぐ)。運用 SSOT: [`docs/runbooks/grace-period-deletion-operations.md`](../runbooks/grace-period-deletion-operations.md) |
| deletion-warning-emails | `cron(0 1 * * ? *)` | 毎日 10:00 | ✓ | ✓ | アカウント削除予告メール (#2399, `deletion-warning-service.ts`)。猶予期間中のテナントの所有者へ、物理削除予定日と復元導線を 1 通だけ送る。しきい値は family = 残り 14 日 / standard = 残り 1 日 / free = 送信なし (猶予 0 日) |
| pmf-survey | `cron(0 0 1 6,12 ? *)` | 6/1・12/1 09:00 | ✓ | ✓ | PMF 判定アンケート (Sean Ellis Test) 年 2 回配信 (#1598, ADR-0023 §5 I7) |
| export-build | `cron(0/5 * * * ? *)` | 5 分毎 | ✓ | ✓ | クラウドエクスポート非同期 build バッチ (#3504, async-backup-export.md §3.2)。`status='pending'` の `cloud_exports` を拾い ZIP 生成 → S3/ローカル FS 保存 → `ready` に遷移。AWS (cron-dispatcher) / NUC (scheduler container) 双方が同一 endpoint を駆動 |
| stripe-webhook-delivery-check | `cron(5 * * * ? *)` | 毎時 5 分 | ✓ | ✓ | Stripe webhook 未達 (沈黙) の検知バッチ (#3959, `stripe-webhook-delivery-monitor.ts`)。Stripe Events API の `pending_webhooks` 滞留と、checkout 完了に対する plan 反映有無を突き合わせ、両方成立時のみ Discord alert `stripe-webhook-undelivered` を 1 通送る。検査自体が失敗した場合は `stripe-webhook-monitor-failed` を送る (cron-dispatcher は非 2xx を throw しないため Lambda error alarm では表面化しない) |

- ターゲット: AWS では `ganbari-quest-cron-dispatcher` Lambda (JSON payload `{ cronJob: "<job-name>" }`) が EventBridge から起動され `/api/cron/:job` を HTTP POST する
- AWS EventBridge Rule 名は `ganbari-quest-cron-<job-name>` (例: `ganbari-quest-cron-retention-cleanup`)
- `ganbari-quest-cron-license-expire` は license key 全廃 (#2822 / Epic #2525 Phase 7 PR-L3) で撤去済。期限管理は Stripe `customer.subscription.deleted` webhook に代替
- `lifecycle-emails` (#1601, ADR-0023 §5 I11): 親オーナー宛のみ送信。年 6 回マーケティングメール上限を遵守。List-Unsubscribe ヘッダ + 配信停止リンク必須。Anti-engagement 整合 (中立トーン)。
- **registry 外の endpoint**: `/api/cron/expire-redemptions` (#1337, 30 日以上 pending の交換申請を expired に移行) は endpoint として存在するが registry / EventBridge / dispatcher いずれにも未登録のため、自動スケジュール駆動はされない (手動 / 外部呼び出し前提)。`/api/cron/pglite-backup` (#3950) も同様に registry 外で、NUC ローカルの crond (`docker-compose.yml` backup profile) が駆動する
- **検証手順 / runbook**: [`docs/runbooks/cron-3-endpoints-verification.md`](../runbooks/cron-3-endpoints-verification.md) (#1377 Sub A-3)
- **認証ヘッダ**: dispatcher は `Authorization: Bearer <CRON_SECRET>` を送信。endpoint 側は `verifyCronAuth` (`src/lib/server/auth/cron-auth.ts`) で `Authorization: Bearer` と `x-cron-secret` の両ヘッダを受理する (#1377 で統一、NUC scheduler / AWS dispatcher 双方互換)
- **Sub A-3 検証層** (#1377): `tests/unit/cron/schedule-consistency.test.ts` が registry / CDK / dispatcher の整合性を検証する。registry ⊆ CDK / CDK ⊆ registry / registry ↔ dispatcher の 3 方向に加え、`src/routes/api/cron/*/+server.ts` の実 FS 列挙を母数とした網羅、および上表 (job 行 / ✓ ✗ 列 / UTC cron 式 / 件数) と code の一致を検証する。registry に載るがスケジュール駆動しない endpoint は理由と追跡 Issue を必須とする `DOCUMENTED_EXCLUSIONS` に明示登録して除外する。gap が解消した除外エントリは同テストが stale として検出する

**Cron ジョブ実行時間予算 — 30 秒 self-limiting + 持ち越し規約 (#3695):**

全 cron ジョブの実処理は `EventBridge → cron-dispatcher → HTTP POST → SvelteKitFn (timeout 30 秒)` 上で走るため、dispatcher 側の timeout (Lambda 5 分 / HTTP client 270 秒) は「アプリ Lambda が 504 を返すまで待つだけ」で救済にならず、**全ジョブが実質 30 秒制約下にある**。「cron だから長く走れる」という前提で設計してはならない。

- **規約**: 処理量がデータ量 (テナント数 / pending 件数等) に比例する cron ジョブは、**1 回の実行で 30 秒予算内に処理できる分だけ処理し、残りは次回実行に持ち越す** (self-limiting)。実装は `src/lib/server/cron/time-budget.ts` の `createTimeBudget` (既定 20 秒 = 30 秒 − 認証・前処理・in-flight 完走・レスポンス直列化のヘッドルーム 10 秒) と件数上限の併用。予算超過チェックは item 間で行い、着手した item は完走させる (中断は stale 'building' 等の中途状態を量産するため)
- **観測性**: 持ち越し発生時は件数 (`remaining` / `skipped`) を log warn + レスポンスに必ず含める (silent 持ち越し禁止、ADR-0006 整合)
- **適用済**: `export-build` (`drainPendingExports`: limit 5 + stale reclaim + 時間予算。5 分毎 cron が持ち越し分を自然回収) / `grace-period-deletion` (`purgeExpiredSoftDeletedTenants`: limit 5 + 時間予算。残件は翌日実行に持ち越し — 個人情報保護法 22 条は努力義務であり 1-2 日の持ち越しは許容範囲) / `age-recalc` (`recalcAllChildrenAges`: テナント上限 200 + 時間予算。持ち越しても「同じ先頭 N 件」を繰り返さないよう、tenantId 昇順の固定スライスを実行日 (JST 暦日) の剰余で 1 つ選び `ceil(total / limit)` 日で重複なく周回する — 横断カーソルを置ける kv が無く、テナント毎カーソルは N+1 読み取りを生むため (ADR-0065)。持ち越し時は誕生日による UI モード切替が最大 1 周回分遅れるが、age は birthDate からの冪等な導出でありデータは壊れない。持ち越し件数は「ローテーションで今日の担当外」（`tenantsSkippedByRotation`、設計どおりの正常値）と「担当スライス内での予算超過による打ち切り」（`tenantsSkippedByBudget`、異常の合図）を分けて報告し、warn ログは後者のみで発火する）
- **他ジョブ**: retention-cleanup / analytics・challenge aggregate 系もテナント数比例だが、現規模 (Pre-PMF、~100 tenants) では 30 秒内に収まる。顕在化 (CronDispatcherErrors alarm での 504 / timeout 検出) 時に本規約を同パターンで適用する
- **代替案と発動条件**: dispatcher からの専用長時間 Lambda 直接 invoke (案 B) は関数分離 + コード配布 2 系統の運用負荷、Step Functions (案 C) は Pre-PMF 過剰 (ADR-0010) のため不採用。**self-limiting でも 1 スケジュールスパン内に消化しきれないバックログが定常化した時点** (例: export-build の pending 滞留が 1 時間超 / grace-period の持ち越しが 3 日連続) **で案 B を再検討**する
- **新規ジョブ追加時**: `schedule-registry.ts` 冒頭の checklist に従う (本規約 + KNOWN_ENDPOINTS / CRON_JOBS 並行登録)
- **自動リトライは「非冪等な job だけ」切る (#4327)**: 既定は Lambda 非同期呼び出しのリトライ (最大 2 回) を**維持**する。切るのは `grace-period-deletion` のみ (`compute-stack.ts` の `CRON_JOBS` に `disableRetry: true`)。理由は「途中まで削除されたテナントに purge が再走する」非冪等性で、そこだけ再送より再走回避が勝つ。**一律 0 にしてはならない** — 冪等な job ではリトライが「1 回の失敗で取りこぼす」ことへの防御として働いており、とくに `deletion-warning-emails` は送信済フラグで冪等かつ 1 度の失敗が「予告のないまま削除される」に直結し、`pmf-survey` は年 2 回起動のため 1 失敗が 6 ヶ月の欠測になる。不変条件は `tests/unit/infra/grace-period-deletion-safety.test.ts` [C1]-[C3] が固定する (切っている job が grace-period-deletion 1 本だけであることまで assert)

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
| 5 | Lambda-URL-5xx | Url5xxCount | ≥ 5回/5分 | P0 |
| 6 | Lambda-URL-4xx-Spike | Url4xxCount | ≥ 50回/5分 | P1 |
| 7 | CloudFront-5xx | 5xxErrorRate | ≥ 5% | P0 |
| 8 | **CronDispatcherErrors** (#1376) | CronDispatcherFn Errors | ≥ 1回/5分 | P0 |

> DynamoDB alarms（Throttles / SystemErrors / ConsumedCapacity）は #3438 で撤去（DB backend は
> Aurora DSQL に一本化、DynamoDB table 無し）。DSQL の監視は `DsqlStack` が担う。

**CloudWatch Dashboard:** `ganbari-quest-ops`
- Lambda: Invocations/Errors, Duration p50/p99, Throttles/Concurrent
- Alarm Status: SingleValueWidget

**AWS Budgets:**
- 月額予算: $5
- 3段階アラート: 実績50%, 実績80%, 予測100%超過

**Cost Anomaly Detection:**
- モニタータイプ: DIMENSIONAL (SERVICE)
- 通知閾値: $1以上の異常

**AWS Health EventBridge:**
- 対象サービス: LAMBDA, CLOUDFRONT, COGNITO, S3（DYNAMODB は #3438 で除外、DB backend は DSQL）
- イベントカテゴリ: issue（障害）, scheduledChange（計画メンテ）
- 通知先: SNS Topic（OpsAlerts）

**外部ヘルスチェック Prober（#1121 / #1214）:**

本番の稼働監視は **2 層構成** で行う。どちらか片方で検知できない障害があるため、役割分担を明示する:

| 層 | 実装 | 対象 | 検知できる障害 | 検知できない障害 |
|----|------|------|--------------|----------------|
| L1: アプリ層 | Health Check Lambda (`ganbari-quest-health-check`) → **Lambda Function URL** を 1 時間ごとに GET | Lambda / DSQL / アプリケーションコード | 500 / タイムアウト / DB 接続失敗 | CloudFront 障害 / WAF 誤検知 / DNS 障害 / TLS 証明書期限切れ |
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
  - origin = `lambdaOrigin`（Origin Shield なし。キャッシュ無効な動的応答に二次キャッシュは無効で、余計な hop を載せないため）
- `/_app/immutable/*`: SvelteKit の content-hash 付き immutable 静的アセット（**S3 (OAC) から配信、#3087 解決策 B**）
  - 365日キャッシュ（immutable）/ Gzip + Brotli 圧縮
  - origin = S3 `StaticAssetsBucket`（OAC 経由）。**Lambda を一切経由しない**ため、エッジ cache cold 時に ~224 本のチャンクが Lambda origin を一斉直撃して `TooManyRequestsException`(429) + HTTP/1.1 接続キュー輻輳で最遅 ~16s に達していた問題（HAR 実測、#3087）が**構造的に消滅**する
  - 配信元 = deploy 済 Docker image から抽出した `/app/client/_app/immutable`（= Lambda が SSR で参照するのと**同一 build artifact**）を `BucketDeployment` で S3 に upload。HTML が参照する content-hash と S3 の hash が完全一致する（`prune: false` で旧 hash も残し deploy window 中の旧 HTML 参照を 403 にしない）
  - 解決策 A（Origin Shield）からの段階改善。CDK context `staticAssetsS3Offload`（deploy.yml が `true` 指定 + image から asset 抽出）で有効化。flag OFF（default）時は従来構成（下記 `/_app/*` の Origin Shield Lambda が immutable も配信）を維持し、本番 template と byte 一致（非 replacement、ADR-0019）
  - **robustness (#3402、offload ON 時のみ)**:
    - **403 propagation 窓の解消 (#3402-2)**: distribution を `StaticAssetsDeploy`（BucketDeployment）に `addDependency` させ、初回有効化時に upload 完了後へ distribution 更新順序を強制する（S3 が空を指す 403 窓を塞ぐ）。Origin Group failover は #3087 の origin index preempt 不変条件を churn させるため不採用、CFN 依存で低リスク解決
    - **旧 hash 剪定 (#3402-3)**: `prune: false` の旧 content-hash 無限蓄積を、`_app/immutable/` prefix の **30 日 expiration lifecycle rule** で剪定（deploy window は数分、30 日以上前の hash は参照されない）
    - **S3 origin 4xx/5xx alarm (#3402-1、ADR-0024 ルール D)**: bucket に request metrics（`EntireBucket`）を有効化し、`OpsStack` が `AWS/S3` `4xxErrors`（≥10/5分、OAC 誤設定/部分 upload 欠落）/ `5xxErrors`（≥5/5分、S3 障害）を SNS 通知で継続監視。offload OFF（bucket 不在）時は alarm 未作成 = 監視 cost ゼロ
- `/_app/*`: SvelteKit の非 immutable 静的アセット（`_app/version.json` 等。burst しない）
  - origin = `staticAssetOrigin`（**Origin Shield 有効 / region `us-east-1`、#3087 解決策 A**）。S3 offload OFF 時は immutable も含め `/_app/*` 全体をここで配信。Origin Shield（regional mid-tier cache）で cold-miss burst を 1 リージョンに集約 = 同一アセットの同時 origin fetch を 1 本に collapse + 二次キャッシュで Lambda 直撃を激減。region は origin (Lambda) と同一 us-east-1
- `/error/*`: S3 エラーページ（OAC経由、Lambda障害時でもS3から配信）
- カスタムエラーレスポンス: 500/502/503/504 → S3の子供向けエラーページ
- Price Class: PriceClass_100（北米+欧州+アジア）
- HTTP/2 + HTTP/3
- **アクセスログ（標準ログ = S3 直配信、#4320）**: 本番 / demo / staging の全 distribution で有効。配信先は NetworkStack の `AccessLogsBucket`（物理名は CFN auto-naming、prefix `cdn/` = 本番 / `demo-cdn/` = demo）。**保管 3 日**の lifecycle expiration で自動削除し、cookie は記録しない。リアルタイムログ（Kinesis 課金）と分析基盤（Athena 等）は作らない。仕様・プライバシー上の位置づけ・盲点（Function URL 直叩きは記録されない）の SSOT は `docs/design/14-セキュリティ設計書.md` §9.4

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

#### 3.5.1 user-content 配信の CloudFront/S3 セキュリティ（#3830 / EPIC #3408 slice D）

user-content（avatar / ZIP import 由来ファイル等、attacker が content-type を左右し得るバイト）は 14-セキュリティ設計書 §7.2.1 の不変条件①「常に Lambda 経由配信」に従う。CloudFront/S3 レイヤでこの不変条件を破りうる 2 つの構造リスク（#3112 構造リスク 2 / 3）を以下で評価・防御する。

##### cache TTL の content-type 残存リスク評価（AC1）

- **現行 behavior 実態**: user-content 経路（`/tenants/*` / `/uploads/*`）は専用 behavior を持たず **default behavior に fall-through** する。default behavior の cache policy は **`CACHING_DISABLED`**（min/max/default TTL = 0）であり、**CloudFront エッジは user-content レスポンスを一切 cache しない**。従って「ヘッダ適用前の旧レスポンスが CDN で TTL 期間中 stale な content-type / `Content-Disposition` を保持し、他ユーザーへ配信される」共有 cache poisoning は**構造的に発生しない**。`X-Content-Type-Options: nosniff` は default behavior の `ResponseHeadersPolicy.SECURITY_HEADERS`（CloudFront マネージド）で常に付与され、`Content-Disposition` は Lambda origin（`safeContentDisposition()`）が付与する。
- **browser cache の扱い**: origin（Lambda）は user-content に `Cache-Control: public, max-age=31536000, immutable` を付与するため **browser 側は 1 年 cache** する。ただし (a) storage key は content-suffix / tenant path 込みで実質 immutable（同一 URL で content-type が変わる再 upload は起きない）、(b) browser が cache するレスポンス自体が既に `nosniff` + `Content-Disposition` を持つため、cache されても防御ヘッダごと保持される。よって browser cache 由来の残存は per-user かつ防御ヘッダ付きで、リスクは低い（immutable 指定は配信性能のための意図的設計）。
- **結論（現状は変更不要 / 将来の必須要件）**: 現構成（user-content = `CACHING_DISABLED` の default behavior）は cache TTL 残存リスクを構造的に回避済のため、**cache invalidation / Vary 戦略 / cache TTL の見直しは現時点で不要**。将来 user-content を cache する behavior（短 TTL でも）へ移す場合は、**必ず (i) `Content-Type` / `Content-Disposition` を cache key に含める（Vary 相当）、(ii) 十分短い TTL、(iii) content 変更時の invalidation 経路**を同時に設計すること（これらを欠くと content-type 残存 = stored-XSS 再解釈のリスクが復活する）。**実 CDK（cache policy / behavior）変更は staging smoke test を要するため本 slice では行わず、上記を将来要件として明文化するに留める**（現状は防御が成立しているため実変更不要）。

##### S3 直配信 behavior の bypass 防御（AC3）

- **現状方針**: user-content の S3 直配信 behavior は**採用しない**。CloudFront が S3 origin を直結する behavior は静的アセット 2 種のみ（`/error/*` エラーページ / `/_app/immutable/*` immutable アセット、いずれも attacker-controllable でない）。user-content は常に Lambda（SvelteKit endpoint）が `readFile()` → 認証・tenant 一致・content-type 正規化・`Content-Disposition` 付与を通して配信する。
- **将来 S3 直配信を足す場合の必須要件**: S3 stored content-type が Lambda ヘッダを bypass するため、**S3 object metadata に `Content-Disposition`（ラスタ画像のみ `inline` / SVG・audio・不明 type は `attachment`）と正規化済 content-type を書き込み**、配信点（Lambda）と同等の防御を object 側で担保する。加えて cross-tenant IDOR 防止（§5.2.1 の tenant 一致検証）を OAC / bucket policy / 署名付き URL 等で別途担保する必要があり、Lambda 経由配信の認証・認可を S3 直配信で再現するのは非自明なため、**Pre-PMF では S3 直配信を採用しない**（ADR-0010）。
- **機械強制（fitness function）**: `tests/unit/architecture/cloudfront-s3-user-content-bypass-fitness.test.ts` が `infra/lib/network-stack.ts` を静的走査し、S3 origin を持つ behavior が静的アセット allowlist に分類済 / user-content prefix を S3 直配信していない / default behavior が Lambda origin である / `new cloudfront.Distribution` が network-stack.ts のみであることを表明する。user-content を S3 直配信する behavior（例: `/uploads/avatars/*` → S3 origin）を足すと CI が red になり、上記必須要件の伴走なしに bypass が入るのを防ぐ（14-セキュリティ設計書 §7.2.1 の route 層 fitness を補完する CDK 層 fitness）。

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
| `DATA_SOURCE` | `dsql` | `demo` | PR #2120 demo Repository / Auth Provider 起動 trigger (本番 = Aurora DSQL、cutover 完遂 / #3438 で dynamodb backend 撤去) |
| `AUTH_MODE` | `cognito` | `anonymous` | AnonymousAuthProvider 起動 |
| `ORIGIN` | `https://ganbari-quest.com` | `https://demo.ganbari-quest.com` | absolute URL 解決 |
| `DSQL_ENDPOINT` / `DSQL_USER` | (注入) | **未注入** | demo は in-memory fixture（本番は Aurora DSQL、`DYNAMODB_TABLE` / `TABLE_NAME` は #3438 で撤去） |
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
- Origin Shield: 本番と同型に `/_app/*` の `demoStaticAssetOrigin` で有効 (region `us-east-1`、#3087)。default behavior origin は本番同様 shield なし
- S3 静的アセット offload (#3087 解決策 B): 本番と同型に `/_app/immutable/*` を S3 (OAC) から配信 (`staticAssetsS3Offload=true` 時)。本番と demo は同一 Docker image (= 同一 build) の immutable アセットを配信するため `StaticAssetsBucket` を 1 つ共有し、distribution ごとに OAC を持つ
- セキュリティヘッダ: 本番と同一 (`SECURITY_HEADERS` policy)
- CloudFront Function: query slash encode のみ (本番も同一。IP allowlist は持たない、#4266)
- geoRestriction: `JP` (本番と同一、Pre-PMF 段階)

**Route 53:**
- A レコード: `demo.ganbari-quest.com` → DemoCDN (ALIAS)
- AAAA レコード: 同上

#### IAM 分離検証

`tests/unit/infra/multi-lambda-cdk.test.ts` が CDK synth 時点で以下を強制:

1. **C-1 (load-bearing security control)**: DemoLambdaRole の `Policy.PolicyDocument` に DynamoDB / Cognito / Secrets Manager / SES の action が一切含まれない
2. **C-2**: NetworkStack に CloudFront Distribution が 2 本ある (alias `ganbari-quest.com` と `demo.ganbari-quest.com`)
3. **C-3**: demo Fn の env に DATA_SOURCE='demo' + AUTH_MODE='anonymous' が含まれる、本番 secret が含まれない

将来「demo に本番 DB / secret アクセスを追加した方が楽」と誤って IAM grant を追加した瞬間に CI が落ちる構造になっている。これがこの設計の最大の load-bearing 保証。

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
| Production (`ganbari-quest.com`) | `cognito` | `dsql` (AWS 本番) / `sqlite` or `pglite` (NUC) | `false` |
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

`deploy-nuc.yml` は public repo の self-hosted runner で動作するため、**self-hosted NUC runner 上で実行できる actor を ADR-0022 体制で想定済みの actor に限定する** ために actor 許可リストで gate する (`if: contains(fromJSON('["Takenori-Kusaka", "ganbariquestsupport-lab"]'), github.actor)`)。本 workflow の trigger は `push: branches=[main]` + `workflow_dispatch` のみであり、fork PR からの直接 push は GitHub の保護 (fork 側に upstream main への push 権限がない) により発生せず、`workflow_dispatch` も upstream リポジトリの権限がある actor からしか発火しない。したがって本 gate の目的は「fork PR 防御」ではなく、**想定外の actor (誤って付与された collaborator / 将来の admin bypass / bot 等) による NUC 本番マシン上での任意コード実行を防ぐ**こと。許可は (1) **Takenori-Kusaka** (PO / repo owner) と (2) **ganbariquestsupport-lab** (ADR-0022 QM merge 体制の squash merge actor) の 2 account のみ。AWS Lambda 側 `deploy.yml` は GitHub-hosted runner + OIDC で動くため本 gate は不要。新たな信頼 account を追加する場合は本リストに 1 行追記すれば足り、構造変更は伴わない。

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

本番 deploy 経路 (CDK synth → ECR push → Lambda update → health) そのものを統合 PR で検証するため、本番 6 stack の staging 版を `deploy-aws-staging.yml` で構築する。staging は **4 stack** (`GanbariQuestStorageStaging` / `GanbariQuestAuthStaging` / `GanbariQuestComputeStaging` / `GanbariQuestNetworkStaging`)。Ses / Ops は省略する。

**Network (CloudFront) は staging にも必要**: SvelteKit の名前付き form action (`?/action`) は Lambda Function URL がクエリ文字列のスラッシュを拒否するため、CloudFront Function `<prefix>-query-slash-encode` を通さないと届かない。`/auth/login` / `/auth/signup` はいずれも default action を持たず名前付き action しかないため、これが無いと staging では**ログインもサインアップもできない** (= 認証後の画面に到達する手段がゼロ)。staging の ORIGIN / post-deploy smoke は CloudFront を入口にする。

| 項目 | 本番 (`deploy.yml`) | AWS staging (`deploy-aws-staging.yml`) |
|---|---|---|
| stack | 6 stack (`GanbariQuest{Storage,Auth,Compute,Network,Ses,Ops}`) | 4 stack (`GanbariQuest{Storage,Auth,Compute,Network}Staging`)、明示列挙 deploy (`--all` 不使用) |
| CloudFront geoRestriction | JP allowlist | **なし** (post-deploy smoke を回す GitHub runner が日本国外にあるため)。前提 = staging に本番データを入れないこと。入れる運用が生まれたら JP allowlist を戻す |
| CloudFront 物理名 | `ganbari-quest-query-slash-encode` / `ganbari-quest-error-pages-<account>` | `ganbari-quest-staging-` prefix (同一アカウント・同一リージョンでの衝突回避)。prod 側の名前は不変 (ADR-0019) |
| 物理名 prefix | `ganbari-quest` | `ganbari-quest-staging`（Lambda `ganbari-quest-staging-app` / log group / pool / bucket / ECR repo） |
| SSM prefix | `/ganbari-quest/` | `/ganbari-quest-staging/`（`context-token-secret` は workflow が冪等 put） |
| ECR repo | `ganbari-quest`（maxImageCount:10） | `ganbari-quest-staging` 専用 repo（maxImageCount:3。prod repo 共有は rollback `[-2]` digest 選択 + lifecycle を staging push が侵食するため不採用） |
| Cognito | custom domain `auth.ganbari-quest.com` + Google IdP | default domain（prefix `ganbari-quest-staging`）。Google IdP / Route53 省略。SSM `cognito/domain` param は default domain 値で必ず書く |
| 外部サービス env | Stripe / Discord / Gemini / SES 注入 | Discord / Gemini / SES は**非注入**（SES / Cost Explorer の IAM grant も付与しない）。**Stripe は test mode のみ注入**（#4104。test mode は本番顧客・本番決済に影響しないため「本番への副作用ゼロ」は保たれる。live は 2 段の機械強制で停止 — workflow の synth 前 prefix 検査 + ComputeStack の allowlist `sk_test_`/`rk_test_`。price id は `USE_LOOKUP_KEY=true` で lookup_key 解決に寄せ env を増やさない。webhook signing secret は test/live とも `whsec_` で判別不能なため形式検査のみ = 守れない範囲として明示。手順 SSOT: [runbooks/staging-live-verification.md §9](../runbooks/staging-live-verification.md)） |
| demo Lambda / cron-dispatcher / log archiving | あり | なし（`enableDemoLambda` / `enableCronDispatcher` / `enableLogArchiving` = false） |
| RemovalPolicy | RETAIN | DESTROY（使い捨て可能） |
| trigger | `push: [main]` + tag + dispatch | `pull_request: [main]`（統合 PR、paths filter 付き）+ dispatch（develop HEAD） |
| ADR-0019 gate | `check-cdk-replacement.mjs` ×2（Storage / all） | 同 script 再利用 ×2（StorageStaging / staging 4 stack） |
| tag | — | `gq-env=staging`（staging 4 stack に付与） |

実装方式: 既存 stack class に optional `envConfig` props（`infra/lib/env-config.ts` の `GqEnvConfig`、default = `PROD_ENV_CONFIG` = 現行 prod 値）を追加。staging 専用 class の複製は二重管理のため不採用。`infra/bin/app.ts` は `-c stagingEnabled=true` の context gate でのみ staging 4 stack を instantiate するため、本番 `cdk deploy --all` / `cdk diff --all` の挙動は不変。

- **prod template 不変 3 重防御**: ① optional props + prod default で diff ゼロ設計 ② `tests/unit/infra/staging-cdk.test.ts` の prod 不変 guard（synth-time、`ganbari-quest` table / `ganbari-quest-app` Fn / `ganbari-quest-users-v2` pool 等の物理名 assert）③ 本番 `deploy.yml` の ADR-0019 gate（deploy-time）。
- **ORIGIN 解決**: Function URL は synth 時未確定（自己参照）のため CDK は placeholder を注入し、workflow が `get-function-url-config` で解決して jq read-modify-write で `update-function-configuration` する（health / smoke は GET のみで ORIGIN 非依存のため縮退可）。
- **統合 PR の staging 既定 backend = 本番 backend (#3685、cutover 完遂後の恒常一致)**: 本番 cutover 完遂 (AWS=dsql / NUC=pglite) 後、統合 PR (pull_request) では **DSQL lane / PGlite lane を常時自動実行**する (`DSQL_LANE` / `PGLITE_LANE` を pull_request で 'true')。旧「pull_request では常に現行 dynamodb/sqlite lane」= 本番と staging の backend 乖離を解消し「本番構成 = staging 構成」を恒常一致させる。**AWS staging に backend の選択肢は無い** (#4224): DSQL が唯一の backend であり `ComputeStack` が `dsqlEndpoint` を無条件必須にするため、lane を off にできる入口を持たない (`workflow_dispatch` に input 無し / `DSQL_LANE` 分岐無し)。不変条件は `tests/unit/infra/staging-dsql-lane-always-on.test.ts` が守る。NUC staging の `pgliteEnabled` は同型の入口を残している。**advisory** (本 workflow 群は required check 未登録) で開始し、緑実証後に required 化を audit-manager が判断。cutover PR で「staging 既定を新 backend へ切替える」規約は本項が SSOT。
- **責務分界 (G-PD / G-MIG)**: DSQL lane では staging Lambda が `DATA_SOURCE=dsql` で `applyLazyStartupMigrations` を通り migration 込み起動 (G-MIG) を検証する。NUC staging (§4.2 / #2872) も PGlite lane で migration 込み起動を主担保する。#2873 の中核責務は「本番 deploy 経路の貫通 + post-deploy health (G-PD AWS 側)」。
- **コスト影響 (#3685 AC4)**: 統合 PR 毎の DSQL lane は既存 `GanbariQuestDsqlStaging` cluster (scale-to-zero) を再利用し新規作成しない。DSQL は idle 課金なし + 無料枠 10 万 DPU/月に対し検証 1 run ≈ TotalDPU 数百 (#3425 実測 233/検証日) で余裕。PGlite lane は NUC self-hosted runner 上で固定費ゼロ。統合 PR は低頻度 (release 単位) ゆえ従量も月数円未満。
- **データ戦略**: staging は本番と同型で Aurora DSQL cluster を空 provisioning（health / smoke はデータ非依存）。demo fixture (`DATA_SOURCE=demo`) は本番 backend (DSQL) の repository 経路を通らず staging の存在意義が消えるため不採用。本番相当データが必要になった場合は DSQL の論理エクスポート / import 経由で別 cluster に流し込む（本番 cluster へは一切 write しない）。旧 DynamoDB AWS Backup restore 経路は #3438 で DynamoDB 撤去により廃止。
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
| CloudWatch Alarms | 8アラーム（Lambda/CloudFront/Cron。DynamoDB alarms は #3438 で撤去） | 無料枠10個中8個使用 |
| CloudWatch Dashboard | 運用ダッシュボード | 無料枠3個中1個使用 |
| AWS Budgets | $5/月予算・3段階アラート | 無料枠2個中1個使用 |
| Cost Anomaly Detection | ML異常検知 | 完全無料 |

## 6. コスト試算（月額）

| 項目 | 無リクエスト時 | 100家庭 | 1,000家庭 |
|------|-------------|---------|----------|
| Route 53 | $0.50 | $0.50 | $0.50 |
| CloudFront | $0 | $0 | ~$0.10 |
| Lambda | $0 | $0 | ~$0.05 |
| Aurora DSQL | $0 | $0 | ~$0.03 |
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
│   ├── storage-stack.ts  # S3 + ECR + BackupVault(RETAIN-orphan、prod のみ、#3881 class 回避)。MainTable + BackupPlan/Selection は #3438→#3850→#3854 で撤去済、DB backend は DSQL
│   ├── dsql-stack.ts     # Aurora DSQL cluster (EPIC #3424)
│   ├── auth-stack.ts     # Cognito User Pool + SSM Parameters
│   ├── compute-stack.ts  # Lambda (本番 + demo #2097) + Function URL + IAM Role 分離
│   ├── network-stack.ts  # CloudFront (本番 + demo #2097) + Route53 + ACM + S3エラーページ + S3静的アセットoffload (#3087 解決策B)
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

## 7.2 アナリティクス基盤（on-demand DSQL 集計, #3805 / EPIC #3424）

### 採用方針

**外部 SaaS analytics は採用しない**（子供データ究極ミニマリズム原則 ADR-0023 §4.4 / A-Q1(C)）。かつ **always-on の event 収集も持たない**（#3805 で撤去）。marketing 分析（activation funnel / 解約率）は **DSQL の main data から必要時のみ on-demand 集計**する。常設収集・日次 cron・常設 dashboard は Pre-PMF で過剰（維持費 <¥100/月 target のボトルネック）ゆえ撤去し、分析能力のみを維持する。

| 項目 | 内容 |
|------|------|
| 収集方式 | なし（DynamoDB `ANALYTICS#` / `ANALYTICS_AGG#` / `CHALLENGE_AGG#` partition・日次 aggregator cron・provider を全廃、#3805） |
| 導出元 | DSQL main data（`families` / `children` / `activity_logs` / `cancellation_reasons`） |
| 実行契機 | 認証済 ops が `/ops/analytics` を開いた時のみ（on-demand、常時コスト 0） |
| 外部送信 | ゼロ（CSP `connect-src 'self'` で構造的に保証） |

### on-demand 集計サービス

`analytics-ondemand-service.ts` が read-only で 2 指標を DSQL main data から導出する:

| 指標 | 導出元 | 方式 |
|------|--------|------|
| Activation Funnel（signup → 初回子供登録 → 初回活動 → 7 日継続） | `families.created_at` 起点コホート + `children` / `activity_logs` を JOIN | 単一集約 SQL 1 発（`repos.activationFunnel`、ADR-0065 N+1 禁止） |
| 解約理由分布（30d / 90d） | `cancellation_reasons` | `repos.cancellationReason.aggregateRecent`（DSQL main data 由来） |

旧 step ④「初回報酬演出」は純 UI view event でデータ痕跡がなく DSQL から導出不能のため drop し、engagement 本質の「7 日 retention」を ④ に据える（#3805）。

### `/ops/analytics` 可視化

`ops_users` group 認証必須。Activation Funnel（on-demand DSQL）+ Retention Cohort（`cohort-analysis-service`）+ Sean Ellis スコア（`pmf-survey-service`）+ 解約理由分布（`cancellation-service`）+ setup チャレンジ選択分布（`settings` を on-demand N+1 read）を `Promise.allSettled` で部分縮退表示する。いずれも tenant 状態・main data のスナップショットで、event log は使わない。旧 `/admin/analytics` は #2283 EPIC で全面撤去済。

### CSP との整合

アプリ側 CSP (`svelte.config.js` `kit.csp`、#3829 / ADR-0067 で `hooks.server.ts buildCspHeader()` から移管) は外部送信先を一切ホワイトリストしない (`connect-src 'self'` 固定)。新たな外部 SaaS analytics を導入する場合は、本セクションと ADR-0023 §3.4 ホワイトリストの両方を更新する PR を先に通すこと (ADR-0006 安全弁削除禁止)。

### Pre-PMF (ADR-0010) スコープ

- on-demand ゆえ常時コスト 0。実行時のみ DSQL DPU を消費（cross-tenant range scan は少数、ADR-0065 整合）
- HyperLogLog 等の近似 sketch は post-PMF（~10,000+ tenants）で再検討

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
2. **インフラ統一**: Lambda + Aurora DSQL + Cognito + S3 の AWS 構成に Bedrock を追加することで、IAM ベースの認証に統一。API キー管理（SSM 等）が不要に
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
