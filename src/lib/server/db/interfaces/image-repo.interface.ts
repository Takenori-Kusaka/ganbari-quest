import type { CharacterImage, Child, InsertCharacterImageInput } from '../types';

export interface IImageRepo {
	findCachedImage(
		childId: number,
		type: string,
		promptHash: string,
		tenantId: string,
	): Promise<CharacterImage | undefined>;
	insertCharacterImage(input: InsertCharacterImageInput, tenantId: string): Promise<void>;
	updateChildAvatarUrl(childId: number, avatarUrl: string, tenantId: string): Promise<void>;
	findChildForImage(childId: number, tenantId: string): Promise<Child | undefined>;
}
