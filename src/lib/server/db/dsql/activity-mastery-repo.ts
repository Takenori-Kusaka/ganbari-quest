// src/lib/server/db/dsql/activity-mastery-repo.ts
// EPIC #3424 / PR-R3 (repo 層 build order §12.2.1) / 設計 SSOT: dsql-data-model.md §11.2 / §P9
//
// IActivityMasteryRepo の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8) + **§P9 tenant 述語** (全メソッド family_id = tenantId)。
//   - activity_mastery は自然複合 PK (family_id, child_id, activity_id) で surrogate id 列を
//     持たない (§11.2 凍結、#3541)。entity の `id: string` は `${child_id}:${activity_id}` を
//     決定的に合成する (opaque token 契約、lookup key には使われない)。
//   - upsert は複合 PK への単文 ON CONFLICT DO UPDATE (record-activity-core.ts ② と同型。
//     sqlite の read-then-write と異なり atomic で txn 不要)。
//   - record txn 内の mastery 共更新 (count+1 / level 再計算) は record-activity-core.ts が正 —
//     本 repo の upsert は呼び出し側が算出済みの totalCount/level を書く CRUD 契約。

import { sql } from 'drizzle-orm';
import { asActivityId, asChildId } from '$lib/domain/ids';
import type { IActivityMasteryRepo } from '../interfaces/activity-mastery-repo.interface';
import type { TransactionRunner } from '../interfaces/transaction.interface';
import type { ActivityMastery } from '../types';
import type { SqlExecutor } from './sql-executor';

interface MasteryRow {
	family_id: string;
	child_id: string;
	activity_id: string;
	total_count: number;
	level: number;
	updated_at: string;
}

const MASTERY_COLUMNS = sql.raw('family_id, child_id, activity_id, total_count, level, updated_at');

/** row → entity (surrogate id 無しのため複合 PK から決定的合成)。 */
function toMastery(row: MasteryRow): ActivityMastery {
	return {
		id: `${row.child_id}:${row.activity_id}`,
		childId: asChildId(row.child_id),
		activityId: asActivityId(row.activity_id),
		totalCount: row.total_count,
		level: row.level,
		updatedAt: row.updated_at,
	};
}

/** DSQL 用 IActivityMasteryRepo を生成する (db/runner は注入、fitness#8。
 * 全メソッド単文で txn 不要のため runner は現状未使用だが factory 契約で受ける)。 */
export function createDsqlActivityMasteryRepo<TTx extends SqlExecutor>(
	db: SqlExecutor,
	_runner: TransactionRunner<TTx>,
): IActivityMasteryRepo {
	return {
		async findByChildAndActivity(childId, activityId, tenantId) {
			const result = await db.execute(sql`
				SELECT ${MASTERY_COLUMNS} FROM activity_mastery
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND activity_id = ${activityId}
			`);
			const row = result.rows[0] as unknown as MasteryRow | undefined;
			return row ? toMastery(row) : undefined;
		},

		async findAllByChild(childId, tenantId) {
			const result = await db.execute(sql`
				SELECT ${MASTERY_COLUMNS} FROM activity_mastery
				WHERE family_id = ${tenantId} AND child_id = ${childId}
				ORDER BY activity_id
			`);
			return (result.rows as unknown as MasteryRow[]).map(toMastery);
		},

		async upsert(childId, activityId, totalCount, level, tenantId) {
			// #3592 ①: CRUD 契約 (呼び出し側算出値を書く) の最小 write-value guard。
			// service 層 (activity-log-service / record-activity-core) は count+1 / masteryLevelFor で
			// 常に非負整数を算出するが、facade 直呼び等の不正値注入・監査証跡欠落に対する repo 層の
			// 最終防衛線として非負整数を強制する (cutover 後に service validate 前提が崩れても不変)。
			if (!Number.isInteger(totalCount) || totalCount < 0) {
				throw new Error(`upsert: totalCount は非負整数 (got ${totalCount})`);
			}
			if (!Number.isInteger(level) || level < 0) {
				throw new Error(`upsert: level は非負整数 (got ${level})`);
			}
			const result = await db.execute(sql`
				INSERT INTO activity_mastery (family_id, child_id, activity_id, total_count, level)
				VALUES (${tenantId}, ${childId}, ${activityId}, ${totalCount}, ${level})
				ON CONFLICT (family_id, child_id, activity_id)
				DO UPDATE SET total_count = ${totalCount}, level = ${level}, updated_at = now()
				RETURNING ${MASTERY_COLUMNS}
			`);
			return toMastery(result.rows[0] as unknown as MasteryRow);
		},

		async deleteByTenantId(tenantId) {
			await db.execute(sql`DELETE FROM activity_mastery WHERE family_id = ${tenantId}`);
		},
	};
}
