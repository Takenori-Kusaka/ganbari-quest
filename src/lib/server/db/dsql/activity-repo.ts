// src/lib/server/db/dsql/activity-repo.ts
// EPIC #3424 / PR-R5 (repo 層 build order §12.2.1) / 設計 SSOT: dsql-data-model.md §11.2 / §3.5.5 / §5(P7) / §P9
//
// IActivityRepo (activities + activity_logs) の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8: module-level db/client import 禁止)。
//   - **§P9 tenant 述語**: 全メソッドが family_id = tenantId を WHERE に含む。JOIN も
//     family_id / child_id を結合条件に含め cross-tenant / cross-child 行の結合を構造的に防ぐ。
//   - **Activity shape adapter parity**: sqlite facade (#2458-A1 `_toActivityShape`) と同一 —
//     child_activities 行を Activity shape で返し、差分 field (ageMin/ageMax/gradeLevel/
//     subcategory/description) は null 埋め。boolean 列は 0/1 数値契約に変換。
//   - **record 系 hot path は record-activity-core.ts が正** (§8 単一 txn)。本 repo の
//     insertActivityLog / markActivityLogCancelled は sqlite parity の単文 primitive
//     (service 合成用) であり、5 表複合書込は重複実装しない。
//   - **insertPointLedger は point 書込単一プリミティブ (point-write.ts) へ委譲** (reset-plan
//     決定#3)。ledger INSERT + children.total_point 加算を同一 txn で行い、child 不在は throw
//     して rollback する契約は writer 側に集約 (INSERT + 加算のコピーを 2 つ持たない)。
//     point-repo.insertPointEntry と完全に同一経路 (§5 P7 / §6.2 compute-on-write)。
//   - **集計は SQL 集計 1 クエリ** (§3.5.5: 1 接続逐次 await の N+1 を repo が自ら作らない)。
//     findMustActivitiesWithToday も sqlite の 2 クエリ + app 側 Set 合成ではなく LEFT JOIN
//     1 クエリで集計する。
//   - countPointLedgerEntriesByTypeAndDate は recorded_date 列で冪等 lookup (§11.2 H21 —
//     spike#7 採用の secondary (family,child,type,recorded_date) が covering)。
//   - **insertActivity の facade 契約再評価 (#3596 ③)**: `IActivityRepo.insertActivity(input,
//     tenantId)` は child selector を持たない **family-level 互換 API** であり、per-child
//     instance (ADR-0055 §6) を作る新規呼出は `IChildActivityRepo.insertActivity(input, childId)`
//     を使う。本 facade は「child 未指定」の legacy 呼出のために tenant の**代表 child**
//     (= 最古 created_at) に bind する暫定 shim を維持する (sqlite facade parity #2458-A1、
//     sqlite は `ORDER BY children.id` = 作成順)。DSQL は integer autoincrement が無いため
//     `ORDER BY created_at, child_id` で代表 child を決める。**child_id (uuid) を第 2 sort key に
//     置くことで同秒 created_at でも一意・決定的**に選ばれる (「同秒時 tiebreak 非決定」懸念の解消。
//     `[A3b]` 回帰で pin)。返す Activity shape は child 束縛を露出しない (sqlite parity) ため、
//     複数 child 家庭で本 facade を使うのは legacy path のみ。

import { sql } from 'drizzle-orm';
import { type ActivityId, asActivityId, asCategoryId, asChildId } from '$lib/domain/ids';
import type { IActivityRepo } from '../interfaces/activity-repo.interface';
import type { TransactionRunner } from '../interfaces/transaction.interface';
import type { Activity, ActivityLog, ActivityLogSummary, ActivityPriority } from '../types';
import { createDsqlChildRepo } from './child-repo';
import { createPointEntryWriter } from './point-write';
import type { SqlExecutor } from './sql-executor';

