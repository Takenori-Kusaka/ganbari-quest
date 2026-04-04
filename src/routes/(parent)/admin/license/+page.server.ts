// /admin/license — ライセンス管理画面 (#0130, #0131, #314)

import { fail } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { getActivities } from '$lib/server/services/activity-service';
import { getAllChildren } from '$lib/server/services/child-service';
import { getLicenseInfo } from '$lib/server/services/license-service';
import { getLoyaltyInfo } from '$lib/server/services/loyalty-service';
import { getPlanLimits, resolvePlanTier } from '$lib/server/services/plan-limit-service';
import { getTrialStatus, startTrial } from '$lib/server/services/trial-service';
import { isStripeEnabled } from '$lib/server/stripe/client';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const [license, loyaltyInfo, children, trialStatus] = await Promise.all([
		getLicenseInfo(tenantId),
		getLoyaltyInfo(tenantId).catch(() => null),
		getAllChildren(tenantId),
		getTrialStatus(tenantId),
	]);

	// プラン利用状況
	const tier = resolvePlanTier(
		locals.context?.licenseStatus ?? 'none',
		locals.context?.plan,
		trialStatus.isTrialActive ? trialStatus.trialEndDate : null,
		trialStatus.isTrialActive ? trialStatus.trialTier : null,
	);
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
		trialStatus: {
			isTrialActive: trialStatus.isTrialActive,
			trialUsed: trialStatus.trialUsed,
			daysRemaining: trialStatus.daysRemaining,
			trialEndDate: trialStatus.trialEndDate,
			trialTier: trialStatus.trialTier,
		},
	};
};

export const actions: Actions = {
	startTrial: async ({ locals }) => {
		const tenantId = requireTenantId(locals);
		const started = await startTrial({
			tenantId,
			source: 'user_initiated',
			tier: 'standard',
		});

		if (!started) {
			return fail(400, { error: 'トライアルはすでに使用済みです' });
		}

		return { success: true };
	},
};
