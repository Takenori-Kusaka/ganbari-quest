# Aurora DSQL PoC Phase 1 実測結果（2026-07-05、us-east-1 実クラスタ）

> EPIC #3424 Phase 1 PoC の一次資料。`docs/research/2026-06-28-aurora-dsql-adoption.md` §11.2「今後の spike（未実施）」を実機で埋める。
> 本番同一リージョン **us-east-1** に使い捨てクラスタ（`DeletionProtectionEnabled=false`、tag `purpose=poc-ephemeral`）を作成し、`pg`(node-postgres) + IAM admin auth token で検証 → **検証後に削除**。
> 全 error code / 生出力は実行ログそのまま。実行できなかった項目は「未実行」と明記（捏造なし）。

## 実行環境

| 項目 | 値 |
|---|---|
| リージョン | us-east-1（本番同一） |
| クラスタ identifier | `svt4yyxzjy3v3vxdns5kb7m2bm`（検証後 **削除済**） |
| endpoint | `svt4yyxzjy3v3vxdns5kb7m2bm.dsql.us-east-1.on.aws` |
| deletion protection | `false`（使い捨て） |
| 接続 | `pg` 8.22.0 / user=`admin` / database=`postgres` / TLS 必須（`ssl.rejectUnauthorized=false`） |
| 認証 | `aws dsql generate-db-connect-admin-auth-token --hostname <ep> --region us-east-1 --expires-in 3600` を pg の password に投入 |
| クラスタ lifecycle | `create-cluster` → 即 `ACTIVE`（初回 poll で ACTIVE）。作成前 `list-clusters` = 空（既存インフラ非干渉を確認） |
| サーバ | `PostgreSQL 16` |

---

## 検証 1: クラスタ lifecycle + 接続

- **実行可否**: 実行 ✅
- **生出力**: `create-cluster` → `status=CREATING`, `deletionProtectionEnabled=false`, endpoint 返却。get-cluster 初回 poll で `ACTIVE`。
  - `SELECT 1, current_user, current_database(), version()` → `{"one":1,"current_user":"admin","current_database":"postgres","version":"PostgreSQL 16"}`
- **結論**: IAM token + pg で接続確立し `SELECT` 実行可。クラスタ作成〜ACTIVE は数十秒未満。M3 の接続前提（admin auth token、TLS 必須、database=postgres）を実機確定。

---

## 検証 2: drizzle-kit(pg) → DSQL DDL 適合（#3427）

代表 pg-core schema（`families` / `members` + PK + FK + 通常 index + unique index）を `drizzle-kit generate`（dialect=postgresql, drizzle-kit 0.31.10 / drizzle-orm 0.45.2）で生成し DSQL に適用。

**生成された DDL（抜粋）**: `CREATE TABLE ... uuid PRIMARY KEY DEFAULT gen_random_uuid()` / `ALTER TABLE members ADD CONSTRAINT ... FOREIGN KEY ...` / `CREATE INDEX ... USING btree (...)` / `CREATE UNIQUE INDEX ... USING btree (...)`。

| 適用文 | 結果（生 error code） | 含意 |
|---|---|---|
| `CREATE TABLE families (...)` | ✅ OK | UUID PK + `gen_random_uuid()` + `timestamp DEFAULT now()` 動作 |
| `CREATE TABLE members (...)` | ✅ OK | 同上 |
| `ALTER TABLE members ADD CONSTRAINT ... FOREIGN KEY` | ❌ `0A000` `unsupported ALTER TABLE ADD CONSTRAINT statement` | drizzle-kit の FK 出力は**そのまま適用不可** |
| `CREATE INDEX ... USING btree (family_id)` | ❌ `0A000` `USING not supported for CREATE INDEX` | drizzle-kit は `USING btree` を必ず付与 → DSQL 拒否 |
| `CREATE UNIQUE INDEX ... USING btree (...)` | ❌ `0A000` `USING not supported for CREATE INDEX` | 同上 |

**回避策の実測**:

