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

## クラスタ削除の確認

- `aws dsql delete-cluster --identifier svt4yyxzjy3v3vxdns5kb7m2bm --region us-east-1` → `status=DELETING`
- 削除完了後 `list-clusters` = 空を確認（下記「最終確認」）。**PoC クラスタ以外は一切作成・削除していない**（作成前後とも既存クラスタ 0 件）。

## 未実行 / 対象外（正直な記録）

- **Lambda 接続再利用 + cold start（#3426）**: 本 PoC は pg(node) ローカル接続のみ。Lambda 実行コンテキストでの warm 接続再利用・cold start は **未実行**（別 spike）。
- **CDK CfnCluster 東京最小構成（#3429）**: **未実行**（移管先は us-east-1 確定のため東京前提は不要。CDK L1 構成 spike は別途）。
- **10MiB の厳密境界二分探索**: 9.5MiB OK / 11.3MiB fail までは確定。ちょうど 10.0MiB 近傍の厳密境界は未詰め（実害なくチャンクは安全側で切るため不要と判断）。

## M3（physical design）への反映（over-claim / 保留の解消）

1. **FK 前提の設計を撤回** — inline/ALTER どちらも `0A000`。参照整合はアプリ層 `relations()` + fitness function（既存 §10 方針を実機確証）。
2. **全二次 index を `CREATE INDEX ASYNC` + job 完了待ち**に統一。drizzle-kit 標準出力（`USING btree` / txn 一括 / FK）は**カスタム runner 必須**（検証 2 の 5 点書換）。
3. **owner_guard（I-OWN）は成立**（生成列 STORED + ASYNC UNIQUE → 23505）。ただし **clean state で index を張り job=completed を待つ** migration 順序を必須化。生成式は immutable のみ（CAST は `42P17`）。
4. **一括 import は ≤3,000 行 かつ ≤10MiB/txn**（両方 `54000`）でチャンク（byte size も計測）。
5. **OCC retry ラッパ必須**だが低競合ワークロード（disjoint key）では 40001=0。lost update は起きない。
6. **read-modify-write の不変条件（残高非負・owner 単一）は `FOR UPDATE` を必須化** — FOR UPDATE は footprint を生み write-skew を 40001 で阻止（plain read は不可）。
7. **PK-prefix scan を第一設計**、非 PK filter は full scan + 統計依存。write は txn 最小 0.05 DPU。
