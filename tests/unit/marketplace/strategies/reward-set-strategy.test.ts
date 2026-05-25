/**
 * tests/unit/marketplace/strategies/reward-set-strategy.test.ts
 *
 * reward-set ImportStrategy unit tests — Issue #2366 / ADR-0052
 *
 * 検証:
 *   - parse() の Valibot 経由 validation (成功 / 失敗)
 *   - preview() が DB write せずに件数集計を返す
 *   - apply() が importRewardSet を呼んで結果を返す
 *   - apply() の dryRun=true は preview と等価動作
 *   - tenant 必須 (ctx.tenantId が下流に伝播)
 *   - **childId 必須**: requiresChildId=true の Strategy で childId 未指定時に fail-fast
 *   - presetId 必須: sourcePresetId 重複検知 (#1254 G1)
 *   - sourcePresetId 重複検知が新 Strategy 経由でも動作する
 */

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

import { rewardSetStrategy } from '../../../../src/lib/marketplace/strategies/reward-set-strategy';

const TENANT = 'test-tenant-001';
const PRESET_ID = 'kinder-rewards';
const CHILD_ID = 42;

function makeReward(overrides: Record<string, unknown> = {}) {
	return {
		title: 'アイスクリーム',
		points: 50,
		icon: '🍦',
		category: 'other' as const,
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockFindSpecialRewards.mockResolvedValue([]);
	mockInsertSpecialReward.mockResolvedValue({ id: 1 });
});

// =====================================================
// parse()
// =====================================================

describe('rewardSetStrategy.parse', () => {
	it('有効な payload を parse して同等 object を返す', () => {
		const input = { rewards: [makeReward()] };
		const result = rewardSetStrategy.parse(input);
		expect(result.rewards).toHaveLength(1);
		expect(result.rewards[0]?.title).toBe('アイスクリーム');
	});

	it('rewards が空配列なら error throw', () => {
		expect(() => rewardSetStrategy.parse({ rewards: [] })).toThrow(/rewards/);
	});

	it('rewards key が無い payload は error throw', () => {
		expect(() => rewardSetStrategy.parse({})).toThrow();
	});

	it('category が REWARD_CATEGORIES 外なら error throw', () => {
		const input = { rewards: [makeReward({ category: 'invalid' })] };
		expect(() => rewardSetStrategy.parse(input)).toThrow(/category/);
	});

	it('points が 0 以下なら error throw', () => {
		const input = { rewards: [makeReward({ points: 0 })] };
		expect(() => rewardSetStrategy.parse(input)).toThrow();
	});

	it('title が空文字なら error throw', () => {
		const input = { rewards: [makeReward({ title: '' })] };
		expect(() => rewardSetStrategy.parse(input)).toThrow();
	});

	it('points が 10000 超過なら error throw', () => {
		const input = { rewards: [makeReward({ points: 10001 })] };
		expect(() => rewardSetStrategy.parse(input)).toThrow();
	});
});

// =====================================================
// preview()
// =====================================================

describe('rewardSetStrategy.preview', () => {
	it('既存 reward なし -> 全て新規としてカウント', async () => {
		mockFindSpecialRewards.mockResolvedValue([]);
		const payload = {
			rewards: [makeReward({ title: 'A' }), makeReward({ title: 'B' })],
		};
		const preview = await rewardSetStrategy.preview(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});
		expect(preview.total).toBe(2);
		expect(preview.newItems).toBe(2);
		expect(preview.duplicates).toBe(0);
		expect(preview.duplicateNames).toEqual([]);
	});

	it('一部重複 (sourcePresetId 一致 + title 一致) -> 正しくカウント', async () => {
		mockFindSpecialRewards.mockResolvedValue([{ title: 'A', sourcePresetId: PRESET_ID }]);
		const payload = {
			rewards: [makeReward({ title: 'A' }), makeReward({ title: 'B' })],
		};
		const preview = await rewardSetStrategy.preview(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});
		expect(preview.total).toBe(2);
		expect(preview.newItems).toBe(1);
		expect(preview.duplicates).toBe(1);
		expect(preview.duplicateNames).toEqual(['A']);
	});

	it('別 sourcePresetId で同名 reward は重複扱いしない (誤検知防止)', async () => {
		mockFindSpecialRewards.mockResolvedValue([{ title: 'A', sourcePresetId: 'other-preset' }]);
		const payload = { rewards: [makeReward({ title: 'A' })] };
		const preview = await rewardSetStrategy.preview(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});
		expect(preview.duplicates).toBe(0);
		expect(preview.newItems).toBe(1);
	});

	it('preview() は insertSpecialReward を呼ばない (DB write 禁止)', async () => {
		const payload = { rewards: [makeReward({ title: 'X' })] };
		await rewardSetStrategy.preview(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});
		expect(mockInsertSpecialReward).not.toHaveBeenCalled();
	});

	it('childId が findSpecialRewards に渡される', async () => {
		const payload = { rewards: [makeReward()] };
		await rewardSetStrategy.preview(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});
		expect(mockFindSpecialRewards).toHaveBeenCalledWith(CHILD_ID, TENANT);
	});

	it('childId 未指定なら preview で error throw (requiresChildId=true)', async () => {
		const payload = { rewards: [makeReward()] };
		await expect(
			rewardSetStrategy.preview(payload, { tenantId: TENANT, presetId: PRESET_ID }),
		).rejects.toThrow(/childId/);
	});

	it('presetId 未指定なら preview で error throw (#1254 G1 sourcePresetId 検知のため必須)', async () => {
		const payload = { rewards: [makeReward()] };
		await expect(
			rewardSetStrategy.preview(payload, { tenantId: TENANT, childId: CHILD_ID }),
		).rejects.toThrow(/presetId/);
	});
});

