// tests/unit/services/child-reward-copy-service.test.ts
// 兄弟共通化 UX (#2362 PR-4、ADR-0055) unit test
//
// PR-3 `child-activity-copy-service.test.ts` と同型 pattern。
// 検証範囲:
//   - 複数 target child に対する一括コピー
//   - self-copy 拒否
//   - 1 target が失敗しても他は継続 (partial success)
//   - tenant isolation の引数伝播
//   - 同一 title の重複 skip (UX 重複防止)
//   - source reward 0 件時は早期 return + repo write ゼロ
//   - 単一 convenience (copyChildRewardsToSibling) の正常系 / self-copy 例外

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- Top-level mocks ----------

const mockFindSpecialRewards = vi.fn();
const mockInsertSpecialReward = vi.fn();

vi.mock('$lib/server/db/special-reward-repo', () => ({
	findSpecialRewards: (...args: unknown[]) => mockFindSpecialRewards(...args),
	insertSpecialReward: (...args: unknown[]) => mockInsertSpecialReward(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------- Import after mocks ----------

import {
	copyChildRewardsToSibling,
	copyChildRewardsToSiblings,
} from '../../../src/lib/server/services/child-reward-copy-service';

const TENANT = 'test-tenant-001';
const SOURCE = 101;

function makeReward(overrides: Record<string, unknown> = {}) {
	return {
		id: 1,
		childId: SOURCE,
		grantedBy: null,
		title: 'アイスクリーム',
		description: null,
		points: 50,
		icon: '🍦',
		category: 'other',
		grantedAt: '2026-05-01T00:00:00Z',
		shownAt: null,
		sourcePresetId: null,
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockFindSpecialRewards.mockResolvedValue([]);
	mockInsertSpecialReward.mockResolvedValue({ id: 999 });
});

// ============================================================
// copyChildRewardsToSiblings
// ============================================================

describe('copyChildRewardsToSiblings', () => {
	it('targetChildIds 空 -> totalCopied=0、insert は呼ばれない', async () => {
		const result = await copyChildRewardsToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [],
		});

		expect(result.totalCopied).toBe(0);
		expect(result.byTargetChild).toEqual({});
		expect(result.errors).toEqual([]);
		expect(mockInsertSpecialReward).not.toHaveBeenCalled();
	});

	it('source reward 0 件 -> 全 target で skip + insert 呼出ゼロ', async () => {
		mockFindSpecialRewards.mockResolvedValueOnce([]); // source の取得結果
		const result = await copyChildRewardsToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [202, 303],
		});

		expect(result.totalCopied).toBe(0);
		expect(result.byTargetChild).toEqual({});
		expect(result.errors).toEqual([]);
		// source 1 回のみ取得、target 側 find / insert は呼ばれない (早期 return)
		expect(mockFindSpecialRewards).toHaveBeenCalledTimes(1);
		expect(mockInsertSpecialReward).not.toHaveBeenCalled();
	});

	it('targets 1 件 -> reward 全件 copy + 件数集計', async () => {
		const rewards = [
			makeReward({ id: 1, title: 'アイス' }),
			makeReward({ id: 2, title: 'ケーキ' }),
			makeReward({ id: 3, title: 'プリン' }),
		];
		mockFindSpecialRewards
			.mockResolvedValueOnce(rewards) // source 取得
			.mockResolvedValueOnce([]); // target 202 既存空

		const result = await copyChildRewardsToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [202],
		});

		expect(result.totalCopied).toBe(3);
		expect(result.byTargetChild).toEqual({ 202: 3 });
		expect(result.errors).toEqual([]);
		expect(mockInsertSpecialReward).toHaveBeenCalledTimes(3);
		// childId / tenantId 伝播確認
		const firstCall = mockInsertSpecialReward.mock.calls[0];
		expect(firstCall?.[0]).toMatchObject({ childId: 202, title: 'アイス' });
		expect(firstCall?.[1]).toBe(TENANT);
	});

	it('targets 3 件 -> 全 target に reward 複製 + 件数集計', async () => {
		const rewards = [makeReward({ id: 1, title: 'A' }), makeReward({ id: 2, title: 'B' })];
		mockFindSpecialRewards
			.mockResolvedValueOnce(rewards) // source
			.mockResolvedValueOnce([]) // target 202
			.mockResolvedValueOnce([]) // target 303
			.mockResolvedValueOnce([]); // target 404

		const result = await copyChildRewardsToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [202, 303, 404],
		});

		expect(result.totalCopied).toBe(6); // 2 reward × 3 target
		expect(result.byTargetChild).toEqual({ 202: 2, 303: 2, 404: 2 });
		expect(result.errors).toEqual([]);
		expect(mockInsertSpecialReward).toHaveBeenCalledTimes(6);
	});

	it('既存 target に同一 title が存在する場合は skip (重複防止)', async () => {
		mockFindSpecialRewards
			.mockResolvedValueOnce([
				makeReward({ id: 1, title: 'アイス' }),
				makeReward({ id: 2, title: 'ケーキ' }),
			])
			.mockResolvedValueOnce([
				// target 202 に既に「アイス」が存在
				makeReward({ id: 99, childId: 202, title: 'アイス' }),
			]);

		const result = await copyChildRewardsToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [202],
		});

		// アイスは skip、ケーキのみ copy
		expect(result.totalCopied).toBe(1);
		expect(result.byTargetChild).toEqual({ 202: 1 });
		expect(mockInsertSpecialReward).toHaveBeenCalledTimes(1);
		expect(mockInsertSpecialReward.mock.calls[0]?.[0]).toMatchObject({
			title: 'ケーキ',
		});
	});

	it('self-copy (source == target) は filter で除外され insert ゼロ', async () => {
		mockFindSpecialRewards.mockResolvedValueOnce([makeReward()]);
		const result = await copyChildRewardsToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [SOURCE],
		});

		expect(result.totalCopied).toBe(0);
		expect(result.byTargetChild).toEqual({});
		expect(result.errors).toEqual([]);
		expect(mockInsertSpecialReward).not.toHaveBeenCalled();
	});

	it('source が target に混在 -> source のみ除外、他は処理継続', async () => {
		const rewards = [makeReward({ id: 1, title: 'A' })];
		mockFindSpecialRewards
			.mockResolvedValueOnce(rewards) // source
			.mockResolvedValueOnce([]) // target 202 既存空
			.mockResolvedValueOnce([]); // target 303 既存空

		const result = await copyChildRewardsToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [SOURCE, 202, 303],
		});

		expect(result.totalCopied).toBe(2);
		expect(result.byTargetChild).toEqual({ 202: 1, 303: 1 });
		expect(mockInsertSpecialReward).toHaveBeenCalledTimes(2);
	});

	it('1 target の取得が失敗しても他は継続 (partial success)', async () => {
		mockFindSpecialRewards
			.mockResolvedValueOnce([makeReward({ id: 1, title: 'A' })]) // source
			.mockRejectedValueOnce(new Error('target=202 not found')) // target 202
			.mockResolvedValueOnce([]); // target 303 既存空

		const result = await copyChildRewardsToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [202, 303],
		});

		expect(result.totalCopied).toBe(1); // 303 のみ成功
		expect(result.byTargetChild).toEqual({ 303: 1 });
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toMatchObject({
			targetChildId: 202,
			message: expect.stringContaining('not found'),
		});
	});

	it('1 reward の insert が失敗しても target 単位で errors に集約', async () => {
		const rewards = [makeReward({ id: 1, title: 'A' }), makeReward({ id: 2, title: 'B' })];
		mockFindSpecialRewards
			.mockResolvedValueOnce(rewards) // source
			.mockResolvedValueOnce([]); // target 202 既存空
		mockInsertSpecialReward
			.mockRejectedValueOnce(new Error('FK violation')) // 「A」失敗
			.mockResolvedValueOnce({ id: 2 }); // 「B」成功 — だが実装は try/catch を target 単位で持つため
		// 注: 現実装は insert 例外で target 全体が catch 句に入り byTargetChild に
		// 記録されない (errors のみ)。テストはこの仕様を documentation する形にする。

		const result = await copyChildRewardsToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [202],
		});

		// target 単位 try/catch のため A 失敗で B も到達しない
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]?.targetChildId).toBe(202);
	});

	it('tenantId が全 insert に伝播する', async () => {
		mockFindSpecialRewards
			.mockResolvedValueOnce([makeReward()]) // source
			.mockResolvedValueOnce([]) // target 202
			.mockResolvedValueOnce([]); // target 303

		await copyChildRewardsToSiblings({
			tenantId: 'tenant-x',
			sourceChildId: SOURCE,
			targetChildIds: [202, 303],
		});

		for (const call of mockInsertSpecialReward.mock.calls) {
			expect(call[1]).toBe('tenant-x');
		}
	});

	it('sourcePresetId が target にも引き継がれる (取込重複検知の互換性)', async () => {
		mockFindSpecialRewards
			.mockResolvedValueOnce([makeReward({ title: 'X', sourcePresetId: 'kinder-rewards' })])
			.mockResolvedValueOnce([]);

		await copyChildRewardsToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [202],
		});

		expect(mockInsertSpecialReward).toHaveBeenCalledWith(
			expect.objectContaining({
				sourcePresetId: 'kinder-rewards',
				childId: 202,
			}),
			TENANT,
		);
	});
});

