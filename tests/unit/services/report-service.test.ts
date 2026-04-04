// tests/unit/services/report-service.test.ts
// report-service ユニットテスト
// ファクトリ経由 (getRepos()) でDBアクセスするため、ファクトリをモックしてテストする。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportDailySummary } from '$lib/server/db/types';

// ---- モック定義 ----

const mockRepos = {
	child: { findAllChildren: vi.fn() },
	activity: { findTodayLogsWithCategory: vi.fn() },
	status: { findStatuses: vi.fn() },
	achievement: { findUnlockedAchievements: vi.fn() },
	reportDailySummary: {
		findByChildAndDateRange: vi.fn(),
		findByTenantAndDateRange: vi.fn(),
		upsert: vi.fn(),
	},
};

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => mockRepos,
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
	aggregateDailyReport,
	computeAllChildrenDetailedReport,
	computeDetailedMonthlyReport,
	getAllChildrenMonthlyReport,
	getAllChildrenSimpleSummary,
	getMonthlyReport,
	getSimpleMonthSummary,
} from '$lib/server/services/report-service';

const TENANT = 'test-tenant';

function makeSummary(overrides: Partial<ReportDailySummary> = {}): ReportDailySummary {
	return {
		id: 1,
		tenantId: TENANT,
		childId: 1,
		date: '2026-04-01',
		activityCount: 3,
		categoryBreakdown: JSON.stringify({ '1': 2, '2': 1 }),
		checklistCompletion: JSON.stringify({}),
		level: 5,
		totalPoints: 120,
		streakDays: 3,
		newAchievements: 1,
		createdAt: '2026-04-01T00:00:00',
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	// defaults
	mockRepos.child.findAllChildren.mockResolvedValue([]);
	mockRepos.activity.findTodayLogsWithCategory.mockResolvedValue([]);
	mockRepos.status.findStatuses.mockResolvedValue([]);
	mockRepos.achievement.findUnlockedAchievements.mockResolvedValue([]);
	mockRepos.reportDailySummary.findByChildAndDateRange.mockResolvedValue([]);
	mockRepos.reportDailySummary.findByTenantAndDateRange.mockResolvedValue([]);
	mockRepos.reportDailySummary.upsert.mockResolvedValue(undefined);
});

// ============================================================
// aggregateDailyReport
// ============================================================

describe('aggregateDailyReport', () => {
	it('全子供を処理し、処理件数を返す', async () => {
		mockRepos.child.findAllChildren.mockResolvedValue([
			{ id: 1, nickname: 'たろう' },
			{ id: 2, nickname: 'はなこ' },
		]);
		// findTodayLogsWithCategory は aggregateChildDaily -> calculateStreak でも呼ばれる
		// 最初の呼び出しはログ取得、以降はストリーク計算
		// ストリーク計算で空配列を返すとループが止まる
		mockRepos.activity.findTodayLogsWithCategory.mockResolvedValue([]);
		mockRepos.status.findStatuses.mockResolvedValue([]);

		const count = await aggregateDailyReport(TENANT, '2026-04-01');

		expect(count).toBe(2);
		expect(mockRepos.reportDailySummary.upsert).toHaveBeenCalledTimes(2);
	});

	it('子供がいない場合は0を返す', async () => {
		mockRepos.child.findAllChildren.mockResolvedValue([]);

		const count = await aggregateDailyReport(TENANT, '2026-04-01');

		expect(count).toBe(0);
		expect(mockRepos.reportDailySummary.upsert).not.toHaveBeenCalled();
	});

	it('個別の子供でエラーが発生しても他の子供の処理を継続する', async () => {
		mockRepos.child.findAllChildren.mockResolvedValue([
			{ id: 1, nickname: 'たろう' },
			{ id: 2, nickname: 'はなこ' },
			{ id: 3, nickname: 'じろう' },
		]);

		// 1人目は成功, 2人目はエラー, 3人目は成功
		let callCount = 0;
		mockRepos.activity.findTodayLogsWithCategory.mockImplementation(async (childId: number) => {
			if (childId === 2 && callCount < 3) {
				callCount++;
				throw new Error('DB error');
			}
			return [];
		});
		mockRepos.status.findStatuses.mockResolvedValue([]);

		const count = await aggregateDailyReport(TENANT, '2026-04-01');

		// 2人目がエラーなので processed は 2
		expect(count).toBe(2);
	});

	it('活動ログからカテゴリ別内訳を集計してupsertする', async () => {
		mockRepos.child.findAllChildren.mockResolvedValue([{ id: 1, nickname: 'たろう' }]);

		// 最初の呼び出し (日次ログ取得) のみデータを返し、ストリーク計算の後続呼び出しでは空を返す
		let firstCall = true;
		mockRepos.activity.findTodayLogsWithCategory.mockImplementation(async () => {
			if (firstCall) {
				firstCall = false;
				return [{ categoryId: 1 }, { categoryId: 1 }, { categoryId: 2 }];
			}
			return [];
		});
		mockRepos.status.findStatuses.mockResolvedValue([{ totalXp: 100, level: 3 }]);

		await aggregateDailyReport(TENANT, '2026-04-01');

		expect(mockRepos.reportDailySummary.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				tenantId: TENANT,
				childId: 1,
				date: '2026-04-01',
				activityCount: 3,
				categoryBreakdown: JSON.stringify({ '1': 2, '2': 1 }),
				level: 3,
				totalPoints: 100,
			}),
		);
	});
});

