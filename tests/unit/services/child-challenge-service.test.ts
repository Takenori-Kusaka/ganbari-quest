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
const mockGetOrCreateWeeklyAuto = vi.fn();
const mockInsertBulk = vi.fn();
const mockFindAllByTenant = vi.fn();
const mockFindByChildId = vi.fn();
const mockFindActiveByChildId = vi.fn();
const mockFindActiveOrUnclaimedByChildId = vi.fn();
const mockUpdateProgress = vi.fn();
const mockMarkCompleted = vi.fn();
const mockFindById = vi.fn();
const mockClaimReward = vi.fn();
const mockFindAllChildren = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		childChallenge: {
			insert: (...a: unknown[]) => mockInsert(...a),
			getOrCreateWeeklyAuto: (...a: unknown[]) => mockGetOrCreateWeeklyAuto(...a),
			insertBulk: (...a: unknown[]) => mockInsertBulk(...a),
			findAllByTenant: (...a: unknown[]) => mockFindAllByTenant(...a),
			findByChildId: (...a: unknown[]) => mockFindByChildId(...a),
			findActiveByChildId: (...a: unknown[]) => mockFindActiveByChildId(...a),
			findActiveOrUnclaimedByChildId: (...a: unknown[]) => mockFindActiveOrUnclaimedByChildId(...a),
			updateProgress: (...a: unknown[]) => mockUpdateProgress(...a),
			markCompleted: (...a: unknown[]) => mockMarkCompleted(...a),
			findById: (...a: unknown[]) => mockFindById(...a),
			claimReward: (...a: unknown[]) => mockClaimReward(...a),
		},
	}),
}));