| 試行 | 結果 | 含意 |
|---|---|---|
| `CREATE INDEX members_family_idx ON members (family_id)`（USING 除去・同期） | ❌ `0A000` `unsupported mode. please use CREATE INDEX ASYNC.` | **全ての二次 index は `CREATE INDEX ASYNC` 必須**（USING 除去だけでは不足） |
| `CREATE UNIQUE INDEX ASYNC ... ON members (family_id, name)` | ✅ OK | ASYNC 化で通る |
| `CREATE TABLE child_t (... family_id uuid REFERENCES families(id) ...)`（inline FK） | ❌ `0A000` `FOREIGN KEY constraint not supported` | **FK は inline でも一切不可**（ALTER でも CREATE でも）→ 参照整合はアプリ層 |
| `CREATE TABLE serial_t (id serial PRIMARY KEY ...)` | ❌ `42704` `type "serial" does not exist` | `SERIAL` 不可 → UUID PK / IDENTITY 一択 |
| `CREATE SEQUENCE my_seq` | ❌ `0A000` `CREATE SEQUENCE is not supported without an explicit cache size. please define CACHE greater than or equal to 65536 or equal to 1` | SEQUENCE は明示 CACHE(>=65536 or =1) 必須 |
| `BEGIN; CREATE TABLE a; CREATE TABLE b; COMMIT`（2 DDL/1txn） | ❌ `0A000` `multiple ddl statements not supported in a transaction` | **1 DDL/txn**（drizzle 標準の txn 一括適用と非互換） |
| `BEGIN; CREATE TABLE ...; INSERT ...; COMMIT`（DDL+DML/1txn） | ❌ `0A000` `ddl and dml are not supported in the same transaction` | DDL と DML を同一 txn で混在不可 |

- **結論（#3427）**: **drizzle-kit のデフォルト migration 出力は DSQL にそのまま適用不可**。カスタム migration runner が必須で、最低限:
  1. `ALTER TABLE ADD CONSTRAINT ... FOREIGN KEY` を除去（FK はアプリ層 `relations()` + fitness function）
  2. `CREATE (UNIQUE) INDEX ... USING btree` を `CREATE (UNIQUE) INDEX ASYNC ...`（`USING` 節除去）へ書換 + **job 完了待ち**（検証 3 参照）
  3. 各 DDL を autocommit（1 文/txn）で適用、txn 一括禁止
  4. `SERIAL`/暗黙 SEQUENCE を禁止（UUID PK or IDENTITY、明示 SEQUENCE は CACHE 指定）
  5. DDL と seed(DML) は別ステップ・別 txn に分離

---

## 検証 3: generated column（owner_guard パターン）— I-OWN ≤1 owner 物理強制

`GENERATED ALWAYS AS (CASE WHEN role='owner' THEN family_id END) STORED` + 同列への UNIQUE index で「1 家族 owner ≤1」を物理強制できるか。

| 試行 | 結果 | 含意 |
|---|---|---|
| `CREATE TABLE og2 (... owner_guard uuid GENERATED ALWAYS AS (CASE WHEN role='owner' THEN family_id END) STORED)` | ✅ OK | STORED 生成列（CASE 式）作成可 |
| `CREATE UNIQUE INDEX ASYNC og2_owner_uniq ON og2 (owner_guard)` | ✅ OK（job 完了確認要） | — |
| INSERT owner #1（family=F1） | ✅ OK | — |
| INSERT child ×2（guard=NULL、同 family） | ✅ OK（2 件とも） | NULL は distinct 扱い → 非 owner は複数可 |
| **INSERT owner #2（同 family F1）** | ❌ **`23505`** `duplicate key value violates unique constraint "og2_owner_uniq"` | **同一家族 2 人目 owner を物理拒否（I-OWN 実証）** |
| INSERT owner（別 family F2） | ✅ OK | 家族単位で独立 |
| 最終カウント | `owner=2`（F1+F2）, `child=2` | 期待どおり |
| CAST 含む生成列 `... GENERATED ALWAYS AS (CAST(t AS timestamptz)) STORED` | ❌ **`42P17`** `generation expression is not immutable` | **不変でない式（CAST 等）は生成列に不可** |

