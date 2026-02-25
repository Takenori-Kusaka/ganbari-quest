import { CATEGORIES } from '$lib/domain/validation/activity';
import { db } from '$lib/server/db';
import {
	findAllAchievements,
	findUnlockedAchievementIds,
	findUnlockedAchievements,
	insertChildAchievement,
} from '$lib/server/db/achievement-repo';
import { getBalance } from '$lib/server/db/point-repo';
import { activities, activityLogs, pointLedger } from '$lib/server/db/schema';
import { getChildStatus } from '$lib/server/services/status-service';
import { and, count, countDistinct, eq } from 'drizzle-orm';

// --- 型定義 ---

export interface UnlockedAchievement {
	achievementId: number;
	code: string;
	name: string;
	icon: string;
	bonusPoints: number;
	rarity: string;
}

export interface AchievementWithStatus {
	id: number;
	code: string;
	name: string;
	description: string | null;
	icon: string;
	category: string | null;
	conditionType: string;
	conditionValue: number;
	bonusPoints: number;
	rarity: string;
	sortOrder: number;
	unlockedAt: string | null;
}

// --- 実績チェック + 解除 ---

/** 全条件をチェックし、新規達成した実績を返す */
export function checkAndUnlockAchievements(childId: number): UnlockedAchievement[] {
	const allAchievements = findAllAchievements();
	const unlockedIds = findUnlockedAchievementIds(childId);
	const newlyUnlocked: UnlockedAchievement[] = [];

	for (const achievement of allAchievements) {
		// 既に解除済みならスキップ
		if (unlockedIds.has(achievement.id)) continue;

		// 条件を評価
		const met = evaluateCondition(
			childId,
			achievement.conditionType,
			achievement.conditionValue,
			achievement.category,
		);

		if (met) {
			// 実績解除
			insertChildAchievement(childId, achievement.id);

			// ポイント付与
			db.insert(pointLedger)
				.values({
					childId,
					amount: achievement.bonusPoints,
					type: 'achievement',
					description: `${achievement.name}をたっせい！`,
					referenceId: achievement.id,
				})
				.run();

			newlyUnlocked.push({
				achievementId: achievement.id,
				code: achievement.code,
				name: achievement.name,
				icon: achievement.icon,
				bonusPoints: achievement.bonusPoints,
				rarity: achievement.rarity,
			});
		}
	}

	return newlyUnlocked;
}

// --- 一覧取得 ---

/** 全実績一覧（解除状態付き） */
export function getChildAchievements(childId: number): AchievementWithStatus[] {
	const allAchievements = findAllAchievements();
	const unlocked = findUnlockedAchievements(childId);
	const unlockedMap = new Map(unlocked.map((u) => [u.achievementId, u.unlockedAt]));

	return allAchievements.map((a) => ({
		id: a.id,
		code: a.code,
		name: a.name,
		description: a.description,
		icon: a.icon,
		category: a.category,
		conditionType: a.conditionType,
		conditionValue: a.conditionValue,
		bonusPoints: a.bonusPoints,
		rarity: a.rarity,
		sortOrder: a.sortOrder,
		unlockedAt: unlockedMap.get(a.id) ?? null,
	}));
}

// --- 条件判定（内部） ---

function evaluateCondition(
	childId: number,
	conditionType: string,
	conditionValue: number,
	_category: string | null,
): boolean {
	switch (conditionType) {
		case 'streak_days':
			return checkStreakDays(childId, conditionValue);
		case 'total_activities':
			return checkTotalActivities(childId, conditionValue);
		case 'all_categories':
			return checkAllCategories(childId);
		case 'level_reach':
			return checkLevelReach(childId, conditionValue);
		case 'total_points':
			return checkTotalPoints(childId, conditionValue);
		default:
			return false;
	}
}

/** 最大連続日数を計算 */
function checkStreakDays(childId: number, requiredDays: number): boolean {
	const rows = db
		.select({ recordedDate: activityLogs.recordedDate })
		.from(activityLogs)
		.where(and(eq(activityLogs.childId, childId), eq(activityLogs.cancelled, 0)))
		.groupBy(activityLogs.recordedDate)
		.orderBy(activityLogs.recordedDate)
		.all();

	if (rows.length === 0) return false;

	let maxStreak = 1;
	let currentStreak = 1;

	for (let i = 1; i < rows.length; i++) {
		const prev = new Date(`${rows[i - 1]?.recordedDate}T00:00:00Z`);
		const curr = new Date(`${rows[i]?.recordedDate}T00:00:00Z`);
		const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);

		if (diffDays === 1) {
			currentStreak++;
			if (currentStreak > maxStreak) maxStreak = currentStreak;
		} else {
			currentStreak = 1;
		}
	}

	return maxStreak >= requiredDays;
}

/** 累計活動記録数をチェック */
function checkTotalActivities(childId: number, requiredCount: number): boolean {
	const result = db
		.select({ total: count() })
		.from(activityLogs)
		.where(and(eq(activityLogs.childId, childId), eq(activityLogs.cancelled, 0)))
		.get();

	return (result?.total ?? 0) >= requiredCount;
}

/** 全5カテゴリに記録がある日が存在するかチェック */
function checkAllCategories(childId: number): boolean {
	// 各日ごとに記録されたカテゴリ数を集計
	const rows = db
		.select({
			recordedDate: activityLogs.recordedDate,
			categoryCount: countDistinct(activities.category),
		})
		.from(activityLogs)
		.innerJoin(activities, eq(activityLogs.activityId, activities.id))
		.where(and(eq(activityLogs.childId, childId), eq(activityLogs.cancelled, 0)))
		.groupBy(activityLogs.recordedDate)
		.all();

	return rows.some((r) => r.categoryCount >= CATEGORIES.length);
}

/** レベル到達チェック */
function checkLevelReach(childId: number, requiredLevel: number): boolean {
	const status = getChildStatus(childId);
	if ('error' in status) return false;
	return status.level >= requiredLevel;
}

/** 累計ポイントチェック（point_ledger の正の合計） */
function checkTotalPoints(childId: number, requiredPoints: number): boolean {
	// 実績ポイント自体を除いた累計で判定すると循環するため、全合計で判定
	const balance = getBalance(childId);
	return balance >= requiredPoints;
}
