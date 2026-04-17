// src/routes/(parent)/admin/analytics/+page.server.ts
// #988: Umami analytics panel — delegates to umami-service.

import { requireTenantId } from '$lib/server/auth/factory';
import { fetchUmamiData } from '$lib/server/services/umami-service';
import type { PageServerLoad } from './$types';

export type { AnalyticsData } from '$lib/server/services/umami-service';

export const load: PageServerLoad = async ({ locals }) => {
	requireTenantId(locals);
	const analytics = await fetchUmamiData();
	return { analytics };
};