- **⚠️ 重要な運用上の落とし穴（実機で観測）**: `CREATE INDEX ASYNC` は**受理即 OK を返すが index はバックグラウンド build 完了まで uniqueness を強制しない**。build 完了前に重複を INSERT すると `sys.jobs` の `INDEX_BUILD` job が `status=failed`（`found duplicate key(s) while validating index uniqueness`）となり **index が有効化されない**（＝以後も強制されない）。
  - 正しい手順: **空/クリーンなテーブルに ASYNC unique index を張り、`sys.jobs`（`job_type='INDEX_BUILD'`, `object_name='public.<idx>'`）の `status='completed'` を poll 確認してから**運用データを入れる。最初の検証では待たずに 3 件 owner を入れて build が `failed` し dedup がすり抜けた（＝この待機を M3 migration 手順に必須化すべき実証）。
- **結論（I-OWN / 生成列）**: STORED 生成列 + ASYNC UNIQUE index で「1 家族 owner ≤1」を **DB 物理制約として強制可能（23505）**。ただし (a) index build 完了待ちが必須、(b) 生成式は immutable のみ（CAST は `42P17`）。M3 の owner_guard 設計は成立するが「ASYNC index を clean state で張り job 完了を待つ」migration 順序制約が付く。

---

## 検証 4: 単一 txn の 3,000 行 / 10MiB 上限（#3428）

| 試行 | 結果 | 含意 |
|---|---|---|
| 3,000 行 INSERT / 1 txn（`INSERT ... SELECT generate_series(1,3000)`） | ✅ OK | 上限境界 = 3,000 は含む |
| **3,001 行 / 1 txn** | ❌ **`54000`** `transaction row limit exceeded` | 3,000 行が上限（3,001 で fail） |
| 5,000 行 / 1 txn | ❌ `54000` `transaction row limit exceeded` | 同上 |
| 約 9.5MiB（5,000B×2,000 行）/ 1 txn | ✅ OK | 10MiB 未満は通る |
| **約 11.3MiB（4,096B×2,900 行）/ 1 txn** | ❌ **`54000`** `transaction size limit 10mb exceeded` | 10MiB size 上限も実在 |

- **結論（#3428）**: 一括 import は **≤3,000 行 かつ ≤10MiB/txn** でチャンク分割必須。両上限とも `54000`。行数だけでなく **byte size でも切る**ロジックが必要（大 blob 行は 3,000 行未満でも 10MiB に達しうる）。

---

## 検証 5: OCC 40001 競合率（#3425）

| 試行 | 結果 | 含意 |
|---|---|---|
| 同一行 interleaved（A/B 両 BEGIN → 両 UPDATE id=1 → A commit → B commit） | A=ok / **B=`40001`** `change conflicts with another transaction (OC000)` | OCC 競合を実機再現（commit 時検出） |
| 同一行 20 ラウンド×2 接続（read→sleep15ms→update、競合窓を広げた） | ok=20 / **conflict(40001)=20** / lost-update=0（final n 整合） | 意図的に窓を広げると各ペア 1 件が 40001。**lost update は発生せず**（正しく直列化） |
| **disjoint key（別行 id=1/id=2）15 ラウンド×2** | ok=30 / **conflict=0** | **低競合（1 家族相当、キー非重複）では 40001 = 0**。競合は行スコープ |

- **結論（#3425）**: OCC 40001 は**同一行への並行 write のみ**で発生。互いに異なる行（＝別家族/別集約に閉じた 1 家族ワークロード）では 0 件。機構は実在するので **retry ラッパ（#3435）は必須**だが、正しいキー設計下での常用競合率は極めて低い。40001 時も lost update は起きない（一方が確実に fail）。

---

## 検証 6: FOR UPDATE write-skew（セキュリティ重要 — I-BAL-NONNEG 依存）

`SELECT ... FOR UPDATE` が **write-conflict footprint** を生み OCC 40001 で検出されるか（残高非負が FOR UPDATE ロックに依存するため）。

