import type { ChildId } from '$lib/domain/ids';
// src/lib/server/db/image-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type { InsertCharacterImageInput } from './types';

export async function findCachedImage(
	childId: ChildId,
	type: string,
	promptHash: string,
	tenantId: string,
) {
	return getRepos().image.findCachedImage(childId, type, promptHash, tenantId);
}
export async function insertCharacterImage(input: InsertCharacterImageInput, tenantId: string) {
	return getRepos().image.insertCharacterImage(input, tenantId);
}
export async function updateChildAvatarUrl(
	childId: ChildId,
	avatarUrl: string | null,
	tenantId: string,
) {
	return getRepos().image.updateChildAvatarUrl(childId, avatarUrl, tenantId);
}
export async function findChildForImage(childId: ChildId, tenantId: string) {
	return getRepos().image.findChildForImage(childId, tenantId);
}
