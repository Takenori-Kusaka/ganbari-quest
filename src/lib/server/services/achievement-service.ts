import { todayDateJST } from '$lib/domain/date-utils';
import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import { db } from '$lib/server/db';
import {
	findAllAchievements,
	findUnlockedAchievements,
	insertChildAchievement,
	isAchievementUnlocked,
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
	milestoneValue: number | null;
}

export interface MilestoneInfo {
	value: number;
	unlocked: boolean;
	unlockedAt: string | null;
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
	repeatable: boolean;
	isMilestone: boolean;
	milestones: MilestoneInfo[];
	highestUnlockedMilestone: number | null;
	nextMilestone: number | null;
	unlockedAt: string | null;
	currentProgress: number;
	conditionLabel: string;
	liveStreak: number | null;
}

// --- 実績チェック + 解除 ---

/** 全条件をチェックし、新規達成した実績を返す */
export function checkAndUnlockAchievements(childId: number): UnlockedAchievement[] {
	const allAchievements = findAllAchievements();
	const newlyUnlocked: UnlockedAchievement[] = [];

	for (const achievement of allAchievements) {
		// ライフイベントは手動付与のみ
		if (achievement.conditionType === 'milestone_event') continue;

		if (achievement.repeatable && achievement.milestoneValues) {
			// 繰り返し型: 各マイルストーンをチェック
			const milestones: number[] = JSON.parse(achievement.milestoneValues);
			for (const milestone of milestones) {
				if (isAchievementUnlocked(childId, achievement.id, milestone)) continue;

				const met = evaluateCondition(
					childId,
					achievement.conditionType,
					milestone,
					achievement.category,
				);

				if (met) {
					insertChildAchievement(childId, achievement.id, milestone);

					// ポイント計算: マイルストーンインデックスに応じて増加
					const milestoneIndex = milestones.indexOf(milestone);
					const points = achievement.bonusPoints * (milestoneIndex + 1);

					db.insert(pointLedger)
						.values({
							childId,
							amount: points,
							type: 'achievement',
							description: `${achievement.name} ${milestone}たっせい！`,
							referenceId: achievement.id,
						})
						.run();

					newlyUnlocked.push({
						achievementId: achievement.id,
						code: achievement.code,
						name: achievement.name,
						icon: achievement.icon,
						bonusPoints: points,
						rarity: getMilestoneRarity(milestoneIndex, milestones.length),
						milestoneValue: milestone,
					});
				} else {
					// 下位マイルストーン未達なら上位もスキップ
					break;
				}
			}
		} else {
			// 一度きり型
			if (isAchievementUnlocked(childId, achievement.id, null)) continue;

			const met = evaluateCondition(
				childId,
				achievement.conditionType,
				achievement.conditionValue,
				achievement.category,
			);

			if (met) {
				insertChildAchievement(childId, achievement.id, null);

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
					milestoneValue: null,
				});
			}
		}
	}

	return newlyUnlocked;
}

// --- 一覧取得 ---

