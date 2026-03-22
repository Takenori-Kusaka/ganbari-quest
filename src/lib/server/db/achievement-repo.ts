// src/lib/server/db/achievement-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';

export async function findAllAchievements() {
	return getRepos().achievement.findAllAchievements();
}
export async function findAchievementByCode(code: string) {
	return getRepos().achievement.findAchievementByCode(code);
}
export async function findUnlockedAchievements(childId: number) {
	return getRepos().achievement.findUnlockedAchievements(childId);
}
export async function findUnlockedAchievementIds(childId: number) {
	return getRepos().achievement.findUnlockedAchievementIds(childId);
}
export async function isAchievementUnlocked(
	childId: number,
	achievementId: number,
	milestoneValue: number | null,
) {
	return getRepos().achievement.isAchievementUnlocked(childId, achievementId, milestoneValue);
}
export async function insertChildAchievement(
	childId: number,
	achievementId: number,
	milestoneValue?: number | null,
) {
	return getRepos().achievement.insertChildAchievement(childId, achievementId, milestoneValue);
}
