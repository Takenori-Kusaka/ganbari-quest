// src/routes/api/v1/data/summary/+server.ts
// テナントデータサマリー API (#0205)

import { requireRole, requireTenantId } from '$lib/server/auth/factory';
import { getDataSummary } from '$lib/server/services/data-service';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** GET /api/v1/data/summary */
export const GET: RequestHandler = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	requireRole(locals, ['owner', 'parent']);

	const summary = await getDataSummary(tenantId);
	return json({ ok: true, summary });
};
