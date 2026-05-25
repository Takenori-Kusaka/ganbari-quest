// tests/unit/services/checklist-distribution-service.test.ts
// #2362 PR-5 (ADR-0055): checklist-distribution-service unit test

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAssign = vi.fn();
const mockUnassignFromChildren = vi.fn();
const mockUnassignAll = vi.fn();
const mockFindByTemplate = vi.fn();
const mockFindByChild = vi.fn();
const mockFindTemplateById = vi.fn();

vi.mock('$lib/server/db/checklist-repo', () => ({
	assignTemplateToChildren: (...args: unknown[]) => mockAssign(...args),
	unassignTemplateFromChildren: (...args: unknown[]) => mockUnassignFromChildren(...args),
	unassignTemplate: (...args: unknown[]) => mockUnassignAll(...args),
	findAssignmentsByTemplate: (...args: unknown[]) => mockFindByTemplate(...args),
	findAssignmentsByChild: (...args: unknown[]) => mockFindByChild(...args),
	findTemplateById: (...args: unknown[]) => mockFindTemplateById(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
	distributeToChildren,
	listAssignedTemplatesByChild,
	listDistribution,
	syncDistribution,
	unassignAll,
	unassignFromChildren,
} from '../../../src/lib/server/services/checklist-distribution-service';

const TENANT = 'test-tenant';
const TEMPLATE_ID = 50;

beforeEach(() => {
	vi.clearAllMocks();
	mockFindTemplateById.mockResolvedValue({ id: TEMPLATE_ID, tenantId: TENANT, name: 'X' });
});

describe('listDistribution', () => {
	it('template の配信先 child 一覧を返す', async () => {
		mockFindByTemplate.mockResolvedValue([
			{ id: 1, templateId: TEMPLATE_ID, childId: 10, createdAt: 'T1' },
			{ id: 2, templateId: TEMPLATE_ID, childId: 20, createdAt: 'T2' },
		]);
		const result = await listDistribution(TEMPLATE_ID, TENANT);
		expect(result).toEqual([
			{ childId: 10, createdAt: 'T1' },
			{ childId: 20, createdAt: 'T2' },
		]);
	});

	it('template が存在しない場合は空配列', async () => {
		mockFindTemplateById.mockResolvedValue(undefined);
		const result = await listDistribution(999, TENANT);
		expect(result).toEqual([]);
		expect(mockFindByTemplate).not.toHaveBeenCalled();
	});
});

describe('listAssignedTemplatesByChild', () => {
	it('child に配信中の template id 配列を返す', async () => {
		mockFindByChild.mockResolvedValue([
			{ id: 1, templateId: 10, childId: 5, createdAt: 'T' },
			{ id: 2, templateId: 20, childId: 5, createdAt: 'T' },
		]);
		const result = await listAssignedTemplatesByChild(5, TENANT);
		expect(result).toEqual([10, 20]);
	});
});

describe('distributeToChildren', () => {
	it('指定 child 群に配信、実際に追加された child id を返す', async () => {
		mockAssign.mockResolvedValue([
			{ id: 1, templateId: TEMPLATE_ID, childId: 10, createdAt: 'T' },
			{ id: 2, templateId: TEMPLATE_ID, childId: 20, createdAt: 'T' },
		]);
		const result = await distributeToChildren(TEMPLATE_ID, [10, 20], TENANT);
		expect(result).toEqual([10, 20]);
		expect(mockAssign).toHaveBeenCalledWith(TEMPLATE_ID, [10, 20], TENANT);
	});

	it('childIds 空配列なら何もしない', async () => {
		const result = await distributeToChildren(TEMPLATE_ID, [], TENANT);
		expect(result).toEqual([]);
		expect(mockAssign).not.toHaveBeenCalled();
	});

	it('template が存在しなければ throw', async () => {
		mockFindTemplateById.mockResolvedValue(undefined);
		await expect(distributeToChildren(999, [10], TENANT)).rejects.toThrow(/見つかりません/);
	});
});

describe('unassignFromChildren', () => {
	it('指定 child 群の配信を解除', async () => {
		await unassignFromChildren(TEMPLATE_ID, [10, 20], TENANT);
		expect(mockUnassignFromChildren).toHaveBeenCalledWith(TEMPLATE_ID, [10, 20], TENANT);
	});

	it('childIds 空配列なら何もしない', async () => {
		await unassignFromChildren(TEMPLATE_ID, [], TENANT);
		expect(mockUnassignFromChildren).not.toHaveBeenCalled();
	});
});

describe('syncDistribution', () => {
	it('差分を計算して add / remove を実行', async () => {
		// 既存配信: [10, 20, 30]、希望: [20, 30, 40]
		mockFindByTemplate.mockResolvedValue([
			{ id: 1, templateId: TEMPLATE_ID, childId: 10, createdAt: 'T' },
			{ id: 2, templateId: TEMPLATE_ID, childId: 20, createdAt: 'T' },
			{ id: 3, templateId: TEMPLATE_ID, childId: 30, createdAt: 'T' },
		]);
		mockAssign.mockResolvedValue([{ id: 4, templateId: TEMPLATE_ID, childId: 40, createdAt: 'T' }]);

		const result = await syncDistribution(TEMPLATE_ID, [20, 30, 40], TENANT);

		expect(result.added).toEqual([40]);
		expect([...result.removed].sort()).toEqual([10]);
		expect(mockAssign).toHaveBeenCalledWith(TEMPLATE_ID, [40], TENANT);
		expect(mockUnassignFromChildren).toHaveBeenCalledWith(TEMPLATE_ID, [10], TENANT);
	});

	it('全 child 配信解除パターン (desiredChildIds 空)', async () => {
		mockFindByTemplate.mockResolvedValue([
			{ id: 1, templateId: TEMPLATE_ID, childId: 10, createdAt: 'T' },
		]);
		mockAssign.mockResolvedValue([]);

		const result = await syncDistribution(TEMPLATE_ID, [], TENANT);
		expect(result.added).toEqual([]);
		expect(result.removed).toEqual([10]);
	});

	it('差分なしなら add / remove 共に呼ばない', async () => {
		mockFindByTemplate.mockResolvedValue([
			{ id: 1, templateId: TEMPLATE_ID, childId: 10, createdAt: 'T' },
		]);
		mockAssign.mockResolvedValue([]);

		const result = await syncDistribution(TEMPLATE_ID, [10], TENANT);
		expect(result.added).toEqual([]);
		expect(result.removed).toEqual([]);
		// Note: assign は空配列で呼ばれる (toAdd=[])。unassign は早期 return で呼ばれない。
		expect(mockUnassignFromChildren).not.toHaveBeenCalled();
	});

	it('template が存在しなければ throw', async () => {
		mockFindTemplateById.mockResolvedValue(undefined);
		await expect(syncDistribution(999, [10], TENANT)).rejects.toThrow(/見つかりません/);
	});
});

describe('unassignAll', () => {
	it('template の全配信を解除', async () => {
		await unassignAll(TEMPLATE_ID, TENANT);
		expect(mockUnassignAll).toHaveBeenCalledWith(TEMPLATE_ID, TENANT);
	});

	it('template が存在しなければ no-op', async () => {
		mockFindTemplateById.mockResolvedValue(undefined);
		await unassignAll(999, TENANT);
		expect(mockUnassignAll).not.toHaveBeenCalled();
	});
});
