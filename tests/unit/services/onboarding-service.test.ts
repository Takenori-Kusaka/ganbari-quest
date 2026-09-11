import { asChildId, type ChildId } from '$lib/domain/ids';
import { ONBOARDING_LABELS } from '$lib/domain/labels';
// tests/unit/services/onboarding-service.test.ts
// onboarding-service ユニットテスト

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Top-level mocks ----

const mockGetAllChildren = vi.fn();
const mockGetActivities = vi.fn();
const mockGetSetting = vi.fn();
const mockSetSetting = vi.fn();
const mockFindTemplatesByChild = vi.fn();
const mockGetChildSpecialRewards = vi.fn();

vi.mock('$lib/server/db/checklist-repo', () => ({
	findTemplatesByChild: (...args: unknown[]) => mockFindTemplatesByChild(...args),
}));

vi.mock('$lib/server/db/settings-repo', () => ({
	getSetting: (...args: unknown[]) => mockGetSetting(...args),
	setSetting: (...args: unknown[]) => mockSetSetting(...args),
}));

vi.mock('$lib/server/services/activity-service', () => ({
	getActivities: (...args: unknown[]) => mockGetActivities(...args),
}));

vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: (...args: unknown[]) => mockGetAllChildren(...args),
}));

// #4910: onboarding の rewards 完了判定は per-child reward (`getChildSpecialRewards`)
// を見る。旧実装が読んでいた family scope の `getRewardTemplates`（「特別なごほうび」
// template、setup 4/9 の実取込先ではない別表）はここではもう参照しない。
vi.mock('$lib/server/services/special-reward-service', () => ({
	getChildSpecialRewards: (...args: unknown[]) => mockGetChildSpecialRewards(...args),
}));

import {
	dismissOnboarding,
	getOnboardingProgress,
	markChildScreenVisited,
} from '$lib/server/services/onboarding-service';

// ---- Helpers ----

const TENANT = 'test-tenant';
const BASE_PATH = '/parent/manage';

function setupDefaults(
	overrides: {
		children?: { id: ChildId }[];
		activities?: { id: number }[];
		pinHash?: string | null;
		dismissed?: string | null;
		childScreenVisited?: string | null;
		templatesByChild?: Record<string, unknown[]>;
		/** #4910: per-child reward (`special_rewards` 相当)。setup 4/9 の実取込先。 */
		rewardsByChild?: Record<string, unknown[]>;
	} = {},
) {
	const {
		children = [],
		activities = [],
		pinHash = null,
		dismissed = null,
		childScreenVisited = null,
		templatesByChild = {},
		rewardsByChild = {},
	} = overrides;

	mockGetAllChildren.mockResolvedValue(children);
	mockGetActivities.mockResolvedValue(activities);

	mockGetSetting.mockImplementation((key: string, _tenantId: string) => {
		if (key === 'pin_hash') return Promise.resolve(pinHash);
		if (key === 'onboarding_dismissed') return Promise.resolve(dismissed);
		if (key === 'onboarding_child_screen_visited') return Promise.resolve(childScreenVisited);
		return Promise.resolve(null);
	});

	mockFindTemplatesByChild.mockImplementation((childId: ChildId) => {
		return Promise.resolve(templatesByChild[childId] ?? []);
	});

	mockGetChildSpecialRewards.mockImplementation((childId: ChildId) => {
		const rewards = rewardsByChild[childId] ?? [];
		return Promise.resolve({
			rewards,
			totalPoints: rewards.reduce(
				(sum: number, r) => sum + ((r as { points?: number }).points ?? 0),
				0,
			),
		});
	});

	mockSetSetting.mockResolvedValue(undefined);
}

// ---- Tests ----

