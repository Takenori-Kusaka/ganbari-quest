import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ parent }) => {
	const { uiMode } = await parent();
	if (uiMode === 'baby') {
		redirect(302, '/baby/home');
	}
};
