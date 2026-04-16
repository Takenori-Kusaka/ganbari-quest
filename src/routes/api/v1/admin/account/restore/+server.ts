// POST /api/v1/admin/account/restore — ソフトデリート復元 (#742)
//
// グレースピリオド内のソフトデリートされたアカウントを復元する。
// 復元専用メールリンクから呼び出される想定。

import { json } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { requireRole } from '$lib/server/auth/guards';
import { restoreSoftDeletedTenant } from '$lib/server/services/grace-period-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
	requireRole(locals, ['owner']);
	const tenantId = requireTenantId(locals);

	const result = await restoreSoftDeletedTenant(tenantId);

	if (!result.success) {
		return json(
			{ error: 'RESTORE_FAILED', message: 'アカウントを復元できませんでした。グレースピリオドが終了している可能性があります。' },
			{ status: 400 },
		);
	}

	return json({ ok: true, tenantId: result.tenantId });
};
