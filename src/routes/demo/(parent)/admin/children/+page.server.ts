import { DEFAULT_POINT_SETTINGS } from '$lib/domain/point-display';
import { getDemoPointBalance } from '$lib/server/demo/demo-data.js';
import { getDemoAdminData } from '$lib/server/demo/demo-service.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const adminData = getDemoAdminData();
	const children = adminData.children.map((child) => ({
		...child,
		balance: getDemoPointBalance(child.id),
		level: 1,
		levelTitle: '',
	}));

	return {
		children,
		pointSettings: DEFAULT_POINT_SETTINGS,
	};
};
