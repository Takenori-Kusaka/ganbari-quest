import { redirect } from '@sveltejs/kit';
import { carryTrialStartedQuery } from '$lib/domain/trial-started-notice';
import type { PageServerLoad } from './$types';

// #0262: PIN設定はセットアップから除去。/setup は子供登録に直接リダイレクト
export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.context) {
		redirect(302, '/auth/login');
	}
	// 告知の旗だけ次の hop へ運ぶ (ここで落とすと 1 度きりの告知が二度と出せない)
	redirect(302, `/setup/children${carryTrialStartedQuery(url.search)}`);
};
