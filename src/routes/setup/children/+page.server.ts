import { requireTenantId } from '$lib/server/auth/factory';
import { getSetting } from '$lib/server/db/settings-repo';
import { addChild, getAllChildren } from '$lib/server/services/child-service';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.context) {
		redirect(302, '/auth/login');
	}
	const tenantId = requireTenantId(locals);
	// PIN not set -> go back to step 1
	const pinHash = await getSetting('pin_hash', tenantId);
	if (!pinHash) {
		redirect(302, '/setup');
	}

	const children = await getAllChildren(tenantId);
	return { children };
};

export const actions: Actions = {
	addChild: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const nickname = formData.get('nickname')?.toString().trim();
		const ageStr = formData.get('age')?.toString();
		const theme = formData.get('theme')?.toString() || 'pink';
		const uiMode = formData.get('uiMode')?.toString() || 'kinder';
		const birthDate = formData.get('birthDate')?.toString() || null;

		if (!nickname || nickname.length === 0) {
			return fail(400, { error: 'ニックネームを入力してください' });
		}

		if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
			return fail(400, { error: '誕生日の形式が正しくありません（YYYY-MM-DD）' });
		}
		if (birthDate && new Date(birthDate) > new Date()) {
			return fail(400, { error: '未来の日付は設定できません' });
		}

		let age: number;
		if (birthDate) {
			const birth = new Date(birthDate);
			const today = new Date();
			age = today.getFullYear() - birth.getFullYear();
			const m = today.getMonth() - birth.getMonth();
			if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
				age--;
			}
		} else {
			age = Number(ageStr);
			if (Number.isNaN(age) || age < 0 || age > 18) {
				return fail(400, { error: '年齢は0〜18で入力してください' });
			}
		}

		await addChild({ nickname, age, theme, uiMode, birthDate: birthDate ?? undefined }, tenantId);
		return { success: true };
	},

	next: async ({ locals }) => {
		const tenantId = requireTenantId(locals);
		const children = await getAllChildren(tenantId);
		if (children.length === 0) {
			return fail(400, { error: '1人以上の子供を登録してください' });
		}
		redirect(302, '/setup/packs');
	},
};
