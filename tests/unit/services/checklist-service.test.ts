// tests/unit/services/checklist-service.test.ts
// チェックリストサービスのユニットテスト

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertError, assertSuccess } from '../helpers/assert-result';

// --- モック定義 ---
const mockFindTemplateById = vi.fn();
const mockFindTemplateItems = vi.fn();
const mockFindOverrides = vi.fn();
const mockFindTodayLog = vi.fn();
const mockUpsertLog = vi.fn();
const mockInsertTemplate = vi.fn();
const mockUpdateTemplate = vi.fn();
const mockDeleteTemplate = vi.fn();
const mockInsertTemplateItem = vi.fn();
const mockDeleteTemplateItem = vi.fn();
const mockInsertOverride = vi.fn();
const mockDeleteOverride = vi.fn();
const mockFindTemplatesByChild = vi.fn();
const mockInsertPointEntry = vi.fn();

vi.mock('$lib/server/db/checklist-repo', () => ({
	findTemplateById: (...args: unknown[]) => mockFindTemplateById(...args),
	findTemplateItems: (...args: unknown[]) => mockFindTemplateItems(...args),
	findTemplatesByChild: (...args: unknown[]) => mockFindTemplatesByChild(...args),
	findOverrides: (...args: unknown[]) => mockFindOverrides(...args),
	findTodayLog: (...args: unknown[]) => mockFindTodayLog(...args),
	upsertLog: (...args: unknown[]) => mockUpsertLog(...args),
	insertTemplate: (...args: unknown[]) => mockInsertTemplate(...args),
	updateTemplate: (...args: unknown[]) => mockUpdateTemplate(...args),
	deleteTemplate: (...args: unknown[]) => mockDeleteTemplate(...args),
	insertTemplateItem: (...args: unknown[]) => mockInsertTemplateItem(...args),
	deleteTemplateItem: (...args: unknown[]) => mockDeleteTemplateItem(...args),
	insertOverride: (...args: unknown[]) => mockInsertOverride(...args),
	deleteOverride: (...args: unknown[]) => mockDeleteOverride(...args),
}));

vi.mock('$lib/server/db/point-repo', () => ({
	insertPointEntry: (...args: unknown[]) => mockInsertPointEntry(...args),
}));

const TENANT = 'test-tenant';
const CHILD_ID = 1;
const TEMPLATE_ID = 10;
const DATE = '2026-04-01'; // 火曜日

const baseTemplate = {
	id: TEMPLATE_ID,
	childId: CHILD_ID,
	name: 'がっこう',
	icon: '🏫',
	pointsPerItem: 2,
	completionBonus: 5,
	isActive: 1,
	tenantId: TENANT,
};

const baseItems = [
	{
		id: 1,
		templateId: TEMPLATE_ID,
		name: 'ハンカチ',
		icon: '🤧',
		frequency: 'daily',
		direction: 'bring',
		sortOrder: 0,
		tenantId: TENANT,
	},
	{
		id: 2,
		templateId: TEMPLATE_ID,
		name: 'ティッシュ',
		icon: '🧻',
		frequency: 'daily',
		direction: 'bring',
		sortOrder: 1,
		tenantId: TENANT,
	},
	{
		id: 3,
		templateId: TEMPLATE_ID,
		name: 'すいとう',
		icon: '🧴',
		frequency: 'daily',
		direction: 'bring',
		sortOrder: 2,
		tenantId: TENANT,
	},
];

beforeEach(() => {
	vi.clearAllMocks();
	mockFindTemplateById.mockResolvedValue(baseTemplate);
	mockFindTemplateItems.mockResolvedValue(baseItems);
	mockFindOverrides.mockResolvedValue([]);
	mockFindTodayLog.mockResolvedValue(null);
	mockUpsertLog.mockResolvedValue(undefined);
	mockInsertPointEntry.mockResolvedValue(undefined);
	mockFindTemplatesByChild.mockResolvedValue([baseTemplate]);
});

