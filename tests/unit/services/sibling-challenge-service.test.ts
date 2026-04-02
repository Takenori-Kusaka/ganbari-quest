import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mock: sibling-challenge-repo ---
const mockInsertChallenge = vi.fn();
const mockFindAllChallenges = vi.fn();
const mockFindActiveChallenges = vi.fn();
const mockFindChallengeById = vi.fn();
const mockUpdateChallenge = vi.fn();
const mockDeleteChallenge = vi.fn();
const mockEnrollChildren = vi.fn();
const mockFindProgressByChallenge = vi.fn();
const mockFindProgress = vi.fn();
const mockUpsertProgress = vi.fn();
const mockMarkCompleted = vi.fn();
const mockClaimReward = vi.fn();

vi.mock('$lib/server/db/sibling-challenge-repo', () => ({
	insertChallenge: (...args: unknown[]) => mockInsertChallenge(...args),
	findAllChallenges: (...args: unknown[]) => mockFindAllChallenges(...args),
	findActiveChallenges: (...args: unknown[]) => mockFindActiveChallenges(...args),
	findChallengeById: (...args: unknown[]) => mockFindChallengeById(...args),
	updateChallenge: (...args: unknown[]) => mockUpdateChallenge(...args),
	deleteChallenge: (...args: unknown[]) => mockDeleteChallenge(...args),
	enrollChildren: (...args: unknown[]) => mockEnrollChildren(...args),
	findProgressByChallenge: (...args: unknown[]) => mockFindProgressByChallenge(...args),
	findProgress: (...args: unknown[]) => mockFindProgress(...args),
	upsertProgress: (...args: unknown[]) => mockUpsertProgress(...args),
	markCompleted: (...args: unknown[]) => mockMarkCompleted(...args),
	claimReward: (...args: unknown[]) => mockClaimReward(...args),
}));

// --- Mock: child-repo ---
const mockFindAllChildren = vi.fn();
vi.mock('$lib/server/db/child-repo', () => ({
	findAllChildren: (...args: unknown[]) => mockFindAllChildren(...args),
}));

// --- Mock: activity-repo (point ledger) ---
const mockInsertPointLedger = vi.fn();
vi.mock('$lib/server/db/activity-repo', () => ({
	insertPointLedger: (...args: unknown[]) => mockInsertPointLedger(...args),
}));

import {
	calcAgeAdjustedTarget,
	checkAllSiblingsComplete,
	checkChallengeProgress,
	claimChallengeReward,
	createSiblingChallenge,
	deleteSiblingChallenge,
	getAllChallengesWithProgress,
} from '$lib/server/services/sibling-challenge-service';

const TENANT = 'test-tenant';

const makeChallenge = (overrides = {}) => ({
	id: 1,
	title: 'みんなで3回うんどう！',
	description: null,
	challengeType: 'cooperative',
	periodType: 'weekly',
	startDate: '2026-04-01',
	endDate: '2026-04-07',
	targetConfig: '{"metric":"count","baseTarget":3,"categoryId":1}',
	rewardConfig: '{"points":100,"message":"すごい！"}',
	status: 'active',
	isActive: 1,
	createdAt: '2026-04-01',
	updatedAt: '2026-04-01',
	...overrides,
});

beforeEach(() => {
	vi.clearAllMocks();
});

describe('calcAgeAdjustedTarget', () => {
	it('ageAdjustments なしの場合、baseTarget を返す', () => {
		expect(calcAgeAdjustedTarget(5, undefined, 7)).toBe(5);
	});

	it('年齢に完全一致するキーがあればその値', () => {
		expect(calcAgeAdjustedTarget(5, { '5': 3, '8': 7 }, 5)).toBe(3);
	});

	it('完全一致しない場合、年齢以下で最大のキーの値を返す', () => {
		expect(calcAgeAdjustedTarget(5, { '4': 2, '8': 7 }, 6)).toBe(2);
	});

	it('全てのキーが子供の年齢より大きい場合、baseTarget を返す', () => {
		expect(calcAgeAdjustedTarget(5, { '8': 7, '10': 10 }, 3)).toBe(5);
	});
});

