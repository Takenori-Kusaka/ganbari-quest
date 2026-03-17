import { getActiveTitle, getChildTitles, setActiveTitle } from '$lib/server/services/title-service';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { child } = await parent();
	if (!child) return { titles: [], activeTitle: null };

	const titles = getChildTitles(child.id);
	const activeTitle = getActiveTitle(child.id);
	return { titles, activeTitle };
};

export const actions: Actions = {
	setActive: async ({ request, cookies }) => {
		const childId = Number(cookies.get('selectedChildId'));
		if (!childId) return fail(401);

		const formData = await request.formData();
		const titleId = Number(formData.get('titleId'));
		if (!titleId) return fail(400);

		const result = setActiveTitle(childId, titleId);
		if ('error' in result) return fail(400, { error: result.error });
		return { success: true };
	},
	unset: async ({ cookies }) => {
		const childId = Number(cookies.get('selectedChildId'));
		if (!childId) return fail(401);

		setActiveTitle(childId, null);
		return { success: true };
	},
};
