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

## 追補（2026-07-01）: 移管実行への判断転換と設計完了後の評価

### 判断転換（defer → proceed）

2026-06-28 の結論は「Pre-PMF では DynamoDB 継続・DSQL は将来候補」だったが、再評価トリガ（§残された懸念の「大規模スキーマ変更 EPIC への相乗り」＋「保守性投資フェーズ」）が発火し、**EPIC #3424 で移管実行を決定**。ground-up データモデル設計（`docs/design/dsql-data-model.md`）+ **spike#1-8 実機検証**（FK/RLS/CREATE TYPE/部分index/式index/SAVEPOINT 非対応・jsonb ネイティブ・生成列 UNIQUE・OCC 40001・warm/cold レイテンシ等を実クラスタで確証）+ 技術 2 ラウンドレビュー + **8 名専門家パネル決裁**（DB/戦略/QM/セキュリティ/PO/営業/法務/UX、全員条件付き決裁・却下ゼロ）を経て設計凍結。「今やる」の正当化は §採用案の (b)(c)（顧客価値ゼロの大リファクタだが SQLite が既にリレーショナルで低リスク）に加え、**auth ドメインが SQL schema に不在で SQL 化が不可避**・**recordActivity の非トランザクション部分コミットが correctness 上放置できない**という forcing 要因。

### 返還した技術負債（before → after、定量）

| 負債 | before（DynamoDB single-table 由来） | after（DSQL ground-up） |
|---|---|---|
| バックエンド分岐 | 3 backend（dynamodb/sqlite/demo）、`db/dynamodb/` ~11,000 行、専用 CI ゲート 2 本、スキーマ同期 5-6 箇所 | 2 backend（DSQL/SQLite）、~1.2-1.3 万行削除、同期 2-3 箇所、単一論理モデル |
| 採番ハック | surrogate int PK 43/46 + `counter.ts`（hot-item 採番＝スケールボトルネック）+ `padId`（辞書順ハック） | UUID v4 PK、counter.ts / padId **撤廃** |
| テナント分離 | tenant_id が 15/46 表のみ・`_tenantId` no-op（越境クエリの温床） | 全テナント表に複合 tenant PK（family_id 先頭）+ fitness function で機械強制 |
| JSON 詰め込み | itemsJson 等に非正規化を隠蔽 | 意図的解体（検索列 or jsonb を判断基準で選択、§5） |
| 残高二重実装 | BALANCE item vs SUM の二重管理・乖離リスク | `children.total_point` 派生列 単一 SSOT（記録 txn 内更新で乖離不能） |
| 記録の原子性 | recordActivity が 5+ 表を**非トランザクション best-effort**（例外握り潰し・部分コミット＝本番 t-82c17558 事故クラス） | core 5 行を単一 txn（all-or-nothing）+ optional 独立 |
| auth の SQL 不在 | tenant/user/membership/invite/consent が **SQL schema に無く DynamoDB 専用**・role を 2 item に二重書き（片方成功で整合バグ） | リレーショナル 5 表・二重書き**根絶**・owner≤1 を生成列 UNIQUE で DB 強制・consent append-only |
| 集計の場所 | ランキング/battle/兄弟比較を **app-side fetch + JS 集計**（全件転送 + アプリ CPU） | SQL `GROUP BY`（転送・CPU 削減） |

### 効果（どれくらい効果的だったか）

- **Correctness（最大の効果）**: 部分コミット根絶（原子性）、owner≤1 の DB 強制、backup round-trip の機械保証、consent の改竄防止（append-only）。**「動くが静かに壊れる」クラスの構造的欠陥を設計段階で封鎖**。
- **保守性**: 二重実装税（1 概念 = 4 ファイル同期 + CI ゲート 2 本）の恒久解消。fitness function **15 件**で tenant 分離・派生列整合・PK 凍結・backup 秘密不在・cron chunk 等の不変条件を**人手でなく CI で機械強制**（ADR-0061 整合）。
- **開発速度**: SQL の JOIN/GROUP BY/トランザクションで、single-table のアクセスパターン設計 + app-side 集計の負担を削減。Drizzle の型安全・マイグレーション生成が両 backend に効く。

