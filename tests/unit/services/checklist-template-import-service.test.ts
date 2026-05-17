// tests/unit/services/checklist-template-import-service.test.ts
// #2137 (MP-2) checklist-template-import-service unit tests
//
// activity-import-service.test.ts と同じ pattern (top-level mock → late import → vi.clearAllMocks)。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChecklistPayload, MarketplaceItem } from '../../../src/lib/domain/marketplace-item';

// ---------- Top-level mocks ----------

const mockGetMarketplaceItem = vi.fn();
const mockFindTemplatesByChild = vi.fn();
const mockCreateTemplate = vi.fn();
const mockAddTemplateItem = vi.fn();

vi.mock('$lib/data/marketplace', () => ({
	getMarketplaceItem: (...args: unknown[]) => mockGetMarketplaceItem(...args),
}));

vi.mock('$lib/server/db/checklist-repo', () => ({
	findTemplatesByChild: (...args: unknown[]) => mockFindTemplatesByChild(...args),
}));

vi.mock('$lib/server/services/checklist-service', () => ({
	createTemplate: (...args: unknown[]) => mockCreateTemplate(...args),
	addTemplateItem: (...args: unknown[]) => mockAddTemplateItem(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------- Import after mocks ----------

import {
	importChecklistTemplate,
	previewChecklistImport,
} from '../../../src/lib/server/services/checklist-template-import-service';

// ---------- Helpers ----------

const TENANT = 'test-tenant-001';
const CHILD_ID = 42;

function makePresetItem(overrides: Partial<MarketplaceItem> = {}): MarketplaceItem {
	const payload: ChecklistPayload = {
		timing: 'daily',
		items: [
			{ label: 'みずぎ', icon: '👙', order: 1 },
			{ label: 'プールバッグ', icon: '🎒', order: 2 },
			{ label: 'タオル', icon: '🏖️', order: 3 },
		],
	};
	return {
		type: 'checklist',
		itemId: 'event-pool',
		name: 'プールの もちもの',
		description: 'desc',
		icon: '🏊',
		targetAgeMin: 4,
		targetAgeMax: 12,
		tags: ['イベント'],
		personas: [],
		curator: 'official',
		payload,
		...overrides,
	} as MarketplaceItem;
}

// ---------- Reset ----------

beforeEach(() => {
	vi.clearAllMocks();
	mockFindTemplatesByChild.mockResolvedValue([]);
	mockCreateTemplate.mockResolvedValue({ id: 100 });
	mockAddTemplateItem.mockResolvedValue({ id: 1 });
});

// ==========================================================
// previewChecklistImport
// ==========================================================

describe('previewChecklistImport', () => {
	it('preset が見つからない場合 null を返す', async () => {
		mockGetMarketplaceItem.mockReturnValue(null);

		const result = await previewChecklistImport('unknown', CHILD_ID, TENANT);

		expect(result).toBeNull();
	});

	it('既存テンプレートなし → alreadyImported=false / item 数集計', async () => {
		mockGetMarketplaceItem.mockReturnValue(makePresetItem());
		mockFindTemplatesByChild.mockResolvedValue([]);

		const result = await previewChecklistImport('event-pool', CHILD_ID, TENANT);

		expect(result).not.toBeNull();
		expect(result?.presetId).toBe('event-pool');
		expect(result?.presetName).toBe('プールの もちもの');
		expect(result?.presetIcon).toBe('🏊');
		expect(result?.itemCount).toBe(3);
		expect(result?.alreadyImported).toBe(false);
		expect(result?.existingTemplateName).toBeUndefined();
	});

	it('同 sourcePresetId のテンプレートが既存 → alreadyImported=true', async () => {
		mockGetMarketplaceItem.mockReturnValue(makePresetItem());
		mockFindTemplatesByChild.mockResolvedValue([
			{ id: 7, name: 'プールの もちもの', sourcePresetId: 'event-pool' },
			{ id: 8, name: '別のテンプレ', sourcePresetId: null },
		]);

		const result = await previewChecklistImport('event-pool', CHILD_ID, TENANT);

		expect(result?.alreadyImported).toBe(true);
		expect(result?.existingTemplateName).toBe('プールの もちもの');
	});

	it('他の preset 由来テンプレートが既存 → alreadyImported=false', async () => {
		mockGetMarketplaceItem.mockReturnValue(makePresetItem());
		mockFindTemplatesByChild.mockResolvedValue([
			{ id: 7, name: '別 preset', sourcePresetId: 'event-school-start' },
		]);

		const result = await previewChecklistImport('event-pool', CHILD_ID, TENANT);

		expect(result?.alreadyImported).toBe(false);
	});

	it('findTemplatesByChild に includeInactive=true が渡される', async () => {
		mockGetMarketplaceItem.mockReturnValue(makePresetItem());

		await previewChecklistImport('event-pool', CHILD_ID, TENANT);

		expect(mockFindTemplatesByChild).toHaveBeenCalledWith(CHILD_ID, TENANT, true);
	});
});

// ==========================================================
// importChecklistTemplate
// ==========================================================

describe('importChecklistTemplate', () => {
	it('preset が見つからない場合 throw', async () => {
		mockGetMarketplaceItem.mockReturnValue(null);

		await expect(importChecklistTemplate('unknown', CHILD_ID, TENANT)).rejects.toThrow(
			/見つかりません/,
		);
	});

	it('新規取込: template + items が全て作成される', async () => {
		mockGetMarketplaceItem.mockReturnValue(makePresetItem());
		mockFindTemplatesByChild.mockResolvedValue([]);

		const result = await importChecklistTemplate('event-pool', CHILD_ID, TENANT);

		expect(result.imported).toBe(1);
		expect(result.skipped).toBe(0);
		expect(result.importedItems).toBe(3);
		expect(result.errors).toEqual([]);
		expect(result.templateId).toBe(100);

		expect(mockCreateTemplate).toHaveBeenCalledTimes(1);
		expect(mockCreateTemplate).toHaveBeenCalledWith(
			expect.objectContaining({
				childId: CHILD_ID,
				name: 'プールの もちもの',
				icon: '🏊',
				timeSlot: 'anytime', // daily → anytime
				sourcePresetId: 'event-pool',
			}),
			TENANT,
		);
		expect(mockAddTemplateItem).toHaveBeenCalledTimes(3);
	});

	it('重複検出: 同 sourcePresetId が既存 → 何もせずスキップ', async () => {
		mockGetMarketplaceItem.mockReturnValue(makePresetItem());
		mockFindTemplatesByChild.mockResolvedValue([
			{ id: 99, name: 'プールの もちもの', sourcePresetId: 'event-pool' },
		]);

		const result = await importChecklistTemplate('event-pool', CHILD_ID, TENANT);

		expect(result.imported).toBe(0);
		expect(result.skipped).toBe(1);
		expect(result.importedItems).toBe(0);
		expect(mockCreateTemplate).not.toHaveBeenCalled();
		expect(mockAddTemplateItem).not.toHaveBeenCalled();
	});

	it('item の追加順は order 昇順', async () => {
		mockGetMarketplaceItem.mockReturnValue(
			makePresetItem({
				payload: {
					timing: 'daily',
					items: [
						{ label: '3つ目', icon: '🅒', order: 3 },
						{ label: '1つ目', icon: '🅐', order: 1 },
						{ label: '2つ目', icon: '🅑', order: 2 },
					],
				},
			} as Partial<MarketplaceItem>),
		);

		await importChecklistTemplate('event-pool', CHILD_ID, TENANT);

		expect(mockAddTemplateItem).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ name: '1つ目', sortOrder: 1 }),
			TENANT,
		);
		expect(mockAddTemplateItem).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ name: '2つ目', sortOrder: 2 }),
			TENANT,
		);
		expect(mockAddTemplateItem).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({ name: '3つ目', sortOrder: 3 }),
			TENANT,
		);
	});

	it('addTemplateItem が一部失敗してもエラー記録のみで処理継続', async () => {
		mockGetMarketplaceItem.mockReturnValue(makePresetItem());
		mockAddTemplateItem
			.mockResolvedValueOnce({ id: 1 })
			.mockRejectedValueOnce(new Error('DB busy'))
			.mockResolvedValueOnce({ id: 3 });

		const result = await importChecklistTemplate('event-pool', CHILD_ID, TENANT);

		expect(result.imported).toBe(1);
		expect(result.importedItems).toBe(2);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain('DB busy');
	});

	it('timing=morning → timeSlot=morning にマップ', async () => {
		mockGetMarketplaceItem.mockReturnValue(
			makePresetItem({
				payload: {
					timing: 'morning',
					items: [{ label: 'はみがき', icon: '🪥', order: 1 }],
				},
			} as Partial<MarketplaceItem>),
		);

		await importChecklistTemplate('event-pool', CHILD_ID, TENANT);

		expect(mockCreateTemplate).toHaveBeenCalledWith(
			expect.objectContaining({ timeSlot: 'morning' }),
			TENANT,
		);
	});

	it('timing=evening → timeSlot=evening にマップ', async () => {
		mockGetMarketplaceItem.mockReturnValue(
			makePresetItem({
				payload: {
					timing: 'evening',
					items: [{ label: 'パジャマ', icon: '🛌', order: 1 }],
				},
			} as Partial<MarketplaceItem>),
		);

		await importChecklistTemplate('event-pool', CHILD_ID, TENANT);

		expect(mockCreateTemplate).toHaveBeenCalledWith(
			expect.objectContaining({ timeSlot: 'evening' }),
			TENANT,
		);
	});

	it('timing=weekend/weekly は anytime にマップ', async () => {
		mockGetMarketplaceItem.mockReturnValue(
			makePresetItem({
				payload: {
					timing: 'weekend',
					items: [{ label: 'お出かけセット', icon: '👜', order: 1 }],
				},
			} as Partial<MarketplaceItem>),
		);

		await importChecklistTemplate('event-pool', CHILD_ID, TENANT);

		expect(mockCreateTemplate).toHaveBeenCalledWith(
			expect.objectContaining({ timeSlot: 'anytime' }),
			TENANT,
		);
	});

	it('options.timeSlot で上書きできる', async () => {
		mockGetMarketplaceItem.mockReturnValue(makePresetItem());

		await importChecklistTemplate('event-pool', CHILD_ID, TENANT, {
			timeSlot: 'morning',
		});

		expect(mockCreateTemplate).toHaveBeenCalledWith(
			expect.objectContaining({ timeSlot: 'morning' }),
			TENANT,
		);
	});
});