// ============================================================
// getTodayChecklist
// ============================================================
describe('getTodayChecklist', () => {
	it('当日のチェックリストを正しく生成する', async () => {
		const { getTodayChecklist } = await import('$lib/server/services/checklist-service');
		const result = assertSuccess(await getTodayChecklist(CHILD_ID, TEMPLATE_ID, DATE, TENANT));

		expect(result.templateName).toBe('がっこう');
		expect(result.templateIcon).toBe('🏫');
		expect(result.items).toHaveLength(3);
		expect(result.checkedCount).toBe(0);
		expect(result.totalCount).toBe(3);
		expect(result.completedAll).toBe(false);
		expect(result.pointsAwarded).toBe(0);
	});

	it('テンプレートが見つからない場合 NOT_FOUND を返す', async () => {
		mockFindTemplateById.mockResolvedValue(null);
		const { getTodayChecklist } = await import('$lib/server/services/checklist-service');
		const result = assertError(await getTodayChecklist(CHILD_ID, TEMPLATE_ID, DATE, TENANT));

		expect(result.error).toBe('NOT_FOUND');
		expect(result.target).toBe('template');
	});

	// #1168 + ADR-0031: kind カラム未設定 / NULL 既存行は 'routine' として扱う
	it('template.kind が undefined の既存行は TodayChecklist.kind を "routine" で返す', async () => {
		mockFindTemplateById.mockResolvedValue({ ...baseTemplate, kind: undefined });
		const { getTodayChecklist } = await import('$lib/server/services/checklist-service');
		const result = assertSuccess(await getTodayChecklist(CHILD_ID, TEMPLATE_ID, DATE, TENANT));
		expect(result.kind).toBe('routine');
	});

	it('template.kind が "item" の場合は TodayChecklist.kind を "item" で返す', async () => {
		mockFindTemplateById.mockResolvedValue({ ...baseTemplate, kind: 'item' });
		const { getTodayChecklist } = await import('$lib/server/services/checklist-service');
		const result = assertSuccess(await getTodayChecklist(CHILD_ID, TEMPLATE_ID, DATE, TENANT));
		expect(result.kind).toBe('item');
	});

	it('childId が一致しない場合 NOT_FOUND を返す', async () => {
		const { getTodayChecklist } = await import('$lib/server/services/checklist-service');
		const result = assertError(await getTodayChecklist(999, TEMPLATE_ID, DATE, TENANT));

		expect(result.error).toBe('NOT_FOUND');
	});

	it('チェック記録があれば反映される', async () => {
		mockFindTodayLog.mockResolvedValue({
			itemsJson: JSON.stringify([1, 3]),
			pointsAwarded: 4,
		});
		const { getTodayChecklist } = await import('$lib/server/services/checklist-service');
		const result = assertSuccess(await getTodayChecklist(CHILD_ID, TEMPLATE_ID, DATE, TENANT));

		expect(result.checkedCount).toBe(2);
		expect(result.items[0]?.checked).toBe(true);
		expect(result.items[1]?.checked).toBe(false);
		expect(result.items[2]?.checked).toBe(true);
		expect(result.pointsAwarded).toBe(4);
	});

	it('曜日限定アイテムをフィルタする', async () => {
		mockFindTemplateItems.mockResolvedValue([
			...baseItems,
			{
				id: 4,
				templateId: TEMPLATE_ID,
				name: 'たいいくぎ',
				icon: '👕',
				frequency: 'weekday:水',
				direction: 'bring',
				sortOrder: 3,
				tenantId: TENANT,
			},
			{
				id: 5,
				templateId: TEMPLATE_ID,
				name: 'しゅうじ',
				icon: '✍️',
				frequency: 'weekday:月',
				direction: 'bring',
				sortOrder: 4,
				tenantId: TENANT,
			},
		]);
		const { getTodayChecklist } = await import('$lib/server/services/checklist-service');
		// 2026-04-01 は水曜日
		const result = assertSuccess(await getTodayChecklist(CHILD_ID, TEMPLATE_ID, DATE, TENANT));

		expect(result.items).toHaveLength(4); // daily 3 + 水曜 1（月曜は除外）
		expect(result.items.map((i) => i.name)).toContain('たいいくぎ');
		expect(result.items.map((i) => i.name)).not.toContain('しゅうじ');
	});

	it('override の remove でアイテムが除外される', async () => {
		mockFindOverrides.mockResolvedValue([
			{ id: 100, action: 'remove', itemName: 'ティッシュ', icon: '🧻' },
		]);
		const { getTodayChecklist } = await import('$lib/server/services/checklist-service');
		const result = assertSuccess(await getTodayChecklist(CHILD_ID, TEMPLATE_ID, DATE, TENANT));

		expect(result.items).toHaveLength(2);
		expect(result.items.map((i) => i.name)).not.toContain('ティッシュ');
	});

	it('override の add でアイテムが追加される（負のID）', async () => {
		mockFindOverrides.mockResolvedValue([
			{ id: 200, action: 'add', itemName: 'えんぴつ', icon: '✏️' },
		]);
		const { getTodayChecklist } = await import('$lib/server/services/checklist-service');
		const result = assertSuccess(await getTodayChecklist(CHILD_ID, TEMPLATE_ID, DATE, TENANT));

		expect(result.items).toHaveLength(4);
		const addedItem = result.items.find((i) => i.name === 'えんぴつ');
		expect(addedItem).toBeDefined();
		expect(addedItem?.id).toBe(-200);
		expect(addedItem?.source).toBe('override');
	});
});