### 正直なパフォーマンス評価（対外的にも誇張しない）

| 観点 | 評価 |
|---|---|
| 生 point-lookup | **DynamoDB がやや優位**（接続レス・OCC 無し・predictable single-digit ms）。DSQL は **cold Lambda の接続確立 ~500ms tail が genuine な退行**（spike#8 実測、warm コンテナ接続再利用で緩和）。warm query は in-region 数 ms で**ほぼ同等**（spike#8: laptop 計測 15ms は client RTT 込み、in-region は ~1-5ms） |
| 集計/JOIN/レポート | **DSQL 優位**（app-side JS 集計 → server-side SQL で転送・CPU 削減） |
| 書込競合 | DynamoDB は last-writer-wins/conditional write。DSQL は **同一行 write-write のみ 40001**（異なる行はゼロ、spike#8 実証）→ per-child 分散の本設計では稀 |
| **総合** | **速度は wash〜わずかに悪化（cold 接続 tail のみ要管理）。速度は移管理由ではない** |

→ **DSQL 移管の真の価値は、性能/コスト最適化ではなく `correctness + 技術負債返還 + 開発モデルの健全化`**。データ取り出しの生速度は DynamoDB > DSQL > Aurora Serverless だが、SQL による server-side 整形/集計と NoSQL の広域 scan 回避を総合すると**トータル処理時間はワークロード混合比次第で拮抗**（本プロダクトは point-lookup 主体ゆえ純速度では移管でわずかに不利、その代わり集計・原子性・保守性で回収）。

### 移管で新たに払うコスト（トレードオフ、正直に）

OCC 40001 retry ラッパの実装 / 接続 60 分・IAM トークン寿命の再接続ロジック / 3,000 行・10MiB txn 上限（一括 import は chunk+saga）/ 2 backend の dialect-parity 恒久税 / index 制約（部分・式・GIN 不可、btree 列のみ）/ 単一リージョン SPOF（PITR で緩和、multi-region は ADR-0010 scope 外）。いずれも spike で実機確認し設計に織り込み済。

### 対外コミュニケーション用の 1 行

> DSQL 移管は**性能/コスト最適化ではなく、NoSQL 単一テーブル由来の構造的技術負債（3 バックエンド分岐・非トランザクション部分コミット・auth の SQL 不在・派生データ二重実装・採番ハック）を約 1.2-1.3 万行規模で返還し、正しさと保守性を取り戻す投資**。性能は概ね同等（cold 接続の tail のみ要管理）、コストは両者とも実質ゼロ。判断は 8 専門家パネル決裁 + 実機 spike 8 回で裏取り済。

## 関連

- **議論源**: PO セッション（2026-06-28）
- **影響を受ける設計書**: `docs/design/08-データベース設計書.md` / `docs/design/parallel-implementations.md` §7
- **移管の確定設計書（2026-07-01）**: `docs/design/dsql-data-model.md`（ground-up データモデル、§1-§13）+ 裏付け research（判断①-⑭ + spike#1-8）
- **移管 EPIC**: #3424（#3433 データモデル設計 / #3434 ADR-0063 tenant 分離 等）
- **関連先例 rationale**: `07-usage-log-dynamodb-deferred-rationale.md`
- **関連 ADR**: [ADR-0010 Pre-PMF スコープ判断](../decisions/0010-pre-pmf-scope-judgment.md) / [ADR-0048 Multi-Lambda Demo Deployment](../decisions/0048-multi-lambda-demo-deployment.md)
- **一次ソース**: AWS Aurora DSQL pricing（https://aws.amazon.com/rds/aurora/dsql/pricing/） / billing-metering（https://docs.aws.amazon.com/aurora-dsql/latest/userguide/billing-metering.html） / 非対応機能・移行（https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-unsupported-features.html） / クォータ（https://docs.aws.amazon.com/aurora-dsql/latest/userguide/CHAP_quotas.html） / GA ブログ（https://aws.amazon.com/blogs/aws/amazon-aurora-dsql-is-now-generally-available/）
