// src/lib/server/db/dsql/child-activity-repo.ts
// EPIC #3424 / PR-R3 (repo 層 build order §12.2.1) / 設計 SSOT: dsql-data-model.md §11.2 / §3 / §P9
//
// IChildActivityRepo の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8: module-level db/client import 禁止)。db (SqlExecutor) と
//     TransactionRunner を呼び出し側 (将来の client factory / テスト) が渡す。
//   - **§P9 tenant 述語**: 全メソッドが family_id = tenantId を WHERE に含む。findActivityById /
//     update / delete は (family_id, child_id, activity_id) の 3 軸 = PK 完全一致で cross-child
//     access を構造的に防ぐ (ADR-0055 §3.1)。
//   - entity 境界: isVisible / isMainQuest / isArchived は number (0/1) 契約 — boolean 列を
//     読み出し時に変換 (既存 sqlite backend と同一 shape、child-repo.ts toChild と同型)。
//   - record 系 hot path (recordActivityCore) は record-activity-core.ts が正 — 本 repo は
//     CRUD / 検索系のみ (重複実装しない)。
//   - insertActivitiesBulk は単一 txn (取込の per-child 配信を all-or-nothing に)。work 内
//     await は tx.execute(...) 直呼びのみ (fitness#7、SQL 構築 helper は await しない)。
//   - sqlite parity: findActivitiesByChild は sort_order 順 (同値は created_at, activity_id で
//     安定化)。#4694: 兄弟 copy (重複 skip 含む) は service 層 (child-activity-copy-service)
//     に一本化したため、本 repo は copy 専用 method を持たない。

import { sql } from 'drizzle-orm';
import { ACTIVITY_SOURCES } from '$lib/domain/activity-source';
import { asActivityId, asCategoryId, asChildId } from '$lib/domain/ids';
import type { IChildActivityRepo } from '../interfaces/child-activity-repo.interface';
import type { TransactionRunner } from '../interfaces/transaction.interface';
import type {
	ActivityPriority,
	ChildActivity,
	InsertChildActivityInput,
	UpdateChildActivityInput,
} from '../types';
import { createDsqlChildRepo } from './child-repo';
import type { SqlExecutor } from './sql-executor';

