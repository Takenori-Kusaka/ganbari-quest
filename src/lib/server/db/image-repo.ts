// src/lib/server/db/image-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type { InsertCharacterImageInput } from './types';

export async function findCachedImage(childId: number, type: string, promptHash: string) {
	return getRepos().image.findCachedImage(childId, type, promptHash);
}
export async function insertCharacterImage(input: InsertCharacterImageInput) {
	return getRepos().image.insertCharacterImage(input);
}
export async function updateChildAvatarUrl(childId: number, avatarUrl: string) {
	return getRepos().image.updateChildAvatarUrl(childId, avatarUrl);
}
export async function findChildForImage(childId: number) {
	return getRepos().image.findChildForImage(childId);
}
