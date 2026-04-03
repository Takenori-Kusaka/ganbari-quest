// src/lib/server/services/custom-achievement-service.ts
// カスタム実績サービス — 条件判定・作成・進捗管理

import {
	countCustomAchievements,
	deleteCustomAchievement,
	findCustomAchievements,
	insertCustomAchievement,
	unlockCustomAchievement,
} from '$lib/server/db/custom-achievement-repo';
import type {
	CustomAchievement,
	CustomAchievementConditionType,
	InsertCustomAchievementInput,
} from '$lib/server/db/types';
import { logger } from '$lib/server/logger';

// ============================================================
// Plan Limits
// ============================================================

const PLAN_LIMITS: Record<string, { achievements: number }> = {
	free: { achievements: 0 },
	standard: { achievements: 10 },
	family: { achievements: 999 },
};

const FREE_LIMITS = { achievements: 0 };

export function getCustomLimits(planTier: string): { achievements: number } {
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

// ============================================================
// Auto-check and unlock
// ============================================================

export interface UnlockedCustomItem {
	type: 'achievement';
	id: number;
	name: string;
	icon: string;
	bonusPoints: number;
}

/**
 * Check and unlock custom achievements for a child.
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

	} catch (e) {
		logger.warn('[custom-achievement] Check failed', {
			context: { childId, error: String(e) },
		});
	}

	return unlocked;
}
