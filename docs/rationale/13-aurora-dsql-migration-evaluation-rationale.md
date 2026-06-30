# Aurora DSQL 移管評価（DB バックエンド一本化）設計経緯

<!-- 命名規則: NN-機能名-rationale.md -->

## 議論の発端

- **日時**: 2026-06-28
- **発端**: PO（ユーザー）からの技術選定依頼
- **問題意識**: 本番（AWS）は DynamoDB、ローカル / デモは SQLite を使っており、**NoSQL とリレーショナルの「データベースポリシー差」が設計を恒常的に複雑化**させている。Amazon Aurora DSQL（PostgreSQL 互換のサーバーレス分散 SQL）の費用・性能・特性を調査し、「運用費を月 100 円（≈$0.65）以下に死守する」制約を満たしつつ DynamoDB から移管する価値があるかを、**技術選定として評価できていない**状態を解消したい（採用しない結論でも可）。

## 現状の複雑さ（定量化、2026-06-28 時点のコード調査）

二重（実態は demo を含む三重）バックエンド併存の維持コスト:

- `src/lib/server/db/dynamodb/` = **39 ファイル / 約 11,000 行**（DB 層の約 38%、SQLite 実装 4,845 行の約 2.3 倍）。single-table 設計の PK/SK 変換・GSI 管理・`counter.ts`（AUTOINCREMENT 代替）等が重い。
- 1 概念 = interface 1 + 実装 3（dynamodb / sqlite / demo）= **原則 4 ファイル同期**。repo は 33 個。
- スキーマ変更 1 回で **5〜6 箇所**を手動同期（`schema.ts` / `create-tables.ts` / `global-setup.ts` / `test-db.ts` / `demo-data.ts` / `dynamodb/keys.ts`）。
- 二重実装の同期漏れを守る**専用 CI ゲート 2 本**（`check-dynamodb-stub.mjs` / `check-dynamodb-stub-parity.mjs`）。過去に「DynamoDB 未実装のまま merge → 本番 write 消失で UI が "N 件登録" と偽装」CRITICAL（#2824 / #1009）を生んだ構造的負債の証跡。
- Drizzle ORM は **SQLite 側のみ**。DynamoDB 側は AWS SDK 手書きで型安全・マイグレーション生成の恩恵が片側にしか効かない。

## 調査結果（一次ソース: AWS 公式、bulk price list `20260507014958` / 2026-05-07）

### 費用 — 月 100 円制約は完全クリア（ただし決め手にならない）

- DSQL は **完全従量・scale-to-zero・固定費ゼロ**。毎月「最初の 10 万 DPU + 1 GB ストレージ」が無料枠。
- 東京（ap-northeast-1）単価: **$0.00001/DPU（$10/100 万 DPU）・$0.40/GB-month**（us-east-1 は $0.000008/DPU・$0.33/GB で約 2 割安）。
- 想定（1 テナント・DB 数十 MB・月数千リクエスト）: **無料枠内で実質 $0**、枠を無視しても **約 $0.02/月**。$0.65 目標を 1〜2 桁下回る。
- **ただし DynamoDB on-demand も同規模では実質 $0**（ストレージ 25 GB 無料枠 + リクエスト課金、アイドル $0）。→ **コスト削減は移管の動機にならない**。

### 特性・制約（PostgreSQL 16 互換、ただし分散由来の差分大）

採用時に必ず効く制約:
- **外部キー制約なし**（参照整合性はアプリ層。現状 DynamoDB でも同様なので影響小）
- **OCC（楽観的同時実行制御）→ serialization error のリトライ実装が必須**
- **コネクション 60 分上限 + IAM 一時トークン認証**（静的パスワード前提の ORM 設定と異なる）
- **1 書込トランザクション 3,000 行 / 10 MiB 上限** — 直近実装したバックアップ/一括 import（家族データ全量復元、#3376）が抵触し得る具体的設計制約
- DB は `postgres` 1 個固定 / UTF-8・Collation C・UTC・Repeatable Read 固定 / `CREATE INDEX ASYNC` / トリガ・PL/pgSQL・一時テーブル・TRUNCATE 非対応
- GA は **2025-05-27**（約 1 年）。東京はシングルリージョンのみ（マルチリージョンは us-east-1/2・us-west-2）。

### 移管の現実性