| シナリオ | 手順 | 結果 | 含意 |
|---|---|---|---|
| **S1: write-skew probe** | 両 txn が `SELECT ... FROM acct WHERE id=1 FOR UPDATE` → 各々**別行**（id=2 / id=3）を UPDATE → commit | A=ok / **B=`40001`** | **FOR UPDATE は footprint を生む** → 別行書込でも同一 FOR UPDATE 行で競合検出 → **write-skew SAFE** |
| **S2: overspend（二重引落）** | balance=100。両 txn が id=1 を FOR UPDATE → 両者 `UPDATE balance=balance-100 WHERE id=1` → commit | A=ok / **B=`40001`**、最終 balance=**0** | **二重引落を阻止・残高非負維持（overspend なし）** |
| **S3: 対照（plain read）** | `FOR UPDATE` なしの plain `SELECT id=1` → 各々別行 UPDATE → commit | A=ok / **B=ok**（両 commit） | plain read は footprint を生まない（＝FOR UPDATE が無ければ write-skew が通る） |

- **結論（セキュリティ）**: **`SELECT ... FOR UPDATE` は DSQL 上で有効な直列化プリミティブ**。同一行を FOR UPDATE した 2 txn は書込先が別行でも一方が `40001` になり、write-skew（TOCTOU overspend）を防げる。plain read では footprint が付かない（S3）ため、**残高非負・owner 単一化などの不変条件を守る read-modify-write は必ず `FOR UPDATE`（または対象行自体への write）を伴わせる**必要がある。I-BAL-NONNEG は FOR UPDATE 依存で成立することを実証（no-op ではない）。

---

## 検証 7: EXPLAIN ANALYZE VERBOSE — DPU estimate + access path（#3425）

`act (family_id, child_id, id) PRIMARY KEY` に 500 行投入し代表クエリを `EXPLAIN (ANALYZE, VERBOSE)`。

| クエリ | access path | Statement DPU Estimate（Total） | 備考 |
|---|---|---|---|
| PK 前方一致 `WHERE family_id=? AND child_id=?`（500 行） | `Index Only Scan using act_pkey`（B-Tree Scan on act_pkey） | **0.11562**（Compute 0.01776 / Read 0.09786 / Write 0） | PK prefix が既定の効率パス |
| 非 PK 列 filter `WHERE points > 90` | **`Full Scan (btree-table) on public.act`**（Rows Removed by Filter 457） | 0.09423（Compute 0.00244 / Read 0.09179） | 二次 index があっても planner は full scan を選択（下記注） |
| PK 完全一致 point lookup | `Index Only Scan using act_pkey`（rows=1） | **0.00125**（Read 0.00023、Transaction minimum 0.00375） | 最安。単一行 read |
| 単一行 UPDATE（PK 完全一致） | `Update` → `Index Only Scan using act_pkey` | 0.02520（Write 0.01875、**Write Transaction minimum 0.05000**） | 書込は txn 最小 0.05 DPU |
| 単一行 INSERT | `Insert` → `Result` | 0.01390（Write 0.01250、**Write Transaction minimum 0.05000**） | 同上 |

- **access path 注**: `points>90` は `act_points_idx`（ASYNC、`sys.jobs` 上 `completed` を確認済）があるのに **full scan**。planner の推定行数が `rows=333333`（実 43 行）と大きくずれており、これは **ANALYZE 統計が未反映**（別途 `sys.jobs` の `ANALYZE` job が `processing` 中だった）ためと考えられる。→ **二次 index を効かせるには ANALYZE 統計反映が前提**。運用では PK 前方一致設計を第一とし、二次 index 依存クエリは統計反映後に EXPLAIN で access path を再確認する。
- **結論（#3425）**: 代表 read は PK prefix で 0.001〜0.12 DPU 程度、write は **txn あたり最小 0.05 DPU** の下駄がある。無料枠（10 万 DPU）に対し 1 クエリは桁違いに小さい。**PK-prefix scan が既定の効率パス**であり、非 PK filter は full scan に落ちる（統計 + 適切な二次 index 設計が必要）。

---

## 検証 8: CDK L1 CfnCluster + IAM で provisioning（#3429、2026-07-05 追実行）

> 前回「未実行」だった #3429 を **実 AWS で deploy 実行**して置換。scratchpad の独立 CDK app（`aws-cdk-lib` 2.257.0 / `aws_dsql.CfnCluster`）で使い捨てスタック **`GanbariQuestDsqlPocStack`** を作成。既存本番スタック（`GanbariQuestCompute`/`Auth`/`Storage`/… + `CDKToolkit`）には**一切触れず**（別スタック名・deploy/destroy 対象外）。

