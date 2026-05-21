/**
 * tests/unit/marketplace/strategies/checklist-strategy.test.ts
 *
 * checklist ImportStrategy unit tests — Issue #2367 / ADR-0052
 *
 * 検証:
 *   - parse() の Valibot 経由 validation (成功 / 失敗)
 *   - preview() が atomic unit 重複検知 (`duplicates === total`) を行う
 *   - preview() が DB write しない
 *   - apply() が importChecklistTemplate を呼んで結果を返す
 *   - apply() の dryRun=true は preview と等価動作
 *   - ctx.presetId / ctx.childId 必須 (型エラーではなく runtime error)
 *   - tenant 必須 (ctx.tenantId が下流に伝播)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- Top-level mocks (旧 service 経由) ----------

const mockPreviewChecklistImport = vi.fn();
const mockImportChecklistTemplate = vi.fn();

vi.mock('$lib/server/services/checklist-template-import-service', () => ({
	previewChecklistImport: (...args: unknown[]) => mockPreviewChecklistImport(...args),
	importChecklistTemplate: (...args: unknown[]) => mockImportChecklistTemplate(...args),
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
	mockImportChecklistTemplate.mockResolvedValue({
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

	it('preview() は importChecklistTemplate を呼ばない (DB write 禁止)', async () => {
		const payload = makeChecklistPayload();
		await checklistStrategy.preview(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});
		expect(mockImportChecklistTemplate).not.toHaveBeenCalled();
	});

	it('ctx.presetId / childId / tenantId が下流 previewChecklistImport に伝播', async () => {
		const payload = makeChecklistPayload();
		await checklistStrategy.preview(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});
		expect(mockPreviewChecklistImport).toHaveBeenCalledWith(PRESET_ID, CHILD_ID, TENANT);
	});

	it('ctx.presetId 未指定なら error throw', async () => {
		const payload = makeChecklistPayload();
		await expect(
			checklistStrategy.preview(payload, { tenantId: TENANT, childId: CHILD_ID }),
		).rejects.toThrow(/presetId/);
	});

	it('ctx.childId 未指定なら error throw (requiresChildId=true)', async () => {
		const payload = makeChecklistPayload();
		await expect(
			checklistStrategy.preview(payload, { tenantId: TENANT, presetId: PRESET_ID }),
		).rejects.toThrow(/childId/);
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
	it('未取込 -> imported=1, skipped=0', async () => {
		const payload = makeChecklistPayload();
		const result = await checklistStrategy.apply(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});
		expect(result.imported).toBe(1);
		expect(result.skipped).toBe(0);
		expect(result.errors).toEqual([]);
		expect(mockImportChecklistTemplate).toHaveBeenCalledWith(PRESET_ID, CHILD_ID, TENANT);
	});

	it('atomic 重複: imported=0, skipped=1', async () => {
		mockImportChecklistTemplate.mockResolvedValue({
			imported: 0,
			skipped: 1,
			importedItems: 0,
			errors: [],
		});
		const payload = makeChecklistPayload();
		const result = await checklistStrategy.apply(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childId: CHILD_ID,
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
			childId: CHILD_ID,
			dryRun: true,
		});
		expect(result.imported).toBe(0);
		expect(result.skipped).toBe(2);
		expect(mockImportChecklistTemplate).not.toHaveBeenCalled();
	});

	it('ctx.presetId 未指定なら error throw', async () => {
		const payload = makeChecklistPayload();
		await expect(
			checklistStrategy.apply(payload, { tenantId: TENANT, childId: CHILD_ID }),
		).rejects.toThrow(/presetId/);
	});

	it('ctx.childId 未指定なら error throw', async () => {
		const payload = makeChecklistPayload();
		await expect(
			checklistStrategy.apply(payload, { tenantId: TENANT, presetId: PRESET_ID }),
		).rejects.toThrow(/childId/);
	});

	it('下流 service の errors を pass-through', async () => {
		mockImportChecklistTemplate.mockResolvedValue({
			imported: 1,
			skipped: 0,
			importedItems: 1,
			errors: ['「タオル」: DB error'],
		});
		const payload = makeChecklistPayload();
		const result = await checklistStrategy.apply(payload, {
			tenantId: TENANT,
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain('タオル');
	});
});

// =====================================================
// dispatcher integration
// =====================================================

describe('marketplace dispatcher + checklist', () => {
	it('Registry 経由で checklist が解決でき、dispatchImport が成立', async () => {
		// eager-load が走るよう $lib/marketplace import
		const { marketplaceRegistry, dispatchImport } = await import('../../../../src/lib/marketplace');

		expect(marketplaceRegistry.has('checklist')).toBe(true);
		const desc = marketplaceRegistry.get('checklist');
		expect(desc.typeCode).toBe('checklist');
		expect(desc.requiresChildId).toBe(true);

		// dispatchImport が動作すること
		const payload = makeChecklistPayload();
		const result = await dispatchImport({
			typeCode: 'checklist',
			rawPayload: payload,
			displayName: 'プールの もちもの',
			ctx: { tenantId: TENANT, presetId: PRESET_ID, childId: CHILD_ID },
		});
		expect(result.importResult).toBe(true);
		expect(result.packName).toBe('プールの もちもの');
		expect(result.imported).toBe(1);
		expect(result.total).toBe(2);
	});
});
