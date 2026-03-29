// src/routes/api/v1/admin/tenant/reactivate/+server.ts
// 解約キャンセル（active に復帰）— owner 限定

import { requireTenantId } from '$lib/server/auth/factory';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { notifyCancellationReverted } from '$lib/server/services/discord-notify-service';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';

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
