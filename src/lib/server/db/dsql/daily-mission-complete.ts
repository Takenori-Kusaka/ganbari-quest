// src/lib/server/db/dsql/daily-mission-complete.ts
// EPIC #3424 / 実装 #3541 (#N4-2 Phase C cycle 2) / 設計 SSOT: dsql-data-model.md §8 / §13.1 fitness#10
//
// fitness#10 (TOCTOU / double-award 防止): mission bonus の point_ledger は unique 制約が
// 無いため、count-then-insert 方式は double-tap / OCC 下で二重付与する (fitness#14 の
// total_point 突合は self-consistent で検出不能)。本実装は once-per-day 系の正攻法として
// **daily_missions の自然複合 PK 行 (§11.2 凍結: family, child, mission_date, activity_id)
// への conditional UPDATE (completed = false → true) を serialization point** にする:
//   - 同一 mission への並行/二連打は同一行 write-write → DSQL は片方 40001 (runner retry 後
//     rowCount=0) / SQLite は IMMEDIATE 直列化 → **遷移はちょうど 1 回**
//   - daily bonus は「未完了残 0 を同 txn 内で確認した、最後の 1 件を flip した txn」だけが
//     付与 → 全 mission 完了 bonus も exactly-once
//   - bonus (ledger + total_point) をフラグ遷移と同一 txn にする = 「フラグだけ立って
//     bonus 消失」「bonus だけ入ってフラグ未遷移」の両方を排除

import { sql } from 'drizzle-orm';
import type { TransactionRunner } from '../interfaces/transaction.interface';
import type { SqlExecutor } from './sql-executor';

export interface CompleteMissionInput {
	familyId: string;
	childId: string;
	/** 'YYYY-MM-DD'。 */
	missionDate: string;
	activityId: string;
	/** 全 mission 完了時に付与する daily bonus (point_ledger type='mission_bonus')。 */
	bonusPoints: number;
	bonusDescription: string;
	/** ISO 8601 (呼び出し側注入)。 */
	now: string;
}

export interface CompleteMissionResult {
	/** 本呼び出しで completed に遷移したか (false = 既に完了済 or mission 不在)。 */
	completedNow: boolean;
	/** 本 txn 終了時点で当日の全 mission が完了しているか。 */
	allComplete: boolean;
	/** 本呼び出しが daily bonus を付与したか (最後の 1 件を flip した txn のみ true)。 */
	bonusGranted: boolean;
}

/** mission 完了遷移 + 全完了 daily bonus を単一 txn で行う (fitness#10 exactly-once)。 */
export async function completeMissionAndMaybeGrantBonus<TTx extends SqlExecutor>(
	runner: TransactionRunner<TTx>,
	input: CompleteMissionInput,
): Promise<CompleteMissionResult> {
	const { familyId, childId, missionDate, activityId, bonusPoints, bonusDescription, now } = input;
	return runner.runInTransaction(async (tx) => {
		// serialization point: completed=false の行だけが遷移できる (二連打の 2 回目は rowCount 0)。
		const flipped = await tx.execute(sql`
			UPDATE daily_missions SET completed = true, completed_at = ${now}
			WHERE family_id = ${familyId} AND child_id = ${childId}
				AND mission_date = ${missionDate} AND activity_id = ${activityId}
				AND completed = false
			RETURNING activity_id
		`);
		const completedNow = flipped.rows.length > 0;

		// 同 txn 内で未完了残を確認 (自 txn の UPDATE は可視)。
		const remaining = await tx.execute(sql`
			SELECT count(*) AS c FROM daily_missions
			WHERE family_id = ${familyId} AND child_id = ${childId}
				AND mission_date = ${missionDate} AND completed = false
		`);
		const allComplete = Number((remaining.rows[0] as { c: unknown }).c) === 0;

		// bonus は「本呼び出しが最後の 1 件を flip した」場合のみ (exactly-once)。
		const bonusGranted = completedNow && allComplete;
		if (bonusGranted) {
			await tx.execute(sql`
				INSERT INTO point_ledger (family_id, child_id, amount, type, description, reference_id, recorded_date, created_at)
				VALUES (${familyId}, ${childId}, ${bonusPoints}, 'mission_bonus', ${bonusDescription}, ${null}, ${missionDate}, ${now})
			`);
			// §5 P7: optional の point 付与も total_point を同一 txn 共更新 (fitness#14 整合)。
			await tx.execute(sql`
				UPDATE children SET total_point = total_point + ${bonusPoints}, updated_at = ${now}
				WHERE family_id = ${familyId} AND child_id = ${childId}
			`);
		}

		return { completedNow, allComplete, bonusGranted };
	});
}
