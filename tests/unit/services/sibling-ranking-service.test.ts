import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindAllChildren = vi.fn();
const mockGetSetting = vi.fn();
const mockFindActivityLogs = vi.fn();

vi.mock('$lib/server/db/child-repo', () => ({
	findAllChildren: (...args: unknown[]) => mockFindAllChildren(...args),
}));

vi.mock('$lib/server/db/settings-repo', () => ({
	getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

vi.mock('$lib/server/db/activity-repo', () => ({
	findActivityLogs: (...args: unknown[]) => mockFindActivityLogs(...args),
}));

import { getWeeklyRanking, isRankingEnabled } from '$lib/server/services/sibling-ranking-service';

const TENANT = 'test-tenant';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('isRankingEnabled', () => {
	it('設定が "false" ならランキング無効', async () => {
		mockGetSetting.mockResolvedValue('false');
		expect(await isRankingEnabled(TENANT)).toBe(false);
	});

	it('設定が "true" ならランキング有効', async () => {
		mockGetSetting.mockResolvedValue('true');
		expect(await isRankingEnabled(TENANT)).toBe(true);
	});

	it('設定が null（未設定）ならランキング無効（デフォルトOFF）', async () => {
		mockGetSetting.mockResolvedValue(null);
		expect(await isRankingEnabled(TENANT)).toBe(false);
	});
});

describe('getWeeklyRanking', () => {
	it('子供が0人の場合、空ランキングを返す', async () => {
		mockFindAllChildren.mockResolvedValue([]);
		const result = await getWeeklyRanking(TENANT);
		expect(result.rankings).toHaveLength(0);
		expect(result.mostActive).toBeNull();
		expect(result.encouragement).toBe('きょうもがんばろう！');
	});

	it('1人家庭でも正常にランキング返却', async () => {
		mockFindAllChildren.mockResolvedValue([{ id: 1, nickname: 'ゆい', age: 5 }]);
		mockFindActivityLogs.mockResolvedValue([
			{ categoryId: 1, points: 10 },
			{ categoryId: 1, points: 10 },
			{ categoryId: 2, points: 10 },
		]);

		const result = await getWeeklyRanking(TENANT);
		expect(result.rankings).toHaveLength(1);
		expect(result.rankings[0]?.totalCount).toBe(3);
		expect(result.mostActive?.childName).toBe('ゆい');
		expect(result.encouragement).toBe('がんばってるね！');
	});

	it('2人きょうだいでランキング算出', async () => {
		mockFindAllChildren.mockResolvedValue([
			{ id: 1, nickname: 'ゆい', age: 5 },
			{ id: 2, nickname: 'けん', age: 8 },
		]);
		// ゆい: 3回（カテゴリ1:2, カテゴリ2:1）
		mockFindActivityLogs.mockImplementation((childId: number) => {
			if (childId === 1) {
				return Promise.resolve([
					{ categoryId: 1, points: 10 },
					{ categoryId: 1, points: 10 },
					{ categoryId: 2, points: 10 },
				]);
			}
			// けん: 5回（カテゴリ1:1, カテゴリ3:4）
			return Promise.resolve([
				{ categoryId: 1, points: 10 },
				{ categoryId: 3, points: 10 },
				{ categoryId: 3, points: 10 },
				{ categoryId: 3, points: 10 },
				{ categoryId: 3, points: 10 },
			]);
		});

		const result = await getWeeklyRanking(TENANT);
		expect(result.rankings).toHaveLength(2);
		// けんが1位（5回）
		expect(result.rankings[0]?.childName).toBe('けん');
		expect(result.rankings[0]?.totalCount).toBe(5);
		// ゆいが2位（3回）
		expect(result.rankings[1]?.childName).toBe('ゆい');

		expect(result.mostActive?.childName).toBe('けん');
		expect(result.mostActive?.count).toBe(5);

		// カテゴリ別チャンピオン
		expect(result.categoryChampions[1]?.childName).toBe('ゆい'); // カテゴリ1: ゆい2回 > けん1回
		expect(result.categoryChampions[3]?.childName).toBe('けん'); // カテゴリ3: けん4回
	});

	it('全員0回の場合、mostActive は null', async () => {
		mockFindAllChildren.mockResolvedValue([
			{ id: 1, nickname: 'ゆい', age: 5 },
			{ id: 2, nickname: 'けん', age: 8 },
		]);
		mockFindActivityLogs.mockResolvedValue([]);

		const result = await getWeeklyRanking(TENANT);
		expect(result.mostActive).toBeNull();
		expect(result.encouragement).toBe('きょうもがんばろう！');
	});

	it('合計20回以上で最高の励ましメッセージ', async () => {
		mockFindAllChildren.mockResolvedValue([
			{ id: 1, nickname: 'ゆい', age: 5 },
			{ id: 2, nickname: 'けん', age: 8 },
		]);
		const manyLogs = Array.from({ length: 12 }, () => ({ categoryId: 1, points: 10 }));
		mockFindActivityLogs.mockResolvedValue(manyLogs);

		const result = await getWeeklyRanking(TENANT);
		// 12 * 2 = 24 >= 20
		expect(result.encouragement).toBe('みんなすごい！かぞくのチカラだね！');
	});
});
