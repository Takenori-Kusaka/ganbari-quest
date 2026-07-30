# M4 実装計画（Implementation Plan / Aurora DSQL 移管の実装フェーズ）— がんばりクエスト

> **状態**: M4 成果物（**実装計画のみ。実装コードは書かない**）。ユーザーがこの計画を見て M4 着手を承認するための入力。
> **入力（確定済み設計 + 実測）**: M3 物理モデル（`docs/design/dsql/m3-physical-model.md`、Round 1 rework + Phase 1 PoC 反映で board 通過）/ M2 論理モデル（`m2-logical-model.md`、Round 1〜3 で 0 must 収束）/ M1 概念モデル（`m1-conceptual-model.md`、確定）/ **Phase 1 PoC 全 9 検証完了**（`docs/research/dsql-poc-phase1-results-2026-07-05.md`、us-east-1 実クラスタ・検証後削除済）/ reset-plan 決定#1-#4（`tmp/dsql-reset-plan-2026-07-05.md`、2026-07-05 ユーザー承認、controlling）/ 詳細設計プロセス（`detailed-design-process.md` §M4）。関連: EPIC #3424。
>
> **これは設計フェーズの終端・実装フェーズの起点**: 本書は「M4 実装を**どの順序・分割・DoD で進めるか**」を確定する。schema DDL / repository / migration runner / 接続層の**実装コードは書かない**（実装は本計画のユーザー承認後に別途着手）。フェーズゲート厳守（`memory/phase-gate-discipline.md`）。
>
> **過剰主張の禁止（M1-M3 の教訓を継承）**: 本書は「Phase 1 PoC で実測確定した事実」と「M4 実装中に実測して確定する保留事項」を厳密に区別する。全称・投機的断言をしない。

---

## §1 設計背景（この計画がなかった場合に何が困るか）

### §1.1 前提ゲート（M4 entry 条件の充足確認）

M4（Phase 3 実装）は **M3 exit 後のみ着手可**（`detailed-design-process.md` §M4）。entry 条件と充足状況:

| entry 条件 | 状況 | 出典 |
|---|---|---|
| M1 概念モデル board 通過（0 must） | ✅ Round 1〜6 収束・確定 | `m1-conceptual-model.md` |
| M2 論理モデル board 通過（0 must） | ✅ Round 1〜3 収束 | `m2-logical-model.md` |
| M3 物理モデル board 通過（相互矛盾ゼロ + PoC 裏取り + 敵対的レビュー） | ✅ Round 1 rework + Phase 1 PoC 反映済 | `m3-physical-model.md` / `m3-review-round1〜3-ledger.md` |
| Phase 1 PoC 全実測完了 | ✅ 検証 1〜9 完了（#3425/#3426/#3427/#3428/#3429 全実機確定） | `dsql-poc-phase1-results-2026-07-05.md` |
| reset-plan 確定判断（controlling）| ✅ 決定 #1-#4 ユーザー承認（2026-07-05） | `dsql-reset-plan-2026-07-05.md` |

**もしこの計画がなければ**: 過去に発生した「Phase 1 PoC 全 OPEN・設計 ADR 全 OPEN のまま Phase 3 実装先行」（フェーズゲート違反、~8000 万円相当の手戻り）が再来する。M4 の順序・DoD・reuse/rewrite 線引きを事前に固定し、実装者が「良い既存資産を捨てて盲目移植」も「data-loss 欠陥を温存」もしないように機械的ガードで縛る。

### §1.2 M4 の入力 = Phase 1 PoC で「実測確定」した事実一覧（構造決定に昇格済）

M4 実装が拠って立つ、実機で裏取り済みの事実（投機でない）:

| # | 実測確定事実 | 出典（PoC 検証） | M4 での帰結 |
|---|---|---|---|
| F1 | **接続方式 = connector（`@aws/aurora-dsql-node-postgres-connector` の `AuroraDSQLPool`）採用** | 検証 9（#3426） | Lambda module scope に pool 1 個 + Drizzle を被せる。token 更新/OCC retry/region 判定を OSS 肩代わり（signer 直結は fallback） |
| F2 | **drizzle-kit 標準 migration 出力は DSQL 非互換 → カスタム migration runner 必須** | 検証 2（#3427） | FK 除去 / `USING btree`→`ASYNC`（USING 除去）/ 1 DDL/txn / SERIAL 禁止 / DDL⇄DML 分離の 5 点書換 runner |
| F3 | **ASYNC UNIQUE index は build 完了まで uniqueness 非強制** → `sys.jobs` INDEX_BUILD=completed poll 必須 | 検証 3（#3427） | clean state で ASYNC UNIQUE → job=completed poll → 書込開放、の順序を migration に必須化 |
| F4 | **owner_guard 生成列 + ASYNC UNIQUE で I-OWN ≤1 を DB 物理強制（`23505`）**。生成式は immutable のみ（CAST は `42P17`） | 検証 3 | memberships の owner_guard 設計成立。email_lower は lower() immutable ゆえ生成列可 |
| F5 | **1 書込 txn ハード上限 = 3,000 行 AND 10 MiB（両独立）** | 検証 4（#3428） | 一括 import/復元は行数 AND byte 両方でチャンク（≤3000 行 かつ ≤10MiB）+ 冪等 upsert + saga |
| F6 | **OCC 40001 は同一行並行 write のみ・lost update なし・disjoint key 0 件** | 検証 5（#3425） | OCC retry ラッパは必須だが正しいキー設計下の常用競合率は極小 |
| F7 | **`SELECT … FOR UPDATE` が write-conflict footprint を生み write-skew（TOCTOU overspend）を 40001 で阻止**。plain read は footprint なし | 検証 6 | 残高非負・owner 単一など read-modify-write 不変条件は必ず FOR UPDATE を伴わせる MUST |
| F8 | **PK-prefix = Index Only Scan（point 0.00125 DPU）。非 PK filter は統計未反映時 full scan。write は txn 最小 0.05 DPU** | 検証 7 | PK-prefix scan を第一設計。secondary は投機的に張らず統計反映後の EXPLAIN で採否 |
| F9 | **provisioning は L1 `CfnCluster` 最小構成で足る（single-region、GetAtt 4 種配線、`dsql:DbConnect*` IAM）** | 検証 8（#3429） | CDK は L1 CfnCluster + `addToRolePolicy`。本番は DP=true 既定、撤去は「DP=false→destroy」2 段 |

> **残 PoC 保留（M4 実装中に可逆計測、§3.10）**: (a) total_point 共更新の production 競合率、(b) secondary index 採否（ANALYZE 統計反映後の実データ規模 EXPLAIN）。いずれも schema 可逆（`ALTER ADD/DROP INDEX` / 派生列 drop）で後戻り安価。

### §1.3 既存実装の位置づけ（参照材料であり、寄せる対象）

develop / feature/dsql 上の DSQL コードは **フェーズゲート違反下で書かれた dormant コード**（DATA_SOURCE 未結線で非活性）。reset-plan 方針（2026-07-05）: **ハード revert せず、確定設計へ寄せて refactor**。良い資産（txn runner / pushSchema harness / tenant 述語 / fitness function / branded id）は活かし、data-loss を招く誤り（子表化 / 列展開 / 合成 id）は捨てて rewrite。線引きは §2.3 / §3.11。

---

## §2 設計原則（M4 を貫く規律）

### §2.1 確定設計へ寄せる refactor（ハード revert でも盲目移植でもない）

reset-plan 決定に従い、既存 DSQL コードを **確定設計（M3 + reset-plan 決定#1-#4）に照らして再検査**し、寄せる。「revert リスト」ではなく「確定設計に照らして再検査/リファクタする対象」として読む。DynamoDB 単一 id 前提の移植ハック（合成 `child:category` id 等）は排除するが、branded string 型自体は維持（決定#2）。

### §2.2 OSS 先調査（ADR-0014 / #1350）

10 行超の独自実装の前に OSS / 確立パターンを最低 2 件調査する。M4 の主要な独自実装候補は **カスタム migration runner** のみ（drizzle-kit が DSQL 非互換ゆえ、検証 2 で独自必要性を実証済）。接続層は connector を OSS 採用済（検証 9、awslabs 公式・Apache-2.0）。

### §2.3 reuse vs rewrite の線引き原則（§3.11 で個別確定）

- **reuse（確定設計と整合する良い資産）**: 構造が M3/reset-plan と矛盾せず、data-loss を招かないもの（txn runner・pushSchema harness・tenant 述語・fitness function 骨格・branded string 型）。
- **rewrite（確定設計に反する data-loss 欠陥）**: M3 §10 / §4 で「捨てて rewrite」と名指しされた列展開/子表化/合成 id。**部分 rewrite の実装者が legit ドメイン列と誤認して温存する残余リスク**を断つため、名指し artifact は全撤去 → 親 text 列へ据置。

### §2.4 過剰主張の禁止・実測と未確定の区別

「実測確定（F1-F9）」と「M4 中に計測して確定する保留（total_point 競合率 / secondary 採否）」を混同しない。secondary index は「張れば効く」でなく「ANALYZE 統計反映 + EXPLAIN で採用確認してから追加」（検証 7 の新知見を反映）。

### §2.5 フェーズゲート厳守 + PR トレーサビリティ