// ============================================================
// getMonthlyReport
// ============================================================

describe('getMonthlyReport', () => {
	it('サマリーがない場合はnullを返す', async () => {
		mockRepos.reportDailySummary.findByChildAndDateRange.mockResolvedValue([]);

		const result = await getMonthlyReport(TENANT, 1, '2026-04');

		expect(result).toBeNull();
	});

	it('子供が見つからない場合はnullを返す', async () => {
		mockRepos.reportDailySummary.findByChildAndDateRange.mockResolvedValue([makeSummary()]);
		mockRepos.child.findAllChildren.mockResolvedValue([{ id: 99, nickname: '別の子' }]);

		const result = await getMonthlyReport(TENANT, 1, '2026-04');

		expect(result).toBeNull();
	});

	it('日次データから月次サマリーを構築する', async () => {
		const summaries = [
			makeSummary({
				date: '2026-04-01',
				activityCount: 3,
				level: 4,
				totalPoints: 100,
				streakDays: 1,
				newAchievements: 1,
			}),
			makeSummary({
				date: '2026-04-02',
				activityCount: 5,
				level: 5,
				totalPoints: 150,
				streakDays: 2,
				newAchievements: 0,
			}),
			makeSummary({
				date: '2026-04-03',
				activityCount: 0,
				level: 5,
				totalPoints: 150,
				streakDays: 0,
				newAchievements: 0,
				categoryBreakdown: JSON.stringify({}),
			}),
		];
		mockRepos.reportDailySummary.findByChildAndDateRange.mockResolvedValue(summaries);
		mockRepos.child.findAllChildren.mockResolvedValue([{ id: 1, nickname: 'テスト太郎' }]);

		const result = await getMonthlyReport(TENANT, 1, '2026-04');

		expect(result).not.toBeNull();
		expect(result?.childName).toBe('テスト太郎');
		expect(result?.totalActivities).toBe(8);
		expect(result?.daysWithActivity).toBe(2);
		expect(result?.totalDays).toBe(3);
		expect(result?.avgDailyActivities).toBeCloseTo(2.7, 1);
		expect(result?.currentLevel).toBe(5);
		expect(result?.totalPoints).toBe(150);
		expect(result?.maxStreakDays).toBe(2);
		expect(result?.totalNewAchievements).toBe(1);
		expect(result?.month).toBe('2026-04');
	});

	it('正しい日付範囲でクエリする（月末日の計算）', async () => {
		mockRepos.reportDailySummary.findByChildAndDateRange.mockResolvedValue([]);

		await getMonthlyReport(TENANT, 1, '2026-02');

		expect(mockRepos.reportDailySummary.findByChildAndDateRange).toHaveBeenCalledWith(
			1,
			'2026-02-01',
			'2026-02-28',
			TENANT,
		);
	});
});

// ============================================================
// getAllChildrenMonthlyReport
// ============================================================