/** 全実績一覧（解除状態・現在進捗・条件ラベル付き） */
export function getChildAchievements(childId: number): AchievementWithStatus[] {
	const allAchievements = findAllAchievements();
	const unlocked = findUnlockedAchievements(childId);

	// streak_days タイプのために現在のライブ連続日数を1回だけ計算
	const hasStreakType = allAchievements.some((a) => a.conditionType === 'streak_days');
	const liveStreakValue = hasStreakType ? getCurrentStreakDays(childId) : 0;

	return allAchievements.map((a) => {
		const isRepeatable = a.repeatable === 1;
		const isLifeMilestone = a.isMilestone === 1;
		const milestoneValues: number[] = a.milestoneValues ? JSON.parse(a.milestoneValues) : [];

		// このachievementの解除記録をフィルタ
		const achievementUnlocks = unlocked.filter((u) => u.achievementId === a.id);

		let milestones: MilestoneInfo[] = [];
		let highestUnlockedMilestone: number | null = null;
		let nextMilestone: number | null = null;
		let unlockedAt: string | null = null;

		if (isRepeatable && milestoneValues.length > 0) {
			milestones = milestoneValues.map((v) => {
				const record = achievementUnlocks.find((u) => u.milestoneValue === v);
				return { value: v, unlocked: !!record, unlockedAt: record?.unlockedAt ?? null };
			});

			const unlockedMilestones = milestones.filter((m) => m.unlocked);
			if (unlockedMilestones.length > 0) {
				highestUnlockedMilestone = unlockedMilestones[unlockedMilestones.length - 1]?.value ?? null;
				unlockedAt = unlockedMilestones[unlockedMilestones.length - 1]?.unlockedAt ?? null;
			}

			const firstLocked = milestones.find((m) => !m.unlocked);
			nextMilestone = firstLocked?.value ?? null;
		} else {
			// 一度きり or ライフイベント
			const record = achievementUnlocks.find((u) => u.milestoneValue == null);
			unlockedAt = record?.unlockedAt ?? null;
		}

		const progress = getCurrentProgress(childId, a.conditionType, a.category);
		const targetValue = nextMilestone ?? a.conditionValue;

		return {
			id: a.id,
			code: a.code,
			name: a.name,
			description: a.description,
			icon: a.icon,
			category: a.category,
			conditionType: a.conditionType,
			conditionValue: targetValue,
			bonusPoints: a.bonusPoints,
			rarity: a.rarity,
			sortOrder: a.sortOrder,
			repeatable: isRepeatable,
			isMilestone: isLifeMilestone,
			milestones,
			highestUnlockedMilestone,
			nextMilestone,
			unlockedAt,
			currentProgress: progress,
			conditionLabel: getConditionLabel(a.conditionType, targetValue, highestUnlockedMilestone),
			liveStreak: a.conditionType === 'streak_days' ? liveStreakValue : null,
		};
	});
}

// --- ライフイベント手動付与 ---

export function grantLifeEvent(
	childId: number,
	achievementId: number,
): { success: true; bonusPoints: number } | { error: string } {
	const allAchievements = findAllAchievements();
	const achievement = allAchievements.find((a) => a.id === achievementId);
	if (!achievement) return { error: 'ACHIEVEMENT_NOT_FOUND' };
	if (achievement.isMilestone !== 1) return { error: 'NOT_A_LIFE_EVENT' };
	if (isAchievementUnlocked(childId, achievementId, null)) return { error: 'ALREADY_UNLOCKED' };

	insertChildAchievement(childId, achievementId, null);

	db.insert(pointLedger)
		.values({
			childId,
			amount: achievement.bonusPoints,
			type: 'achievement',
			description: `${achievement.name}おめでとう！`,
			referenceId: achievement.id,
		})
		.run();

	return { success: true, bonusPoints: achievement.bonusPoints };
}

// --- マイルストーンレアリティ計算 ---

function getMilestoneRarity(index: number, total: number): string {
	const ratio = (index + 1) / total;
	if (ratio >= 0.9) return 'legendary';
	if (ratio >= 0.6) return 'epic';
	if (ratio >= 0.3) return 'rare';
	return 'common';
}

// --- 進捗取得・条件ラベル ---

/** 条件タイプに応じた現在の進捗値を取得 */
function getCurrentProgress(
	childId: number,
	conditionType: string,
	_category: string | null,
): number {
	switch (conditionType) {
		case 'streak_days':
			return getMaxStreakDays(childId);
		case 'total_activities':
			return getTotalActivityCount(childId);
		case 'all_categories':
			return getMaxCategoryCountInDay(childId);
		case 'category_complete':
			return getDistinctCategoryCount(childId);
		case 'level_reach':
			return getCurrentLevel(childId);
		case 'total_points':
			return getBalance(childId);
		case 'milestone_event':
			return 0;
		default:
			return 0;
	}
}

/** 最大連続日数を取得 */
function getMaxStreakDays(childId: number): number {
	const rows = db
		.select({ recordedDate: activityLogs.recordedDate })
		.from(activityLogs)
		.where(and(eq(activityLogs.childId, childId), eq(activityLogs.cancelled, 0)))
		.groupBy(activityLogs.recordedDate)
		.orderBy(activityLogs.recordedDate)
		.all();

	if (rows.length === 0) return 0;

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

	return maxStreak;
}

