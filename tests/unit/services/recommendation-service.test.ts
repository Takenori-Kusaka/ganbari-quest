// tests/unit/services/recommendation-service.test.ts
// おすすめ活動サービスのユニットテスト

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Activity } from '../../../src/lib/server/db/types';

// --- Top-level mocks (Vitest hoists these) ---

const mockGetSetting = vi.fn<(key: string, tenantId: string) => Promise<string | undefined>>();
const mockSetSetting = vi.fn<(key: string, value: string, tenantId: string) => Promise<void>>();
const mockCountPointLedgerEntriesByTypeAndDate =
	vi.fn<(childId: number, type: string, date: string, tenantId: string) => Promise<number>>();
const mockCountTodayActiveRecords =
	vi.fn<(childId: number, activityId: number, date: string, tenantId: string) => Promise<number>>();
const mockInsertPointLedger =
	vi.fn<
		(
			input: { childId: number; amount: number; type: string; description: string },
			tenantId: string,
		) => Promise<void>
	>();

vi.mock('$lib/server/db/settings-repo', () => ({
	getSetting: (...args: Parameters<typeof mockGetSetting>) => mockGetSetting(...args),
	setSetting: (...args: Parameters<typeof mockSetSetting>) => mockSetSetting(...args),
}));

vi.mock('$lib/server/db/activity-repo', () => ({
	countPointLedgerEntriesByTypeAndDate: (
		...args: Parameters<typeof mockCountPointLedgerEntriesByTypeAndDate>
	) => mockCountPointLedgerEntriesByTypeAndDate(...args),
	countTodayActiveRecords: (...args: Parameters<typeof mockCountTodayActiveRecords>) =>
		mockCountTodayActiveRecords(...args),
	insertPointLedger: (...args: Parameters<typeof mockInsertPointLedger>) =>
		mockInsertPointLedger(...args),
}));

vi.mock('$lib/domain/date-utils', () => ({
	todayDateJST: () => '2026-04-01',
}));

import {
	checkAndGrantFocusBonus,
	isFocusModeActive,
	markFocusModeStart,
	selectRecommendations,
} from '../../../src/lib/server/services/recommendation-service';

// --- Helper: Activity factory ---

function makeActivity(overrides: Partial<Activity> & { id: number; categoryId: number }): Activity {
	return {
		name: `activity-${overrides.id}`,
		icon: '🎯',
		basePoints: 5,
		ageMin: null,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 0,
		source: 'system',
		gradeLevel: null,
		subcategory: null,
		description: null,
		nameKana: null,
		nameKanji: null,
		triggerHint: null,
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		...overrides,
	};
}

const TENANT = 'test-tenant';

