// src/lib/server/db/image-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type { InsertCharacterImageInput } from './types';

export async function findCachedImage(
	childId: number,
	type: string,
	promptHash: string,
	tenantId: string,
) {
	return getRepos().image.findCachedImage(childId, type, promptHash, tenantId);
}
export async function insertCharacterImage(input: InsertCharacterImageInput, tenantId: string) {
	return getRepos().image.insertCharacterImage(input, tenantId);
}
export async function updateChildAvatarUrl(childId: number, avatarUrl: string, tenantId: string) {
	return getRepos().image.updateChildAvatarUrl(childId, avatarUrl, tenantId);
}
export async function findChildForImage(childId: number, tenantId: string) {
	return getRepos().image.findChildForImage(childId, tenantId);
}
