// /admin/billing/cancel/thanks — 解約理由送信完了後の thanks ページ (#1596)

import { CANCELLATION_LABELS } from '$lib/domain/labels';
import { requireTenantId } from '$lib/server/auth/factory';
import { getLicenseInfo } from '$lib/server/services/license-service';
import { isStripeEnabled } from '$lib/server/stripe/client';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const license = await getLicenseInfo(tenantId);

	return {
		isPaidPlan: !!license?.stripeSubscriptionId,
		hasStripeCustomer: !!license?.stripeCustomerId,
		stripeEnabled: isStripeEnabled(),
		labels: CANCELLATION_LABELS,
	};
};
