import type { ActivityUsageCount, ChildActivityPreference } from '../types';

export interface IActivityPrefRepo {
	/** #3329 backup: child の全活動設定 (pinned 不問、export 用)。 */
	findAllByChild(childId: number, tenantId: string): Promise<ChildActivityPreference[]>;

	/**
	 * #3329 backup restore 用: isPinned/pinOrder/日時を保全して活動設定を復元する。
	 * togglePin は pinOrder を MAX+1 で再採番し日時を now にするため round-trip でピン順・日時が
	 * 失われる。本メソッドは export された値をそのまま書き戻す (id は新規採番、childId/activityId は
	 * 呼び出し側が import 後の child/childActivity に解決済)。
	 */
	insertForRestore(
		input: Omit<ChildActivityPreference, 'id'>,
		tenantId: string,
	): Promise<ChildActivityPreference>;

	findPinnedByChild(childId: number, tenantId: string): Promise<ChildActivityPreference[]>;
	togglePin(
		childId: number,
		activityId: number,
		pinned: boolean,
		tenantId: string,
	): Promise<ChildActivityPreference>;
	countPinnedInCategory(childId: number, categoryId: number, tenantId: string): Promise<number>;
	getUsageCounts(
		childId: number,
		sinceDate: string,
		tenantId: string,
	): Promise<ActivityUsageCount[]>;
	deleteByTenantId(tenantId: string): Promise<void>;
}
