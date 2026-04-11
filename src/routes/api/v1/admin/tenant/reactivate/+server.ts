// src/routes/api/v1/admin/tenant/reactivate/+server.ts
// 解約キャンセル（active に復帰）— owner 限定
//
// #784: cancel エンドポイントが Stripe を即時キャンセルするようになったため、
// grace_period 中に reactivate する際は Stripe Subscription が既に消えている。
// DB 上のテナント状態だけを active に戻しても課金は復活しないため、
// ここでは 409 で明示的に「再購読が必要」と返し、フロント側で Checkout へ
// 誘導する。

import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { notifyCancellationReverted } from '$lib/server/services/discord-notify-service';

export const POST: RequestHandler = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const context = locals.context;

	if (!context || context.role !== 'owner') {
		return json({ error: 'owner のみ解約キャンセルできます' }, { status: 403 });
	}

	const repos = getRepos();
	const tenant = await repos.auth.findTenantById(tenantId);
	if (!tenant) {
		return json({ error: 'テナントが見つかりません' }, { status: 404 });
	}

	if (tenant.status !== 'grace_period') {
		return json({ error: '解約手続き中ではありません' }, { status: 409 });
	}

	// #784: Stripe Subscription が既にキャンセル済みの場合、単に DB を active に
	// 戻しても課金は復活しない。再購読が必要な旨を明示して Checkout に誘導する。
	// Stripe webhook (customer.subscription.deleted) により stripeSubscriptionId は
	// undefined にクリアされているはずだが、webhook 到達前でも tenant.plan は
	// 保持されているため、状態遷移は「要再購読」で一貫させる。
	if (!tenant.stripeSubscriptionId) {
		return json(
			{
				error: '再購読が必要です',
				reason: 'subscription_cancelled',
				redirectTo: '/pricing',
			},
			{ status: 409 },
		);
	}

	// 防御的: 万一 Subscription がまだ残っている場合（本来到達しない）、
	// その場合のみ DB 上で active に戻す。
	await repos.auth.updateTenantStripe(tenantId, {
		status: 'active',
		planExpiresAt: undefined,
	});

	notifyCancellationReverted(tenantId).catch(() => {});

	logger.info('[tenant] 解約キャンセル', {
		context: { tenantId },
	});

	return json({ success: true });
};
