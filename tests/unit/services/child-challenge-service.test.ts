// tests/unit/services/child-challenge-service.test.ts
// per-child チャレンジ サービス層 unit test (#2362 PR-7、ADR-0055、User §6)
//
// 検証範囲:
//   - calcAgeAdjustedTarget (年齢調整ロジック)
//   - createChildChallenge / createChildChallengesBulk (per-child instance 作成)
//   - getChallengeGroupsForAdmin (sourceTemplateId / (title + 期間) group 化)
//   - updateChildChallengeProgress (count 増分 + completed 判定)

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInsert = vi.fn();
const mockInsertBulk = vi.fn();
const mockFindAllByTenant = vi.fn();
const mockFindByChildId = vi.fn();
const mockFindActiveByChildId = vi.fn();
const mockFindActiveOrUnclaimedByChildId = vi.fn();
const mockUpdateProgress = vi.fn();
const mockMarkCompleted = vi.fn();
const mockFindAllChildren = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		childChallenge: {
			insert: (...a: unknown[]) => mockInsert(...a),
			insertBulk: (...a: unknown[]) => mockInsertBulk(...a),
			findAllByTenant: (...a: unknown[]) => mockFindAllByTenant(...a),
			findByChildId: (...a: unknown[]) => mockFindByChildId(...a),
			findActiveByChildId: (...a: unknown[]) => mockFindActiveByChildId(...a),
			findActiveOrUnclaimedByChildId: (...a: unknown[]) => mockFindActiveOrUnclaimedByChildId(...a),
			updateProgress: (...a: unknown[]) => mockUpdateProgress(...a),
			markCompleted: (...a: unknown[]) => mockMarkCompleted(...a),
		},
	}),
}));

// challenge-generation: computeProposal / getWeekStart / getLastWeekStart は実物を使い、
// 集計 (activity-log 依存) のみ mock する。
const mockAggregateCategoryCounts = vi.fn();
vi.mock('$lib/server/services/challenge-generation', async (importActual) => {
	const actual = await importActual<typeof import('$lib/server/services/challenge-generation')>();
	return {
		...actual,
		aggregateCategoryCounts: (...a: unknown[]) => mockAggregateCategoryCounts(...a),
	};
});

vi.mock('$lib/server/db/child-repo', () => ({
	findAllChildren: (...a: unknown[]) => mockFindAllChildren(...a),
}));

vi.mock('$lib/server/db/activity-repo', () => ({
	insertPointLedger: vi.fn(),
}));

vi.mock('$lib/domain/date-utils', () => ({
	todayDateJST: () => '2026-05-25',
}));

import {
	buildPerChildTargets,
	calcAgeAdjustedTarget,
	createChildChallenge,
	createChildChallengesBulk,
	getActiveChildChallengesWithSiblings,
	getChallengeGroupsForAdmin,
	getOrCreateWeeklyChildChallenge,
	updateChildChallengeProgress,
} from '../../../src/lib/server/services/child-challenge-service';

const TENANT = 'test-tenant-001';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('getOrCreateWeeklyChildChallenge (#3195 アプリ自動生成)', () => {
	it('当週分が無ければ child_challenges を自動生成する (targetConfig に metric/categoryId/genMode 内包)', async () => {
		mockFindByChildId.mockResolvedValue([]); // 既存なし
		mockAggregateCategoryCounts.mockResolvedValue({ 1: 8, 2: 6, 3: 4, 4: 2, 5: 0 });
		mockInsert.mockImplementation(async (input) => ({
			id: 1,
			currentValue: 0,
			completed: 0,
			...input,
		}));

		await getOrCreateWeeklyChildChallenge(10, TENANT);

		expect(mockInsert).toHaveBeenCalledTimes(1);
		const input = mockInsert.mock.calls[0]?.[0];
		expect(input.sourceTemplateId).toBe('auto:weekly');
		expect(input.challengeType).toBe('cooperative');
		expect(input.periodType).toBe('weekly');
		const cfg = JSON.parse(input.targetConfig);
		expect(cfg.metric).toBe('count'); // 既存 updateChildChallengeProgress が増分できる形
		expect(cfg.categoryId).toBeGreaterThanOrEqual(1);
		expect(typeof cfg.genMode).toBe('string');
		expect(input.targetValue).toBeGreaterThanOrEqual(2); // MIN_TARGET
	});

	it('当週分が既にあれば再生成しない (冪等)', async () => {
		const { getWeekStart } = await import('../../../src/lib/server/services/challenge-generation');
		const existing = {
			id: 99,
			childId: 10,
			sourceTemplateId: 'auto:weekly',
			startDate: getWeekStart(),
			targetConfig: '{"metric":"count","categoryId":2,"baseTarget":3}',
		};
		mockFindByChildId.mockResolvedValue([existing]);

		const result = await getOrCreateWeeklyChildChallenge(10, TENANT);
		expect(result).toBe(existing);
		expect(mockInsert).not.toHaveBeenCalled();
		expect(mockAggregateCategoryCounts).not.toHaveBeenCalled();
	});
});

