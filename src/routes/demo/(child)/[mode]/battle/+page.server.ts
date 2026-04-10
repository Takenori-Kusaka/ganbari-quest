import { getDemoBattleData } from '$lib/server/demo/demo-service.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { child } = await parent();
	if (!child) {
		return getDemoBattleData(0);
	}
	return getDemoBattleData(child.id);
};
