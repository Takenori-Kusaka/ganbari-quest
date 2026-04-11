// src/lib/server/db/point-repo.ts
// ポイント関連のリポジトリ層

import { and, desc, eq, lt, sum } from 'drizzle-orm';
import { db } from '../client';
import { children, pointLedger } from '../schema';

/** ポイント残高を取得（point_ledgerのamount合計） */
export async function getBalance(childId: number, _tenantId: string): Promise<number> {
	const result = db
		.select({ total: sum(pointLedger.amount) })
		.from(pointLedger)
		.where(eq(pointLedger.childId, childId))
		.get();

	return Number(result?.total ?? 0);
}

/** ポイント履歴を取得 */
export async function findPointHistory(
	childId: number,
	options: { limit: number; offset: number },
	_tenantId: string,
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
export async function insertPointEntry(
	input: {
		childId: number;
		amount: number;
		type: string;
		description: string;
		referenceId?: number;
	},
	_tenantId: string,
) {
	return db.insert(pointLedger).values(input).returning().get();
}

/** 子供の存在確認 */
export async function findChildById(id: number, _tenantId: string) {
	return db.select().from(children).where(eq(children.id, id)).get();
}

/** テナントの全ポイント台帳を削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(pointLedger).run();
}

/**
 * 指定した子供の `created_at < cutoffDate` に該当する point_ledger を削除する。
 * cutoffDate は `YYYY-MM-DD` 形式。point_ledger.created_at は ISO timestamp 形式
 * (`YYYY-MM-DD HH:MM:SS` or `YYYY-MM-DDTHH:MM:SSZ`) で格納されているが、いずれも先頭の
 * 日付部分が辞書順で比較できるため、`created_at < cutoffDate` で安全に境界判定できる
 * （cutoffDate 当日は削除対象に含めない）。
 * #717, #729
 */
export async function deletePointLedgerBeforeDate(
	childId: number,
	cutoffDate: string,
	_tenantId: string,
): Promise<number> {
	const result = db
		.delete(pointLedger)
		.where(and(eq(pointLedger.childId, childId), lt(pointLedger.createdAt, cutoffDate)))
		.run();
	return result.changes;
}
