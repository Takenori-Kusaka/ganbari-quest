import { DEFAULT_POINT_SETTINGS } from '$lib/domain/point-display';
import { getDemoAdminData } from '$lib/server/demo/demo-service.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const adminData = getDemoAdminData();
	return {
		...adminData,
		pointSettings: DEFAULT_POINT_SETTINGS,
	};
};
