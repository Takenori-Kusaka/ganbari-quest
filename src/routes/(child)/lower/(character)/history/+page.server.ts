import { requireTenantId } from '$lib/server/auth/factory';
import { getActivityLogs } from '$lib/server/services/activity-log-service';
import { applyRetentionFilter, resolvePlanTier } from '$lib/server/services/plan-limit-service';
import type { PageServerLoad } from './$types';

function getDateRange(period: string): { from: string; to: string } {
	const now = new Date();
	const to = now.toISOString().slice(0, 10);

	if (period === 'today') {
		return { from: to, to };
	}

	if (period === 'month') {
		const from = new Date(now);
		from.setDate(from.getDate() - 30);
		return { from: from.toISOString().slice(0, 10), to };
	}

	// Default: week
	const from = new Date(now);
	from.setDate(from.getDate() - 7);
	return { from: from.toISOString().slice(0, 10), to };
}

export const load: PageServerLoad = async ({ parent, url, locals }) => {
	const tenantId = requireTenantId(locals);
	const { child } = await parent();
	if (!child)
		return { logs: [], summary: { totalCount: 0, totalPoints: 0, byCategory: {} }, period: 'week' };

	const period = url.searchParams.get('period') ?? 'week';
	const dateRange = getDateRange(period);
	const planTier = resolvePlanTier(locals.context?.licenseStatus ?? 'none');
	const filtered = applyRetentionFilter(planTier, dateRange);
	const result = await getActivityLogs(child.id, tenantId, filtered);

	return {
		logs: result.logs,
		summary: result.summary,
		period,
	};
};
