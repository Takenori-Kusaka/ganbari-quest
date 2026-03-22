import type { CharacterImage, Child, InsertCharacterImageInput } from '../types';

export interface IImageRepo {
	findCachedImage(
		childId: number,
		type: string,
		promptHash: string,
	): Promise<CharacterImage | undefined>;
	insertCharacterImage(input: InsertCharacterImageInput): Promise<void>;
	updateChildAvatarUrl(childId: number, avatarUrl: string): Promise<void>;
	findChildForImage(childId: number): Promise<Child | undefined>;
}
