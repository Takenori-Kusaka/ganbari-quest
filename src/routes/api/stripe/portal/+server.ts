// POST /api/stripe/portal — Stripe Customer Portal セッション作成
// セキュリティ: 認証必須 + owner/parent ロールのみ + tenantId はサーバー側から取得

import { requireTenantId } from '$lib/server/auth/factory';
import { createPortalSession } from '$lib/server/services/stripe-service';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, url }) => {
	const tenantId = requireTenantId(locals);

	const role = locals.context?.role;
	if (role !== 'owner' && role !== 'parent') {
		error(403, 'Only owner or parent can access billing portal');
	}

	const result = await createPortalSession(tenantId, `${url.origin}/admin/license`);

	if ('error' in result) {
		const statusMap = {
			STRIPE_DISABLED: 503,
			TENANT_NOT_FOUND: 404,
			NO_STRIPE_CUSTOMER: 400,
		} as const;
		error(statusMap[result.error], result.error);
	}

	return json({ url: result.url });
};