/** 現在のライブ連続日数を取得（最大ではなく、今日/昨日からの連続） */
function getCurrentStreakDays(childId: number): number {
	const rows = db
		.select({ recordedDate: activityLogs.recordedDate })
		.from(activityLogs)
		.where(and(eq(activityLogs.childId, childId), eq(activityLogs.cancelled, 0)))
		.groupBy(activityLogs.recordedDate)
		.orderBy(activityLogs.recordedDate)
		.all();

	if (rows.length === 0) return 0;

	const today = todayDateJST();
	const lastRecorded = rows[rows.length - 1]?.recordedDate;

	const lastDate = new Date(`${lastRecorded}T00:00:00Z`);
	const todayDateObj = new Date(`${today}T00:00:00Z`);
	const daysSinceLastRecord = (todayDateObj.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
	if (daysSinceLastRecord > 1) return 0;

	let streak = 1;
	for (let i = rows.length - 2; i >= 0; i--) {
		const curr = new Date(`${rows[i + 1]?.recordedDate}T00:00:00Z`);
		const prev = new Date(`${rows[i]?.recordedDate}T00:00:00Z`);
		const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
		if (diffDays === 1) {
			streak++;
		} else {
			break;
		}
	}

	return streak;
}

/** 累計活動数を取得 */
function getTotalActivityCount(childId: number): number {
	const result = db
		.select({ total: count() })
		.from(activityLogs)
		.where(and(eq(activityLogs.childId, childId), eq(activityLogs.cancelled, 0)))
		.get();
	return result?.total ?? 0;
}

/** 1日で最大何カテゴリ記録したかを取得 */
function getMaxCategoryCountInDay(childId: number): number {
	const rows = db
		.select({
			recordedDate: activityLogs.recordedDate,
			categoryCount: countDistinct(activities.categoryId),
		})
		.from(activityLogs)
		.innerJoin(activities, eq(activityLogs.activityId, activities.id))
		.where(and(eq(activityLogs.childId, childId), eq(activityLogs.cancelled, 0)))
		.groupBy(activityLogs.recordedDate)
		.all();

	return rows.reduce((max, r) => Math.max(max, r.categoryCount), 0);
}

/** 現在レベルを取得 */
function getCurrentLevel(childId: number): number {
	const status = getChildStatus(childId);
	if ('error' in status) return 0;
	return status.level;
}

/** 条件タイプと値から子供向けの説明テキストを生成 */
function getConditionLabel(
	conditionType: string,
	conditionValue: number,
	highestUnlocked: number | null,
): string {
	const prefix = highestUnlocked != null ? 'つぎ: ' : '';
	switch (conditionType) {
		case 'streak_days':
			return `${prefix}${conditionValue}にちれんぞくでかつどう`;
		case 'total_activities':
			return `${prefix}ぜんぶで${conditionValue}かいかつどう`;
		case 'all_categories':
			return '1にちでぜんぶのカテゴリをきろく';
		case 'category_complete':
			return `${prefix}${conditionValue}カテゴリのかつどうをやる`;
		case 'level_reach':
			return `${prefix}レベル${conditionValue}にとうたつ`;
		case 'total_points':
			return `${prefix}${conditionValue}ポイントためる`;
		case 'milestone_event':
			return 'おやがきろくしてくれるよ';
		default:
			return '';
	}
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
			return getMaxStreakDays(childId) >= conditionValue;
		case 'total_activities':
			return getTotalActivityCount(childId) >= conditionValue;
		case 'all_categories':
			return checkAllCategories(childId);
		case 'category_complete':
			return getDistinctCategoryCount(childId) >= conditionValue;
		case 'level_reach':
			return getCurrentLevel(childId) >= conditionValue;
		case 'total_points':
			return getBalance(childId) >= conditionValue;
		default:
			return false;
	}
}

/** 累計で記録した異なるカテゴリ数を取得 */
function getDistinctCategoryCount(childId: number): number {
	const result = db
		.select({
			count: countDistinct(activities.categoryId),
		})
		.from(activityLogs)
		.innerJoin(activities, eq(activityLogs.activityId, activities.id))
		.where(and(eq(activityLogs.childId, childId), eq(activityLogs.cancelled, 0)))
		.get();

	return result?.count ?? 0;
}

/** 全5カテゴリに記録がある日が存在するかチェック */
function checkAllCategories(childId: number): boolean {
	const rows = db
		.select({
			recordedDate: activityLogs.recordedDate,
			categoryCount: countDistinct(activities.categoryId),
		})
		.from(activityLogs)
		.innerJoin(activities, eq(activityLogs.activityId, activities.id))
		.where(and(eq(activityLogs.childId, childId), eq(activityLogs.cancelled, 0)))
		.groupBy(activityLogs.recordedDate)
		.all();

	return rows.some((r) => r.categoryCount >= CATEGORY_DEFS.length);
}
