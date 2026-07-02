# Aurora DSQL 新規導入 — 運用・コストガードレール調査（EPIC #3424 SSOT）

| 項目 | 内容 |
|---|---|
| 調査日 | 2026-06-28（転記 2026-06-29） |
| 関連 EPIC | #3424（DynamoDB → Aurora DSQL 移管） |
| 関連 rationale | `docs/rationale/13-aurora-dsql-migration-evaluation-rationale.md`（料金・特性 SSOT、結論は EPIC #3424 で supersede） |
| 前提 | 既存 DynamoDB データ移行は**不要**（ゼロから DSQL に作り直す）。料金は無料枠 + scale-to-zero で **≤¥100/月**。東京 $0.00001/DPU・$0.40/GB-month |

> 本ファイルは EPIC #3424 の調査 SSOT。設計 Sub / PoC spike の前提となるガードレールを一次ソース付きで集約する。PoC spike 完了時は各 issue の実測結果を本ファイル末尾「PoC 実測ログ」に追記する。

---

## 0. 着手時 deep research 必須プロトコル（EPIC #3424 配下 全 issue 共通）

> ⚠️ **本領域はプロダクトの基盤であり、この領域の設計不良は許されない。** EPIC #3424 配下の **全 issue（設計 Sub / PoC spike / 実装 PR）は着手時に必ず以下 8 軸 + メタ問いで多角的 deep research を実施**し、結果を当該 issue / 本ファイルに追記してから設計・実装する（2026-06-29 PO 指示）。

**8 軸**:
1. **公式ドキュメント**: AWS Aurora DSQL 公式で当該事項がどう規定されているか（一次ソース URL 必須）
2. **適合デザインパターン**: このプロダクトに適合する設計パターン（システム / API / クラス・モジュール / DB）はどうなるか
3. **OSS 採用事例**: 採用実績のある OSS ではどう実装されているか
4. **公式推奨整合**: 採用ライブラリ / フレームワークが公式の推奨に近い実装になっているか
5. **独自実装の要否**: 本当に独自実装でしかできないことなのか（OSS / 確立パターンで代替不可か）
6. **将来性・保守性・セキュリティ・IAM**: 将来性・保守性・セキュリティ・IAM によるアクセス制御はどうあるべきか
7. **既存データ整合性**: 既存のデータとの整合性はどうか
8. **運用費用**: 運用費用を増やさない施策が盛り込めているか（DPU / ストレージ / Budgets¥100）

**メタ問い（必須・二段階 research）**: 上記 8 軸の結果について **「本当にそれを採用すべきか」という問いをさらに立てて再 deep research** し、**手戻りのない設計**を確定する。

整合 ADR: ADR-0014（OSS 先調査・最低 2 件）/ ADR-0010（Pre-PMF）/ ADR-0061（shift-left）/ ADR-0008（設計ポリシー先行確認）。本プロトコルを満たさない設計 Sub / 実装 PR はレビューで差し戻す。

---

## 1. コストガードレール

- DPU = ComputeDPU + ReadDPU + WriteDPU。**バイト数 + CPU 秒**で課金（行数でない）。
- ReadDPU = max(読込B, 2048) × 0.00000183105（txn 最小 2048B）。WriteDPU = max(書込B, 1024) × 0.00004883（txn 最小 1024B、書込は必ず PK index read も発生）。
- **WriteDPU 単価は ReadDPU の約 27 倍** → 書込集約がコスト主因。
- **スキャン行全部が課金**（フィルタ後返却行でなく）。→ index で scan 範囲を絞る。
- アンチパターン: フルスキャン / N+1（小 txn 多発 → 最小値課金が割高、batch 化せよ）/ 不要 secondary index（全 index 書込課金、最大 24/table）/ hot key write 集中（OCC 競合 → 再実行二重課金、ランダム PK 分散）。
- **無料枠超過検知**: CloudWatch `AWS/AuroraDSQL`（dimension ClusterId）— Usage: WriteDPU/ReadDPU/ComputeDPU/TotalDPU。Observability: ClusterStorageSize/TotalTransactions/QueryTimeouts/OccConflicts/CommitLatency(P50)/BytesWritten/BytesRead/ComputeTime。接続系 `AWS/Usage`: ResourceCount(ClusterConnectionCount)/CallCount(DbConnect)。
  - Alarm: TotalDPU 日次 Sum > 約 3,225DPU/日(=10万/月)、ClusterStorageSize→1GB 接近。Budgets ¥100 + 80/100%。Cost Anomaly Detection。
  - 注: cost-review skill は Cost Explorer API 直叩き禁止（$0.01/req）→ CloudWatch + Budgets で代替。
