// src/lib/server/db/child-scoped-tables.ts
// #4696: 「子供 1 人を削除したときに消す表」の **backend 共通 SSOT**。
//
// 背景 (実害): sqlite の `deleteChild` は 11 表しか消しておらず、`usage_logs` 等が残るため
// FK 制約で children 行を消せない。しかも失敗は warn で握り潰され「完了しました」と表示されていた
// (#4696: 全削除で children 5→4、置換インポートで子供が二重化)。DSQL 側は 25 表を消す実装を
// 持っていたため、**同じ操作の削除対象が backend ごとに違う**ことが根本原因。
//
// 以後、削除対象の一覧はここだけに書く。両 backend の repo は本 module を import する:
//   - `dsql/child-repo.ts`   … 単一 txn で family_id + child_id 述語 DELETE
//   - `sqlite/child-repo.ts` … 単一 txn で child_id 述語 DELETE (単一テナントのため family 述語なし)
//
// 網羅性は fitness function が両 backend で機械検証する (新表を足して list を更新し忘れると CI 赤):
//   - pg : tests/unit/architecture/dsql-child-scoped-tables-fitness.test.ts
//   - sqlite: tests/unit/db/sqlite-child-scoped-tables-fitness.test.ts

/**
 * 両 backend に存在する child スコープ表 (child_id 列を持つ)。
 * 削除順は FK に依存しない (sqlite は `foreign_keys` ON でも child_id 参照は children 行より先に
 * 消えるため問題にならない)。children 行の削除は repo 側で最後に行う。
 */
export const CHILD_SCOPED_TABLES = [
	'child_activities',
	'activity_logs',
	'point_ledger',
	'statuses',
	'status_history',
	'activity_mastery',
	'child_activity_preferences',
	'daily_missions',
	'login_streaks',
	'stamp_cards',
	// checklist_logs.itemsJson は text 据置 (子表 checklist_log_items 廃止、M3 §4.2)。
	'checklist_logs',
	'checklist_overrides',
	'checklist_template_assignments',
	'certificates',
	// evaluations.scoresJson は text 据置 (子表 evaluation_scores 廃止、M3 §4.2)。
	'evaluations',
	'rest_days',
	'daily_battles',
	'enemy_collection',
	'special_rewards',
	'reward_redemption_requests',
	'parent_messages',
	'character_images',
	'child_custom_voices',
	'child_challenges',
	'usage_logs',
] as const;

/**
 * sqlite (local / dev) にのみ存在する child スコープ表。
 * - `child_achievements`: 実績システム廃止 (#322) で pg スキーマには作られていない残置表
 * - `report_daily_summaries`: pg では compute-on-read 化して表自体が無い (dsql-data-model §7)
 */
export const SQLITE_ONLY_CHILD_SCOPED_TABLES = [
	'child_achievements',
	'report_daily_summaries',
] as const;

/**
 * **他の child スコープ表から参照されているため最後に消す表** (sqlite は FK を強制するため順序が要る。
 * pg backend は FK を張らない §P4 ため順序非依存だが、SSOT を 1 つに保つため共通で定義する)。
 *
 * 実 DB の FK 関係 (`PRAGMA foreign_key_list`):
 *   - `child_activities`  ← activity_logs / activity_mastery / child_activity_preferences / daily_missions
 *   - `special_rewards`   ← reward_redemption_requests
 *   - `stamp_cards`       ← stamp_entries (child_id 列が無いため repo 側で subquery 削除)
 *
 * 網羅性は fitness function が実 DB catalog から突合する (新しい参照が増えたら CI が落ちる)。
 */
export const CHILD_SCOPED_TABLES_DELETE_LAST = [
	'child_activities',
	'special_rewards',
	'stamp_cards',
] as const;

/** sqlite backend で削除対象になる child スコープ表 (共通 + sqlite 固有)。 */
export const SQLITE_CHILD_SCOPED_TABLES: readonly string[] = [
	...CHILD_SCOPED_TABLES,
	...SQLITE_ONLY_CHILD_SCOPED_TABLES,
];

/**
 * sqlite の削除順 (FK 強制下で 1 txn 内に消し切れる順序)。
 * 参照されている表 ({@link CHILD_SCOPED_TABLES_DELETE_LAST}) を末尾に回すだけで、集合は同一。
 */
export const SQLITE_CHILD_SCOPED_TABLES_IN_DELETE_ORDER: readonly string[] = [
	...SQLITE_CHILD_SCOPED_TABLES.filter(
		(t) => !(CHILD_SCOPED_TABLES_DELETE_LAST as readonly string[]).includes(t),
	),
	...CHILD_SCOPED_TABLES_DELETE_LAST,
];

/**
 * child_id 列を持たないため個別 SQL が要る表 (両 backend 共通の特例)。
 * - `stamp_entries`  : card_id 参照のみ。stamp_cards を消す前に subquery で削除する
 * - `sibling_cheers` : from_child_id / to_child_id の 2 参照軸を OR で削除する
 *
 * 本定数は「一覧に無いのは忘れているからではない」ことを示す文書化用 (実 SQL は各 repo)。
 * fitness function はこの 2 表を「child_id 列が無い既知の例外」として除外する。
 */
export const CHILD_SCOPED_SPECIAL_CASE_TABLES = ['stamp_entries', 'sibling_cheers'] as const;
