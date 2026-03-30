import { DEFAULT_POINT_SETTINGS } from '$lib/domain/point-display';
import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import { getDemoAdminData } from '$lib/server/demo/demo-service.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const adminData = getDemoAdminData();

	return {
		activities: adminData.activities,
		categoryDefs: CATEGORY_DEFS,
		pointSettings: DEFAULT_POINT_SETTINGS,
	};
};