- `EXPLAIN ANALYZE VERBOSE`（VERBOSE 必須）で文末 Statement DPU Estimate。directional 相対比較用（billing-grade でない）。代表データ量でテスト。CI は相対回帰チェック向き、絶対閾値 gate 不向き。

## 2. コネクション（Lambda）

- 認証 = 短命 IAM トークン（`@aws-sdk/dsql-signer` DsqlSigner、既定 15 分、延長非推奨）。接続確立後はトークン期限切れ後も接続有効、**律速は接続 60 分ハード上限**。
- 上限: 同時 10,000（調整可）/ レート 100/秒（調整不可）+ バースト 1,000 / 接続寿命 60 分（調整不可）。
- **サーバサイドプーラ（PgBouncer/pgpool/RDS Proxy 相当）禁止**。クライアントプール（maxLifetime<60 分, 実用 45-55 分）。
- Lambda: ハンドラ外で接続生成し実行コンテキスト再利用。Node は `@aws/aurora-dsql-node-postgres-connector`（pg.Pool 拡張, トークン自動更新）or `pg` + DsqlSigner を password 非同期関数で。Drizzle は `drizzle-orm/node-postgres` でそのまま（AWS 公式 blog 実証）。

## 3. モニタリング / 可観測性

- アラーム: OccConflicts / QueryTimeouts(5 分上限) / CommitLatency P50 / ClusterConnectionCount(10,000 接近) / DbConnect CallCount(100/秒接近) / TotalDPU・ClusterStorageSize。CW 15 ヶ月保持。
- バックアップ/PITR: DSQL 自動 backup 機構なし → **AWS Backup 統合**で PITR（continuous backup）。復元 = 新クラスタ作成（上書きなし）、同時 restore 最大 4。→ アプリ層 backup-archive（JSON/CSV）は論理 backup として併存価値あり（別レイヤー）。

## 4. スキーマ / マイグレーション

- 非対応 / 特殊: 外部キー無し（アプリ層整合）/ トリガ無し / PL/pgSQL 無し / CREATE INDEX ASYNC / TRUNCATE 不可 / VACUUM 不要 / 分離レベル Repeatable Read 固定 / DDL・DML 別 txn・1txn1DDL / 1DB（postgres 固定）・schema 最大 10・table 最大 1,000・collation C 固定・TZ UTC。シーケンスは現在対応（上限 5,000）だが分散では UUID 推奨。
- ツール: Drizzle は node-postgres 経由で動作（AWS 公式 Drizzle × DSQL × Lambda × CDK blog）。drizzle-kit（pg）使用可だが CREATE INDEX ASYNC / DDL-DML 分離 / 1txn1DDL に生成 SQL が抵触しないか要 PoC。
- マルチテナント: 1cluster=1DB → **tenantId 列ベース行分離**（schema 分離は最大 10 で家族数に不足）。全テーブル tenantId 必須 + 全クエリ WHERE tenantId 強制（現行 single-table 方針と同じ）。

## 5. OCC（楽観的同時実行制御）

- 競合 = SQLSTATE 40001。OC000 = データ競合（コミット早い方勝ち）/ OC001 = スキーマ競合。
- リトライ定石: 冪等設計第一 + abort & retry（指数バックオフ + jitter, 最大 N 回, 冪等 txn のみ）。service 層に共通 retry ラッパ 1 箇所集約。
- 競合減: ランダム PK で更新分散、狭い key range の高競合回避。

## 6. 書込 txn 上限の波及（backup 一括 import / 復元）

- ハード上限（調整不可）: 1 書込 txn = 最大 3,000 行 / 10 MiB / 最大 5 分 / クエリメモリ 128 MiB / 行 2 MiB。
- backup-archive 一括復元が 3,000 行 or 10 MiB 超なら単一 txn all-or-nothing 不可。選択肢: (1) チャンク分割（≤3000 行 / ≤10MiB）+ 冪等 upsert (2) import バッチ ID + 進捗マーカで部分失敗を冪等再適用 (3) saga（「import 中」フラグ → 全 chunk 成功後 commit フラグ、結果整合）。

## 7. CDK プロビジョニング

