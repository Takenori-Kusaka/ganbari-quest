// GET /api/v1/admin/account/grace-status — グレースピリオド状態取得 (#742)

import { json } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { requireRole } from '$lib/server/auth/guards';
import { getGracePeriodStatus } from '$lib/server/services/grace-period-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	requireRole(locals, ['owner', 'parent']);
	const tenantId = requireTenantId(locals);

	const status = await getGracePeriodStatus(tenantId);
	return json(status);
};
