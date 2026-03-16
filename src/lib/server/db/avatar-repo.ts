// src/lib/server/db/avatar-repo.ts
// きせかえアバター リポジトリ層

import { db } from '$lib/server/db';
import { avatarItems, childAvatarItems, children } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import type { AvatarCategory } from '$lib/domain/validation/avatar';

/** 全アイテムマスタを取得 */
export function findAllAvatarItems() {
	return db
		.select()
		.from(avatarItems)
		.where(eq(avatarItems.isActive, 1))
		.orderBy(avatarItems.category, avatarItems.sortOrder)
		.all();
}

/** カテゴリ別アイテム取得 */
export function findAvatarItemsByCategory(category: AvatarCategory) {
	return db
		.select()
		.from(avatarItems)
		.where(and(eq(avatarItems.category, category), eq(avatarItems.isActive, 1)))
		.orderBy(avatarItems.sortOrder)
		.all();
}

/** アイテム単体取得 */
export function findAvatarItemById(itemId: number) {
	return db.select().from(avatarItems).where(eq(avatarItems.id, itemId)).get();
}

/** 子供の所持アイテム一覧 */
export function findOwnedItems(childId: number) {
	return db
		.select({
			avatarItemId: childAvatarItems.avatarItemId,
			acquiredAt: childAvatarItems.acquiredAt,
		})
		.from(childAvatarItems)
		.where(eq(childAvatarItems.childId, childId))
		.all();
}

/** 所持チェック */
export function isItemOwned(childId: number, itemId: number): boolean {
	const row = db
		.select({ id: childAvatarItems.id })
		.from(childAvatarItems)
		.where(
			and(eq(childAvatarItems.childId, childId), eq(childAvatarItems.avatarItemId, itemId)),
		)
		.get();
	return !!row;
}

/** アイテム付与 */
export function insertChildAvatarItem(childId: number, itemId: number) {
	return db
		.insert(childAvatarItems)
		.values({ childId, avatarItemId: itemId })
		.returning()
		.get();
}

/** 装備中のアバター設定を取得 */
export function getActiveAvatarIds(childId: number) {
	const child = db
		.select({
			activeAvatarBg: children.activeAvatarBg,
			activeAvatarFrame: children.activeAvatarFrame,
			activeAvatarEffect: children.activeAvatarEffect,
		})
		.from(children)
		.where(eq(children.id, childId))
		.get();
	return {
		bgId: child?.activeAvatarBg ?? null,
		frameId: child?.activeAvatarFrame ?? null,
		effectId: child?.activeAvatarEffect ?? null,
	};
}

/** 装備変更 */
export function setActiveAvatar(
	childId: number,
	category: AvatarCategory,
	itemId: number | null,
) {
	const fieldMap: Record<AvatarCategory, 'activeAvatarBg' | 'activeAvatarFrame' | 'activeAvatarEffect'> = {
		background: 'activeAvatarBg',
		frame: 'activeAvatarFrame',
		effect: 'activeAvatarEffect',
	};
	const field = fieldMap[category];
	return db
		.update(children)
		.set({ [field]: itemId })
		.where(eq(children.id, childId))
		.run();
}
