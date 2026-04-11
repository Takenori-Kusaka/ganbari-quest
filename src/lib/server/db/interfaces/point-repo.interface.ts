import type { Child, InsertPointLedgerInput, PointLedgerEntry } from '../types';

export interface IPointRepo {
	getBalance(childId: number, tenantId: string): Promise<number>;
	findPointHistory(
		childId: number,
		options: { limit: number; offset: number },
		tenantId: string,
	): Promise<PointLedgerEntry[]>;
	insertPointEntry(input: InsertPointLedgerInput, tenantId: string): Promise<PointLedgerEntry>;
	findChildById(id: number, tenantId: string): Promise<Child | undefined>;
	deleteByTenantId(tenantId: string): Promise<void>;

	// Retention cleanup (#717, #729)
	/**
	 * 指定した子供の `created_at < cutoffDate` に該当する point_ledger を削除する。
	 * cutoffDate は `YYYY-MM-DD` 形式。`created_at` は ISO timestamp で格納されているため、
	 * 実装側で `cutoffDate + 'T00:00:00'` との辞書順比較で判定する。
	 * @returns 削除件数
	 */
	deletePointLedgerBeforeDate(
		childId: number,
		cutoffDate: string,
		tenantId: string,
	): Promise<number>;
}
