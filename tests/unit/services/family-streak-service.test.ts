import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mock: activity-repo ---
const mockFindDistinctRecordedDates = vi.fn();
vi.mock('$lib/server/db/activity-repo', () => ({
	findDistinctRecordedDates: (...args: unknown[]) => mockFindDistinctRecordedDates(...args),
}));

// --- Mock: child-repo ---
const mockFindAllChildren = vi.fn();
vi.mock('$lib/server/db/child-repo', () => ({
	findAllChildren: (...args: unknown[]) => mockFindAllChildren(...args),
}));

import {
	getFamilyStreak,
	getNextMilestone,
	getStreakMilestone,
} from '$lib/server/services/family-streak-service';

const TENANT = 'test-tenant';

beforeEach(() => {
	vi.clearAllMocks();
	// Mock Date to a fixed time for consistent streak calculation
	vi.useFakeTimers();
	// 2026-04-03 10:00:00 JST (= 2026-04-03 01:00:00 UTC)
	vi.setSystemTime(new Date('2026-04-03T01:00:00Z'));
});

afterEach(() => {
	vi.useRealTimers();
});

import { afterEach } from 'vitest';

describe('getFamilyStreak', () => {
	it('子供がいない場合はストリーク0', async () => {
		mockFindAllChildren.mockResolvedValue([]);
		const result = await getFamilyStreak(TENANT);
		expect(result.currentStreak).toBe(0);
		expect(result.hasRecordedToday).toBe(false);
	});

	it('記録なしの場合はストリーク0', async () => {
		mockFindAllChildren.mockResolvedValue([{ id: 1, nickname: 'テスト' }]);
		mockFindDistinctRecordedDates.mockResolvedValue([]);
		const result = await getFamilyStreak(TENANT);
		expect(result.currentStreak).toBe(0);
	});

	it('今日記録ありの1日ストリーク', async () => {
		mockFindAllChildren.mockResolvedValue([{ id: 1, nickname: 'テスト' }]);
		mockFindDistinctRecordedDates.mockResolvedValue([{ recordedDate: '2026-04-03' }]);
		const result = await getFamilyStreak(TENANT);
		expect(result.currentStreak).toBe(1);
		expect(result.hasRecordedToday).toBe(true);
		expect(result.todayRecorders).toEqual([1]);
	});

	it('昨日までの連続記録（今日はまだ）', async () => {
		mockFindAllChildren.mockResolvedValue([{ id: 1, nickname: 'テスト' }]);
		mockFindDistinctRecordedDates.mockResolvedValue([
			{ recordedDate: '2026-04-01' },
			{ recordedDate: '2026-04-02' },
		]);
		const result = await getFamilyStreak(TENANT);
		expect(result.currentStreak).toBe(2);
		expect(result.hasRecordedToday).toBe(false);
	});

	it('2日以上前が最終記録だとストリーク0', async () => {
		mockFindAllChildren.mockResolvedValue([{ id: 1, nickname: 'テスト' }]);
		mockFindDistinctRecordedDates.mockResolvedValue([{ recordedDate: '2026-04-01' }]);
		const result = await getFamilyStreak(TENANT);
		expect(result.currentStreak).toBe(0);
	});

	it('複数子供の記録をマージ', async () => {
		mockFindAllChildren.mockResolvedValue([
			{ id: 1, nickname: '兄' },
			{ id: 2, nickname: '弟' },
		]);
		// 兄: 4/1, 4/3 を記録
		// 弟: 4/2 を記録
		// マージ: 4/1, 4/2, 4/3 → 3日連続
		mockFindDistinctRecordedDates
			.mockResolvedValueOnce([{ recordedDate: '2026-04-01' }, { recordedDate: '2026-04-03' }])
			.mockResolvedValueOnce([{ recordedDate: '2026-04-02' }]);

		const result = await getFamilyStreak(TENANT);
		expect(result.currentStreak).toBe(3);
		expect(result.hasRecordedToday).toBe(true);
		expect(result.todayRecorders).toEqual([1]);
	});

	it('連続が途切れた場合は最新の連続のみ', async () => {
		mockFindAllChildren.mockResolvedValue([{ id: 1, nickname: 'テスト' }]);
		mockFindDistinctRecordedDates.mockResolvedValue([
			{ recordedDate: '2026-03-28' },
			{ recordedDate: '2026-03-29' },
			// 3/30 が欠落
			{ recordedDate: '2026-04-01' },
			{ recordedDate: '2026-04-02' },
			{ recordedDate: '2026-04-03' },
		]);
		const result = await getFamilyStreak(TENANT);
		expect(result.currentStreak).toBe(3);
	});
});

describe('getStreakMilestone', () => {
	it('7日マイルストーン', () => {
		expect(getStreakMilestone(7)).toEqual({ days: 7, points: 50 });
	});

	it('30日マイルストーン', () => {
		expect(getStreakMilestone(30)).toEqual({ days: 30, points: 200 });
	});

	it('非マイルストーン日はnull', () => {
		expect(getStreakMilestone(5)).toBeNull();
	});
});

describe('getNextMilestone', () => {
	it('ストリーク3日の場合、次は7日', () => {
		const next = getNextMilestone(3);
		expect(next).toEqual({ days: 7, points: 50, remaining: 4 });
	});

	it('ストリーク7日の場合、次は14日', () => {
		const next = getNextMilestone(7);
		expect(next).toEqual({ days: 14, points: 100, remaining: 7 });
	});

	it('ストリーク100日以上はnull', () => {
		expect(getNextMilestone(100)).toBeNull();
	});
});
