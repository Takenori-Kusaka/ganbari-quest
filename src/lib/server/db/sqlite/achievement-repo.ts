import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../client';
import { achievements, childAchievements } from '../schema';

/** 全実績マスタを取得 */
export async function findAllAchievements(_tenantId: string) {
	return db.select().from(achievements).all();
}

/** コードで実績を1件取得 */
export async function findAchievementByCode(code: string, _tenantId: string) {
	return db.select().from(achievements).where(eq(achievements.code, code)).get();
}

/** 子供の解除済み実績（全レコード、マイルストーン含む）を取得 */
export async function findUnlockedAchievements(childId: number, _tenantId: string) {
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
export async function findUnlockedAchievementIds(
	childId: number,
	_tenantId: string,
): Promise<Set<number>> {
	const rows = db
		.select({ achievementId: childAchievements.achievementId })
		.from(childAchievements)
		.where(eq(childAchievements.childId, childId))
		.all();
	return new Set(rows.map((r) => r.achievementId));
}

/** 特定の実績+マイルストーン値が解除済みか確認 */
export async function isAchievementUnlocked(
	childId: number,
	achievementId: number,
	milestoneValue: number | null,
	_tenantId: string,
): Promise<boolean> {
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
export async function insertChildAchievement(
	childId: number,
	achievementId: number,
	_tenantId: string,
	milestoneValue?: number | null,
) {
	return db
		.insert(childAchievements)
		.values({ childId, achievementId, milestoneValue: milestoneValue ?? null })
		.returning()
		.get();
}
