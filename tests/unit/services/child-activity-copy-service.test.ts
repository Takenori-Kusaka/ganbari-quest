// tests/unit/services/child-activity-copy-service.test.ts
// 兄弟共通化 UX (#2362 PR-3、ADR-0055) unit test
//
// 検証範囲:
//   - 複数 target child に対する一括コピー
//   - self-copy 拒否
//   - 1 target が失敗しても他は継続 (partial success)
//   - tenant isolation の引数伝播
//   - 単一 convenience (copyChildActivitiesToSibling) の正常系 / self-copy 例外

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- Top-level mocks ----------

const mockCopyActivitiesAcrossChildren = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		childActivity: {
			copyActivitiesAcrossChildren: (...args: unknown[]) =>
				mockCopyActivitiesAcrossChildren(...args),
		},
	}),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------- Import after mocks ----------

import {
	copyChildActivitiesToSibling,
	copyChildActivitiesToSiblings,
} from '../../../src/lib/server/services/child-activity-copy-service';

const TENANT = 'test-tenant-001';
const SOURCE = 101;

beforeEach(() => {
	vi.clearAllMocks();
	mockCopyActivitiesAcrossChildren.mockResolvedValue([]);
});

// ============================================================
// copyChildActivitiesToSiblings
// ============================================================

describe('copyChildActivitiesToSiblings', () => {
	it('targetChildIds 空 -> totalCopied=0、repo は呼ばれない', async () => {
		const result = await copyChildActivitiesToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [],
		});

		expect(result.totalCopied).toBe(0);
		expect(result.byTargetChild).toEqual({});
		expect(result.errors).toEqual([]);
		expect(mockCopyActivitiesAcrossChildren).not.toHaveBeenCalled();
	});

	it('targets 1 件 -> 1 回 copy、件数集計', async () => {
		mockCopyActivitiesAcrossChildren.mockResolvedValueOnce([
			{ id: 1, childId: 202 },
			{ id: 2, childId: 202 },
			{ id: 3, childId: 202 },
		]);

		const result = await copyChildActivitiesToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [202],
		});

		expect(result.totalCopied).toBe(3);
		expect(result.byTargetChild).toEqual({ 202: 3 });
		expect(result.errors).toEqual([]);
		expect(mockCopyActivitiesAcrossChildren).toHaveBeenCalledWith(SOURCE, 202, TENANT);
	});

	it('targets 3 件 -> 全 target に copy、件数別集計', async () => {
		mockCopyActivitiesAcrossChildren
			.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]) // 202: 2 件
			.mockResolvedValueOnce([{ id: 3 }]) // 303: 1 件
			.mockResolvedValueOnce([{ id: 4 }, { id: 5 }, { id: 6 }]); // 404: 3 件

		const result = await copyChildActivitiesToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [202, 303, 404],
		});

		expect(result.totalCopied).toBe(6);
		expect(result.byTargetChild).toEqual({ 202: 2, 303: 1, 404: 3 });
		expect(result.errors).toEqual([]);
		expect(mockCopyActivitiesAcrossChildren).toHaveBeenCalledTimes(3);
	});

	it('self-copy (source == target) は filter で除外され repo 呼出ゼロ', async () => {
		const result = await copyChildActivitiesToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [SOURCE],
		});

		expect(result.totalCopied).toBe(0);
		expect(result.byTargetChild).toEqual({});
		expect(result.errors).toEqual([]);
		expect(mockCopyActivitiesAcrossChildren).not.toHaveBeenCalled();
	});

	it('source が target に混在 -> source のみ除外、他は処理継続', async () => {
		mockCopyActivitiesAcrossChildren
			.mockResolvedValueOnce([{ id: 1 }])
			.mockResolvedValueOnce([{ id: 2 }, { id: 3 }]);

		const result = await copyChildActivitiesToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [SOURCE, 202, 303],
		});

		expect(result.totalCopied).toBe(3);
		expect(result.byTargetChild).toEqual({ 202: 1, 303: 2 });
		expect(mockCopyActivitiesAcrossChildren).toHaveBeenCalledTimes(2);
	});

	it('1 target の copy が失敗しても他は継続 (partial success)', async () => {
		mockCopyActivitiesAcrossChildren
			.mockRejectedValueOnce(new Error('child=202 not found'))
			.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);

		const result = await copyChildActivitiesToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [202, 303],
		});

		expect(result.totalCopied).toBe(2);
		expect(result.byTargetChild).toEqual({ 303: 2 });
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toMatchObject({
			targetChildId: 202,
			message: expect.stringContaining('not found'),
		});
	});

	it('tenantId が全 copy 呼出に伝播する', async () => {
		await copyChildActivitiesToSiblings({
			tenantId: 'tenant-x',
			sourceChildId: SOURCE,
			targetChildIds: [202, 303],
		});

		for (const call of mockCopyActivitiesAcrossChildren.mock.calls) {
			expect(call[2]).toBe('tenant-x');
		}
	});

	it('source は全呼出で固定値', async () => {
		await copyChildActivitiesToSiblings({
			tenantId: TENANT,
			sourceChildId: 999,
			targetChildIds: [202, 303, 404],
		});

		for (const call of mockCopyActivitiesAcrossChildren.mock.calls) {
			expect(call[0]).toBe(999);
		}
	});

	it('source が複製先に存在しない場合も errors 配列に記録される', async () => {
		mockCopyActivitiesAcrossChildren
			.mockRejectedValueOnce(new Error('source vacant'))
			.mockRejectedValueOnce(new Error('source vacant'));

		const result = await copyChildActivitiesToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [202, 303],
		});

		expect(result.totalCopied).toBe(0);
		expect(result.errors).toHaveLength(2);
	});
});

// ============================================================
// copyChildActivitiesToSibling (single convenience)
// ============================================================

describe('copyChildActivitiesToSibling', () => {
	it('正常系: repo に source / target / tenant を渡す', async () => {
		const expected = [{ id: 1, childId: 202 }];
		mockCopyActivitiesAcrossChildren.mockResolvedValueOnce(expected);

		const result = await copyChildActivitiesToSibling(TENANT, SOURCE, 202);

		expect(result).toEqual(expected);
		expect(mockCopyActivitiesAcrossChildren).toHaveBeenCalledWith(SOURCE, 202, TENANT);
	});

	it('source == target -> Error を throw', async () => {
		await expect(copyChildActivitiesToSibling(TENANT, SOURCE, SOURCE)).rejects.toThrow(/同一/);
		expect(mockCopyActivitiesAcrossChildren).not.toHaveBeenCalled();
	});

	it('repo 例外は呼出側に伝播する', async () => {
		mockCopyActivitiesAcrossChildren.mockRejectedValueOnce(new Error('FK violation'));

		await expect(copyChildActivitiesToSibling(TENANT, SOURCE, 202)).rejects.toThrow('FK violation');
	});
});
