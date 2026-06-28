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

## 9. PoC 実測ログ（spike 完了時に追記）

> 各 PoC spike issue（#3425-#3429）完了時に、実測値（実 DPU / OCC 率 / cold start レイテンシ / drizzle-kit DDL 適合 / 一括 import 上限抵触 / CDK 構成）をここに追記し、設計 Sub の前提を裏取りする。

- （未実施）

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
