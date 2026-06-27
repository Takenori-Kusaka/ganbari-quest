import type { Child, InsertPointLedgerInput, PointLedgerEntry } from '../types';

export interface IPointRepo {
	getBalance(childId: number, tenantId: string): Promise<number>;
	findPointHistory(
		childId: number,
		options: { limit: number; offset: number },
		tenantId: string,
	): Promise<PointLedgerEntry[]>;
	insertPointEntry(input: InsertPointLedgerInput, tenantId: string): Promise<PointLedgerEntry>;
	/**
	 * #3347: 残高が `amount` 以上のときのみ、原子的にポイントを減算して台帳エントリ（負値）を
	 * 挿入する。`getBalance`（残高読込）→ 非負確認 → `insertPointEntry`（挿入）を service 層で
	 * await を跨いで行うと TOCTOU（並行 / 二重 submit）で二重減算・残高マイナスが起きるため、
	 * backend ごとの原子境界（SQLite=同期トランザクション / DynamoDB=条件付き TransactWrite /
	 * demo=同期チェック）で「再読込 → 非負確認 → 挿入」を 1 単位として実行する。
	 * @param amount 減算する正のポイント数（コスト）
	 * @returns 成功時は挿入した負値エントリ、残高不足なら `{ error: 'INSUFFICIENT_POINTS' }`
	 */
	spendPointsAtomic(
		childId: number,
		amount: number,
		entry: { type: string; description: string; referenceId?: number },
		tenantId: string,
	): Promise<PointLedgerEntry | { error: 'INSUFFICIENT_POINTS' }>;
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