// #3213: 生成アルゴリズム (computeProposal / getWeekStart / getLastWeekStart / aggregateCategoryCounts)
// は child-challenge-service へ移設したため実物を使い、その内部依存である
// activity-log-aggregation.aggregateActivityLogsByCategory のみ mock する。
// aggregateCategoryCounts は内部で aggregateActivityLogsByCategory().summary.byCategory[id].count を
// 読むため、テストの「カテゴリ別記録数 map」を summary 形に変換して mock 戻り値に詰める。
const mockAggregateActivityLogsByCategory = vi.fn();
/** カテゴリ別記録数 map → aggregateActivityLogsByCategory().summary.byCategory 形に変換して mock させる */
function mockCategoryCounts(counts: Record<number, number>): void {
	const byCategory: Record<number, { count: number; points: number }> = {};
	for (const [id, count] of Object.entries(counts)) {
		byCategory[Number(id)] = { count, points: 0 };
	}
	mockAggregateActivityLogsByCategory.mockResolvedValue({
		logs: [],
		summary: { totalCount: 0, totalPoints: 0, byCategory },
	});
}
vi.mock('$lib/server/services/activity-log-aggregation', () => ({
	aggregateActivityLogsByCategory: (...a: unknown[]) => mockAggregateActivityLogsByCategory(...a),
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

import { insertPointLedger } from '../../../src/lib/server/db/activity-repo';
import {
	buildPerChildTargets,
	type ChallengePrev,
	calcAgeAdjustedTarget,
	claimChildChallengeReward,
	computeProposal,
	createChildChallenge,
	createChildChallengesBulk,
	getActiveChildChallengesWithSiblings,
	getChallengeGroupsForAdmin,
	getLastWeekStart,
	getOrCreateWeeklyChildChallenge,
	getWeekStart,
	updateChildChallengeProgress,
} from '../../../src/lib/server/services/child-challenge-service';

const TENANT = 'test-tenant-001';

beforeEach(() => {
	vi.clearAllMocks();
});

// ============================================================
// 週次チャレンジ生成アルゴリズム (#3194 / #3213、旧 auto-challenge-service.test.ts より移設)
// auto_challenges 廃止 (#3213) に伴い computeProposal / getWeekStart / getLastWeekStart は
// child-challenge-service へ移設したため、#3194 で強化したアルゴリズム挙動
// (苦手中心＋時々得意＋翌週適応＋consecutiveMissCount) の回帰テストも本ファイルへ移設する。
// ============================================================

// computeProposal は (counts, prev, weekStart) を取る純粋関数。
// weekIndexOf(weekStart) % 4 === 0 を「得意週」とするため、テストの weekStart は週インデックスで選ぶ。
// 2026-01-05(月) の週インデックスは 2922 (= 2922 % 4 = 2 → 非得意週)。得意週検証用に別 weekStart を使う。
const WEEK_WEAKNESS = '2026-01-05'; // 非得意週 (weekIndex % 4 !== 0)
function algoCounts(byId: Record<number, number>): Record<number, number> {
	return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, ...byId };
}
function makePrev(over: Partial<ChallengePrev> = {}): ChallengePrev {
	return {
		categoryId: 2,
		targetCount: 3,
		currentCount: 0,
		status: 'expired',
		consecutiveMissCount: 0,
		...over,
	};
}

describe('getWeekStart (#3213 移設)', () => {
	it('returns Monday for a Monday date', () => {
		// 2026-04-06 is a Monday
		expect(getWeekStart(new Date(2026, 3, 6))).toBe('2026-04-06');
	});

	it('returns previous Monday for a Wednesday', () => {
		// 2026-04-08 is a Wednesday
		expect(getWeekStart(new Date(2026, 3, 8))).toBe('2026-04-06');
	});

	it('returns previous Monday for a Sunday', () => {
		// 2026-04-12 is a Sunday
		expect(getWeekStart(new Date(2026, 3, 12))).toBe('2026-04-06');
	});

	it('returns previous Monday for a Saturday', () => {
		// 2026-04-11 is a Saturday
		expect(getWeekStart(new Date(2026, 3, 11))).toBe('2026-04-06');
	});
});

describe('getLastWeekStart (#3213 移設)', () => {
	it('returns the Monday 7 days before the given weekStart', () => {
		expect(getLastWeekStart('2026-01-05')).toBe('2025-12-29');
	});
});

describe('computeProposal — カテゴリ選択 (§3.4、#3194 / #3213 移設)', () => {
	const STRENGTH_WEEK = '2026-01-19'; // weekIndex % 4 === 0 → 得意週

	it('データ不足なら explore モード (target=最小2)', () => {
		const p = computeProposal(algoCounts({ 1: 2 }), undefined, WEEK_WEAKNESS);
		expect(p.mode).toBe('explore');
		expect(p.targetCount).toBe(2);
		expect(p.reason).toContain('まだ記録が少ない');
	});

	it('通常週は weakness モード (target は 2〜7 に収まる)', () => {
		const p = computeProposal(
			algoCounts({ 1: 8, 2: 6, 3: 4, 4: 2, 5: 0 }),
			undefined,
			WEEK_WEAKNESS,
		);
		expect(p.mode).toBe('weakness');
		expect(p.targetCount).toBeGreaterThanOrEqual(2);
		expect(p.targetCount).toBeLessThanOrEqual(7);
		expect(p.consecutiveMissCount).toBe(0);
	});

	it('得意週は strength モードで最多カテゴリを選ぶ', () => {
		const p = computeProposal(algoCounts({ 1: 8, 5: 0 }), undefined, STRENGTH_WEEK);
		expect(p.mode).toBe('strength');
		expect(p.categoryId).toBe(1); // 最多 = うんどう
		expect(p.targetCount).toBe(5); // avg 4 → base clamp(5,2,7)
	});
});

describe('computeProposal — 翌週適応 (Flow 3 分岐、#3194 / #3213 移設)', () => {
	const STRENGTH_WEEK = '2026-01-19';

	it('前週完了 + 大幅超過なら target を上げる (+2)', () => {
		// 得意週 → 最多カテゴリ1 を決定的に選択。prev も cat1 完了で overshoot 2
		const prev = makePrev({ categoryId: 1, status: 'completed', targetCount: 5, currentCount: 7 });
		const p = computeProposal(algoCounts({ 1: 4 }), prev, STRENGTH_WEEK);
		expect(p.categoryId).toBe(1);
		expect(p.targetCount).toBe(7); // max(base3, 5+2)=7
	});

	it('前週未達 (半分以上) なら据え置き', () => {
		const prev = makePrev({ categoryId: 1, status: 'expired', targetCount: 5, currentCount: 3 });
		const p = computeProposal(algoCounts({ 1: 4 }), prev, STRENGTH_WEEK);
		expect(p.targetCount).toBe(5); // ratio 0.6 → 据置
		expect(p.consecutiveMissCount).toBe(1);
	});

	it('前週未達 (半分未満) なら 1 下げる', () => {
		const prev = makePrev({ categoryId: 1, status: 'expired', targetCount: 5, currentCount: 1 });
		const p = computeProposal(algoCounts({ 1: 4 }), prev, STRENGTH_WEEK);
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
		const p = computeProposal(algoCounts({ 1: 6 }), prev, WEEK_WEAKNESS);
		expect(p.mode).toBe('rescue-strength');
		expect(p.categoryId).toBe(1); // 最多 = 得意
		expect(p.targetCount).toBe(2); // MIN_TARGET
		expect(p.consecutiveMissCount).toBe(2);
	});

	it('前週完了なら連続未達カウントは 0 にリセット', () => {
		const prev = makePrev({ status: 'completed', consecutiveMissCount: 3 });
		const p = computeProposal(algoCounts({ 1: 8, 2: 4 }), prev, WEEK_WEAKNESS);
		expect(p.consecutiveMissCount).toBe(0);
	});
});

describe('getOrCreateWeeklyChildChallenge (#3195 アプリ自動生成)', () => {
	it('当週分が無ければ child_challenges を自動生成する (targetConfig に metric/categoryId/genMode 内包)', async () => {
		mockFindByChildId.mockResolvedValue([]); // 既存なし
		mockCategoryCounts({ 1: 8, 2: 6, 3: 4, 4: 2, 5: 0 });
		// #3245: 生成は atomic な getOrCreateWeeklyAuto 経由
		mockGetOrCreateWeeklyAuto.mockImplementation(async (input) => ({
			id: 1,
			currentValue: 0,
			completed: 0,
			...input,
		}));

		await getOrCreateWeeklyChildChallenge(10, TENANT);

		expect(mockGetOrCreateWeeklyAuto).toHaveBeenCalledTimes(1);
		const input = mockGetOrCreateWeeklyAuto.mock.calls[0]?.[0];
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
		const { getWeekStart } = await import(
			'../../../src/lib/server/services/child-challenge-service'
		);
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
		expect(mockGetOrCreateWeeklyAuto).not.toHaveBeenCalled();
		expect(mockInsert).not.toHaveBeenCalled();
		expect(mockAggregateActivityLogsByCategory).not.toHaveBeenCalled();
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

// #3333 (C): claimChildChallengeReward の fail-closed gating + per-child 受取意図の回帰テスト。
// 設計意図 (確定根拠): 旧 ChallengeBanner は `completed===1 && rewardClaimed===0`（= 自身の instance
// 個別完了）で受取 form を出していた (#2488 must-1 コメント参照)。受取は per-child instance ごとで
// (ADR-0055 per-child 報酬モデル / claimChildChallengeReward は childId 一致 instance のみ claim)、
// 兄弟全完了 (allCompleted) を受取条件にしてはならない。server は以下を fail-closed で守る。
function challengeRow(over: Record<string, unknown> = {}) {
	return {
		id: 10,
		childId: 902,
		title: 'P',
		completed: 1,
		currentValue: 5,
		targetValue: 5,
		targetConfig: '{"metric":"count","categoryId":1,"baseTarget":5}',
		rewardConfig: '{"points":30,"message":"よくがんばったね"}',
		description: null,
		challengeType: 'cooperative',
		periodType: 'weekly',
		startDate: '2026-05-25',
		endDate: '2026-06-01',
		status: 'completed',
		isActive: 1,
		completedAt: '2026-05-30T00:00:00Z',
		rewardClaimed: 0,
		rewardClaimedAt: null,
		sourceTemplateId: 'auto:weekly',
		createdAt: '',
		updatedAt: '',
		...over,
	};
}

describe('claimChildChallengeReward — fail-closed gating (#3333 C / per-child)', () => {
	it('自身の instance が completed=1 && rewardClaimed=0 → 受取成功（兄弟未完了は無関係 = per-child）', async () => {
		mockFindById.mockResolvedValueOnce(challengeRow({ completed: 1, rewardClaimed: 0 }));
		const result = await claimChildChallengeReward(10, 902, TENANT);
		expect('points' in result && result.points).toBe(30);
		// point ledger は 1 回だけ加算（二重付与なし）
		expect(vi.mocked(insertPointLedger)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(insertPointLedger)).toHaveBeenCalledWith(
			expect.objectContaining({
				childId: 902,
				amount: 30,
				type: 'child_challenge',
				referenceId: 10,
			}),
			TENANT,
		);
		expect(mockClaimReward).toHaveBeenCalledWith(10, TENANT);
	});

	it('未完了 (completed=0) → 「まだクリアしていません」で fail-closed（ledger 加算なし）', async () => {
		mockFindById.mockResolvedValueOnce(challengeRow({ completed: 0, currentValue: 2 }));
		const result = await claimChildChallengeReward(10, 902, TENANT);
		expect('error' in result && result.error).toBe('まだクリアしていません');
		expect(vi.mocked(insertPointLedger)).not.toHaveBeenCalled();
		expect(mockClaimReward).not.toHaveBeenCalled();
	});

	it('既請求 (rewardClaimed=1) → 「すでに受け取り済みです」で fail-closed（二重請求拒否）', async () => {
		mockFindById.mockResolvedValueOnce(challengeRow({ rewardClaimed: 1 }));
		const result = await claimChildChallengeReward(10, 902, TENANT);
		expect('error' in result && result.error).toBe('すでに受け取り済みです');
		expect(vi.mocked(insertPointLedger)).not.toHaveBeenCalled();
		expect(mockClaimReward).not.toHaveBeenCalled();
	});

	it('別 child の instance (childId 不一致) → 受取拒否（IDOR fail-closed）', async () => {
		mockFindById.mockResolvedValueOnce(challengeRow({ childId: 903 }));
		const result = await claimChildChallengeReward(10, 902, TENANT);
		expect('error' in result && result.error).toBe('このチャレンジは別のお子さま用です');
		expect(vi.mocked(insertPointLedger)).not.toHaveBeenCalled();
	});

	it('存在しない instance → 受取拒否', async () => {
		mockFindById.mockResolvedValueOnce(undefined);
		const result = await claimChildChallengeReward(999, 902, TENANT);
		expect('error' in result && result.error).toBe('チャレンジが見つかりません');
		expect(vi.mocked(insertPointLedger)).not.toHaveBeenCalled();
	});

	it('二重 claim: 1 回目成功後に再請求 → 2 回目は既請求拒否で ledger 二重加算しない', async () => {
		// 1 回目: 未請求 → 成功
		mockFindById.mockResolvedValueOnce(challengeRow({ rewardClaimed: 0 }));
		await claimChildChallengeReward(10, 902, TENANT);
		// 2 回目: claimReward 後の状態 (rewardClaimed=1) を返す → fail-closed
		mockFindById.mockResolvedValueOnce(challengeRow({ rewardClaimed: 1 }));
		const second = await claimChildChallengeReward(10, 902, TENANT);
		expect('error' in second && second.error).toBe('すでに受け取り済みです');
		// ledger は 1 回目の 1 回のみ
		expect(vi.mocked(insertPointLedger)).toHaveBeenCalledTimes(1);
		expect(mockClaimReward).toHaveBeenCalledTimes(1);
	});
});
