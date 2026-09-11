import { fail, redirect } from '@sveltejs/kit';
import { asChildId } from '$lib/domain/ids';
import { getChildActionErrorLabels } from '$lib/domain/labels';
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

/**
 * #4716 (QM): 失敗文言を年齢モードで出し分ける (docs/DESIGN.md §8)。
 * 本 route は `[uiMode=uiMode]` 配下なので URL パラメータがそのまま年齢帯になる。
 */
function childErrors(params?: { uiMode?: string }) {
	// 本関数は **失敗経路でしか呼ばれない**。ここで throw すると 400 が 500 に化けて
	// 「入力を直せば済む」拒否が障害に見えるため、uiMode を取れないときは既定 (ひらがな) に落とす。
	return getChildActionErrorLabels(params?.uiMode);
}

export const actions: Actions = {
	grant: async ({ params, request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		// #3581 ②: dsql backend の stale/非 uuid cookie を cookie clear + /switch redirect に正規化。
		const childId = asChildId(requireValidChildCookieFormat(cookies, 'route.initial-points.grant'));
		if (!childId) return fail(400, { error: childErrors(params).invalidInput });

		const formData = await request.formData();
		const points = Number(formData.get('points'));

		if (Number.isNaN(points)) return fail(400, { error: childErrors(params).pointsNotNumber });

		const result = await grantInitialPoints(childId, points, tenantId);
		if ('error' in result) {
			if (result.error === 'INVALID_AMOUNT')
				return fail(400, { error: childErrors(params).pointsOutOfRange(1, 10000) });
			return fail(404, { error: childErrors(params).notFound });
		}

		return { success: true, balance: result.balance };
	},
};
