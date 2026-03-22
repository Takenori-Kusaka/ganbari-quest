import { getChildById } from '$lib/server/services/child-service';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
	const childIdStr = cookies.get('selectedChildId');
	if (childIdStr) {
		const child = await getChildById(Number(childIdStr));
		if (child) {
			const uiMode = child.uiMode ?? 'kinder';
			redirect(302, `/${uiMode}/home`);
		}
	}
	redirect(302, '/switch');
};
