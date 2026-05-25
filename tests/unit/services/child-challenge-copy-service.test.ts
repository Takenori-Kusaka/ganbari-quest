// tests/unit/services/child-challenge-copy-service.test.ts
// 兄弟共通化 UX (#2362 PR-7、ADR-0055、User §6) unit test
//
// 検証範囲:
//   - 複数 target child に対する一括コピー
//   - self-copy 拒否 (sourceChildId と同一 targetChildId 除外)
//   - 1 target が失敗しても他は継続 (partial success)
//   - 単一 convenience copyChildChallengesToSibling の正常系 / self-copy 例外

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCopyAcrossChildren = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		childChallenge: {
			copyAcrossChildren: (...args: unknown[]) => mockCopyAcrossChildren(...args),
		},
	}),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
	copyChildChallengesToSibling,
	copyChildChallengesToSiblings,
} from '../../../src/lib/server/services/child-challenge-copy-service';

const TENANT = 'test-tenant-001';
const SOURCE = 101;

beforeEach(() => {
	vi.clearAllMocks();
	mockCopyAcrossChildren.mockResolvedValue([]);
});

describe('copyChildChallengesToSiblings', () => {
	it('targetChildIds 空 → totalCopied=0、repo 呼ばれない', async () => {
		const result = await copyChildChallengesToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [],
		});
		expect(result.totalCopied).toBe(0);
		expect(result.byTargetChild).toEqual({});
		expect(result.errors).toEqual([]);
		expect(mockCopyAcrossChildren).not.toHaveBeenCalled();
	});

	it('複数 target に対し repo 呼び出し + 件数集計', async () => {
		mockCopyAcrossChildren
			.mockResolvedValueOnce([{ id: 201 }, { id: 202 }])
			.mockResolvedValueOnce([{ id: 203 }]);
		const result = await copyChildChallengesToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [102, 103],
		});
		expect(result.totalCopied).toBe(3);
		expect(result.byTargetChild).toEqual({ 102: 2, 103: 1 });
		expect(result.errors).toEqual([]);
		expect(mockCopyAcrossChildren).toHaveBeenCalledTimes(2);
	});

	it('self-copy (sourceChildId と同一 targetChildId) は除外', async () => {
		mockCopyAcrossChildren.mockResolvedValueOnce([{ id: 201 }]);
		const result = await copyChildChallengesToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [SOURCE, 102],
		});
		// SOURCE は除外、102 のみ呼ばれる
		expect(mockCopyAcrossChildren).toHaveBeenCalledTimes(1);
		expect(mockCopyAcrossChildren).toHaveBeenCalledWith(SOURCE, 102, TENANT);
		expect(result.totalCopied).toBe(1);
	});

	it('1 target 失敗 → 他は継続 (partial success)、errors に記録', async () => {
		mockCopyAcrossChildren
			.mockResolvedValueOnce([{ id: 201 }])
			.mockRejectedValueOnce(new Error('FK violation'))
			.mockResolvedValueOnce([{ id: 202 }]);
		const result = await copyChildChallengesToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [102, 103, 104],
		});
		expect(result.totalCopied).toBe(2);
		expect(result.byTargetChild).toEqual({ 102: 1, 104: 1 });
		expect(result.errors).toEqual([{ targetChildId: 103, message: 'FK violation' }]);
	});

	it('tenantId を repo 呼出に伝播', async () => {
		await copyChildChallengesToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [102],
		});
		expect(mockCopyAcrossChildren).toHaveBeenCalledWith(SOURCE, 102, TENANT);
	});
});

describe('copyChildChallengesToSibling (single)', () => {
	it('source === target で throw', async () => {
		await expect(copyChildChallengesToSibling(TENANT, SOURCE, SOURCE)).rejects.toThrow(
			'sourceChildId と targetChildId が同一',
		);
	});

	it('正常時は repo 結果をそのまま返す', async () => {
		mockCopyAcrossChildren.mockResolvedValueOnce([{ id: 201 }, { id: 202 }]);
		const result = await copyChildChallengesToSibling(TENANT, SOURCE, 102);
		expect(result).toEqual([{ id: 201 }, { id: 202 }]);
	});
});
