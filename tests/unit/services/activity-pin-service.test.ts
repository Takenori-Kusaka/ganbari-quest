import { describe, expect, it, vi } from 'vitest';

// Mock the repos before importing the service
vi.mock('$lib/server/db/activity-pref-repo', () => ({
	findPinnedByChild: vi.fn(),
	getUsageCounts: vi.fn(),
	togglePin: vi.fn(),
	countPinnedInCategory: vi.fn(),
}));

vi.mock('$lib/server/db/activity-repo', () => ({
	findActivityById: vi.fn(),
}));

import type { Activity } from '$lib/server/db/types';
import {
	sortActivitiesWithPreferences,
	toggleActivityPin,
} from '$lib/server/services/activity-pin-service';

const { findPinnedByChild, getUsageCounts, countPinnedInCategory, togglePin } = await import(
	'$lib/server/db/activity-pref-repo'
);
const { findActivityById } = await import('$lib/server/db/activity-repo');

function makeActivity(overrides: Partial<Activity> & { id: number }): Activity {
	return {
		name: `activity-${overrides.id}`,
		categoryId: 1,
		icon: '🏃',
		basePoints: 10,
		ageMin: null,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: overrides.id,
		source: 'system',
		gradeLevel: null,
		subcategory: null,
		description: null,
		nameKana: null,
		nameKanji: null,
		triggerHint: null,
		isMainQuest: 0,
		createdAt: '2026-01-01T00:00:00Z',
		...overrides,
	};
}

describe('sortActivitiesWithPreferences', () => {
	it('ピン留め活動が先頭に来る', async () => {
		vi.mocked(findPinnedByChild).mockResolvedValue([
			{ id: 1, childId: 1, activityId: 3, isPinned: 1, pinOrder: 1, createdAt: '', updatedAt: '' },
		]);
		vi.mocked(getUsageCounts).mockResolvedValue([]);

		const activities = [makeActivity({ id: 1 }), makeActivity({ id: 2 }), makeActivity({ id: 3 })];
		const result = await sortActivitiesWithPreferences(activities, 1, 'test-tenant');

		expect(result[0]?.id).toBe(3);
		expect(result[0]?.isPinned).toBe(true);
		expect(result[1]?.isPinned).toBe(false);
		expect(result[2]?.isPinned).toBe(false);
	});

	it('ピン留め同士はpinOrder順', async () => {
		vi.mocked(findPinnedByChild).mockResolvedValue([
			{ id: 1, childId: 1, activityId: 2, isPinned: 1, pinOrder: 2, createdAt: '', updatedAt: '' },
			{ id: 2, childId: 1, activityId: 3, isPinned: 1, pinOrder: 1, createdAt: '', updatedAt: '' },
		]);
		vi.mocked(getUsageCounts).mockResolvedValue([]);

		const activities = [makeActivity({ id: 1 }), makeActivity({ id: 2 }), makeActivity({ id: 3 })];
		const result = await sortActivitiesWithPreferences(activities, 1, 'test-tenant');

		expect(result[0]?.id).toBe(3); // pinOrder=1
		expect(result[1]?.id).toBe(2); // pinOrder=2
	});

	it('使用頻度が高い活動が上位に来る', async () => {
		vi.mocked(findPinnedByChild).mockResolvedValue([]);
		vi.mocked(getUsageCounts).mockResolvedValue([
			{ activityId: 2, usageCount: 10 },
			{ activityId: 1, usageCount: 3 },
		]);

		const activities = [makeActivity({ id: 1 }), makeActivity({ id: 2 }), makeActivity({ id: 3 })];
		const result = await sortActivitiesWithPreferences(activities, 1, 'test-tenant');

		expect(result[0]?.id).toBe(2); // 10回
		expect(result[1]?.id).toBe(1); // 3回
		expect(result[2]?.id).toBe(3); // 0回
	});

	it('同じ使用頻度ではsortOrder順', async () => {
		vi.mocked(findPinnedByChild).mockResolvedValue([]);
		vi.mocked(getUsageCounts).mockResolvedValue([]);

		const activities = [
			makeActivity({ id: 1, sortOrder: 3 }),
			makeActivity({ id: 2, sortOrder: 1 }),
			makeActivity({ id: 3, sortOrder: 2 }),
		];
		const result = await sortActivitiesWithPreferences(activities, 1, 'test-tenant');

		expect(result[0]?.id).toBe(2); // sortOrder=1
		expect(result[1]?.id).toBe(3); // sortOrder=2
		expect(result[2]?.id).toBe(1); // sortOrder=3
	});

	it('ピン留め > 使用頻度 > sortOrder の優先度', async () => {
		vi.mocked(findPinnedByChild).mockResolvedValue([
			{ id: 1, childId: 1, activityId: 3, isPinned: 1, pinOrder: 1, createdAt: '', updatedAt: '' },
		]);
		vi.mocked(getUsageCounts).mockResolvedValue([
			{ activityId: 1, usageCount: 20 },
			{ activityId: 2, usageCount: 5 },
		]);

		const activities = [makeActivity({ id: 1 }), makeActivity({ id: 2 }), makeActivity({ id: 3 })];
		const result = await sortActivitiesWithPreferences(activities, 1, 'test-tenant');

		expect(result[0]?.id).toBe(3); // ピン留め
		expect(result[1]?.id).toBe(1); // 使用頻度20
		expect(result[2]?.id).toBe(2); // 使用頻度5
	});

	it('空の活動リストを処理できる', async () => {
		vi.mocked(findPinnedByChild).mockResolvedValue([]);
		vi.mocked(getUsageCounts).mockResolvedValue([]);

		const result = await sortActivitiesWithPreferences([], 1, 'test-tenant');
		expect(result).toHaveLength(0);
	});

	it('usageCountが付与される', async () => {
		vi.mocked(findPinnedByChild).mockResolvedValue([]);
		vi.mocked(getUsageCounts).mockResolvedValue([{ activityId: 1, usageCount: 7 }]);

		const activities = [makeActivity({ id: 1 })];
		const result = await sortActivitiesWithPreferences(activities, 1, 'test-tenant');

		expect(result[0]?.usageCount).toBe(7);
	});
});

