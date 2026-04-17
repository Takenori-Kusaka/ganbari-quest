// GET  /api/v1/admin/trial-expiration — トライアル終了情報取得 (#737)
// POST /api/v1/admin/trial-expiration — モーダル表示済みマーク (#737)

import { json } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { requireRole } from '$lib/server/auth/guards';
import {
	getTrialExpirationInfo,
	markTrialExpirationModalShown,
} from '$lib/server/services/trial-notification-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	requireRole(locals, ['owner', 'parent']);
	const tenantId = requireTenantId(locals);
	const licenseStatus = locals.context?.licenseStatus ?? 'none';

	const info = await getTrialExpirationInfo(tenantId, licenseStatus);
	return json(info);
};

export const POST: RequestHandler = async ({ locals }) => {
	requireRole(locals, ['owner', 'parent']);
	const tenantId = requireTenantId(locals);

	await markTrialExpirationModalShown(tenantId);
	return json({ ok: true });
};
