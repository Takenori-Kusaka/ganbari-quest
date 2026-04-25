import { fail, redirect } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { grantInitialPoints } from '$lib/server/services/point-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { uiMode } = await parent();
	if (uiMode !== 'baby') {
		redirect(302, `/${uiMode}/home`);
	}
};

export const actions: Actions = {
	grant: async ({ request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const childId = Number(cookies.get('selectedChildId'));
		if (Number.isNaN(childId)) return fail(400, { error: 'パラメータが不正です' });

		const formData = await request.formData();
		const points = Number(formData.get('points'));

		if (Number.isNaN(points)) return fail(400, { error: '有効なポイント数を入力してください' });

		const result = await grantInitialPoints(childId, points, tenantId);
		if ('error' in result) {
			if (result.error === 'INVALID_AMOUNT')
				return fail(400, { error: '1〜10000の範囲でポイントを入力してください' });
			return fail(404, { error: 'みつかりません' });
		}

		return { success: true, balance: result.balance };
	},
};
