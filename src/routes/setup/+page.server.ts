import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// #0262: PIN設定はセットアップから除去。/setup は子供登録に直接リダイレクト
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.context) {
		redirect(302, '/auth/login');
	}
	redirect(302, '/setup/children');
};
