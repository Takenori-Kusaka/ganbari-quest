// GET /api/v1/admin/license — ライセンス情報取得 (#0130)

import { error, json } from '@sveltejs/kit';
import { getLicenseInfo } from '$lib/server/services/license-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const info = await getLicenseInfo(tenantId);
	if (!info) {
		error(404, 'テナント情報が見つかりません');
	}
	return json({ license: info });
};
