import { redirect } from '@sveltejs/kit';
import { getDemoBattleData } from '$lib/server/demo/demo-service.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, params }) => {
	const mode = params.mode;
	if (mode === 'baby' || mode === 'preschool') {
		redirect(307, `/demo/${mode}/home`);
	}

	const { child } = await parent();
	if (!child) {
		return getDemoBattleData(0);
	}
	return getDemoBattleData(child.id);
};
