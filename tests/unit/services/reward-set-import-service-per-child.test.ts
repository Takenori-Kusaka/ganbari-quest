// tests/unit/services/reward-set-import-service-per-child.test.ts
// #2362 PR-4 (ADR-0055): importRewardSetToChildren per-child fan-out 検証
//
// 既存 reward-set-import-service.test.ts は単一 child (legacy) の preview / apply を検証。
// 本テストは「複数 child への per-child fan-out」専用:
//   - childIds 配列で複数 child に同時取込
//   - tenant isolation の伝播 (全 child 共通)
//   - 1 child の失敗が他 child を blocking しない (partial success)
//   - 各 child 別の byChild 集計
//   - 重複は child 別に judge (sourcePresetId + title 単位)

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RewardSetItem } from '../../../src/lib/server/services/reward-set-import-service';

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

import { importRewardSetToChildren } from '../../../src/lib/server/services/reward-set-import-service';

const TENANT = 'test-tenant-001';
const PRESET_ID = 'kinder-rewards';

function makeReward(overrides: Partial<RewardSetItem> = {}): RewardSetItem {
	return {
		title: 'テストごほうび',
		points: 20,
		icon: '🎁',
		category: 'other',
		description: '説明',
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockFindSpecialRewards.mockResolvedValue([]);
	mockInsertSpecialReward.mockResolvedValue({ id: 1 });
});

// ============================================================
// importRewardSetToChildren
// ============================================================

describe('importRewardSetToChildren', () => {
	it('childIds 配列が空 -> imported=0、insert 呼出ゼロ', async () => {
		const rewards = [makeReward({ title: 'A' })];
		const result = await importRewardSetToChildren(rewards, TENANT, {
			presetId: PRESET_ID,
			childIds: [],
		});
		expect(result.imported).toBe(0);
		expect(result.skipped).toBe(0);
		expect(result.errors).toEqual([]);
		expect(result.byChild).toEqual({});
		expect(mockInsertSpecialReward).not.toHaveBeenCalled();
	});

	it('childIds 1 件 -> 単一 child に全件取込', async () => {
		const rewards = [makeReward({ title: 'A' }), makeReward({ title: 'B' })];
		mockFindSpecialRewards.mockResolvedValue([]); // 全 child で既存空

		const result = await importRewardSetToChildren(rewards, TENANT, {
			presetId: PRESET_ID,
			childIds: [202],
		});

		expect(result.imported).toBe(2);
		expect(result.skipped).toBe(0);
		expect(result.byChild).toEqual({ 202: { imported: 2, skipped: 0, errors: 0 } });
		expect(mockInsertSpecialReward).toHaveBeenCalledTimes(2);
	});

	it('childIds 3 件 -> 全 child に同 reward set を取込', async () => {
		const rewards = [makeReward({ title: 'A' }), makeReward({ title: 'B' })];
		mockFindSpecialRewards.mockResolvedValue([]);

		const result = await importRewardSetToChildren(rewards, TENANT, {
			presetId: PRESET_ID,
			childIds: [202, 303, 404],
		});

		expect(result.imported).toBe(6); // 2 reward × 3 child
		expect(result.skipped).toBe(0);
		expect(result.byChild).toEqual({
			202: { imported: 2, skipped: 0, errors: 0 },
			303: { imported: 2, skipped: 0, errors: 0 },
			404: { imported: 2, skipped: 0, errors: 0 },
		});
		expect(mockInsertSpecialReward).toHaveBeenCalledTimes(6);
	});

	it('一部 child で重複あり -> child 別 skipped が記録される', async () => {
		const rewards = [makeReward({ title: 'A' }), makeReward({ title: 'B' })];
		// child 202: 既存「A」あり (skip)、child 303: 既存空
		mockFindSpecialRewards
			.mockResolvedValueOnce([
				{
					id: 1,
					childId: 202,
					title: 'A',
					sourcePresetId: PRESET_ID,
					grantedBy: null,
					points: 10,
					icon: '🎁',
					category: 'other',
					description: null,
					grantedAt: '2026-05-01T00:00:00Z',
					shownAt: null,
				},
			])
			.mockResolvedValueOnce([]); // child 303 空

		const result = await importRewardSetToChildren(rewards, TENANT, {
			presetId: PRESET_ID,
			childIds: [202, 303],
		});

		expect(result.imported).toBe(3); // 202: B のみ (A 重複)、303: A+B
		expect(result.skipped).toBe(1); // 202 の A
		expect(result.byChild).toEqual({
			202: { imported: 1, skipped: 1, errors: 0 },
			303: { imported: 2, skipped: 0, errors: 0 },
		});
	});

	it('1 child の DB error が他 child を blocking しない (partial success)', async () => {
		const rewards = [makeReward({ title: 'A' })];
		mockFindSpecialRewards.mockResolvedValue([]);
		mockInsertSpecialReward
			.mockRejectedValueOnce(new Error('child 202 FK violation'))
			.mockResolvedValueOnce({ id: 99 });

		const result = await importRewardSetToChildren(rewards, TENANT, {
			presetId: PRESET_ID,
			childIds: [202, 303],
		});

		// 202: insert 失敗で errors 1 件、303: 正常 1 件
		expect(result.imported).toBe(1); // 303 のみ
		expect(result.byChild[202]).toEqual({ imported: 0, skipped: 0, errors: 1 });
		expect(result.byChild[303]).toEqual({ imported: 1, skipped: 0, errors: 0 });
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toMatch(/child 202/); // child prefix が付与される
		expect(result.errors[0]).toMatch(/「A」/);
	});

	it('tenantId が全 child の insert に伝播する', async () => {
		const rewards = [makeReward({ title: 'A' })];
		mockFindSpecialRewards.mockResolvedValue([]);

		await importRewardSetToChildren(rewards, 'tenant-z', {
			presetId: PRESET_ID,
			childIds: [202, 303],
		});

		for (const call of mockInsertSpecialReward.mock.calls) {
			expect(call[1]).toBe('tenant-z');
		}
	});

	it('insertSpecialReward に sourcePresetId が child 別で正しく付与される (#1254 G1 互換)', async () => {
		const rewards = [makeReward({ title: 'X' })];
		mockFindSpecialRewards.mockResolvedValue([]);

		await importRewardSetToChildren(rewards, TENANT, {
			presetId: 'school-rewards',
			childIds: [202, 303],
		});

		const c202 = mockInsertSpecialReward.mock.calls[0]?.[0];
		const c303 = mockInsertSpecialReward.mock.calls[1]?.[0];
		expect(c202).toMatchObject({ sourcePresetId: 'school-rewards', childId: 202 });
		expect(c303).toMatchObject({ sourcePresetId: 'school-rewards', childId: 303 });
	});
});
