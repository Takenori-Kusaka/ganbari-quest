import { requireTenantId } from '$lib/server/auth/factory';
import { getSetting } from '$lib/server/db/settings-repo';
import { addChild, getAllChildren } from '$lib/server/services/child-service';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
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
		const age = Number(formData.get('age'));
		const theme = formData.get('theme')?.toString() || 'pink';
		const uiMode = formData.get('uiMode')?.toString() || 'kinder';

		if (!nickname || nickname.length === 0) {
			return fail(400, { error: 'ニックネームを入力してください' });
		}
		if (Number.isNaN(age) || age < 0 || age > 18) {
			return fail(400, { error: '年齢は0〜18で入力してください' });
		}

		await addChild({ nickname, age, theme, uiMode }, tenantId);
		return { success: true };
	},

	next: async ({ locals }) => {
		const tenantId = requireTenantId(locals);
		const children = await getAllChildren(tenantId);
		if (children.length === 0) {
			return fail(400, { error: '1人以上の子供を登録してください' });
		}
		redirect(302, '/setup/complete');
	},
};
