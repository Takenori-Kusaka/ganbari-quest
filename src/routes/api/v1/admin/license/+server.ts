// GET /api/v1/admin/license — ライセンス情報取得 (#0130)

import { requireTenantId } from '$lib/server/auth/factory';
import { getLicenseInfo } from '$lib/server/services/license-service';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const info = await getLicenseInfo(tenantId);
	if (!info) {
		error(404, 'テナント情報が見つかりません');
	}
	return json({ license: info });
};