- 一般に NoSQL→SQL 移管は「データモデル全面作り直し」が最大障壁。**本案件はその障壁が半分済んでいる** — SQLite 側に正規化済みリレーショナルスキーマ（Drizzle 46 テーブル）が既存。DSQL 移管は "ゼロからの SQL 設計" でなく "既存リレーショナル設計を Postgres に寄せる" 作業で、コールド移管より大幅に低リスク。
- 移管で削除可能: `db/dynamodb/`（約 11,000 行）+ migration hydrate の大半 + 専用 CI ゲート 2 本 ≈ **1.2〜1.3 万行（DB 層の 40〜45%）**。スキーマ同期は 5〜6 → 2〜3 へ半減。

## 検討した代替案

| 案 | 概要 | 検討した理由 |
|----|------|-----------|
| 採用案: DynamoDB 継続（DSQL は将来候補として記録） | 現状維持。DSQL を「料金クリア・技術的有力」と評価したうえで Pre-PMF では移管しない | Pre-PMF（ADR-0010）で純リファクタの大移行リスクを取らない |
| 案 A: 今すぐ DSQL へ移管 | AWS backend を DynamoDB→DSQL、`db/dynamodb/` を削除し relational 一本化 | 二重実装税の恒久解消 |
| 案 B: SQLite 互換サーバーレス（Turso/libSQL）へ一本化 | ローカル SQLite とさらに直接的に一本化 | パラダイム差を最小移植で解消 |

## 棄却理由

- **案 A（今すぐ移管）棄却**: (1) コスト削減ゼロ（DynamoDB も実質 $0）で移管の金銭的動機がない。(2) 顧客価値を生まない純リファクタに本番データ移行 + 全 repo 再配線 + 全回帰の大リスクを Pre-PMF で負うべきでない（ADR-0010）。(3) DSQL は GA 約 1 年で枠恒久性・東京マルチリージョン非対応など未知数。(4) OCC リトライ / 60 分コネクション / 3,000 行・10 MiB トランザクション上限の受容コスト。**保守性の価値は本物だが「今」ではない**。
- **案 B（Turso/libSQL）棄却（現時点）**: AWS（CDK / Cognito / Lambda）に閉じた構成の整合を重視する現状では、AWS ネイティブの DSQL の方が将来移管時の選択肢として素直。ただし比較軸としては残す価値があるため本書に記録。

## 採用案とその理由

**Pre-PMF では DynamoDB を継続**し、Aurora DSQL は「料金制約を完全に満たし、かつ二重実装税を 1.2〜1.3 万行規模で解消できる将来の有力候補」として本 rationale に記録する。判断軸はコストではなく **(a) PMF 前は機能検証が最優先、(b) 移管は顧客価値ゼロの大リファクタ、(c) SQLite 側が既にリレーショナルなので将来移管は低リスク** の 3 点。これにより「技術選定として評価していない」状態を解消し、再評価のトリガを明文化する。

## 残された懸念・フォローアップ（再評価トリガ）

- [ ] **PMF 到達後の保守性投資フェーズ**に入ったら再評価する
- [ ] **DynamoDB 二重実装に起因するバグ / 同期漏れが再度 CRITICAL 化**したら前倒し評価する（#2824 / #1009 の再発）
- [ ] **大規模スキーマ変更を伴う EPIC の着手直前**に、その工数へ移管を相乗りさせられないか検討する
- [ ] 前倒し検討時は **Drizzle pg-core へのスキーマ移植 / OCC リトライ機構 / Lambda の IAM トークン接続 / 一括 import の 3,000 行・10 MiB 分割（#3376 整合）** を PoC 検証する
- [ ] 比較軸として **Turso/libSQL**（SQLite 互換サーバーレス）も同時評価する

## 関連

- **議論源**: PO セッション（2026-06-28）
- **影響を受ける設計書**: `docs/design/08-データベース設計書.md` / `docs/design/parallel-implementations.md` §7
- **関連先例 rationale**: `07-usage-log-dynamodb-deferred-rationale.md`
- **関連 ADR**: [ADR-0010 Pre-PMF スコープ判断](../decisions/0010-pre-pmf-scope-judgment.md) / [ADR-0048 Multi-Lambda Demo Deployment](../decisions/0048-multi-lambda-demo-deployment.md)
- **一次ソース**: AWS Aurora DSQL pricing（https://aws.amazon.com/rds/aurora/dsql/pricing/） / billing-metering（https://docs.aws.amazon.com/aurora-dsql/latest/userguide/billing-metering.html） / 非対応機能・移行（https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-unsupported-features.html） / クォータ（https://docs.aws.amazon.com/aurora-dsql/latest/userguide/CHAP_quotas.html） / GA ブログ（https://aws.amazon.com/blogs/aws/amazon-aurora-dsql-is-now-generally-available/）