describe('calcAgeAdjustedTarget', () => {
	it('ageAdjustments 未指定 → baseTarget をそのまま返す', () => {
		expect(calcAgeAdjustedTarget(10, undefined, 5)).toBe(10);
	});

	it('完全一致の age key があればそれを使う', () => {
		expect(calcAgeAdjustedTarget(10, { '5': 15, '10': 25 }, 5)).toBe(15);
	});

	it('完全一致なし → 「childAge 以下で最大の age key」を使う', () => {
		expect(calcAgeAdjustedTarget(10, { '3': 5, '6': 15, '10': 25 }, 8)).toBe(15);
	});

	it('childAge が最小 age key より小さい → baseTarget', () => {
		expect(calcAgeAdjustedTarget(10, { '6': 15 }, 4)).toBe(10);
	});
});

describe('createChildChallenge / createChildChallengesBulk', () => {
	it('createChildChallenge は repo.insert を呼び出す', async () => {
		mockInsert.mockResolvedValueOnce({ id: 1, childId: 902, title: 'foo' });
		const result = await createChildChallenge(
			{
				childId: 902,
				title: 'foo',
				startDate: '2026-05-25',
				endDate: '2026-06-01',
				targetConfig: '{}',
				rewardConfig: '{}',
				targetValue: 5,
			},
			TENANT,
		);
		expect(result.id).toBe(1);
		expect(mockInsert).toHaveBeenCalledWith(
			expect.objectContaining({ childId: 902, targetValue: 5 }),
			TENANT,
		);
	});

	it('createChildChallengesBulk は childIds 配列ぶん insertBulk inputs 生成', async () => {
		mockInsertBulk.mockResolvedValueOnce([
			{ id: 1, childId: 902, targetValue: 15 },
			{ id: 2, childId: 903, targetValue: 25 },
		]);
		const result = await createChildChallengesBulk(
			{
				title: 'みんなで',
				startDate: '2026-05-25',
				endDate: '2026-06-01',
				targetConfig: '{}',
				rewardConfig: '{}',
				sourceTemplateId: 'src:1',
				perChildTargets: { 902: 15, 903: 25 },
			},
			[902, 903],
			TENANT,
		);
		expect(result.length).toBe(2);
		expect(mockInsertBulk).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({ childId: 902, targetValue: 15, sourceTemplateId: 'src:1' }),
				expect.objectContaining({ childId: 903, targetValue: 25, sourceTemplateId: 'src:1' }),
			]),
			TENANT,
		);
	});

	it('perChildTargets で未指定 childId は targetValue=1 fallback', async () => {
		mockInsertBulk.mockResolvedValueOnce([{ id: 1 }]);
		await createChildChallengesBulk(
			{
				title: 'X',
				startDate: '2026-05-25',
				endDate: '2026-06-01',
				targetConfig: '{}',
				rewardConfig: '{}',
				perChildTargets: {},
			},
			[902],
			TENANT,
		);
		expect(mockInsertBulk).toHaveBeenCalledWith(
			[expect.objectContaining({ childId: 902, targetValue: 1 })],
			TENANT,
		);
	});
});

