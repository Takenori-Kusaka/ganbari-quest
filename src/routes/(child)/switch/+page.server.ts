import { getAllChildren } from '$lib/server/services/child-service';
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const children = getAllChildren();
	return { children };
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const formData = await request.formData();
		const childId = formData.get('childId');

		if (!childId) {
			return { error: 'こどもをえらんでね' };
		}

		cookies.set('selectedChildId', String(childId), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 365,
		});

		redirect(303, '/home');
	},
};