各実装 PR は M3 決定台帳の該当項目にトレースバックする（`detailed-design-process.md` §M4）。M5 cutover（NUC/データ移行・DynamoDB 撤去、ユーザー承認必須）は M4 の scope 外（§3.9 境界）。

---

## §3 実装計画

### §3.0 全体フェーズ図（M4 内の依存順序）

```
M4-A  M4 blocker 先行処理（凍結 ceremony の前提）
  └─ pk-freeze-manifest 子表エントリ撤去 + schema.ts data-loss artifact 撤去
        │
M4-B  基盤層（並行可）
  ├─ 接続層（connector AuroraDSQLPool + Drizzle module-scope）
  └─ カスタム migration runner（5 点書換 + ASYNC build poll）
        │
M4-C  schema 実装（60 テーブル、text 据置、PK 凍結 ceremony）
        │
M4-D  repo 層（M2 §1.1〜§1.10 の集約グループ単位、point 書込単一プリミティブ）
        │
M4-E  セキュリティ実装（fitness allowlist / 最小権限 role / 再スコープ / cross-tenant E2E）
        │
M4-F  テスト戦略の完備（pushSchema / fitness / cross-tenant E2E / DB 制約テスト）
        ─────── M4 exit gate ───────
M5（別フェーズ・scope 外）  cutover（NUC 抽出→変換→再投入 / DynamoDB 撤去、ユーザー承認必須）
```

### §3.1 M4-A: M4 blocker の先行処理（PK 凍結 ceremony の前提、最優先）

M3 §2.2 / §10 が「凍結 ceremony 前に撤去必須」と名指しした data-loss artifact を、**schema 実装・PK 凍結の前に**撤去する。凍結は非可逆（P1）ゆえ、子表/列展開のまま凍結すると原初のデータ喪失が非可逆に再来する。

| blocker | 対象 file（M3 名指し） | 是正 | 根拠 |
|---|---|---|---|
| B-1 | `pk-freeze-manifest.ts` の `checklist_log_items`（:41）/ `evaluation_scores`（:50）子表エントリ | 両エントリを manifest から**撤去**（子表を凍結対象にしない） | M3 §2.2 / Round 2 [must]1 |
| B-2 | `dsql/schema.ts` `childChallenges` の targetConfig 列展開（`target_metric`/`target_category_id`/`base_target`/`reward_points`/`reward_message` :888-892） | `target_config` text 列へ据置（`reward_config` も同様） | M3 §10：`genMode`/`genMissStreak`/`activityId`/`ageAdjustments` を落とす = #3203 救済入力喪失 = 原初喪失そのもの（最 severe） |
| B-3 | `dsql/schema.ts` `evaluationScores` 子表（:547） | `evaluations.scores_json` text 列へ据置（子表を作らない） | M3 §4.2 / reset-plan 決定#1 |
| B-4 | `dsql/schema.ts` `checklistLogItems` 子表（:642） | `checklist_logs.items_json` text 列へ据置（子表を作らない） | M3 §4.2 / reset-plan 決定#1（item_id gap #3601 同時解消） |
| B-5 | `dsql/schema.ts` `dailyBattles` playerStats 列展開（`player_hp/atk/def/spd/rec` :587-591） | `player_stats_json` text 列へ据置 | M3 §10 / 値オブジェクト Q-06=A |

**DoD（M4-A）**: (1) pk-freeze-manifest から 2 子表エントリ撤去、manifest test（`tests/unit/db/pk-freeze-manifest.test.ts`）が新 manifest で green。(2) schema.ts の B-2〜B-5 の展開列/子表 export を撤去し親 text 列に据置。(3) `dsql-stamp-checklist-schema.test.ts` 等の schema テストが text 列前提に更新され green。(4) **部分 rewrite の温存リスク断ち**: `target_metric`/`base_target` 等の残存を grep で 0 件確認（§2.3）。

> **M4-A は schema 実装（M4-C）の前提であり、凍結 ceremony（§3.5）はこの撤去完了後にのみ実行する**。

### §3.2 M4-B①: カスタム migration runner（F2/F3、検証 2/3）

drizzle-kit 標準出力が DSQL 非互換ゆえ独自 runner 必須（OSS 代替なし、検証 2 で実証）。runner の必須責務:

| # | 責務 | 実測根拠 |
|---|---|---|
| 1 | `ALTER TABLE ADD CONSTRAINT … FOREIGN KEY`（inline FK 含む）を**除去** → app 層 `relations()` + fitness | 検証 2（`0A000`） |
| 2 | `CREATE (UNIQUE) INDEX … USING btree` を `CREATE (UNIQUE) INDEX ASYNC …`（`USING` 節除去）へ**書換** | 検証 2（`USING not supported` / `unsupported mode`） |
| 3 | ASYNC index 後に **`sys.jobs`（`job_type='INDEX_BUILD'`, `object_name='public.<idx>'`）`status='completed'` を poll 確認**してから書込開放 | 検証 3（build 未完了で dedup すり抜け実測） |
| 4 | 各 DDL を **autocommit（1 文/txn）** で適用（txn 一括禁止） | 検証 2（`multiple ddl` / `ddl and dml`） |
| 5 | `SERIAL`/暗黙 SEQUENCE 禁止（UUID PK。明示 SEQUENCE は CACHE≥65536 or =1） | 検証 2（`42704` / SEQUENCE CACHE） |
| 6 | DDL と seed(DML) を別ステップ・別 txn に分離 | 検証 2 |

**ASYNC UNIQUE build 順序（cutover でも必須）**: (1) CREATE TABLE → (2) ASYNC UNIQUE CREATE → (3) job=completed poll → (4) 書込開放（F3、hard 制約）。populated 表への UNIQUE 後付けは dedup 先行。

**既存資産の扱い**: 既存 `dsql/sql-executor.ts` / `dsql/run-in-transaction.ts` を基盤に、drizzle-kit 出力を DSQL DDL へ変換する層を追加。migration 定義自体は drizzle-kit generate で得た SQL を runner が後処理する方式（drizzle の schema-diff を捨てず、出力変換だけ独自）。

**DoD**: pushSchema harness（PGlite）+ 実 DSQL 契約テスト（使い捨てクラスタ or 既存契約テスト）で 6 責務を検証。ASYNC build poll のタイムアウト/失敗ハンドリングを含む。

### §3.3 M4-B②: 接続層（F1、検証 9）

**採用形（実測確定）**: connector `AuroraDSQLPool` を Lambda **module scope に 1 個**保持 → `drizzle-orm/node-postgres` の `drizzle(pool)` を無改変で被せる。

- **依存追加**: `@aws/aurora-dsql-node-postgres-connector`（未導入、`package.json` に追加）。`@electric-sql/pglite` は導入済（テスト harness 用）。
- **connector が肩代わり**: IAM token 自動生成/更新・hostname からの region 自動判定・`transaction()` の OCC（40001/OC000）自動 retry。
- **warm ~4ms / cold ~120ms（接続確立）+ ~290ms（require）**（検証 9）。module scope pool で実行コンテキスト跨ぎ再利用を実証済。
- **IAM**: 実行 role に `dsql:DbConnect`（アプリ実行、最小権限）/ migration は `dsql:DbConnectAdmin`（別クレデンシャル、§3.6）。cluster ResourceArn scope。
- **NUC（SQLite）両立**: 同一 tenant-scoped repository を no-op フィルタで再利用（SQLite ファイル自体が物理分離）。接続層は backend 別だが repo インターフェイスは 1 本。

**DoD**: Lambda module scope で pool singleton、Drizzle client 生成が 1 箇所集約。cold/warm 接続再利用が smoke test で確認。signer 直結は connector 不能時の fallback として記述のみ（実装しない）。

### §3.4 M4-C: schema 実装（60 テーブル、M3 §1）

M3 §1.1〜§1.10 の 60 リレーション物理設計を drizzle schema（pg-core + sqlite-core 2 方言）として実装する。**M4-A（data-loss artifact 撤去）完了が前提**。

| 実装規約 | 内容 | M3 出典 |
|---|---|---|
| PK 先頭 = `family_id uuid` | 全テナント表。子供スコープ表も family_id を PK 先頭に焼く | §1.0-1 / §3.4 |
| 代理 PK = UUID | `gen_random_uuid()` default。counter.ts + padId 全廃 | §1.0-2 / P2 |
| 自然複合 PK 昇格 | governing rule anchor（(a) policy invariant / (b) 構造的確実性）を満たす表のみ。それ以外は UUID surrogate + droppable UNIQUE | §2.1 |
| 全 JSON 列 = **text 据置** | `{mode:'json'}` で drizzle serialize、jsonb 不採用（GIN 不可 + backup verbatim + SQLite parity） | §4.2 |
| 時刻列 = 素の列・UTC ISO 文字列 `{mode:'string'}` | PK に入れない。sort は PK-prefix covering scan + ORDER BY DESC LIMIT | §1.0-4/5 |
| owner_guard / email_lower 生成列 + ASYNC UNIQUE | STORED 生成列（immutable 式のみ）。build 完了 poll | §3.1(B) / F3/F4 |
| CHECK 値は SSOT から機械生成 | `age-tier.ts` / `subscription-status.ts` 等から。不変集合=CHECK / 増減集合=lookup 表（plans/plan_tiers） | §1.0-6 |
| 方言写像 | `uuid↔text` / `timestamptz↔text(ISO)` / `date↔text('YYYY-MM-DD')` / `boolean↔integer` / `gen_random_uuid()↔$defaultFn(randomUUID)` | §P0 注 |

