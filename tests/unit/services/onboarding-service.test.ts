// tests/unit/services/onboarding-service.test.ts
// onboarding-service ユニットテスト

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Top-level mocks ----

const mockGetAllChildren = vi.fn();
const mockGetActivities = vi.fn();
const mockGetSetting = vi.fn();
const mockSetSetting = vi.fn();
const mockFindTemplatesByChild = vi.fn();

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
		children?: { id: number }[];
		activities?: { id: number }[];
		pinHash?: string | null;
		dismissed?: string | null;
		childScreenVisited?: string | null;
		templatesByChild?: Record<number, unknown[]>;
	} = {},
) {
	const {
		children = [],
		activities = [],
		pinHash = null,
		dismissed = null,
		childScreenVisited = null,
		templatesByChild = {},
	} = overrides;

	mockGetAllChildren.mockResolvedValue(children);
	mockGetActivities.mockResolvedValue(activities);

	mockGetSetting.mockImplementation((key: string, _tenantId: string) => {
		if (key === 'pin_hash') return Promise.resolve(pinHash);
		if (key === 'onboarding_dismissed') return Promise.resolve(dismissed);
		if (key === 'onboarding_child_screen_visited') return Promise.resolve(childScreenVisited);
		return Promise.resolve(null);
	});

	mockFindTemplatesByChild.mockImplementation((childId: number) => {
		return Promise.resolve(templatesByChild[childId] ?? []);
	});

	mockSetSetting.mockResolvedValue(undefined);
}

// ---- Tests ----

