// src/routes/ops/+page.server.ts
// KPI サマリーページ (#0176)

import { getKpiSummary } from '$lib/server/services/ops-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const kpi = await getKpiSummary();
	return { kpi };
};
