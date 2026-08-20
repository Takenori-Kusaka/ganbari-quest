import type { ChildId } from '$lib/domain/ids';
import type { Child, InsertPointLedgerInput, PointLedgerEntry } from '../types';

export interface IPointRepo {
	getBalance(childId: ChildId, tenantId: string): Promise<number>;
	/**
	 * 台帳の全種別を新しい順に返す一覧。`limit` は**表示件数**であり、
	 * 特定種別の抽出 / 集計に流用しないこと (#4682 F2)。
	 */
	findPointHistory(
		childId: ChildId,
		options: { limit: number; offset: number },
		tenantId: string,
	): Promise<PointLedgerEntry[]>;

	/**
	 * #4682 F2: **種別で絞った**台帳一覧を新しい順に返す。
	 *
	 * 旧実装は `findPointHistory({ limit: 50 })` を取ってから `type === 'convert'` で filter して
	 * いたため、活動が多い子では直近 50 行が活動記録で埋まり、`/admin/points` の
	 * 「おこづかい変換りれき」と累計が**丸ごと消えて**いた (渡し忘れ / 二重払いの原因)。
	 * 絞り込みを DB 側に置き、limit を「その種別の表示件数」として正しく効かせる。
	 */
	findPointHistoryByType(
		childId: ChildId,
		options: { type: string; limit: number; offset?: number },
		tenantId: string,
	): Promise<PointLedgerEntry[]>;

	/**
	 * #4682 F2: 種別 (+ 期間) の **SUM を DB 側で計算**する。
	 *
	 * 累計は一覧の window に依存してはならない (行数が増えると勝手に減る)。
	 * `fromIso` / `toIso` は UTC ISO 文字列で、JST 月境界は呼び出し側が
	 * `jstDayStartUtcIso` (JST SSOT) で作る (#4015 / #4127)。範囲は `from <= created_at < to`。
	 * 戻り値は amount の総和 (消費は負値のまま)。
	 */
	sumPointsByType(
		childId: ChildId,
		options: { type: string; fromIso?: string; toIso?: string },
		tenantId: string,
	): Promise<number>;
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
