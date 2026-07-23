import type { ChildId } from '$lib/domain/ids';
import type { Child, LoginStreak, UpsertLoginStreakInput } from '../types';

/**
 * ログインボーナスの counter 状態 repo (#3330 案 B counter 縮約)。
 *
 * per-date 行 (旧 login_bonuses) は保持せず、子供ごとに 1 行の counter
 * (lastLoginDate + currentStreak) のみ保持する。当日冪等 (1日1回 = ADR-0012) は
 * 旧 PK 衝突方式に代わり claimToday の conditional write が原子的に担保する。
 */
export interface ILoginBonusRepo {
	/** 子供の counter 状態を取得する (未 claim 児は undefined)。 */
	findStreak(childId: ChildId, tenantId: string): Promise<LoginStreak | undefined>;

	/**
	 * 当日 claim を原子的に実行する (conditional write、Duolingo 型)。
	 *
	 * - 行不在 → currentStreak=1 で insert
	 * - lastLoginDate === yesterday → currentStreak+1 に increment
	 * - それ以外の過去日 → currentStreak=1 に reset
	 * - lastLoginDate === today (claim 済) → **書き込まず undefined を返す**
	 *
	 * 同時 claim 2 連発でも単一 SQL 文の atomicity により勝者は 1 つだけ
	 * (race 回帰: tests/unit/db/dsql-login-streak-repo.test.ts、ADR-0061 failing-test-first)。
	 */
	claimToday(
		childId: ChildId,
		today: string,
		yesterday: string,
		tenantId: string,
	): Promise<{ currentStreak: number } | undefined>;

	/**
	 * counter を直接 upsert する (migration / backup import 専用)。
	 * 既存行がある場合は「lastLoginDate が新しい方、同日なら currentStreak が大きい方」を残す
	 * (merge import の後方互換 fold で二重取込しても劣化しない)。
	 * @returns 書き込みが行われたら true (既存の方が新しく skip したら false)
	 */
	upsertStreak(input: UpsertLoginStreakInput, tenantId: string): Promise<boolean>;

	findChildById(id: ChildId, tenantId: string): Promise<Child | undefined>;
	deleteByTenantId(tenantId: string, childIds?: readonly ChildId[]): Promise<void>;
}
