import type { Achievement, ChildAchievement } from '../types';

export interface IAchievementRepo {
	findAllAchievements(tenantId: string): Promise<Achievement[]>;
	findAchievementByCode(code: string, tenantId: string): Promise<Achievement | undefined>;
	findUnlockedAchievements(
		childId: number,
		tenantId: string,
	): Promise<{ achievementId: number; milestoneValue: number | null; unlockedAt: string }[]>;
	findUnlockedAchievementIds(childId: number, tenantId: string): Promise<Set<number>>;
	isAchievementUnlocked(
		childId: number,
		achievementId: number,
		milestoneValue: number | null,
		tenantId: string,
	): Promise<boolean>;
	insertChildAchievement(
		childId: number,
		achievementId: number,
		tenantId: string,
		milestoneValue?: number | null,
	): Promise<ChildAchievement>;
}
