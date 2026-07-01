# DSQL データモデル設計書（ground-up 再設計、EPIC #3424）

> **状態**: 叩き台（PO レビュー反復で確定）。関連: EPIC #3424 / #3433 / research `2026-06-28-aurora-dsql-adoption.md` §10-§11 / spike#1-7（実機検証、`tmp/dsql-data-model-research-results-2026-06-29.md`）。
> **原則**: 既存 schema は**入力であって anchor ではない**。ドメインとアクセスパターンから DSQL 最適なリレーショナルモデルを起こす。
> **用語 SSOT**: 本書のテナント識別子は一貫して **`family_id`**（= 旧 SQLite `tenant_id` 列を rename / 新表は `family_id`）。§P9 fitness function の「tenant_id NOT NULL 機械強制」は `family_id` を指す。
> **リージョン（本データモデルは region 中立、2026-07-01 訂正）**: 本番スタック（Lambda/Cognito/CloudFront/現 DynamoDB）は **`us-east-1`**。DSQL は本番スタックと**同一リージョンに置く**（Lambda→DSQL を intra-region に保つ＝クエリは ~1-15ms warm、spike#8 実測）。**リージョン/data residency の変更（例 ap-northeast-1 への国内化）はデータモデルでなくスタック全体のインフラ判断**であり本書 scope 外。DSQL 東京は 2026-05 提供済で、APPI「外的環境の把握」開示義務の観点から**将来スタック全体の東京移設を検討する価値はある考慮事項**として §10 に flag（データモデルは region に依存しないため決裁は不要）。※子供ホームの多クエリは **server-side（Lambda→DSQL、intra-region）**で、リージョン差が効くのは browser→Lambda の 1 往復のみ（21×トランス太平洋ではない）。spike#1-8 の DSQL 内部挙動（warm/cold・OCC）はリージョン非依存。
> **ADR-0063 ステータス**: テナント分離 ADR-0063 は **open PR #3467・develop 未 merge**。本書がそれに依存する箇所は merge 前提。現状のテナント分離 SSOT は `docs/design/14-セキュリティ設計書.md §5.2/§5.2.1`。

---

## §1 設計背景（この設計がなかった場合に何が困るか）

現行 DB は **3 バックエンド並行実装（SQLite / DynamoDB / demo）の共通形状**であり、スキーマが DynamoDB single-table に強く規定されている（監査で実証）:

- auth ドメイン（tenant/user/membership/invite/consent）が **SQL schema に不在**（DynamoDB 専用）。
- tenant_id が 46 表中 15 表のみ。child 配下は childId 経由の暗黙導出で、SQLite は `_tenantId` を捨てる。
- surrogate integer PK 43/46 + `counter.ts`（hot-item 採番）+ `padId` 辞書順ハック。
- JSON 詰め込み（itemsJson 等）/ 非正規化スナップショット / 残高二重実装（BALANCE item vs SUM）。
- `recordActivity` が 5+ 表を**非トランザクション best-effort**で書込（例外握り潰し）。

これを「移植」すると **DSQL に NoSQL 前提構造を持ち込み**、整合性・コスト・保守性を恒久的に毀損する。SQL 統一の機に、あるべき DB 設計を ground-up で確定する。

## §2 設計原則（DSQL 物理特性 → 設計ルール、一次ソース根拠は research §11）

| # | 原則 | 根拠 |
|---|---|---|
| P1 | **PK = 物理レイアウト**（DSQL は index-organized）。PK は後から変更不可 → 凍結してから migration | Primary keys doc |
| P2 | **複合 tenant PK `(family_id, …)`** をテナント系全表に（tenant_id 先頭）。同一家族を物理共置・越境クエリ抑止 | Citus 定石 / SaaS PG Guidance |
| P3 | **UUID v4 PK 既定**（`gen_random_uuid()`、実機✅）。**単調増加列（created_at/timestamp/sequence）を PK に入れない**（hot partition + identity でなく sort 用途）。時刻列は普通の列にし、ページングは PK プレフィクス scan + `ORDER BY` LIMIT（家庭スケール安価）、必要時のみ `(family,child,時刻)` secondary を後付け。自然複合 identity（category_id/date 等の等値キー）は複合自然 PK に昇格 | SQLAlchemy blog / Part2 / PO 指摘 2026-07-01 |
| P4 | **FK 非対応 → DDD 集約 + repository で整合**。`onDelete cascade` 不可 → soft delete（`deleted_at`）or 物理削除。**親キー検証は `SELECT FOR UPDATE` では不可**（spike#6/F9: OCC 下で親 DELETE と子 INSERT が両 commit＝orphan）→ 親は **soft-delete** か、子 INSERT と同一 txn で**親行を touch（UPDATE）して OCC 40001 で並行親削除を検出**。**条件付き一意（owner 1名 / 未削除行で一意）は部分 index 不可（spike#2）→ STORED 生成列 + UNIQUE index で代替**（spike#3/#6 実機確証、§4・研究判断⑨） | SQL Dialect blog / spike#2-3/6 |
| P5 | **index は btree 列のみ（spike#2 確証）**: 式 index 不可・部分(WHERE) index 不可・GIN/USING 不可・`CREATE INDEX ASYNC` 強制。**検索したい値は必ず素の列に展開**（`(doc->>'k')` 等の式 index で代替不可）。**PK covering を最優先に hot path の大半を secondary 0 本で賄い、高選択 point-lookup でのみ secondary を足す（初期 PK のみ・実 EXPLAIN ANALYZE で追加、spike#5/#7）。index 過多は Planning Time を増やす（spike#7: 1-5ms→23-27ms）**。⚠️ **DSQL のみ PK=index-organized covering。SQLite は rowid heap で PK covering 不成立** → 物理 index 本数は backend 別（§4.1） | EXPLAIN blog / quotas / spike#2/5/7 |
| P6 | **3NF 既定**。非正規化は「read DPU 削減 > 追加 write DPU」を計測で示した場合のみ。**`jsonb` 列はネイティブ動作する（spike#2 確証、`->>`/`@>` 可）が index 不可** → 「検索する field = 素の列に展開 / 検索しない atomic 文書のみ jsonb」。EAV 却下 | EXPLAIN blog / SQL Dialect / spike#2 |
| P7 | **派生データは同一 txn 内の派生列**（残高等）。手動 ADD 乖離（Dynamo）を根絶。重い集計は compute-on-read+index を既定、計測でマテビュー化 | 監査 §2A |
| P8 | **1 txn = 1 集約**。3,000 行/10MiB/5分 上限と自然整合。集約横断は結果整合 + 冪等。OCC 40001 retry ラッパ | quotas / Concurrency doc |
| P9 | **tenant_id NOT NULL を全テナント表で機械強制**（fitness function、ADR-0063） | ADR-0063 |
| P10 | **cloud=DSQL(pg)/local=SQLite が同一論理モデル共有**。tenant_id は SQLite でも保持（単一家族では定数）。FK は両方張らない | EPIC #3424 |

## §3 集約マップ（DDD aggregate）

| 集約ルート | 主な子エンティティ | txn 境界根拠 |
|---|---|---|
| **Family（テナントルート）** | users, memberships, invites, consents, settings, push_subscriptions, notification_logs, trial_history, viewer_tokens, cloud_exports, cancellation_reasons, graduation_consent（**subscription 状態は families 行の属性**、独立表でない＝§6.6） | auth ドメイン。SQL で初めて正式化 |
| **Child** | **child_activities**, activity_logs, point_ledger(+total_point 派生列), statuses, status_history, evaluations, activity_mastery, **child_activity_preferences**, daily_missions, login_bonuses, special_rewards, reward_redemption_requests, certificates, parent_messages, sibling_cheers, character_images, **child_custom_voices**, checklist_logs(+items), checklist_overrides, child_challenges, daily_battles, enemy_collection, usage_logs, rest_days（report_daily_summaries は §7 で**廃止**、achievements/child_achievements/title は #322 廃止で **drop 確定**＝§10-10、新スキーマに作らない） | `deleteChild` が 11+ 表を 1 txn 削除＝最強シグナル |
| **StampCard**（Child サブ集約） | stamp_entries | card 単位で entry を扱う |
| **ChecklistTemplate**（Family master） | checklist_template_items, checklist_template_assignments(N:M child) | family master。進捗は Child 集約側 |
| **グローバル master**（tenant 非依存） | categories, achievements, stamp_masters, market_benchmarks, stripe_webhook_events | tenant プレフィクスなし |

> **整合ルール**: 集約をまたぐ書込は同一 txn にしない（結果整合 + 冪等）。集約内は 1 txn（例: `recordActivity` を単一 txn 化）。

## §3.5 DB インターフェース ユースケース一覧（実装由来）

> **出典**: 34 DB インターフェース（`src/lib/server/db/interfaces/*.interface.ts`）と SQLite/DynamoDB 実装・呼び出し元（services / `+page.ts` / `+layout.*` の load・action / `hooks.server.ts`）を実コードから網羅抽出。全メソッド表（4 クラスタ）の完全版は `tmp/dsql-db-usecase-extraction-2026-06-29.md`。本節はそこから index/PK 設計を裏取りするための蒸留版。**最適 index/PK/非正規化は一般論でなく本プロダクトの実クエリから決める**（PO 指摘）。

### §3.5.1 最頻 hot path（子供ホーム 1 描画 + recordActivity）

子供ホームは 2 段ロード（親 `(child)/+layout.server.ts` → `home/+page.server.ts`、`await parent()` 連鎖）。1 描画で発行されるクエリ（クラスタ系のみ、根拠 file:line は出典参照）:

| # | 段 | クエリ | テーブル | 種別 |
|---|---|---|---|---|
| H1 | layout | findChildById | children | read |
| H2 | layout | **getBalance = SUM(amount)** | point_ledger | aggregate |
| H3 | layout | findStatuses | statuses | read |
| H4 | layout | findBenchmark **×カテゴリ数(N+1)** | market_benchmarks | read |
| H5 | layout | findRecentStatusHistory **×カテゴリ数(N+1)** | status_history | read LIMIT2 |
| H6 | layout | findAllChildren | children | read |
| H7/H8 | layout | findCardByChildAndWeek + findEntriesWithMasterByCardId | stamp_cards / stamp_entries⋈stamp_masters | read(LEFT JOIN) |
| H9 | home | findActivitiesByChild | child_activities | read |
| H10 | home | getTodayActivityCountsByChild | activity_logs | aggregate GROUP |
| H11/H12 | home | findTodayBonus + findRecentBonuses(1)[+60 if未claim] | login_bonuses | read |
| H13/H14 | home | findTodayMissions + findMissionBonusRecord | daily_missions⋈child_activities / point_ledger | read(JOIN) |
| H15 | home | getStampCardStatus（**H7/H8 重複**） | stamp_cards+stamp_entries | read×2 |
| H16 | home | findStatuses（**H3 重複**、getCategoryXpSummary） | statuses | read |
| H17 | home | countActiveActivityLogs | activity_logs | aggregate COUNT |
| H18/H19 | home | findPinnedByChild + getUsageCounts(30日窓) | child_activity_preferences / activity_logs | read+aggregate GROUP |
| H20 | home | findMustActivitiesWithToday（2 クエリ） | child_activities, activity_logs | read×2 |
| H21 | home | countPointLedgerEntriesByTypeAndDate | point_ledger | aggregate COUNT |