describe('getChallengeGroupsForAdmin', () => {
	it('同じ sourceTemplateId を持つ instance を group 化、各 instance が collect される', async () => {
		mockFindAllByTenant.mockResolvedValueOnce([
			{
				id: 1,
				childId: 902,
				title: 'A',
				startDate: '2026-05-25',
				endDate: '2026-06-01',
				periodType: 'weekly',
				sourceTemplateId: 'tmpl-1',
				completed: 0,
				targetValue: 5,
				currentValue: 2,
				description: null,
				rewardConfig: '{}',
				targetConfig: '{}',
				status: 'active',
				isActive: 1,
				challengeType: 'cooperative',
				completedAt: null,
				rewardClaimed: 0,
				rewardClaimedAt: null,
				createdAt: '',
				updatedAt: '',
			},
			{
				id: 2,
				childId: 903,
				title: 'A',
				startDate: '2026-05-25',
				endDate: '2026-06-01',
				periodType: 'weekly',
				sourceTemplateId: 'tmpl-1',
				completed: 0,
				targetValue: 5,
				currentValue: 3,
				description: null,
				rewardConfig: '{}',
				targetConfig: '{}',
				status: 'active',
				isActive: 1,
				challengeType: 'cooperative',
				completedAt: null,
				rewardClaimed: 0,
				rewardClaimedAt: null,
				createdAt: '',
				updatedAt: '',
			},
			{
				id: 3,
				childId: 902,
				title: 'B (individual)',
				startDate: '2026-05-20',
				endDate: '2026-05-27',
				periodType: 'weekly',
				sourceTemplateId: null,
				completed: 1,
				targetValue: 5,
				currentValue: 5,
				description: null,
				rewardConfig: '{}',
				targetConfig: '{}',
				status: 'completed',
				isActive: 1,
				challengeType: 'cooperative',
				completedAt: '2026-05-27T09:00:00Z',
				rewardClaimed: 0,
				rewardClaimedAt: null,
				createdAt: '',
				updatedAt: '',
			},
		]);

		const groups = await getChallengeGroupsForAdmin(TENANT);
		expect(groups.length).toBe(2);
		// 開始日降順 (新しい順): A (2026-05-25) > B (2026-05-20)
		expect(groups[0]?.groupKey).toBe('tmpl-1');
		expect(groups[0]?.instances.length).toBe(2);
		expect(groups[0]?.allCompleted).toBe(false);
		expect(groups[1]?.groupKey).toContain('B (individual)');
		expect(groups[1]?.instances.length).toBe(1);
		expect(groups[1]?.allCompleted).toBe(true);
	});

	it('全 instance 完了で allCompleted=true', async () => {
		mockFindAllByTenant.mockResolvedValueOnce([
			{
				id: 1,
				childId: 902,
				title: 'X',
				startDate: '2026-05-25',
				endDate: '2026-06-01',
				periodType: 'weekly',
				sourceTemplateId: 'tmpl-x',
				completed: 1,
				targetValue: 5,
				currentValue: 5,
				description: null,
				rewardConfig: '{}',
				targetConfig: '{}',
				status: 'completed',
				isActive: 1,
				challengeType: 'cooperative',
				completedAt: '',
				rewardClaimed: 0,
				rewardClaimedAt: null,
				createdAt: '',
				updatedAt: '',
			},
			{
				id: 2,
				childId: 903,
				title: 'X',
				startDate: '2026-05-25',
				endDate: '2026-06-01',
				periodType: 'weekly',
				sourceTemplateId: 'tmpl-x',
				completed: 1,
				targetValue: 5,
				currentValue: 5,
				description: null,
				rewardConfig: '{}',
				targetConfig: '{}',
				status: 'completed',
				isActive: 1,
				challengeType: 'cooperative',
				completedAt: '',
				rewardClaimed: 0,
				rewardClaimedAt: null,
				createdAt: '',
				updatedAt: '',
			},
		]);
		const groups = await getChallengeGroupsForAdmin(TENANT);
		expect(groups[0]?.allCompleted).toBe(true);
	});
});

