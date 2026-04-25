import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ parent, url }) => {
	const { uiMode } = await parent();
	if (uiMode === 'baby') {
		// battle は #1323/#1491 方針に従い 404 で除外
		if (url.pathname.includes('/battle')) {
			error(404, 'このモードではバトルは利用できません');
		}
		redirect(302, '/baby/home');
	}
};
