import { redirect } from '@sveltejs/kit';
import { getChildById } from '$lib/server/services/child-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies, locals }) => {
	const tenantId = locals.context?.tenantId;
	if (!tenantId) {
		// 未認証（Cognito モード等）→ ログインへ
		redirect(302, '/auth/login');
	}
	const childIdStr = cookies.get('selectedChildId');
	if (childIdStr) {
		const child = await getChildById(Number(childIdStr), tenantId);
		if (child) {
			const uiMode = child.uiMode ?? 'kinder';
			redirect(302, `/${uiMode}/home`);
		}
	}
	redirect(302, '/switch');
};