**実行環境**: `aws-cdk-lib@2.257.0` / `aws-cdk`(CLI)@latest / Node 22 / us-east-1 / account 443370718249。cluster identifier `hft4y6gvzzmhxfo5hfu75txxou`（**検証後 destroy 済**）。

| 確認項目 | 結果（生ログ） | 含意 |
|---|---|---|
| (a) CfnCluster provisioning / ACTIVE | `AWS::DSQL::Cluster PocCluster` → CREATE_COMPLETE（8 秒）。stack 全体 55.9s で CREATE_COMPLETE。`aws dsql get-cluster` で `status=ACTIVE`。**`multiRegionProperties` フィールドは describe 出力に存在せず** = single-region で provisioning 成功 | L1 CfnCluster 単体で single-region cluster が数秒〜数十秒で ACTIVE 化。`MultiRegionProperties` を指定しなければ暗黙 single-region |
| (b) DP=true variant の synth | 同一 construct を `deletionProtectionEnabled:true` で synth した `GanbariQuestDsqlPocSynthProdStack`（**deploy せず synth のみ**）→ CFN に `DeletionProtectionEnabled: true` を正しく出力。deploy 実体は `false`（使い捨て） | 本番想定の DP=true が正しい CFN を生成。deploy と synth の設定分離が機能 |
| (c) GetAtt 4 種 | `Fn::GetAtt PocCluster.Identifier / .Endpoint / .ResourceArn / .Status` が Outputs に生成され、deploy 後の実値を取得: Identifier=`hft4y…`, Endpoint=`hft4y….dsql.us-east-1.on.aws`, Arn=`arn:aws:dsql:us-east-1:443370718249:cluster/hft4y…`, Status=`ACTIVE`。うち **Endpoint を Lambda env（`DSQL_ENDPOINT`）へ直接 GetAtt 注入**して接続成功（検証 9） | `attrEndpoint`/`attrIdentifier`/`attrResourceArn`/`attrStatus` の 4 attribute が全て利用可。endpoint 手組み（`<id>.dsql.<region>.on.aws`）不要、GetAtt で確実に配線できる |
| (d) DP=true 時の削除挙動（ADR-0019 Replacement gate 観点） | CFN テンプレート上、DSQL::Cluster に **`DeletionPolicy` は付与されない**（CDK 既定=Delete 相当）。deletion protection は **CFN の DeletionPolicy ではなく DSQL サービス側プロパティ `DeletionProtectionEnabled`** で制御。`DeletionProtectionEnabled` は **mutable property（更新で Replacement を起こさない）** | **ADR-0019 含意**: DP の on/off 切替は cluster 置換（＝データ消失）を伴わない安全な update。ただし **DP=true のまま stack destroy すると DeleteCluster がサービス側で拒否され destroy が fail** するため、本番撤去時は「先に DP=false へ update → destroy」の 2 段が必要（この危険挙動は実 deploy せず synth + サービス仕様で確認、cluster 残置リスク回避のため意図的に未実行） |

- **IAM 接続**: Lambda 実行 role に `dsql:DbConnectAdmin`（Resource = cluster ResourceArn）を `addToRolePolicy` で付与 → 検証 9 で admin auth token 経由の接続成立を実証（policy が有効に機能）。
- **結論（#3429）**: **L1 `CfnCluster` + `Function.addToRolePolicy(dsql:DbConnectAdmin)` の最小構成で、single-region cluster provisioning・GetAtt 配線・IAM 接続が成立**。M4 provisioning 設計は L1 CfnCluster で足りる（L2 不要）。本番は `DeletionProtectionEnabled:true` を既定にし、**撤去 runbook に「DP=false へ update してから destroy」を明記**する（ADR-0019 Replacement gate に「DP は非 Replacement な mutable property」を追記推奨）。

---

## 検証 9: Lambda 接続再利用 / cold start / 接続方式比較（#3426、2026-07-05 追実行）

> 前回「未実行」だった #3426 を **実 Lambda（Node 22, 512MB, us-east-1, 検証 8 の cluster に接続）で実行**して置換。ハンドラ外（module scope）で pool を生成し、`aws lambda update-function-configuration` で env を書換えて実行コンテキストを強制リサイクル（cold）→ 連続 invoke（warm）で計測。全 method で `SELECT 1, current_user, now()` を実行。