describe('updateChildChallengeProgress', () => {
	it('count metric → currentValue 増分 + target 達成で markCompleted', async () => {
		mockFindActiveByChildId.mockResolvedValueOnce([
			{
				id: 10,
				childId: 902,
				title: 'P',
				completed: 0,
				currentValue: 4,
				targetValue: 5,
				targetConfig: JSON.stringify({ metric: 'count', baseTarget: 5 }),
				description: null,
				rewardConfig: '{}',
				challengeType: 'cooperative',
				periodType: 'weekly',
				startDate: '',
				endDate: '',
				status: 'active',
				isActive: 1,
				completedAt: null,
				rewardClaimed: 0,
				rewardClaimedAt: null,
				sourceTemplateId: null,
				createdAt: '',
				updatedAt: '',
			},
		]);
		const results = await updateChildChallengeProgress(902, 999, 1, TENANT);
		expect(mockUpdateProgress).toHaveBeenCalledWith(10, 5, TENANT);
		expect(mockMarkCompleted).toHaveBeenCalledWith(10, TENANT);
		expect(results[0]?.completed).toBe(true);
	});

	it('categoryId 不一致 → 進捗更新スキップ', async () => {
		mockFindActiveByChildId.mockResolvedValueOnce([
			{
				id: 11,
				childId: 902,
				title: 'P',
				completed: 0,
				currentValue: 0,
				targetValue: 5,
				targetConfig: JSON.stringify({ metric: 'count', categoryId: 2, baseTarget: 5 }),
				description: null,
				rewardConfig: '{}',
				challengeType: 'cooperative',
				periodType: 'weekly',
				startDate: '',
				endDate: '',
				status: 'active',
				isActive: 1,
				completedAt: null,
				rewardClaimed: 0,
				rewardClaimedAt: null,
				sourceTemplateId: null,
				createdAt: '',
				updatedAt: '',
			},
		]);
		// categoryId=1 で呼ぶ → targetConfig.categoryId=2 と不一致 → スキップ
		const results = await updateChildChallengeProgress(902, 999, 1, TENANT);
		expect(mockUpdateProgress).not.toHaveBeenCalled();
		expect(results.length).toBe(0);
	});
});

describe('buildPerChildTargets', () => {
	it('child の age に応じて ageAdjustments を適用', async () => {
		mockFindAllChildren.mockResolvedValueOnce([
			{ id: 902, age: 5 },
			{ id: 903, age: 8 },
		]);
		const result = await buildPerChildTargets(10, { '5': 15, '8': 25 }, [902, 903], TENANT);
		expect(result).toEqual({ 902: 15, 903: 25 });
	});

	it('child が見つからない → age=6 fallback', async () => {
		mockFindAllChildren.mockResolvedValueOnce([]);
		const result = await buildPerChildTargets(10, undefined, [999], TENANT);
		// baseTarget=10、ageAdjustments 未指定 → baseTarget そのまま
		expect(result).toEqual({ 999: 10 });
	});

	// #2488 (must-3 fix): pre-fetched children を受け取った場合 findAllChildren 呼出をスキップ
	it('prefetchedChildren 渡し時は findAllChildren を呼ばない (N+1 解消)', async () => {
		const result = await buildPerChildTargets(10, { '5': 15 }, [902], TENANT, [
			{ id: 902, age: 5 },
		]);
		expect(mockFindAllChildren).not.toHaveBeenCalled();
		expect(result).toEqual({ 902: 15 });
	});
});

