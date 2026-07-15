import type { ActivityId, CategoryId, ChildId } from '$lib/domain/ids';
import type { ActivityUsageCount, ChildActivityPreference } from '../types';

export interface IActivityPrefRepo {
	/** #3329 backup: child の全活動設定 (pinned 不問、export 用)。 */
	findAllByChild(childId: ChildId, tenantId: string): Promise<ChildActivityPreference[]>;

	/**
	 * #3329 backup restore 用: isPinned/pinOrder/日時を保全して活動設定を復元する。
	 * togglePin は pinOrder を MAX+1 で再採番し日時を now にするため round-trip でピン順・日時が
	 * 失われる。本メソッドは export された値をそのまま書き戻す (id は新規採番、childId/activityId は
	 * 呼び出し側が import 後の child/childActivity に解決済)。
	 *
	 * #3394/#3465 統一冪等契約: 同 (childId, activityId) が既存なら **null** を返す (重複 skip。
	 * SQLite=idx_child_activity_prefs_unique / DynamoDB=attribute_not_exists / DSQL=自然複合 PK で
	 * 機能等価)。その他の write 失敗は throw する (#3401)。
	 */
	insertForRestore(
		input: Omit<ChildActivityPreference, 'id'>,
		tenantId: string,
	): Promise<ChildActivityPreference | null>;

	findPinnedByChild(childId: ChildId, tenantId: string): Promise<ChildActivityPreference[]>;
	togglePin(
		childId: ChildId,
		activityId: ActivityId,
		pinned: boolean,
		tenantId: string,
	): Promise<ChildActivityPreference>;
	countPinnedInCategory(
		childId: ChildId,
		categoryId: CategoryId,
		tenantId: string,
	): Promise<number>;
	getUsageCounts(
		childId: ChildId,
		sinceDate: string,
		tenantId: string,
	): Promise<ActivityUsageCount[]>;
	deleteByTenantId(tenantId: string): Promise<void>;
}
