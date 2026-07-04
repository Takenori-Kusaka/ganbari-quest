// src/lib/server/db/dsql/activity-pref-repo.ts
// EPIC #3424 / PR-R3 (repo 層 build order §12.2.1) / 設計 SSOT: dsql-data-model.md §11.2 / §P9
//
// IActivityPrefRepo の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8) + **§P9 tenant 述語** (全メソッド family_id = tenantId)。
//   - child_activity_preferences は自然複合 PK (family_id, child_id, activity_id) で surrogate id
//     列を持たない (§11.2 凍結)。entity の `id: string` は `${child_id}:${activity_id}` を
//     決定的に合成する (呼び出し側は id を lookup key に使っていない — opaque token 契約)。
//   - togglePin(pinned=true) は「MAX(pin_order)+1 読取 → upsert」を単一 txn で行う
//     (sqlite は同期ドライバで暗黙直列、DSQL は txn + OCC retry が同等の serialization point)。
//     work 内 await は tx.execute(...) 直呼びのみ (fitness#7)。
//   - upsert は複合 PK への ON CONFLICT DO UPDATE (record-activity-core.ts と同型)。
//   - sqlite parity: findAllByChild の並びは pin_order ASC で NULL 先頭 (SQLite の NULL 順)。
//     Postgres 既定 (NULLS LAST) と異なるため NULLS FIRST を明示する。

import { sql } from 'drizzle-orm';
import { asActivityId, asChildId } from '$lib/domain/ids';
import type { IActivityPrefRepo } from '../interfaces/activity-pref-repo.interface';
import type { TransactionRunner } from '../interfaces/transaction.interface';
import type { ChildActivityPreference } from '../types';
import type { SqlExecutor } from './sql-executor';

interface PrefRow {
	family_id: string;
	child_id: string;
	activity_id: string;
	is_pinned: boolean;
	pin_order: number | null;
	created_at: string;
	updated_at: string;
}

const PREF_COLUMNS = sql.raw(
	'family_id, child_id, activity_id, is_pinned, pin_order, created_at, updated_at',
);

/** row → entity (surrogate id 無しのため複合 PK から決定的合成、boolean → 0/1 契約)。 */
function toPref(row: PrefRow): ChildActivityPreference {
	return {
		id: `${row.child_id}:${row.activity_id}`,
		childId: asChildId(row.child_id),
		activityId: asActivityId(row.activity_id),
		isPinned: row.is_pinned ? 1 : 0,
		pinOrder: row.pin_order,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/** DSQL 用 IActivityPrefRepo を生成する (db/runner は注入、fitness#8)。 */
export function createDsqlActivityPrefRepo<TTx extends SqlExecutor>(
	db: SqlExecutor,
	runner: TransactionRunner<TTx>,
): IActivityPrefRepo {
	return {
		async findAllByChild(childId, tenantId) {
			const result = await db.execute(sql`
				SELECT ${PREF_COLUMNS} FROM child_activity_preferences
				WHERE family_id = ${tenantId} AND child_id = ${childId}
				ORDER BY pin_order NULLS FIRST, created_at, activity_id
			`);
			return (result.rows as unknown as PrefRow[]).map(toPref);
		},

		async insertForRestore(input, tenantId) {
			// #3329: isPinned/pinOrder/日時を verbatim 書き戻す (togglePin の再採番を経由しない)。
			// 複合 PK 重複は 23505 throw のまま呼び出し側契約 (restore 先は新規 child 前提)。
			const result = await db.execute(sql`
				INSERT INTO child_activity_preferences
					(family_id, child_id, activity_id, is_pinned, pin_order, created_at, updated_at)
				VALUES (${tenantId}, ${input.childId}, ${input.activityId}, ${input.isPinned !== 0},
					${input.pinOrder}, ${input.createdAt}, ${input.updatedAt})
				RETURNING ${PREF_COLUMNS}
			`);
			return toPref(result.rows[0] as unknown as PrefRow);
		},

		async findPinnedByChild(childId, tenantId) {
			const result = await db.execute(sql`
				SELECT ${PREF_COLUMNS} FROM child_activity_preferences
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND is_pinned = true
				ORDER BY pin_order, activity_id
			`);
			return (result.rows as unknown as PrefRow[]).map(toPref);
		},

		async togglePin(childId, activityId, pinned, tenantId) {
			if (pinned) {
				// MAX+1 採番と upsert を単一 txn で (並行 pin の採番衝突は OCC retry が解消、§8)。
				return runner.runInTransaction(async (tx) => {
					const maxRead = await tx.execute(sql`
						SELECT COALESCE(MAX(pin_order), 0)::int AS max_order FROM child_activity_preferences
						WHERE family_id = ${tenantId} AND child_id = ${childId} AND is_pinned = true
					`);
					const nextOrder = Number((maxRead.rows[0] as { max_order: number }).max_order) + 1;
					const result = await tx.execute(sql`
						INSERT INTO child_activity_preferences
							(family_id, child_id, activity_id, is_pinned, pin_order)
						VALUES (${tenantId}, ${childId}, ${activityId}, true, ${nextOrder})
						ON CONFLICT (family_id, child_id, activity_id)
						DO UPDATE SET is_pinned = true, pin_order = ${nextOrder}, updated_at = now()
						RETURNING ${PREF_COLUMNS}
					`);
					return toPref(result.rows[0] as unknown as PrefRow);
				});
			}
			// ピン解除 (未存在なら isPinned=0 で作成 = sqlite parity)。単文 upsert で txn 不要。
			const result = await db.execute(sql`
				INSERT INTO child_activity_preferences
					(family_id, child_id, activity_id, is_pinned, pin_order)
				VALUES (${tenantId}, ${childId}, ${activityId}, false, NULL)
				ON CONFLICT (family_id, child_id, activity_id)
				DO UPDATE SET is_pinned = false, pin_order = NULL, updated_at = now()
				RETURNING ${PREF_COLUMNS}
			`);
			return toPref(result.rows[0] as unknown as PrefRow);
		},

		async countPinnedInCategory(childId, categoryId, tenantId) {
			// JOIN は child_activities の PK (family, child, activity) 完全一致 (§P9 越境不能)。
			const result = await db.execute(sql`
				SELECT count(*)::int AS c
				FROM child_activity_preferences p
				JOIN child_activities a
					ON a.family_id = p.family_id AND a.child_id = p.child_id AND a.activity_id = p.activity_id
				WHERE p.family_id = ${tenantId} AND p.child_id = ${childId}
					AND p.is_pinned = true AND a.category_id = ${categoryId}
			`);
			return Number((result.rows[0] as { c: number }).c);
		},

		async getUsageCounts(childId, sinceDate, tenantId) {
			const result = await db.execute(sql`
				SELECT activity_id, count(*)::int AS usage_count FROM activity_logs
				WHERE family_id = ${tenantId} AND child_id = ${childId}
					AND recorded_date >= ${sinceDate} AND cancelled = false
				GROUP BY activity_id
			`);
			return (result.rows as { activity_id: string; usage_count: number }[]).map((r) => ({
				activityId: asActivityId(r.activity_id),
				usageCount: Number(r.usage_count),
			}));
		},

		async deleteByTenantId(tenantId) {
			await db.execute(sql`DELETE FROM child_activity_preferences WHERE family_id = ${tenantId}`);
		},
	};
}
