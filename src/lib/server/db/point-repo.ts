// src/lib/server/db/point-repo.ts
// ポイント関連のリポジトリ層

import { eq, desc, sum } from 'drizzle-orm';
import { db } from './client';
import { pointLedger, children } from './schema';

/** ポイント残高を取得（point_ledgerのamount合計） */
export function getBalance(childId: number): number {
	const result = db
		.select({ total: sum(pointLedger.amount) })
		.from(pointLedger)
		.where(eq(pointLedger.childId, childId))
		.get();

	return Number(result?.total ?? 0);
}

/** ポイント履歴を取得 */
export function findPointHistory(
	childId: number,
	options: { limit: number; offset: number },
) {
	return db
		.select()
		.from(pointLedger)
		.where(eq(pointLedger.childId, childId))
		.orderBy(desc(pointLedger.createdAt))
		.limit(options.limit)
		.offset(options.offset)
		.all();
}

/** ポイント台帳にエントリを挿入 */
export function insertPointEntry(input: {
	childId: number;
	amount: number;
	type: string;
	description: string;
	referenceId?: number;
}) {
	return db.insert(pointLedger).values(input).returning().get();
}

/** 子供の存在確認 */
export function findChildById(id: number) {
	return db.select().from(children).where(eq(children.id, id)).get();
}
