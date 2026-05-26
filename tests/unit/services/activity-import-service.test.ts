// tests/unit/services/activity-import-service.test.ts
// activity-import-service unit tests
//
// #2458-A1 (2026-05-26): facade rewrite で family master `activities` table への
// parallel write を撤去。本テストは新挙動 (per-child instance bulk insert のみ) を検証する。
// childIds 未指定時は fallback で tenant 最初の child に bind されるため、`mockInsertActivitiesBulk`
// が常に呼ばれることを assert する。
// 旧 `mockInsertActivity` (facade) は assert 対象外 (内部実装としても呼ばれない)。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityPackItem } from '../../../src/lib/domain/activity-pack';

// ---------- Top-level mocks ----------

const mockFindActivities = vi.fn();
// #2362 PR-3: per-child instance 配信
const mockInsertActivitiesBulk = vi.fn();
// #2458-A1: childIds 未指定 fallback 用
const mockFindAllChildren = vi.fn();

vi.mock('$lib/server/db/activity-repo', () => ({
	findActivities: (...args: unknown[]) => mockFindActivities(...args),
}));

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		childActivity: {
			insertActivitiesBulk: (...args: unknown[]) => mockInsertActivitiesBulk(...args),
		},
	}),
}));

// #2458-A1: importActivities が childIds 未指定時に dynamic import する fallback
vi.mock('$lib/server/db/child-repo', () => ({
	findAllChildren: (...args: unknown[]) => mockFindAllChildren(...args),
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
const FIRST_CHILD_ID = 999; // fallback bind 用 (childIds 未指定時)

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
	mockInsertActivitiesBulk.mockResolvedValue([]);
	mockFindAllChildren.mockResolvedValue([{ id: FIRST_CHILD_ID, nickname: 'first' }]);
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
// importActivities (#2458-A1: child_activities 経由のみ)
// ==========================================================

describe('importActivities', () => {
	// ──────────────────────────────────────────────────────────
	// 基本動作 — childIds 未指定 (fallback)
	// ──────────────────────────────────────────────────────────

	it('全て新規 -> 全て per-child bulk に渡される (fallback child binding)', async () => {
		const items = [
			makeItem({ name: 'サッカー', categoryCode: 'undou' }),
			makeItem({ name: '読書', categoryCode: 'benkyou' }),
		];

		const result = await importActivities(items, TENANT);

		expect(result.imported).toBe(2);
		expect(result.skipped).toBe(0);
		expect(result.errors).toEqual([]);
		// #2458-A1: fallback で FIRST_CHILD_ID に bind される
		expect(mockInsertActivitiesBulk).toHaveBeenCalledTimes(1);
		const [bulkArgs] = mockInsertActivitiesBulk.mock.calls[0] ?? [];
		expect(bulkArgs).toHaveLength(2);
		expect(bulkArgs[0]).toMatchObject({ childId: FIRST_CHILD_ID, name: 'サッカー' });
		expect(bulkArgs[1]).toMatchObject({ childId: FIRST_CHILD_ID, name: '読書' });
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
		expect(mockInsertActivitiesBulk).toHaveBeenCalledTimes(1);
		const [bulkArgs] = mockInsertActivitiesBulk.mock.calls[0] ?? [];
		expect(bulkArgs).toHaveLength(1);
		expect(bulkArgs[0]).toMatchObject({ name: '読書' });
	});

	it('不明なカテゴリ -> エラー記録される', async () => {
		const items = [makeItem({ name: '謎の活動', categoryCode: 'unknown' as never })];

		const result = await importActivities(items, TENANT);

		expect(result.imported).toBe(0);
		expect(result.skipped).toBe(0);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain('謎の活動');
		expect(result.errors[0]).toContain('unknown');
		expect(mockInsertActivitiesBulk).not.toHaveBeenCalled();
	});

	it('per-child bulk が例外をスロー -> エラー記録され処理継続', async () => {
		mockInsertActivitiesBulk.mockRejectedValueOnce(new Error('DB constraint violation'));

		const items = [
			makeItem({ name: '失敗する活動', categoryCode: 'undou' }),
			makeItem({ name: '成功する活動', categoryCode: 'benkyou' }),
		];

		const result = await importActivities(items, TENANT);

		// imported は family master 段階での成功件数。bulk 失敗は別 channel (errors)
		expect(result.imported).toBe(2);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain('per-child instance 作成失敗');
		expect(result.errors[0]).toContain('DB constraint violation');
	});

	it('混合シナリオ: 新規 + 重複 + カテゴリエラー', async () => {
		mockFindActivities.mockResolvedValue([{ name: '既存活動' }]);

		const items = [
			makeItem({ name: '既存活動', categoryCode: 'undou' }),
			makeItem({ name: '新規OK', categoryCode: 'benkyou' }),
			makeItem({ name: 'カテゴリ不明', categoryCode: 'invalid' as never }),
		];

		const result = await importActivities(items, TENANT);

		expect(result.imported).toBe(1);
		expect(result.skipped).toBe(1);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain('カテゴリ不明');
	});

	it('同名が入力に2回 -> 2つ目は existingNames.add で重複扱い', async () => {
		const items = [
			makeItem({ name: '同名活動', categoryCode: 'undou' }),
			makeItem({ name: '同名活動', categoryCode: 'benkyou' }),
		];

		const result = await importActivities(items, TENANT);

		expect(result.imported).toBe(1);
		expect(result.skipped).toBe(1);
		expect(result.errors).toEqual([]);
	});

	it('per-child bulk に正しい引数が渡される', async () => {
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

		const [bulkArgs, tenantArg] = mockInsertActivitiesBulk.mock.calls[0] ?? [];
		expect(tenantArg).toBe(TENANT);
		expect(bulkArgs[0]).toMatchObject({
			childId: FIRST_CHILD_ID,
			name: 'テスト活動',
			categoryId: 3, // seikatsu is index 2 + 1 = 3
			icon: '🧹',
			basePoints: 3,
			triggerHint: 'おかたづけの後',
			sourcePresetId: null,
			priority: 'optional',
		});
		// #2458-A1: ChildActivity に存在しない field は drop されること
		expect(bulkArgs[0]).not.toHaveProperty('ageMin');
		expect(bulkArgs[0]).not.toHaveProperty('ageMax');
	});

	// ──────────────────────────────────────────────────────────
	// #1758 (#1709-D): mustDefault + applyMustDefault による priority 制御
	// ──────────────────────────────────────────────────────────

	describe('#1758 mustDefault / applyMustDefault による priority 設定', () => {
		it('applyMustDefault=true かつ mustDefault=true -> priority=must', async () => {
			const items = [
				makeItem({ name: 'はみがきした', categoryCode: 'seikatsu', mustDefault: true }),
			];

			await importActivities(items, TENANT, { applyMustDefault: true });

			const [bulkArgs] = mockInsertActivitiesBulk.mock.calls[0] ?? [];
			expect(bulkArgs[0]).toMatchObject({
				name: 'はみがきした',
				priority: 'must',
			});
		});

		it('applyMustDefault=true でも mustDefault=false の活動は priority=optional', async () => {
			const items = [
				makeItem({ name: 'はみがきした', categoryCode: 'seikatsu', mustDefault: true }),
				makeItem({ name: 'なわとびした', categoryCode: 'undou', mustDefault: false }),
			];

			await importActivities(items, TENANT, { applyMustDefault: true });

			const [bulkArgs] = mockInsertActivitiesBulk.mock.calls[0] ?? [];
			expect(bulkArgs[0]).toMatchObject({ name: 'はみがきした', priority: 'must' });
			expect(bulkArgs[1]).toMatchObject({ name: 'なわとびした', priority: 'optional' });
		});

		it('applyMustDefault=false なら mustDefault=true の活動でも priority=optional', async () => {
			const items = [
				makeItem({ name: 'はみがきした', categoryCode: 'seikatsu', mustDefault: true }),
				makeItem({ name: 'おきがえした', categoryCode: 'seikatsu', mustDefault: true }),
			];

			await importActivities(items, TENANT, { applyMustDefault: false });

			const [bulkArgs] = mockInsertActivitiesBulk.mock.calls[0] ?? [];
			expect(bulkArgs).toHaveLength(2);
			for (const arg of bulkArgs) {
				expect(arg.priority).toBe('optional');
			}
		});

		it('options 未指定（既定）-> applyMustDefault=false 扱い -> 全て optional', async () => {
			const items = [
				makeItem({ name: 'はみがきした', categoryCode: 'seikatsu', mustDefault: true }),
			];

			await importActivities(items, TENANT);

			const [bulkArgs] = mockInsertActivitiesBulk.mock.calls[0] ?? [];
			expect(bulkArgs[0]).toMatchObject({ priority: 'optional' });
		});

		it('後方互換: 第3引数に文字列を渡すと presetId として扱われる', async () => {
			const items = [makeItem({ name: 'テスト活動', categoryCode: 'undou', mustDefault: true })];

			await importActivities(items, TENANT, 'kinder-starter');

			const [bulkArgs] = mockInsertActivitiesBulk.mock.calls[0] ?? [];
			expect(bulkArgs[0]).toMatchObject({
				sourcePresetId: 'kinder-starter',
				priority: 'optional', // applyMustDefault 未指定なので false 扱い
			});
		});

		it('options.presetId と applyMustDefault が両方反映される', async () => {
			const items = [
				makeItem({ name: 'はみがきした', categoryCode: 'seikatsu', mustDefault: true }),
			];

			await importActivities(items, TENANT, {
				presetId: 'kinder-starter',
				applyMustDefault: true,
			});

			const [bulkArgs] = mockInsertActivitiesBulk.mock.calls[0] ?? [];
			expect(bulkArgs[0]).toMatchObject({
				sourcePresetId: 'kinder-starter',
				priority: 'must',
			});
		});
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

		const [bulkArgs] = mockInsertActivitiesBulk.mock.calls[0] ?? [];
		expect(bulkArgs[0]).toMatchObject({ triggerHint: null });
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

		const [bulkArgs] = mockInsertActivitiesBulk.mock.calls[0] ?? [];
		expect(bulkArgs).toHaveLength(5);
		for (const [i, [_, expectedId]] of Object.entries(codeToExpectedId).entries()) {
			expect(bulkArgs[i].categoryId).toBe(expectedId);
		}
	});

	it('空の入力 -> 何もインポートされない', async () => {
		const result = await importActivities([], TENANT);

		expect(result.imported).toBe(0);
		expect(result.skipped).toBe(0);
		expect(result.errors).toEqual([]);
		expect(mockInsertActivitiesBulk).not.toHaveBeenCalled();
	});

	// ──────────────────────────────────────────────────────────
	// #2458-A1 fallback: tenant に child が 0 件
	// ──────────────────────────────────────────────────────────

	it('tenant に child が 0 件 -> per-child bulk は呼ばれない (imported は別 channel)', async () => {
		mockFindAllChildren.mockResolvedValue([]);

		const items = [makeItem({ name: 'A', categoryCode: 'undou' })];

		const result = await importActivities(items, TENANT);

		expect(mockInsertActivitiesBulk).not.toHaveBeenCalled();
		// imported は per-child 配信前の進捗カウンタとして残る
		expect(result.imported).toBe(1);
	});

	// ──────────────────────────────────────────────────────────
	// #2362 PR-3 (ADR-0055): per-child instance 配信 — childIds 明示
	// ──────────────────────────────────────────────────────────

	describe('#2362 PR-3 per-child instance 配信 (options.childIds)', () => {
		it('childIds=[101] -> 1 child に対し bulk insert 1 回 / 件数は activities 数', async () => {
			const items = [
				makeItem({ name: 'A', categoryCode: 'undou' }),
				makeItem({ name: 'B', categoryCode: 'benkyou' }),
			];

			const result = await importActivities(items, TENANT, { childIds: [101] });

			expect(result.imported).toBe(2);
			expect(mockInsertActivitiesBulk).toHaveBeenCalledTimes(1);
			const [bulkArgs, tenantArg] = mockInsertActivitiesBulk.mock.calls[0] ?? [];
			expect(tenantArg).toBe(TENANT);
			expect(bulkArgs).toHaveLength(2);
			expect(bulkArgs[0]).toMatchObject({ childId: 101, name: 'A', categoryId: 1 });
			expect(bulkArgs[1]).toMatchObject({ childId: 101, name: 'B', categoryId: 2 });
			// fallback が使われていないことを確認 (childIds 明示時は findAllChildren 不呼出)
			expect(mockFindAllChildren).not.toHaveBeenCalled();
		});

		it('childIds=[101, 202, 303] -> 3 child それぞれに bulk insert', async () => {
			const items = [
				makeItem({ name: 'A', categoryCode: 'undou' }),
				makeItem({ name: 'B', categoryCode: 'benkyou' }),
			];

			await importActivities(items, TENANT, { childIds: [101, 202, 303] });

			expect(mockInsertActivitiesBulk).toHaveBeenCalledTimes(3);
			const calledChildIds = mockInsertActivitiesBulk.mock.calls
				.map((c) => (c[0] as { childId: number }[])[0]?.childId)
				.sort((a, b) => (a ?? 0) - (b ?? 0));
			expect(calledChildIds).toEqual([101, 202, 303]);
		});

		it('1 child の bulk insert が失敗しても他 child は継続する (partial success)', async () => {
			mockInsertActivitiesBulk
				.mockRejectedValueOnce(new Error('child=101 disk full'))
				.mockResolvedValueOnce([{ id: 99 }])
				.mockResolvedValueOnce([{ id: 100 }]);

			const items = [makeItem({ name: 'A', categoryCode: 'undou' })];

			const result = await importActivities(items, TENANT, { childIds: [101, 202, 303] });

			expect(result.imported).toBe(1);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]).toContain('child=101');
			expect(mockInsertActivitiesBulk).toHaveBeenCalledTimes(3);
		});

		it('duplicate でスキップされた activity は per-child 配信からも除外', async () => {
			mockFindActivities.mockResolvedValue([{ name: '既存' }]);

			const items = [
				makeItem({ name: '既存', categoryCode: 'undou' }),
				makeItem({ name: '新規', categoryCode: 'benkyou' }),
			];

			const result = await importActivities(items, TENANT, { childIds: [101] });

			expect(result.imported).toBe(1);
			expect(result.skipped).toBe(1);
			expect(mockInsertActivitiesBulk).toHaveBeenCalledTimes(1);
			const [bulkArgs] = mockInsertActivitiesBulk.mock.calls[0] ?? [];
			expect(bulkArgs).toHaveLength(1);
			expect(bulkArgs[0]).toMatchObject({ childId: 101, name: '新規' });
		});

		it('per-child input の priority / sourcePresetId は正しく伝播', async () => {
			const items = [makeItem({ name: 'はみがき', categoryCode: 'seikatsu', mustDefault: true })];

			await importActivities(items, TENANT, {
				childIds: [101],
				presetId: 'kinder-starter',
				applyMustDefault: true,
			});

			const [bulkArgs] = mockInsertActivitiesBulk.mock.calls[0] ?? [];
			expect(bulkArgs[0]).toMatchObject({
				childId: 101,
				name: 'はみがき',
				priority: 'must',
				sourcePresetId: 'kinder-starter',
			});
		});
	});
});
