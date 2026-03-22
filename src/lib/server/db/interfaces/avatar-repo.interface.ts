import type { AvatarCategory } from '$lib/domain/validation/avatar';
import type { AvatarItem, ChildAvatarItem } from '../types';

export interface IAvatarRepo {
	findAllAvatarItems(): Promise<AvatarItem[]>;
	findAvatarItemsByCategory(category: AvatarCategory): Promise<AvatarItem[]>;
	findAvatarItemById(itemId: number): Promise<AvatarItem | undefined>;
	findOwnedItems(childId: number): Promise<{ avatarItemId: number; acquiredAt: string }[]>;
	isItemOwned(childId: number, itemId: number): Promise<boolean>;
	insertChildAvatarItem(childId: number, itemId: number): Promise<ChildAvatarItem>;
	getActiveAvatarIds(childId: number): Promise<{
		bgId: number | null;
		frameId: number | null;
		effectId: number | null;
	}>;
	setActiveAvatar(childId: number, category: AvatarCategory, itemId: number | null): Promise<void>;
}
