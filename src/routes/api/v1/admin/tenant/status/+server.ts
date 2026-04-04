// src/routes/api/v1/admin/tenant/status/+server.ts
// テナントステータス取得 — owner / parent

import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { getRepos } from '$lib/server/db/factory';

export const GET: RequestHandler = async ({ locals }) => {
	const tenantId = requireTenantId(locals);

	const repos = getRepos();
	const tenant = await repos.auth.findTenantById(tenantId);
	if (!tenant) {
		return json({ error: 'テナントが見つかりません' }, { status: 404 });
	}

	return json({
		status: tenant.status,
		planExpiresAt: tenant.planExpiresAt ?? null,
		plan: tenant.plan ?? null,
	});
};
