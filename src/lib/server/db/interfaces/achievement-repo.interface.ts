import type { Achievement, ChildAchievement } from '../types';

export interface IAchievementRepo {
	findAllAchievements(): Promise<Achievement[]>;
	findAchievementByCode(code: string): Promise<Achievement | undefined>;
	findUnlockedAchievements(
		childId: number,
	): Promise<{ achievementId: number; milestoneValue: number | null; unlockedAt: string }[]>;
	findUnlockedAchievementIds(childId: number): Promise<Set<number>>;
	isAchievementUnlocked(
		childId: number,
		achievementId: number,
		milestoneValue: number | null,
	): Promise<boolean>;
	insertChildAchievement(
		childId: number,
		achievementId: number,
		milestoneValue?: number | null,
	): Promise<ChildAchievement>;
}
