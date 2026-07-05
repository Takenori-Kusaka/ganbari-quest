# M3 物理データモデル（Physical Data Model / Aurora DSQL 固有）— がんばりクエスト

> **状態**: M3 成果物（**Round 1 rework 反映済**・[must]8 件是正、台帳 `docs/design/dsql/m3-review-round1-ledger.md`）。**入力 = M2 論理モデル**（`docs/design/dsql/m2-logical-model.md`、Round 1〜3 で 0 must 収束・確定済）+ Phase 0 DSQL 実機 spike#1（`docs/research/2026-06-28-aurora-dsql-adoption.md` §11.1、**spike#2-#8 は未実施**）+ ADR-0063（pool マルチテナント分離）+ **`tmp/dsql-reset-plan-2026-07-05.md` 決定#1-#4（controlling、2026-07-05 ユーザー承認）**。関連: EPIC #3424 / M3 プロセス定義 `docs/design/dsql/detailed-design-process.md` §M3。
>
> **Round 1 rework サマリ（3 テーマ / [must]8）**: **テーマA データ喪失根絶** = 全 JSON 列を列展開/子表化から **text 据置**へ是正（genMissStreak 等の silent drop を実コードで捕捉、原初喪失の再来を封殺、§4）。**テーマB セキュリティ** = fitness allowlist を閉集合化 + surrogate/capability 再スコープ不変条件 + 実行時接続 role 分離（append-only 表 GRANT 除外）を物理責務に格上げ（§3.4）。**テーマC PoC 規律** = 未実行 spike#2-#8 依拠の断言を構造決定→PoC 保留に降格 + M2 分類の捏造記述訂正（§5/§7/§8）。
>
> **層の位置づけ（ANSI-SPARC）**: 本書は **物理層（internal schema）** に限定する。M2 論理層の relation / 候補キー / 主キー / 外部キー / 導出関係 / 不変条件マッピングを **Aurora DSQL の物理制約下に写像**し、物理データ型・PK 物理形式（凍結）・FK 非対応の担保方式・JSON 格納方針・ASYNC index・トランザクション境界を確定する。M2 の論理決定（正規形・候補キー・導出関係・値オブジェクト境界）を **覆さない**。
>
> **これは設計であって実装ではない（決定的に重要）**: 本書は物理設計を確定するが、**schema DDL コード（drizzle pg-core/sqlite-core）・repository・migration の実装は書かない**。実装（M4）は **Phase 1 PoC（#3425-#3429）close 後にのみ着手**する（フェーズゲート厳守）。§7 の PoC 保留リストが M4 実装のブロッカーである。
>
> **構造決定 vs PoC 保留の厳密分離（本書の背骨）**: すべての物理判断を 2 種に分類し混同しない。
> - **(構造決定)**: 公式 DSQL 制約（PK 不変性・FK 非対応・SERIAL 不可・ASYNC index・1txn 3000 行/10MiB・OCC 40001・シーズン非対応）で **今確定できるもの**。spike#1 実機 or AWS 公式 doc で裏取り済。
> - **(PoC 保留)**: DPU コスト・OCC 競合率・index 実性能・import 上限の実挙動など **実測が要るもの**。**「PoC 保留 (#3425-#3429)」と明示し、確定と称さない**（実測前に確定扱いする過去の失敗を繰り返さない）。

---

## §P0 Aurora DSQL 物理制約の SSOT（spike#1 実機確証 + AWS 公式 doc）

M3 の全物理判断が拠って立つ DSQL 固有制約。**すべて構造決定（実測不要）**。出典を各行に付す。

| # | 制約 | 裏取り | 物理設計への含意 |
|---|---|---|---|
| **P1** | **PK は CREATE TABLE 後に変更不可**（`ALTER TABLE` の supported action に `ADD/DROP/ALTER PRIMARY KEY` 無し。`ADD table_constraint_using_index` は `UNIQUE USING INDEX` のみ） | AWS 公式 `alter-table-syntax-support.html`（supported action 列挙で PK 変更不在）+ `working-with-primary-keys.html`（PK が index-organized 表本体 + cluster-wide unique key + 分散 partition の基盤） | **PK 凍結**（非可逆）。§P1 凍結対象を board 確定後に freeze。列追加（`ADD COLUMN`）・UNIQUE 後付けは可（可逆）だが PK は不可 |
| **P2** | **SERIAL / 連番採番型なし**（`type "serial" does not exist`） | spike#1 実機 `42704` | 代理 PK は **UUID**（`gen_random_uuid()` ネイティブ動作を spike#1 確証）。counter.ts + padId 採番を全廃 |
| **P3** | **FK 制約なし**（`FOREIGN KEY constraint not supported`） | spike#1 実機 `[0A000]` + AWS 公式（SQLAlchemy blog: `ForeignKey()` 不可、`relationship()` で app 層 join） | M2 の全論理 FK を **app 層 / CHECK / 生成列 UNIQUE / 複合 PK 包含** で担保（§3） |
| **P4** | **CREATE INDEX は ASYNC 必須**（同期 `CREATE INDEX` は `unsupported mode`）。式 index・部分 index・GIN 不可。btree のみ。≤24 本/表・≤8 列・≤1KiB | spike#1 実機（同期 index 拒否 / `CREATE INDEX ASYNC` は job_id 返却） | secondary は ASYNC + job 完了待ち runner。**条件付き一意 / soft-delete 一意は STORED 生成列 + UNIQUE index** で表現（式/部分 index 不可の回避、§3） |
| **P5** | **1 書込 txn ハード上限（調整不可）**: 3,000 行 / 10 MiB / 5 分 / クエリメモリ 128 MiB / 行 2 MiB | spike#1 実機（3,000 行 commit ✅ / 3,001 行 `54000 transaction row limit exceeded`） | 一括 import / 復元は **chunk 分割（≤3000 行 / ≤10MiB）+ 冪等 upsert + saga**（§6.4） |
| **P6** | **1 txn = DDL 1 文・DDL/DML 混在不可** | spike#1 実機（2 DDL `[0A000] multiple ddl` / DDL+DML `[0A000]`） | migration は 1 文/txn に分割。schema 構築順序を DDL 制約に合わせる（§6.5） |
| **P7** | **OCC（楽観的同時実行制御）= commit 時 write-write を検出し `40001`（OC000）** | spike#1 実機（commitA=ok / commitB=`40001`）+ AWS 公式 concurrency-control | **同一行 write-write の commit 重なり時のみ**競合。retry ラッパ（指数バックオフ + jitter、冪等 txn のみ）を service 層に 1 箇所集約（§6.3） |
| **P8** | **RLS 非対応**（`CREATE POLICY` / `ENABLE ROW LEVEL SECURITY` とも `[0A000] unsupported`） | spike#1 実機 + ADR-0063 | テナント分離は **DB エンジン強制でなく app 層単一強制点 + fitness function**（ADR-0063、§3.4） |
| **P9** | **UUID 高カーディナリティ PK 推奨**（連番は range-partition で hot storage partition 化）。**複合キー = 高カーディナリティ列 + 他列**で access pattern に整合し secondary 不要化 | AWS 公式（Aurora snapshot 移行 blog / SQLAlchemy blog: UUID 無調整スケール） | `PRIMARY KEY (family_id, <entity_id>)` + 時刻列を PK に入れない（§P3-時刻）。UUID v4 で hot-partition ゼロ |
| **P10** | **1 DB（postgres 固定）・schema ≤10・table ≤1,000・collation C・TZ UTC・シーケンス上限あり** | AWS 公式 CHAP_quotas + spike research §4 | schema 分離（家族ごと）は不可 → **tenantId 列ベース行分離**（ADR-0063）。全 temporal は UTC ISO 文字列 |

> **NUC (SQLite) 両立の物理原則**: 論理モデル（列・PK・UNIQUE・CHECK・生成列）は 2 方言で同一。物理型は方言写像 `uuid↔text` / `timestamptz↔text(ISO,{mode:'string'})` / `date↔text('YYYY-MM-DD',{mode:'string'})` / `boolean↔integer` / `gen_random_uuid()↔$defaultFn(randomUUID)`。**全 temporal/uuid は `{mode:'string'}` 固定**（pg が `Date` を返すと SQLite[string] と型 drift + backup verbatim 破壊）。物理 index 挙動のみ backend 別チューニング可（DSQL は PK covering で secondary 最小 / SQLite は rowid heap で必要な secondary を別途）。

---

## §1 物理テーブル設計（M2 リレーション → DSQL テーブル）

M2 の全 60 リレーションを DSQL テーブルへ写像する。**物理 DDL の実コードは書かず**、物理データ型・PK・UNIQUE・nullable・default・CHECK の**設計を記述**する（実 drizzle schema は M4 で本節を入力に生成）。方言写像は §P0 注のとおり。

### §1.0 全リレーション横断の物理規約（構造決定）

1. **テナント表の PK 先頭 = `family_id uuid`**（M2 §35/U-6 の「family_id 冗長配置は M3 判断」を **(b) 冗長配置**で確定 = ADR-0063）。子供スコープ表も `family_id` を PK 先頭に含める（FK 連鎖でなく物理的に family 所有を PK に焼く）。→ テナント隔離・PK covering・cross-tenant fitness function を同時成立。
2. **代理 PK = UUID**（P2/P9、`gen_random_uuid()` default）。M2 §3.1 の「代理識別子を PK」分類はすべて UUID。counter.ts + padId 採番全廃。
3. **自然複合 PK 昇格**: M2 §3.1 の「自然複合キーを PK に採用」分類は surrogate を被せず自然複合 PK。ただし **§P1 凍結の governing rule**（§2.1）で anchor を検証し、anchor 無しは UUID surrogate + droppable UNIQUE に落とす。
4. **時刻列を PK に入れない**（P9/§P3-時刻）: sort 用途の `created_at`/`recorded_at`/`sent_at` は素の列。PK プレフィクス covering scan + `ORDER BY … DESC LIMIT` で引く（家庭スケール数百行/child）。
5. **全 temporal = UTC ISO 文字列 `{mode:'string'}`**（P10 + backup verbatim parity）。`date` 型相当は `'YYYY-MM-DD'` 文字列。
6. **CHECK 値は SSOT から機械生成**（drizzle `text(enum)` は CHECK 非生成の既知落とし穴 → `check()` 明示）。列挙は `age-tier.ts` / `subscription-status.ts` / `archive-types.ts` 等から生成（手書き二重化禁止）。**不変集合 = CHECK / 増減集合 = lookup 表**（プラン等、ALTER 後付け不可 P1 のため）。

### §1.1 Family グループ（M2 §1.1）

| M2 リレーション | 物理テーブル | PK（凍結対象） | 主 UNIQUE / secondary | 物理判断メモ |
|---|---|---|---|---|
| R-FAMILY | `families` | `(family_id uuid)` | secondary `(user_id)` 不要（owner は memberships SSOT） | 最上位テナント境界。`default_child_id uuid?`（DefaultChildSelection、同一家族 child への論理参照、FK 無し）。`last_active_at` は §6 hot-write に注意（別表退避は PoC 判断） |
| R-SUBSCRIPTION_STATE | **§1.1a で判断**（families クラスタ vs 別表） | `(family_id)` 1:1 | UNIQUE `(stripe_customer_id)` | `status` は Stripe 固定 enum=CHECK。**`plan` は `plans` lookup 表参照（CHECK でない）**= 増減集合（価格/ティア実験を schema migration 待ちにしない、P1 の ALTER 後付け不可回避） |
| R-USER | `users`（global、tenant 非依存） | `(user_id uuid)` | UNIQUE `email_lower GENERATED lower(email) STORED` | メールは PK にしない（可変・PII、更新伝播非可逆コスト回避 = M2 §3.3(c)）。`lower(email)` は immutable ゆえ STORED 生成列可（spike#6 F7） |
| R-MEMBERSHIP | `memberships` | `(family_id, user_id)` 自然連関 | secondary `(user_id)`（findUserTenants、別軸引き）+ **`owner_guard uuid GENERATED (CASE WHEN role='owner' THEN family_id ELSE NULL END) STORED` + UNIQUE ASYNC** | I-OWN（owner ちょうど 1 名）を **DB 物理強制**（spike#3: 2 人目 owner は `23505`、40001 retry でない即エラー）。`role` CHECK(owner/parent/child)。`対象子供 child_id?` は role=child 行のみ非 NULL |
| R-INVITE | `invites` | `(invite_id uuid)` | secondary `(family_id)`、UNIQUE `(token_hash)`、status/role CHECK | `token_hash` = 招待コードの timing-safe ハッシュ（raw 非保存、CWE-522 = 現行 capability 機構の写像） |
| R-CONSENT_RECORD | `consents`（**append-only**） | `(consent_id uuid)` | secondary `(family_id, type, consented_at)`、type CHECK | 追記のみ = UPDATE/DELETE を GRANT 除外 + repo 非定義 + fitness 禁止（I-CONS）。取得時環境（IP/UA）は **既に素の列**（`ip_address`/`user_agent`）= M2 値オブジェクトだが物理は原子列で確定（field query 無し、§4）。「現在の同意」= consented_at 降順の導出（D-CONSENT） |
| R-PARENT_GATE_CREDENTIAL | §1.1a 判断 | `(family_id)` 1:1 | — | 保護者 PIN = 秘匿値（平文非保持ハッシュ、ADR-0050）。連続失敗/ロック解除時刻は素の列 |
| R-EMAIL_LOGIN_LOCKOUT | `email_login_lockouts`（**tenant 非依存**） | `(email)` 自然キー | — | 家族非依存（未登録メールもロック対象）= family_id を持たない例外表。R-USER FK 無し（P3 かつ論理的にもメール文字列で識別） |
| R-TRIAL_HISTORY | `trial_history`（append-only） | `(family_id, trial_id uuid)` | cross-tenant cron 用 secondary `(end_date)` は PoC 後 | 1 tenant N 回 → surrogate。属性詳細は M2 で未展開 = M4 で確定 |
| R-CANCELLATION_REASON | `cancellation_reasons`（append-only） | `(family_id, reason_id uuid)` | 分析用 secondary は PoC 後（hot path は cross-tenant） | KPI 分析。category CHECK |
| R-LOYALTY_STATE | §1.1a 判断 | `(family_id)` 1:0..1 | — | **記念チケット数は int カウンタ列**（点数経済外の第 2 通貨、D-BALANCE 対象外）。U-2 派生整合ギャップの物理帰結は §9 |
| R-ACCOUNT_LIFECYCLE | §1.1a 判断 | `(family_id)` 1:1 | — | 状態機械（active/soft-deleted/purged）= CHECK。`猶予プラン層` は `plan_tiers` 参照（FK 無し） |
| R-DECAY_POLICY / R-APPROVAL_POLICY / R-POINT_CONVERSION_POLICY / R-NOTIFICATION_SETTINGS | §1.1a 判断 | 各 `(family_id)` 1:0..1 | — | 家族方針。静音時間帯は **静音開始/終了の 2 素の列**（M2展開、U-3 の物理帰結 §9）。換算レートは `real` |
| R-BONUS_RULE | `bonus_rules`（family master 1:N） | `(family_id, rule_id uuid)` | secondary 不要（family プレフィクス scan） | 発火条件を **素の列に展開**（`条件種別`/`指標`/`閾値`/`加算点`/`倍率`/`有効か`）= M2展開。効果は記録時に基礎点へ畳み込む（独立台帳エントリ無し、L-19） |

#### §1.1a 1:1 家族従属テーブルの物理クラスタリング判断（M2 §1.1 が明示的に M3 へ委譲、U-4）

M2 §1.1 は「家族方針・認証資格・契約を family 識別子 CK の 1:1 従属リレーションに縦分解。**縦分解を物理的に 1 表へ clustering するか別表にするかは M3**」と明記。**物理決定 = 別テーブル据置（baseline）**。根拠:

- **WriteDPU はバイト課金**（P0 §1 の spike research §1）。decay/approval/conversion/notification は**別々の管理画面で独立更新**されるため、families 広幅行へ吸収すると 1 設定変更ごとに広幅行全体を rewrite し WriteDPU が膨らむ（DSQL は WriteDPU 単価が ReadDPU の約 27 倍）。
- **PK covering（P1/P9）**で各 `(family_id)` 1:1 表は point-read 1 回。family-load は複数 `(family_id)` point-read の **DSQL ネイティブ並列**で賄える（安価）。
- **概念独立（M2 L-14）を尊重**: 疎な広幅 Family を避け BCNF 維持。
- **可逆性**: families への clustering は read-DPU 最適化として**後から可能**（table 統合は新表 + backfill）。逆に最初から広幅にすると P1 の PK は動かせないが列削除は容易 → baseline=分離は安全側。
- **例外（families へ吸収）**: `subscription_state` の `stripe_customer_id` UNIQUE は families の owner/status と常に一括読みされ独立更新頻度が低い → **families へ吸収する選択肢を PoC の family-load read-DPU 実測で判断**（big-policy doc は吸収、M2 は分離。**どちらも可逆ゆえ PoC 保留**、§7）。

→ **構造決定 = 分離 baseline / PoC 保留 = subscription を families へ吸収するか（read-DPU 実測）**。

### §1.2 ChildProfile（M2 §1.2）

| M2 リレーション | 物理テーブル | PK（凍結対象） | secondary | 物理判断メモ |
|---|---|---|---|---|
| R-CHILD | `children` | `(family_id, child_id uuid)` | `(family_id, user_id)` は招待 child 解決時のみ（warm、初期省略可） | **linchpin**（child_id は ~25 表の複合 PK 先頭 = 最優先凍結）。旧 int id → UUID。**年齢は列で持たない**（D-AGE compute-on-read、日次 drift ゆえ §P7 派生列と非両立 → 年齢帯 cron 撤去）。`手動固定年齢帯 ui_mode` + `ui_mode_manually_set boolean`（非固定は read 時に birth_date から tier 導出、M2 [must]2 の stale-on-birthday 除去の物理写像）。**表示構成は `display_config` text 据置**（[must]A 是正、§4: 実 field=cardSize/itemsPerCategory/collapsible、初版の `display_color`/`display_decoration` 展開は捏造列で #2148 全消失を招く）。theme/ui_mode/archived_reason CHECK。⚠️ birth_date NULL 旧データは cutover backfill 必須 |
| R-REST_DAY | `rest_days` | `(family_id, child_id, date)` 自然複合 | — | anchor (a) ADR-0012 anti-engagement（休養日 = 減衰猶予、1 日 1 概念）→ 凍結可 |

### §1.3 ActivityCatalog（M2 §1.3）

| M2 リレーション | 物理テーブル | PK | secondary | 物理判断メモ |
|---|---|---|---|---|
| R-CHILD_ACTIVITY | `child_activities` | `(family_id, child_id, activity_id uuid)` | 初期 PK のみ | per-child instance 維持（ADR-0055、catalog+override 不採用）。`取込元テンプレート source_marketplace_item_id text?`（弱帰属、FK 無し、削除耐性）。priority CHECK(must/optional)。category は `categories(code)` 参照（FK 無し）。記録時に category_id を activity_logs へ snapshot（§4.1 式 index 回避） |
| R-ACTIVITY_PREFERENCE | `activity_preferences` | `(family_id, child_id, activity_id)` 自然複合（活動 1:0..1 縦分解） | — | ピン留め/表示順 |
| R-ACTIVITY_MASTERY | `activity_mastery` | `(family_id, child_id, activity_id)` 自然複合 | — | 累計回数/習熟レベルは **導出（D-MASTERY）**。materialize（派生列）は §6/PoC 判断 |
| R-DAILY_MISSION | `daily_missions` | `(family_id, child_id, mission_date, activity_id)` 自然複合 | — | M2 Round 2 で子供属性削除・BCNF 是正済 → PK に child_id を含むのは family_id 先頭 tenant 物理規約ゆえ（論理は活動経由導出、物理は tenant PK 規約で child_id を PK 前置。矛盾なし = child_id は活動所有子供と一致し PK 前置は tenant 隔離目的）。`完了か` は導出（D-MISSION-DONE） |

### §1.4 GrowthJournal（M2 §1.4）

| M2 リレーション | 物理テーブル | PK | secondary | 物理判断メモ |
|---|---|---|---|---|
| R-ACTIVITY_LOG | `activity_logs` | `(family_id, child_id, log_id uuid v4)` | 初期 PK のみ（date secondary は PoC 実測後） | `付与ポイント`/`連続日数`/`連続ボーナス` は**記録時確定の不変観測値（制御された冗長、M2 §2.1）** = 物理も素の列で保持（再導出しない）。`recorded_date` は**アプリ set の素の date 列**（式 index 不可 P4 の回避、`CAST` は immutable でなく生成列不可）。`cancelled` boolean |
| R-STATUS | `statuses` | `(family_id, child_id, category_id)` 自然複合 | — | 累計XP/レベル/到達最高XP は**導出（D-XP）**。派生列 materialize は §6（status 更新 txn 内共更新） |
| R-STATUS_HISTORY | `status_history`（append-only） | `(family_id, child_id, category_id, hist_id uuid v4)` | — | recorded_at は素の列（sort 用途）。D-XP の権威源 |
| R-EVALUATION | `evaluations` | `(family_id, child_id, eval_id uuid v4)` | — | 自然候補キー `{child, week_start}` は droppable UNIQUE（週次一意）。ボーナスポイントは捕捉観測値。**カテゴリ別スコアは `scores_json` text 列に据置**（[must]A 是正、§4: 子表 `evaluation_scores` を作らない。field query 0 件 + reset-plan 決定#1） |
| R-EVALUATION_SCORE | **`evaluations.scores_json` text 列に吸収**（[must]A 是正） | （子表なし） | — | 初版の子表化は原初喪失の現場。text 据置へ是正（§4.2） |

### §1.5 PointLedger（M2 §1.5）

| M2 リレーション | 物理テーブル | PK | secondary | 物理判断メモ |
|---|---|---|---|---|
| R-POINT_LEDGER_ENTRY | `point_ledger`（append-only、経済点数の唯一権威） | `(family_id, child_id, ledger_id uuid v4)` | **`(family_id, child_id, type, recorded_date)`**（must-bonus 冪等 hot path、spike#7 で 2x = 最初から張る）。履歴ページング用 `(…, created_at)` は PoC 後の任意追加 | **created_at は PK に入れない**（等値検索されず sort 用途のみ = P9）。UUID v4 で hot-partition ゼロ。残高は**導出（D-BALANCE、I-BAL）**。**由来参照は多態 2 列 `source_type` + `source_id`（U-7 物理帰結、単一 FK で多態不能ゆえ、FK 無し弱参照）**。increment 符号（正/負/中立）で付与/裁量消費/繰越を区別（種別 CHECK 集合は M4 で SSOT から生成） |

### §1.6 Reward / Checklist進捗 / Stamp / Battle / Challenge（M2 §1.6）

| M2 リレーション | 物理テーブル | PK | secondary | 物理判断メモ |
|---|---|---|---|---|
| R-SPECIAL_REWARD | `special_rewards` | `(family_id, child_id, reward_id uuid)` | `(family_id, child_id, granted_at)`（findUnshownReward hot） | 付与者は memberships 参照（FK 無し） |
| R-REDEMPTION_REQUEST | `reward_redemption_requests` | `(family_id, redemption_id uuid)` | `(family_id, child_id, status)` + `(family_id, status, requested_at)` | 申請時の名称/必要ポイントは**不変捕捉（制御冗長 I-REDEEM）** = 素の列。対象ごほうびは任意参加（削除後存続、FK 無し弱参照）。承認 = point_ledger 負エントリ 1 件 |
| R-CHECKLIST_LOG | `checklist_logs` | `(family_id, child_id, template_id, checked_date)` 自然複合 | — | anchor (a): 日次一意（I-CHECKLIST）。配信済前提（I-CHECKLIST の [R] 化）は **`(family_id, template_id, child_id)` の checklist_template_assignments 存在を app 層で保証**（P3 で複合 FK 物理不能 → §3.3） |
| R-CHECKLIST_ITEM_RESULT | **`checklist_logs.items_json` text 列に吸収**（[must]A 是正） | （子表なし） | — | 初版の子表 `checklist_log_items` を作らない。field query 0 件（実 grep）+ reset-plan 決定#1（§4.2）。item_id 集合を text 据置 |
| R-CHECKLIST_OVERRIDE | `checklist_overrides` | `(family_id, child_id, override_id uuid)` | — | 自然キー一意の前提を置かず surrogate（特定テンプレに紐づかない当日調整） |
| R-CHILD_CHALLENGE | `child_challenges` | `(family_id, child_id, challenge_id uuid)` | `(family_id, child_id, status)` | **targetConfig/rewardConfig を `target_config`/`reward_config` text 据置**（[must]A 是正、§4: 列展開だと実 write の `genMissStreak`（#3203 救済入力）/`genMode`/`activityId`/`ageAdjustments` を silent drop = 原初喪失と同型）。連動グループキーは表示上の束ね（グループ実体表を作らない、L-06） |
| R-STAMP_CARD | `stamp_cards` | `(family_id, child_id, card_id uuid v4)` | **droppable UNIQUE `(family_id, child_id, week_start)`** | **UUID surrogate**。**M2 §3.1 が既に R-STAMP_CARD を「代理識別子を PK」バケットに分類済**（M2 §1.6 も PK=`{カード同一性}` surrogate + `{子供,週の開始}` を自然 UNIQUE 併記）→ 本 M3 は **M2 の代理識別子判断を物理で追認し根拠を明文化**（[must]C8 是正、「M2 の自然複合を物理で降格」は捏造ゆえ撤回）。物理根拠 = governing rule anchor (b) 不成立（シーズン/イベントカード復活が roadmap 上あり得る = 同一週複数カードで cardinality 可変、PO 決裁 2026-07-03 PR #3547）。週1枚は droppable UNIQUE で維持し復活時は UNIQUE DROP のみで PK 不変 |
| R-STAMP_ENTRY | `stamp_entries` | `(family_id, card_id, slot)` 自然複合 | UNIQUE `(family_id, card_id, punch_date)`（1 日 1 押印 I-STAMP-1DAY、droppable） | 2 候補キー間従属は候補キー→非キーのみ（BCNF 保持）→ 昇格可 |
| R-LOGIN_BONUS | `login_bonuses` | `(family_id, child_id, login_date)` 自然複合 | — | anchor (a) ADR-0012（1 日 1 回）→ 凍結可。連続日数は記録時確定観測値 |
| R-DAILY_BATTLE | `daily_battles` | `(family_id, child_id, date)` 自然複合 | — | anchor (a) ADR-0012（1 日 1 戦）→ 凍結可。**戦果値 = 非経済の内部演出値**（台帳外、D-BALANCE 非寄与）。**戦闘時ステータスは text 据置 opaque 値オブジェクト（§4、field query ゼロ + backup verbatim）** |
| R-ENEMY_COLLECTION | `enemy_collection` | `(family_id, child_id, enemy_id)` 自然複合 | — | 討伐回数/初討伐日時は**導出（D-ENEMY、可変集約ゆえ captured observation 免罪符が効かない → 導出）** |

### §1.7 ChecklistTemplate（family master、M2 §1.7 = ADR-0055 唯一の例外 3 層）

| M2 リレーション | 物理テーブル | PK | secondary | 物理判断メモ |
|---|---|---|---|---|
| R-CHECKLIST_TEMPLATE | `checklist_templates` | `(family_id, template_id uuid)` | — | 家族マスタ |
| R-CHECKLIST_ITEM | `checklist_template_items` | `(family_id, template_id, item_id uuid)` | — | テンプレ 1:N |
| R-CHECKLIST_ASSIGNMENT | `checklist_template_assignments` | `(family_id, template_id, child_id)` 自然複合（M:N 解決連関） | `(family_id, child_id)`（findTemplatesByChild hot） | **本モデル唯一の M:N 解決**。anchor (b): 配信は (テンプレ,子) 1 対 = 構造的確実 → 凍結可 |

### §1.8 Child 衛星（M2 §1.8）

| M2 リレーション | 物理テーブル | PK | secondary | 物理判断メモ |
|---|---|---|---|---|
| R-PARENT_MESSAGE | `parent_messages` | `(family_id, child_id, msg_id uuid v4)` | — | sent_at 素の列。送信者 = memberships 参照（role∈{parent,owner} は app 層 I-MSG-SENDER、§3.3） |
| R-SIBLING_CHEER | `sibling_cheers` | `(family_id, cheer_id uuid)` | `(family_id, to_child_id, shown_at)` | 送り手/受け手とも child（同一 family_id 内 = PK 前置で構造保証）。M2 の SIBLING_CHEER/SENT 2 関係を 1 表 2 参照に統合 |
| R-CERTIFICATE | `certificates` | `(family_id, child_id, certificate_id uuid v4)` | droppable UNIQUE `active_key GENERATED (CASE WHEN … type)` 要時 | **UUID surrogate**。**M2 §3.1 が既に CERTIFICATE を「代理識別子を PK」バケット（衛星）に分類済** → 本 M3 は M2 判断を追認・明文化（[must]C8 是正）。物理根拠 = governing rule anchor 無し（再発行/名前修正 2 通目/周期型証書が roadmap プラウジブル = cardinality 可変、PO/戦略パネル 2026-07-01）。**付帯情報 metadata は text 据置 opaque 値オブジェクト（I-CERT-IMMUT 発行後不変 + field query ゼロ、§4）** |
| R-CHARACTER_IMAGE | `character_images` | `(family_id, child_id, image_id uuid)` | — | key + メタのみ（I-MEDIA-EXT、バイトは `IStorageRepo` = private S3 / NUC ローカル FS）。`外部実体参照`= storage key（相対パス `/tenants/<family_id>/…`） |
| R-CUSTOM_VOICE | `child_custom_voices` | `(family_id, child_id, voice_id uuid)` | — | 同上（source/未 export ユーザー録音 = backup 必須）。`scene` 素の列 |

### §1.9 Family 衛星（M2 §1.9）

| M2 リレーション | 物理テーブル | PK | secondary | 物理判断メモ |
|---|---|---|---|---|
| R-GRADUATION_CONSENT | `graduation_consents` | `(family_id, consent_id uuid v4)` | `(family_id, agreed_public, consented_at)`（publicSamples/aggregate） | 複数子×複数回 = surrogate。**卒業時点数KPI/利用期間日数KPI は概念外プロジェクション**（台帳外、D-BALANCE 非寄与） |
| R-PUSH_SUBSCRIPTION | `push_subscriptions` | `(family_id, subscription_id uuid)` | **UNIQUE `(endpoint)` global**（無 tenant 単点 findByEndpoint） | endpoint は rotate される mutable = surrogate。購読元 membership role∈{parent,owner}（I-PUSH-ROLE、§3.3） |
| R-NOTIFICATION_LOG | `notification_logs`（append-only） | `(family_id, log_id uuid v4)` | sent_at 素の列 | once-per-period 一意なし = surrogate |
| R-VIEWER_TOKEN | `viewer_tokens` | `(family_id, token_id uuid)` | **UNIQUE `(token)` global** | token は revoke 後再発行 = surrogate |
| R-CLOUD_EXPORT | `cloud_exports` | `(family_id, export_id uuid)` | **UNIQUE `(pin_code)` global** + `(status)`（cron findPendingBuilds） | 受渡 PIN = 秘匿値。pin は expire 後再利用 = surrogate |
| R-USAGE_LOG | `usage_logs`（append-only、L-16 Family 一本化） | `(family_id, log_id uuid v4)` | — | 対象子供は任意属性（二重帰属解消） |

### §1.10 グローバル参照（tenant 非依存、M2 §1.10）

| M2 リレーション | 物理テーブル | PK | 物理判断メモ |
|---|---|---|---|
| R-CATEGORY | `categories` | `(code)` 自然キー | 固定 5 軸。tenant プレフィクスなし |
| R-STAMP_MASTER | `stamp_masters` | `(stamp_code)` 自然キー | レアリティ列挙 |
| R-AGE_BENCHMARK | `age_benchmarks` | **U-1 未決（§9）** | M2 既定 `(年齢)` / 候補 `(年齢, category_id)`。**PK 凍結対象ゆえ freeze 前に board 確定必須** |
| R-PLAN | `plans`（lookup 表） | `(plan_code)` 自然キー | 増減集合ゆえ lookup（CHECK でない、P1 の ALTER 後付け不可回避）。`plan_tier` 参照 |
| R-PLAN_TIER | `plan_tiers`（lookup 表） | `(plan_tier)` 自然キー | → 猶予日数（I-LIFECYCLE grounding、[must]1 推移従属分解済） |
| R-BILLING_EVENT_OBSERVATION | `stripe_webhook_events` | `(event_id)` 自然キー | webhook 冪等（at-least-once、二重課金防止）。tenant_id は nullable analytics 属性。実装は課金稼働前 MUST（本データモデル凍結と decouple） |

---

## §2 PK 戦略（§P1 不変性下の凍結確定）

### §2.1 自然複合 PK 昇格の governing rule（§P1 凍結の監査可能な線引き、構造決定）

**§P1（PK 後変更不可、AWS 公式裏取り済）ゆえ、自然複合 PK の凍結は非可逆**。誤って自然複合 PK を凍結し後で cardinality が反転すると、表の作り直し（PK は ALTER 不可）が必要になる。→ **自然複合 PK は once-per-period 一意が以下いずれかに anchor される表のみ許す**（戦略/PO パネル 2026-07-01）:

- **(a) policy invariant**（ADR 参照必須、例 ADR-0012 anti-engagement の直接帰結）
- **(b) 構造的確実性**（他 cardinality が product 上存在しないことの明示）

「現状そうなっている（mutable product default）」だけを根拠とする表は **UUID surrogate PK + droppable UNIQUE** に落とす（UNIQUE でも 2 件目拒否の enforcement は同一に効く／失う可逆性は不変条件反転時のみ要る）。

| 判定 | 表 | anchor |
|---|---|---|
| **凍結（自然複合 PK）** | rest_days / login_bonuses / daily_battles | (a) ADR-0012（1 日/1 期間 1 回 = anti-engagement の直接帰結） |
| **凍結（自然複合 PK）** | statuses / activity_mastery / activity_preferences / daily_missions / stamp_entries / checklist_logs / checklist_log_items / checklist_template_assignments / evaluation_scores | (b) 構造的確実性（子供×カテゴリ / 活動×子供 / 配信×子供 / 日次1 は product 上単一 cardinality。既存 UNIQUE index が全昇格表で裏付け済 = grep 実測 2026-07-01） |
| **UUID surrogate + droppable UNIQUE（M2 代理識別子分類を追認）** | stamp_cards（シーズン復活で週複数化可）/ certificates（再発行・周期型で type 複数化可） | **M2 §3.1 が既に両者を代理識別子バケットに分類済**（[must]C8）。物理 outcome は M2 と一致。governing rule anchor 無しの明文化として根拠を補強（mutable product default → §P1 で自然 PK 凍結不可） |

### §2.2 PK 凍結 manifest の考え方（構造決定）

- **凍結 ceremony**: §1 の全 PK を board 確定後に「凍結 manifest」として固定。以降 PK 変更は表再構築を要する（P1）→ M4 実装前の最終レビュー gate。
- **linchpin `children.child_id`**: ~25 テナント表の複合 PK 先頭に伝播するため**最優先凍結**。int → UUID 変換は cutover 時に一度だけ（後戻り不可）。
- **代理キー併存原則（M2 §3.3 の物理写像）**: surrogate PK 表でも M2 の自然同一性を **droppable UNIQUE** で必ず宣言（例 stamp_cards `(child, week_start)`、evaluations `(child, week_start)`、redemption は無し）。「UUID で JOIN しつつ自然一意性は UNIQUE で担保」= DynamoDB 型 opaque id 一律強制の歪みを回避。UNIQUE は ALTER で後付け/DROP 可（P1 の PK と異なり可逆）。
- **zero-user rebuildability**: cutover 前は本番ユーザー 0 のため、凍結 PK が誤りでも表再構築の実損は無い（DynamoDB 破棄 OK・NUC バックアップ後破棄 OK の前提）。凍結の非可逆性が牙を剥くのは**本番稼働後**ゆえ、稼働前レビューで潰す。

---

## §3 参照整合の物理実装（DSQL は FK 非対応 P3）

M2 の全論理 FK（`参照<R>`）を、**FK 制約なし（P3、spike#1 + AWS 公式裏取り）**の下でどう保証するか。手段を 4 種に分類（すべて構造決定）。

### §3.1 手段の分類

| 手段 | 適用 | 例 |
|---|---|---|
| **(A) 複合 PK 包含**（参照先キーを PK に含み構造的に存在保証） | 子表の親参照 | stamp_entries の card_id / status_history の `(child, category)` / daily_missions の activity（同一 (family,child) 内） |
| **(B) 生成列 + UNIQUE ASYNC**（DB 物理強制できる不変条件） | I-OWN の「≤1」/ soft-delete 一意 | memberships `owner_guard`（owner **≤1 名**を UNIQUE で物理拒否）/ 各表 `active_key`（未削除行で一意、NULLS DISTINCT）。**enforcement の実挙動（`23505`）は spike#3 依拠 = PoC 保留に降格（§7、#3427）**。owner の「≥1（最後の 1 名を残す）」は本機構で守れず (C) app 層（§3.3） |
| **(C) app 層単一強制点**（tenant-scoped repository が参照存在を保証） | 大半の集約横断 FK | 記録時に activity 所有 child を解決し family_id/child_id を注入。「参照先 tuple 存在」は書込パスで app が保証（読取は tenant フィルタで越境不能） |
| **(D) 弱参照（存在保証なし、削除耐性）** | 任意参加 FK | redemption.対象ごほうび / child_activities.取込元テンプレート / point_ledger.由来参照（多態 `source_type`+`source_id`）→ 参照先削除を許す（NULL 化 or 孤児許容）。物理的に何も強制しない列。**⚠️ 多態解決時は必ず `WHERE family_id = <当該行.family_id>` で再スコープ**（by-id 単独 fetch は cross-tenant 露出、§3.4 不変条件） |

### §3.2 M2 FK → 物理手段の割当（トレーサビリティは §8）

- **NOT NULL FK（全域参加、I-CHILD-FAM）**: 全テナント表の `family_id`（PK 先頭 = (A) 構造保証）+ 子供スコープの `child_id`。参照先 family/child の存在は **tenant-scoped repository の書込パス（C）** が保証（越境書込は repository 単一強制点で不能）。
- **任意参加 FK（弱参照）**: (D)。参照先が消えても本行存続（I-REDEEM の歴史性等）。
- **DB 物理強制できる少数**: I-OWN → (B)。それ以外の「role/家族一致」述語は静的制約で表せず (C) + §3.3。

### §3.3 FK だけで表せないタプル間述語の担保（M2 §3.2/§5.3 の [C]/[M3] 物理化）

| M2 述語 | 物理担保 |
|---|---|
| I-CHECKLIST（配信済テンプレのみ進捗） | M2 は複合 FK `{子供,テンプレ}→assignment` に [R] 格上げしたが **P3 で複合 FK 物理不能** → **(C) app 層**: 進捗 INSERT 前に assignment 存在を同一 txn で確認（`SELECT … FOR UPDATE` で write-intent 化、書込パス保証） |
| I-MSG-SENDER（送信者 role∈{parent,owner} ∧ 送信者家族=受信子供家族） | family 一致は **PK 先頭 family_id 共有で構造保証（A）** + role は memberships 参照を (C) app 層で検証 |
| I-CHEER（送受両子供同一家族 ∧ 送り手≠受け手） | family 一致は PK family_id 共有（A）+ 送り手≠受け手は (C) app 層 or CHECK(from_child ≠ to_child) |
| I-PUSH-ROLE（購読元 role∈{parent,owner}） | 購読元 membership 参照を (C) app 層で検証 |
| 家族境界一致（集約横断一般、M2 U-6） | **PK 先頭 family_id 冗長配置で構造保証（A）= U-6 を (b) 冗長配置で物理確定**。参照元・参照先が同一 family_id を PK に持つため cross-family 参照は物理的に別 partition = tenant fitness function が越境クエリを CI hard-fail |
| **child_id 物理再導入の等価不変条件（[should]、M2 が自明化した述語の物理復活）** | activity_logs / daily_missions は M2 で「子供=活動経由導出」ゆえ論理は child_id を持たないが、**物理は tenant PK 規約で `(family_id, child_id, …)` を PK 前置**（§1.3/§1.4）。→ M2 が自明化した「`child_id == 活動所有 child`」述語を **物理では (C) app 層不変条件として復活**（記録時に activity.child_id を解決し PK の child_id と一致させる。不一致は書込拒否）。「物理写像で述語が復活した」ことを明示（M2 の BCNF 是正を巻き戻さず、物理 tenant 規約と両立させるための app 層保証） |

### §3.4 テナント分離の物理強制（ADR-0063、P8 RLS 非対応の代替）

RLS 非対応（P8）ゆえ DB エンジン強制の砦なし。代替防御線（ADR-0063）:

1. `family_id` 列 + 複合 PK 先頭（本書 §1.0、構造決定）。
2. 信頼 tenantId（Cognito 署名で偽造不能、`hooks.server.ts` 確定）→ DB は JWT を読まない（構造決定）。
3. tenant-scoped repository 単一強制点（生クエリ境界外禁止、`WHERE family_id = :ctx` 注入を 1 箇所集約、構造決定）。
4. **fitness function（`family_id` 述語 CI 強制）の例外は閉じた allowlist に固定**（[must]B5 是正）: 下記**列挙表以外の全 SELECT/UPDATE/DELETE で `family_id` 述語欠如を CI hard-fail**（RLS 代替、ADR-0061 整合）。allowlist を open な「グローバルっぽい表」判定でなく**明示列挙**にし、新表が silent に family_id 述語なしで通るのを防ぐ。
5. cross-tenant E2E 不変条件: 家族 A token で家族 B リソースを叩き 403/空 を assert（IDOR hardening #3228 同型）。**加えて capability/global-UNIQUE lookup（token/pin/endpoint by 単一キー fetch）後は必ず取得行の `family_id` で再スコープしトークン他家族流用を assert**（下記不変条件）。

#### fitness function 例外の閉じた allowlist（これ以外は hard-fail）

| 分類 | 表 | family_id 述語なしで許す理由 |
|---|---|---|
| **グローバル master**（tenant 非依存） | `categories` / `stamp_masters` / `age_benchmarks` / `plans` / `plan_tiers` / `stripe_webhook_events` | family に属さない共有参照（§1.10）。テナントデータを含まない |
| **tenant 非依存 auth** | `users`（global、email lookup）/ `email_login_lockouts`（未登録メールもロック対象） | family に閉じない独立参照（M2 Q-02=A / I-EMAIL-LOCK） |
| **global-UNIQUE capability lookup** | `viewer_tokens`(token) / `cloud_exports`(pin_code) / `push_subscriptions`(endpoint) / `memberships`(user_id → findUserTenants) / `invites`(token_hash) | 無 tenant 単点 lookup（capability = 偽造不能秘密で照合）。**⚠️ この単点 fetch は必ず後段で取得行の family_id に再スコープ**（下記不変条件） |

#### 不変条件（[must]B5）: surrogate/capability 単独 fetch → family_id 再スコープ義務

**「surrogate id / capability キー単独での row fetch は、取得行の `family_id` を確定し以降の全アクセスを当該 family_id に再スコープするまで、テナントデータを返してはならない」**。
- 例: viewer_token で家族 X の共有リンクを引いた後、そのトークンで家族 Y のデータを読めてはならない（token 行の family_id = X で以降を束縛）。
- polymorphic `source_type`/`source_id` 解決（§3.1(D)）も同様に `WHERE family_id = <当該 point_ledger 行.family_id>` で参照先を束縛。
- **cross-tenant E2E**: 家族 A の token を家族 B の capability に流用し 403/空 を assert（bare bearer 化による水平権限昇格の regression guard）。

#### 実行時接続ロールモデル（[must]B6、schema 結合 MUST — #3429 を「schema 非依存」から格上げ）

**GRANT を防御線に名指す以上、接続ロールモデルは物理設計の責務**（DbConnectAdmin 接続だと GRANT bypass で残高改竄・同意削除が素通りする）。→ #3429 の IAM ロールモデルを **schema 結合の MUST** に格上げ:

| 用途 | 接続ロール | 権限 |
|---|---|---|
| **アプリ実行時** | 専用最小権限 postgres role（`DbConnect` 系 IAM、`DbConnectAdmin` でない） | tenant 表への SELECT/INSERT + 業務上必要な UPDATE のみ。**append-only 表（`consents`/`point_ledger`/`status_history`/`*_logs`/`trial_history`/`cancellation_reasons`/`graduation_consents`/`notification_logs`）への UPDATE/DELETE grant を与えない**（I-CONS 等の追記性を DB GRANT で物理担保） |
| **migration / admin** | 別クレデンシャル（`DbConnectAdmin`） | DDL・GRANT 管理。アプリ実行経路から到達不能 |

- **fitness**: append-only 表への UPDATE/DELETE を repo 層で非定義 + GRANT 除外 + AST lint の 3 層（RLS 不在の代替、consent 削除・台帳改竄の物理防御）。
- **PoC 保留（#3429）**: L1 `AWS::DSQL::Cluster` の IAM grant helper 欠如（手書き）・role 分離の実 IAM policy は実機構成で確定（構造は本表で確定、実 policy JSON は PoC）。

---

## §4 JSON 列格納方針（**全 JSON 列 text 据置**、実 field + reset-plan 決定#1 で再導出）

> **Round 1 [must]A 是正（データ喪失の根絶、最優先）**: Round 1 board が実 TypeScript 型を照合し、初版の「列展開/子表化」が **field を silent drop する**ことを実コードで捕捉した（原初の危機 = genMissStreak 喪失の再来）。**全 JSON 列を text 据置に是正**する。初版 §4.1 の「reset-plan は存在しない」は **虚偽ゆえ撤回**（`tmp/dsql-reset-plan-2026-07-05.md` は git-tracked でないため plain `grep` でヒットする。前回 Glob 系検索で見落とした）。**reset-plan 決定#1（controlling、2026-07-05 ユーザー承認）= JSON 列は解体せず TEXT 据置** と reconcile する（本節の text 据置採用で自然に整合）。

### §4.1 実 field 照合（列展開/子表化が field を落とす実証、2026-07-05）

**(1) SQL field query は 0 件**: DB 層・全 src で field 単位 JSON SQL アクセス（`json_extract` / `->>` / `jsonb_*` / `@>`）は **0 件**（grep 実測）。JSON 列はすべて service 層で `JSON.parse` により**丸ごと読取**（field は parse 後 JS 内で参照、SQL では引かない）。

**(2) 実 write が宣言型より広い field を含む（列展開の危険を実コードで確証）**:

| JSON 列 | 実 write が含む field | 列展開/子表化で落ちるもの | 影響 |
|---|---|---|---|
| `child_challenges.targetConfig` | `metric` / `categoryId` / `baseTarget` + **`genMode` / `genMissStreak`**（`child-challenge-service.ts:556-562` の write）。宣言型 `TargetConfig`（`:347-353`）は `activityId` / `ageAdjustments` も持つ | 初版 §1.6 の `metric`/`category_id`/`base_target`/`reward_points`/`reward_message` 列展開だと **`genMissStreak`/`genMode`/`activityId`/`ageAdjustments` を silent drop** | `genMissStreak` は #3203 週次チャレンジ救済アルゴリズムの入力＝**原初喪失と同型のデータ喪失** |
| `children.displayConfig` | `cardSize` / `itemsPerCategory` / `collapsible`（`display-config.ts:7-14` の `DisplayConfig` 型） | 初版 §1.2/§4 の展開先 `display_color`/`display_decoration` は **実在しない列（捏造）**。実 field は全く別 | 表示カスタマイズ #2148 の全設定が消失 |
| `evaluations.scoresJson` | カテゴリ別 `count`/`points`/`status_increase`（丸ごと read） | 初版 §1.4 の evaluation_scores 子表化。reset-plan 決定#1 が子表化を**明示否定** | 週次評価スコアの喪失（原初喪失の現場） |
| `checklist_logs.itemsJson` | `item_id` 集合（丸ごと read、field query は実 grep で **0 件**確認） | 初版 §1.6 の checklist_log_items 子表化 | item_id gap #3601 |
| `daily_battles.playerStatsJson` | 戦闘時ステータス丸ごと（M2 値オブジェクト Q-06=A 不透明） | 初版の「列展開 or 子表」候補 | 戦闘演出データ喪失 |

→ **field query 0 件 + 実 write が宣言型より広い**の両輪で、**列展開/子表化は data-loss を招く危険な既定**であり、**text 据置が正しい既定**（reset-plan 決定#1 と同根拠、同結論）。

### §4.2 格納方針（**全 JSON 列 text 据置**、構造決定）

| M2 リレーション属性 | 初版の誤り | 是正（構造決定） | 根拠 |
|---|---|---|---|
| R-CHILD_CHALLENGE.目標条件・ごほうび条件（targetConfig/rewardConfig） | 列展開 | **text 据置** | field query 0 件 + 実 write が genMissStreak 等を含む（§4.1） |
| R-CHILD.表示構成（displayConfig） | 列展開（捏造列名） | **text 据置** | 実 field は cardSize/itemsPerCategory/collapsible、展開先が実在しない。reset-plan は displayConfig を別論点としたが、**実 field 照合の結果 text 据置に一本化**（将来サーバ側 field 検索が実発生したら `ALTER ADD COLUMN` で可逆展開） |
| R-EVALUATION_SCORE（scoresJson） | 子表解体 | **text 据置**（`evaluation_scores` 子表を作らない） | reset-plan 決定#1 が子表化を明示否定。field query 0 件 |
| R-CHECKLIST_ITEM_RESULT（itemsJson） | 子表解体 | **text 据置**（`checklist_log_items` 子表を作らない） | reset-plan 決定#1 + field query 0 件（実 grep） |
| R-DAILY_BATTLE.戦闘時ステータス | text 据置（据置） | **text 据置**（据置） | M2 値オブジェクト Q-06=A + field query 0 件 |
| R-CERTIFICATE.付帯情報（metadata） | text 据置（据置） | **text 据置**（据置） | I-CERT-IMMUT + field query 0 件 |
| R-NOTIFICATION_SETTINGS.静音時間帯 / R-BONUS_RULE.発火条件 | 列展開 | **text 据置**（既定）。静音は `start`/`end` の範囲比較が将来必要なら 2 列展開を可逆に検討（U-3、§9） | field query 0 件（既定は据置＝reset-plan 決定#1 の一貫適用） |

> **物理形式**: `text` 型（両方言 text、`{mode:'json'}` で drizzle が JSON serialize）。**jsonb を採らない**（P4 GIN index 不可で jsonb の実利益ゼロ + backup verbatim 保全 + SQLite parity）。

### §4.3 §1 テーブル定義への反映（子表撤去）

- **`evaluation_scores` / `checklist_log_items` 子表を新設しない**（§1.4/§1.6 の当該行は text 列 `scores_json`/`items_json` に是正）。→ §1.6 の checklist_log_items PK 行・§1.4 の evaluation_scores 子表行は削除し、親（`evaluations`/`checklist_logs`）の text 列とする。
- child_challenges/children の展開列を撤去し `target_config`/`reward_config`/`display_config` text 列に。

### §4.4 派生効果（backup round-trip 破壊 #3376 の解消）

**text 据置は backup round-trip 破壊（#3376、`export-format.ts:286-287` が不透明 `string` で export）も同時に解消**する。export-format.ts の `targetConfig: string`/`rewardConfig: string` は opaque 文字列ゆえ、DB 側を列展開/子表化すると export ⇄ DB の verbatim 往復が壊れる。text 据置なら verbatim 保全され cutover round-trip 安全（reset-plan 決定#1 の「text vs jsonb → text（backup verbatim + sqlite parity）」と整合）。

> **唯一の反証（Phase 1 で裏取り、reset-plan 決定#1 と同じ）**: DPU 読み射影の最適化。**実 DPU 実測で具体問題が出た列のみ後で可逆に見直す（既定は据置）** = §7 PoC 保留（#3425）。列追加は `ALTER ADD COLUMN` 可（P0 §1）で後戻りも安い。

---

## §5 index 戦略（ASYNC 制約下、P4）

> **Round 1 [must]C7 是正（PoC 規律・トレース honesty）**: 一次資料 §11.1 は **spike#1 のみ実施**、§11.2 は spike#2-#8 を「**未実施**」と明記。初版が構造決定として断言した「PK-prefix が既定 access path（spike#5）/ 式 index 42P17 回避（spike#5）/ point_ledger 2x secondary（spike#7）」等は **未実行 spike 依拠ゆえ PoC 保留（#3425/#3427）に降格**。**注: これらは実機 PoC で正当に確定できる見込み**（降格しておけば PoC 結果で構造決定に戻せる）。

### §5.1 構造決定（AWS 公式 doc + spike#1 のみで今確定）

- **PK covering の存在**（P1: PK = index-organized 表本体、全非キー列 INCLUDE covering、heap 不在 = AWS 公式 `working-with-primary-keys` 裏取り）。secondary は btree + **ASYNC 必須（P4 = spike#1 実機）**、式・部分・GIN 不可、≤24 本/表・≤8 列・≤1KiB（AWS 公式 quotas）。
- **時刻列は PK に入れず素の列**（P9 = AWS 公式 hot-partition 回避）。sort は PK プレフィクス covering scan + `ORDER BY … DESC LIMIT`（**planner が実際にこの access path を選ぶかは PoC、下記 §5.2**）。
- **式 index 不可の物理回避（構造）**（P4）: `recorded_date` はアプリ set の素の date 列 / `email_lower GENERATED lower(email)`（lower は immutable）/ activity_logs の category_id を記録時 snapshot。**`CAST(created_at AS date)` の生成列不可（`42P17`）は spike#5 依拠 = PoC 保留（#3427）でクロスチェック**（immutable 判定の実挙動）。据置方針（アプリ set 素の列）は spike に依存しない安全側ゆえ構造決定。
- **最初から張る少数 secondary の候補**（PK プレフィクスで届かない別軸引き）: memberships `(user_id)`（findUserTenants）/ special_rewards `(…, granted_at)` / reward_redemption `(…, status)` / push/viewer/cloud の global UNIQUE。**これらが実際に必要か（planner 採用）・point_ledger の type/recorded_date secondary の 2x 効果は spike#7 依拠 = PoC 保留（#3425）**。

### §5.2 PoC 保留（実性能で判断、確定と称さない、#3425/#3427）

- **PK-prefix scan が既定 access path か**: 初版の「spike#5 が単一 child 規模で PK-prefix scan を既定 access path に選ぶことを実測」は **spike#5 未実施ゆえ確定でない**。実データ規模の `EXPLAIN ANALYZE VERBOSE` で確認（#3425）。
- **投機的 secondary を張らない**: activity_logs の date secondary（getTodayActivityCounts 用）の要否は **実 DPU 実測後に判断**（#3425）。初版の「spike#7 で 520 行/child は不採用（1.5ms）」は未実行 spike ゆえ撤回し、初期は PK のみで開始し計測で追加。secondary 1 本 = 全書込に複合 PK 幅の WriteDPU 加算。
- **point_ledger の type/recorded_date secondary の 2x**: spike#7 依拠 = PoC 保留（#3425）。
- **ASYNC index build 完了待ち + drizzle-kit 生成 SQL の DSQL 適合**（同期 CREATE INDEX / DDL-DML 分離を吐かないか）は **#3427 で実機検証**（構造は ASYNC + job 完了待ちと確定 = spike#1、drizzle-kit 実挙動は PoC）。ASYNC UNIQUE は §6.5 の書込開放前 build 完了確認と連動。

---

## §6 トランザクション境界（M2 の atomic 不変条件を P5/P7 下で実装）

M2 §5.3 で [M3] に分類された「トランザクション/結果整合の不変条件」を、**1txn=3000 行/10MiB（P5）+ OCC 40001 retry（P7）**の制約下でどう realize するか。

### §6.1 recordActivity の原子化（I-REC、構造決定）

M2 の GrowthJournal 集約 atomic 境界（activity_log 生成 + status 更新 + status_history 追記 + activity_mastery 更新）を **単一 txn（必ず整合させる中核）**にする。点数は本集約外（I-LEDGER-AUTH）だが、**各 point_ledger INSERT は同一 mini-txn 内で `children.total_point` を共更新**（compute-on-write、下記 §6.2）。行数は core 5 行程度 = P5 上限（3000 行）に余裕。

- **core = 単一 txn**（activity_log + status + status_history + mastery + point_ledger base + total_point 加算）。
- **optional = core commit 後の独立 best-effort mini-txn**（combo/mission/challenge/certificate/special_reward、各 additive かつ冪等、失敗隔離 + ログ）。**欠落許容は要 PO 確認**（M2/big-policy §10-8: 現状の握り潰しと同等で regression なし）。

### §6.2 派生列 compute-on-write（total_point 等、構造決定 + PoC 保留）

- **構造決定**: 残高（`children.total_point`）は D-BALANCE（SUM スキャン）を毎回走らせず、**全 point_ledger 書込がその INSERT を行う txn 内で total_point を同一 txn `+= amount` 共更新**（authoritative 増分、SUM 乖離不能、閲覧は列 read 1 回で DPU 削減）。statuses.total_xp/level/peak_xp・activity_logs.streak_days も同型。
- **point 書込プリミティブ一本化（reset-plan 決定#3、2026-07-05 承認と reconcile）**: point_ledger 書込を単一プリミティブ（`insertPointEntry`）に統合（`IActivityRepo.insertPointLedger` 重複廃止）。ドメイン repo は total_point 不触 = total_point は point 書込プリミティブ内でのみ更新（責務単一化、R8/R5 の往復混乱の根治）。
- **carryover 廃止（reset-plan 決定#4、2026-07-05 承認と reconcile）**: 初版 §6.2 の「retention 削除で `type='carryover'` 繰越エントリを同一 txn 挿入」は **reset-plan 決定#4 で廃止**。retention は古い ledger 行削除のみ・total_point 不触で #729（「ポイントは消えず過去明細だけが消える」）を満たす（total_point が authoritative 増分ゆえ削除で残高不変）。**fitness#14 は「total_point == SUM(全ledger)」から「テスト時（非 pruning）の書込増分整合検証」へ再定義**（本番正しさは単一プリミティブ + 同一 txn `+= amount` で構造担保）。→ 初版 §4/§9 の carryover 記述を撤回。
- **PoC 保留（#3425）**: total_point 共更新の **OCC 競合率**（同一 child 行への並行書込が commit ウィンドウで重なる頻度）。**per-child 低書込ゆえ許容の公算大だが実測前に確定しない**。反証時の退避路 = 派生列を落とし D-BALANCE を都度 SUM（可逆）。

### §6.3 OCC retry ラッパ（P7、構造決定）

- 40001（OC000）= 冪等 txn のみ **指数バックオフ + jitter で abort & retry**、service 層に共通ラッパ 1 箇所集約。
- **40001 と 23505 / rowCount=0 を厳密分岐**（invite 受諾等）: `23505`=業務失敗（ALREADY_IN_TENANT、retry 禁止）/ `rowCount=0`=業務失敗（retry 禁止）/ `40001`=競合（retry）。owner_guard の `23505` は即エラー返却。
- **PoC 保留（#3425）**: 実 OCC 競合率。1 家族低競合では非発生だが機構は実在（spike#1 再現済）。

### §6.4 一括 import / 復元の chunk saga（I-4、P5、構造決定 + PoC 保留）

- **構造決定**: backup-archive 一括復元が 3,000 行 or 10 MiB 超なら単一 txn all-or-nothing 不可（P5、spike#1 で 3,001 行拒否確証）→ **chunk 分割（≤3000 行 / ≤10MiB）+ import バッチ ID + 進捗マーカで冪等再適用 + saga（「import 中」フラグ → 全 chunk 成功後 commit）**。lazy migration（cutover 設計必須要件、復旧負担最小化）。
- **PoC 保留（#3428）**: 3,000 行/10MiB 抵触の**実挙動**（10MiB は行幅依存で行数と別に効く）と chunk 実装の実 DPU。**実測前に chunk サイズ既定値を確定しない**。

### §6.5 schema 構築順序（P6、構造決定 + [should] ASYNC UNIQUE build order）

- **1 txn = DDL 1 文・DDL/DML 混在不可（P6、spike#1）**→ migration を 1 文/txn に分割。
- **[should] ASYNC UNIQUE の build 完了を書込開放前に確認**: `owner_guard`/`active_key`/global-UNIQUE 等の UNIQUE index は ASYNC build（P4）ゆえ **job 完了を確認してから当該表への書込を開放**する（build 未完了中に INSERT すると一意制約が未強制 = owner 二重登録・soft-delete 一意破れの窓）。cutover 順序: (1) CREATE TABLE → (2) ASYNC UNIQUE index CREATE → (3) job 完了 poll → (4) 書込開放。populated 表への UNIQUE 後付けは dedup 先行（この挙動 F1 は spike#6 依拠 = PoC 保留 #3427。greenfield 空表への inline UNIQUE も spike#6 依拠ゆえ #3427 でクロスチェック）。

### §6.6 その他 [M3] 不変条件の realize（構造 + 一部 PoC 保留）

| M2 不変条件 | 物理 realize |
|---|---|
| I-BAL-NONNEG / I-NEG-BAL（裁量消費の非負・負残高中消費禁止） | 消費 txn 内で残高（total_point）読取 → 十分時のみ負エントリ append。write skew 防止に `SELECT … FOR UPDATE` で write-intent 化を**候補とするが**、**DSQL OCC 下で `FOR UPDATE` が commit 時 conflict footprint（40001 誘発）を生むかは未検証 → PoC 保留（#3425、[should]）**。「FOR UPDATE で write skew 防止」を構造決定と称さず、代替（消費も point_ledger INSERT で total_point `+= 負値` する同一 txn write にし read-then-write を write-then-check に畳む）も PoC で比較。競合率も #3425 |
| I-SUB（トライアル二度取り禁止・状態遷移） | subscription_state の状態遷移を app 層遷移制約 + トライアル使用日時の非 NULL 化冪等 |
| I-DECAY（日次減衰） | cron バッチ（全テナント横断、rest_days/decay_policy 入力）。cross-tenant 書込は recordActivity と同格の chunk 化（§8.1 big-policy 相当） |
| I-PURGE（家族 purge カスケード） | family_id プレフィクスで全子孫削除（`deleteByPrefix(tenants/<family_id>/)` 相当）+ ドメイン外メディア実体消去（IStorageRepo）。TRUNCATE 不可（P0 §4）ゆえ DELETE + chunk |
| I-PIN-RESET / I-DOWNGRADE | 検証済ワンタイム + 冪等リセット / 下位プラン変更時アーカイブ = app 層トランザクション/UX |

---

## §7 PoC 保留リスト（M4 実装のブロッカー、#3425-#3429）

> **決定的原則**: 以下は**実測が要る物理判断**であり、**実測前に確定と称さない**。**M4 実装はこれら PoC の close 後にのみ着手**（フェーズゲート）。各 PoC は EPIC #3424 配下の spike issue に紐付く。

| PoC | issue | 保留中の物理判断 | 反証時の退避路（可逆性） | ブロックする §本書 |
|---|---|---|---|---|
| 実 DPU / OCC 競合率 | **#3425** | (1) total_point compute-on-write の OCC 競合率（§6.2）(2) read-model compute-on-read の read DPU 許容度 (3) 投機的 secondary の要否 + **PK-prefix が既定 access path か（[must]C7 降格、旧 spike#5）** + **point_ledger type/recorded_date secondary の 2x（旧 spike#7）**（EXPLAIN ANALYZE VERBOSE） (4) subscription を families へ吸収するか（family-load read DPU、§1.1a） (5) **`FOR UPDATE` が DSQL OCC 下で 40001 footprint を生むか（[should]、§6.6）** (6) JSON text 据置列の read 射影 DPU（§4.4 反証、問題列のみ可逆展開） | (1) 派生列 drop → 都度 SUM (2) read-model 復活 (3) secondary 後付け（ASYNC）/ PK-prefix は planner 依存 (4) table 統合/分離は backfill 可 (5) write-then-check に畳む (6) `ALTER ADD COLUMN` 可逆展開 | §4.4 / §5.2 / §6.2 / §6.6 / §1.1a |
| Lambda 接続再利用 + cold start | **#3426** | 接続確立レイテンシ（spike#1 cold 約 1,450ms）の warm 再利用実測 → 接続プール maxLifetime 既定値 | 実装調整（PK/schema に影響なし） | （実装層、schema 非依存） |
| drizzle-kit DDL 制約適合 + 生成列/UNIQUE 実挙動 | **#3427** | ASYNC index build 完了待ち runner + drizzle-kit 生成 SQL が同期 CREATE INDEX / DDL-DML 混在 / 2 DDL を吐かないか。**加えて [must]C7 降格分**: owner_guard の `23505` enforcement（旧 spike#3）/ `CAST(...date)` 生成列 `42P17`（旧 spike#5）/ greenfield inline UNIQUE + populated dedup 先行 F1（旧 spike#6） | migration 手書き/patch（構造は §6.5 確定） | §3.1(B) / §5.1 / §6.5 |
| 一括 import 3000 行/10MiB 抵触 | **#3428** | chunk サイズ既定値（10MiB は行幅依存）・chunk saga の実 DPU・部分失敗の冪等再適用実挙動 | chunk サイズ調整（saga 構造は §6.4 確定） | §6.4 |
| CDK CfnCluster 東京/us-east-1 最小構成 + **IAM ロールモデル（[must]B6 schema 結合）** | **#3429** | L1 `AWS::DSQL::Cluster` 最小構成・DeletionProtection・IAM grant helper 欠如（手書き）・**実行 role（DbConnect 最小権限、append-only 表 UPDATE/DELETE grant なし）vs migration role（DbConnectAdmin）分離の実 policy JSON**（§3.4） | IaC 調整（role 分離の構造は §3.4 確定、実 policy は PoC） | §3.4 |

> **構造決定は PoC を待たない**: PK 不変性（AWS doc）・FK 非対応の担保方式（spike#1）・自然複合 PK 昇格の anchor 判定・**全 JSON 列 text 据置の分類（field grep + reset-plan 決定#1）**・chunk saga の構造・retry ラッパの構造・**fitness allowlist + 接続 role 分離の構造**は **公式制約 / 実 grep / spike#1 で今確定済**。**一方、未実行 spike#2-#8 依拠の性能・enforcement 実挙動（PK-prefix access path / 42P17 / 23505 / 2x secondary / F1 dedup / FOR UPDATE footprint）は PoC 保留に降格済（[must]C7）** = PoC 結果で構造決定に戻せる。

---

## §8 トレーサビリティ（物理判断 → M2 論理 + 根拠）

### §8.1 物理テーブル → M2 リレーション（no-silent-gap）

§1 の各行が M2 全 60 リレーションを漏れなく写像（§1.1〜§1.10 で M2 §1.1〜§1.10 に 1:1 対応）。統合/分割:
- **統合**: R-SIBLING_CHEER(+SENT) → `sibling_cheers` 1 表（M2 で統合済）。
- **子表を作らない（[must]A 是正）**: R-EVALUATION_SCORE/R-CHECKLIST_ITEM_RESULT は **親の text 列に据置**（`evaluations.scores_json`/`checklist_logs.items_json`）。M2 L-04 の論理解体は維持しつつ物理は text 据置（field query 0 件 + reset-plan 決定#1、§4）。
- **1:1 従属の物理クラスタリング**: §1.1a（別表 baseline、families 吸収は PoC）。
- **M2 で構造保留（U-5/U-8）は物理テーブル未確定**（§9）= silent に作らない。

### §8.2 主要物理判断 → 根拠（構造決定 or PoC 保留、[must]C 是正で spike#2-#8 依拠を降格）

| 物理判断 | 根拠種別 | 出典 |
|---|---|---|
| 全 PK 凍結対象・UUID surrogate | 構造決定 | P1/P2（AWS `alter-table-syntax-support` + spike#1 `42704`） |
| family_id 複合 PK 先頭（U-6 を (b) 確定） | 構造決定 | ADR-0063 + P9（AWS 移行 blog 複合キー推奨） |
| FK → (A)複合PK/(B)生成列UNIQUE/(C)app層/(D)弱参照 | 構造決定 | P3（spike#1 + AWS SQLAlchemy blog） |
| 自然複合 PK 昇格 anchor 判定（stamp_cards/certificates は **M2 代理識別子分類を追認**） | 構造決定 | P1 + governing rule + **M2 §3.1 代理識別子バケット**（PO パネル 2026-07-01/03） |
| owner_guard 生成列 + UNIQUE（I-OWN の **≤1 のみ**、≥1 は app 層） | 構造決定（構造）+ **PoC 保留（enforcement 実挙動）** | P4 構造 + **`23505` は旧 spike#3 → #3427 降格** |
| **全 JSON 列 text 据置**（targetConfig/displayConfig/scoresJson/itemsJson/playerStats/metadata/battle） | 構造決定 | **field grep 0 件 + 実 write が宣言型より広い（genMissStreak 等）+ reset-plan 決定#1 + backup verbatim** |
| PK covering の存在 / 時刻列を PK 外に | 構造決定 | P1/P9（AWS primary-keys doc） |
| fitness allowlist 閉集合 + 接続 role 分離 + 再スコープ不変条件 | 構造決定（構造）+ **PoC 保留（実 policy JSON）** | ADR-0063 + P8 + **#3429（IAM policy 実体）** |
| **PK-prefix access path / 42P17 / point_ledger 2x / F1 dedup / FOR UPDATE footprint** | **PoC 保留（旧 spike#2-#8 依拠、降格）** | **#3425/#3427（実測前に確定しない）** |
| **投機的 secondary 採否 / total_point OCC 率 / import chunk 値** | **PoC 保留** | **#3425/#3428** |

---

## §9 M2 未決 U-1〜U-8 の物理的帰結

| M2 U | 論点 | 物理帰結 |
|---|---|---|
| **U-1** | age_benchmarks の CK に category を含めるか（`{年齢}` vs `{年齢, category}`） | **PK 凍結対象ゆえ freeze 前に board 確定必須（P1 で後変更不可）**。M2 既定 `(age)`。`AGE_BENCHMARK ‖–o{ STATUS`（status はカテゴリ別）との整合では `(age, category_id)` が自然だが、M2 が「勝手に足さない」で `(age)` 既定 → **物理的には凍結ゲートの blocker**（誤って `(age)` 凍結後に category 別が必要になると表再構築）。**board 決裁を凍結 ceremony 前に強制**。 |
| **U-2** | loyalty 記念チケット（第 2 通貨）counter vs ledger | **物理 = int カウンタ列**（R-LOYALTY_STATE の `(family_id)` 1:1 表）= M2 既定。**ledger 化は新表追加で常に可能（可逆、P1 の PK 制約に非該当）**ゆえ counter 既定が期待損失最小。I-DERIVED 普遍則の穴（増減履歴なし = update anomaly）は残るが、監査可能性が要件化した時点で `loyalty_ledger` 表を後付け（board 判断）。 |
| **U-3** | 静音時間帯 2 属性展開 vs 値オブジェクト | **物理 = text 据置（既定）**（[must]A 是正で全 JSON 列 text 据置に一本化、reset-plan 決定#1）。範囲 field query 0 件ゆえ据置が安全側。将来 `start`/`end` の SQL 範囲比較（静音時間帯の DB 側判定）が実発生したら 2 列展開を `ALTER ADD COLUMN` で可逆に検討（displayConfig と同扱い）。M2 の論理展開は「意味ある属性への分解」の宣言であり、物理格納の text 据置と両立（parse 後 JS で分解） |
| **U-4** | 1:1 家族方針の縦分解 vs Family 吸収 | **物理 = 別テーブル baseline**（§1.1a、WriteDPU バイト課金 + 独立更新 + 概念独立）。families 吸収は read-DPU 最適化として **PoC 保留（#3425）**。可逆。 |
| **U-5** | L-14a 軽微概念（ごほうびテンプレ選択/オンボーディング設問/ライフサイクルメール）の構造 | **物理テーブル未確定（M2 で構造保留、silent に作らない）**。構造化時は新表追加（可逆）= PK 凍結 blocker ではない。board 確定後に §1 追補。 |
| **U-6** | 家族境界一致述語 FK 連鎖 vs family_id 冗長配置 | **物理 = (b) family_id 冗長配置（PK 先頭）で確定**（ADR-0063、§1.0/§3.3）。集約横断家族一致を PK family_id 共有で構造保証 + tenant fitness function。**構造決定**。 |
| **U-7** | 由来参照の多態（弱単一 vs 由来種別+識別子） | **物理 = 2 列 `source_type` + `source_id`（多態明示）**（M2 §0 の単一 `参照<R>` では多態を表せず well-formed でないゆえ、M2 自身が推す (b)）。FK 無し弱参照（P3 + 削除耐性）。**構造決定**。 |
| **U-8** | FixedIntervalReward の最小構造（発行間隔 N/last-issued/冪等キーの置き場所） | **物理テーブル未確定（M2 で構造保留）**。発行結果は special_rewards として現れる。発行状態（間隔 N・last-issued・冪等キー）は R-CHILD_ACTIVITY 列追加（`ALTER ADD COLUMN` 可逆）or 独立発行状態表（新表可逆）のいずれも **PK 凍結 blocker でない**。board 確定後に §1 追補。 |

> **凍結 ceremony の blocker は U-1 のみ**（PK に触れる）。U-2/U-3/U-4/U-5/U-8 は列追加/新表/列 drop で可逆ゆえ凍結後も対応可。U-6/U-7 は構造決定済。

---

## §10 物理層の遵守確認（M2 論理を覆していないこと）

- **正規形・候補キー・導出関係を覆していない**: M2 の 3NF/BCNF・候補キー・§4 導出関係（D-BALANCE 等）をそのまま物理化（派生列 materialize は「導出の物理実現」であって論理の変更でない）。
- **値オブジェクト境界を尊重 + データ喪失の根絶（[must]A）**: **全 JSON 列を text 据置**（field grep 0 件 + 実 write が宣言型より広い + reset-plan 決定#1）。M2 の「意味ある属性への展開」宣言は parse 後 JS 分解で満たし、物理格納は text 据置 = 論理を反転せず data-loss を根絶。
- **per-child 主軸・PointLedger 唯一権威・第 2 通貨分離を維持**: family_id/child_id PK 前置は tenant 隔離の物理目的であり、M2 の per-child 主軸を強化こそすれ覆さない。D-BALANCE scope（経済点数のみ）・戦果値/KPI の台帳外を維持。total_point は authoritative 増分（carryover 廃止、reset-plan 決定#4）で SUM 権威を構造担保。
- **M1 忠実性の連鎖**: M2 が M1 を忠実写像し、本 M3 が M2 を忠実写像（M1→M2→M3 のトレーサビリティ連鎖）。
- **移植ハックの非継承 + reset-plan controlling 決定の reconcile**: big-policy doc / develop の DSQL コードは参照したが、JSON 格納は **M2 + 実 grep + DSQL 制約 + reset-plan 決定#1 から再導出**（big-policy doc の列展開/子表化/jsonb は data-loss ゆえ採らない）。reset-plan 決定#1-#4（2026-07-05 ユーザー承認、controlling）を否定せず reconcile 済（JSON text 据置 / branded id + 合成 id 廃止 / point プリミティブ一本化 / carryover 廃止）。

---

## 関連
- `docs/design/dsql/m2-logical-model.md` — M2 論理モデル（本書の入力・SSOT）
- `docs/design/dsql/m1-conceptual-model.md` — M1 概念モデル（背景）
- `docs/design/dsql/detailed-design-process.md` — 詳細設計プロセス（M3 の INPUT/OUTPUT/決裁条件）
- `docs/research/2026-06-28-aurora-dsql-adoption.md` — Phase 0 調査 SSOT + spike#1 実機実測（§11.1）
- `docs/decisions/0063-dsql-pool-multitenant-isolation.md` — pool マルチテナント分離（§3.4 の根拠）
- `docs/design/dsql-data-model.md` — 大方針設計書（**参照材料**。本書は M2 + 実 grep + DSQL 制約から再導出し、certificate metadata の jsonb→text 等で再判断）
- AWS 公式: `alter-table-syntax-support.html`（P1 PK 不変性）/ `working-with-primary-keys.html`（P1/P9 index-organized）/ SQLAlchemy × DSQL blog（P3 FK 非対応）
