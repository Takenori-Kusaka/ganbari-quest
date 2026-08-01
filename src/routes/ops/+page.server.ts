// src/routes/ops/+page.server.ts
// KPI サマリーページ (#0176, #837 pricing triggers, #1201 admin bypass metrics)

import { getAdminBypassMetrics } from '$lib/server/services/admin-bypass-metrics-service';
import { getKpiSummary } from '$lib/server/services/ops-service';
import { getActiveTriggers } from '$lib/server/services/pricing-trigger-service';
import { checkPlanResolution } from '$lib/server/services/stripe-plan-drift-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// planDrift は Stripe API を 1 回照会する (#4128)。/ops は owner 限定 + 低頻度アクセスのため
	// 追加コストは無視できる。照会失敗は throw せず report.error に載る (他セクションを巻き添えにせず、
	// かつ「0 件」に見せない)。
	const [kpi, triggerReport, adminBypass, planDrift] = await Promise.all([
		getKpiSummary(),
		getActiveTriggers(),
		getAdminBypassMetrics(3),
		checkPlanResolution(),
	]);
	return { kpi, triggerReport, adminBypass, planDrift };
};
