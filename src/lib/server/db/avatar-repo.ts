// src/lib/server/db/avatar-repo.ts — Facade (delegates to factory)

import type { AvatarCategory } from '$lib/domain/validation/avatar';
import { getRepos } from './factory';

export async function findAllAvatarItems() {
	return getRepos().avatar.findAllAvatarItems();
}
export async function findAvatarItemsByCategory(category: AvatarCategory) {
	return getRepos().avatar.findAvatarItemsByCategory(category);
}
export async function findAvatarItemById(itemId: number) {
	return getRepos().avatar.findAvatarItemById(itemId);
}
export async function findOwnedItems(childId: number) {
	return getRepos().avatar.findOwnedItems(childId);
}
export async function isItemOwned(childId: number, itemId: number) {
	return getRepos().avatar.isItemOwned(childId, itemId);
}
export async function insertChildAvatarItem(childId: number, itemId: number) {
	return getRepos().avatar.insertChildAvatarItem(childId, itemId);
}
export async function getActiveAvatarIds(childId: number) {
	return getRepos().avatar.getActiveAvatarIds(childId);
}
export async function setActiveAvatar(
	childId: number,
	category: AvatarCategory,
	itemId: number | null,
) {
	return getRepos().avatar.setActiveAvatar(childId, category, itemId);
}
