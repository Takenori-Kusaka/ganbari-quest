import { db } from '$lib/server/db';
import { achievements, childAchievements } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

/** 全実績マスタを取得 */
export function findAllAchievements() {
	return db.select().from(achievements).all();
}

/** コードで実績を1件取得 */
export function findAchievementByCode(code: string) {
	return db.select().from(achievements).where(eq(achievements.code, code)).get();
}

/** 子供の解除済み実績IDセットを取得 */
export function findUnlockedAchievementIds(childId: number): Set<number> {
	const rows = db
		.select({ achievementId: childAchievements.achievementId })
		.from(childAchievements)
		.where(eq(childAchievements.childId, childId))
		.all();
	return new Set(rows.map((r) => r.achievementId));
}

/** 子供の解除済み実績（詳細付き）を取得 */
export function findUnlockedAchievements(childId: number) {
	return db
		.select({
			achievementId: childAchievements.achievementId,
			unlockedAt: childAchievements.unlockedAt,
		})
		.from(childAchievements)
		.where(eq(childAchievements.childId, childId))
		.all();
}

/** 実績解除を記録 */
export function insertChildAchievement(childId: number, achievementId: number) {
	return db.insert(childAchievements).values({ childId, achievementId }).returning().get();
}
