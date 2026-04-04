import { fail, redirect } from '@sveltejs/kit';
import { getDefaultUiMode } from '$lib/domain/validation/age-tier';
import { requireTenantId } from '$lib/server/auth/factory';
import { addChild, getAllChildren } from '$lib/server/services/child-service';
import { trackSetupFunnel } from '$lib/server/services/setup-funnel-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.context) {
		redirect(302, '/auth/login');
	}
	const tenantId = requireTenantId(locals);
	trackSetupFunnel('setup_start', tenantId);
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

		if (!nickname || nickname.length === 0) {
			return fail(400, { error: 'ニックネームを入力してください' });
		}

		const age = Number(ageStr);
		if (Number.isNaN(age) || age < 0 || age > 18) {
			return fail(400, { error: '年齢は0〜18で入力してください' });
		}

		// #0262: UIモードは年齢から自動判定
		const uiMode = getDefaultUiMode(age);

		await addChild({ nickname, age, theme, uiMode }, tenantId);
		trackSetupFunnel('setup_child_registered', tenantId, { nickname, age, uiMode });
		return { success: true };
	},

	next: async ({ locals }) => {
		const tenantId = requireTenantId(locals);
		const children = await getAllChildren(tenantId);
		if (children.length === 0) {
			return fail(400, { error: '1人以上の子供を登録してください' });
		}
		redirect(302, '/setup/questionnaire');
	},
};