describe('getAllChildrenMonthlyReport', () => {
	it('サマリーが空の場合は空配列を返す', async () => {
		mockRepos.reportDailySummary.findByTenantAndDateRange.mockResolvedValue([]);

		const result = await getAllChildrenMonthlyReport(TENANT, '2026-04');

		expect(result).toEqual([]);
	});

	it('子供ごとにグルーピングして複数のサマリーを構築する', async () => {
		const summaries = [
			makeSummary({ childId: 1, date: '2026-04-01', activityCount: 3 }),
			makeSummary({ childId: 1, date: '2026-04-02', activityCount: 2 }),
			makeSummary({ childId: 2, date: '2026-04-01', activityCount: 4 }),
		];
		mockRepos.reportDailySummary.findByTenantAndDateRange.mockResolvedValue(summaries);
		mockRepos.child.findAllChildren.mockResolvedValue([
			{ id: 1, nickname: 'たろう' },
			{ id: 2, nickname: 'はなこ' },
		]);

		const result = await getAllChildrenMonthlyReport(TENANT, '2026-04');

		expect(result).toHaveLength(2);
		const taro = result.find((r) => r.childId === 1);
		const hanako = result.find((r) => r.childId === 2);
		expect(taro?.totalActivities).toBe(5);
		expect(taro?.childName).toBe('たろう');
		expect(hanako?.totalActivities).toBe(4);
		expect(hanako?.childName).toBe('はなこ');
	});

	it('子供名が見つからない場合はフォールバック名を使用する', async () => {
		const summaries = [makeSummary({ childId: 99, date: '2026-04-01' })];
		mockRepos.reportDailySummary.findByTenantAndDateRange.mockResolvedValue(summaries);
		mockRepos.child.findAllChildren.mockResolvedValue([]);

		const result = await getAllChildrenMonthlyReport(TENANT, '2026-04');

		expect(result).toHaveLength(1);
		expect(result[0]?.childName).toBe('子供99');
	});
});

// ============================================================
// getSimpleMonthSummary
// ============================================================

describe('getSimpleMonthSummary', () => {
	it('集計テーブルがある場合はそれを使う', async () => {
		const summaries = [
			makeSummary({ activityCount: 3, level: 5, newAchievements: 1 }),
			makeSummary({ activityCount: 2, level: 6, newAchievements: 0 }),
		];
		mockRepos.reportDailySummary.findByChildAndDateRange.mockResolvedValue(summaries);

		const result = await getSimpleMonthSummary(TENANT, 1, '2026-04');

		expect(result.totalActivities).toBe(5);
		expect(result.currentLevel).toBe(6);
		expect(result.newAchievements).toBe(1);
		// リアルタイム計算のAPIは呼ばれない
		expect(mockRepos.status.findStatuses).not.toHaveBeenCalled();
	});

	it('集計テーブルが空の場合はリアルタイム計算にフォールバックする', async () => {
		mockRepos.reportDailySummary.findByChildAndDateRange.mockResolvedValue([]);
		mockRepos.activity.findTodayLogsWithCategory.mockResolvedValue([{ categoryId: 1 }]);
		mockRepos.status.findStatuses.mockResolvedValue([{ totalXp: 200, level: 8 }]);
		mockRepos.achievement.findUnlockedAchievements.mockResolvedValue([]);

		const result = await getSimpleMonthSummary(TENANT, 1, '2026-04');

		expect(result.currentLevel).toBe(8);
		expect(result.totalActivities).toBeGreaterThanOrEqual(0);
		expect(mockRepos.status.findStatuses).toHaveBeenCalled();
	});
});

// ============================================================
// getAllChildrenSimpleSummary
// ============================================================