**凍結 ceremony（§3.5）** をこの後に実行。既存 `dsql/schema.ts` は M4-A で data-loss artifact 撤去済のものをベースに、M3 §1 の 60 表へ完成させる（子表 2 つは作らない）。`dsql/check-constraints.ts` の SSOT 生成は再利用。

**DoD**: 60 表全てが M3 §1 の PK/UNIQUE/CHECK/nullable/default 設計どおり。pushSchema harness（PGlite）で全表 create + 2 方言 parity テスト green。U-1（age_benchmarks PK）は §3.5 の board 確定を待つ。

### §3.5 PK 凍結 ceremony（M4-C 内、非可逆ゲート）

M3 §2.2 の凍結 manifest を board 確定後に固定する。**M4 実装前の最終レビュー gate**。

- **linchpin `children.child_id`** は ~25 表の複合 PK 先頭に伝播 → 最優先凍結。int→UUID は cutover 時に一度だけ。
- **凍結前 blocker = U-1 のみ**（M3 §9）: `age_benchmarks` の PK を `(age)` か `(age, category_id)` か board 決裁してから凍結（P1 で後変更不可）。U-2/U-3/U-4/U-5/U-8 は列追加/新表/列 drop で可逆ゆえ凍結後も対応可。
- **zero-user rebuildability**: cutover 前は本番ユーザー 0 ゆえ凍結 PK が誤りでも実損なし。非可逆性が牙を剥くのは稼働後 → 稼働前レビューで潰す。
- **代理キー併存**: surrogate PK 表でも自然同一性を droppable UNIQUE で宣言（stamp_cards `(child, week_start)` 等）。

**DoD**: (1) U-1 board 決裁済。(2) pk-freeze-manifest.ts が M4-A 撤去後の 60 表 PK で確定（子表エントリなし）。(3) `pk-freeze-manifest.test.ts` green。(4) board が凍結 manifest を承認。

### §3.6 M4-E: repo 層（M2 §1.1〜§1.10、集約グループ単位）

M2/M3 準拠で tenant-scoped repository を実装。既存 R0-R10 相当 repo を確定設計へ寄せる。

- **point 書込単一プリミティブ（reset-plan 決定#3）**: `insertPointEntry` 一本に統合、`IActivityRepo.insertPointLedger` 重複を廃止。ドメイン repo は total_point 不触。total_point は point 書込プリミティブ内で同一 txn `+= amount` のみ更新（§6.2）。
- **branded id 維持・合成 id 廃止（reset-plan 決定#2）**: branded string 型は維持（取り違え防止 ADR-0055）。複合自然キー entity（Status/ActivityMastery/ActivityPref/DailyMission/MarketBenchmark）の捏造 `id`（`child:category` 等）を廃止し自然キーを露出。DailyMission repo method 署名の composite 受け確認。
- **carryover 廃止（reset-plan 決定#4）**: retention は古い ledger 行削除のみ・total_point 不触（#729 を満たす）。`type='carryover'` エントリを作らない。
- **recordActivity 原子化（M3 §6.1）**: core（activity_log + status + status_history + mastery + point_ledger base + total_point 加算）を単一 txn。optional（combo/mission/challenge/certificate/special_reward）は core commit 後の独立 best-effort mini-txn（欠落許容は要 PO 確認）。既存 `record-activity-core.ts` / `optional-write-guard.ts` を寄せる。optional の point 付与も point 書込単一プリミティブ `point-write.ts` (`createPointEntryWriter`) を core txn の外から呼ぶ形で行う（1 呼び出し = 1 txn がそのまま独立 mini-txn になる）。
- **OCC retry ラッパ（M3 §6.3、F6）**: 40001（冪等 txn のみ）指数バックオフ + jitter を service 層 1 箇所集約。`40001`（retry）/ `23505`（業務失敗、retry 禁止）/ `rowCount=0`（業務失敗）を厳密分岐。既存 `occ-retry.ts` を寄せる（connector 内蔵 retry と責務整理）。
- **FOR UPDATE 必須（M3 §6.6、F7）**: 残高非負・owner 単一など read-modify-write は必ず `FOR UPDATE`（または対象行 write）を伴わせる。
- **一括 import chunk saga（M3 §6.4、F5）**: ≤3000 行 かつ ≤10MiB でチャンク + import バッチ ID + 進捗マーカ冪等再適用 + saga。byte size も計測して切る（大 blob 行対策）。

