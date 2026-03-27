// src/lib/server/db/avatar-repo.ts
// きせかえアバター リポジトリ層

import type { AvatarCategory } from '$lib/domain/validation/avatar';
import { and, eq } from 'drizzle-orm';
import { db } from '../client';
import { avatarItems, childAvatarItems, children } from '../schema';

/** 全アイテムマスタを取得 */
export async function findAllAvatarItems(_tenantId: string) {
	return db
		.select()
		.from(avatarItems)
		.where(eq(avatarItems.isActive, 1))
		.orderBy(avatarItems.category, avatarItems.sortOrder)
		.all();
}

/** カテゴリ別アイテム取得 */
export async function findAvatarItemsByCategory(category: AvatarCategory, _tenantId: string) {
	return db
		.select()
		.from(avatarItems)
		.where(and(eq(avatarItems.category, category), eq(avatarItems.isActive, 1)))
		.orderBy(avatarItems.sortOrder)
		.all();
}

/** アイテム単体取得 */
export async function findAvatarItemById(itemId: number, _tenantId: string) {
	return db.select().from(avatarItems).where(eq(avatarItems.id, itemId)).get();
}

/** 子供の所持アイテム一覧 */
export async function findOwnedItems(childId: number, _tenantId: string) {
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
export async function isItemOwned(
	childId: number,
	itemId: number,
	_tenantId: string,
): Promise<boolean> {
	const row = db
		.select({ id: childAvatarItems.id })
		.from(childAvatarItems)
		.where(and(eq(childAvatarItems.childId, childId), eq(childAvatarItems.avatarItemId, itemId)))
		.get();
	return !!row;
}

/** アイテム付与 */
export async function insertChildAvatarItem(childId: number, itemId: number, _tenantId: string) {
	return db.insert(childAvatarItems).values({ childId, avatarItemId: itemId }).returning().get();
}

/** 装備中のアバター設定を取得 */
export async function getActiveAvatarIds(childId: number, _tenantId: string) {
	const child = db
		.select({
			activeAvatarBg: children.activeAvatarBg,
			activeAvatarFrame: children.activeAvatarFrame,
			activeAvatarEffect: children.activeAvatarEffect,
			activeAvatarSound: children.activeAvatarSound,
			activeAvatarCelebration: children.activeAvatarCelebration,
		})
		.from(children)
		.where(eq(children.id, childId))
		.get();
	return {
		bgId: child?.activeAvatarBg ?? null,
		frameId: child?.activeAvatarFrame ?? null,
		effectId: child?.activeAvatarEffect ?? null,
		soundId: child?.activeAvatarSound ?? null,
		celebrationId: child?.activeAvatarCelebration ?? null,
	};
}

/** 装備変更 */
export async function setActiveAvatar(
	childId: number,
	category: AvatarCategory,
	itemId: number | null,
	_tenantId: string,
) {
	const fieldMap: Record<
		AvatarCategory,
		| 'activeAvatarBg'
		| 'activeAvatarFrame'
		| 'activeAvatarEffect'
		| 'activeAvatarSound'
		| 'activeAvatarCelebration'
	> = {
		background: 'activeAvatarBg',
		frame: 'activeAvatarFrame',
		effect: 'activeAvatarEffect',
		sound: 'activeAvatarSound',
		celebration: 'activeAvatarCelebration',
	};
	const field = fieldMap[category];
	await db
		.update(children)
		.set({ [field]: itemId })
		.where(eq(children.id, childId))
		.run();
}