// ============================================================
// toggleCheckItem
// ============================================================
describe('toggleCheckItem', () => {
	it('アイテムをチェックし結果を返す', async () => {
		const { toggleCheckItem } = await import('$lib/server/services/checklist-service');
		const result = assertSuccess(
			await toggleCheckItem(CHILD_ID, TEMPLATE_ID, 1, DATE, true, TENANT),
		);

		expect(result.checkedCount).toBe(1);
		expect(result.totalCount).toBe(3);
		expect(result.completedAll).toBe(false);
		expect(result.newlyCompleted).toBe(false);
		expect(result.pointsAwarded).toBe(2); // 1 * 2pt

		expect(mockUpsertLog).toHaveBeenCalledOnce();
	});

	it('全アイテム完了でボーナスポイントが付与される', async () => {
		// 先に2つチェック済み
		mockFindTodayLog.mockResolvedValue({
			itemsJson: JSON.stringify([1, 2]),
			pointsAwarded: 4,
		});
		const { toggleCheckItem } = await import('$lib/server/services/checklist-service');
		const result = assertSuccess(
			await toggleCheckItem(CHILD_ID, TEMPLATE_ID, 3, DATE, true, TENANT),
		);

		expect(result.completedAll).toBe(true);
		expect(result.newlyCompleted).toBe(true);
		expect(result.pointsAwarded).toBe(11); // 3 items * 2pt + 5pt bonus

		// ポイント台帳に記録
		expect(mockInsertPointEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				childId: CHILD_ID,
				amount: 11,
				type: 'checklist',
			}),
			TENANT,
		);
	});

	it('全完了からチェック解除するとポイントが取り消される', async () => {
		// 全3つチェック済み（全完了状態）
		mockFindTodayLog.mockResolvedValue({
			itemsJson: JSON.stringify([1, 2, 3]),
			pointsAwarded: 11,
			completedAll: 1,
		});
		const { toggleCheckItem } = await import('$lib/server/services/checklist-service');
		const result = assertSuccess(
			await toggleCheckItem(CHILD_ID, TEMPLATE_ID, 3, DATE, false, TENANT),
		);

		expect(result.completedAll).toBe(false);
		expect(result.newlyCompleted).toBe(false);

		// ポイント取消が記録される
		expect(mockInsertPointEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				childId: CHILD_ID,
				amount: -11,
				type: 'checklist_cancel',
			}),
			TENANT,
		);
	});

	it('存在しないテンプレートで NOT_FOUND', async () => {
		mockFindTemplateById.mockResolvedValue(null);
		const { toggleCheckItem } = await import('$lib/server/services/checklist-service');
		const result = assertError(await toggleCheckItem(CHILD_ID, TEMPLATE_ID, 1, DATE, true, TENANT));

		expect(result.error).toBe('NOT_FOUND');
	});

	it('存在しないアイテムIDで NOT_FOUND', async () => {
		const { toggleCheckItem } = await import('$lib/server/services/checklist-service');
		const result = assertError(
			await toggleCheckItem(CHILD_ID, TEMPLATE_ID, 999, DATE, true, TENANT),
		);

		expect(result.error).toBe('NOT_FOUND');
		expect(result.target).toBe('item');
	});
});

// ============================================================
// getChecklistsForChild
// ============================================================
describe('getChecklistsForChild', () => {
	it('子供の全チェックリストを返す', async () => {
		const { getChecklistsForChild } = await import('$lib/server/services/checklist-service');
		const result = await getChecklistsForChild(CHILD_ID, DATE, TENANT);

		expect(result).toHaveLength(1);
		expect(result[0]?.templateName).toBe('がっこう');
	});

	it('テンプレートがない場合は空配列を返す', async () => {
		mockFindTemplatesByChild.mockResolvedValue([]);
		const { getChecklistsForChild } = await import('$lib/server/services/checklist-service');
		const result = await getChecklistsForChild(CHILD_ID, DATE, TENANT);

		expect(result).toHaveLength(0);
	});
});

// ============================================================
// テンプレート管理
// ============================================================
describe('createTemplate', () => {
	it('デフォルト値でテンプレートを作成する', async () => {
		mockInsertTemplate.mockResolvedValue({ id: 20 });
		const { createTemplate } = await import('$lib/server/services/checklist-service');
		await createTemplate({ childId: CHILD_ID, name: 'おでかけ' }, TENANT);

		expect(mockInsertTemplate).toHaveBeenCalledWith(
			expect.objectContaining({
				childId: CHILD_ID,
				name: 'おでかけ',
				icon: '📋',
				pointsPerItem: 2,
				completionBonus: 5,
			}),
			TENANT,
		);
	});

	it('カスタム値でテンプレートを作成する', async () => {
		mockInsertTemplate.mockResolvedValue({ id: 21 });
		const { createTemplate } = await import('$lib/server/services/checklist-service');
		await createTemplate(
			{ childId: CHILD_ID, name: 'ならいごと', icon: '🎹', pointsPerItem: 5, completionBonus: 10 },
			TENANT,
		);

		expect(mockInsertTemplate).toHaveBeenCalledWith(
			expect.objectContaining({
				icon: '🎹',
				pointsPerItem: 5,
				completionBonus: 10,
			}),
			TENANT,
		);
	});
});

describe('addTemplateItem', () => {
	it('デフォルト値でアイテムを追加する', async () => {
		mockInsertTemplateItem.mockResolvedValue({ id: 50 });
		const { addTemplateItem } = await import('$lib/server/services/checklist-service');
		await addTemplateItem({ templateId: TEMPLATE_ID, name: 'ノート' }, TENANT);

		expect(mockInsertTemplateItem).toHaveBeenCalledWith(
			expect.objectContaining({
				templateId: TEMPLATE_ID,
				name: 'ノート',
				icon: '🏫',
				frequency: 'daily',
				direction: 'bring',
				sortOrder: 0,
			}),
			TENANT,
		);
	});
});