// #2488 (must-1 + must-2 fix): regression tests
describe('getActiveChildChallengesWithSiblings — #2488 regression', () => {
	function row(overrides: Record<string, unknown>) {
		return {
			id: 0,
			childId: 902,
			title: 'X',
			startDate: '2026-05-25',
			endDate: '2026-06-01',
			periodType: 'weekly' as const,
			sourceTemplateId: 'tmpl-1',
			completed: 0,
			targetValue: 5,
			currentValue: 0,
			description: null,
			rewardConfig: '{}',
			targetConfig: '{}',
			status: 'active' as const,
			isActive: 1,
			challengeType: 'cooperative' as const,
			completedAt: null,
			rewardClaimed: 0,
			rewardClaimedAt: null,
			createdAt: '',
			updatedAt: '',
			...overrides,
		};
	}

	it('must-1: completed AND rewardClaimed=0 の自身 instance も active 一覧に含まれる', async () => {
		// findActiveOrUnclaimedByChildId が status=completed+rewardClaimed=0 を返す前提
		mockFindActiveOrUnclaimedByChildId.mockResolvedValueOnce([
			row({
				id: 10,
				childId: 902,
				status: 'completed',
				completed: 1,
				currentValue: 5,
				rewardClaimed: 0,
			}),
		]);
		mockFindAllByTenant.mockResolvedValueOnce([
			row({
				id: 10,
				childId: 902,
				status: 'completed',
				completed: 1,
				currentValue: 5,
				rewardClaimed: 0,
			}),
		]);
		const result = await getActiveChildChallengesWithSiblings(902, TENANT);
		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe(10);
		expect(result[0]?.rewardClaimed).toBe(0);
		expect(result[0]?.completed).toBe(1);
		// ChallengeBanner の claim button が render されるための条件: completed=1 + rewardClaimed=0
	});

	it('must-2: 過去期間の同 sourceTemplateId instance は siblings[] から除外される', async () => {
		// 自身: 今週 (5/25 - 6/1) active
		mockFindActiveOrUnclaimedByChildId.mockResolvedValueOnce([
			row({ id: 100, childId: 902, startDate: '2026-05-25', endDate: '2026-06-01' }),
		]);
		// tenant 全体: 自身 + 兄弟今週 + 自身の先週 expired completed (sourceTemplateId 共有)
		mockFindAllByTenant.mockResolvedValueOnce([
			row({ id: 100, childId: 902, startDate: '2026-05-25', endDate: '2026-06-01' }),
			row({
				id: 101,
				childId: 903,
				startDate: '2026-05-25',
				endDate: '2026-06-01',
				currentValue: 2,
			}),
			// 先週分 (異なる期間) — siblings に含まれてはいけない
			row({
				id: 90,
				childId: 902,
				startDate: '2026-05-18',
				endDate: '2026-05-24',
				status: 'completed',
				completed: 1,
				currentValue: 5,
				rewardClaimed: 1,
			}),
			row({
				id: 91,
				childId: 903,
				startDate: '2026-05-18',
				endDate: '2026-05-24',
				status: 'completed',
				completed: 1,
				currentValue: 5,
				rewardClaimed: 1,
			}),
		]);
		const result = await getActiveChildChallengesWithSiblings(902, TENANT);
		expect(result).toHaveLength(1);
		// siblings は今週分 2 件のみ (先週分 2 件は除外)
		expect(result[0]?.siblings).toHaveLength(2);
		expect(result[0]?.siblings.map((s) => s.id).sort()).toEqual([100, 101]);
		// 今週分は誰も完了していない → allCompleted=false (誤 celebration 発火しない)
		expect(result[0]?.allCompleted).toBe(false);
	});

	it('must-2: 同期間のみで全 sibling completed → allCompleted=true (正常 celebration 発火)', async () => {
		mockFindActiveOrUnclaimedByChildId.mockResolvedValueOnce([
			row({
				id: 200,
				childId: 902,
				status: 'completed',
				completed: 1,
				currentValue: 5,
				rewardClaimed: 0,
			}),
		]);
		mockFindAllByTenant.mockResolvedValueOnce([
			row({
				id: 200,
				childId: 902,
				status: 'completed',
				completed: 1,
				currentValue: 5,
				rewardClaimed: 0,
			}),
			row({
				id: 201,
				childId: 903,
				status: 'completed',
				completed: 1,
				currentValue: 5,
				rewardClaimed: 1,
			}),
		]);
		const result = await getActiveChildChallengesWithSiblings(902, TENANT);
		expect(result).toHaveLength(1);
		expect(result[0]?.allCompleted).toBe(true);
	});
});
