// src/lib/server/db/dsql/grant-optional-points.ts
// EPIC #3424 / 実装 #3541 (#N4-2 Phase C cycle 2) / 設計 SSOT: dsql-data-model.md §8 / §5(P7)
//
// optional (combo / mission / challenge / reward 等) の point 付与プリミティブ。
// §8: optional は core commit 後の独立 mini-txn だが、**各 mini-txn 内で
// point_ledger INSERT + children.total_point 加算を 1 txn** にする (§5 P7 の
// 「全ての point_ledger 書込は total_point を同一 txn 共更新」不変条件を
// core/optional 問わず維持 → fitness#14 findTotalPointDrift が 0 drift)。
//
// 対象 child が存在しない場合は throw (ledger だけ書けて total_point 更新先が無い
// 片肺書込を禁止 — mini-txn ごと rollback される)。

import { sql } from 'drizzle-orm';
import type { TransactionRunner } from '../interfaces/transaction.interface';
import type { SqlExecutor } from './sql-executor';

export interface GrantOptionalPointsInput {
	familyId: string;
	childId: string;
	amount: number;
	/** point_ledger.type ('combo_bonus' / 'mission_bonus' 等)。 */
	type: string;
	description: string;
	referenceId: string | null;
	/** 'YYYY-MM-DD'。 */
	recordedDate: string;
	/** ISO 8601 (呼び出し側注入)。 */
	now: string;
}

/** optional point 付与 = ledger INSERT + total_point 加算の独立 mini-txn。 */
export async function grantOptionalPoints<TTx extends SqlExecutor>(
	runner: TransactionRunner<TTx>,
	input: GrantOptionalPointsInput,
): Promise<void> {
	const { familyId, childId, amount, type, description, referenceId, recordedDate, now } = input;
	await runner.runInTransaction(async (tx) => {
		await tx.execute(sql`
			INSERT INTO point_ledger (family_id, child_id, amount, type, description, reference_id, recorded_date, created_at)
			VALUES (${familyId}, ${childId}, ${amount}, ${type}, ${description}, ${referenceId}, ${recordedDate}, ${now})
		`);
		const updated = await tx.execute(sql`
			UPDATE children SET total_point = total_point + ${amount}, updated_at = ${now}
			WHERE family_id = ${familyId} AND child_id = ${childId}
			RETURNING child_id
		`);
		if (updated.rows.length === 0) {
			// child 不在 = total_point 共更新不能。throw で mini-txn ごと rollback (§5 P7)。
			throw new Error(`grantOptionalPoints: child not found (${familyId}/${childId})`);
		}
	});
}
