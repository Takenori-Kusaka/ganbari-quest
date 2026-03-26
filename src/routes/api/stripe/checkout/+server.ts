// POST /api/stripe/checkout — Stripe Checkout Session 作成
// セキュリティ: 認証必須 + owner/parent ロールのみ + tenantId はサーバー側から取得（改ざん不可）

import { requireTenantId } from '$lib/server/auth/factory';
import { createCheckoutSession } from '$lib/server/services/stripe-service';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals, url }) => {
	// 認証 + テナント検証（サーバー側の署名付きContextから取得 — 偽造不可）
	const tenantId = requireTenantId(locals);

	// ロールチェック: owner/parent のみ決済操作を許可
	const role = locals.context?.role;
	if (role !== 'owner' && role !== 'parent') {
		error(403, 'Only owner or parent can manage subscriptions');
	}

	const body = await request.json();
	const planId = body.planId;
	if (planId !== 'monthly' && planId !== 'yearly') {
		error(400, 'Invalid planId. Must be "monthly" or "yearly".');
	}

	const origin = url.origin;
	const result = await createCheckoutSession({
		tenantId,
		planId,
		successUrl: `${origin}/admin/license?session_id={CHECKOUT_SESSION_ID}`,
		cancelUrl: `${origin}/pricing`,
	});

	if ('error' in result) {
		const statusMap = {
			STRIPE_DISABLED: 503,
			TENANT_NOT_FOUND: 404,
			ALREADY_SUBSCRIBED: 409,
			INVALID_PLAN: 400,
		} as const;
		error(statusMap[result.error], result.error);
	}

	return json({ url: result.url });
};
