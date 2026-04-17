// src/routes/api/v1/data/summary/+server.ts
// テナントデータサマリー API (#0205)

import { json } from '@sveltejs/kit';
import { requireRole } from '$lib/server/auth/factory';
import { getDataSummary } from '$lib/server/services/data-service';
import type { RequestHandler } from './$types';

/** GET /api/v1/data/summary */
export const GET: RequestHandler = async ({ locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	requireRole(locals, ['owner', 'parent']);

	const summary = await getDataSummary(tenantId);
	return json({ ok: true, summary });
};
