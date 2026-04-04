// src/lib/server/services/weekly-report-service.ts
// 親向け週次成長レポート生成サービス

import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import { calcLevelFromXp } from '$lib/domain/validation/status';
import { countActivitiesByCategory } from '$lib/server/db/evaluation-repo';
import { findStatuses } from '$lib/server/db/status-repo';
import { logger } from '$lib/server/logger';
import { getWeekRange } from '$lib/server/services/evaluation-service';

// ============================================================
// Types
// ============================================================

export interface CategoryReport {
	categoryId: number;
	categoryName: string;
	categoryIcon: string;
	activityCount: number;
	totalPoints: number;
	level: number;
	levelTitle: string;
	totalXp: number;
}

export interface WeeklyHighlight {
	type: 'streak' | 'activity_top' | 'level_up' | 'achievement' | 'all_category';
	message: string;
	icon: string;
}

export interface WeeklyAdvice {
	message: string;
	suggestedCategory: string | null;
}

export interface WeeklyReport {
	childId: number;
	childName: string;
	weekStart: string;
	weekEnd: string;
	totalActivities: number;
	totalPoints: number;
	categories: CategoryReport[];
	highlights: WeeklyHighlight[];
	advice: WeeklyAdvice;
	newAchievements: { name: string; icon: string; description: string }[];
}

// ============================================================
// Report Generation
// ============================================================

/** 指定した週のレポートを生成する */
export async function generateWeeklyReport(
	childId: number,
	childName: string,
	tenantId: string,
	targetDate?: Date,
): Promise<WeeklyReport> {
	const { weekStart, weekEnd } = getWeekRange(targetDate ?? new Date());

	// 並列でデータ取得
	const [activityCounts, statuses] = await Promise.all([
		countActivitiesByCategory(childId, weekStart, weekEnd, tenantId),
		findStatuses(childId, tenantId),
	]);

	// カテゴリ別レポート
	const categories: CategoryReport[] = CATEGORY_DEFS.map((cat) => {
		const activity = activityCounts.find((a) => a.categoryId === cat.id);
		const status = statuses.find((s) => s.categoryId === cat.id);
		const totalXp = status?.totalXp ?? 0;
		const { level, title } = calcLevelFromXp(totalXp);

		return {
			categoryId: cat.id,
			categoryName: cat.name,
			categoryIcon: cat.icon,
			activityCount: activity?.count ?? 0,
			totalPoints: activity?.totalPoints ?? 0,
			level,
			levelTitle: title,
			totalXp,
		};
	});

	const totalActivities = categories.reduce((sum, c) => sum + c.activityCount, 0);
	const totalPoints = categories.reduce((sum, c) => sum + c.totalPoints, 0);

	// ハイライト生成
	const highlights = generateHighlights(categories, totalActivities);

	// 実績システム廃止（#322）— newAchievements は常に空
	const newAchievements: { name: string; icon: string; description: string }[] = [];

	// アドバイス生成
	const advice = generateAdvice(categories, totalActivities);

	logger.info('[weekly-report] Generated report', {
		context: { childId, weekStart, weekEnd, totalActivities },
	});

	return {
		childId,
		childName,
		weekStart,
		weekEnd,
		totalActivities,
		totalPoints,
		categories,
		highlights,
		advice,
		newAchievements,
	};
}

function generateHighlights(
	categories: CategoryReport[],
	totalActivities: number,
): WeeklyHighlight[] {
	const highlights: WeeklyHighlight[] = [];

	// 最も活動が多いカテゴリ
	const topCategory = [...categories].sort((a, b) => b.activityCount - a.activityCount)[0];
	if (topCategory && topCategory.activityCount > 0) {
		highlights.push({
			type: 'activity_top',
			message: `「${topCategory.categoryName}」を${topCategory.activityCount}かい きろくしたよ！`,
			icon: topCategory.categoryIcon,
		});
	}

	// 全カテゴリ達成
	const activeCats = categories.filter((c) => c.activityCount > 0).length;
	if (activeCats >= 5) {
		highlights.push({
			type: 'all_category',
			message: 'ぜんカテゴリで かつどうできた！すごい！',
			icon: '🌟',
		});
	} else if (activeCats >= 3) {
		highlights.push({
			type: 'all_category',
			message: `${activeCats}つのカテゴリで かつどうしたよ`,
			icon: '⭐',
		});
	}

	// 合計活動数のメッセージ
	if (totalActivities >= 20) {
		highlights.push({
			type: 'streak',
			message: `こんしゅうは ${totalActivities}かいも きろくした！がんばったね！`,
			icon: '🔥',
		});
	} else if (totalActivities >= 10) {
		highlights.push({
			type: 'streak',
			message: `こんしゅうは ${totalActivities}かい きろくしたよ`,
			icon: '💪',
		});
	}

	return highlights;
}

function generateAdvice(categories: CategoryReport[], totalActivities: number): WeeklyAdvice {
	if (totalActivities === 0) {
		return {
			message: 'こんしゅうは まだ きろくが ないよ。すこしずつ はじめてみよう！',
			suggestedCategory: null,
		};
	}

	// 最も活動が少ないカテゴリを提案
	const leastActive = [...categories]
		.filter((c) => c.activityCount === 0 || c.activityCount < 2)
		.sort((a, b) => a.activityCount - b.activityCount)[0];

	if (leastActive && leastActive.activityCount === 0) {
		return {
			message: `「${leastActive.categoryName}」にも ちょうせん してみよう！`,
			suggestedCategory: leastActive.categoryName,
		};
	}

	if (leastActive && leastActive.activityCount < 2) {
		return {
			message: `「${leastActive.categoryName}」を もうすこし がんばると バランスが よくなるよ`,
			suggestedCategory: leastActive.categoryName,
		};
	}

	return {
		message: 'バランスよく かつどうできているね！このちょうしで がんばろう！',
		suggestedCategory: null,
	};
}

/** 前週のレポートを全子供分生成する（管理画面用） */
export async function generateReportsForChildren(
	children: { id: number; nickname: string }[],
	tenantId: string,
	targetDate?: Date,
): Promise<WeeklyReport[]> {
	const reports: WeeklyReport[] = [];
	for (const child of children) {
		const report = await generateWeeklyReport(child.id, child.nickname, tenantId, targetDate);
		reports.push(report);
	}
	return reports;
}
