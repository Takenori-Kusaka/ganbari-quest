// /admin/billing — 請求書・支払い管理画面 (#768)
//
// Stripe Customer Portal へのリダイレクトを提供する。
// 過去の請求書、支払い方法の変更、年額↔月額の切り替えは
// Stripe 側の標準 UI に委ねる。

import { requireTenantId } from '$lib/server/auth/factory';
import { getLicenseInfo } from '$lib/server/services/license-service';
import { isStripeEnabled } from '$lib/server/stripe/client';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const tenantId = requireTenantId(locals);
	const parentData = await parent();

	const license = await getLicenseInfo(tenantId);
	const hasSubscription = !!license?.stripeSubscriptionId;
	const hasCustomer = !!license?.stripeCustomerId;

	return {
		planTier: parentData.planTier,
		stripeEnabled: isStripeEnabled(),
		hasSubscription,
		hasCustomer,
		plan: license?.plan ?? 'free',
		status: license?.status ?? 'active',
		planExpiresAt: license?.planExpiresAt ?? null,
	};
};
