// src/routes/ops/+page.server.ts
// KPI サマリーページ (#0176, #837 pricing triggers, #1201 admin bypass metrics)

import { getAdminBypassMetrics } from '$lib/server/services/admin-bypass-metrics-service';
import { getKpiSummary } from '$lib/server/services/ops-service';
import { getActiveTriggers } from '$lib/server/services/pricing-trigger-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [kpi, triggerReport, adminBypass] = await Promise.all([
		getKpiSummary(),
		getActiveTriggers(),
		getAdminBypassMetrics(3),
	]);
	return { kpi, triggerReport, adminBypass };
};
