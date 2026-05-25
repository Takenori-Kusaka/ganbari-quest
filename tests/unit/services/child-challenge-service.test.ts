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
const mockFindActiveByChildId = vi.fn();
const mockUpdateProgress = vi.fn();
const mockMarkCompleted = vi.fn();
const mockFindAllChildren = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		childChallenge: {
			insert: (...a: unknown[]) => mockInsert(...a),
			insertBulk: (...a: unknown[]) => mockInsertBulk(...a),
			findAllByTenant: (...a: unknown[]) => mockFindAllByTenant(...a),
			findActiveByChildId: (...a: unknown[]) => mockFindActiveByChildId(...a),
			updateProgress: (...a: unknown[]) => mockUpdateProgress(...a),
			markCompleted: (...a: unknown[]) => mockMarkCompleted(...a),
		},
	}),
}));

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
	getChallengeGroupsForAdmin,
	updateChildChallengeProgress,
} from '../../../src/lib/server/services/child-challenge-service';

const TENANT = 'test-tenant-001';

beforeEach(() => {
	vi.clearAllMocks();
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
});
