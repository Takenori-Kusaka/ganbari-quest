// src/lib/server/db/dsql/derived-drift.ts
// EPIC #3424 / 実装 #3539 (#N4-1 Phase C) / 設計 SSOT: dsql-data-model.md §5(P7) / §13.1 fitness#14
//
// fitness#14 (reset-plan 決定#4 で再定義): 「書込増分整合検証」helper。
// children.total_point == SUM(point_ledger.amount) を突合する。
//   - **本番正しさの正本は「単一プリミティブ (point-write.ts) + 同一 txn `+= amount`」の構造担保**。
//     total_point == SUM は「pruning が起きていない」前提でのみ成立する不変条件であり、
//     retention (deletePointLedgerBeforeDate) で古い明細を削除すると SUM < total_point に
//     なる (carryover 廃止、reset-plan 決定#4)。
//   - したがって本関数は **本番の残高監視バッチではなく、テスト時 (非 pruning) の書込増分整合を
//     検証する helper** に再定義された。pruning を経た child に対して呼ぶと false-positive に
//     なるため、テストは pruning 前 / 非 pruning の scope でのみ assert する。
// ⚠️ optional 欠落 (ledger 行自体が無い) は drift に現れない — fitness#11 欠落カウンタが補完。
//
// statuses.total_xp / activity_logs.streak_days の突合は #N4-2 (recordActivity 原子化) で
// 実書込経路が生えた後に同型で拡張する。

import { sql } from 'drizzle-orm';
import type { SqlExecutor } from './sql-executor';

export interface TotalPointDrift {
	familyId: string;
	childId: string;
	/** 派生列の現在値 (正本)。 */
	totalPoint: number;
	/** point_ledger の実 SUM (突合値)。 */
	ledgerSum: number;
}

interface DriftRow {
	family_id: string;
	child_id: string;
	total_point: number;
	ledger_sum: string | number; // SUM は bigint で返る driver がある
}

/** total_point と ledger SUM が乖離している child を列挙する (乖離 0 件が正常)。 */
export async function findTotalPointDrift(executor: SqlExecutor): Promise<TotalPointDrift[]> {
	const result = await executor.execute(sql`
		SELECT c.family_id, c.child_id, c.total_point,
			COALESCE(SUM(l.amount), 0) AS ledger_sum
		FROM children c
		LEFT JOIN point_ledger l
			ON l.family_id = c.family_id AND l.child_id = c.child_id
		GROUP BY c.family_id, c.child_id, c.total_point
		HAVING c.total_point <> COALESCE(SUM(l.amount), 0)
	`);
	return (result.rows as DriftRow[]).map((r) => ({
		familyId: r.family_id,
		childId: r.child_id,
		totalPoint: r.total_point,
		ledgerSum: Number(r.ledger_sum),
	}));
}
