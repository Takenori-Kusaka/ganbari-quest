// /admin/billing — 請求書・支払い管理ページ (#768)
//
// Stripe Customer Portal へのリダイレクトを提供する。
// 過去の請求書、支払い方法の変更、年額↔月額の切り替えは
// Stripe 側の標準 UI に委ねる。

import { requireTenantId } from '$lib/server/auth/factory';
import { isPinConfigured } from '$lib/server/services/auth-service';
import { getLicenseInfo } from '$lib/server/services/license-service';
import { isStripeEnabled } from '$lib/server/stripe/client';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const parentData = await parent();

	// ADR-0039 Phase 2 (#2097): デモ実行モード時は demo data。
	if (locals.isDemo) {
		return {
			planTier: parentData.planTier,
			stripeEnabled: false,
			hasSubscription: false,
			hasCustomer: false,
			pinConfigured: false,
			plan: 'free' as const,
			status: 'active' as const,
			planExpiresAt: null,
		};
	}

	const tenantId = requireTenantId(locals);

	const [license, pinConfigured] = await Promise.all([
		getLicenseInfo(tenantId),
		isPinConfigured(tenantId),
	]);
	const hasSubscription = !!license?.stripeSubscriptionId;
	const hasCustomer = !!license?.stripeCustomerId;

	return {
		planTier: parentData.planTier,
		stripeEnabled: isStripeEnabled(),
		hasSubscription,
		hasCustomer,
		pinConfigured,
		plan: license?.plan ?? 'free',
		status: license?.status ?? 'active',
		planExpiresAt: license?.planExpiresAt ?? null,
	};
};