- `AWS::DSQL::Cluster`（CloudFormation）あり。プロパティ: DeletionProtectionEnabled / KmsEncryptionKey / MultiRegionProperties / PolicyDocument（≤20KB）/ Tags。GetAtt: Identifier / ResourceArn / Endpoint / Status / VpcEndpointServiceName / CreationTime。
- 東京シングルリージョン = MultiRegionProperties 指定しないだけ。CDK は aws-cdk-lib L1 `CfnCluster`（aws_dsql）。L2 標準なし。本番 DeletionProtectionEnabled:true（ADR-0019 Replacement gate 整合確認）。

## 8. EPIC 事前整理 Issue（設計 = 紙上確定 / PoC = 実機検証 の別）

起票済（EPIC #3424 配下）:

- **設計 Sub**: #3430 DPU クエリ規約 ADR / #3431 CloudWatch Alarm+Budgets+Anomaly IaC / #3432 DSQL アラーム dashboard / #3433 sqlite→pg 型差分洗い出し / #3434 tenantId 列分離 fitness function / #3435 OCC retry ラッパ / #3436 backup 一括 import チャンク+saga 設計 / #3437 DSQL backup(AWS Backup) とアプリ backup 役割分担 / #3438 db/dynamodb 撤去計画 + rationale 13 supersede
- **PoC spike**（新サービスゆえ実測必須）: #3425 実 DPU/OCC 競合率 / #3426 Lambda 接続再利用 + cold start / #3427 drizzle-kit DDL 制約適合（ASYNC index 等）/ #3428 一括 import 3,000 行/10MiB 抵触実測 / #3429 L1 CfnCluster 東京最小構成 spike。

---

## 9. de-risking deep research 結果（2026-06-29、致命リスク 8 点判定）

着手前に「致命的リスク 8 点」を一次ソース + SQL マルチテナント実装 14 件で多角検証した（プロトコル §0 適用）。全結果:

| リスク | verdict | 要旨 |
|---|---|---|
| B コスト | **NOT-TRIGGERED** | scale-to-zero は本物・固定費/最低課金なし、無料枠 perpetual。本ワークロード試算 約180 DPU/月（無料枠 0.18%）→ 実費 ¥0 見込み。東京単価は要最終確認 |
| C 性能 | **NOT-TRIGGERED**（定常）/ Lambda 接続 **NEEDS-POC** | 単一リージョン・低競合で read 数ms・write 低ms と DynamoDB 同等。OCC 300ms 罰則は書込競合時のみ＝1家族では非該当。Lambda cold 接続確立のみ実測 |
| A スキーマ一本化 | **NOT-TRIGGERED** | AWS 公式 Drizzle blog: pg-core schema 1 本で済む（差は SERIAL→UUID 等の型選択のみ）。FK→relations / SERIAL→UUID / JSONB→TEXT の片方向移植。SQLite 残置 2 バックエンドは不採用 |
| F CDK/IaC | **NOT-TRIGGERED** | L1 `AWS::DSQL::Cluster` 主要プロパティ No-interruption（ADR-0019 Replacement リスク低）。alpha L2 `aws_dsql_alpha` 実在（要 pin）。IAM grant helper 欠如のみ手書き |
| E docs | **NOT-TRIGGERED** | 移行ガイド・drizzle-kit migration の落とし穴（SERIAL tracking / ASYNC index）まで公式文書化。空白はローカル開発戦略のみ |
| D テスト維持性 | **NEEDS-POC（部分 TRIGGERED）** | ドライバ/ORM は AWS 公式実証済で問題なし。**公式ローカルエミュレータ無し**（Playground のみ）→ in-memory SQLite テスト資産を PGlite(unit)+Testcontainers postgres:16(integration)+実DSQL契約テスト(OCC/3000行/FK拒否)の 3 層に再構築。PG/PGlite は OCC・3000行・FK拒否を再現できず静的ガード併設が必要。Node connector は OCC リトライ内蔵なし（自前実装、Drizzle 公式に例あり） |
| **G マルチテナント×IAM** | **解消（条件付き GO）** | 下記 §10 参照。「IAM で行レベル物理分離」は SQL では不成立（IAM は接続/クラスタレベルまで、`LeadingKeys` 等価物なし）。**RLS（CREATE POLICY）は DSQL 非対応の確度高**。但しコスト最優先の PO 判断で、現 DynamoDB single-table も同じ app-layer 強制であり**非悪化** → pool + 信頼 claim/context + fitness function で論理分離を確定 |
| **H プロダクト本質** | **非該当（PO 判断で受容）** | RLS 非対応で「DB エンジン強制の砦」は得られないが、現状（DynamoDB）から悪化せず、得られたはずのメリットが 1 つ無いだけ。子供データ保護はアプリ層単一強制点 + CI guard + cross-tenant E2E で担保 |

