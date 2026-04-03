// /admin/license — ライセンス管理画面 (#0130, #0131)

import { requireTenantId } from '$lib/server/auth/factory';
import { getActivities } from '$lib/server/services/activity-service';
import { getAllChildren } from '$lib/server/services/child-service';
import { getLicenseInfo } from '$lib/server/services/license-service';
import { getLoyaltyInfo } from '$lib/server/services/loyalty-service';
import { getPlanLimits, resolvePlanTier } from '$lib/server/services/plan-limit-service';
import { isStripeEnabled } from '$lib/server/stripe/client';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const [license, loyaltyInfo, children] = await Promise.all([
		getLicenseInfo(tenantId),
		getLoyaltyInfo(tenantId).catch(() => null),
		getAllChildren(tenantId),
	]);

	// プラン利用状況
	const tier = resolvePlanTier(locals.context?.licenseStatus ?? 'none', locals.context?.plan);
	const planLimits = getPlanLimits(tier);
	let activityCount = 0;
	try {
		const acts = await getActivities(tenantId, { includeHidden: false });
		activityCount = acts.filter((a) => a.source === 'parent').length;
	} catch {
		/* fallback */
	}
	const planStats = {
		activityCount,
		activityMax: planLimits.maxActivities,
		childCount: children.length,
		childMax: planLimits.maxChildren,
		retentionDays: planLimits.historyRetentionDays,
	};

	return {
		license: license ?? {
			plan: 'free' as const,
			status: 'active' as const,
			tenantName: '',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		},
		stripeEnabled: isStripeEnabled(),
		loyaltyInfo,
		planTier: tier,
		planStats,
	};
};
