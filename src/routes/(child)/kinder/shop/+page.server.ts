import type { AvatarCategory } from '$lib/domain/validation/avatar';
import { AVATAR_CATEGORIES } from '$lib/domain/validation/avatar';
import { requireTenantId } from '$lib/server/auth/factory';
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

export const load: PageServerLoad = async ({ parent, locals }) => {
	const tenantId = requireTenantId(locals);
	const { child } = await parent();
	if (!child) return { items: [], balance: 0, avatarConfig: null };

	// 自動解放チェック（無料・レベル条件）
	await checkAndUnlockItems(child.id, tenantId);

	const items = await getShopItems(child.id, tenantId);
	const balance = await getBalance(child.id, tenantId);
	const avatarConfig = await getAvatarConfig(child.id, tenantId);
	return { items, balance, avatarConfig };
};

export const actions: Actions = {
	purchase: async ({ request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const childId = Number(cookies.get('selectedChildId'));
		if (!childId) return fail(401);

		const formData = await request.formData();
		const itemId = Number(formData.get('itemId'));
		if (!itemId) return fail(400, { error: 'アイテムが選択されていません' });

		const result = await purchaseItem(childId, itemId, tenantId);
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
	equip: async ({ request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const childId = Number(cookies.get('selectedChildId'));
		if (!childId) return fail(401);

		const formData = await request.formData();
		const itemId = Number(formData.get('itemId'));
		const category = formData.get('category') as string;
		if (!itemId || !AVATAR_CATEGORIES.includes(category as AvatarCategory)) {
			return fail(400, { error: '無効なリクエストです' });
		}

		const result = await equipItem(childId, category as AvatarCategory, itemId, tenantId);
		if ('error' in result) return fail(400, { error: result.error });
		return { success: true, equipped: true };
	},
	unequip: async ({ request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const childId = Number(cookies.get('selectedChildId'));
		if (!childId) return fail(401);

		const formData = await request.formData();
		const category = formData.get('category') as string;
		if (!AVATAR_CATEGORIES.includes(category as AvatarCategory)) {
			return fail(400, { error: '無効なカテゴリです' });
		}

		await equipItem(childId, category as AvatarCategory, null, tenantId);
		return { success: true, unequipped: true };
	},
};
