import type { ChildId } from '$lib/domain/ids';
import type { Child, InsertPointLedgerInput, PointLedgerEntry } from '../types';

export interface IPointRepo {
	getBalance(childId: ChildId, tenantId: string): Promise<number>;
	findPointHistory(
		childId: ChildId,
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
		childId: ChildId,
		amount: number,
		entry: { type: string; description: string; referenceId?: string },
		tenantId: string,
	): Promise<PointLedgerEntry | { error: 'INSUFFICIENT_POINTS' }>;
	/**
	 * #4697: 期間内に **獲得** したポイントの合計 (正の `amount` のみ、消費は含まない)。
	 *
	 * 月次レポート / 成長記録ブックの「ポイント」はこの値を指す。旧実装は `statuses.total_xp` の
	 * 累計を「ポイント」として出していたため、子供画面の所持ポイントとも週次タブの当週獲得とも
	 * 一致せず、累計なので先月比が常に ±0 だった。
	 *
	 * `startDate` / `endDate` は `YYYY-MM-DD` (JST 暦日、両端含む)。`created_at` の JST 日付が
	 * この範囲に入る行を対象にする (retention cleanup と同じ JST 当日境界の解釈)。
	 */
	sumEarnedPointsBetween(
		childId: ChildId,
		startDate: string,
		endDate: string,
		tenantId: string,
	): Promise<number>;
	findChildById(id: ChildId, tenantId: string): Promise<Child | undefined>;
	deleteByTenantId(tenantId: string, childIds?: readonly ChildId[]): Promise<void>;

	// Retention cleanup (#717, #729)
	/**
	 * 指定した子供の `created_at < cutoffDate` に該当する point_ledger を削除する。
	 * cutoffDate は `YYYY-MM-DD` 形式で **JST 当日境界** (getHistoryCutoffDate SSOT、#3593 ②)。
	 * #729: 過去明細のみが消え残高 (total_point) は不触 (carryover 廃止、reset-plan 決定#4)。
	 * TZ 整合 (#3593 ②): cutoffDate の「当日 0:00」は JST 深夜 0:00 の instant として解釈する。
	 * - DSQL: `created_at < (cutoffDate || 'T00:00:00+09:00')::timestamptz` で session TZ 非依存に固定。
	 * - sqlite/dynamodb: `created_at` (ISO/UTC) を cutoffDate と辞書順比較 (date 境界)。
	 *   JST 正当性は caller (getHistoryCutoffDate) が JST 基準の date を渡すことで担保する。
	 * @returns 削除件数
	 */
	deletePointLedgerBeforeDate(
		childId: ChildId,
		cutoffDate: string,
		tenantId: string,
	): Promise<number>;
}