// =====================================================
// apply()
// =====================================================

describe('rewardSetStrategy.apply', () => {
	it('全件新規 -> imported=件数, skipped=0', async () => {
		const payload = {
			rewards: [makeReward({ title: 'A' }), makeReward({ title: 'B' })],
		};
		const result = await rewardSetStrategy.apply(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});
		expect(result.imported).toBe(2);
		expect(result.skipped).toBe(0);
		expect(result.errors).toEqual([]);
		expect(mockInsertSpecialReward).toHaveBeenCalledTimes(2);
	});

	it('sourcePresetId が insertSpecialReward に渡される (#1254 G1)', async () => {
		const payload = { rewards: [makeReward({ title: 'X' })] };
		await rewardSetStrategy.apply(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});
		expect(mockInsertSpecialReward).toHaveBeenCalledWith(
			expect.objectContaining({ sourcePresetId: PRESET_ID, childId: CHILD_ID }),
			TENANT,
		);
	});

	it('重複ありなら skipped=重複件数 (sourcePresetId + title)', async () => {
		mockFindSpecialRewards.mockResolvedValue([{ title: 'A', sourcePresetId: PRESET_ID }]);
		const payload = {
			rewards: [makeReward({ title: 'A' }), makeReward({ title: 'B' })],
		};
		const result = await rewardSetStrategy.apply(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});
		expect(result.imported).toBe(1);
		expect(result.skipped).toBe(1);
		expect(mockInsertSpecialReward).toHaveBeenCalledTimes(1);
	});

	it('dryRun=true -> DB write せず imported=0', async () => {
		mockFindSpecialRewards.mockResolvedValue([{ title: 'A', sourcePresetId: PRESET_ID }]);
		const payload = {
			rewards: [makeReward({ title: 'A' }), makeReward({ title: 'B' })],
		};
		const result = await rewardSetStrategy.apply(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childId: CHILD_ID,
			dryRun: true,
		});
		expect(result.imported).toBe(0);
		expect(result.skipped).toBe(1);
		expect(mockInsertSpecialReward).not.toHaveBeenCalled();
	});

	it('insertSpecialReward が throw した場合 errors に記録 + 処理継続', async () => {
		mockInsertSpecialReward
			.mockRejectedValueOnce(new Error('DB error'))
			.mockResolvedValueOnce({ id: 2 });
		const payload = {
			rewards: [makeReward({ title: 'failing' }), makeReward({ title: 'ok' })],
		};
		const result = await rewardSetStrategy.apply(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});
		expect(result.imported).toBe(1);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain('failing');
	});

	it('childId 未指定なら apply で error throw (requiresChildId=true 表明)', async () => {
		const payload = { rewards: [makeReward()] };
		await expect(
			rewardSetStrategy.apply(payload, { tenantId: TENANT, presetId: PRESET_ID }),
		).rejects.toThrow(/childId/);
	});

	it('presetId 未指定なら apply で error throw', async () => {
		const payload = { rewards: [makeReward()] };
		await expect(
			rewardSetStrategy.apply(payload, { tenantId: TENANT, childId: CHILD_ID }),
		).rejects.toThrow(/presetId/);
	});
});

// =====================================================
// dispatcher integration
// =====================================================

describe('marketplace dispatcher + reward-set', () => {
	it('Registry 経由で reward-set が解決でき、dispatchImport が成立', async () => {
		// eager-load が走るよう $lib/marketplace import
		const { marketplaceRegistry, dispatchImport } = await import('../../../../src/lib/marketplace');

		// Registry に reward-set が登録されていること
		expect(marketplaceRegistry.has('reward-set')).toBe(true);
		const desc = marketplaceRegistry.get('reward-set');
		expect(desc.typeCode).toBe('reward-set');
		expect(desc.requiresChildId).toBe(true);

		// dispatchImport が動作すること
		const payload = {
			rewards: [makeReward({ title: 'dispatched' })],
		};
		const result = await dispatchImport({
			typeCode: 'reward-set',
			rawPayload: payload,
			displayName: 'test reward set',
			ctx: { tenantId: TENANT, presetId: PRESET_ID, childId: CHILD_ID },
		});
		expect(result.importResult).toBe(true);
		expect(result.packName).toBe('test reward set');
		expect(result.imported).toBe(1);
		expect(result.total).toBe(1);
	});

	it('dispatchImport: childId 未指定で error throw (requiresChildId=true)', async () => {
		const { dispatchImport } = await import('../../../../src/lib/marketplace');
		const payload = { rewards: [makeReward()] };
		await expect(
			dispatchImport({
				typeCode: 'reward-set',
				rawPayload: payload,
				displayName: 'test',
				ctx: { tenantId: TENANT, presetId: PRESET_ID },
			}),
		).rejects.toThrow(/childId/);
	});
});

