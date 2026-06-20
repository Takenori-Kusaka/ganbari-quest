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

// Mock activity-log-aggregation (純粋集計層、#2097 Fix 2 で循環依存解消のため抽出)。
// 旧テストは activity-log-service.getActivityLogs を mock していたが、auto-challenge-service は
// aggregateActivityLogsByCategory を直接呼ぶ実装に変わった (循環依存解消)。
const mockGetActivityLogs = vi.fn();
vi.mock('$lib/server/services/activity-log-aggregation', () => ({
	aggregateActivityLogsByCategory: (...args: unknown[]) => mockGetActivityLogs(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import type { AutoChallenge } from '$lib/server/db/types';
import {
	computeProposal,
	getActiveChallenge,
	getChallengeHistory,
	getLastWeekStart,
	getOrCreateWeeklyChallenge,
	getWeekStart,
	incrementChallengeProgress,
	summarizeChallengeAnalytics,
} from '$lib/server/services/auto-challenge-service';

// computeProposal は (counts, prev, weekStart) を取る純粋関数。
// weekIndexOf(weekStart) % 4 === 0 を「得意週」とするため、テストの weekStart は週インデックスで選ぶ。
// 2026-01-05(月) の週インデックスは 2922 (= 2922 % 4 = 2 → 非得意週)。得意週検証用に別 weekStart を使う。
const WEEK_WEAKNESS = '2026-01-05'; // 非得意週 (weekIndex % 4 !== 0)
function counts(byId: Record<number, number>): Record<number, number> {
	return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, ...byId };
}
function makePrev(over: Partial<Record<string, unknown>> = {}) {
	return {
		id: 1,
		childId: CHILD_ID,
		tenantId: TENANT,
		weekStart: getLastWeekStart(WEEK_WEAKNESS),
		categoryId: 2,
		targetCount: 3,
		currentCount: 0,
		status: 'expired',
		mode: 'weakness',
		consecutiveMissCount: 0,
		createdAt: '2025-12-29T00:00:00Z',
		updatedAt: '2026-01-04T00:00:00Z',
		...over,
	};
}

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

describe('computeProposal — カテゴリ選択 (§3.4)', () => {
	const STRENGTH_WEEK = '2026-01-19'; // weekIndex % 4 === 0 → 得意週

	it('データ不足なら explore モード (target=最小2)', () => {
		const p = computeProposal(counts({ 1: 2 }), undefined, WEEK_WEAKNESS);
		expect(p.mode).toBe('explore');
		expect(p.targetCount).toBe(2);
		expect(p.reason).toContain('まだ記録が少ない');
	});

	it('通常週は weakness モード (target は 2〜7 に収まる)', () => {
		const p = computeProposal(counts({ 1: 8, 2: 6, 3: 4, 4: 2, 5: 0 }), undefined, WEEK_WEAKNESS);
		expect(p.mode).toBe('weakness');
		expect(p.targetCount).toBeGreaterThanOrEqual(2);
		expect(p.targetCount).toBeLessThanOrEqual(7);
		expect(p.consecutiveMissCount).toBe(0);
	});

	it('得意週は strength モードで最多カテゴリを選ぶ', () => {
		const p = computeProposal(counts({ 1: 8, 5: 0 }), undefined, STRENGTH_WEEK);
		expect(p.mode).toBe('strength');
		expect(p.categoryId).toBe(1); // 最多 = うんどう
		expect(p.targetCount).toBe(5); // avg 4 → base clamp(5,2,7)
	});
});

describe('computeProposal — 翌週適応 (Flow 3 分岐)', () => {
	const STRENGTH_WEEK = '2026-01-19';

	it('前週完了 + 大幅超過なら target を上げる (+2)', () => {
		// 得意週 → 最多カテゴリ1 を決定的に選択。prev も cat1 完了で overshoot 2
		const prev = makePrev({ categoryId: 1, status: 'completed', targetCount: 5, currentCount: 7 });
		const p = computeProposal(counts({ 1: 4 }), prev, STRENGTH_WEEK);
		expect(p.categoryId).toBe(1);
		expect(p.targetCount).toBe(7); // max(base3, 5+2)=7
	});

	it('前週未達 (半分以上) なら据え置き', () => {
		const prev = makePrev({ categoryId: 1, status: 'expired', targetCount: 5, currentCount: 3 });
		const p = computeProposal(counts({ 1: 4 }), prev, STRENGTH_WEEK);
		expect(p.targetCount).toBe(5); // ratio 0.6 → 据置
		expect(p.consecutiveMissCount).toBe(1);
	});

	it('前週未達 (半分未満) なら 1 下げる', () => {
		const prev = makePrev({ categoryId: 1, status: 'expired', targetCount: 5, currentCount: 1 });
		const p = computeProposal(counts({ 1: 4 }), prev, STRENGTH_WEEK);
		expect(p.targetCount).toBe(4); // ratio 0.2 → -1
	});

	it('2 週連続未達なら rescue-strength (target 最小 + 得意カテゴリ)', () => {
		// prev が未達 + 既に 1 連続未達 → 今週 incoming streak = 2 → レスキュー
		const prev = makePrev({
			categoryId: 2,
			status: 'expired',
			consecutiveMissCount: 1,
			targetCount: 3,
			currentCount: 0,
		});
		const p = computeProposal(counts({ 1: 6 }), prev, WEEK_WEAKNESS);
		expect(p.mode).toBe('rescue-strength');
		expect(p.categoryId).toBe(1); // 最多 = 得意
		expect(p.targetCount).toBe(2); // MIN_TARGET
		expect(p.consecutiveMissCount).toBe(2);
	});

	it('前週完了なら連続未達カウントは 0 にリセット', () => {
		const prev = makePrev({ status: 'completed', consecutiveMissCount: 3 });
		const p = computeProposal(counts({ 1: 8, 2: 4 }), prev, WEEK_WEAKNESS);
		expect(p.consecutiveMissCount).toBe(0);
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
		expect(result).not.toBeNull();
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
		expect(result).not.toBeNull();
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
		expect(result).not.toBeNull();
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

describe('summarizeChallengeAnalytics', () => {
	function row(over: Partial<AutoChallenge>): AutoChallenge {
		return {
			id: 0,
			childId: CHILD_ID,
			tenantId: TENANT,
			weekStart: '2026-01-05',
			categoryId: 1,
			targetCount: 3,
			currentCount: 0,
			status: 'expired',
			mode: 'weakness',
			consecutiveMissCount: 0,
			createdAt: '',
			updatedAt: '',
			...over,
		};
	}

	it('空リストは全指標 0', () => {
		const a = summarizeChallengeAnalytics([]);
		expect(a.totalWeeks).toBe(0);
		expect(a.completionRate).toBe(0);
		expect(a.consecutiveMissRate).toBe(0);
	});

	it('達成率 / 超過度 / 得意週vs苦手週 を算出する', () => {
		const a = summarizeChallengeAnalytics([
			row({
				categoryId: 1,
				status: 'completed',
				targetCount: 3,
				currentCount: 5,
				mode: 'weakness',
			}),
			row({ categoryId: 1, status: 'expired', targetCount: 4, currentCount: 1, mode: 'weakness' }),
			row({
				categoryId: 2,
				status: 'completed',
				targetCount: 2,
				currentCount: 2,
				mode: 'strength',
			}),
			row({ categoryId: 3, status: 'expired', consecutiveMissCount: 2, mode: 'weakness' }),
		]);
		expect(a.totalWeeks).toBe(4);
		expect(a.completionRate).toBe(0.5); // 2/4
		expect(a.completionRateByCategory[1]).toBe(0.5); // 1/2
		expect(a.avgOvershoot).toBe(1); // (5-3)+(2-2)=2 / 2 completed
		expect(a.consecutiveMissRate).toBe(0.25); // 1/4
		expect(a.strengthCompletionRate).toBe(1); // 1/1
		expect(a.weaknessCompletionRate).toBeCloseTo(1 / 3); // 1/3
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
