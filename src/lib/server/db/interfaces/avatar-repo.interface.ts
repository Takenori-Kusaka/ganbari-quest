import type { AvatarCategory } from '$lib/domain/validation/avatar';
import type { AvatarItem, ChildAvatarItem } from '../types';

export interface IAvatarRepo {
	findAllAvatarItems(tenantId: string): Promise<AvatarItem[]>;
	findAvatarItemsByCategory(category: AvatarCategory, tenantId: string): Promise<AvatarItem[]>;
	findAvatarItemById(itemId: number, tenantId: string): Promise<AvatarItem | undefined>;
	findOwnedItems(
		childId: number,
		tenantId: string,
	): Promise<{ avatarItemId: number; acquiredAt: string }[]>;
	isItemOwned(childId: number, itemId: number, tenantId: string): Promise<boolean>;
	insertChildAvatarItem(
		childId: number,
		itemId: number,
		tenantId: string,
	): Promise<ChildAvatarItem>;
	getActiveAvatarIds(
		childId: number,
		tenantId: string,
	): Promise<{
		bgId: number | null;
		frameId: number | null;
		effectId: number | null;
	}>;
	setActiveAvatar(
		childId: number,
		category: AvatarCategory,
		itemId: number | null,
		tenantId: string,
	): Promise<void>;
}
