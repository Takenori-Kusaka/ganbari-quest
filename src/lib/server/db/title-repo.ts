import { db } from '$lib/server/db';
import { childTitles, children, titles } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';

/** 全称号マスタを取得 */
export function findAllTitles() {
	return db.select().from(titles).all();
}

/** 子供の解除済み称号を取得 */
export function findUnlockedTitles(childId: number) {
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
export function isTitleUnlocked(childId: number, titleId: number): boolean {
	const row = db
		.select({ id: childTitles.id })
		.from(childTitles)
		.where(and(eq(childTitles.childId, childId), eq(childTitles.titleId, titleId)))
		.get();
	return !!row;
}

/** 称号解除を記録 */
export function insertChildTitle(childId: number, titleId: number) {
	return db.insert(childTitles).values({ childId, titleId }).returning().get();
}

/** アクティブ称号IDを取得 */
export function getActiveTitleId(childId: number): number | null {
	const child = db
		.select({ activeTitleId: children.activeTitleId })
		.from(children)
		.where(eq(children.id, childId))
		.get();
	return child?.activeTitleId ?? null;
}

/** アクティブ称号を設定（nullで解除） */
export function setActiveTitleId(childId: number, titleId: number | null) {
	return db.update(children).set({ activeTitleId: titleId }).where(eq(children.id, childId)).run();
}
