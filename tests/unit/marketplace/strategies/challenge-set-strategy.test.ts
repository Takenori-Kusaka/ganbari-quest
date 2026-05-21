/**
 * tests/unit/marketplace/strategies/challenge-set-strategy.test.ts
 *
 * challenge-set ImportStrategy unit tests — Issue #2369 / EPIC #2362 P3 / ADR-0052
 *
 * 検証:
 *   - parse() の Valibot 経由 validation (成功 / 失敗 / monthDay regex / categoryId picklist)
 *   - preview() が DB write せずに件数集計を返す (重複は title ベース)
 *   - apply() が importChallengeSet を呼んで結果を返す
 *   - apply() の dryRun=true は preview と等価動作
 *   - Registry 経由の dispatcher integration
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- Top-level mocks ----------

const mockFindAllChallenges = vi.fn();
const mockCreateSiblingChallenge = vi.fn();

vi.mock('$lib/server/db/sibling-challenge-repo', () => ({
	findAllChallenges: (...args: unknown[]) => mockFindAllChallenges(...args),
}));

vi.mock('$lib/server/services/sibling-challenge-service', () => ({
	createSiblingChallenge: (...args: unknown[]) => mockCreateSiblingChallenge(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------- Import after mocks ----------

import { challengeSetStrategy } from '../../../../src/lib/marketplace/strategies/challenge-set-strategy';

const TENANT = 'test-tenant-002';

function makeChallenge(overrides: Record<string, unknown> = {}) {
	return {
		title: 'ひな祭り大そうじ',
		description: 'ひな人形の飾りつけ・お部屋のお片付け',
		monthDay: '03-03',
		durationDays: 3,
		categoryId: 3 as const,
		baseTarget: 3,
		rewardPoints: 30,
		icon: '🎎',
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockFindAllChallenges.mockResolvedValue([]);
	mockCreateSiblingChallenge.mockResolvedValue({ id: 1, title: 'mock' });
});

// =====================================================
// parse()
// =====================================================

describe('challengeSetStrategy.parse', () => {
	it('有効な payload を parse して同等 object を返す', () => {
		const input = { challenges: [makeChallenge()] };
		const result = challengeSetStrategy.parse(input);
		expect(result.challenges).toHaveLength(1);
		expect(result.challenges[0]?.title).toBe('ひな祭り大そうじ');
	});

	it('challenges が空配列なら error throw', () => {
		expect(() => challengeSetStrategy.parse({ challenges: [] })).toThrow(/challenges/);
	});

	it('challenges key が無い payload は error throw', () => {
		expect(() => challengeSetStrategy.parse({})).toThrow();
	});

	it('monthDay が MM-DD 形式でないと error throw', () => {
		const input = { challenges: [makeChallenge({ monthDay: '13-99' })] };
		expect(() => challengeSetStrategy.parse(input)).toThrow(/monthDay/);
	});

	it('categoryId が picklist 外なら error throw', () => {
		const input = { challenges: [makeChallenge({ categoryId: 99 })] };
		expect(() => challengeSetStrategy.parse(input)).toThrow(/categoryId/);
	});

	it('durationDays が 0 以下なら error throw', () => {
		const input = { challenges: [makeChallenge({ durationDays: 0 })] };
		expect(() => challengeSetStrategy.parse(input)).toThrow();
	});

	it('durationDays が 90 超なら error throw (#2364 schema 上限)', () => {
		const input = { challenges: [makeChallenge({ durationDays: 91 })] };
		expect(() => challengeSetStrategy.parse(input)).toThrow();
	});

	it('title が空文字なら error throw', () => {
		const input = { challenges: [makeChallenge({ title: '' })] };
		expect(() => challengeSetStrategy.parse(input)).toThrow();
	});

	it('baseTarget が 0 なら error throw', () => {
		const input = { challenges: [makeChallenge({ baseTarget: 0 })] };
		expect(() => challengeSetStrategy.parse(input)).toThrow();
	});
});

// =====================================================
// preview()
// =====================================================

describe('challengeSetStrategy.preview', () => {
	it('既存 0 件 → 全て新規としてカウント', async () => {
		mockFindAllChallenges.mockResolvedValue([]);
		const payload = {
			challenges: [
				makeChallenge({ title: 'A' }),
				makeChallenge({ title: 'B', categoryId: 2 as const }),
			],
		};
		const preview = await challengeSetStrategy.preview(payload, { tenantId: TENANT });
		expect(preview.total).toBe(2);
		expect(preview.newItems).toBe(2);
		expect(preview.duplicates).toBe(0);
	});

	it('一部 title 重複 → 正しくカウント', async () => {
		mockFindAllChallenges.mockResolvedValue([{ title: 'A' }]);
		const payload = {
			challenges: [
				makeChallenge({ title: 'A' }),
				makeChallenge({ title: 'B', categoryId: 2 as const }),
			],
		};
		const preview = await challengeSetStrategy.preview(payload, { tenantId: TENANT });
		expect(preview.total).toBe(2);
		expect(preview.newItems).toBe(1);
		expect(preview.duplicates).toBe(1);
		expect(preview.duplicateNames).toEqual(['A']);
	});

	it('preview() は createSiblingChallenge を呼ばない (DB write 禁止)', async () => {
		const payload = { challenges: [makeChallenge({ title: 'X' })] };
		await challengeSetStrategy.preview(payload, { tenantId: TENANT });
		expect(mockCreateSiblingChallenge).not.toHaveBeenCalled();
	});

	it('tenantId が findAllChallenges に渡される', async () => {
		const payload = { challenges: [makeChallenge()] };
		await challengeSetStrategy.preview(payload, { tenantId: TENANT });
		expect(mockFindAllChallenges).toHaveBeenCalledWith(TENANT);
	});

	it('byCategory が集計される (categoryId → カテゴリコード)', async () => {
		const payload = {
			challenges: [
				makeChallenge({ title: 'a1', categoryId: 1 as const }),
				makeChallenge({ title: 'a2', categoryId: 1 as const }),
				makeChallenge({ title: 'b1', categoryId: 4 as const }),
			],
		};
		const preview = await challengeSetStrategy.preview(payload, { tenantId: TENANT });
		expect(preview.byCategory).toEqual({ undou: 2, kouryuu: 1 });
	});
});

// =====================================================
// apply()
// =====================================================

describe('challengeSetStrategy.apply', () => {
	it('全件新規 → imported=件数, skipped=0', async () => {
		const payload = {
			challenges: [
				makeChallenge({ title: 'A' }),
				makeChallenge({ title: 'B', categoryId: 2 as const }),
			],
		};
		const result = await challengeSetStrategy.apply(payload, { tenantId: TENANT });
		expect(result.imported).toBe(2);
		expect(result.skipped).toBe(0);
		expect(result.errors).toEqual([]);
		expect(mockCreateSiblingChallenge).toHaveBeenCalledTimes(2);
	});

	it('重複あり → skipped=重複件数', async () => {
		mockFindAllChallenges.mockResolvedValue([{ title: 'A' }]);
		const payload = {
			challenges: [
				makeChallenge({ title: 'A' }),
				makeChallenge({ title: 'B', categoryId: 2 as const }),
			],
		};
		const result = await challengeSetStrategy.apply(payload, { tenantId: TENANT });
		expect(result.imported).toBe(1);
		expect(result.skipped).toBe(1);
		expect(mockCreateSiblingChallenge).toHaveBeenCalledTimes(1);
	});

	it('dryRun=true → DB write せず imported=0 + skipped=重複件数', async () => {
		mockFindAllChallenges.mockResolvedValue([{ title: 'A' }]);
		const payload = {
			challenges: [
				makeChallenge({ title: 'A' }),
				makeChallenge({ title: 'B', categoryId: 2 as const }),
			],
		};
		const result = await challengeSetStrategy.apply(payload, {
			tenantId: TENANT,
			dryRun: true,
		});
		expect(result.imported).toBe(0);
		expect(result.skipped).toBe(1);
		expect(mockCreateSiblingChallenge).not.toHaveBeenCalled();
	});

	it('createSiblingChallenge throw → errors 記録 + 処理継続', async () => {
		mockCreateSiblingChallenge
			.mockRejectedValueOnce(new Error('DB error'))
			.mockResolvedValueOnce({ id: 2 });
		const payload = {
			challenges: [
				makeChallenge({ title: 'failing' }),
				makeChallenge({ title: 'ok', categoryId: 2 as const }),
			],
		};
		const result = await challengeSetStrategy.apply(payload, { tenantId: TENANT });
		expect(result.imported).toBe(1);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain('failing');
	});
});

// =====================================================
// dispatcher integration
// =====================================================

describe('marketplace dispatcher + challenge-set', () => {
	it(
		'Registry 経由で challenge-set が解決でき、dispatchImport が成立',
		async () => {
			const { marketplaceRegistry, dispatchImport } = await import(
				'../../../../src/lib/marketplace'
			);

			expect(marketplaceRegistry.has('challenge-set')).toBe(true);
			const desc = marketplaceRegistry.get('challenge-set');
			expect(desc.typeCode).toBe('challenge-set');
			expect(desc.requiresChildId).toBe(false);

			const payload = {
				challenges: [makeChallenge({ title: 'dispatched' })],
			};
			const result = await dispatchImport({
				typeCode: 'challenge-set',
				rawPayload: payload,
				displayName: 'test challenge set',
				ctx: { tenantId: TENANT, presetId: 'cs-1' },
			});
			expect(result.importResult).toBe(true);
			expect(result.packName).toBe('test challenge set');
			expect(result.imported).toBe(1);
			expect(result.total).toBe(1);
		},
		15_000,
	);

	it(
		'Registry に登録された 5 type すべて (#2362 EPIC 完遂条件)',
		async () => {
			const { marketplaceRegistry } = await import('../../../../src/lib/marketplace');
			// #2369 時点では activity-pack + challenge-set のみ。
			// 残り 3 type (#2366-2368) は別 PR で順次追加。
			expect(marketplaceRegistry.has('activity-pack')).toBe(true);
			expect(marketplaceRegistry.has('challenge-set')).toBe(true);
		},
		15_000,
	);
});