**PR 分割単位 = M2 集約グループ**（§3.8）。**DoD（各 repo PR）**: M3 決定台帳項目にトレースバック / 該当 repo unit test（既存 `tests/unit/db/dsql-*.test.ts` を寄せる）green / point 書込は単一プリミティブ経由 / 合成 id 露出 0 件。

### §3.7 M4-E: セキュリティ実装（M3 §3.4、ADR-0063）

RLS 非対応（P8）ゆえ多層防御:

1. **fitness function（family_id 述語 CI 強制）= 新規実装**: allowlist 以外の全 SELECT/UPDATE/DELETE で family_id 述語欠如を CI hard-fail。allowlist は**閉じた明示列挙**（グローバル master / tenant 非依存 auth / global-UNIQUE capability lookup、M3 §3.4 表）。**⚠️ この family_id 述語 fitness は現 branch に存在しない（新規）**。既存 `tests/unit/architecture/db-access-boundary.test.ts`（fitness#16、DB アクセス単一経路 linter）/ `no-direct-db-access.test.ts` は別目的の linter であり、family_id 述語チェックはこれらとは別に新設する（骨格として AST 走査基盤は流用可）。
2. **surrogate/capability 再スコープ不変条件**: token/pin/endpoint の単点 fetch 後は取得行の family_id で以降を束縛。**targeted fitness（AST）**で「capability fetch 結果を family_id 述語なしで下流に渡す pattern」を静的検出（E2E 1 層に頼らない、M3 §3.4 [should]）。
3. **最小権限実行ロール（M3 §3.4 [must]B6）**: アプリ実行 = `DbConnect` 系最小権限（append-only 表への UPDATE/DELETE grant を与えない）/ migration = `DbConnectAdmin`。append-only 表（consents/point_ledger/status_history/*_logs/trial_history/cancellation_reasons/graduation_consents/notification_logs）の UPDATE/DELETE を repo 非定義 + GRANT 除外 + AST lint の 3 層。
4. **cross-tenant E2E**: 家族 A token で家族 B リソース → 403/空 assert（IDOR #3228 同型）。capability 他家族流用も assert。

> **⚠️ 実 IAM policy JSON は本番 cutover 前 hard blocker（M3 §3.4 / §7）**: role 分離の**構造設計は M4**だが、実 IAM policy 実装（DbConnect 最小権限 + append-only GRANT 除外 / migration = DbConnectAdmin）が未実装だと GRANT 防御が design-only で台帳改竄素通り。→ M4 で構造 + fitness/lint を実装し、**実 policy JSON の配線は M5 cutover gate に含める**（§3.9 境界）。

**DoD**: family_id fitness が全 60 表を allowlist 判定込みで網羅（no-silent-gap）/ 再スコープ targeted fitness green / append-only 3 層 lint green / cross-tenant E2E green。

### §3.8 M4-D/E/F: PR 分割と順序（feature/dsql 宛 sub-PR 群）

各 sub-PR は **feature/dsql 宛**（`memory/pr-base-develop.md` の例外 = DSQL 統括 branch）。EPIC #3424 のチケット構造（設計 Sub #3430-3438 + Phase 3 実装）に沿う。「PR-R0..R10 の自己流」でなく M2 集約グループ + 設計 Sub にトレース。

| 順 | PR 群 | 内容 | 依存 | 対応 issue / M3 決定 | DoD 要点 |
|---|---|---|---|---|---|
| 1 | **M4-A blocker 撤去** | pk-freeze 子表撤去 + schema data-loss artifact 撤去（B-1〜B-5） | なし | M3 §2.2/§4/§10 | grep 残存 0 + schema/manifest test green |
| 2 | **接続層** | connector AuroraDSQLPool + Drizzle module-scope | 1 | #3426（実測済）/ F1 | smoke 接続再利用確認 |
| 3 | **migration runner** | 5 点書換 + ASYNC build poll | 1 | #3427（実測済）/ F2/F3 | 6 責務 pushSchema + 契約テスト |
| 4 | **schema 完成 + 凍結 ceremony** | 60 表 text 据置 + U-1 board + PK 凍結 | 2,3 | #3433 / M3 §1/§2 | pushSchema 全表 + 2 方言 parity + manifest 承認 |
| 5 | **repo: auth 系**（M2 §1.1） | families/users/memberships/invites/consents + owner_guard | 4 | #3434 中核 / M3 §1.1 | 既存 auth repo/test を寄せ green |
| 6 | **repo: child/activity 系**（M2 §1.2-1.4） | children/child_activities/activity_logs/statuses/status_history/evaluations | 4,5 | M3 §1.2-1.4 | text 据置 scores_json 検証 |
| 7 | **repo: point/ledger**（M2 §1.5） | point_ledger 単一プリミティブ + total_point in-txn + FOR UPDATE | 6 | #3435 / reset-plan #3/#4 / F6/F7 | 単一プリミティブ + carryover 0 |
| 8 | **repo: reward/checklist/stamp/battle/challenge**（M2 §1.6-1.9） | 残り集約 + items_json/target_config text 据置 | 4,6 | M3 §1.6-1.9 | 子表 0 + 合成 id 0 |
| 9 | **一括 import chunk saga**（M2 I-4） | ≤3000 行 & ≤10MiB チャンク + saga | 3,7 | #3436 / F5 | 両上限チャンク契約テスト |
| 10 | **セキュリティ fitness/lint 完備** | family_id 述語 / 再スコープ AST / append-only 3 層 | 5-8 | #3434 / ADR-0063 | 60 表網羅 + cross-tenant E2E |
| 11 | **OCC retry ラッパ + service 層集約** | 40001/23505/rowCount=0 分岐 | 7 | #3435 / F6 | retry ラッパ 1 箇所 |
| 12 | **観測性 IaC（設計のみ→実装）** | CloudWatch Alarm + Budgets¥100 + dashboard | 2 | #3431/#3432/#3429 / F9 | L1 CfnCluster + alarm |

> **並行可能**: 2（接続層）と 3（migration runner）は独立（両方 1 に依存）。6/8 の repo 群は 4/5 後に worktree 分離で並行。

**phase-gate**: 1（blocker 撤去）は 4（凍結）の hard 前提。4（凍結）は非可逆ゆえ board 承認必須。10（セキュリティ）は 5-8 の repo が出揃ってから網羅性を確定。

### §3.9 M5（cutover）との境界 — M4 scope 外（ユーザー承認必須）

以下は **M4 に含めない**（Phase 5 = M5、`detailed-design-process.md` / EPIC Phase 5）:

| M5 項目 | 理由 | ユーザー承認 |
|---|---|---|
| NUC データ抽出 → 新スキーマ変換 → 再投入（lazy migration） | 実データ破壊/喪失リスク。「backup 取得 → 検証 → 切替」順、ロールバック可能手順 | **必須（NUC 破壊/喪失は cutover 安全レビュアー [critical] → ユーザー決裁）** |
| `db/dynamodb/`（約 11,000 行）+ CI ゲート 2 本 + migration hydrate 撤去（#3438、impact-analysis skill で網羅） | DB 一本化の最終段。EPIC close をブロック | 必須 |
| 実 IAM policy JSON 配線（DbConnect 最小権限 / DbConnectAdmin 分離） | GRANT 防御を design-only から実装へ。本番 cutover 前 hard blocker（M3 §3.4） | 必須 |
| CDK 本番 deploy（DP=true 既定、撤去 runbook「DP=false→destroy」2 段） | 本番インフラ変更（Auto Mode ガイドライン: 本番デプロイ/DB スキーマ変更は確認必須） | 必須 |
| rationale 13 supersede 追記 + 設計書（08-DB / parallel-implementations §7）同期 | ADR-0001 設計書 SSOT | — |

> **M4 exit gate**: 台帳の未解決 [must]/[critical] ゼロ + 全 sub-PR DoD 充足 + テスト全 green。cutover 安全レビュアーの [critical]（NUC 破壊/喪失）が M5 に残るが、それは M5 の decision であり M4 exit を妨げない（M4 は「DSQL 実装が確定設計どおり動く」ことを保証し、M5 は「本番へ安全に切替える」ことを保証する）。

### §3.10 残 PoC 保留の M4 中解消（可逆計測）

M3 §7 が M4 に持ち越した 2 保留を、実装中に可逆計測で解消:

| 保留 | 解消方法 | 可逆性 |
|---|---|---|
| **total_point 共更新の production 競合率**（#3425 残） | 実データ規模ワークロードで OCC 40001 率を計測。per-child 低書込ゆえ極小の公算（disjoint key 0 件の傍証、F6）。反証時の退避 = 派生列を落とし D-BALANCE を都度 SUM | 派生列 drop で可逆 |
| **secondary index 採否**（#3425 残） | PK-prefix scan を第一設計とし、full-child scan を大幅削減する規模で **ANALYZE 統計反映後の EXPLAIN で planner 採用を確認してから追加**（memberships `(user_id)` / special_rewards `(…, granted_at)` / reward_redemption `(…, status)` / point_ledger `(…, type, recorded_date)` / activity_logs date） | `ALTER ADD/DROP INDEX` で可逆（ASYNC） |

> secondary は投機的に張らない（1 本 = 全書込に複合 PK 幅の WriteDPU 加算）。「張れば効く」でなく統計反映が前提（検証 7 新知見）。

### §3.11 既存資産の reuse vs rewrite 線引き（名指し確定）

| 資産 | 判定 | 理由 |
|---|---|---|
| `dsql/run-in-transaction.ts`（runInTransaction）| **reuse（寄せる）** | txn 境界の良い骨格。connector `transaction()` との責務整理のみ |
| `dsql/occ-retry.ts`（withOccRetry）| **reuse（寄せる）** | OCC retry。connector 内蔵 retry と役割分担を整理 |
| `tests/unit/helpers/dsql-test-db.ts`（pushSchema PGlite harness）| **reuse** | PGlite テスト基盤。良い資産（reset-plan §1 KEEP） |
| 既存 fitness 群（fitness#6/7/8/9/10/11/13/16 = `dsql-temporal-parity` / `dsql-txn-work-allowlist` / `dsql-write-path-db-import-ban` / `pk-freeze-manifest` / `dsql-optional-writes` / `dsql-check-from-ssot` / `db-access-boundary`）| **reuse（寄せる）** | 骨格を活かす。allowlist は各テストの目的別に更新 |
| **family_id 述語 fitness / 再スコープ targeted fitness** | **new（現 branch に不在）** | tenant 述語チェックは未実装（inventory 実測）。M3 §3.4 の閉集合 allowlist で新設 |
| fitness#14（`dsql-total-point-drift`、total_point==SUM）| **rewrite（再定義）** | reset-plan 決定#4：「total_point==SUM」→「テスト時（非 pruning）の書込増分整合検証」へ再定義 |
| branded string 型（`src/lib/domain/ids.ts`、現状 ChildId/ActivityId/CategoryId の 3 型 + 全コードベース ~505 call-site 採用）| **reuse（合成 id のみ廃止）** | branded string 維持（決定#2）。複合自然キー entity の捏造 id を廃止。定義サイトは 1 file、~505 は call-site 採用数 |
| `dsql/check-constraints.ts`（SSOT CHECK 生成）| **reuse** | §1.0-6 の CHECK 機械生成に整合 |
| `dsql/schema.ts` の childChallenges 列展開 / evaluationScores 子表 / checklistLogItems 子表 / dailyBattles 列展開 | **rewrite（撤去 → 親 text 列）** | M3 §10 名指し data-loss（§3.1 B-2〜B-5） |
| `pk-freeze-manifest.ts` の 2 子表エントリ | **rewrite（撤去）** | M3 §2.2（§3.1 B-1） |
| 合成 id（`child:category` 等）を露出する repo コード | **rewrite（自然キー露出）** | reset-plan 決定#2 |
| `IActivityRepo.insertPointLedger`（point 書込重複）| **rewrite（`insertPointEntry` 一本化）** | reset-plan 決定#3 |
| carryover 台帳エントリ生成コード | **rewrite（廃止）** | reset-plan 決定#4 |
| 接続層 | **new（既存に本番接続なし）** | connector AuroraDSQLPool を新規配線（package.json 依存追加） |
| migration runner | **new（drizzle-kit 非互換）** | 5 点書換 runner を新規（sql-executor を基盤に） |

---

## §4 ユーザー承認を要する判断点（M4 着手可否 + M4 内 gate）

1. **本計画（M4 着手）の承認** — 前提ゲート（§1.1）充足を確認し M4 着手を承認するか。
2. **U-1（age_benchmarks PK）board 決裁** — 凍結 ceremony（§3.5）の前に `(age)` か `(age, category_id)` を確定（P1 で後変更不可、凍結唯一の blocker）。
3. **PK 凍結 manifest の承認** — §3.5 の非可逆凍結を board が承認（zero-user 前提で稼働前に潰す最終 gate）。
4. **recordActivity optional 欠落許容の PO 確認**（M3 §6.1）— combo/mission/challenge/certificate/special_reward の失敗隔離（現状の握り潰しと同等で regression なしを PO 確認）。
5. **M5 cutover 一式**（§3.9）— NUC 破壊/喪失（[critical] ユーザー決裁）/ DynamoDB 撤去 / 実 IAM policy 配線 / 本番 deploy。**M4 scope 外だが M4 exit 後に別途承認が必須**。

---

## 関連
- `docs/design/dsql/m3-physical-model.md` — M3 物理モデル（本計画の SSOT 入力）
- `docs/design/dsql/m2-logical-model.md` / `m1-conceptual-model.md` — 論理/概念モデル
- `docs/research/dsql-poc-phase1-results-2026-07-05.md` — Phase 1 PoC 実測（F1-F9 の出典）
- `tmp/dsql-reset-plan-2026-07-05.md` — reset-plan 決定#1-#4（controlling）
- `docs/design/dsql/detailed-design-process.md` §M4 — M4 entry/exit 決裁条件
- `docs/decisions/0063-dsql-pool-multitenant-isolation.md` — テナント分離（§3.7 根拠）