export interface ChildActivityRow {
	family_id: string;
	child_id: string;
	activity_id: string;
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

/** child_activities の SELECT 列 (daily-mission repo の findVisibleActivities も共有、二重管理禁止)。 */
export const ACTIVITY_COLUMNS = sql.raw(
	`family_id, child_id, activity_id, name, category_id, icon, base_points, is_visible,
	 daily_limit, sort_order, source, name_kana, name_kanji, trigger_hint, is_main_quest,
	 is_archived, archived_reason, source_preset_id, priority, created_at`,
);

/** row → ChildActivity entity (boolean → 0/1 数値契約 = sqlite 互換 shape)。
 * daily-mission repo の findVisibleActivities からも共有する (mapping 二重実装禁止)。 */
export function toChildActivity(row: ChildActivityRow): ChildActivity {
	return {
		id: asActivityId(row.activity_id),
		childId: asChildId(row.child_id),
		name: row.name,
		categoryId: asCategoryId(row.category_id),
		icon: row.icon,
		basePoints: row.base_points,
		isVisible: row.is_visible ? 1 : 0,
		dailyLimit: row.daily_limit,
		sortOrder: row.sort_order,
		source: row.source,
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

/**
 * INSERT 文を構築する (insertActivity / insertActivitiesBulk で共有)。
 * `source` 列は input.source を persist し、省略時は 'seed' (schema default 同値、sqlite parity)。
 * #3669: 旧実装は source を指定せず全経路が 'seed' に落ち、親手動作成 'custom' が
 * quota 集計から漏れていた。
 */
function buildInsertSql(input: InsertChildActivityInput, tenantId: string) {
	return sql`
		INSERT INTO child_activities
			(family_id, child_id, name, category_id, icon, base_points, trigger_hint, is_main_quest,
			 source_preset_id, priority, is_visible, sort_order, is_archived, archived_reason,
			 daily_limit, name_kana, name_kanji, source)
		VALUES (${tenantId}, ${input.childId}, ${input.name}, ${input.categoryId}, ${input.icon},
			${input.basePoints}, ${input.triggerHint ?? null}, ${(input.isMainQuest ?? 0) !== 0},
			${input.sourcePresetId ?? null}, ${input.priority ?? 'optional'},
			${(input.isVisible ?? 1) !== 0}, ${input.sortOrder ?? 0}, ${(input.isArchived ?? 0) !== 0},
			${input.archivedReason ?? null}, ${input.dailyLimit ?? null}, ${input.nameKana ?? null},
			${input.nameKanji ?? null}, ${input.source ?? ACTIVITY_SOURCES.seed.value})
		RETURNING ${ACTIVITY_COLUMNS}
	`;
}

/** UpdateChildActivityInput → SET 句 (undefined field は不変 = 部分更新契約)。 */
function buildUpdateSets(input: UpdateChildActivityInput) {
	const sets: ReturnType<typeof sql>[] = [];
	if (input.name !== undefined) sets.push(sql`name = ${input.name}`);
	if (input.categoryId !== undefined) sets.push(sql`category_id = ${input.categoryId}`);
	if (input.icon !== undefined) sets.push(sql`icon = ${input.icon}`);
	if (input.basePoints !== undefined) sets.push(sql`base_points = ${input.basePoints}`);
	if (input.triggerHint !== undefined) sets.push(sql`trigger_hint = ${input.triggerHint}`);
	if (input.isMainQuest !== undefined) sets.push(sql`is_main_quest = ${input.isMainQuest !== 0}`);
	if (input.priority !== undefined) sets.push(sql`priority = ${input.priority}`);
	if (input.dailyLimit !== undefined) sets.push(sql`daily_limit = ${input.dailyLimit}`);
	if (input.nameKana !== undefined) sets.push(sql`name_kana = ${input.nameKana}`);
	if (input.nameKanji !== undefined) sets.push(sql`name_kanji = ${input.nameKanji}`);
	return sets;
}

/** DSQL 用 IChildActivityRepo を生成する (db/runner は注入、fitness#8)。 */
export function createDsqlChildActivityRepo<TTx extends SqlExecutor>(
	db: SqlExecutor,
	runner: TransactionRunner<TTx>,
): IChildActivityRepo {
	// findChildById convenience は child-repo の compute-on-read 契約 (§11.1) へ委譲する
	// (age / ui_mode 導出ロジックの二重実装を避ける)。
	const childRepo = createDsqlChildRepo(db, runner);

	const insertActivitiesBulk = async (
		inputs: InsertChildActivityInput[],
		tenantId: string,
	): Promise<ChildActivity[]> => {
		if (inputs.length === 0) return [];
		// 取込の per-child 配信を all-or-nothing に (§8)。work 内 await は tx.execute 直呼びのみ
		// (fitness#7。buildInsertSql は同期の SQL 構築で await しない)。
		return runner.runInTransaction(async (tx) => {
			const created: ChildActivity[] = [];
			for (const input of inputs) {
				const result = await tx.execute(buildInsertSql(input, tenantId));
				created.push(toChildActivity(result.rows[0] as unknown as ChildActivityRow));
			}
			return created;
		});
	};

	const findActivitiesByChild: IChildActivityRepo['findActivitiesByChild'] = async (
		childId,
		tenantId,
		options,
	) => {
		const tenantConditions = [sql`family_id = ${tenantId}`, sql`child_id = ${childId}`];
		if (!options?.includeArchived) tenantConditions.push(sql`is_archived = false`);
		if (options?.visibleOnly) tenantConditions.push(sql`is_visible = true`);
		const result = await db.execute(sql`
			SELECT ${ACTIVITY_COLUMNS} FROM child_activities
			WHERE ${sql.join(tenantConditions, sql` AND `)}
			ORDER BY sort_order, created_at, activity_id
		`);
		return (result.rows as unknown as ChildActivityRow[]).map(toChildActivity);
	};

	return {
		findActivitiesByChild,

		async findActivityById(id, childId, tenantId) {
			const result = await db.execute(sql`
				SELECT ${ACTIVITY_COLUMNS} FROM child_activities
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND activity_id = ${id}
			`);
			const row = result.rows[0] as unknown as ChildActivityRow | undefined;
			return row ? toChildActivity(row) : undefined;
		},

		async countMainQuestActivities(childId, tenantId) {
			const result = await db.execute(sql`
				SELECT count(*)::int AS c FROM child_activities
				WHERE family_id = ${tenantId} AND child_id = ${childId}
					AND is_main_quest = true AND is_visible = true AND is_archived = false
			`);
			return Number((result.rows[0] as { c: number }).c);
		},

		async insertActivity(input, tenantId) {
			const result = await db.execute(buildInsertSql(input, tenantId));
			return toChildActivity(result.rows[0] as unknown as ChildActivityRow);
		},

		insertActivitiesBulk,

		async updateActivity(id, childId, input, tenantId) {
			const sets = buildUpdateSets(input);
			if (sets.length === 0) return this.findActivityById(id, childId, tenantId);
			const result = await db.execute(sql`
				UPDATE child_activities SET ${sql.join(sets, sql`, `)}
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND activity_id = ${id}
				RETURNING ${ACTIVITY_COLUMNS}
			`);
			const row = result.rows[0] as unknown as ChildActivityRow | undefined;
			return row ? toChildActivity(row) : undefined;
		},

		async setActivityVisibility(id, childId, visible, tenantId) {
			const result = await db.execute(sql`
				UPDATE child_activities SET is_visible = ${visible}
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND activity_id = ${id}
				RETURNING ${ACTIVITY_COLUMNS}
			`);
			const row = result.rows[0] as unknown as ChildActivityRow | undefined;
			return row ? toChildActivity(row) : undefined;
		},

		async deleteActivity(id, childId, tenantId) {
			const result = await db.execute(sql`
				DELETE FROM child_activities
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND activity_id = ${id}
				RETURNING ${ACTIVITY_COLUMNS}
			`);
			const row = result.rows[0] as unknown as ChildActivityRow | undefined;
			return row ? toChildActivity(row) : undefined;
		},

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

		async findChildById(id, tenantId) {
			return childRepo.findChildById(id, tenantId);
		},
	};
}
