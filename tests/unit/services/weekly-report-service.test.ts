import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCountActivitiesByCategory = vi.fn();
const mockFindStatuses = vi.fn();
const mockFindAllAchievements = vi.fn();
const mockFindUnlockedAchievements = vi.fn();

vi.mock('$lib/server/db/evaluation-repo', () => ({
	countActivitiesByCategory: (...args: unknown[]) => mockCountActivitiesByCategory(...args),
}));

vi.mock('$lib/server/db/status-repo', () => ({
	findStatuses: (...args: unknown[]) => mockFindStatuses(...args),
}));

vi.mock('$lib/server/db/achievement-repo', () => ({
	findAllAchievements: (...args: unknown[]) => mockFindAllAchievements(...args),
	findUnlockedAchievements: (...args: unknown[]) => mockFindUnlockedAchievements(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { generateWeeklyReport } from '$lib/server/services/weekly-report-service';

const TENANT = 'test-tenant';

beforeEach(() => {
	vi.clearAllMocks();
	mockFindAllAchievements.mockResolvedValue([]);
	mockFindUnlockedAchievements.mockResolvedValue([]);
});

describe('generateWeeklyReport', () => {
	it('活動データからレポートを生成する', async () => {
		mockCountActivitiesByCategory.mockResolvedValue([
			{ categoryId: 1, count: 5, totalPoints: 50 },
			{ categoryId: 2, count: 3, totalPoints: 30 },
		]);
		mockFindStatuses.mockResolvedValue([
			{ categoryId: 1, totalXp: 150 },
			{ categoryId: 2, totalXp: 80 },
		]);

		const report = await generateWeeklyReport(1, 'テスト太郎', TENANT);

		expect(report.childName).toBe('テスト太郎');
		expect(report.totalActivities).toBe(8);
		expect(report.totalPoints).toBe(80);
		expect(report.categories).toHaveLength(5);

		const undou = report.categories.find((c) => c.categoryId === 1);
		expect(undou?.activityCount).toBe(5);
	});

	it('活動がない場合もレポートを生成できる', async () => {
		mockCountActivitiesByCategory.mockResolvedValue([]);
		mockFindStatuses.mockResolvedValue([]);

		const report = await generateWeeklyReport(1, 'テスト花子', TENANT);

		expect(report.totalActivities).toBe(0);
		expect(report.advice.message).toContain('まだ きろくが ないよ');
	});

	it('全カテゴリで活動があるとハイライトに含まれる', async () => {
		mockCountActivitiesByCategory.mockResolvedValue([
			{ categoryId: 1, count: 2, totalPoints: 20 },
			{ categoryId: 2, count: 3, totalPoints: 30 },
			{ categoryId: 3, count: 1, totalPoints: 10 },
			{ categoryId: 4, count: 2, totalPoints: 20 },
			{ categoryId: 5, count: 1, totalPoints: 10 },
		]);
		mockFindStatuses.mockResolvedValue([]);

		const report = await generateWeeklyReport(1, 'テスト', TENANT);

		const allCatHighlight = report.highlights.find((h) => h.type === 'all_category');
		expect(allCatHighlight?.message).toContain('ぜんカテゴリ');
	});

	it('実績システム廃止 — newAchievements は常に空配列', async () => {
		mockCountActivitiesByCategory.mockResolvedValue([]);
		mockFindStatuses.mockResolvedValue([]);
		const targetDate = new Date('2026-04-07');

		const report = await generateWeeklyReport(1, 'テスト', TENANT, targetDate);

		expect(report.newAchievements).toHaveLength(0);
	});

	it('活動が少ないカテゴリのアドバイスを生成する', async () => {
		mockCountActivitiesByCategory.mockResolvedValue([
			{ categoryId: 1, count: 5, totalPoints: 50 },
			// categoryId 2-5 は活動なし
		]);
		mockFindStatuses.mockResolvedValue([]);

		const report = await generateWeeklyReport(1, 'テスト', TENANT);

		expect(report.advice.suggestedCategory).not.toBeNull();
		expect(report.advice.message).toContain('ちょうせん');
	});

	it('バランスよく活動している場合のアドバイス', async () => {
		mockCountActivitiesByCategory.mockResolvedValue([
			{ categoryId: 1, count: 3, totalPoints: 30 },
			{ categoryId: 2, count: 3, totalPoints: 30 },
			{ categoryId: 3, count: 3, totalPoints: 30 },
			{ categoryId: 4, count: 3, totalPoints: 30 },
			{ categoryId: 5, count: 3, totalPoints: 30 },
		]);
		mockFindStatuses.mockResolvedValue([]);

		const report = await generateWeeklyReport(1, 'テスト', TENANT);

		expect(report.advice.message).toContain('バランスよく');
	});

	it('20回以上の活動でハイライトメッセージが変わる', async () => {
		mockCountActivitiesByCategory.mockResolvedValue([
			{ categoryId: 1, count: 10, totalPoints: 100 },
			{ categoryId: 2, count: 12, totalPoints: 120 },
		]);
		mockFindStatuses.mockResolvedValue([]);

		const report = await generateWeeklyReport(1, 'テスト', TENANT);

		const streakHighlight = report.highlights.find((h) => h.type === 'streak');
		expect(streakHighlight?.message).toContain('22かいも');
	});
});