その他 home load で発行（クラスタ外）: child-challenge（findActiveOrUnclaimed + 冪等生成）、special_rewards（findUnshownReward）、parent_messages（findUnshownMessage）、sibling_cheers（findUnshownCheers）、reward_redemption（findUnshownResultByChild）、checklist（findTemplatesByChild + items + overrides + todayLog）。

**recordActivity の write 群（現状 tx 境界無し・逐次 await・例外握り潰し）**: ① activity_logs INSERT ② activity_mastery UPSERT ③ point_ledger INSERT ④ statuses UPSERT ⑤ status_history INSERT ＋ 条件付き（combo/mission の point_ledger 追加・daily_missions UPDATE・challenge 進捗）。読みも多数（findChild, findActivityByIdForChild, countTodayActiveRecords, findStreakLogs[全件], findMastery, getTodayActivityCountsByChild）。→ **§8 単一 txn 化の最重要根拠**。

### §3.5.2 集計・派生・ページングの実装実態（設計判断の裏取り）

| 観測 | 実態 | 影響する設計判断 |
|---|---|---|
| **ポイント残高** | 保持カラム無し、`point_ledger` 全履歴 SUM（point-repo.ts:9、子供 layout 毎描画 H2） | §P7 派生列 `children.total_point` 化 |
| **SQL の真の GROUP BY** | evaluation-repo 2 本（countActivitiesByCategory / findLastActivityDateByCategory）のみ。child-challenge 兄弟グルーピング・battle 連敗・sibling ランキング・graduation 統計は **app-side fetch + JS 集計** | 行数増大時のスキャン量がコスト要因。集計 index は evaluation 系に絞る |
| **report_daily_summaries** | 派生集計テーブル定義あり・**書込未配線**（upsert/deleteOlderThan の caller 0、常に空 read → compute-on-read フォールバック） | **§7 / 判断②** 廃止して compute-on-read 化 |
| **JSON-in-TEXT 列（全て中身不検索）** | checklist_logs.items_json / report_daily_summaries.category_breakdown・checklist_completion / children.display_config / certificates.metadata / child_challenges.target_config・reward_config / daily_battles.player_stats_json / evaluations.scores_json | **§5 / 判断③** 検索 field=列展開 / atomic 文書=jsonb（GIN 不要） |
| **reward 申請 snapshot** | 既に列コピー実装済（reward_redemption_requests に reward_title/points/icon、COALESCE で旧 NULL 行のみ live JOIN fallback、#2832） | **判断①** 実装事実と一致。移行時 backfill or fallback 残置を判断 |
| **OFFSET ページング** | 全クラスタで `findPointHistory` のみ。他は LIMIT 固定（50/20/10/5/1）+ ORDER BY DESC（最新順支配） | 時刻列（created_at/sent_at 等）は**等値検索されず sort 用途のみ＝PK に入れない**（PO 指摘 2026-07-01、判断⑬訂正）。findPointHistory は PK プレフィクス scan（family,child、covering index-only）+ `ORDER BY created_at DESC` + LIMIT（家庭 ~数百行/child で ~1.5ms、spike#7）。大規模化したら secondary `(family,child,created_at)` を後付け（可逆）。UUID v4 PK で hot-partition ゼロ |
| **LIMIT 無し全件スキャン** | findStreakLogs（streak、全記録日 DESC）、findActivityLogs（履歴、期間フィルタのみ） | PK プレフィクス scan + アプリ早期終了（streak は連続切れで打切り）。家庭スケール ~520 行/child は PK scan ~1.5ms（spike#7）。大規模化したら keyset + 計測で secondary 追加 |
| **status カテゴリ N+1** | findBenchmark / findRecentStatusHistory をカテゴリ定数ループで発行（H4/H5） | 各カテゴリは PK プレフィクス range（5×LIMIT2）で安価（§4.1）。1-scan 化は計測後 |
| **layout↔home 重複読み** | getStampCardStatus（2 セット）、findStatuses（2 回） | repository 層で 1 描画 1 パス化 |

### §3.5.3 auth ドメインの現状（DynamoDB single-table → リレーショナル化の出発点）

認証ドメイン全体（User/Tenant/Membership/Invite/Consent）は現状 **DynamoDB single-table（KV、JOIN 一切無し）**で実装（SSOT: `dynamodb/auth-repo.ts`+`auth-keys.ts`、SQLite 側 auth-repo は throw stub）。観測されたアクセスパターンと DSQL 含意:

- **session lookup は DB 不要**（cookie 署名トークン検証のみ）。DB hit は (a) context cookie 失効時の **3 連 lookup**（findUserByEmail[GSI] → findUserTenants → findTenantById）(b) HTML GET 毎の **consent 2 read**（findLatestConsent ×terms/privacy）(c) **lastActiveAt 1 日 1 回 write**（in-memory guard）。
- **role は membership.role**（tenant 側 MEMBER# と user 側 TENANT# の **両 item に二重書き**）。**subscription/entitlement は別表でなく Tenant item の属性**（status/plan/stripeCustomerId、licenseStatus は算出、license key #2860 全廃）。
- → リレーショナル化で `users / tenants / memberships(user_id,tenant_id,role) / invites(code,tenant_id,role,status,expires_at) / consents(tenant_id,type,version)` の素直な FK JOIN になる（二重書き adjacency 不要化）。**判断⑥**（最小正規化 + consent append-only）の裏取り。
- **失効・期限は app 層判定**（account-lockout の lockedUntil、viewer-token の revokedAt/expiresAt）→ DSQL は**部分 index 不可（spike#2 確証）**のため `WHERE revoked_at IS NULL …` の部分 index は作れない。判定は **app 層述語 + 素の列**（revoked_at/expires_at を PK プレフィクス or btree secondary の残差 filter で絞る）で行う。条件付き一意が要る場合のみ §P4 の STORED 生成列パターンを使う。
- **webhook 冪等性**（stripe_webhook_events、PK=event.id）は **schema 配備済だが repo 実装・結線とも未稼働**（要注意、移管前に実装要否を判断）。

### §3.5.4 tenant 分離の物理化（§P9 への接続）

