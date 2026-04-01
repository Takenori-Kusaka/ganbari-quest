import { activityPackIndex } from '$lib/data/activity-packs';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return {
		packs: activityPackIndex.packs,
	};
};
