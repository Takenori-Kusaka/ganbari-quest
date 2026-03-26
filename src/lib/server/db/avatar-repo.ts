// src/lib/server/db/avatar-repo.ts — Facade (delegates to factory)

import type { AvatarCategory } from '$lib/domain/validation/avatar';
import { getRepos } from './factory';

export async function findAllAvatarItems(tenantId: string) {
	return getRepos().avatar.findAllAvatarItems(tenantId);
}
export async function findAvatarItemsByCategory(category: AvatarCategory, tenantId: string) {
	return getRepos().avatar.findAvatarItemsByCategory(category, tenantId);
}
export async function findAvatarItemById(itemId: number, tenantId: string) {
	return getRepos().avatar.findAvatarItemById(itemId, tenantId);
}
export async function findOwnedItems(childId: number, tenantId: string) {
	return getRepos().avatar.findOwnedItems(childId, tenantId);
}
export async function isItemOwned(childId: number, itemId: number, tenantId: string) {
	return getRepos().avatar.isItemOwned(childId, itemId, tenantId);
}
export async function insertChildAvatarItem(childId: number, itemId: number, tenantId: string) {
	return getRepos().avatar.insertChildAvatarItem(childId, itemId, tenantId);
}
export async function getActiveAvatarIds(childId: number, tenantId: string) {
	return getRepos().avatar.getActiveAvatarIds(childId, tenantId);
}
export async function setActiveAvatar(
	childId: number,
	category: AvatarCategory,
	itemId: number | null,
	tenantId: string,
) {
	return getRepos().avatar.setActiveAvatar(childId, category, itemId, tenantId);
}