**収束した強シグナル（記録）**: 調査 A/D が独立に「Postgres 系（Aurora Serverless v2/RDS）なら RLS・移植・テストが容易」と提言。しかし **scale-to-zero・≤¥0 を絶対制約とする PO 判断で Serverless v2/RDS は不採用**（最小 ACU アイドル課金が制約に反する）。DSQL の scale-to-zero がコスト最優先要件に唯一適合。

### de-risking 一次ソース（主要）
- コスト/性能: billing-metering / pricing / FAQs / [DSQL for financial transactions(perpetual free tier+OCC)](https://aws.amazon.com/blogs/database/amazon-aurora-dsql-for-global-scale-financial-transactions/) / [Performance,Limits&Architecture](https://andrewbaker.ninja/2025/11/19/amazon-aurora-dsql-performance-limits-architecture/)
- スキーマ/CDK: [Drizzle ORM in Aurora DSQL(AWS Blog)](https://aws.amazon.com/blogs/database/building-type-safe-applications-with-drizzle-orm-in-aurora-dsql/) / [DSQL SQL Dialect](https://aws.amazon.com/blogs/database/dsql-sql-dialect-how-amazon-aurora-dsql-differs-from-single-instance-postgresql/) / [CFN AWS::DSQL::Cluster](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-dsql-cluster.html) / [aws_dsql_alpha L2](https://docs.aws.amazon.com/cdk/api/v2/python/aws_cdk.aws_dsql_alpha/Cluster.html) / [aws-cdk#34593](https://github.com/aws/aws-cdk/issues/34593)
- テスト: [Concurrency control(公式)](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-concurrency-control.html) / [node-postgres connector](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/SECTION_program-with-dsql-connector-for-node-postgres.html) / [Playground(ローカルエミュ無し)](https://www.infoq.com/news/2026/03/aurora-dsql-playground-updates/) / [Testcontainers postgres](https://testcontainers.com/modules/postgresql/)
- マルチテナント/IAM: [Supported SQL(CREATE POLICY 不在)](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-supported-sql-features.html) / [ALTER TABLE(ENABLE RLS 不在)](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/alter-table-syntax-support.html) / [DbConnect/DbConnectAdmin](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/using-database-and-iam-roles.html) / [Securing DSQL access control](https://aws.amazon.com/blogs/database/securing-amazon-aurora-dsql-access-control-best-practices/) / [Prescriptive pool+RLS](https://docs.aws.amazon.com/prescriptive-guidance/latest/saas-multitenant-managed-postgresql/partitioning-models.html) / [DynamoDB LeadingKeys(SQL に等価物なし対比)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/specifying-conditions.html)

---

## 10. テナント分離アーキテクチャ確定（PO 判断 2026-06-29、最重要設計）

> **方針**: コスト最優先（≤¥0 死守）。テナント = 家族グループ（`tenant_id` 列）。**Pool（単一クラスタ・行分離）+ 信頼 claim/context による論理分離 + 機械強制（fitness function + cross-tenant E2E）**。RLS は DSQL 非対応のため追わない（現 DynamoDB single-table も app-layer 強制であり**非悪化**）。

### なぜ pool + app-layer 強制か（silo / RLS を採らない理由）
- **silo（1家族=1クラスタ）不採用**: IAM 物理分離は真に成立するが、全クラスタへの N 回マイグレーション / サインアップ毎の provisioning / アカウント quota / 横断集計不能 / 無料枠アカウント単位共有 / 運用 N 倍 が pre-PMF に過剰（ADR-0010）。将来 enterprise/規制テナント出現を再検討トリガとして ADR 化。
- **RLS 不採用**: DSQL は `CREATE POLICY`/`ENABLE ROW LEVEL SECURITY` を Supported SQL に持たない（確度高、確証は実機 POC 1 回）。現状 DynamoDB も RLS 非依存のため移行で悪化しない。

### 「実効力ある論理分離」の機構（DB は JWT を読まない点に注意）
1. **Cognito で家族グループ（tenantId）を信頼確立**: 現状は JWT 検証後に membership を DB 解決し**署名付き context cookie**へ（`providers/cognito.ts` / `context-token.ts`）。**Pre-Token-Generation Lambda で familyId を JWT custom claim に載せる方式は最適化オプション**（毎リクエストの membership 解決を省けるが claim 陳腐化対策が要る）。どちらも tenantId は**偽造不能**。
2. **アプリ層が信頼 tenantId を全クエリへ注入**: DSQL/Postgres は JWT を解釈しない。`hooks.server.ts` が検証済 tenantId を確定 → tenant-scoped repository が `WHERE tenant_id = :tenantId` を常に注入。
3. **「実効力」の源泉 = 偽造不能 claim**: ユーザーは自分の tenantId を他家族に書き換えられない（署名検証で弾かれる）→ 悪意ある cross-tenant read は不成立。AWS が RLS 無し pool で使う信頼モデルと同型。
4. **残存リスク（開発者の WHERE 書き忘れ）を機械強制で閉じる**:
   - tenant-scoped repository を**単一強制点**化（生クエリ発行を境界外で禁止、既存 `route-db-boundary.test.ts` と同型）
   - **fitness function**: `tenant_id` 述語の無い SELECT/UPDATE/DELETE を AST/lint で CI hard-fail（RLS の代替防御線、ADR-0061 整合）
   - **cross-tenant E2E 不変条件**: 家族 A の token で家族 B のリソースを叩き 403/空 を assert（既存 IDOR hardening #3228 と同型）

### クラウド / NUC 両立（同一リポジトリコード）
| 軸 | クラウド（DSQL, multi-tenant） | NUC（SQLite, single-tenant） |
|---|---|---|
| tenant context | Cognito 由来 tenantId（claim or membership+署名cookie） | 固定シングルトン（その NUC 唯一の家族 ID） |
| repository | `WHERE tenant_id = :ctx` 注入 | 同一コード（単一家族で実質 no-op フィルタだが正しく動く） |
| 分離強度 | 論理（pool）+ app-layer 機械強制 | 物理（1家族=1 SQLite ファイル） |

→ 同一 tenant-scoped repository が両環境で正しい。NUC は SQLite ファイル自体が物理分離なので tenantId 列は将来クラウド移管との型互換のために持つだけ。コードパス 1 本化。

### この設計の machine 強制を担う Sub
- **#3434（設計⑤ tenantId 列分離 fitness function）= 本設計の中核**。Cognito claim/context → tenant context 解決 + tenant-scoped repository 単一強制点 + fitness function + cross-tenant E2E を内包する。
- **RLS 非対応の最終確証**（実クラスタで `CREATE POLICY`/`ENABLE RLS` を 1 回試行）は安価な確認 POC として #3434 の前提確認に含める（非対応でも設計は変わらない＝blocker ではない）。

---

## 11. PoC 実測ログ

### 11.1 実機 spike #1（2026-06-29、本番同一リージョン us-east-1、実 DSQL クラスタ）

> **リージョン訂正（重要）**: 本番インフラは **us-east-1**（`infra/bin/app.ts: region: 'us-east-1'`、GanbariQuest{Compute,Auth,Storage,Network,Ops,Ses} スタックは全て us-east-1。ap-northeast-1 は空）。本研究の初稿が「東京」前提だったのは誤り。**移管先リージョン = us-east-1**。DSQL 単価も us-east-1（$0.000008/DPU・$0.33/GB）の方が東京より安く、コスト最優先にも合致。

使い捨てクラスタ（deletion protection off、tag `ephemeral=true`）を作成し `pg`(node) + IAM admin auth token で実検証 → 検証後削除。安全網として AWS Budgets `dsql-poc-guardrail`（$1・80/100% メールアラート）を先行作成。

**dialect / RLS 検証結果（実エラーコード付き）**:

| 検証 | 結果 | 設計含意 |
|---|---|---|
| `SELECT version()` | `PostgreSQL 16` | 想定どおり |
| `gen_random_uuid()` | ✅ ネイティブ動作 | UUID PK 標準利用可 |
| `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` | ❌ `[0A000] unsupported` | **RLS 非対応を実機確定**（推定→確証） |
| `CREATE POLICY` | ❌ `[0A000] unsupported statement: CreatePolicy` | テナント分離は pool + app-layer + fitness function 一択（§10 確定） |
| `FORCE ROW LEVEL SECURITY` | ❌ `[0A000] unsupported` | 同上 |
| `SERIAL` PK | ❌ `42704 type "serial" does not exist` | UUID PK 一択 |
| FK `REFERENCES` | ❌ `[0A000] FOREIGN KEY constraint not supported` | `relations()` アプリ層整合 |
| `CREATE INDEX`（同期） | ❌ `[0A000] unsupported mode. please use CREATE INDEX ASYNC` | drizzle-kit migration 改造必須 |
| `CREATE INDEX ASYNC` | ✅ `job_id` 返却 | ASYNC + job 完了待ち runner で対応可 |
| `generate_series` | ✅ 対応 | 一括 import / seed に利用可 |
| **3,000 行 / 1 txn** | ✅ commit 成功 | 上限境界 |
| **3,001 行 / 1 txn** | ❌ `[54000] transaction row limit exceeded` | **3,000 行上限を実機確定** → 一括 import チャンク分割必須（#3428/#3436） |
| 2 DDL / 1 txn | ❌ `[0A000] multiple ddl statements not supported in a transaction` | migration を 1 文/txn に分割（#3427/#3433） |
| DDL + DML / 1 txn | ❌ `[0A000] ddl and dml are not supported in the same transaction` | 同上 |
| **OCC 並行 update** | ✅ commitA=ok / **commitB=`40001`** | OCC 競合を実機再現 → リトライラッパ必須（#3435）。1 家族低競合では非発生だが機構は実在 |
| 接続確立レイテンシ（token 既発行・TLS+pg handshake） | **約 1,450 ms（cold）** | Lambda cold start で無視できない → 実行コンテキスト接続再利用が必須（#3426）。warm 再利用の実測は Lambda 上で別途 |

**コスト実測（見積 ¥0 との突合）**:
- ClusterStorageSize = **0.0**（空クラスタ）→ ストレージ課金 ¥0。
- PoC 全実行の **TotalDPU = 3.53**（Read 0.16 / Write 0.99 / Compute 2.38）= 無料枠 10万 DPU の **0.0035%**。仮に課金でも $8/100万DPU で **約 $0.00003 ≈ ¥0.004**。
- **作成費・固定費はゼロ**（DSQL に provisioning 料金なし）を実証。
- → **見積 ¥0 = 実測ほぼ ¥0 が一致**。Budgets guardrail は閾値未到達。

**結論**: §9-§10 の de-risking 推定が実機で全件裏取りされた。特に最重要の **RLS 非対応が確定**し、テナント分離設計（pool + 信頼 claim/context + fitness function + cross-tenant E2E）が唯一解であることが確証された。サプライズなし。残る実機検証（Lambda warm 接続再利用・cold start・drizzle-kit 実 migration 適用・一括 import チャンク実装）は設計 Sub 着手時に実施。

### 11.2 今後の spike（#3425-#3429 着手時に追記）

- （未実施: Lambda 接続再利用 + cold start / drizzle-kit 実 migration 適用 / 一括 import チャンク実装 / CDK CfnCluster 構成）

---

## 出典（一次ソース: AWS 公式）

**確認済み（rationale 13 で検証済の確定 URL）**:

- Aurora DSQL pricing: https://aws.amazon.com/rds/aurora/dsql/pricing/
- billing-metering: https://docs.aws.amazon.com/aurora-dsql/latest/userguide/billing-metering.html
- PostgreSQL 非対応機能 / 移行: https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-unsupported-features.html
- クォータ（CHAP_quotas）: https://docs.aws.amazon.com/aurora-dsql/latest/userguide/CHAP_quotas.html
- GA blog: https://aws.amazon.com/blogs/aws/amazon-aurora-dsql-is-now-generally-available/

**ページ名のみ確定・正確な URL は着手時 deep research（§0 プロトコル軸 1）で各 PoC/設計 issue が確定し本ファイルに追記**:

- CloudWatch monitoring（`AWS/AuroraDSQL` メトリクス一覧）
- understanding DPUs / EXPLAIN ANALYZE VERBOSE
- working-with-concurrency-control（OCC / SQLSTATE 40001）
- authentication-token（DsqlSigner / IAM 一時トークン）
- Lambda tutorial（接続再利用パターン）
- AWS::DSQL::Cluster CloudFormation リファレンス
- backup-aurora-dsql（AWS Backup 統合 / PITR）
- Drizzle × DSQL × Lambda × CDK の AWS Database Blog 記事

> ⚠️ 上記「ページ名のみ」群は本調査で参照したが、転記時点で URL 文字列の billing-grade な正確性を未再検証。**各 issue 着手時に §0 軸 1（公式ドキュメント一次ソース）で実 URL を取得し、本「出典」節へ確定 URL を昇格**する（誤リンク放置は基盤設計の品質欠陥に当たるため）。
