// src/routes/ops/+page.server.ts
// KPI サマリーページ (#0176, #837 pricing triggers)

import { getKpiSummary } from '$lib/server/services/ops-service';
import { getActiveTriggers } from '$lib/server/services/pricing-trigger-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [kpi, triggerReport] = await Promise.all([getKpiSummary(), getActiveTriggers()]);
	return { kpi, triggerReport };
};
