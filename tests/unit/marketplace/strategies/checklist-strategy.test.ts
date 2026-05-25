/**
 * tests/unit/marketplace/strategies/checklist-strategy.test.ts
 *
 * checklist ImportStrategy unit tests — Issue #2367 / ADR-0052 / #2481 PR-5 Phase 2 (ADR-0055)
 *
 * 検証:
 *   - parse() の Valibot 経由 validation (成功 / 失敗)
 *   - preview() が atomic unit 重複検知 (`duplicates === total`) を行う
 *   - preview() が DB write しない
 *   - apply() が importChecklistTemplateForFamily を呼んで結果を返す (Phase 2 で legacy-single-binding 撤去)
 *   - apply() の dryRun=true は preview と等価動作
 *   - ctx.presetId 必須 (型エラーではなく runtime error)
 *   - ctx.childIds 0 件でも family template 作成可能 (Phase 2 新仕様)
 *   - tenant 必須 (ctx.tenantId が下流に伝播)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- Top-level mocks (Phase 2 で `importChecklistTemplate` は撤去、family API のみ) ----------

const mockPreviewChecklistImport = vi.fn();
const mockImportChecklistTemplateForFamily = vi.fn();

vi.mock('$lib/server/services/checklist-template-import-service', () => ({
	previewChecklistImport: (...args: unknown[]) => mockPreviewChecklistImport(...args),
	importChecklistTemplateForFamily: (...args: unknown[]) =>
		mockImportChecklistTemplateForFamily(...args),
}));

// activity-pack の Strategy も同時 eager-load されるため activity-repo を mock しておく
vi.mock('$lib/server/db/activity-repo', () => ({
	findActivities: vi.fn().mockResolvedValue([]),
	insertActivity: vi.fn().mockResolvedValue({ id: 1 }),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------- Import after mocks ----------

import { checklistStrategy } from '../../../../src/lib/marketplace/strategies/checklist-strategy';

const TENANT = 'test-tenant-001';
const CHILD_ID = 12345;
const PRESET_ID = 'event-pool';

function makeItem(overrides: Record<string, unknown> = {}) {
	return {
		label: 'タオル',
		icon: '🏊',
		order: 0,
		...overrides,
	};
}

function makeChecklistPayload(overrides: Record<string, unknown> = {}) {
	return {
		timing: 'daily' as const,
		items: [
			makeItem({ label: 'タオル', order: 0 }),
			makeItem({ label: '水着', order: 1, icon: '👙' }),
		],
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockPreviewChecklistImport.mockResolvedValue({
		presetId: PRESET_ID,
		presetName: 'プールの もちもの',
		presetIcon: '🏊',
		itemCount: 2,
		alreadyImported: false,
	});
	mockImportChecklistTemplateForFamily.mockResolvedValue({
		imported: 1,
		skipped: 0,
		importedItems: 2,
		errors: [],
		templateId: 1,
	});
});

// =====================================================
// parse()
// =====================================================

describe('checklistStrategy.parse', () => {
	it('有効な payload を parse して同等 object を返す', () => {
		const input = makeChecklistPayload();
		const result = checklistStrategy.parse(input);
		expect(result.items).toHaveLength(2);
		expect(result.timing).toBe('daily');
		expect(result.items[0]?.label).toBe('タオル');
	});

	it('items が空配列なら error throw', () => {
		expect(() => checklistStrategy.parse({ timing: 'daily', items: [] })).toThrow(/items/);
	});

	it('timing が CHECKLIST_TIMINGS 外なら error throw', () => {
		const input = { timing: 'invalid', items: [makeItem()] };
		expect(() => checklistStrategy.parse(input)).toThrow();
	});

	it('label が空文字なら error throw', () => {
		const input = makeChecklistPayload({ items: [makeItem({ label: '' })] });
		expect(() => checklistStrategy.parse(input)).toThrow();
	});

	it('order が負数なら error throw', () => {
		const input = makeChecklistPayload({ items: [makeItem({ order: -1 })] });
		expect(() => checklistStrategy.parse(input)).toThrow();
	});

	it('icon が空文字なら error throw', () => {
		const input = makeChecklistPayload({ items: [makeItem({ icon: '' })] });
		expect(() => checklistStrategy.parse(input)).toThrow();
	});

	it('morning / evening / weekly / weekend / daily 全てを accept', () => {
		for (const timing of ['morning', 'evening', 'weekly', 'weekend', 'daily'] as const) {
			const input = makeChecklistPayload({ timing });
			expect(() => checklistStrategy.parse(input)).not.toThrow();
		}
	});
});

// =====================================================
// preview()
// =====================================================

describe('checklistStrategy.preview', () => {
	it('未取込 -> 全件 newItems としてカウント', async () => {
		mockPreviewChecklistImport.mockResolvedValue({
			presetId: PRESET_ID,
			presetName: 'プールの もちもの',
			presetIcon: '🏊',
			itemCount: 2,
			alreadyImported: false,
		});
		const payload = makeChecklistPayload();
		const preview = await checklistStrategy.preview(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});
		expect(preview.total).toBe(2);
		expect(preview.newItems).toBe(2);
		expect(preview.duplicates).toBe(0);
		expect(preview.duplicateNames).toEqual([]);
	});

	it('atomic 重複: 既取込なら全件 duplicates として返却 (per-item 重複検知ではない)', async () => {
		mockPreviewChecklistImport.mockResolvedValue({
			presetId: PRESET_ID,
			presetName: 'プールの もちもの',
			presetIcon: '🏊',
			itemCount: 2,
			alreadyImported: true,
			existingTemplateName: 'プールの もちもの (既存)',
		});
		const payload = makeChecklistPayload();
		const preview = await checklistStrategy.preview(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});
		expect(preview.total).toBe(2);
		expect(preview.newItems).toBe(0);
		expect(preview.duplicates).toBe(2);
		expect(preview.duplicateNames).toEqual(['プールの もちもの (既存)']);
	});

	it('atomic 重複時に existingTemplateName が無い場合は presetName を fallback', async () => {
		mockPreviewChecklistImport.mockResolvedValue({
			presetId: PRESET_ID,
			presetName: 'プールの もちもの',
			presetIcon: '🏊',
			itemCount: 2,
			alreadyImported: true,
		});
		const payload = makeChecklistPayload();
		const preview = await checklistStrategy.preview(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});
		expect(preview.duplicateNames).toEqual(['プールの もちもの']);
	});

	it('preview() は importChecklistTemplateForFamily を呼ばない (DB write 禁止)', async () => {
		const payload = makeChecklistPayload();
		await checklistStrategy.preview(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});
		expect(mockImportChecklistTemplateForFamily).not.toHaveBeenCalled();
	});

	it('ctx.presetId / tenantId が下流 previewChecklistImport に伝播 (Phase 2: childId 排除)', async () => {
		const payload = makeChecklistPayload();
		await checklistStrategy.preview(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});
		// Phase 2: family scope のため childId hint は 0 固定で legacy service へ渡される
		expect(mockPreviewChecklistImport).toHaveBeenCalledWith(PRESET_ID, 0, TENANT);
	});

	it('ctx.presetId 未指定なら error throw', async () => {
		const payload = makeChecklistPayload();
		await expect(
			checklistStrategy.preview(payload, { tenantId: TENANT, childId: CHILD_ID }),
		).rejects.toThrow(/presetId/);
	});

	it('#2362 PR-5 Phase 2: preview は ctx.childId / childIds なしでも OK (family scope 重複判定のみ)', async () => {
		// family master 化後は preview = tenant scope 判定のため、childId hint は任意。
		const payload = makeChecklistPayload();
		await expect(
			checklistStrategy.preview(payload, { tenantId: TENANT, presetId: PRESET_ID }),
		).resolves.toBeDefined();
		// hintChildId=0 で legacy service が呼ばれる
		expect(mockPreviewChecklistImport).toHaveBeenCalledWith(PRESET_ID, 0, TENANT);
	});

	it('下流 service が preset 未発見で null 返却 -> error throw', async () => {
		mockPreviewChecklistImport.mockResolvedValue(null);
		const payload = makeChecklistPayload();
		await expect(
			checklistStrategy.preview(payload, {
				tenantId: TENANT,
				presetId: 'unknown',
				childId: CHILD_ID,
			}),
		).rejects.toThrow(/見つかりません/);
	});
});

// =====================================================
// apply()
// =====================================================

describe('checklistStrategy.apply', () => {
	// #2362 PR-5 Phase 2 (ADR-0055): legacy-single-binding ctx 撤去後の apply 仕様
	// - ctx.childIds 指定時: 配信先 children を assignments で記録
	// - ctx.childIds 未指定 / 空配列時: family template のみ作成 (assignment 0 件、配信は admin UX で)
	// - 旧 ctx.childId は受付撤去 (UI から URL/body 経路で渡されない、CWE-598)

	it('childIds 指定: family-master-with-distribution で apply', async () => {
		const payload = makeChecklistPayload();
		const result = await checklistStrategy.apply(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childIds: [10, 11],
		});
		expect(result.imported).toBe(1);
		expect(result.skipped).toBe(0);
		expect(result.errors).toEqual([]);
		expect(mockImportChecklistTemplateForFamily).toHaveBeenCalledWith(PRESET_ID, TENANT, {
			childIds: [10, 11],
		});
	});

	it('childIds 空配列: family template のみ作成 (assignment 0 件、配信は admin UX で)', async () => {
		const payload = makeChecklistPayload();
		const result = await checklistStrategy.apply(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childIds: [],
		});
		expect(result.imported).toBe(1);
		expect(mockImportChecklistTemplateForFamily).toHaveBeenCalledWith(PRESET_ID, TENANT, {
			childIds: [],
		});
	});

	it('childIds 未指定: family template のみ作成 (assignment 0 件)', async () => {
		const payload = makeChecklistPayload();
		const result = await checklistStrategy.apply(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
		});
		expect(result.imported).toBe(1);
		expect(mockImportChecklistTemplateForFamily).toHaveBeenCalledWith(PRESET_ID, TENANT, {
			childIds: [],
		});
	});

	it('atomic 重複: imported=0, skipped=1', async () => {
		mockImportChecklistTemplateForFamily.mockResolvedValue({
			imported: 0,
			skipped: 1,
			importedItems: 0,
			errors: [],
		});
		const payload = makeChecklistPayload();
		const result = await checklistStrategy.apply(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childIds: [CHILD_ID],
		});
		expect(result.imported).toBe(0);
		expect(result.skipped).toBe(1);
	});

	it('dryRun=true -> DB write せず preview と等価結果', async () => {
		mockPreviewChecklistImport.mockResolvedValue({
			presetId: PRESET_ID,
			presetName: 'プールの もちもの',
			presetIcon: '🏊',
			itemCount: 2,
			alreadyImported: true,
		});
		const payload = makeChecklistPayload();
		const result = await checklistStrategy.apply(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childIds: [CHILD_ID],
			dryRun: true,
		});
		expect(result.imported).toBe(0);
		expect(result.skipped).toBe(2);
		expect(mockImportChecklistTemplateForFamily).not.toHaveBeenCalled();
	});

	it('ctx.presetId 未指定なら error throw', async () => {
		const payload = makeChecklistPayload();
		await expect(
			checklistStrategy.apply(payload, { tenantId: TENANT, childIds: [CHILD_ID] }),
		).rejects.toThrow(/presetId/);
	});

	it('下流 service の errors を pass-through', async () => {
		mockImportChecklistTemplateForFamily.mockResolvedValue({
			imported: 1,
			skipped: 0,
			importedItems: 1,
			errors: ['「タオル」: DB error'],
		});
		const payload = makeChecklistPayload();
		const result = await checklistStrategy.apply(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childIds: [CHILD_ID],
		});
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain('タオル');
	});
});

// =====================================================
// dispatcher integration
// =====================================================

describe('marketplace dispatcher + checklist', () => {
	// #2362 PR-4 (2026-05-25): reward-set-strategy.test.ts に dispatcher integration が
	// 追加され、`$lib/marketplace` の eager-load 経路が増えたことで本テストの
	// import が並列実行時に default 5000ms を超えるようになった (ADR-0006 §3.1
	// 「PR 改変による負荷増」整合)。timeout を 15000ms に引き上げる。
	it('Registry 経由で checklist が解決でき、dispatchImport が成立', {
		timeout: 15000,
	}, async () => {
		// eager-load が走るよう $lib/marketplace import
		const { marketplaceRegistry, dispatchImport } = await import('../../../../src/lib/marketplace');

		expect(marketplaceRegistry.has('checklist')).toBe(true);
		const desc = marketplaceRegistry.get('checklist');
		expect(desc.typeCode).toBe('checklist');
		// #2362 PR-5 Phase 2: checklist は family scope のため childId は構造上 required ではないが、
		// Descriptor の requiresChildId 値は当面互換維持 (Registry レベルの contract、admin UI で childIds 指定)
		expect(desc.requiresChildId).toBe(true);

		// dispatchImport が動作すること (Phase 2: childIds 経由)
		const payload = makeChecklistPayload();
		const result = await dispatchImport({
			typeCode: 'checklist',
			rawPayload: payload,
			displayName: 'プールの もちもの',
			ctx: { tenantId: TENANT, presetId: PRESET_ID, childIds: [CHILD_ID] },
		});
		expect(result.importResult).toBe(true);
		expect(result.packName).toBe('プールの もちもの');
		expect(result.imported).toBe(1);
		expect(result.total).toBe(2);
	});
});
