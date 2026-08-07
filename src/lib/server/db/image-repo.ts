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
/**
 * #4466: `avatar_url` を期待した値のままのときだけ更新する (compare-and-set)。
 * 書けたら true、レースに負けて 0 行更新なら false。契約は `IImageRepo` を参照。
 */
export async function updateChildAvatarUrlIfMatches(
	childId: ChildId,
	expectedAvatarUrl: string | null,
	avatarUrl: string | null,
	tenantId: string,
) {
	return getRepos().image.updateChildAvatarUrlIfMatches(
		childId,
		expectedAvatarUrl,
		avatarUrl,
		tenantId,
	);
}
export async function findChildForImage(childId: ChildId, tenantId: string) {
	return getRepos().image.findChildForImage(childId, tenantId);
}
