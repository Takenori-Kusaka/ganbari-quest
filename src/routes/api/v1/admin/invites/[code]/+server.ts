// DELETE /api/v1/admin/invites/[code] — 招待取消し (#0129)

import { isHttpError, json } from '@sveltejs/kit';
import { requireRole } from '$lib/server/auth/guards';
import { revokeInvite } from '$lib/server/services/invite-service';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;

	// #3549 決裁 (a): 招待取消は owner 専用。role 判定は requireRole seam (#3528 fitness#3)
	// に統一し、response 形は既存 client 互換の {error} JSON を維持する
	try {
		requireRole(locals, ['owner']);
	} catch (e) {
		if (isHttpError(e, 403)) {
			return json({ error: 'owner のみ招待を取り消しできます' }, { status: 403 });
		}
		throw e;
	}

	await revokeInvite(params.code, tenantId);
	return json({ ok: true });
};
