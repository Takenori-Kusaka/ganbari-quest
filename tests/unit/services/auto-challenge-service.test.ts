import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the repo
const mockFindByChildAndWeek = vi.fn();
const mockFindActiveByChild = vi.fn();
const mockFindByChild = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockExpireOldChallenges = vi.fn();

vi.mock('$lib/server/db/auto-challenge-repo', () => ({
	findByChildAndWeek: (...args: unknown[]) => mockFindByChildAndWeek(...args),
	findActiveByChild: (...args: unknown[]) => mockFindActiveByChild(...args),
	findByChild: (...args: unknown[]) => mockFindByChild(...args),
	insert: (...args: unknown[]) => mockInsert(...args),
	update: (...args: unknown[]) => mockUpdate(...args),
	expireOldChallenges: (...args: unknown[]) => mockExpireOldChallenges(...args),
}));

// Mock activity-log-service for analyzeWeakCategory
const mockGetActivityLogs = vi.fn();
vi.mock('$lib/server/services/activity-log-service', () => ({
	getActivityLogs: (...args: unknown[]) => mockGetActivityLogs(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
	analyzeWeakCategory,
	getActiveChallenge,
	getChallengeHistory,
	getOrCreateWeeklyChallenge,
	getWeekStart,
	incrementChallengeProgress,
} from '$lib/server/services/auto-challenge-service';

const TENANT = 'test-tenant';
const CHILD_ID = 1;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('getWeekStart', () => {
	it('returns Monday for a Monday date', () => {
		// 2026-04-06 is a Monday
		const result = getWeekStart(new Date(2026, 3, 6));
		expect(result).toBe('2026-04-06');
	});

	it('returns previous Monday for a Wednesday', () => {
		// 2026-04-08 is a Wednesday
		const result = getWeekStart(new Date(2026, 3, 8));
		expect(result).toBe('2026-04-06');
	});

	it('returns previous Monday for a Sunday', () => {
		// 2026-04-12 is a Sunday
		const result = getWeekStart(new Date(2026, 3, 12));
		expect(result).toBe('2026-04-06');
	});

	it('returns previous Monday for a Saturday', () => {
		// 2026-04-11 is a Saturday
		const result = getWeekStart(new Date(2026, 3, 11));
		expect(result).toBe('2026-04-06');
	});
});

describe('analyzeWeakCategory', () => {
	it('identifies the weakest category from activity logs', async () => {
		mockGetActivityLogs.mockResolvedValue({
			logs: [],
			summary: {
				totalCount: 20,
				totalPoints: 100,
				byCategory: {
					1: { count: 8, points: 40 },
					2: { count: 6, points: 30 },
					3: { count: 4, points: 20 },
					4: { count: 2, points: 10 },
					5: { count: 0, points: 0 },
				},
			},
		});

		const result = await analyzeWeakCategory(CHILD_ID, TENANT);
		// Category 5 (souzou) has 0 records, should be weakest
		expect(result.categoryId).toBe(5);
		expect(result.categoryName).toBe('そうぞう');
		expect(result.targetCount).toBeGreaterThanOrEqual(3);
	});

	it('returns random category when not enough data', async () => {
		mockGetActivityLogs.mockResolvedValue({
			logs: [],
			summary: {
				totalCount: 2,
				totalPoints: 10,
				byCategory: {
					1: { count: 2, points: 10 },
				},
			},
		});

		const result = await analyzeWeakCategory(CHILD_ID, TENANT);
		expect(result.targetCount).toBe(3);
		expect(result.reason).toContain('まだ記録が少ない');
	});
});

describe('getOrCreateWeeklyChallenge', () => {
	it('returns existing challenge if already created for this week', async () => {
		const existing = {
			id: 1,
			childId: CHILD_ID,
			tenantId: TENANT,
			weekStart: getWeekStart(),
			categoryId: 2,
			targetCount: 3,
			currentCount: 1,
			status: 'active',
			createdAt: '2026-04-06T00:00:00Z',
			updatedAt: '2026-04-06T00:00:00Z',
		};
		mockFindByChildAndWeek.mockResolvedValue(existing);

		const result = await getOrCreateWeeklyChallenge(CHILD_ID, TENANT);
		expect(result).toBeTruthy();
		expect(result?.categoryId).toBe(2);
		expect(result?.currentCount).toBe(1);
		expect(mockInsert).not.toHaveBeenCalled();
	});

	it('creates new challenge if none exists for this week', async () => {
		mockFindByChildAndWeek.mockResolvedValue(undefined);
		mockExpireOldChallenges.mockResolvedValue(0);
		mockGetActivityLogs.mockResolvedValue({
			logs: [],
			summary: {
				totalCount: 10,
				totalPoints: 50,
				byCategory: {
					1: { count: 5, points: 25 },
					2: { count: 3, points: 15 },
					3: { count: 2, points: 10 },
					4: { count: 0, points: 0 },
					5: { count: 0, points: 0 },
				},
			},
		});

		const newChallenge = {
			id: 2,
			childId: CHILD_ID,
			tenantId: TENANT,
			weekStart: getWeekStart(),
			categoryId: 4,
			targetCount: 3,
			currentCount: 0,
			status: 'active',
			createdAt: '2026-04-06T00:00:00Z',
			updatedAt: '2026-04-06T00:00:00Z',
		};
		mockInsert.mockResolvedValue(newChallenge);

		const result = await getOrCreateWeeklyChallenge(CHILD_ID, TENANT);
		expect(result).toBeTruthy();
		expect(mockInsert).toHaveBeenCalled();
		expect(mockExpireOldChallenges).toHaveBeenCalled();
	});
});

describe('getActiveChallenge', () => {
	it('returns active challenge info', async () => {
		mockFindActiveByChild.mockResolvedValue({
			id: 1,
			childId: CHILD_ID,
			tenantId: TENANT,
			weekStart: '2026-04-06',
			categoryId: 1,
			targetCount: 5,
			currentCount: 2,
			status: 'active',
			createdAt: '2026-04-06T00:00:00Z',
			updatedAt: '2026-04-06T00:00:00Z',
		});

		const result = await getActiveChallenge(CHILD_ID, TENANT);
		expect(result).toBeTruthy();
		expect(result?.progressPercent).toBe(40);
		expect(result?.description).toContain('うんどう');
		expect(result?.description).toContain('5回');
	});

	it('returns null if no active challenge', async () => {
		mockFindActiveByChild.mockResolvedValue(undefined);
		const result = await getActiveChallenge(CHILD_ID, TENANT);
		expect(result).toBeNull();
	});
});

describe('getChallengeHistory', () => {
	it('returns formatted challenge history', async () => {
		mockFindByChild.mockResolvedValue([
			{
				id: 1,
				childId: CHILD_ID,
				tenantId: TENANT,
				weekStart: '2026-04-06',
				categoryId: 2,
				targetCount: 3,
				currentCount: 3,
				status: 'completed',
				createdAt: '2026-04-06T00:00:00Z',
				updatedAt: '2026-04-07T00:00:00Z',
			},
			{
				id: 2,
				childId: CHILD_ID,
				tenantId: TENANT,
				weekStart: '2026-03-30',
				categoryId: 1,
				targetCount: 4,
				currentCount: 2,
				status: 'expired',
				createdAt: '2026-03-30T00:00:00Z',
				updatedAt: '2026-04-06T00:00:00Z',
			},
		]);

		const result = await getChallengeHistory(CHILD_ID, TENANT);
		expect(result).toHaveLength(2);
		expect(result[0]?.status).toBe('completed');
		expect(result[0]?.progressPercent).toBe(100);
		expect(result[1]?.status).toBe('expired');
		expect(result[1]?.progressPercent).toBe(50);
	});
});

describe('incrementChallengeProgress', () => {
	it('increments when category matches', async () => {
		mockFindActiveByChild.mockResolvedValue({
			id: 1,
			childId: CHILD_ID,
			tenantId: TENANT,
			weekStart: '2026-04-06',
			categoryId: 2,
			targetCount: 3,
			currentCount: 1,
			status: 'active',
			createdAt: '2026-04-06T00:00:00Z',
			updatedAt: '2026-04-06T00:00:00Z',
		});
		mockUpdate.mockResolvedValue(undefined);

		const result = await incrementChallengeProgress(CHILD_ID, 2, TENANT);
		expect(result.challengeCompleted).toBe(false);
		expect(result.challengeInfo?.currentCount).toBe(2);
		expect(mockUpdate).toHaveBeenCalledWith(1, { currentCount: 2, status: 'active' }, TENANT);
	});

	it('completes challenge when target reached', async () => {
		mockFindActiveByChild.mockResolvedValue({
			id: 1,
			childId: CHILD_ID,
			tenantId: TENANT,
			weekStart: '2026-04-06',
			categoryId: 3,
			targetCount: 3,
			currentCount: 2,
			status: 'active',
			createdAt: '2026-04-06T00:00:00Z',
			updatedAt: '2026-04-06T00:00:00Z',
		});
		mockUpdate.mockResolvedValue(undefined);

		const result = await incrementChallengeProgress(CHILD_ID, 3, TENANT);
		expect(result.challengeCompleted).toBe(true);
		expect(result.challengeInfo?.status).toBe('completed');
		expect(mockUpdate).toHaveBeenCalledWith(1, { currentCount: 3, status: 'completed' }, TENANT);
	});

	it('does nothing when category does not match', async () => {
		mockFindActiveByChild.mockResolvedValue({
			id: 1,
			childId: CHILD_ID,
			tenantId: TENANT,
			weekStart: '2026-04-06',
			categoryId: 2,
			targetCount: 3,
			currentCount: 1,
			status: 'active',
			createdAt: '2026-04-06T00:00:00Z',
			updatedAt: '2026-04-06T00:00:00Z',
		});

		const result = await incrementChallengeProgress(CHILD_ID, 5, TENANT);
		expect(result.challengeCompleted).toBe(false);
		expect(result.challengeInfo).toBeNull();
		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it('does nothing when no active challenge', async () => {
		mockFindActiveByChild.mockResolvedValue(undefined);

		const result = await incrementChallengeProgress(CHILD_ID, 1, TENANT);
		expect(result.challengeCompleted).toBe(false);
		expect(result.challengeInfo).toBeNull();
	});
});
