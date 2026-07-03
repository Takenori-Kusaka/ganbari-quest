// src/lib/server/db/dsql/derived-drift.ts
// EPIC #3424 / 実装 #3539 (#N4-1 Phase C) / 設計 SSOT: dsql-data-model.md §5(P7) / §13.1 fitness#14
//
// 派生列 drift 突合 (fitness#14): children.total_point == SUM(point_ledger.amount)。
// 正本は派生列 (§5: 全 point_ledger 書込は同一 mini-txn で total_point を共更新 = 乖離不能設計)。
// 本関数はバッチで不変条件の破れを検出する (F2)。乖離 0 が正常、検出時は書込経路のバグ。
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
