import type { ChildId } from '$lib/domain/ids';
import type { CharacterImage, Child, InsertCharacterImageInput } from '../types';

export interface IImageRepo {
	findCachedImage(
		childId: ChildId,
		type: string,
		promptHash: string,
		tenantId: string,
	): Promise<CharacterImage | undefined>;
	insertCharacterImage(input: InsertCharacterImageInput, tenantId: string): Promise<void>;
	updateChildAvatarUrl(childId: ChildId, avatarUrl: string | null, tenantId: string): Promise<void>;
	findChildForImage(childId: ChildId, tenantId: string): Promise<Child | undefined>;
	deleteByTenantId(tenantId: string, childIds?: readonly ChildId[]): Promise<void>;
}
