import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mock: custom-achievement-repo ---
const mockInsertCustomAchievement = vi.fn();
const mockFindCustomAchievements = vi.fn();
const mockCountCustomAchievements = vi.fn();
const mockUnlockCustomAchievement = vi.fn();
const mockDeleteCustomAchievement = vi.fn();
const mockInsertCustomTitle = vi.fn();
const mockFindCustomTitles = vi.fn();
const mockCountCustomTitles = vi.fn();
const mockUnlockCustomTitle = vi.fn();
const mockEquipCustomTitle = vi.fn();
const mockDeleteCustomTitle = vi.fn();

vi.mock('$lib/server/db/custom-achievement-repo', () => ({
	insertCustomAchievement: (...args: unknown[]) => mockInsertCustomAchievement(...args),
	findCustomAchievements: (...args: unknown[]) => mockFindCustomAchievements(...args),
	countCustomAchievements: (...args: unknown[]) => mockCountCustomAchievements(...args),
	unlockCustomAchievement: (...args: unknown[]) => mockUnlockCustomAchievement(...args),
	deleteCustomAchievement: (...args: unknown[]) => mockDeleteCustomAchievement(...args),
	insertCustomTitle: (...args: unknown[]) => mockInsertCustomTitle(...args),
	findCustomTitles: (...args: unknown[]) => mockFindCustomTitles(...args),
	countCustomTitles: (...args: unknown[]) => mockCountCustomTitles(...args),
	unlockCustomTitle: (...args: unknown[]) => mockUnlockCustomTitle(...args),
	equipCustomTitle: (...args: unknown[]) => mockEquipCustomTitle(...args),
	deleteCustomTitle: (...args: unknown[]) => mockDeleteCustomTitle(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
	checkAndUnlockCustomItems,
	createCustomAchievement,
	createCustomTitle,
	getAchievementProgress,
	getCustomLimits,
	getTitleProgress,
	removeCustomAchievement,
	removeCustomTitle,
} from '$lib/server/services/custom-achievement-service';

const TENANT = 'test-tenant';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('getCustomLimits', () => {
	it('free プランは 0/0', () => {
		expect(getCustomLimits('free')).toEqual({ achievements: 0, titles: 0 });
	});

	it('standard プランは 10/5', () => {
		expect(getCustomLimits('standard')).toEqual({ achievements: 10, titles: 5 });
	});

	it('family プランは 999/999', () => {
		expect(getCustomLimits('family')).toEqual({ achievements: 999, titles: 999 });
	});

	it('未知のプランは free と同じ', () => {
		expect(getCustomLimits('unknown')).toEqual({ achievements: 0, titles: 0 });
	});
});

describe('createCustomAchievement', () => {
	const validInput = {
		childId: 1,
		name: 'ピアノ100回',
		conditionType: 'activity_count' as const,
		conditionValue: 100,
		conditionActivityId: 5,
	};

	it('プラン上限内で作成成功', async () => {
		mockCountCustomAchievements.mockResolvedValue(3);
		mockInsertCustomAchievement.mockResolvedValue({ id: 1, ...validInput });
		const result = await createCustomAchievement(validInput, TENANT, 'standard');
		expect(result).toHaveProperty('id', 1);
		expect(mockInsertCustomAchievement).toHaveBeenCalled();
	});

	it('プラン上限到達で LIMIT_REACHED', async () => {
		mockCountCustomAchievements.mockResolvedValue(10);
		const result = await createCustomAchievement(validInput, TENANT, 'standard');
		expect(result).toEqual({ error: 'LIMIT_REACHED' });
	});

	it('名前なしで INVALID_INPUT', async () => {
		const result = await createCustomAchievement({ ...validInput, name: '  ' }, TENANT, 'standard');
		expect(result).toEqual({ error: 'INVALID_INPUT' });
	});

	it('conditionValue が 0 で INVALID_INPUT', async () => {
		const result = await createCustomAchievement(
			{ ...validInput, conditionValue: 0 },
			TENANT,
			'standard',
		);
		expect(result).toEqual({ error: 'INVALID_INPUT' });
	});
});

describe('createCustomTitle', () => {
	const validInput = {
		childId: 1,
		name: 'ピアノのめいじん',
		conditionType: 'activity_count' as const,
		conditionValue: 50,
	};

	it('プラン上限内で作成成功', async () => {
		mockCountCustomTitles.mockResolvedValue(2);
		mockInsertCustomTitle.mockResolvedValue({ id: 1, ...validInput });
		const result = await createCustomTitle(validInput, TENANT, 'standard');
		expect(result).toHaveProperty('id', 1);
	});

	it('プラン上限到達で LIMIT_REACHED', async () => {
		mockCountCustomTitles.mockResolvedValue(5);
		const result = await createCustomTitle(validInput, TENANT, 'standard');
		expect(result).toEqual({ error: 'LIMIT_REACHED' });
	});
});

describe('removeCustomAchievement / removeCustomTitle', () => {
	it('実績削除', async () => {
		mockDeleteCustomAchievement.mockResolvedValue(true);
		const result = await removeCustomAchievement(1, TENANT);
		expect(result).toBe(true);
	});

	it('称号削除', async () => {
		mockDeleteCustomTitle.mockResolvedValue(true);
		const result = await removeCustomTitle(1, TENANT);
		expect(result).toBe(true);
	});
});

describe('getAchievementProgress', () => {
	const baseData = {
		totalActivityCount: 50,
		activityCounts: { 5: 30, 10: 20 } as Record<number, number>,
		categoryCounts: { 1: 40, 2: 10 } as Record<number, number>,
		maxStreakDays: 14,
		activityStreaks: { 5: 7 } as Record<number, number>,
		currentLevel: 15,
		achievementCount: 8,
	};

	it('total_count', () => {
		const a = {
			conditionType: 'total_count',
			conditionValue: 100,
			conditionActivityId: null,
			conditionCategoryId: null,
		};
		const result = getAchievementProgress(a as never, baseData);
		expect(result).toEqual({ current: 50, target: 100, complete: false });
	});

	it('activity_count', () => {
		const a = {
			conditionType: 'activity_count',
			conditionValue: 30,
			conditionActivityId: 5,
			conditionCategoryId: null,
		};
		const result = getAchievementProgress(a as never, baseData);
		expect(result).toEqual({ current: 30, target: 30, complete: true });
	});

	it('category_count', () => {
		const a = {
			conditionType: 'category_count',
			conditionValue: 50,
			conditionActivityId: null,
			conditionCategoryId: 1,
		};
		const result = getAchievementProgress(a as never, baseData);
		expect(result).toEqual({ current: 40, target: 50, complete: false });
	});

	it('streak_days', () => {
		const a = {
			conditionType: 'streak_days',
			conditionValue: 14,
			conditionActivityId: null,
			conditionCategoryId: null,
		};
		const result = getAchievementProgress(a as never, baseData);
		expect(result).toEqual({ current: 14, target: 14, complete: true });
	});

	it('activity_streak', () => {
		const a = {
			conditionType: 'activity_streak',
			conditionValue: 10,
			conditionActivityId: 5,
			conditionCategoryId: null,
		};
		const result = getAchievementProgress(a as never, baseData);
		expect(result).toEqual({ current: 7, target: 10, complete: false });
	});
});

describe('getTitleProgress', () => {
	const baseData = {
		totalActivityCount: 50,
		activityCounts: { 5: 30 } as Record<number, number>,
		categoryCounts: {} as Record<number, number>,
		maxStreakDays: 14,
		activityStreaks: {} as Record<number, number>,
		currentLevel: 15,
		achievementCount: 8,
	};

	it('level_reach', () => {
		const t = { conditionType: 'level_reach', conditionValue: 20, conditionActivityId: null };
		const result = getTitleProgress(t as never, baseData);
		expect(result).toEqual({ current: 15, target: 20, complete: false });
	});

	it('achievement_count', () => {
		const t = {
			conditionType: 'achievement_count',
			conditionValue: 5,
			conditionActivityId: null,
		};
		const result = getTitleProgress(t as never, baseData);
		expect(result).toEqual({ current: 5, target: 5, complete: true });
	});

	it('activity_count (specific)', () => {
		const t = { conditionType: 'activity_count', conditionValue: 50, conditionActivityId: 5 };
		const result = getTitleProgress(t as never, baseData);
		expect(result).toEqual({ current: 30, target: 50, complete: false });
	});

	it('activity_count (total)', () => {
		const t = { conditionType: 'activity_count', conditionValue: 40, conditionActivityId: null };
		const result = getTitleProgress(t as never, baseData);
		expect(result).toEqual({ current: 40, target: 40, complete: true });
	});

	it('streak_days', () => {
		const t = { conditionType: 'streak_days', conditionValue: 30, conditionActivityId: null };
		const result = getTitleProgress(t as never, baseData);
		expect(result).toEqual({ current: 14, target: 30, complete: false });
	});
});

describe('checkAndUnlockCustomItems', () => {
	const progressData = {
		totalActivityCount: 100,
		activityCounts: { 5: 50 } as Record<number, number>,
		categoryCounts: { 1: 30 } as Record<number, number>,
		maxStreakDays: 20,
		activityStreaks: {} as Record<number, number>,
		currentLevel: 10,
		achievementCount: 5,
	};

	it('未解放の実績を解放', async () => {
		mockFindCustomAchievements.mockResolvedValue([
			{
				id: 1,
				name: 'test',
				icon: '🏅',
				conditionType: 'total_count',
				conditionValue: 50,
				conditionActivityId: null,
				conditionCategoryId: null,
				bonusPoints: 100,
				unlockedAt: null,
			},
		]);
		mockFindCustomTitles.mockResolvedValue([]);
		mockUnlockCustomAchievement.mockResolvedValue(undefined);

		const result = await checkAndUnlockCustomItems(1, TENANT, progressData);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ type: 'achievement', id: 1, bonusPoints: 100 });
		expect(mockUnlockCustomAchievement).toHaveBeenCalledWith(1, TENANT);
	});

	it('既に解放済みの実績はスキップ', async () => {
		mockFindCustomAchievements.mockResolvedValue([
			{
				id: 1,
				name: 'test',
				conditionType: 'total_count',
				conditionValue: 50,
				unlockedAt: '2026-01-01',
				bonusPoints: 100,
			},
		]);
		mockFindCustomTitles.mockResolvedValue([]);

		const result = await checkAndUnlockCustomItems(1, TENANT, progressData);
		expect(result).toHaveLength(0);
	});

	it('称号も解放', async () => {
		mockFindCustomAchievements.mockResolvedValue([]);
		mockFindCustomTitles.mockResolvedValue([
			{
				id: 2,
				name: 'レベルマスター',
				icon: '📛',
				conditionType: 'level_reach',
				conditionValue: 10,
				conditionActivityId: null,
				unlockedAt: null,
			},
		]);
		mockUnlockCustomTitle.mockResolvedValue(undefined);

		const result = await checkAndUnlockCustomItems(1, TENANT, progressData);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ type: 'title', id: 2 });
	});

	it('エラー時は空配列を返す', async () => {
		mockFindCustomAchievements.mockRejectedValue(new Error('DB error'));

		const result = await checkAndUnlockCustomItems(1, TENANT, progressData);
		expect(result).toHaveLength(0);
	});
});