describe('toggleActivityPin', () => {
	it('ピン留め上限を超えるとエラー', async () => {
		vi.mocked(findActivityById).mockResolvedValue(makeActivity({ id: 1, categoryId: 2 }));
		vi.mocked(countPinnedInCategory).mockResolvedValue(5);

		await expect(toggleActivityPin(1, 1, true, 'test-tenant')).rejects.toThrow('上限');
	});

	it('ピン留め上限内なら成功', async () => {
		vi.mocked(findActivityById).mockResolvedValue(makeActivity({ id: 1, categoryId: 2 }));
		vi.mocked(countPinnedInCategory).mockResolvedValue(3);
		vi.mocked(togglePin).mockResolvedValue({
			id: 1,
			childId: 1,
			activityId: 1,
			isPinned: 1,
			pinOrder: 4,
			createdAt: '',
			updatedAt: '',
		});

		const result = await toggleActivityPin(1, 1, true, 'test-tenant');
		expect(result.isPinned).toBe(true);
	});

	it('ピン留め解除は上限チェックなし', async () => {
		vi.mocked(togglePin).mockResolvedValue({
			id: 1,
			childId: 1,
			activityId: 1,
			isPinned: 0,
			pinOrder: null,
			createdAt: '',
			updatedAt: '',
		});

		const result = await toggleActivityPin(1, 1, false, 'test-tenant');
		expect(result.isPinned).toBe(false);
	});

	it('存在しない活動ではエラー', async () => {
		vi.mocked(findActivityById).mockResolvedValue(undefined);

		await expect(toggleActivityPin(1, 999, true, 'test-tenant')).rejects.toThrow('見つかりません');
	});
});