describe('onboarding-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('getOnboardingProgress', () => {
		it('全項目未完了: 子供なし・活動なし・ごほうびなし・PINなし・チェックリストなし・未訪問', async () => {
			setupDefaults();

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			expect(result.completedCount).toBe(0);
			expect(result.totalCount).toBe(6);
			expect(result.allCompleted).toBe(false);
			expect(result.dismissed).toBe(false);

			for (const item of result.items) {
				expect(item.completed).toBe(false);
			}
		});

		it('全項目完了 + dismissed', async () => {
			setupDefaults({
				children: [{ id: asChildId(1) }],
				activities: [{ id: 10 }],
				rewardsByChild: { 1: [{ id: 'r1', title: 'アイス', points: 30 }] },
				pinHash: 'hashed-pin-value',
				dismissed: 'true',
				childScreenVisited: 'true',
				templatesByChild: { 1: [{ id: '100' }] },
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			expect(result.completedCount).toBe(6);
			expect(result.totalCount).toBe(6);
			expect(result.allCompleted).toBe(true);
			expect(result.dismissed).toBe(true);
			expect(result.nextRecommendation).toBeNull();

			for (const item of result.items) {
				expect(item.completed).toBe(true);
			}
		});

		it('部分的な完了: 子供あり・活動あり・ごほうびなし・PINなし・チェックリストなし・未訪問', async () => {
			setupDefaults({
				children: [{ id: asChildId(1) }],
				activities: [{ id: 10 }],
				templatesByChild: {},
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			expect(result.completedCount).toBe(2);
			expect(result.totalCount).toBe(6);
			expect(result.allCompleted).toBe(false);

			// children: completed, activities: completed
			expect(result.items[0]?.completed).toBe(true);
			expect(result.items[1]?.completed).toBe(true);
			// rewards: incomplete, pin: incomplete, checklist: incomplete, child_screen: incomplete
			expect(result.items[2]?.completed).toBe(false);
			expect(result.items[3]?.completed).toBe(false);
			expect(result.items[4]?.completed).toBe(false);
			expect(result.items[5]?.completed).toBe(false);
		});

		it('nextRecommendation は最初の未完了項目を指す', async () => {
			// children completed, activities incomplete => nextRecommendation = activities
			setupDefaults({
				children: [{ id: asChildId(1) }],
				activities: [],
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			expect(result.nextRecommendation).not.toBeNull();
			expect(result.nextRecommendation?.key).toBe('activities');
			expect(result.nextRecommendation?.href).toBe(`${BASE_PATH}/activities`);
		});

		it('全完了時は nextRecommendation が null', async () => {
			setupDefaults({
				children: [{ id: asChildId(1) }],
				activities: [{ id: 10 }],
				rewardsByChild: { 1: [{ id: 'r1', title: 'アイス', points: 30 }] },
				pinHash: 'some-hash',
				childScreenVisited: 'true',
				templatesByChild: { 1: [{ id: '100' }] },
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			expect(result.nextRecommendation).toBeNull();
			expect(result.allCompleted).toBe(true);
		});

		it('completedCount と totalCount が正しい', async () => {
			// 3 items completed: children, activities, pin
			setupDefaults({
				children: [{ id: asChildId(1) }],
				activities: [{ id: 10 }],
				pinHash: 'hash123',
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			expect(result.completedCount).toBe(3);
			expect(result.totalCount).toBe(6);
		});

		it('basePath が href に正しく適用される', async () => {
			const customBase = '/custom/path';
			setupDefaults();

			const result = await getOnboardingProgress(TENANT, customBase);

			expect(result.items[0]?.href).toBe('/custom/path/children');
			expect(result.items[1]?.href).toBe('/custom/path/activities');
			expect(result.items[2]?.href).toBe('/custom/path/rewards');
			expect(result.items[3]?.href).toBe('/custom/path/settings');
			expect(result.items[4]?.href).toBe('/custom/path/checklists');
			// child_screen is always /switch regardless of basePath
			expect(result.items[5]?.href).toBe('/switch');
		});

		it('children 項目の href は /admin/children (members ではない) を指す (#1363)', async () => {
			setupDefaults();

			const result = await getOnboardingProgress(TENANT, '/admin');

			const childrenItem = result.items.find((i) => i.key === 'children');
			expect(childrenItem?.href).toBe('/admin/children');
		});

		it('子供がテンプレートを持っている場合 checklist は completed', async () => {
			setupDefaults({
				children: [{ id: asChildId(1) }],
				templatesByChild: { 1: [{ id: '100', name: 'template-1' }] },
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			const checklistItem = result.items.find((i) => i.key === 'checklist');
			expect(checklistItem?.completed).toBe(true);
		});

		it('複数の子供: 最初はテンプレートなし・2人目がテンプレートあり → checklist completed', async () => {
			setupDefaults({
				children: [{ id: asChildId(1) }, { id: asChildId(2) }],
				templatesByChild: {
					// child 1: no templates (empty array is default)
					2: [{ id: '200', name: 'template-for-child-2' }],
				},
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			const checklistItem = result.items.find((i) => i.key === 'checklist');
			expect(checklistItem?.completed).toBe(true);

			// findTemplatesByChild should be called for both children
			expect(mockFindTemplatesByChild).toHaveBeenCalledTimes(2);
			expect(mockFindTemplatesByChild).toHaveBeenCalledWith('1', TENANT, false);
			expect(mockFindTemplatesByChild).toHaveBeenCalledWith('2', TENANT, false);
		});

		it('複数の子供: 全員テンプレートなし → checklist incomplete', async () => {
			setupDefaults({
				children: [{ id: asChildId(1) }, { id: asChildId(2) }, { id: asChildId(3) }],
				templatesByChild: {},
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			const checklistItem = result.items.find((i) => i.key === 'checklist');
			expect(checklistItem?.completed).toBe(false);
			expect(mockFindTemplatesByChild).toHaveBeenCalledTimes(3);
		});

		it('最初の子供にテンプレートがある場合、2人目はチェックしない（早期break）', async () => {
			setupDefaults({
				children: [{ id: asChildId(1) }, { id: asChildId(2) }],
				templatesByChild: {
					1: [{ id: '100' }],
					2: [{ id: '200' }],
				},
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			const checklistItem = result.items.find((i) => i.key === 'checklist');
			expect(checklistItem?.completed).toBe(true);
			// Early break: only child 1 checked since it already had templates
			expect(mockFindTemplatesByChild).toHaveBeenCalledTimes(1);
			expect(mockFindTemplatesByChild).toHaveBeenCalledWith('1', TENANT, false);
		});

		it('dismissed フラグが settings から正しく読み取られる', async () => {
			setupDefaults({ dismissed: 'true' });

			const result = await getOnboardingProgress(TENANT, BASE_PATH);
			expect(result.dismissed).toBe(true);
		});

		it('dismissed が null の場合は false', async () => {
			setupDefaults({ dismissed: null });

			const result = await getOnboardingProgress(TENANT, BASE_PATH);
			expect(result.dismissed).toBe(false);
		});

		it('dismissed が "false" の場合も false', async () => {
			setupDefaults({ dismissed: 'false' });

			const result = await getOnboardingProgress(TENANT, BASE_PATH);
			expect(result.dismissed).toBe(false);
		});

		it('childScreenVisited が "true" 以外の場合 child_screen は incomplete', async () => {
			setupDefaults({ childScreenVisited: 'false' });

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			const childScreenItem = result.items.find((i) => i.key === 'child_screen');
			expect(childScreenItem?.completed).toBe(false);
		});

		it('items のキーとラベルが正しい順序で含まれる', async () => {
			setupDefaults();

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			expect(result.items).toHaveLength(6);
			expect(result.items[0]?.key).toBe('children');
			// #4866 系: 項目名は labels SSOT 経由になった。リテラルを書き写すと
			// 同じ drift を繰り返すので SSOT を参照する (値を変えるとここも自動で追従する)。
			expect(result.items[0]?.label).toBe(ONBOARDING_LABELS.itemChildren);
			expect(result.items[1]?.key).toBe('activities');
			// Round 18 Cluster A (ADR-0045): 「活動パックを選ぶ」→「みんなのテンプレートを選ぶ」
			// onboarding-service.ts が PAGE_TITLES.setupPacks (TEMPLATE_TERMS atom 由来) を参照する
			expect(result.items[1]?.label).toBe('みんなのテンプレートを選ぶ');
			expect(result.items[2]?.key).toBe('rewards');
			expect(result.items[2]?.label).toBe(ONBOARDING_LABELS.itemRewards);
			expect(result.items[3]?.key).toBe('pin');
			expect(result.items[3]?.label).toBe('おやカギコードを変更する');
			expect(result.items[4]?.key).toBe('checklist');
			expect(result.items[4]?.label).toBe(ONBOARDING_LABELS.itemChecklist);
			expect(result.items[5]?.key).toBe('child_screen');
			expect(result.items[5]?.label).toBe(ONBOARDING_LABELS.itemChildScreen);
		});

		it('pinHash が空文字の場合 pin は incomplete', async () => {
			setupDefaults({ pinHash: '' });

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			const pinItem = result.items.find((i) => i.key === 'pin');
			expect(pinItem?.completed).toBe(false);
		});

		it('pin は required: false（任意項目）', async () => {
			setupDefaults();

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			const pinItem = result.items.find((i) => i.key === 'pin');
			expect(pinItem?.required).toBe(false);
		});

		it('pin 未設定でも必須項目が全完了なら allCompleted は true (#1360)', async () => {
			setupDefaults({
				children: [{ id: asChildId(1) }],
				activities: [{ id: 10 }],
				rewardsByChild: { 1: [{ id: 'r1', title: 'アイス', points: 30 }] },
				pinHash: null,
				childScreenVisited: 'true',
				templatesByChild: { 1: [{ id: '100' }] },
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			expect(result.allCompleted).toBe(true);
			expect(result.completedCount).toBe(5);
		});

		it('completedCount / totalCount は任意アイテムも含む全アイテムを対象とする (#1361)', async () => {
			setupDefaults({
				children: [{ id: asChildId(1) }],
				activities: [{ id: 10 }],
				rewardsByChild: { 1: [{ id: 'r1', title: 'アイス', points: 30 }] },
				pinHash: 'hash',
				childScreenVisited: 'true',
				templatesByChild: { 1: [{ id: '100' }] },
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			expect(result.totalCount).toBe(6);
			expect(result.completedCount).toBe(6);
		});

		it('任意アイテムが全未完でも required アイテムが完了なら allCompleted は true (#1361)', async () => {
			setupDefaults({
				children: [{ id: asChildId(1) }],
				activities: [{ id: 10 }],
				rewardsByChild: { 1: [{ id: 'r1', title: 'アイス', points: 30 }] },
				pinHash: null,
				childScreenVisited: 'true',
				templatesByChild: { 1: [{ id: '100' }] },
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			const optionalItems = result.items.filter((i) => !i.required);
			expect(optionalItems.every((i) => !i.completed)).toBe(true);
			expect(result.allCompleted).toBe(true);
		});

		it('nextRecommendation は未完の必須 → 未完の任意の順で優先する (#1361)', async () => {
			setupDefaults({
				children: [{ id: asChildId(1) }],
				activities: [],
				pinHash: null,
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			expect(result.nextRecommendation?.key).toBe('activities');
			expect(result.nextRecommendation?.required).toBe(true);
		});

		it('未完の必須アイテムが存在する場合 nextRecommendation は任意より先に必須を指す (#1361)', async () => {
			setupDefaults({
				children: [{ id: asChildId(1) }],
				activities: [{ id: 10 }],
				rewardsByChild: { 1: [{ id: 'r1', title: 'アイス', points: 30 }] },
				pinHash: null,
				childScreenVisited: null,
				templatesByChild: {},
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			expect(result.nextRecommendation?.required).toBe(true);
		});
	});

	// #4910: setup 4/9 (`/setup/rewards`) は per-child reward (`special_rewards` テーブル、
	// `getChildSpecialRewards` で読む) に取り込む。onboarding の completed 判定も同じ表を
	// 見なければならない (読む表 == 書く表)。本番実測 (37 件 per-child 取込後も ☐ のまま) を
	// 再現する回帰テストと、checklist と同型の per-child 横展開を固定する。
	describe('rewards (per-child、#4910 回帰)', () => {
		it('per-child reward が 0 件なら rewards は incomplete', async () => {
			setupDefaults({
				children: [{ id: asChildId(1) }],
				rewardsByChild: {},
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			const rewardsItem = result.items.find((i) => i.key === 'rewards');
			expect(rewardsItem?.completed).toBe(false);
		});

		it('#4910 再現: 6 セット・37 件を per-child reward に取り込んだら rewards は completed', async () => {
			// 本番実測 (無料プランのテストテナント) を模した規模: 複数子供、それぞれに
			// 大量の per-child reward が取り込まれている状態。旧実装はこの状態でも
			// family scope の template (常に空) を見て incomplete のままだった。
			const child1Rewards = Array.from({ length: 20 }, (_, i) => ({
				id: `c1-r${i}`,
				title: `ごほうび${i}`,
				points: 10,
			}));
			const child2Rewards = Array.from({ length: 17 }, (_, i) => ({
				id: `c2-r${i}`,
				title: `ごほうび${i}`,
				points: 10,
			}));
			setupDefaults({
				children: [{ id: asChildId(1) }, { id: asChildId(2) }],
				rewardsByChild: { 1: child1Rewards, 2: child2Rewards },
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			const rewardsItem = result.items.find((i) => i.key === 'rewards');
			expect(rewardsItem?.completed).toBe(true);
		});

		it('複数の子供: 最初は reward なし・2人目に reward あり → rewards completed', async () => {
			setupDefaults({
				children: [{ id: asChildId(1) }, { id: asChildId(2) }],
				rewardsByChild: {
					// child 1: no rewards (empty array is default)
					2: [{ id: 'r200', title: 'ぬいぐるみ', points: 500 }],
				},
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			const rewardsItem = result.items.find((i) => i.key === 'rewards');
			expect(rewardsItem?.completed).toBe(true);

			expect(mockGetChildSpecialRewards).toHaveBeenCalledTimes(2);
			expect(mockGetChildSpecialRewards).toHaveBeenCalledWith('1', TENANT);
			expect(mockGetChildSpecialRewards).toHaveBeenCalledWith('2', TENANT);
		});

		it('複数の子供: 全員 reward なし → rewards incomplete', async () => {
			setupDefaults({
				children: [{ id: asChildId(1) }, { id: asChildId(2) }, { id: asChildId(3) }],
				rewardsByChild: {},
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			const rewardsItem = result.items.find((i) => i.key === 'rewards');
			expect(rewardsItem?.completed).toBe(false);
			expect(mockGetChildSpecialRewards).toHaveBeenCalledTimes(3);
		});

		it('最初の子供に reward がある場合、2人目はチェックしない（早期break）', async () => {
			setupDefaults({
				children: [{ id: asChildId(1) }, { id: asChildId(2) }],
				rewardsByChild: {
					1: [{ id: 'r100', title: 'あめ', points: 5 }],
					2: [{ id: 'r200', title: 'ゲーム', points: 100 }],
				},
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			const rewardsItem = result.items.find((i) => i.key === 'rewards');
			expect(rewardsItem?.completed).toBe(true);
			// Early break: only child 1 checked since it already had rewards
			expect(mockGetChildSpecialRewards).toHaveBeenCalledTimes(1);
			expect(mockGetChildSpecialRewards).toHaveBeenCalledWith('1', TENANT);
		});

		it('子供がいない場合 getChildSpecialRewards は呼ばれない', async () => {
			setupDefaults({ children: [] });

			await getOnboardingProgress(TENANT, BASE_PATH);

			expect(mockGetChildSpecialRewards).not.toHaveBeenCalled();
		});

		it('rewards の nextRecommendation: activities 完了後 rewards が未完なら rewards を指す', async () => {
			setupDefaults({
				children: [{ id: asChildId(1) }],
				activities: [{ id: 10 }],
				rewardsByChild: {},
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			expect(result.nextRecommendation?.key).toBe('rewards');
			expect(result.nextRecommendation?.href).toBe(`${BASE_PATH}/rewards`);
		});
	});

	describe('markChildScreenVisited', () => {
		it('正しいキーと値で setSetting を呼ぶ', async () => {
			setupDefaults();

			await markChildScreenVisited(TENANT);

			expect(mockSetSetting).toHaveBeenCalledTimes(1);
			expect(mockSetSetting).toHaveBeenCalledWith(
				'onboarding_child_screen_visited',
				'true',
				TENANT,
			);
		});
	});

	describe('dismissOnboarding', () => {
		it('正しいキーと値で setSetting を呼ぶ', async () => {
			setupDefaults();

			await dismissOnboarding(TENANT);

			expect(mockSetSetting).toHaveBeenCalledTimes(1);
			expect(mockSetSetting).toHaveBeenCalledWith('onboarding_dismissed', 'true', TENANT);
		});
	});
});
