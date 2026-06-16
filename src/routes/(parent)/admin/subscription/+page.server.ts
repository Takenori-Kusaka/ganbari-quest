// /admin/subscription — サブスクリプション管理ページ (#0130, #0131, #314)
//
// Epic #2525 Phase 7 PR-L3 (#2818): 旧 /admin/license から rename。
// license key 全廃 (Phase 1 補強 3 #2788) に伴い `applyLicenseKey` action +
// license-key-service 依存 (consumeLicenseKey / validateLicenseKey / checkLicenseKeyRateLimit /
// restoreArchivedResources) を撤去。subscription 管理 (プラン表示 / trial / Stripe 連携) のみ残す。

import { fail } from '@sveltejs/kit';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import { TRIAL_LABELS } from '$lib/domain/labels';
import { requireTenantId } from '$lib/server/auth/factory';
import { getActivities } from '$lib/server/services/activity-service';
import { isPinConfigured } from '$lib/server/services/auth-service';
import { getAllChildren } from '$lib/server/services/child-service';
import { getLicenseInfo } from '$lib/server/services/license-service';
import { getLoyaltyInfo } from '$lib/server/services/loyalty-service';
import { getPlanLimits, resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import { getTrialStatus, startTrial } from '$lib/server/services/trial-service';
import { isStripeEnabled } from '$lib/server/stripe/client';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const [license, loyaltyInfo, children, trialStatus, pinConfigured] = await Promise.all([
		getLicenseInfo(tenantId),
		getLoyaltyInfo(tenantId).catch(() => null),
		getAllChildren(tenantId),
		getTrialStatus(tenantId),
		isPinConfigured(tenantId),
	]);

	// プラン利用状況 (#732: resolveFullPlanTier に統一)
	const tier = await resolveFullPlanTier(
		tenantId,
		locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE,
		locals.context?.plan,
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

	// #736: 解約時のダウングレード先（常に free プラン）の保持期間を PLAN_LIMITS から取得。
	// null = 無制限（現状 free は 90 だが、将来変更されても自動追従する）。
	const downgradeRetentionDays = getPlanLimits('free').historyRetentionDays;

	return {
		license: license ?? {
			plan: 'free' as const,
			status: SUBSCRIPTION_STATUS.ACTIVE,
			tenantName: '',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		},
		stripeEnabled: isStripeEnabled(),
		loyaltyInfo,
		planTier: tier,
		planStats,
		downgradeRetentionDays,
		pinConfigured,
		trialStatus: {
			isTrialActive: trialStatus.isTrialActive,
			trialUsed: trialStatus.trialUsed,
			daysRemaining: trialStatus.daysRemaining,
			trialEndDate: trialStatus.trialEndDate,
			trialTier: trialStatus.trialTier,
		},
		// EPIC #2327 / #2328: runtimeMode は +layout.server.ts (admin layout) で
		// 全 admin route の data に配布済み。NucLicensePanel / SaasLicensePanel の
		// 分岐に使用する (#2329 / #2330 / #2331)。
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
			// #2941 項目 2: メッセージは TRIAL_LABELS SSOT 経由。SaasLicensePanel の startTrial form
			// (#3033 で開始導線を一本化) が getActionErrorDisplay でユーザーに見える形で表示する (NN/G #1)
			return fail(400, { error: TRIAL_LABELS.startErrorAlreadyUsed });
		}

		return { success: true };
	},
};