// ============================================================
// copyChildRewardsToSibling (single convenience)
// ============================================================

describe('copyChildRewardsToSibling', () => {
	it('正常系: source の reward 全件を target に複製し件数を返す', async () => {
		mockFindSpecialRewards
			.mockResolvedValueOnce([makeReward({ id: 1, title: 'A' }), makeReward({ id: 2, title: 'B' })])
			.mockResolvedValueOnce([]);

		const count = await copyChildRewardsToSibling(TENANT, SOURCE, 202);

		expect(count).toBe(2);
		expect(mockInsertSpecialReward).toHaveBeenCalledTimes(2);
	});

	it('source == target -> Error throw (insert 呼出ゼロ)', async () => {
		await expect(copyChildRewardsToSibling(TENANT, SOURCE, SOURCE)).rejects.toThrow(/同じ/);
		expect(mockInsertSpecialReward).not.toHaveBeenCalled();
	});

	it('target side が throw -> 上位に伝播 (Error を bubble)', async () => {
		mockFindSpecialRewards
			.mockResolvedValueOnce([makeReward()]) // source 取得
			.mockRejectedValueOnce(new Error('target child not found'));

		await expect(copyChildRewardsToSibling(TENANT, SOURCE, 202)).rejects.toThrow(
			'target child not found',
		);
	});

	it('source reward 0 件 -> count=0 で返す (throw しない)', async () => {
		mockFindSpecialRewards.mockResolvedValueOnce([]); // source 0 件
		const count = await copyChildRewardsToSibling(TENANT, SOURCE, 202);
		expect(count).toBe(0);
		expect(mockInsertSpecialReward).not.toHaveBeenCalled();
	});
});