接続 3 方式を同一 Lambda 内で比較（module-scope singleton を method 別に保持）:
- **connector**: `@aws/aurora-dsql-node-postgres-connector` の `AuroraDSQLPool`（IAM token 自動生成/更新 + region 自動判定 + OCC retry helper 内蔵）
- **signer 直結**: `pg.Pool` + `@aws-sdk/dsql-signer` の `DsqlSigner`。pg の **async `password` 関数**で新規物理接続ごとに admin auth token を都度発行
- **drizzle**: `drizzle-orm/node-postgres` の `drizzle()` を connector pool に被せて `db.execute(sql\`…\`)`

### cold / warm レイテンシ実測（ms、`connectAndQueryMs` = 接続確立込みの初回 query〜warm reuse）

| method | moduleInitMs（require コスト） | cold（isCold=true, invocation 1） | warm（isCold=false, invocation 2–4） |
|---|---|---|---|
| **connector** | 289.7 | **127.9** | 4.9 / 4.4 / 4.4 |
| **signer 直結** | 298.7 | **117.1** | 4.5 / 4.0 / 4.1 |
| **drizzle**（connector 上） | 280.9 | **118.1** | 5.4 / 4.5 / 4.5 |

- (a) **接続再利用**: warm invoke は全 method で `isCold=false` かつ **~4–5ms**（＝module-scope pool の既存物理接続を再利用、新規 token 発行/TLS/auth 無し）。cold の ~120ms（IAM token 生成 + TLS handshake + auth + 初回 query）に対し **約 25–30 倍高速**。**module scope で pool を持てば実行コンテキスト跨ぎで接続が確実に再利用される**ことを実証。
- (b) **接続方式の採用判断（connector vs signer 直結）**: レイテンシは両者ほぼ同等（cold 127.9 vs 117.1ms、warm いずれも ~4ms、有意差なし）。**トークン自動更新「機構」の差**が決め手:
  - **signer 直結**は pg の async `password` 関数が **新規物理接続時にのみ** token を再発行する。既存接続は 60 分 token 期限が来ても切れない（token は接続確立時の認証にのみ使用）が、**pool が新規接続を張る瞬間の token 失効ハンドリング / OCC retry / region 判定を全て自前実装**する必要がある。
  - **connector（`AuroraDSQLPool`）** は token 自動生成・更新、hostname からの region 自動判定、`transaction()` の **OCC（40001/OC000）自動 retry**（検証 5 で必須と確定）を **標準装備**。本 PoC で cold/warm とも直結と同等性能かつ Drizzle も問題なく載る。
  - → **採用: `@aws/aurora-dsql-node-postgres-connector`（AuroraDSQLPool）**。根拠 = (1) 性能は直結と同等、(2) token 更新 + OCC retry + region 判定という **DSQL 固有の必須ボイラープレートを OSS が肩代わり**（ADR README §OSS 先調査 / #1350 整合、awslabs 公式・Apache-2.0）、(3) Drizzle と共存可（下記 d）。signer 直結は「connector が使えない特殊制約が出た場合の fallback」に留める。
  - **honest gap**: token の完全な 60 分期限跨ぎ（＝失効後の新規接続で自動再取得）は待機時間の都合で未検証。ただし cold invoke ごとに **新規物理接続が毎回 fresh token を発行して接続成功**しており（3 方式 × 複数 cold）、「新規接続時の token 発行機構」自体は実証済み。60 分実待機のみ未実施。
- (c) **cold start レイテンシ**: 接続確立込みで **~120ms**（3 方式共通レンジ 117–128ms）。module require コスト（`moduleInitMs`）が別途 ~280–300ms。合計の実 cold は Lambda runtime init + これらで概ね数百 ms オーダー（本番許容内、warm 化で ~5ms に収束）。
- (d) **Drizzle 動作**: `drizzle-orm/node-postgres` の `drizzle(pool)` を **connector の `AuroraDSQLPool` にそのまま被せて `db.execute(sql\`…\`)` が成功**（`{one:1, current_user:'admin'}` 取得）。cold 118ms / warm ~4.5ms で connector 単体と同等。**Drizzle は DSQL + connector 上で追加改変なく動作**（クエリ実行層。DDL/migration は検証 2 のとおりカスタム runner が別途必要）。
- **結論（#3426）**: **module-scope pool で接続再利用が成立**（warm ~4ms）。**採用接続方式 = connector（AuroraDSQLPool）**（性能同等 + token 更新/OCC retry/region 判定を OSS 肩代わり）。**Drizzle は connector pool に無改変で載る**。cold は接続確立 ~120ms + require ~290ms。M4 接続層は「connector の AuroraDSQLPool を Lambda module scope に 1 個保持 → Drizzle を被せる」を基本形とする。

