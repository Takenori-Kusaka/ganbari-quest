import { requireTenantId } from '$lib/server/auth/factory';
import { getActiveTitle, getChildTitles, setActiveTitle } from '$lib/server/services/title-service';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, locals }) => {
	const tenantId = requireTenantId(locals);
	const { child } = await parent();
	if (!child) return { titles: [], activeTitle: null };

	const titles = await getChildTitles(child.id, tenantId);
	const activeTitle = await getActiveTitle(child.id, tenantId);
	return { titles, activeTitle };
};

export const actions: Actions = {
	setActive: async ({ request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const childId = Number(cookies.get('selectedChildId'));
		if (!childId) return fail(401);

		const formData = await request.formData();
		const titleId = Number(formData.get('titleId'));
		if (!titleId) return fail(400);

		const result = await setActiveTitle(childId, titleId, tenantId);
		if ('error' in result) return fail(400, { error: result.error });
		return { success: true };
	},
	unset: async ({ cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const childId = Number(cookies.get('selectedChildId'));
		if (!childId) return fail(401);

		await setActiveTitle(childId, null, tenantId);
		return { success: true };
	},
};