describe('getAllChildrenSimpleSummary', () => {
	it('全子供の簡易サマリーをMapで返す', async () => {
		mockRepos.child.findAllChildren.mockResolvedValue([
			{ id: 1, nickname: 'たろう' },
			{ id: 2, nickname: 'はなこ' },
		]);
		// 集計テーブルにデータがあるケース
		mockRepos.reportDailySummary.findByChildAndDateRange.mockResolvedValue([
			makeSummary({ activityCount: 5, level: 3, newAchievements: 2 }),
		]);

		const result = await getAllChildrenSimpleSummary(TENANT, '2026-04');

		expect(result).toBeInstanceOf(Map);
		expect(result.size).toBe(2);
		expect(result.get(1)).toBeDefined();
		expect(result.get(2)).toBeDefined();
	});

	it('個別の子供でエラーが出てもデフォルト値を返す', async () => {
		mockRepos.child.findAllChildren.mockResolvedValue([
			{ id: 1, nickname: 'たろう' },
			{ id: 2, nickname: 'はなこ' },
		]);
		// 1人目は正常、2人目はエラー
		let callIdx = 0;
		mockRepos.reportDailySummary.findByChildAndDateRange.mockImplementation(async () => {
			callIdx++;
			if (callIdx === 2) {
				throw new Error('DB error');
			}
			return [makeSummary({ activityCount: 5, level: 3, newAchievements: 1 })];
		});

		const result = await getAllChildrenSimpleSummary(TENANT, '2026-04');

		expect(result.size).toBe(2);
		const fallback = result.get(2);
		expect(fallback).toEqual({
			totalActivities: 0,
			currentLevel: 1,
			newAchievements: 0,
		});
	});
});

// ============================================================
// computeDetailedMonthlyReport
// ============================================================

describe('computeDetailedMonthlyReport', () => {
	it('集計テーブルがある場合はbuildMonthlySummaryを使う', async () => {
		const summaries = [
			makeSummary({
				date: '2026-04-01',
				activityCount: 3,
				level: 5,
				totalPoints: 120,
				streakDays: 2,
				newAchievements: 1,
			}),
			makeSummary({
				date: '2026-04-02',
				activityCount: 4,
				level: 6,
				totalPoints: 180,
				streakDays: 3,
				newAchievements: 0,
			}),
		];
		mockRepos.reportDailySummary.findByChildAndDateRange.mockResolvedValue(summaries);

		const result = await computeDetailedMonthlyReport(TENANT, 1, 'テスト太郎', '2026-04');

		expect(result.childId).toBe(1);
		expect(result.childName).toBe('テスト太郎');
		expect(result.month).toBe('2026-04');
		expect(result.totalActivities).toBe(7);
		expect(result.currentLevel).toBe(6);
		expect(result.totalPoints).toBe(180);
		expect(result.maxStreakDays).toBe(3);
		expect(result.totalNewAchievements).toBe(1);
		expect(result.daysWithActivity).toBe(2);
		expect(result.totalDays).toBe(2);
		// リアルタイム計算のAPIは呼ばれない
		expect(mockRepos.status.findStatuses).not.toHaveBeenCalled();
	});

	it('集計テーブルが空の場合はリアルタイム計算にフォールバックする', async () => {
		mockRepos.reportDailySummary.findByChildAndDateRange.mockResolvedValue([]);
		mockRepos.activity.findTodayLogsWithCategory.mockResolvedValue([]);
		mockRepos.status.findStatuses.mockResolvedValue([{ totalXp: 300, level: 10 }]);
		mockRepos.achievement.findUnlockedAchievements.mockResolvedValue([]);

		const result = await computeDetailedMonthlyReport(TENANT, 1, 'テスト太郎', '2026-04');

		expect(result.childName).toBe('テスト太郎');
		expect(result.currentLevel).toBe(10);
		expect(result.totalPoints).toBe(300);
		expect(mockRepos.status.findStatuses).toHaveBeenCalled();
	});

	it('カテゴリ別内訳を正しくマージする', async () => {
		const summaries = [
			makeSummary({
				date: '2026-04-01',
				categoryBreakdown: JSON.stringify({ '1': 3, '2': 1 }),
			}),
			makeSummary({
				date: '2026-04-02',
				categoryBreakdown: JSON.stringify({ '1': 2, '3': 4 }),
			}),
		];
		mockRepos.reportDailySummary.findByChildAndDateRange.mockResolvedValue(summaries);

		const result = await computeDetailedMonthlyReport(TENANT, 1, 'テスト', '2026-04');

		expect(result.categoryBreakdown).toEqual({ '1': 5, '2': 1, '3': 4 });
	});
});