---

## クラスタ削除の確認

- `aws dsql delete-cluster --identifier svt4yyxzjy3v3vxdns5kb7m2bm --region us-east-1` → `status=DELETING`
- 削除完了後 `list-clusters` = 空を確認（下記「最終確認」）。**PoC クラスタ以外は一切作成・削除していない**（作成前後とも既存クラスタ 0 件）。

## 未実行 / 対象外（正直な記録）

- ~~**Lambda 接続再利用 + cold start（#3426）**: 未実行~~ → **2026-07-05 実 Lambda で実行済（検証 9）**。
- ~~**CDK CfnCluster（#3429）**: 未実行~~ → **2026-07-05 実 AWS deploy で実行済（検証 8、us-east-1 single-region）**。
- **10MiB の厳密境界二分探索**: 9.5MiB OK / 11.3MiB fail までは確定。ちょうど 10.0MiB 近傍の厳密境界は未詰め（実害なくチャンクは安全側で切るため不要と判断）。
- **DP=true のまま destroy 時の実 fail 挙動（#3429 (d)）**: cluster 残置リスク回避のため実 deploy せず synth + サービス仕様で確認（実 destroy fail は未実行）。
- **token 60 分完全期限跨ぎの自動再取得（#3426 (b)）**: 60 分実待機は未実施。新規接続ごとの fresh token 発行機構は cold invoke で実証済。

## M3（physical design）への反映（over-claim / 保留の解消）

1. **FK 前提の設計を撤回** — inline/ALTER どちらも `0A000`。参照整合はアプリ層 `relations()` + fitness function（既存 §10 方針を実機確証）。
2. **全二次 index を `CREATE INDEX ASYNC` + job 完了待ち**に統一。drizzle-kit 標準出力（`USING btree` / txn 一括 / FK）は**カスタム runner 必須**（検証 2 の 5 点書換）。
3. **owner_guard（I-OWN）は成立**（生成列 STORED + ASYNC UNIQUE → 23505）。ただし **clean state で index を張り job=completed を待つ** migration 順序を必須化。生成式は immutable のみ（CAST は `42P17`）。
4. **一括 import は ≤3,000 行 かつ ≤10MiB/txn**（両方 `54000`）でチャンク（byte size も計測）。
5. **OCC retry ラッパ必須**だが低競合ワークロード（disjoint key）では 40001=0。lost update は起きない。
6. **read-modify-write の不変条件（残高非負・owner 単一）は `FOR UPDATE` を必須化** — FOR UPDATE は footprint を生み write-skew を 40001 で阻止（plain read は不可）。
7. **PK-prefix scan を第一設計**、非 PK filter は full scan + 統計依存。write は txn 最小 0.05 DPU。
8. **provisioning は L1 `CfnCluster` 最小構成で足りる（#3429）** — single-region（`MultiRegionProperties` 省略）で ACTIVE 化、GetAtt（Endpoint/Identifier/ResourceArn/Status）で Lambda へ配線。本番は `DeletionProtectionEnabled:true` 既定、撤去は「DP=false へ update → destroy」の 2 段（DP は非 Replacement な mutable property、ADR-0019 補足）。
9. **M4 接続層 = connector（AuroraDSQLPool）を Lambda module scope に 1 個 + Drizzle を被せる（#3426）** — warm ~4ms で接続再利用、cold ~120ms（接続確立）+ ~290ms（require）。signer 直結と性能同等だが token 更新/OCC retry/region 判定を OSS が肩代わりするため connector 採用。`dsql:DbConnectAdmin` を実行 role に cluster ARN scope で付与。
