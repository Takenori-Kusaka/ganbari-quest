import { db } from '$lib/server/db';
import { achievements, childAchievements } from '$lib/server/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

/** 全実績マスタを取得 */
export function findAllAchievements() {
	return db.select().from(achievements).all();
}

/** コードで実績を1件取得 */
export function findAchievementByCode(code: string) {
	return db.select().from(achievements).where(eq(achievements.code, code)).get();
}

/** 子供の解除済み実績（全レコード、マイルストーン含む）を取得 */
export function findUnlockedAchievements(childId: number) {
	return db
		.select({
			achievementId: childAchievements.achievementId,
			milestoneValue: childAchievements.milestoneValue,
			unlockedAt: childAchievements.unlockedAt,
		})
		.from(childAchievements)
		.where(eq(childAchievements.childId, childId))
		.all();
}

/** 子供の解除済み実績IDセットを取得（非繰り返し実績用） */
export function findUnlockedAchievementIds(childId: number): Set<number> {
	const rows = db
		.select({ achievementId: childAchievements.achievementId })
		.from(childAchievements)
		.where(eq(childAchievements.childId, childId))
		.all();
	return new Set(rows.map((r) => r.achievementId));
}

/** 特定の実績+マイルストーン値が解除済みか確認 */
export function isAchievementUnlocked(
	childId: number,
	achievementId: number,
	milestoneValue: number | null,
): boolean {
	const condition =
		milestoneValue != null
			? and(
					eq(childAchievements.childId, childId),
					eq(childAchievements.achievementId, achievementId),
					eq(childAchievements.milestoneValue, milestoneValue),
				)
			: and(
					eq(childAchievements.childId, childId),
					eq(childAchievements.achievementId, achievementId),
					isNull(childAchievements.milestoneValue),
				);

	const row = db
		.select({ id: childAchievements.id })
		.from(childAchievements)
		.where(condition)
		.get();
	return !!row;
}

/** 実績解除を記録（マイルストーン値付き） */
export function insertChildAchievement(
	childId: number,
	achievementId: number,
	milestoneValue?: number | null,
) {
	return db
		.insert(childAchievements)
		.values({ childId, achievementId, milestoneValue: milestoneValue ?? null })
		.returning()
		.get();
}