// ============================================================
// computeAllChildrenDetailedReport
// ============================================================

describe('computeAllChildrenDetailedReport', () => {
	it('全子供の詳細レポートを返す', async () => {
		mockRepos.child.findAllChildren.mockResolvedValue([
			{ id: 1, nickname: 'たろう' },
			{ id: 2, nickname: 'はなこ' },
		]);
		mockRepos.reportDailySummary.findByChildAndDateRange.mockResolvedValue([
			makeSummary({ activityCount: 5 }),
		]);

		const result = await computeAllChildrenDetailedReport(TENANT, '2026-04');

		expect(result).toHaveLength(2);
		expect(result[0]?.childName).toBe('たろう');
		expect(result[1]?.childName).toBe('はなこ');
	});

	it('個別の子供でエラーが発生しても他の子供の処理を継続する', async () => {
		mockRepos.child.findAllChildren.mockResolvedValue([
			{ id: 1, nickname: 'たろう' },
			{ id: 2, nickname: 'はなこ' },
			{ id: 3, nickname: 'じろう' },
		]);

		let callIdx = 0;
		mockRepos.reportDailySummary.findByChildAndDateRange.mockImplementation(async () => {
			callIdx++;
			if (callIdx === 2) {
				throw new Error('DB error for child 2');
			}
			return [makeSummary({ activityCount: 3 })];
		});

		const result = await computeAllChildrenDetailedReport(TENANT, '2026-04');

		// 2人目がエラーなので2件のみ
		expect(result).toHaveLength(2);
		expect(result.map((r) => r.childName)).toEqual(['たろう', 'じろう']);
	});

	it('子供がいない場合は空配列を返す', async () => {
		mockRepos.child.findAllChildren.mockResolvedValue([]);

		const result = await computeAllChildrenDetailedReport(TENANT, '2026-04');

		expect(result).toEqual([]);
	});
});

// ============================================================
// getMonthEndDate (間接テスト: getMonthlyReport の日付範囲で検証)
// ============================================================

describe('getMonthEndDate (ヘルパー関数の間接テスト)', () => {
	it('2月の月末日を正しく計算する（平年）', async () => {
		mockRepos.reportDailySummary.findByChildAndDateRange.mockResolvedValue([]);

		await getMonthlyReport(TENANT, 1, '2025-02');

		expect(mockRepos.reportDailySummary.findByChildAndDateRange).toHaveBeenCalledWith(
			1,
			'2025-02-01',
			'2025-02-28',
			TENANT,
		);
	});

	it('2月の月末日を正しく計算する（閏年）', async () => {
		mockRepos.reportDailySummary.findByChildAndDateRange.mockResolvedValue([]);

		await getMonthlyReport(TENANT, 1, '2024-02');

		expect(mockRepos.reportDailySummary.findByChildAndDateRange).toHaveBeenCalledWith(
			1,
			'2024-02-01',
			'2024-02-29',
			TENANT,
		);
	});

	it('31日の月の月末日を正しく計算する', async () => {
		mockRepos.reportDailySummary.findByChildAndDateRange.mockResolvedValue([]);

		await getMonthlyReport(TENANT, 1, '2026-01');

		expect(mockRepos.reportDailySummary.findByChildAndDateRange).toHaveBeenCalledWith(
			1,
			'2026-01-01',
			'2026-01-31',
			TENANT,
		);
	});

	it('30日の月の月末日を正しく計算する', async () => {
		mockRepos.reportDailySummary.findByChildAndDateRange.mockResolvedValue([]);

		await getMonthlyReport(TENANT, 1, '2026-04');

		expect(mockRepos.reportDailySummary.findByChildAndDateRange).toHaveBeenCalledWith(
			1,
			'2026-04-01',
			'2026-04-30',
			TENANT,
		);
	});

	it('12月の月末日を正しく計算する', async () => {
		mockRepos.reportDailySummary.findByChildAndDateRange.mockResolvedValue([]);

		await getMonthlyReport(TENANT, 1, '2026-12');

		expect(mockRepos.reportDailySummary.findByChildAndDateRange).toHaveBeenCalledWith(
			1,
			'2026-12-01',
			'2026-12-31',
			TENANT,
		);
	});
});