describe('createSiblingChallenge', () => {
	it('チャレンジ作成 + 全子供自動エンロール', async () => {
		const challenge = makeChallenge();
		mockInsertChallenge.mockResolvedValue(challenge);
		mockFindAllChildren.mockResolvedValue([
			{ id: 1, nickname: 'ゆい', age: 5, tenantId: TENANT },
			{ id: 2, nickname: 'けん', age: 8, tenantId: TENANT },
		]);
		mockEnrollChildren.mockResolvedValue(undefined);

		const input = {
			title: challenge.title,
			challengeType: 'cooperative' as const,
			periodType: 'weekly' as const,
			startDate: '2026-04-01',
			endDate: '2026-04-07',
			targetConfig: '{"metric":"count","baseTarget":3,"categoryId":1}',
			rewardConfig: '{"points":100}',
		};

		const result = await createSiblingChallenge(input, TENANT);
		expect(result.id).toBe(1);
		expect(mockEnrollChildren).toHaveBeenCalledWith(
			1,
			[
				{ childId: 1, targetValue: 3 },
				{ childId: 2, targetValue: 3 },
			],
			TENANT,
		);
	});

	it('年齢調整ターゲットで子供をエンロール', async () => {
		const challenge = makeChallenge({
			targetConfig: '{"metric":"count","baseTarget":5,"ageAdjustments":{"5":3,"8":6}}',
		});
		mockInsertChallenge.mockResolvedValue(challenge);
		mockFindAllChildren.mockResolvedValue([
			{ id: 1, nickname: 'ゆい', age: 5, tenantId: TENANT },
			{ id: 2, nickname: 'けん', age: 8, tenantId: TENANT },
		]);
		mockEnrollChildren.mockResolvedValue(undefined);

		const result = await createSiblingChallenge(
			{
				title: challenge.title,
				challengeType: 'cooperative',
				periodType: 'weekly',
				startDate: '2026-04-01',
				endDate: '2026-04-07',
				targetConfig: challenge.targetConfig,
				rewardConfig: '{"points":100}',
			},
			TENANT,
		);

		expect(result.id).toBe(1);
		expect(mockEnrollChildren).toHaveBeenCalledWith(
			1,
			[
				{ childId: 1, targetValue: 3 },
				{ childId: 2, targetValue: 6 },
			],
			TENANT,
		);
	});
});

describe('getAllChallengesWithProgress', () => {
	it('全チャレンジに進捗を付与して返す', async () => {
		mockFindAllChallenges.mockResolvedValue([makeChallenge()]);
		mockFindProgressByChallenge.mockResolvedValue([
			{ childId: 1, currentValue: 2, targetValue: 3, completed: 0, rewardClaimed: 0 },
			{ childId: 2, currentValue: 3, targetValue: 3, completed: 1, rewardClaimed: 0 },
		]);

		const result = await getAllChallengesWithProgress(TENANT);
		expect(result).toHaveLength(1);
		expect(result[0]?.progress).toHaveLength(2);
		expect(result[0]?.allCompleted).toBe(false);
	});

	it('全員完了で allCompleted = true', async () => {
		mockFindAllChallenges.mockResolvedValue([makeChallenge()]);
		mockFindProgressByChallenge.mockResolvedValue([
			{ childId: 1, currentValue: 3, targetValue: 3, completed: 1, rewardClaimed: 0 },
			{ childId: 2, currentValue: 3, targetValue: 3, completed: 1, rewardClaimed: 0 },
		]);

		const result = await getAllChallengesWithProgress(TENANT);
		expect(result[0]?.allCompleted).toBe(true);
	});
});

describe('checkChallengeProgress', () => {
	it('カテゴリが一致する場合、進捗をインクリメント', async () => {
		const challenge = makeChallenge();
		mockFindActiveChallenges.mockResolvedValue([challenge]);
		mockFindProgress.mockResolvedValue({
			childId: 1,
			currentValue: 1,
			targetValue: 3,
			completed: 0,
			rewardClaimed: 0,
		});
		mockUpsertProgress.mockResolvedValue(undefined);
		mockFindProgressByChallenge.mockResolvedValue([
			{ childId: 1, currentValue: 2, targetValue: 3, completed: 0 },
			{ childId: 2, currentValue: 1, targetValue: 3, completed: 0 },
		]);

		const results = await checkChallengeProgress(1, 10, 1, TENANT);
		expect(results).toHaveLength(1);
		expect(mockUpsertProgress).toHaveBeenCalledWith(1, 1, 2, 3, TENANT);
		expect(mockMarkCompleted).not.toHaveBeenCalled();
	});

	it('カテゴリが不一致の場合、スキップ', async () => {
		const challenge = makeChallenge();
		mockFindActiveChallenges.mockResolvedValue([challenge]);

		const results = await checkChallengeProgress(1, 10, 2, TENANT);
		expect(results).toHaveLength(0);
		expect(mockFindProgress).not.toHaveBeenCalled();
	});

	it('ターゲット達成時に markCompleted が呼ばれる', async () => {
		const challenge = makeChallenge();
		mockFindActiveChallenges.mockResolvedValue([challenge]);
		mockFindProgress.mockResolvedValue({
			childId: 1,
			currentValue: 2,
			targetValue: 3,
			completed: 0,
			rewardClaimed: 0,
		});
		mockUpsertProgress.mockResolvedValue(undefined);
		mockMarkCompleted.mockResolvedValue(undefined);
		mockFindProgressByChallenge.mockResolvedValue([
			{ childId: 1, currentValue: 3, targetValue: 3, completed: 1 },
			{ childId: 2, currentValue: 3, targetValue: 3, completed: 1 },
		]);
		mockUpdateChallenge.mockResolvedValue(undefined);

		const results = await checkChallengeProgress(1, 10, 1, TENANT);
		expect(mockMarkCompleted).toHaveBeenCalledWith(1, 1, TENANT);
		expect(results[0]?.allSiblingsComplete).toBe(true);
	});

	it('既に完了済みの進捗はスキップ', async () => {
		const challenge = makeChallenge();
		mockFindActiveChallenges.mockResolvedValue([challenge]);
		mockFindProgress.mockResolvedValue({
			childId: 1,
			currentValue: 3,
			targetValue: 3,
			completed: 1,
			rewardClaimed: 0,
		});

		const results = await checkChallengeProgress(1, 10, 1, TENANT);
		expect(results).toHaveLength(0);
		expect(mockUpsertProgress).not.toHaveBeenCalled();
	});
});