interface ActivityRow {
	activity_id: string;
	child_id: string;
	name: string;
	category_id: string;
	icon: string;
	base_points: number;
	is_visible: boolean;
	daily_limit: number | null;
	sort_order: number;
	source: string;
	name_kana: string | null;
	name_kanji: string | null;
	trigger_hint: string | null;
	is_main_quest: boolean;
	is_archived: boolean;
	archived_reason: string | null;
	source_preset_id: string | null;
	priority: string;
	created_at: string;
}

interface LogRow {
	log_id: string;
	child_id: string;
	activity_id: string;
	points: number;
	streak_days: number;
	streak_bonus: number;
	recorded_date: string;
	recorded_at: string;
	cancelled: boolean;
}

const ACTIVITY_COLUMNS = sql.raw(
	`activity_id, child_id, name, category_id, icon, base_points, is_visible, daily_limit,
	 sort_order, source, name_kana, name_kanji, trigger_hint, is_main_quest, is_archived,
	 archived_reason, source_preset_id, priority, created_at`,
);

const LOG_COLUMNS = sql.raw(
	`log_id, child_id, activity_id, points, streak_days, streak_bonus, recorded_date,
	 recorded_at, cancelled`,
);

/** 非 archived 述語 (DSQL は is_archived NOT NULL boolean のため NULL 互換分岐は不要)。 */
const NOT_ARCHIVED = sql.raw('is_archived = false');

/** row → Activity shape (sqlite `_toActivityShape` adapter parity、差分 field は null 埋め)。 */
function toActivityShape(row: ActivityRow): Activity {
	return {
		id: asActivityId(row.activity_id),
		name: row.name,
		categoryId: asCategoryId(row.category_id),
		icon: row.icon,
		basePoints: row.base_points,
		ageMin: null, // ChildActivity は per-child instance のため age filter なし (ADR-0055)
		ageMax: null,
		isVisible: row.is_visible ? 1 : 0,
		dailyLimit: row.daily_limit,
		sortOrder: row.sort_order,
		source: row.source,
		gradeLevel: null,
		subcategory: null,
		description: null,
		nameKana: row.name_kana,
		nameKanji: row.name_kanji,
		triggerHint: row.trigger_hint,
		isMainQuest: row.is_main_quest ? 1 : 0,
		isArchived: row.is_archived ? 1 : 0,
		archivedReason: row.archived_reason,
		createdAt: row.created_at,
		sourcePresetId: row.source_preset_id,
		priority: row.priority as ActivityPriority,
	};
}

/** row → ActivityLog entity (boolean → 0/1 数値契約 = sqlite 互換 shape)。 */
function toActivityLog(row: LogRow): ActivityLog {
	return {
		id: row.log_id,
		childId: asChildId(row.child_id),
		activityId: asActivityId(row.activity_id),
		points: row.points,
		streakDays: row.streak_days,
		streakBonus: row.streak_bonus,
		recordedDate: row.recorded_date,
		recordedAt: row.recorded_at,
		cancelled: row.cancelled ? 1 : 0,
	};
}

/** count 系クエリの単値取得 (PGlite/pg の bigint 文字列化を Number で正規化)。 */
function scalarCount(result: { rows: unknown[] }): number {
	return Number((result.rows[0] as { c: unknown } | undefined)?.c ?? 0);
}

