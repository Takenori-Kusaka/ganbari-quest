// src/routes/ops/analytics/+page.server.ts
// #822: /ops analysis page
// Business logic delegated to ops-analytics-service.ts

import { getAnalyticsData } from '$lib/server/services/ops-analytics-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const analytics = await getAnalyticsData();
	return { analytics };
};