SQLite 実装は大半の表で `tenantId` を WHERE に使わず（`_tenantId` no-op）、`tenant_id` 列を実際に持つのは約 15 表（§1 と一致: checklist_templates / child_custom_voices / sibling_cheers / push_subscriptions / notification_logs / report_daily_summaries / certificates / cloud_exports / trial_history / viewer_tokens / usage_logs / cancellation_reasons / graduation_consent / stripe_webhook_events 等）。**settings は key/value KVS で tenant_id 列を持たない**。`deleteByTenantId` は WHERE 無し全行 DELETE、横断クエリ（findActiveTrials / deleteExpired[cloud_exports]）も tenantId 無し。→ DSQL マルチテナント化で**全テナント表に複合 tenant PK（先頭 `family_id`）+ 全メソッドに tenant 述語追加が必須**（fitness function で機械強制、§P9 / ADR-0063[open PR #3467]）。

### §3.5.5 子供ホーム read 予算 + DSQL ネイティブ並列（UX パネル B1、PK 凍結前の設計要件）

§3.5.1 の 21+ クエリは **server-side（Lambda→DSQL、Lambda と DSQL は同一リージョン＝intra-region）**で発行される。browser→Lambda の往復は 1 回のみ（21×トランス太平洋ではない）。warm クエリは spike#8 実測で read p50 ~15ms / write ~24ms。UX 許容から逆算した契約を課す（schema 変更なし、repository read-plan のみ、PK/txn 不変）:
- **描画予算**: 子供ホーム p75 first-interaction ≤ 600ms（warm）。
- **⚠️ DSQL ネイティブ並列 = 多接続 fan-out（一次ソース: re:Invent 2025 DAT439 / Marc Brooker）**: DSQL は **1 トランザクション = 1 専有 QP（一度に 1 txn のみ）**。並列性は「多数のコネクション（各々別 QP を得る）から小クエリを並列発行」で得る。**1 接続上の逐次 await は QP を占有して直列化するため禁止**。子供ホームの独立 read 群（H1-H21 の互いに依存しないもの）は **read-only の複数接続 or autocommit small query を並列 fan-out** し、warm 接続プールを再利用する（DSQL 推奨: 小クエリ × 多接続並列）。
- **重複/N+1 の 1 パス畳み込み**: H3⋈H16（findStatuses 2 回）/ H7・H8⋈H15（getStampCardStatus 2 セット）を **1 回に統合**。H4/H5 の category N+1（findBenchmark/findRecentStatusHistory をカテゴリ定数ループ）は statuses/status_history が `(family_id, child_id[, category_id])` PK プレフィクスを持つため **1 プレフィクス scan で 1 クエリ化**（schema 対応済、repository が N 本に割っているだけ）。
- **first-paint**: 2 段 `await parent()` 連鎖 + **初回接続確立 ~1.45s(spike#8: connect 562ms、Firecracker cold でなく接続パス)** に対し、**warm Lambda コンテナで接続再利用**（handler 外で client 生成）+ skeleton/optimistic first-paint を規定（preschool の空白待ち回避、UX R1）。IAM トークン/接続 age の 1h 上限で再接続要（§12.1）。
- total_point 派生列（§5）で H2 の SUM は列 read 1 回化済。

## §4 キー戦略

- **Family ルート**: `families (family_id uuid PRIMARY KEY DEFAULT gen_random_uuid())`。
- **テナント系全表**: `PRIMARY KEY (family_id, <entity_id>)`（family_id 先頭）。entity_id は UUID 既定。
- **自然複合 identity の子表は複合自然 PK 昇格**（surrogate + counter.ts + padId 全廃）。例:
  - `statuses (family_id, child_id, category_id) PK`（旧 surrogate id + unique(child,category)）
  - `activity_mastery (family_id, child_id, activity_id) PK`
  - `login_bonuses (family_id, child_id, login_date) PK`
  - `daily_missions (family_id, child_id, mission_date, activity_id) PK`
  - `stamp_entries (family_id, card_id, slot) PK`
  - `checklist_logs (family_id, child_id, template_id, checked_date) PK`
- **テナント内一意制約**は `UNIQUE(family_id, …)`（グローバル一意は分散で hot 化のため避ける）。
- **グローバル master**は自然キー優先: `categories(code) PK` / `stamp_masters` / `market_benchmarks(age,category_id) PK` / `stripe_webhook_events(event_id) PK`（achievements は §10-10 で drop）。
- **条件付き一意制約 = STORED 生成列 + UNIQUE index で表現**（部分 unique index は DSQL 不可 = spike#2、代替を spike#3 で実機確証・確定。研究判断⑨）。**式 index は不可だが STORED 生成列（物理実列）は unique index key にできる**ことを実機確認済:
  - **owner 1 名強制（確定）**: `owner_guard uuid GENERATED ALWAYS AS (CASE WHEN role='owner' THEN family_id ELSE NULL END) STORED` + `CREATE UNIQUE INDEX ASYNC (owner_guard)`。owner 行のみ family_id 非NULL → family ごと 1 名を**DB 強制**（spike#3: 2人目 owner は `23505`）。非owner は NULL で無制限共存（NULLS DISTINCT 既定）。アプリは `23505` を即エラー返却（40001 retry でない）。フォールバック: 専用 1 行表 `family_owner(family_id PK)`（不要だが代替）。
  - **soft-delete の「未削除行で一意」（確定）**: `active_key GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN natural_key ELSE NULL END) STORED` + `UNIQUE INDEX ASYNC (family_id, active_key)`（**既定 NULLS DISTINCT 必須**）。生存行は natural_key 一意、削除行 NULL は複数世代共存（spike#3 確証）。Pre-PMF で監査/undo 不要な表は **物理削除に寄せて本機構を不要化**（ADR-0010、表ごと判断）。

## §4.1 index 戦略（PK covering 最優先 + 各表 secondary ≤3、研究判断⑬）

DSQL: **PK = index-organized 表本体で全非キー列を自動 INCLUDE covering**（heap 不在）。secondary は btree のみ + ASYNC 強制（INCLUDE 列は scan qualifier 不可）、式・部分・GIN 不可、≤24 本/≤8 列/≤1KiB。secondary 1 本 = 全書込に複合 PK 幅の Write DPU 加算 → **PK プレフィクスを access pattern に合わせ hot path の大半を secondary 0 本で賄い、各表 ≤3 本**。

- **PK covering が想定以上に強力（spike#5 実機確証）**: planner は単一 child 規模で **PK-prefix `(family_id,child_id)` の Index Only Scan + 残差 filter** を既定の access path に選ぶ（recorded_date/type/cancelled は `Filters` で処理）。`al_pkey ... INCLUDE(全非キー列)` で heap fetch 無しを実測。→ **hot path の大半は secondary 0 本**: children / child_activities / activity_mastery / activity_pref / statuses / status_history / stamp_cards / daily_missions / login_bonuses / checklist_logs / daily_battles / consents / settings。
- **secondary は投機的に張らない（spike#5 で方針保守化）**: recorded_date/type 系 secondary（activity_logs `(…,recorded_date,category_id)`、point_ledger `(…,type,recorded_date)`）は **単一 child の履歴が大量化し date/type filter が full-child scan を大幅削減する規模で初めて planner が採用**（小規模では PK-prefix が選ばれ secondary 不使用を実測）。→ **初期は PK のみで開始し、実データ規模の EXPLAIN ANALYZE で必要を確認してから追加**。Write DPU 予算は当初想定よりさらに小。`findUserTenants` 用 memberships `(user_id)` 等、PK プレフィクスで届かない「別軸引き」のみ最初から secondary を張る。
- **式 index 不可の回避（素の列に materialize）**: `recorded_date` は **アプリ set の素の date 列**（生成列にしない。`CAST(created_at AS date)` は immutable でなく GENERATED 不可＝spike#5 `42P17`。`(created_at AT TIME ZONE 'UTC')::date` 等の immutable 変種は可だが、現 activity_logs 同様アプリ set が両 backend で timezone 曖昧さ無く SQLite parity 容易）/ `activity_logs.category_id` を記録時アプリ snapshot / `users.email_lower GENERATED lower(email)`（lower は immutable で OK）/ `statuses.last_decay_date`（`LIKE 'today%'` スキャン撤去）。
- **時刻列は PK に入れない（§P3）**: findPointHistory は PK プレフィクス `(family,child)` の covering scan + `ORDER BY created_at DESC` LIMIT（家庭 ~数百行/child で ~1.5ms、spike#7）。keyset/secondary は大規模化時のみ後付け（可逆）。UUID v4 PK で hot-partition 懸念ゼロ。
- **論理/物理の分離（重要、SQLite parity Finding 3）**: **論理モデル（列・PK・UNIQUE・CHECK・生成列）は両 backend 同一**。だが**物理 index 挙動は別**: DSQL は PK=index-organized で全列 covering（heap fetch 無し、spike#5/#7 実測）/ SQLite は **rowid heap + PK は別 B-tree**（`WITHOUT ROWID` 既定でない）で PK lookup は 2 段。→ **DSQL は secondary を最小化（PK covering）/ SQLite は同 access pattern に必要な secondary を別途許容**（NUC 単一家族規模では誤差、drizzle sqlite schema の既存 secondary はそのまま残す）。「同一論理モデル・物理 index は backend 別チューニング」と切り分ける。
- **spike#7 スケール確証（12,480 行・24 child・520 行/child）**: `point_ledger (family_id,child_id,type,recorded_date)` secondary は must-bonus 冪等 hot path で**採用・2x 高速**（最初から張る）。`activity_logs` の date secondary は getTodayActivityCounts で**不採用**（PK-prefix 520 行 scan+filter で 1.5ms、家庭スケールで不要）→ **初期 PK のみ**（研究判断⑬ の旧「3本固定」は本 §4.1 に統一・撤回、DB アーキ R2）。ただし **getTodayActivityCounts(H10) は毎描画+per-child 線形増のため第一の secondary 追加候補**、`deleteActivityLogsBeforeDate`（retention）が行数増を bound。実データ規模の EXPLAIN ANALYZE で追加判断。
- **残る実機検証**: total_point 派生列の txn 内共更新 contention（per-child 低書込で許容の公算大、判断⑬反証①で退避路あり）を実データ規模で確認（実装後、EPIC spike(a)#3425）。※旧 I-2（created_at-in-PK hot-partition）は §P3 の「時刻列を PK に入れない」で**設計として消滅**（PO 指摘 2026-07-01）。

## §5 正規化（JSON 解体・派生データ）

### JSON 列の解体（P6）
| 旧 JSON 列 | 新リレーショナル |
|---|---|
| `checklist_logs.itemsJson` | `checklist_log_items (family_id, child_id, template_id, checked_date, item_id, checked bool)` |
| `child_challenges.targetConfig/rewardConfig` | 列展開（`metric`/`category_id`(論理FK)/`base_target`/`reward_points`/`reward_message`） |
| `daily_battles.playerStatsJson` | 列展開 or `daily_battle_stats` 子表 |
| `evaluations.scoresJson` | `evaluation_scores (… , category_id, score)` |
| `report_daily_summaries.categoryBreakdown/checklistCompletion` | §7 で read-model 再判定（解体 or 廃止） |
| `children.displayConfig` | **素の列に展開**（PO 判断 2026-06-29: 表示利便性向上で将来サーバ側に扱う可能性が高い → jsonb 不可。spike#2 で式 index も不可のため key を列化が唯一の検索可能形） |
| `certificates.metadata` | 発行後 immutable・不検索 = **`jsonb` 列**で可（spike#2: jsonb ネイティブ動作確証） |
| ~~`achievements.milestoneValues`~~ | **drop 確定**（§10-10、実績システム #322 廃止・データ不在）。新スキーマに作らない |

### 派生列（P7）
- `children.total_point`（残高）: **不変条件 = 全ての `point_ledger` 書込（base / combo / mission / challenge / reward 等、core/optional を問わず）は、その INSERT を行う mini-txn 内で `children.total_point` を同一 txn 共更新する**（F2 整合: §8 で optional は core txn の外＝独立 mini-txn だが、各 optional 点付与も「point_ledger INSERT + total_point 加算」を 1 txn にする）。これにより SUM からの乖離不能。閲覧は列 read 1 回（SUM スキャン廃止 → DPU 削減）。
- `statuses.total_xp/level/peak_xp`: status 更新 txn 内で派生維持。
- `activity_logs.streak_days/streak_bonus`: 記録 txn 内で算出・確定。
- 監査用の再計算は**バッチで突合**（drift 検出 fitness）し、正本は派生列。

## §6 活動モデル = per-child instance 維持（PO 判断 2026-06-29、catalog+override 不採用）

**PO 判断（確定）**: 家族マスタ 1 つを編集して全子供に**自動波及させる要件は無い**。兄弟共通化は**コピー機能**（既存 `copyActivitiesAcrossChildren`）で行い、**コピー先に同名がある場合は上書き**。→ 研究判断⑤の「(a) per-child instance 維持」を PO product 判断で確定。catalog + override 再設計（伝播セマンティクス）は**採用しない**（伝播は本プロダクトでは事故であって機能ではない、と PO 確認）。

- `child_activities`（活動を子供ごとに 1 行所有 = per-child instance）を**維持**（ADR-0055 整合）。
- 解消するのは **旧 `activities` master テーブルの二重実装のみ**（write 全停止済の dead table、§1 背景）。catalog 層は新設しない。
- 兄弟共通化 = copy（src child → dst child へ行コピー、重複は上書き）。DPU の「コピー vs override」差は DSQL の txn floor（1024B）に吸収されほぼ消える（研究判断⑤の計測根拠、ADR-0010「コスト動機の幻」）。
- マイグレーション: 既存 `child_activities` をそのまま per-child instance として移送（差分抽出ルール不要 = §10-1 解消）。
- **移行トリガ（将来）**: 「マスタ編集の全子伝播」需要 or marketplace 大規模化が観測されたら catalog+override を再検討（ADR-0055 に移行条件を注記）。現時点は可逆な per-child instance が期待損失最小。
- **marketplace 帰属記録（営業 R1）**: 取込は per-child コピー上書きで source item への永続リンクを破棄（自然キー再解決のみ）。有料テンプレ販売・作者還元は後付け表で可能だが、転換/継続の帰属分析が後から再構築不能 → 取込時に **`source_marketplace_item_id` を軽量イベント記録**（今は安く、後は高い）。将来の課金テンプレ収益モデルの裏付けに。
- **NUC 訴求スコープ（営業 R3 / ADR-0013）**: NUC=SQLite ローカルは越境ゼロ・データ家庭内（顔写真ローカル FS、§9.4）で「米国クラウドに送らない」訴求は実装裏付けあり。ただし NUC auth-repo は throw stub（家族マルチユーザー認証未実装、§10-11）＝「クラウドと**対等機能**」の無条件訴求は ADR-0013 違反。訴求は**実装済スコープ（越境ゼロ・データ家庭内）に限定**し、家族マルチアカウント対等は実装確認後まで販促に書かない。

## §6.6 auth ドメイン確定 DDL（greenfield、研究判断⑭）

現 DynamoDB single-table（JOIN 無し・role 二重書き）を **5 表 + subscription=families 属性**にリレーショナル化。RBAC 専用表・汎用監査基盤・session 表は作らない（ADR-0010、cookie 署名で session DB 不要）。全 access pattern（auth-repo.interface 26 メソッド）を PK covering + 各表 secondary ≤3 で充足。

| 表 | PK | 主な制約 / index | 備考 |
|---|---|---|---|
| `users`(global) | `(user_id uuid)` | UNIQUE `email_lower GENERATED lower(email)`、provider CHECK | findUserByEmail HOT、case-insensitive 重複防止。email lookup item 廃止 |
| `families`(=tenant+subscription) | `(family_id)` | UNIQUE `(stripe_customer_id)`、status CHECK。**plan は `plans` lookup 表参照**（CHECK でない） | stripe 2hop→1hop。owner_user_id は cache（SSOT=memberships）。licenseStatus は算出（列なし）。**plan lookup 化（営業パネル 2026-07-01）**: plan は収益レバー=増減集合（研究判断④「増減集合=lookup」整合）。CHECK 固定だと DSQL の ALTER 後付け不可（§10-5）で新プラン投入のたび families 表再構築＝価格/ティア実験が schema migration 待ちになるため。status は Stripe 固定 enum ゆえ CHECK 据置 |
| `memberships` | `(family_id, user_id)` | secondary `(user_id)`、**`owner_guard GENERATED CASE WHEN role='owner' THEN family_id ELSE NULL END`+UNIQUE**、role CHECK(owner/parent/child) | owner 1名 DB 強制（spike#3/SQLite parity）。role 二重書き廃止＝1 行 SSOT |
| `invites` | `(invite_id uuid)` | secondary `(family_id)`、UNIQUE `(token_hash)`、status/role CHECK | adjacency item 廃止。**`token_hash`（招待コードの timing-safe ハッシュ、raw 非保存）必須＝現行 `inviteCode` capability 機構の写像、bare bearer 化による機密性退行を防ぐ（CWE-522）** |
| `consents`(**append-only**) | `(consent_id)` | secondary `(family_id, type, consented_at)`、type CHECK | 最新=consented_at 降順（version 文字列順非依存）。UPDATE/DELETE は GRANT 除外+repo 非定義+fitness 多層禁止。GDPR Art.7/COPPA |

- **方言差**: pg `uuid/timestamptz/gen_random_uuid()/jsonb` ↔ sqlite `text/$defaultFn(randomUUID)/strftime/text`。生成列・CHECK・UNIQUE は両対応。drizzle `text(enum)` は CHECK 非生成（既知落とし穴）→ `check()` 明示必須。CHECK 値（status 等の固定集合）は subscription-status.ts 等から生成（手書き二重化禁止）。plan は `plans` lookup 表（増減集合、CHECK でない）。
- **二重書き廃止の単純化**: createMembership/deleteMembership/invite CRUD が現 2 item Put/Delete → 1 行/1 文。片方成功の role 不整合が構造的に消滅。
- **invite 受諾 = 単一 txn**: `UPDATE invites SET status='accepted' WHERE invite_id AND status='pending' AND expires_at>now() RETURNING` + membership INSERT。**rowCount=0=業務失敗（retry 禁止）/ `40001`=競合（retry）/ `23505`=ALREADY_IN_TENANT** を厳密分岐。
- **owner_guard は memberships に乗る**（role は user×family 関係属性）。`families.owner_user_id` は denormalized cache、`updateTenantOwner` は同一 txn で families 更新+旧 owner 降格+新 owner 昇格（owner_guard UNIQUE が二重 owner 物理拒否）。
- **⚠️ セキュリティ不変条件（必須）**: `owner_guard` UNIQUE は「owner ≤1」を DB で守るが「**誰が role を書けるか**」は守らない。**membership role 変更・owner 移譲・member 削除は `requireRole(['owner'])` 必須**（owner 専用 route guard。現状 owner 機能が `/admin`=owner+parent 配下に同居し parent が到達しうるため、移管で水平/垂直権限昇格を作り込まない）。invite 受諾時は `accepting_user.email == invite.email` 束縛も検証。
- **spike#6 確証**: inline UNIQUE on 生成列（owner_guard）/ `lower(email)` STORED+UNIQUE / `UNIQUE(stripe_customer_id)` 複数 NULL は全て単一 CREATE TABLE で動作（F6/F7/F8、greenfield 空表）。populated 表への後付け UNIQUE は dedup 先行必須（F1、§12.1 cutover）。
- `child_id`(invites) は children 再設計（greenfield UUID）に依存。`listAllTenants`(ops/cron, cold) は created_at cursor ページング（OFFSET 不使用）。

## §7 read-model（report_daily_summaries）

Dynamo は GSI 回避で持たざるを得なかった read-model。DSQL では **compute-on-read + index を既定**（`activity_logs`/`checklist_logs`/`statuses` から集計）。実 DPU を計測し、ホーム/レポートで恒常的に重ければマテビュー化（更新は集計元 txn 内 or バッチ、乖離しない形）。**まず廃止して実クエリ化を試す**。

## §8 recordActivity の原子化（最大の質的改善、grounded + spike#4 実機確証）

現行は 5+ 表を **txn 無し・逐次 await・例外握り潰し**（`activity-log-service.ts:340/356/372/395/422`）で書き、部分コミット（point 入ったが status 未更新等）が起きる。DynamoDB 本番も非原子。DSQL 移管で初めて原子性を入れる。

**worst-case 書込量（実コード計測）**: base 必須 5 行（activity_log/mastery/point_ledger/statuses/status_history、ループ無し）+ 条件付き worst 17+2C+S（C=active challenge 数、S=stale push）≈ **現実 25-50 行**。DSQL 1 txn 上限（3,000 行/10MiB/300s）に 2 桁余裕（適合確定）。

**⚠️ spike#4 実機確証で設計が決定**: DSQL は **SAVEPOINT 非対応**（`0A000`）、かつ txn 内 1 文エラーで後続全 `25P02`（aborted）。→ 「全部入り 1 txn で optional 失敗を局所巻戻し」は**不可能**。現状の try/catch 続行も単一 txn では破綻。よって:

```
# core = 単一 txn（必ず整合させる 5 行）
runInTransaction(repos => {            # withOccRetry でラップ（DSQL 40001 retry / SQLite no-op）
  insert activity_log
  upsert activity_mastery
  insert point_ledger(base) + update children.total_point(派生列)
  upsert statuses + insert status_history
})                                     # all-or-nothing → retry 安全（exactly-once）
# optional = core commit 後の独立 best-effort（失敗隔離 + ログ。各 additive かつ冪等）
combo / mission / challenge進捗 / certificate(onConflictDoNothing) / special_reward / 通知
```

- **txn 抽象**: drizzle の `transaction()` ヘルパは方言非互換（sqlite=同期 callback 必須[Promise 返すと throw] / pg=非同期、drizzle #2275 / better-sqlite3 #1262）→ `storage.runInTransaction(work)` ポート（Unit of Work）。**work は「event loop を yield する await を含まない同期契約」**（better-sqlite3 は同期ドライバ＝単一接続、core txn 中に await yield があると並行 HTTP リクエストの書込が同 txn に混入する。SQLite parity Finding 1）。core txn 内で **fetch / 通知 / 画像処理 / dynamic import 禁止**（fitness/lint で CI fail 化）。
- **tx ハンドルは必須引数**（`ctx.tx`、現 module-level `db` 直結フォールバックを**型で禁止**）。tx 忘れは **SQLite では単一接続で隠蔽・pg では別接続で部分コミット**＝E2E 緑で本番崩壊の非対称（SQLite parity Finding 2）→ pg テスト DB で「core 1 操作を tx 外に逃がすと部分コミット再現」を failing-test-first で証跡化。
- backend dispatch: pg=`db.transaction(async)` + `withOccRetry`（40001）/ SQLite=`BEGIN IMMEDIATE`…`COMMIT` + `withOccRetry` は no-op（IMMEDIATE が writer 直列化、busy_timeout 吸収）。**同プリミティブを bulk import（chunk+saga、§9.1 / #3436）が再利用**（saga は import 専用、recordActivity に持ち込まない）。
- **冪等性の正は「txn 内 re-read」**（40001 retry は DSQL の活性化手段に過ぎない、SQLite parity Finding 5）: point_ledger は unique 無し（schema.ts:177-191）だが core 単一 txn の all-or-nothing + 共有 `statuses`/`activity_mastery` 行 upsert が serialization point（DSQL: 並行は 40001→retry / SQLite: IMMEDIATE 直列化）→ いずれも txn 内で `countTodayActiveRecords` を re-read し既存なら `ALREADY_RECORDED`。**txn 境界を HTTP に晒さない**（HTTP 再送は二重付与）。
- **⚠️ OCC 40001 の正確な挙動（一次ソース: AWS Concurrency control blog / spike#4/#6/#8 実測、"queue で競合回避" は誤り）**: DSQL は snapshot isolation・ロック無しで実行し **commit 時に adjudicator が write-write を楽観検出→`40001`(OC000)**。**同一行の write-write が commit ウィンドウで重なった時のみ**（spike#8: 同一行 M=8 で 6 件 40001 / 異なる行 M=8 で 0 件＝**異なる行は競合ゼロ**）。read-write は非検出（write skew は防げず、read 値を条件に別行を書く不変条件は `SELECT ... FOR UPDATE` で write-intent 化して守る）。**行更新は二次インデックスのエントリも書く**ため、ホットな二次インデックスを共有する別行更新も競合し得る（§4.1 の secondary 最小化はこの面でも有利）。
- **家庭スケール評価 + hot-row 注意**: serialization point は「その子の該当行」＝per-child で、親子同時記録/二連打がミリ秒で偶然重なった時のみ 40001＝**稀、retry ラッパで十分**。ただし **`children.total_point` を「毎回 total 再計算 1 行 UPDATE」すると同一子への並行記録で per-child hot-row 化**しやすい（AWS: 単一集約行の高競合を避け random PK/分散を推奨）。Pre-PMF は retry で足りるが、将来 delta を ledger に append し total を集計/遅延反映すれば競合面積を下げられる（最適化余地）。**単一グローバルカウンタ行（テナント全体集計を 1 行）は作らない**。
- optional を core に含めない理由 = SAVEPOINT 不可（spike#4）で「optional 失敗が core を 25P02 で巻き込む」ため。optional は additive（point 追加 / challenge 進捗 / 証書発行）で core の整合に不要、独立失敗を許容できる。**⚠️ optional 欠落許容は product 判断**（combo/mission/challenge を core commit 後 best-effort・retry なし＝現状と同等の regression なし、だが §10-8 で PO 明示確認）。
- **⚠️ 演出契約（UX B2 / PO R1、確定）**: 子供向け祝福/加算演出は**確定した `point_ledger`/`children.total_point` からのみ描画**し、未確定 optional の推定値を optimistic 先出ししない（先出し→optional silent fail で「次描画の残高が演出より少ない＝取れたはずのボーナスが無い」不整合が子供に可視化され UX 不信を生む）。**可視 optional（mission 完了フラグ / challenge 進捗）は stored 書込依存でなく compute-on-read で再導出**（「やったのにバーが動かない」を防ぐ）。**invisible bonus（combo 等）のみ best-effort 隔離 + 観測カウンタ（fitness#11）**で欠落率を可観測化。reconcile job は後付け。login bonus は非エスカレーション（連続損失プレッシャーなし）維持（ADR-0012、PO R3）。
- **optional の point 付与も `total_point` 共更新（§P7/§5 不変条件）**: combo/mission/challenge の point_ledger INSERT は core txn 外の独立 mini-txn だが、各 mini-txn 内で **point_ledger INSERT + `children.total_point` 加算を 1 txn**にする（total_point=SUM 乖離不能を core/optional 問わず維持）。

### §8.1 cron バッチ書込（全テナント横断）の原則（N2、recordActivity と同格）

`schedule-registry.ts` の全テナント横断バッチ（age 系再計算 / retention-cleanup / grace-period-deletion / trial-notifications / analytics-aggregate）は recordActivity（単一集約）と**別クラスの write path**で、§P8（1 write txn=3,000 行/10MiB）・Write DPU・OCC・cross-tenant txn 禁止に直撃する。**原則**:
- **per-tenant ループ + chunk ≤3,000 行/txn + `withOccRetry`**（cross-tenant を 1 txn に混ぜない＝集約境界 = family を跨がない）。`listAllTenants` は created_at cursor ページング（§6.6）。
- **全行スキャン課金に注意**: 全テナント read は Read DPU バイト課金。フィルタ（`endDate>=today` 等）を素の列 index/PK プレフィクスで効かせる。
- **age 系バッチは §11.1 の age compute-on-read 化で撤去可能**（N4。age を stored 派生にせず birth_date 算出にすれば日次 age-recalc 自体が不要）。

## §9 NUC(SQLite) 両立・マイグレーション

- 同一論理モデルを drizzle で sqlite-core / pg-core 2 方言定義（型差分は §P3/P6 に従い両立）。tenant_id は SQLite でも保持（単一家族は定数 `default`）。FK は両方張らない。
- **NUC cutover はデータ保全マイグレーション**（#3438）: backup → backup-archive 論理エクスポート → 新スキーマ DB 構築 → 変換 import → コピー検証 → 切替（旧 DB 保持）。**`drizzle-kit push` 禁止**。
- 旧 surrogate integer id → UUID 変換は論理エクスポート時に id マッピング表を作り、参照（旧 FK）を新 UUID へ張り替える。

### §9.1 一括 import の原子化（バックアップチーム申し送り #3326⇄#3436 統合、2026-06-29）

別チーム（backup export/import）との交点。**申し送り SSOT** = `docs/research/2026-06-29-backup-import-handover-to-dsql-team.md`（backup チーム作業ツリー `Documents/ganbari-quest` branch `fix/3326` に存在、#3326/#3329 merge で develop に入る。merge まで本書がローカルキャッシュ）。**replace import / 家族全置換を単一 txn で all-or-nothing にすることは DSQL でも不可**（§P8: 1 write txn = 3,000 行/10MiB/5分、spike#1 実機 `3,001 行→[54000]`）。よって:

- **import-then-swap（staging→pointer swap）or saga（"import 中"フラグ→全 chunk 成功で commit）** に統合する。#3326（import 原子化）と #3436（DSQL chunk+saga）は**同一問題=1 設計にマージ**（二重実装回避）。
- **チャンク = 3,000 行未満の真の all-or-nothing**（DynamoDB の 100 item 上限より緩い追い風）。現状の 54 個 per-row `await insert`（N+1）は DPU/OCC/行上限すべてで不可 → §8 と同じ batch 機構に乗せる。OCC 40001 retry ラッパ（#3435）必須。
- **clearAllFamilyData の原子化機構は data-service 層に置く**（呼出元 `/api/v1/data/clear` `/admin/settings/data` `/api/v1/import/cloud` 全経路に効く）。

### §9.2 DSQL repo がバックアップ契約を維持（落とすと round-trip テストが落ちる）

- 各 repo に **`findAllByChild` + `insertForRestore`** を維持（`insertForRestore` = id 新規採番・**作成日時/状態/全フィールドは書き戻し保全**、通常 insert と別契約）。SSOT = `backup-entity-registry.ts`（schema 全表を source/derived/excluded 分類、`tests/unit/db/backup-entity-registry.test.ts` が「schema ⊆ registry」を機械検証）。
- **import 時の cross-reference 再解決は自然キー（title/name/PK）依存**（childRef→childId、rewardRef=title 等）。→ §4 の自然複合 PK 戦略と整合（surrogate id 廃止で自然キー再解決がより堅牢に）。
- **セキュリティ不変条件（緩めない）**: settings export は default-deny allowlist（`pin_hash`/`session_token`/lockout を export/import 双方で除外、CWE-522/916、service 層なので backend 移管で自動継承）。import は必ず `WHERE family_id=:ctx` 単一強制点を通す（§P9 / ADR-0063、生クエリ直書き禁止）。
- **⚠️ auth ドメインを backup 対象外に分類（critical）**: 新設の `users`/`memberships`/`invites`/`consents`/`families`(subscription 属性) は **backup-entity-registry で `excluded`**（PII/資格情報/法的証跡を家族エクスポートに含めない）。auth は DynamoDB→DSQL 移管時に新規分類が強制されるため、registry の no-silent-gap test が拾うよう明示登録する。
- **consent の消去と append-only の両立（GDPR Art.17/COPPA、Finding 3）**: `consents` は通常運用で UPDATE/DELETE 禁止（append-only）だが、**アカウント削除時のみ erasure 専用特権パス**で物理消去（consent は ip/UA の PII を保持）。append-only 制約（GRANT 除外）と erasure を両立させるため、削除は専用 role / 専用 migration 経路で実行し fitness function の例外として明記する。

#### §9.2.1 DSQL 新モデルが round-trip に与えるリスク（検証済、研究判断⑫）

現行 backup import は **id 非保全・自然キー再解決の純論理 import**（restore に explicit id 0 件、cross-ref は title/activityName/templateExportId）。**id 非依存設計が追い風**で UUID PK 化・複合自然 PK 化・生成列は round-trip をほぼ壊さない。**実際に直す箇所は 2 つ + 罠 3 つ**:

- **R2（高）UUID childId × 静的ファイル path 正規表現**: `import-service.ts:902 STATIC_FILE_PATH_RE=/(avatars|voices|generated)\/(\d+)\//` と `:1045` avatarUrl 抽出が数値 childId 固定（`sourceChildId:number`）。UUID 化でアバター/音声 round-trip が**静かに全 skip**。→ `\d+`→`[^/]+`、`sourceChildId:string`、childIdMap を `Map<string,string>` 化。DB でなくファイル層の局所修正。failing-test-first。
- **R5（高）replace 原子性**: DSQL は clear+import 単一 txn 不可（§9.1）→ `replaceImportAtomic` に DSQL strategy（import-then-swap/staging+pointer、errors>0→swap 中止 semantics 維持）を 1 本追加（§8 の `runInTransaction` プリミティブ共有）。chunk 境界の部分失敗→旧データ保全テストが現状無い→追加必須。
- **R1（低）生成列 × insertForRestore**: restore は実列のみ列挙 + drizzle が生成列を INSERT 自動除外 → 大半無改修。「既存書込列を生成列に昇格」時のみ要注意（owner_guard/active_key の導出元列は書けて生成列は書かない）。
- **罠**: jsonb 化は verbatim 文字列 test を壊す → opaque blob（scoresJson/targetConfig/itemsJson/metadata）は **pg でも text 据置**（§5 と整合、jsonb クエリ要件なし）。`_tenantId` no-op シグネチャを pg にコピーしない（pg は必ず tenant_id を書く）。
- **Pre-PMF 検証**: 既存 `backup-roundtrip-completeness.test.ts` を backend パラメタ化し pg で 1 回 + chunk 部分失敗テスト 1 本。per-entity の pg test 乱造しない。

### §9.3 FK 質問への回答（spike#1 実機確証）

バックアップチームの「DSQL が FK を本物の DB 制約で張れるなら `ON DELETE CASCADE` で clear 順序の手動管理を不要化できるか」への回答 = **No。DSQL は FK 非対応（spike#1 実機確証）**。→ `tenant-cleanup-service` の **clear 順序手動管理は DSQL でも残す必要がある**（cascade 宣言で簡約は不可）。整合は §P4 の通り DDD 集約 + repository + 削除順序のアプリ層管理で担保。**さらに spike#6/F9 で「`SELECT FOR UPDATE` による親キー検証は OCC 下で orphan を防げない」と判明**（判断⑥ 訂正）。**適用範囲（重要）**:
- **集約内（1 txn=1 集約、§3）の親子は orphan が起きない**（deleteChild は子サブツリーを atomic 削除）。F9 対策が要るのは **cross-aggregate 参照のみ** = family↔child（child は別集約 root）・family root への親参照等。全関係に一律適用しない。
- cross-aggregate では **親を soft-delete（物理削除しない）を主**とする。子 INSERT 同一 txn での**親行 touch(UPDATE)** 方式を採る場合は **`rowCount=1` guard 必須**（親が完全先行 commit 済だと touch が 0 行マッチ＝OCC 衝突せず orphan が残るため、touch 0 行なら子 INSERT を中止）。※touch 方式の orphan 防止実効は spike 未確証 → soft-delete 主・touch は補助。
- **GDPR/COPPA との reconcile**: routine 削除 = soft-delete / **account 削除 = 物理 cascade（§9.4 物理消去、tenant-cleanup の順序管理）**。soft-delete で残した行は account 削除時に物理消去する 2 段階。
- 補足: §5 の total_point 同一 txn 共更新で children 行を毎 recordActivity 書込するため、children→logs は touch 保護を副次獲得（contention 増は per-child 低書込で許容）。

### §9.4 メディアストレージのテナント分離・アクセス制御（既存実装の言語化、研究判断⑩）

子供の顔写真等の**要保護データ**を扱うため、画像バイトは DB に入れず（DSQL は DPU バイト課金 × PK=表構造で不可）、**テナント分離 + アクセス制御付きストレージ**に置く。**この設計はプロダクトに既に実装済**で、DSQL 移管で壊さず維持する:

- **抽象**: `IStorageRepo`（saveFile/readFile/deleteByPrefix 等）。本番=**private S3**（`ASSETS_BUCKET`、Block Public Access、バイトは Lambda が IAM で読み Response 返却）/ NUC=ローカル FS（zip-slip 多層防御）。**prod/NUC 対等差し替え済**。DB は key+メタのみ（`character_images` / `children.avatar_url`=`/tenants/<tenantId>/...` 相対パス）。
- **配信 = 方式 c（認証済アプリエンドポイント経由）**。`/tenants/[...path]` は path 先頭 ==`context.tenantId` 不一致/未認証で 404。レガシー `/uploads/avatars/[filename]` は #3139 の **ownership anchor**（child.avatarUrl と要求 URL 一致時のみ配信、fail-closed 404 + deny 理由ログ）。**リクエスト毎 authz** が S3 presigned / CloudFront signed（URL=bearer token）より IDOR 耐性・即時失効で優位（OWASP IDOR 原則）。S3 public / CloudFront signed / KMS 階層 / MinIO は **Pre-PMF 不採用**（ADR-0010）。
- **アップロード無害化**: MIME allowlist + magic byte 検証 + sharp 再エンコード（polyglot 除去）+ サイズ上限。
- **削除（GDPR Art.17 / COPPA 16CFR312.10）**: アカウント削除で `deleteByPrefix(tenants/<tenantId>/)` 物理削除。reward snapshot 画像は dedup せず per-tenant 独立コピー（一括削除安全側）。
- **data residency（法務パネル 2026-07-01、region 中立に訂正）**: 現保存先 = 本番スタックと同一の **us-east-1**（米国）。**APPI**: クラウド例外（AWS が保存データを取扱わない DPA + アクセス制御、PPC FAQ 1-7-53）成立で 28条同意は不要だが、外国保存ゆえ「外的環境の把握」= **プライバシーポリシー等に「米国保存 + 講じた措置」を開示 + 米国制度の把握 + DPA 依拠の証跡記録**が運用義務として残る（PPC FAQ 5-16-4）。→ この開示・記録責務をポリシー/運用に配線する（§10 flag）。**将来スタック全体を ap-northeast-1 に移せばこの開示義務自体を回避可**（DSQL 東京提供済、ただしスタック全体移設のインフラ判断）。市場は **日本限定**前提（COPPA は対象=米国 13 歳未満・サーバ所在地で非発火＝適用外、US 在住家族提供時は再付着ゆえ scoping 明記）。consent の ip/UA はデータ最小化で必要性再評価（証跡は timestamp+version+user_id で足りる）。
- **intra-tenant 信頼境界（明文化）**: cross-tenant は厳格 404 分離、**同一家族内は全 child アバター共有可**（顔写真は家族内共有前提で妥当）。
- **scale-up 予約**: 配信が将来重くなれば `issueAccessUrl(tenantId,key)` を provider に押し下げ CloudFront signed cookie+OAC へ移行余地（今は YAGNI）。
- ⚠️ **テナント分離 SSOT の所在**: 現状 `docs/design/14-セキュリティ設計書.md §5.2/§5.2.1`（hooks.server.ts→authorization.ts 三軸 + ハンドラ層 tenant 一致）。ADR-0063（DSQL pool テナント分離）は **open PR #3467 で起票済・develop 未 merge**。本ストレージ方針も ADR-0063 or セキュリティ設計書に紐づける。

## §10 未決事項（PO レビューで確定）

> spike#2（2026-06-29 実機確証）で技術前提が固まり、5・一意制約まわりは設計確定。残る未決は主に PO の product 判断。

1. ~~catalog+override の差分抽出ルール~~ → **確定（§6、PO 判断 2026-06-29）**: per-child instance 維持 + コピー上書き、catalog+override 不採用。差分抽出ルール不要。
2. **report_daily_summaries**（§7）— **確定方向**: §3.5.2 で現状すでに書込未配線=実質 compute-on-read と実証 → 原則廃止して compute-on-read 化。許容レイテンシは移管後の実 DPU で最終確認。
3. **reward icon の将来形 + 画像保存方式**（研究判断①⑧⑩）— **確定（既存実装 grounded + PO 合意）**: 画像は **DB（DSQL/SQLite）には key+メタのみ、バイトは `IStorageRepo` 抽象**（本番=**private S3** / NUC=ローカル FS、対等差し替え＝**既に実装済**）。base64-in-DSQL は不採用（DPU バイト課金 × PK=表構造、研究判断⑧）。reward snapshot 画像化時は **storage key（immutable 参照）を記録**、dedup せず per-tenant 独立コピー（GDPR 一括削除安全側）。配信は**既存の方式 c（認証済アプリエンドポイント経由ストリーミング、private bytestore）を維持**＝研究判断⑩。S3 public / CloudFront signed / MinIO は Pre-PMF 不採用（ADR-0010、`issueAccessUrl` 押し下げ口のみ確保し scale-up gate で再検討）。詳細・アクセス制御/IDOR/COPPA 整合は **§9.4** + 研究判断⑩。
4. ~~可変構成 JSON（displayConfig）~~ → **確定（§5、PO 判断 2026-06-29）**: 表示利便性向上で将来サーバ側に扱う → displayConfig は**素の列に展開**。
5. **enum/CHECK 制約** — **確定**（spike#2: pg enum 不可・inline CHECK 動作+強制・ALTER 後付け不可）。不変集合=作成時 CHECK、増減集合=lookup テーブル（研究判断④）。
6. **auth ドメイン** — **確定**（研究判断⑥: 最小正規化 + consent append-only）。owner 1 名強制 = STORED 生成列 + UNIQUE index（spike#3 実機確証、§4）。RBAC 専用表は不採用。
7. **soft-delete 一意制約**（§P4）— **確定**（研究判断⑨ + spike#3）: STORED 生成列 `active_key` + `UNIQUE(family_id, active_key)`（NULLS DISTINCT 既定）。監査/undo 不要な表は物理削除に寄せる（表ごと判断）。
8. **§8 optional 欠落許容（要 PO 確認）**: combo/mission/challenge/certificate/special_reward は core commit 後の独立 best-effort（失敗時 retry なし＝当該ボーナスが付かない可能性、現状の握り潰しと同等で regression なし）。「ボーナス取りこぼしを許容し reconcile job は後付け」で良いか PO 確認。
9. **stripe_webhook_events**: PK=`(event_id)` は Stripe event 一意で将来変更不要＝§P1 リスクゼロ＝schema から落とさない（PO R2）。**実装は課金稼働前の MUST（営業 B1）**: Stripe webhook は at-least-once ゆえ冪等ハンドリング（処理済 event_id は no-op）が無いと二重課金/イベント取りこぼし（支払済未プロビジョン=顧客離脱、解約後アクセス残存=収益漏れ）。本データモデル凍結とは decouple し**別 billing Issue で必須実装**（fitness に webhook 冪等統合テスト追加）。
10. ~~achievements / child_achievements の drop 判断~~ → **drop 確定（2026-07-01、grounded）**: backup-entity-registry で `achievement`/`childAchievement` とも `excluded permanent`（実績システム廃止 #322・データ不在）。title システムも #322 廃止。→ **§3 集約マップ・§5 milestoneValues 解体・§11.2 から除外**（legacy activities と同様に新スキーマに作らない）。
11. **NUC マルチユーザー時の auth**: 現状 SQLite auth-repo は throw stub（local モードは認証未使用）。NUC で家族複数ユーザー認証を実利用するなら §6.6 DDL ベースで stub を実装（現状は DSQL 一次ターゲット）。
12. **region / data residency（インフラ判断、データモデル非依存）**: 本番スタック（Lambda 等）は us-east-1。データモデルは region 中立で、DSQL は本番スタックと同一リージョンに置く（Lambda→DSQL を intra-region に保つ）。**us-east-1 維持なら APPI 外的環境把握の開示・記録責務をポリシー/運用に配線**（§9.4）。将来スタック全体を ap-northeast-1 へ移せば開示義務自体を回避可（DSQL 東京提供済）だが、これは Lambda/Cognito/CloudFront 含むスタック全体移設のインフラ判断で本書 scope 外。DSQL だけ東京に置くと Lambda→DSQL が cross-region 化＝レイテンシ悪化のため不可。

---

## §11 確定 DDL（実装着手の SSOT、P1 凍結対象）

> **凍結原則**: DSQL は PK 後変更不可（§P1）。本節の PK を**凍結対象**とし、実装前にレビュー確定する。型は pg-core（DSQL）/ sqlite-core（NUC）2 方言で同一論理。`uuid↔text` / `timestamptz↔text(ISO,{mode:'string'})` / `date↔text('YYYY-MM-DD',{mode:'string'})` / `boolean↔integer` / `jsonb↔text({mode:'json'})` / `gen_random_uuid()↔$defaultFn(randomUUID)`。**全 temporal/uuid は `{mode:'string'}` 固定**（pg が `Date` を返すと SQLite[string] と型 drift + backup verbatim 破壊、SQLite parity Finding 6）。

### §11.1 `children`（linchpin — child_id は ~20 表の複合 PK 先頭、最優先凍結）

```
children (
  family_id    uuid NOT NULL,                      -- テナント識別子（旧 tenant_id）
  child_id     uuid NOT NULL DEFAULT gen_random_uuid(),  -- 旧 integer id → UUID
  nickname     text NOT NULL,
  -- age は列で持たない（compute-on-read）: birth_date と wall-clock の関数で書込 txn では維持不能（誕生日で日次 drift、§P7 と非両立）。
  -- → birth_date から算出。これにより日次 age-recalc cron を撤去（N4 / §8.1）。
  -- ⚠️ PO B2: birth_date NULL 旧データは **移行時に backfill を必須**（不能なら cutover 動線で親への入力プロンプトを組込）。NULL 放置は age 表示 + ui_mode 導出の 2 系統の顧客影響を生むため「出し分け」で逃げない。
  birth_date   text,                                -- 'YYYY-MM-DD'
  theme        text NOT NULL DEFAULT 'pink'  CHECK (theme IN (<THEME 値 SSOT>)),
  ui_mode      text NOT NULL DEFAULT 'preschool' CHECK (ui_mode IN ('baby','preschool','elementary','junior','senior')),
  -- ⚠️ PO B2: ui_mode_manually_set=false の時は birth_date age から read 時に tier 導出して適用（stored 列は手動 override 時のみ正）。
  -- これで age-recalc cron 撤去(N4/§8.1)と誕生日跨ぎの tier 自動遷移(6歳→elementary 等)を両立。stored 列のまま cron を消すと非手動児が年齢不適合 UI に据置＝silent UX regression になる。
  ui_mode_manually_set boolean NOT NULL DEFAULT false,
  avatar_url   text,                                -- /tenants/<family_id>/avatars/<child_id>/... 相対パス（§9.4、バイトは IStorageRepo）
  display_config_* (素の列に展開)                   -- §5: displayConfig を個別キー列に（PO 判断 4）。キー集合は実装時に確定し列化
  user_id      uuid,                                -- 招待 child の cognito user（nullable）
  birthday_bonus_multiplier real NOT NULL DEFAULT 1.0,
  last_birthday_bonus_year  int,
  is_archived  boolean NOT NULL DEFAULT false,
  archived_reason text CHECK (archived_reason IS NULL OR archived_reason IN (<ARCHIVED_REASONS SSOT>)),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, child_id)
)
-- secondary: 招待 child ロール解決 findChildByUserId 用に (family_id, user_id) を必要時（warm、初期不要なら省略）
```

- **`_sv`（楽観版数）廃止**: DSQL は OCC が版管理を担う（§8）。NUC SQLite も runInTransaction で整合。`_sv` writeback の二重 SSOT を解消。
- **CHECK 値は SSOT から生成**: theme / ui_mode / archived_reason の許可値は `age-tier.ts` / `archive-types.ts` から machine-generate（手書き二重化禁止、drizzle `text(enum)` は CHECK 非生成）。
- **avatar_url remap**: import 時の `\d+` childId 正規表現を UUID 対応に（§9.2.1 R2）。

### §11.2 全テナント表 PK 凍結表（§P1、自然複合 PK 昇格 vs UUID）

> 下表で全テナント表の PK を確定する。「自然複合 PK」= surrogate id + counter.ts + padId 全廃。auth 5 表は §6.6。**テナント表の PK 先頭は `family_id`**（グローバル master・auth の users/invites/consents は自然キー/UUID 単独 PK で例外）。per-column 完全 DDL は §11.3（別途生成）。
> **⚠️ 自然複合 PK 凍結の governing rule（戦略/PO パネル 2026-07-01、監査可能な線引き）**: 自然複合 PK の凍結（§P1 不可逆）は、once-per-period 一意が **(a) policy invariant（ADR 参照必須、例 ADR-0012 anti-engagement）** または **(b) 構造的確実性（他 cardinality が product 上存在しないことの明示）** のいずれかに anchor される表のみ許す。**「現状そうなっている（mutable product default）」だけを根拠とする表は UUID PK + droppable UNIQUE** に落とす（UNIQUE でも 2 件目拒否の enforcement は同一に効く／失う可逆性は不変条件が反転した時にしか要らない）。判定結果: daily_battles/login_bonuses/rest_days = anchor (a) ADR-0012 ✅ 凍結 / stamp_cards = anchor (b) シーズン撤去前提 ✅ 凍結（**条件: シーズン/イベントカード復活が roadmap に無い確認**）/ **certificates = anchor 無し ❌ → UUID surrogate 化（上表反映済）**。
>
> **自然複合 PK 昇格の一意性根拠（全昇格表で確認済 2026-07-01）**: 下表の昇格表 11 件（statuses `unique(child,category)` / activity_mastery `unique(child,activity)` / daily_missions `unique(child,mission_date,activity)` / login_bonuses `unique(child,login_date)` / stamp_cards `unique(child,week_start)` / checklist_logs `unique(...daily)` / certificates `unique(child,type)` / daily_battles `unique(child,date)` / rest_days `unique(child,date)` / enemy_collection `unique(child,enemy)` / checklist_template_assignments `unique(template,child)`）は、**現 schema に対応する UNIQUE index が全て既存**＝提案 PK と一致し恒久一意が裏付け済（grep 実測）。governing rule 適用後の判定: daily_battles/login_bonuses/rest_days は ADR-0012 policy invariant（1日/1期間1回 = anti-engagement の直接帰結、PO 決裁済）で凍結維持。**残る product 確認は stamp_cards のみ**（シーズン/イベントカード復活が roadmap に無いこと）。certificates は governing rule で surrogate 化済。

| 表 | 確定 PK | 補助 UNIQUE/secondary | 種別 |
|---|---|---|---|
| children | `(family_id, child_id)` | (family_id,user_id) 任意 | UUID child_id |
| child_activities | `(family_id, child_id, activity_id uuid)` | — | UUID |
| activity_logs | `(family_id, child_id, log_id uuid)` | 初期 PK のみ（date secondary は計測後） | UUID random |
| point_ledger | `(family_id, child_id, ledger_id uuid[v4])` | secondary `(family_id,child_id,type,recorded_date)`（spike#7 採用、冪等）。履歴ページング用 `(family,child,created_at)` は**計測後の任意追加** | **created_at は PK に入れない**（等値検索されず sort 用途のみ＝identity でない、判断⑬訂正 / PO 指摘 2026-07-01）。findPointHistory は PK プレフィクス scan + `ORDER BY created_at DESC` LIMIT（家庭 ~数百行/child で ~1.5ms、spike#7）。UUID v4 random で hot-partition ゼロ（判断⑦整合）＝**N1 消滅** |
| statuses | `(family_id, child_id, category_id)` | — | 自然複合 |
| status_history | `(family_id, child_id, category_id, hist_id uuid[v4])` | — | recorded_at は列（sort 用途、PK に入れない）。findRecentStatusHistory は category プレフィクス scan + sort LIMIT2/7（少数行） |
| activity_mastery | `(family_id, child_id, activity_id)` | — | 自然複合 |
| activity_pref (child_activity_preferences) | `(family_id, child_id, activity_id)` | — | 自然複合（**§3 欠落→編入**） |
| daily_missions | `(family_id, child_id, mission_date, activity_id)` | — | 自然複合 |
| login_bonuses | `(family_id, child_id, login_date)` | — | 自然複合 |
| stamp_cards | `(family_id, child_id, week_start)` | — | 自然複合（昇格） |
| stamp_entries | `(family_id, card_id, slot)` | UNIQUE `(family_id, card_id, login_date)`（1日1押印、consistency minor） | 自然複合 |
| checklist_logs | `(family_id, child_id, template_id, checked_date)` | — | 自然複合 |
| checklist_log_items | `(family_id, child_id, template_id, checked_date, item_id)` | — | itemsJson 解体（§5） |
| checklist_overrides | `(family_id, child_id, override_id uuid)` | — | UUID surrogate（自然キー一意の前提を置かず確定、N5） |
| checklist_templates | `(family_id, template_id uuid)` | — | UUID |
| checklist_template_items | `(family_id, template_id, item_id uuid)` | — | UUID |
| checklist_template_assignments | `(family_id, template_id, child_id)` | secondary `(family_id, child_id)`（findTemplatesByChild hot） | 自然複合 |
| certificates | `(family_id, child_id, certificate_id uuid[v4])` | `active_key GENERATED (CASE WHEN … type)` + UNIQUE（「1 type 有効1通」要時、droppable） | **UUID surrogate（PO/戦略パネル 2026-07-01）**: 再発行/名前修正2通目/周期型証書(月間・シーズン・challenge完了)が roadmap プラウジブル＝cardinality 可変、policy anchor 無し → §P1 で自然 PK 凍結は不可。UNIQUE は DROP 可 |
| evaluations | `(family_id, child_id, eval_id uuid[v4])` | — | created_at は列（sort 用途）。findEvaluationsByChild は PK プレフィクス + sort LIMIT |
| evaluation_scores | `(family_id, child_id, eval_id, category_id)` | — | scoresJson 解体（§5） |
| rest_days | `(family_id, child_id, date)` | — | 自然複合（昇格） |
| daily_battles | `(family_id, child_id, date)` | — | 自然複合（昇格） |
| enemy_collection | `(family_id, child_id, enemy_id)` | — | 自然複合（昇格） |
| special_rewards | `(family_id, child_id, reward_id uuid)` | secondary `(family_id, child_id, granted_at)`（findUnshownReward hot） | UUID |
| reward_redemption_requests | `(family_id, redemption_id uuid)` | secondary `(family_id, child_id, status)` + `(family_id, status, requested_at)` | UUID（命名は現名維持） |
| parent_messages | `(family_id, child_id, msg_id uuid[v4])` | — | sent_at は列（sort 用途）。findMessages/findUnshownMessage は PK プレフィクス + shown_at 残差 + sort LIMIT |
| sibling_cheers | `(family_id, cheer_id uuid)` | secondary `(family_id, to_child_id, shown_at)` | UUID |
| character_images | `(family_id, child_id, image_id uuid)` | — | UUID（key+メタ、§9.4） |
| **child_custom_voices**（**§3 欠落→編入**） | `(family_id, child_id, voice_id uuid)` | — | UUID。**source/not-yet-exported のユーザー録音**＝backup 必須。key+メタのみ（§9.4）、`scene` 素の列 |
| child_challenges | `(family_id, child_id, challenge_id uuid)` | secondary `(family_id, child_id, status)` | UUID。targetConfig/rewardConfig 解体（§5） |
| usage_logs | `(family_id, child_id, log_id uuid)` | — | UUID |
| report_daily_summaries | **廃止**（§7） | — | compute-on-read |
| achievements / child_achievements | **drop 判断（#322 廃止・データ不在）**: drop なら §3/§5 から除外、存続なら milestone_values 子表化 | — | 要確定（§10 追記） |
| **Family 系**: settings`(family_id,key)` / push_subscriptions / notification_logs / trial_history / viewer_tokens / cloud_exports / cancellation_reasons / graduation_consent | 各 `(family_id, <natural or uuid>)` | viewer_tokens/cloud_exports は token/pin の UNIQUE | §11.3 で確定 |
| **グローバル master**（tenant 非依存）: categories(code) / stamp_masters / market_benchmarks(age,category_id) / stripe_webhook_events(event_id, tenant_id は nullable analytics 属性) | 自然キー | — | tenant プレフィクスなし。**achievements/child_achievements/title は §10-10 で drop 確定＝新スキーマに作らない** |

### §11.3 per-column 完全 DDL（drizzle 2 方言）

> 全 ~40 表の列・型・CHECK・生成列・index を含む完全 DDL は **drizzle schema（pg-core/sqlite-core）の確定コードが SSOT**。§11.1/§11.2 の凍結 PK + §5 JSON 解体 + §4.1 index + §6.6 auth を入力に、実装 PR で生成する。DDL は **schema.ts の現列 + 変換規則（int id→uuid / +family_id / 複合 PK / 生成列 / CHECK / jsonb 判定）から機械的に導出**できるため、本設計書では凍結 PK と変換規則を SSOT とし、列レベル DDL は実装 PR の drizzle schema に委ねる（二重メンテ回避）。
> **委譲の前提条件（PR-0 前に潰す、N7）**: PK・型・family_id 付与・複合 PK 昇格・生成列・CHECK は機械決定だが、**「jsonb 列 vs 列展開」だけは設計判断が残る**。§5 に列挙された各 JSON 列の**判定結果（確定）**: displayConfig=**列展開**[PO 判断] / certificates.metadata=**jsonb** / scoresJson=**evaluation_scores 子表** / itemsJson=**checklist_log_items 子表** / targetConfig・rewardConfig=**列展開** / playerStatsJson=**列展開 or daily_battle_stats 子表**（実装時にキー数で確定、`ALTER ADD COLUMN` 可で可逆） / milestoneValues=**drop**（achievements 廃止）。これで委譲は安全に成立。列追加は `ALTER ADD COLUMN` 可（spike#2/3c）で後戻りも安い。

## §12 マイグレーション & cutover runbook

### §12.1 DSQL スキーマ構築順序（DDL 制約反映、F5）

DSQL は **1 txn = DDL 1 文・DDL/DML 混在不可**（spike#1）。よって:
1. 全 `CREATE TABLE`（inline PK/CHECK/UNIQUE 含む。空表なら inline UNIQUE on 生成列 OK＝spike#6/F7）を**逐次 txn**で実行。
2. データ load（chunk ≤3,000 行/txn、§9.1）。
3. **UNIQUE index を張る前に重複を排除（dedup 先行が前提）** → `CREATE [UNIQUE] INDEX ASYNC` を load 後に作成（per-row 再検証回避）。空表への inline UNIQUE は安全（spike#6/F7）、**populated 表（NUC cutover 等）への後付け UNIQUE のみ dedup 先行が必須**（F1）。
4. `sys.jobs`（job=`completed`）/ `pg_index.indisvalid=true` で **全 index が valid を確認**（F1 実機: dup が残ると job=`failed`・indisvalid=false で**沈黙縮退**＝query 加速されないまま、しかも新 dup 書込は依然 `23505` で制約される）。INVALID なら dedup して drop→再作成。
5. 接続は IAM トークン、ASYNC index build 完了待ちを CDK/migration に組込。
   - **レイテンシモデル（一次ソース: re:Invent 2025 DAT439 / spike#8 実測）**: 初回**接続確立 ~1.45s（spike#8: connect 562ms + 初回クエリ）**は Firecracker cold start でなく接続パス（SNI→Relay TLS→IAM トークン検証→placement AZ-local QP 割当→sandbox TLS 移行）。DSQL は warm pool 数百 microVM + Snapstart(CoW) で **compute cold start は実質ゼロ**。**確立済み接続の 2 回目以降は warm 高速**（spike#8: read p50 ~15ms / write p50 ~24ms in-region）。**Lambda 実務**: DB client を handler 外生成し warm コンテナで接続再利用→warm 高速。ただし **IAM トークン寿命 1h・接続 age 上限 1h** ゆえ長寿命 warm コンテナは期限/切断を検知して再接続（再接続時は再び接続パスコスト、トークン再生成は SigV4 相当でローカル軽量）。
6. **analytics の DynamoDB 直書き経路の帰属（N3）**: `analytics/providers/dynamo.ts` は DB 層と別系統の独自 DynamoDB writer。本番から DynamoDB を全撤去（#3438）するなら analytics event の保存先を確定（DSQL 新表 / 別マネージドサービス / noop 継続のいずれか）。撤去計画 #3438 に編入し「DynamoDB 依存 1 本残存」を防ぐ。

### §12.2 NUC(SQLite) cutover 移行機構（単一経路に確定、I-4）

**`backup round-trip 経路`に一本化**（id マッピング表は不要）。理由: backup import は **id 非保全・自然キー再解決の純論理 import**（§9.2.1）で、surrogate int→UUID の id 張替えは「新規 UUID を採番し自然キーで参照解決」に自然に吸収される。手順:
1. NUC 旧 DB を**読み取りバックアップ**（非破壊、`drizzle-kit push` 禁止）。
2. backup-archive 論理エクスポート（既存機構）。
3. 新スキーマ DSQL/SQLite DB を §12.1 で構築。
4. backup import（chunk+saga、§9.1）で変換投入。**R2（avatar/voice の childId path UUID 対応）必須**。
5. round-trip 検証（backend パラメタ化 completeness test を pg で 1 回）+ コピー検証。
6. 切替（旧 DB 保持）。中止基準: errors>0 で swap 中止（§9.1 import-then-swap semantics）。

### §12.2.1 実装 build order（依存 DAG、手戻り防止）

PK 凍結と共有プリミティブの順序を誤ると下流が手戻るため、実装 PR の順序を固定:
1. **PR-0: `children` 確定 DDL（§11.1）+ 全テナント表 PK 凍結（§11.2）レビュー確定** — child_id が ~20 表の複合 PK 先頭の linchpin（I-1）。これを最初に凍結。
2. **PR-0b: `runInTransaction` + `withOccRetry` プリミティブ + tx ハンドル引き回し repo 改修（§8）** — recordActivity（#3435 系）と bulk import（#3436）が共有するため両者の前に単独で。
3. **PR-1: auth リレーショナル DDL（§6.6）** — invites.child_id が children UUID に依存（PR-0 後）。
4. **PR-2 以降: child-cluster 各表 DDL + repo（insertForRestore/findAllByChild 維持）+ backup R2/R5 + fitness function**。
- **旧 I-2 は解消済**: point_ledger の created_at-in-PK hot-partition 懸念は、§P3「時刻列を PK に入れない」への設計変更（PO 指摘 2026-07-01）で消滅。PK = `(family_id, child_id, ledger_id uuid[v4])` で単調増加列なし → PR-0 凍結の blocker ではなくなった。total_point contention のみ実装後に実データ計測（EPIC spike(a)#3425、可逆）。

### §12.3 ロールバック / cutover 中止基準

- **AWS greenfield swap**（DynamoDB→DSQL）: zero-user 期なら新 stack を並行起動し検証後に切替。中止 = 旧 DynamoDB stack を保持し DNS/env を戻す。
- **NUC**: 旧 DB を物理保持。import errors>0 or round-trip 不一致で abort、旧 DB に戻す。
- **二重 backend 期間**: DSQL/SQLite 同一論理モデルのため、移行中は片方を正とし他方は read-only 検証用（同時 write 禁止）。

### §12.4 DSQL 本体 DR / PITR 方針（DB アーキ B2、本番稼働前に必須）

§12.3 は zero-user greenfield swap のみ、§9.2 backup-registry は論理 family export（DB 災害復旧でない）。子供の**蓄積履歴（point/streak/証書）消失は評判的に致命**のため、本番稼働前に:
- **DSQL PITR / AWS Backup を有効化**（near-free、DPU 最小）。#3437（AWS Backup PITR とアプリ層 backup の役割分担）と整合: DR/全体復旧=DSQL PITR、ユーザー操作の家族 export/import=アプリ層。
- **単一リージョン SPOF を明示受容 + RPO/RTO を Pre-PMF 水準で記載**（DSQL は稼働リージョン内 3AZ 同期でリージョン内は堅牢）。**multi-region active-active は ADR-0010 bucket C として明示 scope 外**。
- 同一大陸内の linked cluster（例 us-east-1/us-east-2、ap-northeast-1/2/3）は将来オプション（今は不要、cross-continent linked は不可）。

### §12.5 PK 凍結 ceremony の位置づけ（戦略 B2、zero-user rebuildability）

**zero-user window では PK は rebuildable**（§12.3 greenfield swap で DROP/CREATE 自由）。よって PR-0 の PK 凍結は **hard gate でなく revisitable baseline**であり、§P1 の不可逆性は real cohort データが存在するまで binding しない。真の freeze ceremony は first real cohort 後に予約する。これにより PR-0 凍結レビューを過重にせず、工数を PMF 探索に振り向けられる（front-load 最小化）。ただし §12.2.1 の build order（children linchpin 先行）と governing rule（§11.2）は維持する。

## §13 fitness function 一覧 & コスト

### §13.1 fitness function（CI 機械強制、ADR-0061 整合）

| # | 不変条件 | 検証 |
|---|---|---|
| 1 | 全テナント表に `family_id` NOT NULL + 全 repo メソッドに tenant 述語（§P9、security Finding 1）。**raw `sql\`\`` template も対象**（AST の `.where(eq)` 検出は raw で fail-open するため、tenant-scoped repo の raw クエリ禁止 or 単一強制点必須、QM R5） | architecture test（schema walk + repo AST + raw-SQL ban） |
| 2 | `consents` への UPDATE/DELETE 禁止（append-only）。**erasure 例外は owner-gated account-deletion 集約 txn からのみ callable（単一 caller assertion）+ いかなる HTTP handler からも非到達**（security B2、証跡隠滅口を塞ぐ） | repo に update/delete 非定義 + GRANT 除外 + erasure caller 束縛 test + lint |
| 3 | **全 role-mutation 操作（role 変更・owner 移譲 updateTenantOwner・membership 削除・invite-accept-with-role）を列挙し各々 `requireRole(['owner'])` 背後に置く positive + negative(parent→403) test**（security B1: owner_guard は owner≤1 のみで「誰が書けるか」を守らない、二次防御ゼロの単一点）。`/admin`=owner+parent 同居 route を owner 専用 route へ分離 | 全操作列挙 route guard test(positive+negative) + DDL 検証 |
| 4 | backup-entity-registry: schema ⊆ registry（no silent gap）+ auth/consent/subscription は excluded。**settings は KVS で schema-walk の死角** → settings export を**真の allowlist 化**（許可キー列挙・未知キー既定除外、現「除外リスト」= denylist 形状を是正、security B3 / CWE-522/916） | registry test + settings KV allowlist test |
| 5 | backup round-trip completeness（**backend パラメタ化して pg でも 1 回**）+ chunk 部分失敗→旧データ保全。**(a) storage 層 re-link count assertion**（avatar/voice/generated: source count == restored count かつ > 0、R2 の silent 全 skip を検出、QM B2）+ **(b) 秘密不在 negative assertion**（pg export に pin_hash/session_token/未知キーが ABSENT、security B3） | 既存 test の backend 化 + storage re-link + 秘密不在 assert |
| 6 | dialect-parity: 生成列(owner_guard/active_key/email_lower)+UNIQUE / CHECK 強制 / temporal `{mode:'string'}` を**両 backend で assert**（揮発した spike script を `tests/unit/db/dialect-parity.test.ts` に恒久化、SQLite parity Finding 4） | 新規 test |
| 7 | **core txn work 内の await は tx-bound call のみ許す allowlist**（QM B1: denylist だと `await sleep`/`await db2.x`/helper 経由の transitive await を見逃す。`work` 内の全 `AwaitExpression` は `tx` binding への call であること、それ以外 fail）（§8、yield 汚染防止） | AST allowlist |
| 8 | **tx-handle escape guard**（QM B1、最重要非対称バグ）: tenant/write-path repo メソッドは `tx` を必須引数に取り、module-level `db` 直結 import を write-path モジュールで禁止（SQLite 単一接続で隠蔽・pg で部分コミット＝E2E緑で本番崩壊）。pg-backend CI を recordActivity write-path に拡張（local-only SQLite は構造的に検出不能） | write-path repo の tx 引数 AST + module db import ban + pg write-path integration test |
| 9 | **PK-freeze drift manifest**（QM B3、§P1 唯一の不可逆不変条件を機械強制）: drizzle pg/sqlite schema の PK == 凍結 PK manifest。変更は manifest 更新 + migration ADR 必須（cardinality 恒久性の product 判断は人手のまま明示 scope） | schema PK == manifest test（PR-0 で導入） |
| 10 | **once-per-period bonus の冪等 guard**（QM R3、double-award 防止）: mission-bonus 等の point_ledger は unique 制約なし＝count-then-insert が OCC/double-tap 下で TOCTOU→二重付与（fitness#14 の total_point 突合は self-consistent で検出不能）。once-per-day 系は自然キー UNIQUE（login_bonuses は既に `(child,login_date)` で安全、mission bonus に相当 guard 追加）or serialization test | 冪等 unit/integration test |
| 11 | **optional 欠落の可観測化**: fitness#14 は total_point/total_xp/streak をカバーするが **optional 欠落（行が書かれず drift=0）を検出できない**（DB R1/QM R4/PO R1）→ optional-write 失敗時に**観測カウンタ（ログでなく metric）**を emit し欠落率を可観測化。fitness#14 は optional omission を除く旨を注記 | optional-write failure metric + 注記 |
| 12 | cross-tenant E2E（他テナント childId で 404 + storage 非到達、#3139 踏襲） | 既存 IDOR test 移植 |
| 13 | DDL 二重ソース drift 防止: pg DDL と sqlite DDL の生成列式・CHECK 値が文字列一致（create-tables.ts 手書き path 縮退、SQLite parity Finding 4） | 新規 parity test |
| 14 | **派生列 drift 突合**: `children.total_point` == `SUM(point_ledger.amount)` / `statuses.total_xp` == 集計 / `activity_logs.streak_days` 整合をバッチで突合（§5/§P7 不変条件、F2）。正本は派生列、突合で乖離検出。**optional 欠落は行が書かれず drift=0 で検出不能（fitness#11 の欠落カウンタで補完）** | バッチ drift 検出 test |
| 15 | **cron バッチの per-tenant chunk 強制**: 全テナント横断 cron（age 系 / retention / grace-period / trial-notif / analytics）が単一 txn で全行を書かず per-tenant + chunk ≤3,000 行 + OCC retry で回す（§8.1、N2） | cron 実装の AST/lint + 統合 test |

### §13.2 コスト / DPU 概算

- **Write DPU 主成分 = recordActivity の index 維持**: 記録毎書込表 = activity_logs（初期 secondary 0）+ point_ledger（secondary 1）+ statuses（0）。secondary 1 本 = 全書込に複合 PK 幅（uuid×2+）の Write DPU 加算 → **記録あたり index は最小（point_ledger 1 本）**に固定。
- **Read DPU**: 残高 SUM 廃止（total_point 派生列）で子供 layout 毎描画の read を列 1 read 化。compute-on-read（report 廃止）は家庭スケール ~520 行/child で ~1.5ms（spike#7）。
- **storage**: バイト（画像/音声）は DB 外（IStorageRepo、§9.4）。DSQL 無料枠 1GB はメタ専用に温存。
- **詳細見積は EPIC #3430（DPU 見積）に委譲**。spike#1 実測: 検証 1 回 TotalDPU 3.53（無料枠 0.0035%）。
- **index 過多の隠れコスト**: spike#7 で index 追加が Planning Time を 1-5ms→23-27ms に増加。secondary は hot path 実測で正当化されたものだけ。
