// src/lib/server/services/activity-pin-service.ts
// 活動ピン留め・使用頻度ソートサービス

import {
	countPinnedInCategory,
	findPinnedByChild,
	getUsageCounts,
	togglePin as togglePinRepo,
} from '$lib/server/db/activity-pref-repo';
import { findActivityById } from '$lib/server/db/activity-repo';
import type { Activity, ChildActivity } from '$lib/server/db/types';

const MAX_PINS_PER_CATEGORY = 5;
const USAGE_DAYS = 30;

/**
 * #2362 PR-3 Phase 7b-2c: sortActivitiesWithPreferences / selectRecommendations の
 * 引数型を Activity と ChildActivity 双方が満たす共通 subset (`SortableActivity`) に緩める。
 *
 * Activity (旧 master) は `ageMin / ageMax / gradeLevel / subcategory / description` を持ち、
 * ChildActivity は持たないが、sort / select の判定では `id / categoryId / basePoints /
 * isVisible / sortOrder` のみ参照するため、共通 subset で型安全に互換化できる。
 */
export interface SortableActivity {
	id: number;
	categoryId: number;
	basePoints: number;
	isVisible: number | boolean;
	sortOrder: number;
}

export type SortedActivity<T extends SortableActivity = Activity | ChildActivity> = T & {
	isPinned: boolean;
	usageCount: number;
};

/** ピン留めトグル */
export async function toggleActivityPin(
	childId: number,
	activityId: number,
	pinned: boolean,
	tenantId: string,
): Promise<{ isPinned: boolean }> {
	if (pinned) {
		// 上限チェック
		const activity = await findActivityById(activityId, tenantId);
		if (!activity) {
			throw new Error('活動が見つかりません');
		}
		const currentCount = await countPinnedInCategory(childId, activity.categoryId, tenantId);
		if (currentCount >= MAX_PINS_PER_CATEGORY) {
			throw new Error(`1カテゴリあたりのピン留め上限（${MAX_PINS_PER_CATEGORY}件）を超えています`);
		}
	}

	const result = await togglePinRepo(childId, activityId, pinned, tenantId);
	return { isPinned: result.isPinned === 1 };
}

/**
 * 活動リストにピン留め+使用頻度情報を付与してソート
 *
 * #2362 PR-3 Phase 7b-2c: generic T で呼出側の活動型を保持。
 * Activity / ChildActivity いずれの配列も受け取れる。
 */
export async function sortActivitiesWithPreferences<T extends SortableActivity>(
	activities: T[],
	childId: number,
	tenantId: string,
): Promise<SortedActivity<T>[]> {
	const [pinnedPrefs, usageCounts] = await Promise.all([
		findPinnedByChild(childId, tenantId),
		getUsageCounts(childId, getSinceDate(USAGE_DAYS), tenantId),
	]);

	const pinnedMap = new Map(pinnedPrefs.map((p) => [p.activityId, p.pinOrder ?? 999]));
	const usageMap = new Map(usageCounts.map((u) => [u.activityId, u.usageCount]));

	return activities
		.map((a) => ({
			...a,
			isPinned: pinnedMap.has(a.id),
			usageCount: usageMap.get(a.id) ?? 0,
		}))
		.sort((a, b) => {
			// 1. ピン留め優先
			if (a.isPinned && !b.isPinned) return -1;
			if (!a.isPinned && b.isPinned) return 1;

			// 2. ピン留め同士: pinOrder → usageCount
			if (a.isPinned && b.isPinned) {
				const orderDiff = (pinnedMap.get(a.id) ?? 999) - (pinnedMap.get(b.id) ?? 999);
				if (orderDiff !== 0) return orderDiff;
				return b.usageCount - a.usageCount;
			}

			// 3. 非ピン: 使用頻度順 → sortOrder（従来の固定順）
			if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount;
			return a.sortOrder - b.sortOrder;
		});
}

function getSinceDate(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() - days);
	return d.toISOString().split('T')[0] ?? d.toISOString();
}
