import type { ChildId } from '$lib/domain/ids';
// src/lib/server/services/growth-book-service.ts
// 成長記録ブックサービス — 年間データの集約と構造化

import { isFutureMonth } from '$lib/domain/child-metrics';
import { todayDateJST } from '$lib/domain/date-utils';
import { logger } from '$lib/server/logger';
import { getCertificatesForChild } from '$lib/server/services/certificate-service';
import { getChildById } from '$lib/server/services/child-service';
import { computeDetailedMonthlyReport } from '$lib/server/services/report-service';
import { getChildStatus } from '$lib/server/services/status-service';

// ============================================================
// Types
// ============================================================

export interface MonthPage {
	month: string; // "2025-04"
	totalActivities: number;
	categoryBreakdown: Record<string, number>;
	/** #4697: その月に台帳で獲得したポイント。未来月は 0 (画面は `isFuture` を見て「—」を出す)。 */
	totalPoints: number;
	currentLevel: number;
	maxStreakDays: number;
	totalNewAchievements: number;
	daysWithActivity: number;
	totalDays: number;
	/**
	 * #4697: まだ来ていない月か。年度は 4 月〜翌 3 月を必ず 12 行並べるため未来月の枠ができる。
	 * 旧実装は全 12 行に累計値 (395pt) を出し、活動 0 回の月にも未来月にも同じ数が並んでいた。
	 */
	isFuture: boolean;
}

export interface GrowthBookData {
	childId: ChildId;
	childName: string;
	fiscalYear: string; // "2025" = 2025年4月〜2026年3月
	// Cover
	currentLevel: number;
	levelTitle: string;
	// Annual summary
	totalActivities: number;
	totalPoints: number;
	maxStreakDays: number;
	bestMonth: string | null;
	bestCategory: string | null;
	// Monthly pages
	months: MonthPage[];
	// Certificates earned
	certificateCount: number;
}

// ============================================================
// Main
// ============================================================

/**
 * 年間の成長記録ブックデータを生成
 * @param fiscalYear "2025" → 2025年4月〜2026年3月
 */
export async function buildGrowthBook(
	childId: ChildId,
	fiscalYear: string,
	tenantId: string,
): Promise<GrowthBookData | null> {
	const child = await getChildById(childId, tenantId);
	if (!child) return null;

	const startYear = Number(fiscalYear);
	const months: MonthPage[] = [];
	let totalActivities = 0;
	let totalPoints = 0;
	let maxStreakDays = 0;
	let bestMonthActivities = 0;
	let bestMonth: string | null = null;
	const categoryTotals: Record<string, number> = {};

	// 4月〜翌3月の12ヶ月分
	for (let i = 0; i < 12; i++) {
		const year = i < 9 ? startYear : startYear + 1;
		const month = ((i + 4 - 1) % 12) + 1; // 4, 5, ... 12, 1, 2, 3
		const yearMonth = `${year}-${String(month).padStart(2, '0')}`;

		try {
			const report = await computeDetailedMonthlyReport(
				tenantId,
				childId,
				child.nickname,
				yearMonth,
			);

			const page: MonthPage = {
				month: yearMonth,
				totalActivities: report.totalActivities,
				categoryBreakdown: report.categoryBreakdown,
				totalPoints: report.totalPoints,
				currentLevel: report.currentLevel,
				maxStreakDays: report.maxStreakDays,
				totalNewAchievements: report.totalNewAchievements,
				daysWithActivity: report.daysWithActivity,
				totalDays: report.totalDays,
				isFuture: report.isFuture,
			};
			months.push(page);

			totalActivities += report.totalActivities;
			totalPoints += report.totalPoints;
			if (report.maxStreakDays > maxStreakDays) maxStreakDays = report.maxStreakDays;
			if (report.totalActivities > bestMonthActivities) {
				bestMonthActivities = report.totalActivities;
				bestMonth = yearMonth;
			}
			for (const [cat, count] of Object.entries(report.categoryBreakdown)) {
				categoryTotals[cat] = (categoryTotals[cat] ?? 0) + count;
			}
		} catch (e) {
			logger.warn('[growth-book] Monthly report failed', {
				context: { childId, yearMonth, error: String(e) },
			});
			months.push({
				month: yearMonth,
				totalActivities: 0,
				categoryBreakdown: {},
				totalPoints: 0,
				currentLevel: 1,
				maxStreakDays: 0,
				totalNewAchievements: 0,
				daysWithActivity: 0,
				totalDays: 0,
				isFuture: isFutureMonth(yearMonth, todayDateJST()),
			});
		}
	}

	// Best category
	let bestCategory: string | null = null;
	let bestCategoryCount = 0;
	for (const [cat, count] of Object.entries(categoryTotals)) {
		if (count > bestCategoryCount) {
			bestCategoryCount = count;
			bestCategory = cat;
		}
	}

	// Current status
	const status = await getChildStatus(childId, tenantId);
	const currentLevel = 'error' in status ? 1 : status.level;
	const levelTitle = 'error' in status ? '' : status.levelTitle;

	// Certificates
	const certs = await getCertificatesForChild(childId, tenantId);

	return {
		childId,
		childName: child.nickname,
		fiscalYear,
		currentLevel,
		levelTitle,
		totalActivities,
		totalPoints,
		maxStreakDays,
		bestMonth,
		bestCategory,
		months,
		certificateCount: certs.length,
	};
}
