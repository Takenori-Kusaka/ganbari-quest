// src/lib/server/services/custom-achievement-service.ts
// カスタム実績・称号サービス — 条件判定・作成・進捗管理

import {
	countCustomAchievements,
	countCustomTitles,
	deleteCustomAchievement,
	deleteCustomTitle,
	equipCustomTitle,
	findCustomAchievements,
	findCustomTitles,
	insertCustomAchievement,
	insertCustomTitle,
	unlockCustomAchievement,
	unlockCustomTitle,
} from '$lib/server/db/custom-achievement-repo';
import type {
	CustomAchievement,
	CustomAchievementConditionType,
	CustomTitle,
	CustomTitleConditionType,
	InsertCustomAchievementInput,
	InsertCustomTitleInput,
} from '$lib/server/db/types';
import { logger } from '$lib/server/logger';

// ============================================================
// Plan Limits
// ============================================================

const PLAN_LIMITS: Record<string, { achievements: number; titles: number }> = {
	free: { achievements: 0, titles: 0 },
	standard: { achievements: 10, titles: 5 },
	family: { achievements: 999, titles: 999 },
};

const FREE_LIMITS = { achievements: 0, titles: 0 };

export function getCustomLimits(planTier: string): { achievements: number; titles: number } {
	return PLAN_LIMITS[planTier] ?? FREE_LIMITS;
}

// ============================================================
// CRUD — Custom Achievements
// ============================================================

export async function createCustomAchievement(
	input: InsertCustomAchievementInput,
	tenantId: string,
	planTier: string,
): Promise<CustomAchievement | { error: 'LIMIT_REACHED' | 'INVALID_INPUT' }> {
	if (!input.name?.trim() || !input.conditionValue || input.conditionValue <= 0) {
		return { error: 'INVALID_INPUT' };
	}

	const limits = getCustomLimits(planTier);
	const count = await countCustomAchievements(tenantId);
	if (count >= limits.achievements) {
		return { error: 'LIMIT_REACHED' };
	}

	return insertCustomAchievement(input, tenantId);
}

export async function getCustomAchievementsForChild(
	childId: number,
	tenantId: string,
): Promise<CustomAchievement[]> {
	return findCustomAchievements(childId, tenantId);
}

export async function removeCustomAchievement(id: number, tenantId: string): Promise<boolean> {
	return deleteCustomAchievement(id, tenantId);
}

// ============================================================
// CRUD — Custom Titles
// ============================================================

export async function createCustomTitle(
	input: InsertCustomTitleInput,
	tenantId: string,
	planTier: string,
): Promise<CustomTitle | { error: 'LIMIT_REACHED' | 'INVALID_INPUT' }> {
	if (!input.name?.trim() || !input.conditionValue || input.conditionValue <= 0) {
		return { error: 'INVALID_INPUT' };
	}

	const limits = getCustomLimits(planTier);
	const count = await countCustomTitles(tenantId);
	if (count >= limits.titles) {
		return { error: 'LIMIT_REACHED' };
	}

	return insertCustomTitle(input, tenantId);
}

export async function getCustomTitlesForChild(
	childId: number,
	tenantId: string,
): Promise<CustomTitle[]> {
	return findCustomTitles(childId, tenantId);
}

export async function removeCustomTitle(id: number, tenantId: string): Promise<boolean> {
	return deleteCustomTitle(id, tenantId);
}

export async function setEquippedTitle(
	childId: number,
	titleId: number,
	tenantId: string,
): Promise<void> {
	return equipCustomTitle(childId, titleId, tenantId);
}

// ============================================================
// Condition Checking — Progress Calculation
// ============================================================

interface ProgressData {
	totalActivityCount: number;
	activityCounts: Record<number, number>; // activityId → count
	categoryCounts: Record<number, number>; // categoryId → count
	maxStreakDays: number;
	activityStreaks: Record<number, number>; // activityId → streak days
	currentLevel: number;
	achievementCount: number;
}

export function getAchievementProgress(
	achievement: CustomAchievement,
	data: ProgressData,
): { current: number; target: number; complete: boolean } {
	const target = achievement.conditionValue;
	let current = 0;

	switch (achievement.conditionType as CustomAchievementConditionType) {
		case 'total_count':
			current = data.totalActivityCount;
			break;
		case 'activity_count':
			current = achievement.conditionActivityId
				? (data.activityCounts[achievement.conditionActivityId] ?? 0)
				: 0;
			break;
		case 'category_count':
			current = achievement.conditionCategoryId
				? (data.categoryCounts[achievement.conditionCategoryId] ?? 0)
				: 0;
			break;
		case 'streak_days':
			current = data.maxStreakDays;
			break;
		case 'activity_streak':
			current = achievement.conditionActivityId
				? (data.activityStreaks[achievement.conditionActivityId] ?? 0)
				: 0;
			break;
	}

	return { current: Math.min(current, target), target, complete: current >= target };
}

export function getTitleProgress(
	title: CustomTitle,
	data: ProgressData,
): { current: number; target: number; complete: boolean } {
	const target = title.conditionValue;
	let current = 0;

	switch (title.conditionType as CustomTitleConditionType) {
		case 'level_reach':
			current = data.currentLevel;
			break;
		case 'achievement_count':
			current = data.achievementCount;
			break;
		case 'activity_count':
			current = title.conditionActivityId
				? (data.activityCounts[title.conditionActivityId] ?? 0)
				: data.totalActivityCount;
			break;
		case 'streak_days':
			current = data.maxStreakDays;
			break;
	}

	return { current: Math.min(current, target), target, complete: current >= target };
}

// ============================================================
// Auto-check and unlock
// ============================================================

export interface UnlockedCustomItem {
	type: 'achievement' | 'title';
	id: number;
	name: string;
	icon: string;
	bonusPoints: number;
}

/**
 * Check and unlock custom achievements/titles for a child.
 * Called from activity-log-service after each activity record.
 */
export async function checkAndUnlockCustomItems(
	childId: number,
	tenantId: string,
	data: ProgressData,
): Promise<UnlockedCustomItem[]> {
	const unlocked: UnlockedCustomItem[] = [];

	try {
		const achievements = await findCustomAchievements(childId, tenantId);
		for (const a of achievements) {
			if (a.unlockedAt) continue; // already unlocked
			const progress = getAchievementProgress(a, data);
			if (progress.complete) {
				await unlockCustomAchievement(a.id, tenantId);
				unlocked.push({
					type: 'achievement',
					id: a.id,
					name: a.name,
					icon: a.icon,
					bonusPoints: a.bonusPoints,
				});
				logger.info('[custom-achievement] Unlocked', {
					context: { childId, achievementId: a.id, name: a.name },
				});
			}
		}

		const titles = await findCustomTitles(childId, tenantId);
		for (const t of titles) {
			if (t.unlockedAt) continue;
			const progress = getTitleProgress(t, data);
			if (progress.complete) {
				await unlockCustomTitle(t.id, tenantId);
				unlocked.push({
					type: 'title',
					id: t.id,
					name: t.name,
					icon: t.icon,
					bonusPoints: 0,
				});
				logger.info('[custom-title] Unlocked', {
					context: { childId, titleId: t.id, name: t.name },
				});
			}
		}
	} catch (e) {
		logger.warn('[custom-achievement] Check failed', {
			context: { childId, error: String(e) },
		});
	}

	return unlocked;
}
