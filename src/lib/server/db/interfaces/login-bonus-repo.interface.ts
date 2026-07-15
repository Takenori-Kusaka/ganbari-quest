import type { ChildId } from '$lib/domain/ids';
import type { Child, InsertLoginBonusInput, LoginBonus } from '../types';

export interface ILoginBonusRepo {
	findTodayBonus(
		childId: ChildId,
		today: string,
		tenantId: string,
	): Promise<LoginBonus | undefined>;
	findRecentBonuses(childId: ChildId, tenantId: string, limit?: number): Promise<LoginBonus[]>;
	insertLoginBonus(input: InsertLoginBonusInput, tenantId: string): Promise<LoginBonus>;
	findChildById(id: ChildId, tenantId: string): Promise<Child | undefined>;
	deleteByTenantId(tenantId: string, childIds?: readonly ChildId[]): Promise<void>;

	// Retention cleanup (#717, #729)
	/**
	 * 指定した子供の `login_date < cutoffDate` に該当する login_bonuses を削除する。
	 * cutoffDate は `YYYY-MM-DD` 形式で、その日自体は削除対象に含まない（strict less than）。
	 * @returns 削除件数
	 */
	deleteLoginBonusesBeforeDate(
		childId: ChildId,
		cutoffDate: string,
		tenantId: string,
	): Promise<number>;
}
