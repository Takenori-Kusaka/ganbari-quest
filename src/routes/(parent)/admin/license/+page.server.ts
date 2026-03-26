// /admin/license — ライセンス管理画面 (#0130, #0131)

import { requireTenantId } from '$lib/server/auth/factory';
import { getLicenseInfo } from '$lib/server/services/license-service';
import { isStripeEnabled } from '$lib/server/stripe/client';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const license = await getLicenseInfo(tenantId);

	return {
		license: license ?? {
			plan: 'free' as const,
			status: 'active' as const,
			tenantName: '',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		},
		stripeEnabled: isStripeEnabled(),
	};
};