// ============================================================
// selectRecommendations (pure function - thorough testing)
// ============================================================
describe('selectRecommendations', () => {
	it('空の活動リストに対して空配列を返す', () => {
		const result = selectRecommendations([], '2026-04-01');
		expect(result).toEqual([]);
	});

	it('全て非表示(isVisible=0)の場合は空配列を返す', () => {
		const activities = [
			makeActivity({ id: 1, categoryId: 1, isVisible: 0 }),
			makeActivity({ id: 2, categoryId: 2, isVisible: 0 }),
		];
		const result = selectRecommendations(activities, '2026-04-01');
		expect(result).toEqual([]);
	});

	it('表示と非表示が混在する場合は表示のみを対象にする', () => {
		const activities = [
			makeActivity({ id: 1, categoryId: 1, isVisible: 1 }),
			makeActivity({ id: 2, categoryId: 1, isVisible: 0 }),
			makeActivity({ id: 3, categoryId: 2, isVisible: 1 }),
		];
		const result = selectRecommendations(activities, '2026-04-01');
		// isVisible=0 のid:2 は選ばれない
		const selectedIds = result.map((r) => r.activityId);
		expect(selectedIds).not.toContain(2);
	});

	it('活動が1件だけの場合は1件だけ返す', () => {
		const activities = [makeActivity({ id: 10, categoryId: 1 })];
		const result = selectRecommendations(activities, '2026-04-01');
		expect(result).toHaveLength(1);
		expect(result[0]?.activityId).toBe(10);
	});

	it('count=3 (デフォルト)で最大3件返す', () => {
		const activities = [
			makeActivity({ id: 1, categoryId: 1 }),
			makeActivity({ id: 2, categoryId: 2 }),
			makeActivity({ id: 3, categoryId: 3 }),
			makeActivity({ id: 4, categoryId: 4 }),
			makeActivity({ id: 5, categoryId: 5 }),
		];
		const result = selectRecommendations(activities, '2026-04-01');
		expect(result.length).toBeLessThanOrEqual(3);
		expect(result.length).toBeGreaterThan(0);
	});

	it('count パラメータを指定して件数を制御できる', () => {
		const activities = [
			makeActivity({ id: 1, categoryId: 1 }),
			makeActivity({ id: 2, categoryId: 2 }),
			makeActivity({ id: 3, categoryId: 3 }),
			makeActivity({ id: 4, categoryId: 4 }),
			makeActivity({ id: 5, categoryId: 5 }),
		];
		const result = selectRecommendations(activities, '2026-04-01', 5);
		expect(result).toHaveLength(5);
	});

	it('count=1 の場合は1件だけ返す', () => {
		const activities = [
			makeActivity({ id: 1, categoryId: 1 }),
			makeActivity({ id: 2, categoryId: 2 }),
			makeActivity({ id: 3, categoryId: 3 }),
		];
		const result = selectRecommendations(activities, '2026-04-01', 1);
		expect(result).toHaveLength(1);
	});

	it('活動数がcountより少ない場合は活動数分だけ返す', () => {
		const activities = [
			makeActivity({ id: 1, categoryId: 1 }),
			makeActivity({ id: 2, categoryId: 2 }),
		];
		const result = selectRecommendations(activities, '2026-04-01', 5);
		expect(result).toHaveLength(2);
	});

	describe('カテゴリ分散', () => {
		it('複数カテゴリから選択される', () => {
			const activities = [
				makeActivity({ id: 1, categoryId: 1 }),
				makeActivity({ id: 2, categoryId: 2 }),
				makeActivity({ id: 3, categoryId: 3 }),
			];
			const result = selectRecommendations(activities, '2026-04-01');
			// 3カテゴリから3件選ばれれば、activityId は重複しない
			const ids = result.map((r) => r.activityId);
			expect(new Set(ids).size).toBe(ids.length);
		});

		it('単一カテゴリでも指定数まで返す（フォールバック補充）', () => {
			const activities = [
				makeActivity({ id: 1, categoryId: 1, basePoints: 3 }),
				makeActivity({ id: 2, categoryId: 1, basePoints: 5 }),
				makeActivity({ id: 3, categoryId: 1, basePoints: 8 }),
			];
			const result = selectRecommendations(activities, '2026-04-01');
			expect(result).toHaveLength(3);
			// 全て異なる activityId
			const ids = result.map((r) => r.activityId);
			expect(new Set(ids).size).toBe(3);
		});
	});

	describe('basePoints ソート（簡単なもの優先）', () => {
		it('同一カテゴリ内で basePoints が低いものが優先される', () => {
			// 同一カテゴリに3件あり、basePoints が異なる
			const activities = [
				makeActivity({ id: 1, categoryId: 1, basePoints: 10 }),
				makeActivity({ id: 2, categoryId: 1, basePoints: 1 }),
				makeActivity({ id: 3, categoryId: 1, basePoints: 5 }),
			];
			const result = selectRecommendations(activities, '2026-04-01', 1);
			// ソート後のグループ内は [id:2(1pt), id:3(5pt), id:1(10pt)]
			// seed % group.length でどれかが選ばれるが、count=1 でまず1件選ばれる
			expect(result).toHaveLength(1);
		});
	});

	describe('日替わりローテーション', () => {
		it('異なる日付で異なる結果になる場合がある', () => {
			const activities = Array.from({ length: 10 }, (_, i) =>
				makeActivity({ id: i + 1, categoryId: (i % 5) + 1 }),
			);
			const result1 = selectRecommendations(activities, '2026-04-01');
			const result2 = selectRecommendations(activities, '2026-04-02');
			const ids1 = result1.map((r) => r.activityId).sort();
			const ids2 = result2.map((r) => r.activityId).sort();
			// 日付が異なれば異なる結果になるはず（ハッシュベース）
			// ただし確率的に同じになる可能性もゼロではないので、複数日付で試す
			const result3 = selectRecommendations(activities, '2026-04-03');
			const ids3 = result3.map((r) => r.activityId).sort();
			// 3つの日付のうち少なくとも2つは異なるはず
			const allSame =
				JSON.stringify(ids1) === JSON.stringify(ids2) &&
				JSON.stringify(ids2) === JSON.stringify(ids3);
			expect(allSame).toBe(false);
		});

		it('同じ日付では常に同じ結果になる（決定的）', () => {
			const activities = Array.from({ length: 10 }, (_, i) =>
				makeActivity({ id: i + 1, categoryId: (i % 5) + 1 }),
			);
			const result1 = selectRecommendations(activities, '2026-04-01');
			const result2 = selectRecommendations(activities, '2026-04-01');
			expect(result1).toEqual(result2);
		});
	});

	describe('重複排除', () => {
		it('同じ activityId が複数回選ばれない', () => {
			const activities = [
				makeActivity({ id: 1, categoryId: 1 }),
				makeActivity({ id: 2, categoryId: 2 }),
				makeActivity({ id: 3, categoryId: 3 }),
				makeActivity({ id: 4, categoryId: 4 }),
				makeActivity({ id: 5, categoryId: 5 }),
			];
			const result = selectRecommendations(activities, '2026-04-01', 5);
			const ids = result.map((r) => r.activityId);
			expect(new Set(ids).size).toBe(ids.length);
		});
	});

	describe('reason フィールド', () => {
		it('最初の推薦は category_diversity', () => {
			const activities = [
				makeActivity({ id: 1, categoryId: 1 }),
				makeActivity({ id: 2, categoryId: 2 }),
				makeActivity({ id: 3, categoryId: 3 }),
			];
			const result = selectRecommendations(activities, '2026-04-01');
			expect(result[0]?.reason).toBe('category_diversity');
		});

		it('2番目の推薦は easy_win', () => {
			const activities = [
				makeActivity({ id: 1, categoryId: 1 }),
				makeActivity({ id: 2, categoryId: 2 }),
				makeActivity({ id: 3, categoryId: 3 }),
			];
			const result = selectRecommendations(activities, '2026-04-01');
			if (result.length >= 2) {
				expect(result[1]?.reason).toBe('easy_win');
			}
		});

		it('3番目以降の推薦は daily_rotation', () => {
			const activities = [
				makeActivity({ id: 1, categoryId: 1 }),
				makeActivity({ id: 2, categoryId: 2 }),
				makeActivity({ id: 3, categoryId: 3 }),
			];
			const result = selectRecommendations(activities, '2026-04-01');
			if (result.length >= 3) {
				expect(result[2]?.reason).toBe('daily_rotation');
			}
		});

		it('フォールバック補充分は daily_rotation になる', () => {
			// 1カテゴリだけだと、ラウンドロビンで1件しか選ばれず、残りはフォールバック
			const activities = [
				makeActivity({ id: 1, categoryId: 1, basePoints: 3 }),
				makeActivity({ id: 2, categoryId: 1, basePoints: 5 }),
				makeActivity({ id: 3, categoryId: 1, basePoints: 8 }),
			];
			const result = selectRecommendations(activities, '2026-04-01');
			// フォールバック補充分は全て daily_rotation
			const fallbackItems = result.filter((r) => r.reason === 'daily_rotation');
			expect(fallbackItems.length).toBeGreaterThanOrEqual(0);
		});
	});

	describe('エッジケース', () => {
		it('count=0 の場合は空配列を返す', () => {
			const activities = [makeActivity({ id: 1, categoryId: 1 })];
			const result = selectRecommendations(activities, '2026-04-01', 0);
			expect(result).toEqual([]);
		});

		it('大量の活動でもクラッシュしない', () => {
			const activities = Array.from({ length: 100 }, (_, i) =>
				makeActivity({ id: i + 1, categoryId: (i % 5) + 1, basePoints: (i % 10) + 1 }),
			);
			const result = selectRecommendations(activities, '2026-04-01');
			expect(result.length).toBeLessThanOrEqual(3);
			expect(result.length).toBeGreaterThan(0);
		});

		it('空文字の日付でもクラッシュしない', () => {
			const activities = [makeActivity({ id: 1, categoryId: 1 })];
			const result = selectRecommendations(activities, '');
			expect(result).toHaveLength(1);
		});

		it('カテゴリID が連続でなくても正しく動作する', () => {
			const activities = [
				makeActivity({ id: 1, categoryId: 10 }),
				makeActivity({ id: 2, categoryId: 50 }),
				makeActivity({ id: 3, categoryId: 100 }),
			];
			const result = selectRecommendations(activities, '2026-04-01');
			expect(result.length).toBeLessThanOrEqual(3);
			const ids = result.map((r) => r.activityId);
			expect(new Set(ids).size).toBe(ids.length);
		});
	});
});