// =====================================================
// #2362 PR-4 (ADR-0055) — discriminated union narrowing + per-child fan-out
// =====================================================

describe('rewardSetStrategy narrowChildContext (#2362 PR-4)', () => {
	it('childIds (non-empty) -> child-selection に narrow される', async () => {
		const { narrowChildContext } = await import(
			'../../../../src/lib/marketplace/strategies/reward-set-strategy'
		);
		const ctx = { tenantId: TENANT, presetId: PRESET_ID, childIds: [202, 303] };
		const narrowed = narrowChildContext(ctx);
		expect(narrowed.kind).toBe('child-selection');
		if (narrowed.kind === 'child-selection') {
			expect(narrowed.childIds).toEqual([202, 303]);
			expect(narrowed.presetId).toBe(PRESET_ID);
		}
	});

	it('childId のみ (legacy) -> legacy-single に narrow される', async () => {
		const { narrowChildContext } = await import(
			'../../../../src/lib/marketplace/strategies/reward-set-strategy'
		);
		const ctx = { tenantId: TENANT, presetId: PRESET_ID, childId: CHILD_ID };
		const narrowed = narrowChildContext(ctx);
		expect(narrowed.kind).toBe('legacy-single');
		if (narrowed.kind === 'legacy-single') {
			expect(narrowed.childId).toBe(CHILD_ID);
		}
	});

	it('childIds が空配列 -> childId fallback (legacy-single)', async () => {
		const { narrowChildContext } = await import(
			'../../../../src/lib/marketplace/strategies/reward-set-strategy'
		);
		const ctx = {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childIds: [] as readonly number[],
			childId: CHILD_ID,
		};
		const narrowed = narrowChildContext(ctx);
		expect(narrowed.kind).toBe('legacy-single');
	});

	it('childIds / childId 両方欠落 -> Error throw', async () => {
		const { narrowChildContext } = await import(
			'../../../../src/lib/marketplace/strategies/reward-set-strategy'
		);
		expect(() => narrowChildContext({ tenantId: TENANT, presetId: PRESET_ID })).toThrow(
			/childIds.*childId/,
		);
	});

	it('presetId 欠落 -> Error throw (sourcePresetId 重複検知のため)', async () => {
		const { narrowChildContext } = await import(
			'../../../../src/lib/marketplace/strategies/reward-set-strategy'
		);
		expect(() => narrowChildContext({ tenantId: TENANT, childIds: [202] } as never)).toThrow(
			/presetId/,
		);
	});
});

describe('rewardSetStrategy.apply (per-child fan-out)', () => {
	it('childIds 配列指定 -> importRewardSetToChildren 経由で全 child に取込', async () => {
		const payload = {
			rewards: [makeReward({ title: 'A' }), makeReward({ title: 'B' })],
		};
		// 全 child で既存空
		mockFindSpecialRewards.mockResolvedValue([]);

		const result = await rewardSetStrategy.apply(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childIds: [202, 303],
		});

		expect(result.imported).toBe(4); // 2 reward × 2 child
		expect(result.skipped).toBe(0);
		expect(result.errors).toEqual([]);
		// 4 件全てに child / preset / tenant が伝播
		expect(mockInsertSpecialReward).toHaveBeenCalledTimes(4);
	});

	it('per-child fan-out: 1 child で失敗、他 child は継続 (partial success)', async () => {
		const payload = { rewards: [makeReward({ title: 'X' })] };
		mockFindSpecialRewards.mockResolvedValue([]);
		mockInsertSpecialReward
			.mockRejectedValueOnce(new Error('child 202 FK violation'))
			.mockResolvedValueOnce({ id: 99 });

		const result = await rewardSetStrategy.apply(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childIds: [202, 303],
		});

		expect(result.imported).toBe(1); // 303 のみ成功
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toMatch(/child 202/);
	});

	it('childIds: dryRun=true -> insert 呼出ゼロ + skipped=duplicates', async () => {
		mockFindSpecialRewards.mockResolvedValue([{ title: 'A', sourcePresetId: PRESET_ID }]);
		const payload = {
			rewards: [makeReward({ title: 'A' }), makeReward({ title: 'B' })],
		};
		const result = await rewardSetStrategy.apply(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childIds: [202, 303],
			dryRun: true,
		});
		expect(result.imported).toBe(0);
		expect(mockInsertSpecialReward).not.toHaveBeenCalled();
	});
});
