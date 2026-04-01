// tests/unit/services/activity-import-service.test.ts
// activity-import-service unit tests

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityPackItem } from '../../../src/lib/domain/activity-pack';

// ---------- Top-level mocks ----------

const mockFindActivities = vi.fn();
const mockInsertActivity = vi.fn();

vi.mock('$lib/server/db/activity-repo', () => ({
	findActivities: (...args: unknown[]) => mockFindActivities(...args),
	insertActivity: (...args: unknown[]) => mockInsertActivity(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('$lib/domain/validation/activity', () => ({
	CATEGORY_CODES: ['undou', 'benkyou', 'seikatsu', 'kouryuu', 'souzou'],
}));

// ---------- Import after mocks ----------

import {
	importActivities,
	previewActivityImport,
} from '../../../src/lib/server/services/activity-import-service';

// ---------- Helpers ----------

const TENANT = 'test-tenant-001';

function makeItem(overrides: Partial<ActivityPackItem> = {}): ActivityPackItem {
	return {
		name: 'テスト活動',
		categoryCode: 'undou',
		icon: '🏃',
		basePoints: 5,
		ageMin: 3,
		ageMax: 12,
		gradeLevel: null,
		...overrides,
	};
}

// ---------- Reset ----------

beforeEach(() => {
	vi.clearAllMocks();
	mockFindActivities.mockResolvedValue([]);
	mockInsertActivity.mockResolvedValue({ id: 1 });
});

// ==========================================================
// previewActivityImport
// ==========================================================

describe('previewActivityImport', () => {
	it('既存活動なし -> 全て新規', async () => {
		const items = [
			makeItem({ name: 'サッカー', categoryCode: 'undou' }),
			makeItem({ name: '読書', categoryCode: 'benkyou' }),
			makeItem({ name: 'おかたづけ', categoryCode: 'seikatsu' }),
		];

		const result = await previewActivityImport(items, TENANT);

		expect(result.total).toBe(3);
		expect(result.newActivities).toBe(3);
		expect(result.duplicates).toBe(0);
		expect(result.duplicateNames).toEqual([]);
	});

	it('一部が重複 -> 正しいカウント', async () => {
		mockFindActivities.mockResolvedValue([{ name: 'サッカー' }, { name: 'おかたづけ' }]);

		const items = [
			makeItem({ name: 'サッカー', categoryCode: 'undou' }),
			makeItem({ name: '読書', categoryCode: 'benkyou' }),
			makeItem({ name: 'おかたづけ', categoryCode: 'seikatsu' }),
		];

		const result = await previewActivityImport(items, TENANT);

		expect(result.total).toBe(3);
		expect(result.newActivities).toBe(1);
		expect(result.duplicates).toBe(2);
		expect(result.duplicateNames).toEqual(['サッカー', 'おかたづけ']);
	});

	it('byCategory が正しく集計される', async () => {
		const items = [
			makeItem({ name: 'サッカー', categoryCode: 'undou' }),
			makeItem({ name: '水泳', categoryCode: 'undou' }),
			makeItem({ name: '読書', categoryCode: 'benkyou' }),
			makeItem({ name: 'お絵かき', categoryCode: 'souzou' }),
		];

		const result = await previewActivityImport(items, TENANT);

		expect(result.byCategory).toEqual({
			undou: 2,
			benkyou: 1,
			souzou: 1,
		});
	});

	it('空の入力 -> 全てゼロ', async () => {
		const result = await previewActivityImport([], TENANT);

		expect(result.total).toBe(0);
		expect(result.newActivities).toBe(0);
		expect(result.duplicates).toBe(0);
		expect(result.duplicateNames).toEqual([]);
		expect(result.byCategory).toEqual({});
	});

	it('全て重複 -> newActivities が 0', async () => {
		mockFindActivities.mockResolvedValue([{ name: 'サッカー' }, { name: '読書' }]);

		const items = [makeItem({ name: 'サッカー' }), makeItem({ name: '読書' })];

		const result = await previewActivityImport(items, TENANT);

		expect(result.total).toBe(2);
		expect(result.newActivities).toBe(0);
		expect(result.duplicates).toBe(2);
	});

	it('tenantId が findActivities に渡される', async () => {
		await previewActivityImport([], TENANT);

		expect(mockFindActivities).toHaveBeenCalledWith(TENANT);
	});
});

// ==========================================================
// importActivities
// ==========================================================

describe('importActivities', () => {
	it('全て新規 -> 全てインポートされる', async () => {
		const items = [
			makeItem({ name: 'サッカー', categoryCode: 'undou' }),
			makeItem({ name: '読書', categoryCode: 'benkyou' }),
		];

		const result = await importActivities(items, TENANT);

		expect(result.imported).toBe(2);
		expect(result.skipped).toBe(0);
		expect(result.errors).toEqual([]);
		expect(mockInsertActivity).toHaveBeenCalledTimes(2);
	});

	it('重複がスキップされる', async () => {
		mockFindActivities.mockResolvedValue([{ name: 'サッカー' }]);

		const items = [
			makeItem({ name: 'サッカー', categoryCode: 'undou' }),
			makeItem({ name: '読書', categoryCode: 'benkyou' }),
		];

		const result = await importActivities(items, TENANT);

		expect(result.imported).toBe(1);
		expect(result.skipped).toBe(1);
		expect(result.errors).toEqual([]);
		expect(mockInsertActivity).toHaveBeenCalledTimes(1);
	});

	it('不明なカテゴリ -> エラー記録される', async () => {
		const items = [makeItem({ name: '謎の活動', categoryCode: 'unknown' as never })];

		const result = await importActivities(items, TENANT);

		expect(result.imported).toBe(0);
		expect(result.skipped).toBe(0);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain('謎の活動');
		expect(result.errors[0]).toContain('unknown');
		expect(mockInsertActivity).not.toHaveBeenCalled();
	});

	it('insertActivity が例外をスロー -> エラー記録され処理継続', async () => {
		mockInsertActivity
			.mockRejectedValueOnce(new Error('DB constraint violation'))
			.mockResolvedValueOnce({ id: 2 });

		const items = [
			makeItem({ name: '失敗する活動', categoryCode: 'undou' }),
			makeItem({ name: '成功する活動', categoryCode: 'benkyou' }),
		];

		const result = await importActivities(items, TENANT);

		expect(result.imported).toBe(1);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain('失敗する活動');
		expect(result.errors[0]).toContain('DB constraint violation');
	});

	it('混合シナリオ: 新規 + 重複 + カテゴリエラー + DB例外', async () => {
		mockFindActivities.mockResolvedValue([{ name: '既存活動' }]);
		mockInsertActivity
			.mockResolvedValueOnce({ id: 1 })
			.mockRejectedValueOnce(new Error('disk full'));

		const items = [
			makeItem({ name: '既存活動', categoryCode: 'undou' }),
			makeItem({ name: '新規OK', categoryCode: 'benkyou' }),
			makeItem({ name: 'カテゴリ不明', categoryCode: 'invalid' as never }),
			makeItem({ name: 'DB失敗', categoryCode: 'seikatsu' }),
		];

		const result = await importActivities(items, TENANT);

		expect(result.imported).toBe(1);
		expect(result.skipped).toBe(1);
		expect(result.errors).toHaveLength(2);
		expect(result.errors[0]).toContain('カテゴリ不明');
		expect(result.errors[1]).toContain('DB失敗');
		expect(result.errors[1]).toContain('disk full');
	});

	it('同名が入力に2回 -> 2つ目は existingNames.add で重複扱い', async () => {
		const items = [
			makeItem({ name: '同名活動', categoryCode: 'undou' }),
			makeItem({ name: '同名活動', categoryCode: 'benkyou' }),
		];

		const result = await importActivities(items, TENANT);

		// 1つ目はインポート成功、2つ目は existingNames に追加済みなのでスキップ
		expect(result.imported).toBe(1);
		expect(result.skipped).toBe(1);
		expect(result.errors).toEqual([]);
		expect(mockInsertActivity).toHaveBeenCalledTimes(1);
	});

	it('insertActivity に正しい引数が渡される', async () => {
		const items = [
			makeItem({
				name: 'テスト活動',
				categoryCode: 'seikatsu',
				icon: '🧹',
				basePoints: 3,
				ageMin: 4,
				ageMax: 10,
				triggerHint: 'おかたづけの後',
			}),
		];

		await importActivities(items, TENANT);

		expect(mockInsertActivity).toHaveBeenCalledWith(
			{
				name: 'テスト活動',
				categoryId: 3, // seikatsu is index 2 + 1 = 3
				icon: '🧹',
				basePoints: 3,
				ageMin: 4,
				ageMax: 10,
				triggerHint: 'おかたづけの後',
			},
			TENANT,
		);
	});

	it('triggerHint が undefined の場合 null に変換される', async () => {
		const items = [
			makeItem({
				name: 'ヒントなし',
				categoryCode: 'undou',
				triggerHint: undefined,
			}),
		];

		await importActivities(items, TENANT);

		expect(mockInsertActivity).toHaveBeenCalledWith(
			expect.objectContaining({ triggerHint: null }),
			TENANT,
		);
	});

	it('全カテゴリコードが正しい categoryId にマッピングされる', async () => {
		const codeToExpectedId: Record<string, number> = {
			undou: 1,
			benkyou: 2,
			seikatsu: 3,
			kouryuu: 4,
			souzou: 5,
		};

		const items = Object.entries(codeToExpectedId).map(([code, _], i) =>
			makeItem({ name: `活動${i}`, categoryCode: code as never }),
		);

		await importActivities(items, TENANT);

		expect(mockInsertActivity).toHaveBeenCalledTimes(5);
		for (const [i, [_, expectedId]] of Object.entries(codeToExpectedId).entries()) {
			expect(mockInsertActivity.mock.calls[i]?.[0].categoryId).toBe(expectedId);
		}
	});

	it('空の入力 -> 何もインポートされない', async () => {
		const result = await importActivities([], TENANT);

		expect(result.imported).toBe(0);
		expect(result.skipped).toBe(0);
		expect(result.errors).toEqual([]);
		expect(mockInsertActivity).not.toHaveBeenCalled();
	});
});
