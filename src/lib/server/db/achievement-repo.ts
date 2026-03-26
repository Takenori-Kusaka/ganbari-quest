// src/lib/server/db/achievement-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';

export async function findAllAchievements(tenantId: string) {
	return getRepos().achievement.findAllAchievements(tenantId);
}
export async function findAchievementByCode(code: string, tenantId: string) {
	return getRepos().achievement.findAchievementByCode(code, tenantId);
}
export async function findUnlockedAchievements(childId: number, tenantId: string) {
	return getRepos().achievement.findUnlockedAchievements(childId, tenantId);
}
export async function findUnlockedAchievementIds(childId: number, tenantId: string) {
	return getRepos().achievement.findUnlockedAchievementIds(childId, tenantId);
}
export async function isAchievementUnlocked(
	childId: number,
	achievementId: number,
	milestoneValue: number | null,
	tenantId: string,
) {
	return getRepos().achievement.isAchievementUnlocked(
		childId,
		achievementId,
		milestoneValue,
		tenantId,
	);
}
export async function insertChildAchievement(
	childId: number,
	achievementId: number,
	tenantId: string,
	milestoneValue?: number | null,
) {
	return getRepos().achievement.insertChildAchievement(
		childId,
		achievementId,
		tenantId,
		milestoneValue,
	);
}
