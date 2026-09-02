import { fail, redirect } from '@sveltejs/kit';
import { asChildId } from '$lib/domain/ids';
import { CHILD_ACTION_ERROR_LABELS } from '$lib/domain/labels';
import { requireValidChildCookieFormat } from '$lib/server/auth/child-cookie-guard';
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
		// #3581 ②: dsql backend の stale/非 uuid cookie を cookie clear + /switch redirect に正規化。
		const childId = asChildId(requireValidChildCookieFormat(cookies, 'route.initial-points.grant'));
		if (!childId) return fail(400, { error: CHILD_ACTION_ERROR_LABELS.invalidInput });

		const formData = await request.formData();
		const points = Number(formData.get('points'));

		if (Number.isNaN(points))
			return fail(400, { error: CHILD_ACTION_ERROR_LABELS.pointsNotNumber });

		const result = await grantInitialPoints(childId, points, tenantId);
		if ('error' in result) {
			if (result.error === 'INVALID_AMOUNT')
				return fail(400, { error: CHILD_ACTION_ERROR_LABELS.pointsOutOfRange(1, 10000) });
			return fail(404, { error: 'みつかりません' });
		}

		return { success: true, balance: result.balance };
	},
};
