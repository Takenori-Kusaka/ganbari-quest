import type { AvatarCategory } from '$lib/domain/validation/avatar';
import { AVATAR_CATEGORIES } from '$lib/domain/validation/avatar';
import { getBalance } from '$lib/server/db/point-repo';
import {
	checkAndUnlockItems,
	equipItem,
	getAvatarConfig,
	getShopItems,
	purchaseItem,
} from '$lib/server/services/avatar-service';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { child } = await parent();
	if (!child) return { items: [], balance: 0, avatarConfig: null };

	// 自動解放チェック（無料・レベル条件）
	checkAndUnlockItems(child.id);

	const items = getShopItems(child.id);
	const balance = getBalance(child.id);
	const avatarConfig = getAvatarConfig(child.id);
	return { items, balance, avatarConfig };
};

export const actions: Actions = {
	purchase: async ({ request, cookies }) => {
		const childId = Number(cookies.get('selectedChildId'));
		if (!childId) return fail(401);

		const formData = await request.formData();
		const itemId = Number(formData.get('itemId'));
		if (!itemId) return fail(400, { error: 'アイテムが選択されていません' });

		const result = purchaseItem(childId, itemId);
		if ('error' in result) {
			const messages: Record<string, string> = {
				NOT_FOUND: 'アイテムが見つかりません',
				ALREADY_OWNED: 'すでに持っています',
				LOCKED: 'まだ手に入れられません',
				INSUFFICIENT_POINTS: 'ポイントがたりません',
			};
			return fail(400, { error: messages[result.error] ?? result.error });
		}
		return { success: true, purchased: true };
	},
	equip: async ({ request, cookies }) => {
		const childId = Number(cookies.get('selectedChildId'));
		if (!childId) return fail(401);

		const formData = await request.formData();
		const itemId = Number(formData.get('itemId'));
		const category = formData.get('category') as string;
		if (!itemId || !AVATAR_CATEGORIES.includes(category as AvatarCategory)) {
			return fail(400, { error: '無効なリクエストです' });
		}

		const result = equipItem(childId, category as AvatarCategory, itemId);
		if ('error' in result) return fail(400, { error: result.error });
		return { success: true, equipped: true };
	},
	unequip: async ({ request, cookies }) => {
		const childId = Number(cookies.get('selectedChildId'));
		if (!childId) return fail(401);

		const formData = await request.formData();
		const category = formData.get('category') as string;
		if (!AVATAR_CATEGORIES.includes(category as AvatarCategory)) {
			return fail(400, { error: '無効なカテゴリです' });
		}

		equipItem(childId, category as AvatarCategory, null);
		return { success: true, unequipped: true };
	},
};