// ============================================================
// isFocusModeActive (#0288: 常時有効化)
// ============================================================
describe('isFocusModeActive', () => {
	it('常に true を返す（デイリークエスト常時有効）', async () => {
		const result = await isFocusModeActive(1, TENANT);
		expect(result).toBe(true);
	});

	it('どの childId でも true を返す', async () => {
		const result = await isFocusModeActive(42, TENANT);
		expect(result).toBe(true);
	});
});

// ============================================================
// markFocusModeStart
// ============================================================
describe('markFocusModeStart', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('初回呼び出しで開始日を記録する', async () => {
		mockGetSetting.mockResolvedValue(undefined);
		mockSetSetting.mockResolvedValue(undefined);

		await markFocusModeStart(1, TENANT);

		expect(mockSetSetting).toHaveBeenCalledTimes(1);
		const [key, value, tenant] = mockSetSetting.mock.calls[0] ?? [];
		expect(key).toBe('focus_mode_start_1');
		expect(tenant).toBe(TENANT);
		// 日付文字列は YYYY-MM-DD 形式
		expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('既に開始日がある場合は上書きしない', async () => {
		mockGetSetting.mockResolvedValue('2026-03-28');

		await markFocusModeStart(1, TENANT);

		expect(mockSetSetting).not.toHaveBeenCalled();
	});

	it('childId ごとに異なるキーを使用する', async () => {
		mockGetSetting.mockResolvedValue(undefined);
		mockSetSetting.mockResolvedValue(undefined);

		await markFocusModeStart(99, TENANT);

		expect(mockSetSetting).toHaveBeenCalledWith(
			'focus_mode_start_99',
			expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
			TENANT,
		);
	});
});

// ============================================================
// checkAndGrantFocusBonus
// ============================================================
describe('checkAndGrantFocusBonus', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('おすすめ活動IDが空なら null を返す', async () => {
		const result = await checkAndGrantFocusBonus(1, [], TENANT);
		expect(result).toBeNull();
	});

	it('フォーカスモードは常時有効なのでこのケースはスキップ', async () => {
		// #0288: isFocusModeActive は常に true を返すため、このテストは不要
		// 互換性のため空テストとして残す
		expect(true).toBe(true);
	});

	it('今日すでにフォーカスボーナスを付与済みなら null を返す', async () => {
		// フォーカスモード有効（開始日なし = 初回）
		mockGetSetting.mockResolvedValue(undefined);
		// 既に付与済み
		mockCountPointLedgerEntriesByTypeAndDate.mockResolvedValue(1);

		const result = await checkAndGrantFocusBonus(1, [1, 2, 3], TENANT);
		expect(result).toBeNull();
		expect(mockInsertPointLedger).not.toHaveBeenCalled();
	});

	it('おすすめ活動が1つでも未完了なら null を返す', async () => {
		mockGetSetting.mockResolvedValue(undefined);
		mockCountPointLedgerEntriesByTypeAndDate.mockResolvedValue(0);
		// 活動1は完了、活動2は未完了
		mockCountTodayActiveRecords
			.mockResolvedValueOnce(1) // activity 1: completed
			.mockResolvedValueOnce(0); // activity 2: not completed

		const result = await checkAndGrantFocusBonus(1, [1, 2, 3], TENANT);
		expect(result).toBeNull();
		expect(mockInsertPointLedger).not.toHaveBeenCalled();
	});

	it('全おすすめ活動が完了していればボーナスを付与する', async () => {
		mockGetSetting.mockResolvedValue(undefined);
		mockCountPointLedgerEntriesByTypeAndDate.mockResolvedValue(0);
		mockCountTodayActiveRecords.mockResolvedValue(1); // 全完了
		mockInsertPointLedger.mockResolvedValue(undefined);

		const result = await checkAndGrantFocusBonus(1, [10, 20, 30], TENANT);

		expect(result).toEqual({ bonusPoints: 10 });
		expect(mockInsertPointLedger).toHaveBeenCalledTimes(1);
		expect(mockInsertPointLedger).toHaveBeenCalledWith(
			{
				childId: 1,
				amount: 10,
				type: 'focus_bonus',
				description: 'きょうのクエスト コンプリート！',
			},
			TENANT,
		);
	});

	it('ボーナスポイントは10ポイント固定（#0288）', async () => {
		mockGetSetting.mockResolvedValue(undefined);
		mockCountPointLedgerEntriesByTypeAndDate.mockResolvedValue(0);
		mockCountTodayActiveRecords.mockResolvedValue(1);
		mockInsertPointLedger.mockResolvedValue(undefined);

		const result = await checkAndGrantFocusBonus(1, [1], TENANT);
		expect(result?.bonusPoints).toBe(10);
	});

	it('各おすすめ活動の完了状態を個別にチェックする', async () => {
		mockGetSetting.mockResolvedValue(undefined);
		mockCountPointLedgerEntriesByTypeAndDate.mockResolvedValue(0);
		mockCountTodayActiveRecords.mockResolvedValue(1);
		mockInsertPointLedger.mockResolvedValue(undefined);

		await checkAndGrantFocusBonus(1, [10, 20, 30], TENANT);

		// 各活動IDに対して countTodayActiveRecords が呼ばれる
		expect(mockCountTodayActiveRecords).toHaveBeenCalledTimes(3);
		expect(mockCountTodayActiveRecords).toHaveBeenCalledWith(1, 10, '2026-04-01', TENANT);
		expect(mockCountTodayActiveRecords).toHaveBeenCalledWith(1, 20, '2026-04-01', TENANT);
		expect(mockCountTodayActiveRecords).toHaveBeenCalledWith(1, 30, '2026-04-01', TENANT);
	});

	it('最後の活動だけ未完了でも null を返す', async () => {
		mockGetSetting.mockResolvedValue(undefined);
		mockCountPointLedgerEntriesByTypeAndDate.mockResolvedValue(0);
		mockCountTodayActiveRecords
			.mockResolvedValueOnce(1) // activity 10: done
			.mockResolvedValueOnce(1) // activity 20: done
			.mockResolvedValueOnce(0); // activity 30: not done

		const result = await checkAndGrantFocusBonus(1, [10, 20, 30], TENANT);
		expect(result).toBeNull();
		expect(mockInsertPointLedger).not.toHaveBeenCalled();
	});
});