describe('claimChallengeReward', () => {
	it('協力チャレンジ: 全員達成済みで報酬受取', async () => {
		const challenge = makeChallenge();
		mockFindChallengeById.mockResolvedValue(challenge);
		mockFindProgressByChallenge.mockResolvedValue([
			{ childId: 1, completed: 1, rewardClaimed: 0 },
			{ childId: 2, completed: 1, rewardClaimed: 0 },
		]);
		mockFindProgress.mockResolvedValue({
			childId: 1,
			completed: 1,
			rewardClaimed: 0,
		});
		mockInsertPointLedger.mockResolvedValue(undefined);
		mockClaimReward.mockResolvedValue(undefined);

		const result = await claimChallengeReward(1, 1, TENANT);
		expect(result).toEqual({ points: 100, message: 'すごい！' });
		expect(mockInsertPointLedger).toHaveBeenCalledWith(
			expect.objectContaining({ childId: 1, amount: 100, type: 'sibling_challenge' }),
			TENANT,
		);
		expect(mockClaimReward).toHaveBeenCalledWith(1, 1, TENANT);
	});

	it('協力チャレンジ: 全員未達成で拒否', async () => {
		const challenge = makeChallenge();
		mockFindChallengeById.mockResolvedValue(challenge);
		mockFindProgressByChallenge.mockResolvedValue([
			{ childId: 1, completed: 1, rewardClaimed: 0 },
			{ childId: 2, completed: 0, rewardClaimed: 0 },
		]);

		const result = await claimChallengeReward(1, 1, TENANT);
		expect(result).toEqual({ error: 'まだ全員クリアしていません' });
		expect(mockInsertPointLedger).not.toHaveBeenCalled();
	});

	it('二重受取は拒否', async () => {
		const challenge = makeChallenge();
		mockFindChallengeById.mockResolvedValue(challenge);
		mockFindProgressByChallenge.mockResolvedValue([
			{ childId: 1, completed: 1, rewardClaimed: 1 },
			{ childId: 2, completed: 1, rewardClaimed: 0 },
		]);
		mockFindProgress.mockResolvedValue({
			childId: 1,
			completed: 1,
			rewardClaimed: 1,
		});

		const result = await claimChallengeReward(1, 1, TENANT);
		expect(result).toEqual({ error: 'すでに受け取り済みです' });
	});

	it('競争チャレンジ: 自分だけ達成済みで報酬受取OK', async () => {
		const challenge = makeChallenge({ challengeType: 'competitive' });
		mockFindChallengeById.mockResolvedValue(challenge);
		mockFindProgress
			.mockResolvedValueOnce({ childId: 1, completed: 1, rewardClaimed: 0 })
			.mockResolvedValueOnce({ childId: 1, completed: 1, rewardClaimed: 0 });
		mockInsertPointLedger.mockResolvedValue(undefined);
		mockClaimReward.mockResolvedValue(undefined);

		const result = await claimChallengeReward(1, 1, TENANT);
		expect(result).toEqual({ points: 100, message: 'すごい！' });
	});
});

describe('checkAllSiblingsComplete', () => {
	it('全員完了で true', async () => {
		mockFindProgressByChallenge.mockResolvedValue([
			{ childId: 1, completed: 1 },
			{ childId: 2, completed: 1 },
		]);
		expect(await checkAllSiblingsComplete(1, TENANT)).toBe(true);
	});

	it('一人でも未完了なら false', async () => {
		mockFindProgressByChallenge.mockResolvedValue([
			{ childId: 1, completed: 1 },
			{ childId: 2, completed: 0 },
		]);
		expect(await checkAllSiblingsComplete(1, TENANT)).toBe(false);
	});

	it('進捗がゼロなら false', async () => {
		mockFindProgressByChallenge.mockResolvedValue([]);
		expect(await checkAllSiblingsComplete(1, TENANT)).toBe(false);
	});
});

describe('deleteSiblingChallenge', () => {
	it('削除がレポに委譲される', async () => {
		mockDeleteChallenge.mockResolvedValue(undefined);
		await deleteSiblingChallenge(1, TENANT);
		expect(mockDeleteChallenge).toHaveBeenCalledWith(1, TENANT);
	});
});
