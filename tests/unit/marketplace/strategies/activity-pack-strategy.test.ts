/**
 * tests/unit/marketplace/strategies/activity-pack-strategy.test.ts
 *
 * activity-pack ImportStrategy unit tests — Issue #2365 / ADR-0052
 *
 * 検証:
 *   - parse() の Valibot 経由 validation (成功 / 失敗)
 *   - preview() が DB write せずに件数集計を返す
 *   - apply() が importActivities を呼んで結果を返す
 *   - apply() の dryRun=true は preview と等価動作
 *   - tenant 必須 (ctx.tenantId が下流に伝播)
 *   - presetId / applyMustDefault が下流に伝播 (#1758 / #1709-D)
 *
 * #2458-A1 (2026-05-26): activity-import-service の facade rewrite に伴い、
 *   write は `repos.childActivity.insertActivitiesBulk` 経由に移行。
 *   旧 `insertActivity` mock は呼ばれなくなったため、本 spec も bulk path mock に同期。
 *   childIds 未指定時は `findAllChildren` で tenant 最初の child に fallback bind。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- Top-level mocks (#2458-A1: facade rewrite で bulk path に同期) ----------

const mockFindActivities = vi.fn();
const mockFindAllChildren = vi.fn();
const mockInsertActivitiesBulk = vi.fn();
// #2558: per-child dedup 用 (importActivities が buildExistingNamesByChild 経由で呼ぶ)
const mockFindActivitiesByChild = vi.fn();

vi.mock('$lib/server/db/activity-repo', () => ({
	findActivities: (...args: unknown[]) => mockFindActivities(...args),
}));

vi.mock('$lib/server/db/child-repo', () => ({
	findAllChildren: (...args: unknown[]) => mockFindAllChildren(...args),
}));

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		childActivity: {
			insertActivitiesBulk: (...args: unknown[]) => mockInsertActivitiesBulk(...args),
			// #2558: per-child dedup — buildExistingNamesByChild が cid ごとに呼ぶ。
			// dedup 効果を検証するテストは個別 mockResolvedValue で上書きする。
			findActivitiesByChild: (...args: unknown[]) => mockFindActivitiesByChild(...args),
		},
	}),
}));

// checklist Strategy も $lib/marketplace eager-load 経由で同時 register されるため
// 旧 service の DB 経路を mock しておく (#2367 の eager-load 副作用対応)
vi.mock('$lib/server/services/checklist-template-import-service', () => ({
	previewChecklistImport: vi.fn().mockResolvedValue(null),
	importChecklistTemplate: vi.fn().mockResolvedValue({
		imported: 0,
		skipped: 0,
		importedItems: 0,
		errors: [],
	}),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------- Import after mocks ----------

import { activityPackStrategy } from '../../../../src/lib/marketplace/strategies/activity-pack-strategy';

const TENANT = 'test-tenant-001';

function makeActivity(overrides: Record<string, unknown> = {}) {
	return {
		name: 'サッカー',
		categoryCode: 'undou' as const,
		icon: '⚽',
		basePoints: 5,
		ageMin: 3,
		ageMax: 12,
		gradeLevel: null,
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockFindActivities.mockResolvedValue([]);
	// #2458-A1: fallback bind helper — tenant 最初の child を返す。
	// childIds 未指定 ctx の test ではこの child に per-child instance が bulk insert される。
	mockFindAllChildren.mockResolvedValue([{ id: 100 }]);
	// #2824 (取込永続 honesty): insertActivitiesBulk は本実装と同様に「作成した row (name 込み)」
	//   を返す。importActivities は imported を実 persist 結果から算出するため、mock も入力を
	//   echo する (旧 `mockResolvedValue(undefined)` は persist 0 件相当で imported を偽る経路を隠す)。
	mockInsertActivitiesBulk.mockImplementation(async (inputs: Array<{ name: string }>) =>
		inputs.map((i, idx) => ({ id: idx + 1, ...i })),
	);
	// #2558: per-child dedup mock — 既存活動なしを default に。
	mockFindActivitiesByChild.mockResolvedValue([]);
});

// =====================================================
// parse()
// =====================================================

describe('activityPackStrategy.parse', () => {
	it('有効な payload を parse して同等 object を返す', () => {
		const input = { activities: [makeActivity()] };
		const result = activityPackStrategy.parse(input);
		expect(result.activities).toHaveLength(1);
		expect(result.activities[0]?.name).toBe('サッカー');
	});

	it('activities が空配列なら error throw', () => {
		expect(() => activityPackStrategy.parse({ activities: [] })).toThrow(/activities/);
	});

	it('activities key が無い payload は error throw', () => {
		expect(() => activityPackStrategy.parse({})).toThrow();
	});

	it('categoryCode が CATEGORY_CODES 外なら error throw', () => {
		const input = { activities: [makeActivity({ categoryCode: 'invalid' })] };
		expect(() => activityPackStrategy.parse(input)).toThrow(/categoryCode/);
	});

	it('basePoints が 0 以下なら error throw', () => {
		const input = { activities: [makeActivity({ basePoints: 0 })] };
		expect(() => activityPackStrategy.parse(input)).toThrow();
	});

	it('name が空文字なら error throw', () => {
		const input = { activities: [makeActivity({ name: '' })] };
		expect(() => activityPackStrategy.parse(input)).toThrow();
	});
});

// =====================================================
// preview()
// =====================================================

describe('activityPackStrategy.preview', () => {
	it('既存活動なし -> 全て新規としてカウント', async () => {
		mockFindActivities.mockResolvedValue([]);
		const payload = {
			activities: [
				makeActivity({ name: 'A' }),
				makeActivity({ name: 'B', categoryCode: 'benkyou' as const }),
			],
		};
		const preview = await activityPackStrategy.preview(payload, { tenantId: TENANT });
		expect(preview.total).toBe(2);
		expect(preview.newItems).toBe(2);
		expect(preview.duplicates).toBe(0);
		expect(preview.duplicateNames).toEqual([]);
	});

	it('一部重複 -> 正しくカウント', async () => {
		mockFindActivities.mockResolvedValue([{ name: 'A' }]);
		const payload = {
			activities: [
				makeActivity({ name: 'A' }),
				makeActivity({ name: 'B', categoryCode: 'benkyou' as const }),
			],
		};
		const preview = await activityPackStrategy.preview(payload, { tenantId: TENANT });
		expect(preview.total).toBe(2);
		expect(preview.newItems).toBe(1);
		expect(preview.duplicates).toBe(1);
		expect(preview.duplicateNames).toEqual(['A']);
	});

	it('preview() は insertActivitiesBulk を呼ばない (DB write 禁止)', async () => {
		// #2458-A1: facade rewrite で per-child bulk path 経由に変更されたが、
		// preview の不可侵性 (DB write 禁止) は同じ。
		const payload = { activities: [makeActivity({ name: 'X' })] };
		await activityPackStrategy.preview(payload, { tenantId: TENANT });
		expect(mockInsertActivitiesBulk).not.toHaveBeenCalled();
	});

	it('tenantId が findActivities に渡される', async () => {
		const payload = { activities: [makeActivity()] };
		await activityPackStrategy.preview(payload, { tenantId: TENANT });
		expect(mockFindActivities).toHaveBeenCalledWith(TENANT);
	});

	it('byCategory が集計される', async () => {
		const payload = {
			activities: [
				makeActivity({ name: 'a1', categoryCode: 'undou' as const }),
				makeActivity({ name: 'a2', categoryCode: 'undou' as const }),
				makeActivity({ name: 'b1', categoryCode: 'benkyou' as const }),
			],
		};
		const preview = await activityPackStrategy.preview(payload, { tenantId: TENANT });
		expect(preview.byCategory).toEqual({ undou: 2, benkyou: 1 });
	});
});

// =====================================================
// apply()
// =====================================================

describe('activityPackStrategy.apply', () => {
	it('全件新規 -> imported=件数, skipped=0', async () => {
		const payload = {
			activities: [
				makeActivity({ name: 'A' }),
				makeActivity({ name: 'B', categoryCode: 'benkyou' as const }),
			],
		};
		const result = await activityPackStrategy.apply(payload, { tenantId: TENANT });
		expect(result.imported).toBe(2);
		expect(result.skipped).toBe(0);
		expect(result.errors).toEqual([]);
		// #2458-A1: per-child bulk path 経由 — childIds 未指定時は fallback で
		// tenant 最初の child (mockFindAllChildren 戻り値の id=100) に bind され、
		// 1 child × 2 activities = 1 bulk call (inputs.length=2)。
		expect(mockInsertActivitiesBulk).toHaveBeenCalledTimes(1);
		const [inputs, tenant] = mockInsertActivitiesBulk.mock.calls[0] as [unknown[], string];
		expect(inputs).toHaveLength(2);
		expect(tenant).toBe(TENANT);
	});

	it('重複ありなら skipped=重複件数', async () => {
		// #2558: dedup は child 単位 (importActivities が findActivitiesByChild で読む)。
		// fallback bind 先 child=100 に 'A' を既存として持たせ、A は skip / B は import される。
		mockFindActivitiesByChild.mockResolvedValue([{ name: 'A' }]);
		const payload = {
			activities: [
				makeActivity({ name: 'A' }),
				makeActivity({ name: 'B', categoryCode: 'benkyou' as const }),
			],
		};
		const result = await activityPackStrategy.apply(payload, { tenantId: TENANT });
		expect(result.imported).toBe(1);
		expect(result.skipped).toBe(1);
		// #2458-A1: 1 new activity → 1 bulk call with 1 input
		expect(mockInsertActivitiesBulk).toHaveBeenCalledTimes(1);
		const [inputs] = mockInsertActivitiesBulk.mock.calls[0] as [unknown[]];
		expect(inputs).toHaveLength(1);
	});

	it('ctx.presetId が下流 (insertActivitiesBulk) に sourcePresetId として伝播 (#1254 G1)', async () => {
		const payload = { activities: [makeActivity({ name: 'X' })] };
		await activityPackStrategy.apply(payload, { tenantId: TENANT, presetId: 'pack-1' });
		// #2458-A1: per-child input array 経由で sourcePresetId が伝播
		expect(mockInsertActivitiesBulk).toHaveBeenCalledWith(
			expect.arrayContaining([expect.objectContaining({ sourcePresetId: 'pack-1' })]),
			TENANT,
		);
	});

	it('ctx.applyMustDefault=true + mustDefault=true -> priority=must (#1758)', async () => {
		const payload = {
			activities: [
				makeActivity({
					name: 'はみがき',
					categoryCode: 'seikatsu' as const,
					mustDefault: true,
				}),
			],
		};
		await activityPackStrategy.apply(payload, {
			tenantId: TENANT,
			applyMustDefault: true,
		});
		expect(mockInsertActivitiesBulk).toHaveBeenCalledWith(
			expect.arrayContaining([expect.objectContaining({ priority: 'must' })]),
			TENANT,
		);
	});

	it('ctx.applyMustDefault=false でも mustDefault=true は priority=optional', async () => {
		const payload = {
			activities: [
				makeActivity({
					name: 'はみがき',
					categoryCode: 'seikatsu' as const,
					mustDefault: true,
				}),
			],
		};
		await activityPackStrategy.apply(payload, {
			tenantId: TENANT,
			applyMustDefault: false,
		});
		expect(mockInsertActivitiesBulk).toHaveBeenCalledWith(
			expect.arrayContaining([expect.objectContaining({ priority: 'optional' })]),
			TENANT,
		);
	});

	it('dryRun=true -> DB write せず imported=0', async () => {
		mockFindActivities.mockResolvedValue([{ name: 'A' }]);
		const payload = {
			activities: [
				makeActivity({ name: 'A' }),
				makeActivity({ name: 'B', categoryCode: 'benkyou' as const }),
			],
		};
		const result = await activityPackStrategy.apply(payload, {
			tenantId: TENANT,
			dryRun: true,
		});
		expect(result.imported).toBe(0);
		expect(result.skipped).toBe(1);
		expect(mockInsertActivitiesBulk).not.toHaveBeenCalled();
	});

	it('insertActivitiesBulk が throw した場合 imported=0 + errors に記録 (#2824 honesty)', async () => {
		// #2824 取込永続 honesty: bulk write が全失敗したら 1 件も persist していない。
		//   旧 spec は imported=2 を期待していたが、これは「N 件登録しました」と偽る根因。
		//   fallback child 1 件 (id=100) への bulk が reject → persist 0 → imported=0 が honest。
		mockInsertActivitiesBulk.mockRejectedValueOnce(new Error('DB error'));
		const payload = {
			activities: [
				makeActivity({ name: 'failing' }),
				makeActivity({ name: 'ok', categoryCode: 'benkyou' as const }),
			],
		};
		const result = await activityPackStrategy.apply(payload, { tenantId: TENANT });
		expect(result.imported).toBe(0);
		// errors: ① per-child bulk 失敗 ② 「2 件を保存できませんでした」
		expect(result.errors.some((e) => e.includes('per-child instance 作成失敗'))).toBe(true);
		expect(result.errors.some((e) => e.includes('保存できませんでした'))).toBe(true);
	});
});

// =====================================================
// dispatcher integration
// =====================================================

describe('marketplace dispatcher + activity-pack', () => {
	it('Registry 経由で activity-pack が解決でき、dispatchImport が成立', async () => {
		// eager-load が走るよう $lib/marketplace import
		const { marketplaceRegistry, dispatchImport } = await import('../../../../src/lib/marketplace');

		// Registry に activity-pack が登録されていること
		expect(marketplaceRegistry.has('activity-pack')).toBe(true);
		const desc = marketplaceRegistry.get('activity-pack');
		expect(desc.typeCode).toBe('activity-pack');
		expect(desc.requiresChildId).toBe(false);

		// dispatchImport が動作すること
		const payload = {
			activities: [makeActivity({ name: 'dispatched' })],
		};
		const result = await dispatchImport({
			typeCode: 'activity-pack',
			rawPayload: payload,
			displayName: 'test pack',
			ctx: { tenantId: TENANT, presetId: 'p-1' },
		});
		expect(result.importResult).toBe(true);
		expect(result.packName).toBe('test pack');
		expect(result.imported).toBe(1);
		expect(result.total).toBe(1);
	});

	// Round 18 Cluster H (#13/#16/#20/#25/#28): subset 取込 — `+page.server.ts` の
	// `importPackToChildren` action が `selectedIndexes` を受け取った時に payload.activities を
	// slice してから dispatchImport へ渡す動線を、subset 後 payload で逆方向に検証する。
	// preschool 親「30 件は多すぎる、歯磨きとお片付けだけ欲しい」の subset 結果が正しく取り込まれることを担保。
	it('subset 取込 (#13/#16/#20/#25/#28): 30 件から 2 件 slice した payload は 2 件のみ insert される', async () => {
		const { dispatchImport } = await import('../../../../src/lib/marketplace');

		// 30 件 fixture (preschool starter pack 規模)
		const allActivities = Array.from({ length: 30 }, (_, i) =>
			makeActivity({ name: `activity-${i}`, categoryCode: 'seikatsu' as const }),
		);
		// 「歯磨きとお片付けだけ欲しい」を index 3, 7 でシミュレート
		const selectedIndexes = [3, 7];
		const subset = selectedIndexes.map((i) => allActivities[i]);
		const slicedPayload = { activities: subset };

		const result = await dispatchImport({
			typeCode: 'activity-pack',
			rawPayload: slicedPayload,
			displayName: 'kinder-starter (subset)',
			ctx: { tenantId: TENANT, presetId: 'kinder-starter' },
		});
		// subset = 2 件のみ insert / 残り 28 件は payload に含まれないため skip すらされない
		expect(result.imported).toBe(2);
		expect(result.total).toBe(2);
		// bulk write が 1 回 / 2 inputs (subset 件数) で呼ばれる (#2458-A1: per-child bulk path)
		expect(mockInsertActivitiesBulk).toHaveBeenCalledTimes(1);
		const [inputs] = mockInsertActivitiesBulk.mock.calls[0] as [unknown[]];
		expect(inputs).toHaveLength(2);
		// subset で選んだ activity の name が伝播していること (順序 = selectedIndexes 順)
		const names = (inputs as Array<{ name: string }>).map((a) => a.name);
		expect(names).toEqual(['activity-3', 'activity-7']);
	});
});
