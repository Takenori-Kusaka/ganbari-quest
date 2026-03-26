import { and, eq } from 'drizzle-orm';
import { db } from '../client';
import { childTitles, children, titles } from '../schema';

/** 全称号マスタを取得 */
export async function findAllTitles(_tenantId: string) {
	return db.select().from(titles).all();
}

/** IDで称号を取得 */
export async function findTitleById(id: number, _tenantId: string) {
	return db.select().from(titles).where(eq(titles.id, id)).get();
}

/** 子供の解除済み称号を取得 */
export async function findUnlockedTitles(childId: number, _tenantId: string) {
	return db
		.select({
			titleId: childTitles.titleId,
			unlockedAt: childTitles.unlockedAt,
		})
		.from(childTitles)
		.where(eq(childTitles.childId, childId))
		.all();
}

/** 特定の称号が解除済みか確認 */
export async function isTitleUnlocked(
	childId: number,
	titleId: number,
	_tenantId: string,
): Promise<boolean> {
	const row = db
		.select({ id: childTitles.id })
		.from(childTitles)
		.where(and(eq(childTitles.childId, childId), eq(childTitles.titleId, titleId)))
		.get();
	return !!row;
}

/** 称号解除を記録 */
export async function insertChildTitle(childId: number, titleId: number, _tenantId: string) {
	return db.insert(childTitles).values({ childId, titleId }).returning().get();
}

/** アクティブ称号IDを取得 */
export async function getActiveTitleId(childId: number, _tenantId: string): Promise<number | null> {
	const child = db
		.select({ activeTitleId: children.activeTitleId })
		.from(children)
		.where(eq(children.id, childId))
		.get();
	return child?.activeTitleId ?? null;
}

/** アクティブ称号を設定（nullで解除） */
export async function setActiveTitleId(childId: number, titleId: number | null, _tenantId: string) {
	await db.update(children).set({ activeTitleId: titleId }).where(eq(children.id, childId)).run();
}