describe('onboarding-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('getOnboardingProgress', () => {
		it('全項目未完了: 子供なし・活動なし・PINなし・チェックリストなし・未訪問', async () => {
			setupDefaults();

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			expect(result.completedCount).toBe(0);
			expect(result.totalCount).toBe(5);
			expect(result.allCompleted).toBe(false);
			expect(result.dismissed).toBe(false);

			for (const item of result.items) {
				expect(item.completed).toBe(false);
			}
		});

		it('全項目完了 + dismissed', async () => {
			setupDefaults({
				children: [{ id: 1 }],
				activities: [{ id: 10 }],
				pinHash: 'hashed-pin-value',
				dismissed: 'true',
				childScreenVisited: 'true',
				templatesByChild: { 1: [{ id: 100 }] },
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			expect(result.completedCount).toBe(5);
			expect(result.totalCount).toBe(5);
			expect(result.allCompleted).toBe(true);
			expect(result.dismissed).toBe(true);
			expect(result.nextRecommendation).toBeNull();

			for (const item of result.items) {
				expect(item.completed).toBe(true);
			}
		});

		it('部分的な完了: 子供あり・活動あり・PINなし・チェックリストなし・未訪問', async () => {
			setupDefaults({
				children: [{ id: 1 }],
				activities: [{ id: 10 }],
				templatesByChild: {},
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			expect(result.completedCount).toBe(2);
			expect(result.totalCount).toBe(5);
			expect(result.allCompleted).toBe(false);

			// children: completed, activities: completed
			expect(result.items[0]?.completed).toBe(true);
			expect(result.items[1]?.completed).toBe(true);
			// pin: incomplete, checklist: incomplete, child_screen: incomplete
			expect(result.items[2]?.completed).toBe(false);
			expect(result.items[3]?.completed).toBe(false);
			expect(result.items[4]?.completed).toBe(false);
		});

		it('nextRecommendation は最初の未完了項目を指す', async () => {
			// children completed, activities incomplete => nextRecommendation = activities
			setupDefaults({
				children: [{ id: 1 }],
				activities: [],
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			expect(result.nextRecommendation).not.toBeNull();
			expect(result.nextRecommendation?.key).toBe('activities');
			expect(result.nextRecommendation?.href).toBe(`${BASE_PATH}/activities`);
		});

		it('全完了時は nextRecommendation が null', async () => {
			setupDefaults({
				children: [{ id: 1 }],
				activities: [{ id: 10 }],
				pinHash: 'some-hash',
				childScreenVisited: 'true',
				templatesByChild: { 1: [{ id: 100 }] },
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			expect(result.nextRecommendation).toBeNull();
			expect(result.allCompleted).toBe(true);
		});

		it('completedCount と totalCount が正しい', async () => {
			// 3 items completed: children, activities, pin
			setupDefaults({
				children: [{ id: 1 }],
				activities: [{ id: 10 }],
				pinHash: 'hash123',
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			expect(result.completedCount).toBe(3);
			expect(result.totalCount).toBe(5);
		});

		it('basePath が href に正しく適用される', async () => {
			const customBase = '/custom/path';
			setupDefaults();

			const result = await getOnboardingProgress(TENANT, customBase);

			expect(result.items[0]?.href).toBe('/custom/path/members');
			expect(result.items[1]?.href).toBe('/custom/path/activities');
			expect(result.items[2]?.href).toBe('/custom/path/settings');
			expect(result.items[3]?.href).toBe('/custom/path/checklists');
			// child_screen is always /switch regardless of basePath
			expect(result.items[4]?.href).toBe('/switch');
		});

		it('子供がテンプレートを持っている場合 checklist は completed', async () => {
			setupDefaults({
				children: [{ id: 1 }],
				templatesByChild: { 1: [{ id: 100, name: 'template-1' }] },
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			const checklistItem = result.items.find((i) => i.key === 'checklist');
			expect(checklistItem?.completed).toBe(true);
		});

		it('複数の子供: 最初はテンプレートなし・2人目がテンプレートあり → checklist completed', async () => {
			setupDefaults({
				children: [{ id: 1 }, { id: 2 }],
				templatesByChild: {
					// child 1: no templates (empty array is default)
					2: [{ id: 200, name: 'template-for-child-2' }],
				},
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			const checklistItem = result.items.find((i) => i.key === 'checklist');
			expect(checklistItem?.completed).toBe(true);

			// findTemplatesByChild should be called for both children
			expect(mockFindTemplatesByChild).toHaveBeenCalledTimes(2);
			expect(mockFindTemplatesByChild).toHaveBeenCalledWith(1, TENANT, false);
			expect(mockFindTemplatesByChild).toHaveBeenCalledWith(2, TENANT, false);
		});

		it('複数の子供: 全員テンプレートなし → checklist incomplete', async () => {
			setupDefaults({
				children: [{ id: 1 }, { id: 2 }, { id: 3 }],
				templatesByChild: {},
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			const checklistItem = result.items.find((i) => i.key === 'checklist');
			expect(checklistItem?.completed).toBe(false);
			expect(mockFindTemplatesByChild).toHaveBeenCalledTimes(3);
		});

		it('最初の子供にテンプレートがある場合、2人目はチェックしない（早期break）', async () => {
			setupDefaults({
				children: [{ id: 1 }, { id: 2 }],
				templatesByChild: {
					1: [{ id: 100 }],
					2: [{ id: 200 }],
				},
			});

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			const checklistItem = result.items.find((i) => i.key === 'checklist');
			expect(checklistItem?.completed).toBe(true);
			// Early break: only child 1 checked since it already had templates
			expect(mockFindTemplatesByChild).toHaveBeenCalledTimes(1);
			expect(mockFindTemplatesByChild).toHaveBeenCalledWith(1, TENANT, false);
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

			expect(result.items).toHaveLength(5);
			expect(result.items[0]?.key).toBe('children');
			expect(result.items[0]?.label).toBe('子供を登録する');
			expect(result.items[1]?.key).toBe('activities');
			expect(result.items[1]?.label).toBe('活動パックを選ぶ');
			expect(result.items[2]?.key).toBe('pin');
			expect(result.items[2]?.label).toBe('PINコードを設定する');
			expect(result.items[3]?.key).toBe('checklist');
			expect(result.items[3]?.label).toBe('チェックリストを作る');
			expect(result.items[4]?.key).toBe('child_screen');
			expect(result.items[4]?.label).toBe('子供の画面を確認する');
		});

		it('子供がいない場合 findTemplatesByChild は呼ばれない', async () => {
			setupDefaults({ children: [] });

			await getOnboardingProgress(TENANT, BASE_PATH);

			expect(mockFindTemplatesByChild).not.toHaveBeenCalled();
		});

		it('pinHash が空文字の場合 pin は incomplete', async () => {
			setupDefaults({ pinHash: '' });

			const result = await getOnboardingProgress(TENANT, BASE_PATH);

			const pinItem = result.items.find((i) => i.key === 'pin');
			expect(pinItem?.completed).toBe(false);
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
