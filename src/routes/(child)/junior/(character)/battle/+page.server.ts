import { loadBattlePage } from '$lib/features/battle/battle-page-load';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, locals }) => {
	return loadBattlePage(parent, locals);
};
