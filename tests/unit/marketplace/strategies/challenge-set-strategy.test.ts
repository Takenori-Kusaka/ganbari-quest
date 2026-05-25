/**
 * tests/unit/marketplace/strategies/challenge-set-strategy.test.ts
 *
 * challenge-set ImportStrategy unit tests — Issue #2369 / EPIC #2362 P3 / ADR-0052
 * #2458-B (caller migration): per-child instance path 必須化 (childIds 必須) に追従。
 *
 * 検証:
 *   - parse() の Valibot 経由 validation (成功 / 失敗 / monthDay regex / categoryId picklist)
 *   - preview() が DB write せずに件数集計を返す (重複は title ベース、child_challenges から検索)
 *   - apply() が createChildChallengesBulk を呼んで結果を返す (childIds 必須)
 *   - apply() の dryRun=true は preview と等価動作
 *   - Registry 経由の dispatcher integration
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- Top-level mocks ----------

// #2458-B: 旧 sibling-challenge-repo / sibling-challenge-service mock を撤去し、
// child-challenge factory / service の mock に flip。

const mockFindAllByTenant = vi.fn();
const mockCreateChildChallengesBulk = vi.fn();
const mockBuildPerChildTargets = vi.fn();
const mockFindAllChildren = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		childChallenge: {
			findAllByTenant: (...args: unknown[]) => mockFindAllByTenant(...args),
		},
	}),
}));

vi.mock('$lib/server/db/child-repo', () => ({
	findAllChildren: (...args: unknown[]) => mockFindAllChildren(...args),
}));

vi.mock('$lib/server/services/child-challenge-service', async () => {
	// buildPerChildTargets は実装中で呼ばれるため mock + spy
	return {
		createChildChallengesBulk: (...args: unknown[]) => mockCreateChildChallengesBulk(...args),
		buildPerChildTargets: (...args: unknown[]) => mockBuildPerChildTargets(...args),
	};
});

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------- Import after mocks ----------

import { challengeSetStrategy } from '../../../../src/lib/marketplace/strategies/challenge-set-strategy';

const TENANT = 'test-tenant-002';
const CHILD_IDS = [101, 102] as const;

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
	mockFindAllByTenant.mockResolvedValue([]);
	// createChildChallengesBulk: childIds 数だけ作成して配列を返す
	mockCreateChildChallengesBulk.mockImplementation((_spec, childIds: readonly number[]) =>
		Promise.resolve(childIds.map((id, i) => ({ id: i + 1, childId: id }))),
	);
	mockBuildPerChildTargets.mockImplementation(
		(baseTarget: number, _adj, childIds: readonly number[]) =>
			Promise.resolve(Object.fromEntries(childIds.map((id) => [id, baseTarget]))),
	);
	mockFindAllChildren.mockResolvedValue([
		{ id: 101, age: 5 },
		{ id: 102, age: 8 },
	]);
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
		mockFindAllByTenant.mockResolvedValue([]);
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
		mockFindAllByTenant.mockResolvedValue([{ title: 'A' }]);
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

	it('preview() は createChildChallengesBulk を呼ばない (DB write 禁止)', async () => {
		const payload = { challenges: [makeChallenge({ title: 'X' })] };
		await challengeSetStrategy.preview(payload, { tenantId: TENANT });
		expect(mockCreateChildChallengesBulk).not.toHaveBeenCalled();
	});

	it('tenantId が findAllByTenant に渡される', async () => {
		const payload = { challenges: [makeChallenge()] };
		await challengeSetStrategy.preview(payload, { tenantId: TENANT });
		expect(mockFindAllByTenant).toHaveBeenCalledWith(TENANT);
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
// apply()  (#2458-B: childIds 必須化に追従)
// =====================================================

describe('challengeSetStrategy.apply', () => {
	it('全件新規 → imported=件数×childIds数, skipped=0', async () => {
		const payload = {
			challenges: [
				makeChallenge({ title: 'A' }),
				makeChallenge({ title: 'B', categoryId: 2 as const }),
			],
		};
		const result = await challengeSetStrategy.apply(payload, {
			tenantId: TENANT,
			childIds: CHILD_IDS,
		});
		// per-child instance = 2 challenges × 2 children = 4 imported
		expect(result.imported).toBe(4);
		expect(result.skipped).toBe(0);
		expect(result.errors).toEqual([]);
		expect(mockCreateChildChallengesBulk).toHaveBeenCalledTimes(2);
	});

	it('childIds 必須 — 空配列なら errors を返す', async () => {
		const payload = { challenges: [makeChallenge({ title: 'A' })] };
		const result = await challengeSetStrategy.apply(payload, {
			tenantId: TENANT,
			childIds: [],
		});
		expect(result.imported).toBe(0);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain('childIds');
		expect(mockCreateChildChallengesBulk).not.toHaveBeenCalled();
	});

	it('dryRun=true → DB write せず imported=0 + skipped=重複件数', async () => {
		mockFindAllByTenant.mockResolvedValue([{ title: 'A' }]);
		const payload = {
			challenges: [
				makeChallenge({ title: 'A' }),
				makeChallenge({ title: 'B', categoryId: 2 as const }),
			],
		};
		const result = await challengeSetStrategy.apply(payload, {
			tenantId: TENANT,
			childIds: CHILD_IDS,
			dryRun: true,
		});
		expect(result.imported).toBe(0);
		expect(result.skipped).toBe(1);
		expect(mockCreateChildChallengesBulk).not.toHaveBeenCalled();
	});

	it('createChildChallengesBulk throw → errors 記録 + 処理継続', async () => {
		mockCreateChildChallengesBulk
			.mockRejectedValueOnce(new Error('DB error'))
			.mockResolvedValueOnce([
				{ id: 2, childId: 101 },
				{ id: 3, childId: 102 },
			]);
		const payload = {
			challenges: [
				makeChallenge({ title: 'failing' }),
				makeChallenge({ title: 'ok', categoryId: 2 as const }),
			],
		};
		const result = await challengeSetStrategy.apply(payload, {
			tenantId: TENANT,
			childIds: CHILD_IDS,
		});
		expect(result.imported).toBe(2);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain('failing');
	});
});

// =====================================================
// dispatcher integration
// =====================================================

describe('marketplace dispatcher + challenge-set', () => {
	it('Registry 経由で challenge-set が解決でき、dispatchImport が成立 (childIds 必須)', async () => {
		const { marketplaceRegistry, dispatchImport } = await import('../../../../src/lib/marketplace');

		expect(marketplaceRegistry.has('challenge-set')).toBe(true);
		const desc = marketplaceRegistry.get('challenge-set');
		expect(desc.typeCode).toBe('challenge-set');

		const payload = {
			challenges: [makeChallenge({ title: 'dispatched' })],
		};
		const result = await dispatchImport({
			typeCode: 'challenge-set',
			rawPayload: payload,
			displayName: 'test challenge set',
			ctx: { tenantId: TENANT, presetId: 'cs-1', childIds: CHILD_IDS },
		});
		expect(result.importResult).toBe(true);
		expect(result.packName).toBe('test challenge set');
		// 1 challenge × 2 children = 2 imported
		expect(result.imported).toBe(2);
		expect(result.total).toBe(1);
	}, 15_000);

	it('Registry に activity-pack と challenge-set が登録される (#2362 EPIC P3 部分完遂)', async () => {
		const { marketplaceRegistry } = await import('../../../../src/lib/marketplace');
		expect(marketplaceRegistry.has('activity-pack')).toBe(true);
		expect(marketplaceRegistry.has('challenge-set')).toBe(true);
	}, 15_000);
});