/** DSQL 用 IActivityRepo を生成する (db/runner は注入、fitness#8)。 */
export function createDsqlActivityRepo<TTx extends SqlExecutor>(
	db: SqlExecutor,
	runner: TransactionRunner<TTx>,
): IActivityRepo {
	// findChildById convenience は child-repo の compute-on-read 契約 (§11.1) へ委譲する。
	const childRepo = createDsqlChildRepo(db, runner);
	// reset-plan 決定#3: point 書込単一プリミティブ。insertPointLedger は本 writer に委譲する。
	const insertPointEntry = createPointEntryWriter(runner);

	const findActivityById = async (id: ActivityId, tenantId: string) => {
		const result = await db.execute(sql`
			SELECT ${ACTIVITY_COLUMNS} FROM child_activities
			WHERE family_id = ${tenantId} AND activity_id = ${id}
		`);
		const row = result.rows[0] as unknown as ActivityRow | undefined;
		return row ? toActivityShape(row) : undefined;
	};

	return {
		// ── Activities (CRUD、Activity shape adapter) ──

		async findActivities(tenantId, filter) {
			const tenantConditions = [sql`family_id = ${tenantId}`, sql`${NOT_ARCHIVED}`];
			if (filter?.categoryId) tenantConditions.push(sql`category_id = ${filter.categoryId}`);
			if (!filter?.includeHidden) tenantConditions.push(sql`is_visible = true`);
			// NOTE: filter.childAge は per-child instance では非適用 (sqlite facade parity、ADR-0055)。
			const result = await db.execute(sql`
				SELECT ${ACTIVITY_COLUMNS} FROM child_activities
				WHERE ${sql.join(tenantConditions, sql` AND `)}
				ORDER BY sort_order, created_at, activity_id
			`);
			return (result.rows as unknown as ActivityRow[]).map(toActivityShape);
		},

		findActivityById,

		async insertActivity(input, tenantId) {
			// sqlite facade parity (#2458-A1): tenant 先頭 child に bind。ageMin/ageMax は
			// per-child instance に存在しないため drop (ADR-0055)。
			const firstChild = await db.execute(sql`
				SELECT child_id FROM children WHERE family_id = ${tenantId}
				ORDER BY created_at, child_id LIMIT 1
			`);
			const child = firstChild.rows[0] as { child_id: string } | undefined;
			if (!child) {
				// facade 契約 (#3596 ③、header 参照): child 未指定の legacy family-level 呼出は
				// 代表 child (最古 created_at、child_id uuid tiebreak で決定的) に bind する。
				// per-child 新規作成は IChildActivityRepo.insertActivity(input, childId) を使う。
				throw new Error('insertActivity: tenant に child が存在しないため作成不可');
			}
			const result = await db.execute(sql`
				INSERT INTO child_activities
					(family_id, child_id, name, category_id, icon, base_points, trigger_hint,
					 is_main_quest, source_preset_id, priority)
				VALUES (${tenantId}, ${child.child_id}, ${input.name}, ${input.categoryId},
					${input.icon}, ${input.basePoints}, ${input.triggerHint ?? null},
					${(input.isMainQuest ?? 0) !== 0}, ${input.sourcePresetId ?? null},
					${input.priority ?? 'optional'})
				RETURNING ${ACTIVITY_COLUMNS}
			`);
			return toActivityShape(result.rows[0] as unknown as ActivityRow);
		},

		async updateActivity(id, input, tenantId) {
			// ChildActivity に存在しない field (ageMin/ageMax) は drop (sqlite facade parity)。
			const sets: ReturnType<typeof sql>[] = [];
			if (input.name !== undefined) sets.push(sql`name = ${input.name}`);
			if (input.categoryId !== undefined) sets.push(sql`category_id = ${input.categoryId}`);
			if (input.icon !== undefined) sets.push(sql`icon = ${input.icon}`);
			if (input.basePoints !== undefined) sets.push(sql`base_points = ${input.basePoints}`);
			if (input.triggerHint !== undefined) sets.push(sql`trigger_hint = ${input.triggerHint}`);
			if (input.isMainQuest !== undefined)
				sets.push(sql`is_main_quest = ${input.isMainQuest !== 0}`);
			if (input.priority !== undefined) sets.push(sql`priority = ${input.priority}`);
			if (sets.length === 0) return findActivityById(id, tenantId); // no-op は既存行返却
			const result = await db.execute(sql`
				UPDATE child_activities SET ${sql.join(sets, sql`, `)}
				WHERE family_id = ${tenantId} AND activity_id = ${id}
				RETURNING ${ACTIVITY_COLUMNS}
			`);
			const row = result.rows[0] as unknown as ActivityRow | undefined;
			return row ? toActivityShape(row) : undefined;
		},

		async setActivityVisibility(id, visible, tenantId) {
			const result = await db.execute(sql`
				UPDATE child_activities SET is_visible = ${visible}
				WHERE family_id = ${tenantId} AND activity_id = ${id}
				RETURNING ${ACTIVITY_COLUMNS}
			`);
			const row = result.rows[0] as unknown as ActivityRow | undefined;
			return row ? toActivityShape(row) : undefined;
		},

		async deleteActivity(id, tenantId) {
			const result = await db.execute(sql`
				DELETE FROM child_activities
				WHERE family_id = ${tenantId} AND activity_id = ${id}
				RETURNING ${ACTIVITY_COLUMNS}
			`);
			const row = result.rows[0] as unknown as ActivityRow | undefined;
			return row ? toActivityShape(row) : undefined;
		},

		async hasActivityLogs(activityId, tenantId) {
			const result = await db.execute(sql`
				SELECT count(*)::int AS c FROM activity_logs
				WHERE family_id = ${tenantId} AND activity_id = ${activityId}
			`);
			return scalarCount(result) > 0;
		},

		async getActivityLogCounts(tenantId) {
			const result = await db.execute(sql`
				SELECT activity_id, count(*)::int AS c FROM activity_logs
				WHERE family_id = ${tenantId} AND cancelled = false
				GROUP BY activity_id
			`);
			const counts: Record<string, number> = {};
			for (const row of result.rows as { activity_id: string; c: number }[]) {
				counts[row.activity_id] = Number(row.c);
			}
			return counts;
		},

		async countMainQuestActivities(tenantId) {
			const result = await db.execute(sql`
				SELECT count(*)::int AS c FROM child_activities
				WHERE family_id = ${tenantId}
					AND is_main_quest = true AND is_visible = true AND ${NOT_ARCHIVED}
			`);
			return scalarCount(result);
		},

		async deleteDailyMissionsByActivity(activityId, tenantId) {
			await db.execute(sql`
				DELETE FROM daily_missions
				WHERE family_id = ${tenantId} AND activity_id = ${activityId}
			`);
		},

		// ── Children (convenience) ──

		async findChildById(id, tenantId) {
			return childRepo.findChildById(id, tenantId);
		},

		// ── Activity Logs ──

		async findDailyLog(childId, activityId, date, tenantId) {
			const result = await db.execute(sql`
				SELECT ${LOG_COLUMNS} FROM activity_logs
				WHERE family_id = ${tenantId} AND child_id = ${childId}
					AND activity_id = ${activityId} AND recorded_date = ${date} AND cancelled = false
				LIMIT 1
			`);
			const row = result.rows[0] as unknown as LogRow | undefined;
			return row ? toActivityLog(row) : undefined;
		},

		async findStreakLogs(childId, activityId, tenantId) {
			const result = await db.execute(sql`
				SELECT recorded_date FROM activity_logs
				WHERE family_id = ${tenantId} AND child_id = ${childId}
					AND activity_id = ${activityId} AND cancelled = false
				ORDER BY recorded_date DESC
			`);
			return (result.rows as { recorded_date: string }[]).map((r) => ({
				recordedDate: r.recorded_date,
			}));
		},

		async insertActivityLog(input, tenantId) {
			// 単文 primitive (sqlite parity)。record hot path の 5 表複合書込は
			// record-activity-core.ts (§8 単一 txn) が正 — ここでは重複実装しない。
			const result = await db.execute(sql`
				INSERT INTO activity_logs
					(family_id, child_id, activity_id, points, streak_days, streak_bonus,
					 recorded_date, recorded_at)
				VALUES (${tenantId}, ${input.childId}, ${input.activityId}, ${input.points},
					${input.streakDays}, ${input.streakBonus}, ${input.recordedDate}, ${input.recordedAt})
				RETURNING ${LOG_COLUMNS}
			`);
			return toActivityLog(result.rows[0] as unknown as LogRow);
		},

		async findActivityLogById(id, tenantId) {
			const result = await db.execute(sql`
				SELECT ${LOG_COLUMNS} FROM activity_logs
				WHERE family_id = ${tenantId} AND log_id = ${id}
			`);
			const row = result.rows[0] as unknown as LogRow | undefined;
			return row ? toActivityLog(row) : undefined;
		},

		async markActivityLogCancelled(id, tenantId) {
			await db.execute(sql`
				UPDATE activity_logs SET cancelled = true
				WHERE family_id = ${tenantId} AND log_id = ${id}
			`);
		},

		async findActivityLogs(childId, tenantId, options = {}) {
			const conditions = [
				sql`al.family_id = ${tenantId}`,
				sql`al.child_id = ${childId}`,
				sql`al.cancelled = false`,
			];
			if (options.from) conditions.push(sql`al.recorded_date >= ${options.from}`);
			if (options.to) conditions.push(sql`al.recorded_date <= ${options.to}`);
			const result = await db.execute(sql`
				SELECT al.log_id, ca.name, ca.icon, ca.category_id, al.points, al.streak_days,
					al.streak_bonus, al.recorded_at
				FROM activity_logs al
				INNER JOIN child_activities ca
					ON ca.family_id = al.family_id AND ca.child_id = al.child_id
					AND ca.activity_id = al.activity_id
				WHERE ${sql.join(conditions, sql` AND `)}
				ORDER BY al.recorded_at DESC
			`);
			return (
				result.rows as {
					log_id: string;
					name: string;
					icon: string;
					category_id: string;
					points: number;
					streak_days: number;
					streak_bonus: number;
					recorded_at: string;
				}[]
			).map(
				(r): ActivityLogSummary => ({
					id: r.log_id,
					activityName: r.name,
					activityIcon: r.icon,
					categoryId: asCategoryId(r.category_id),
					points: r.points,
					streakDays: r.streak_days,
					streakBonus: r.streak_bonus,
					recordedAt: r.recorded_at,
				}),
			);
		},

		async countTodayActiveRecords(childId, activityId, date, tenantId) {
			const result = await db.execute(sql`
				SELECT count(*)::int AS c FROM activity_logs
				WHERE family_id = ${tenantId} AND child_id = ${childId}
					AND activity_id = ${activityId} AND recorded_date = ${date} AND cancelled = false
			`);
			return scalarCount(result);
		},

		async getTodayActivityCountsByChild(childId, date, tenantId) {
			const result = await db.execute(sql`
				SELECT activity_id, count(*)::int AS c FROM activity_logs
				WHERE family_id = ${tenantId} AND child_id = ${childId}
					AND recorded_date = ${date} AND cancelled = false
				GROUP BY activity_id
			`);
			return (result.rows as { activity_id: string; c: number }[]).map((r) => ({
				activityId: asActivityId(r.activity_id),
				count: Number(r.c),
			}));
		},

		async findTodayRecordedActivityIds(childId, today, tenantId) {
			const result = await db.execute(sql`
				SELECT DISTINCT activity_id FROM activity_logs
				WHERE family_id = ${tenantId} AND child_id = ${childId}
					AND recorded_date = ${today} AND cancelled = false
			`);
			return (result.rows as { activity_id: string }[]).map((r) => asActivityId(r.activity_id));
		},

		// ── Aggregation queries (SQL 集計 1 クエリ、§3.5.5) ──

		async findDistinctRecordedDates(childId, tenantId) {
			const result = await db.execute(sql`
				SELECT recorded_date FROM activity_logs
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND cancelled = false
				GROUP BY recorded_date
				ORDER BY recorded_date
			`);
			return (result.rows as { recorded_date: string }[]).map((r) => ({
				recordedDate: r.recorded_date,
			}));
		},

		async countActiveActivityLogs(childId, tenantId) {
			const result = await db.execute(sql`
				SELECT count(*)::int AS c FROM activity_logs
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND cancelled = false
			`);
			return scalarCount(result);
		},

		async getCategoryCountsByDate(childId, tenantId) {
			const result = await db.execute(sql`
				SELECT al.recorded_date, count(DISTINCT ca.category_id)::int AS c
				FROM activity_logs al
				INNER JOIN child_activities ca
					ON ca.family_id = al.family_id AND ca.child_id = al.child_id
					AND ca.activity_id = al.activity_id
				WHERE al.family_id = ${tenantId} AND al.child_id = ${childId} AND al.cancelled = false
				GROUP BY al.recorded_date
			`);
			return (result.rows as { recorded_date: string; c: number }[]).map((r) => ({
				recordedDate: r.recorded_date,
				categoryCount: Number(r.c),
			}));
		},

		async countDistinctCategories(childId, tenantId) {
			const result = await db.execute(sql`
				SELECT count(DISTINCT ca.category_id)::int AS c
				FROM activity_logs al
				INNER JOIN child_activities ca
					ON ca.family_id = al.family_id AND ca.child_id = al.child_id
					AND ca.activity_id = al.activity_id
				WHERE al.family_id = ${tenantId} AND al.child_id = ${childId} AND al.cancelled = false
			`);
			return scalarCount(result);
		},

		async findTodayLogsWithCategory(childId, date, tenantId) {
			const result = await db.execute(sql`
				SELECT al.activity_id, ca.category_id
				FROM activity_logs al
				INNER JOIN child_activities ca
					ON ca.family_id = al.family_id AND ca.child_id = al.child_id
					AND ca.activity_id = al.activity_id
				WHERE al.family_id = ${tenantId} AND al.child_id = ${childId}
					AND al.recorded_date = ${date} AND al.cancelled = false
			`);
			return (result.rows as { activity_id: string; category_id: string }[]).map((r) => ({
				activityId: asActivityId(r.activity_id),
				categoryId: asCategoryId(r.category_id),
			}));
		},

		async getComboPointsGranted(childId, descriptionPrefix, tenantId) {
			const result = await db.execute(sql`
				SELECT coalesce(sum(amount), 0)::int AS c FROM point_ledger
				WHERE family_id = ${tenantId} AND child_id = ${childId}
					AND type = 'combo_bonus' AND description LIKE ${`${descriptionPrefix}%`}
			`);
			return scalarCount(result);
		},

		async countActiveActivityLogsByCategory(childId, categoryId, tenantId) {
			const result = await db.execute(sql`
				SELECT count(*)::int AS c
				FROM activity_logs al
				INNER JOIN child_activities ca
					ON ca.family_id = al.family_id AND ca.child_id = al.child_id
					AND ca.activity_id = al.activity_id
				WHERE al.family_id = ${tenantId} AND al.child_id = ${childId}
					AND al.cancelled = false AND ca.category_id = ${categoryId}
			`);
			return scalarCount(result);
		},

		async countPointLedgerEntriesByType(childId, type, tenantId) {
			const result = await db.execute(sql`
				SELECT count(*)::int AS c FROM point_ledger
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND type = ${type}
			`);
			return scalarCount(result);
		},

		async countPointLedgerEntriesByTypeAndDate(childId, type, date, tenantId) {
			// recorded_date 冪等 lookup (§11.2 H21、secondary (family,child,type,recorded_date) covering)。
			const result = await db.execute(sql`
				SELECT count(*)::int AS c FROM point_ledger
				WHERE family_id = ${tenantId} AND child_id = ${childId}
					AND type = ${type} AND recorded_date = ${date}
			`);
			return scalarCount(result);
		},

		async sumPointLedgerByTypeAndDescriptionPrefix(childId, type, descriptionPrefix, tenantId) {
			// #4686: type × description 前方一致の付与合計 (正負込み)。getComboPointsGranted の type 汎用版。
			const result = await db.execute(sql`
				SELECT coalesce(sum(amount), 0)::int AS c FROM point_ledger
				WHERE family_id = ${tenantId} AND child_id = ${childId}
					AND type = ${type} AND description LIKE ${`${descriptionPrefix}%`}
			`);
			return scalarCount(result);
		},

		async findMustActivitiesWithToday(childId, today, tenantId) {
			// LEFT JOIN 1 クエリ集計 (§3.5.5 — sqlite の 2 クエリ + app 側 Set 合成にしない)。
			// GROUP BY は PK (family,child,activity) で functional dependency 充足だが、
			// 非集約選択列を明示して方言差の解釈余地を残さない。
			const result = await db.execute(sql`
				SELECT ca.activity_id, ca.name, ca.icon,
					CASE WHEN count(al.log_id) > 0 THEN 1 ELSE 0 END AS logged_today
				FROM child_activities ca
				LEFT JOIN activity_logs al
					ON al.family_id = ca.family_id AND al.child_id = ca.child_id
					AND al.activity_id = ca.activity_id
					AND al.recorded_date = ${today} AND al.cancelled = false
				WHERE ca.family_id = ${tenantId} AND ca.child_id = ${childId}
					AND ca.priority = 'must' AND ca.is_visible = true AND ca.is_archived = false
				GROUP BY ca.activity_id, ca.name, ca.icon, ca.sort_order, ca.created_at
				ORDER BY ca.sort_order, ca.created_at, ca.activity_id
			`);
			const activities = (
				result.rows as { activity_id: string; name: string; icon: string; logged_today: number }[]
			).map((r) => ({
				id: asActivityId(r.activity_id),
				name: r.name,
				icon: r.icon,
				loggedToday: Number(r.logged_today),
			}));
			return {
				logged: activities.filter((a) => a.loggedToday === 1).length,
				total: activities.length,
				activities,
			};
		},

		// ── archive / restore (#783) ──

		async archiveActivities(ids, reason, tenantId) {
			if (ids.length === 0) return;
			await db.execute(sql`
				UPDATE child_activities SET is_archived = true, archived_reason = ${reason}
				WHERE family_id = ${tenantId} AND activity_id IN (${sql.join(
					ids.map((id) => sql`${id}`),
					sql`, `,
				)})
			`);
		},

		async restoreArchivedActivities(reason, tenantId) {
			await db.execute(sql`
				UPDATE child_activities SET is_archived = false, archived_reason = NULL
				WHERE family_id = ${tenantId} AND is_archived = true AND archived_reason = ${reason}
			`);
		},

		// ── Point Ledger ──

		async insertPointLedger(input, tenantId) {
			// reset-plan 決定#3: point 書込は単一プリミティブ (point-write.ts) に一本化。
			// insertPointLedger は付与用エイリアスとして writer に委譲し戻り値を捨てる
			// (INSERT + total_point 加算のコピーを DSQL backend に 2 つ持たない)。
			await insertPointEntry(input, tenantId);
		},

		// ── Retention cleanup (#717, #729) ──

		async deleteActivityLogsBeforeDate(childId, cutoffDate, tenantId) {
			// strict less than: cutoffDate 当日は削除対象に含まない (interface 契約)。
			// #3625: 削除件数は CTE で DB 側 count 集約し、削除全行を client に materialize しない。
			const result = await db.execute(sql`
				WITH deleted AS (
					DELETE FROM activity_logs
					WHERE family_id = ${tenantId} AND child_id = ${childId}
						AND recorded_date < ${cutoffDate}
					RETURNING 1
				)
				SELECT count(*)::int AS c FROM deleted
			`);
			return Number((result.rows[0] as { c: number }).c);
		},
	};
}
