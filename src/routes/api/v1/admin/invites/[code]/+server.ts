// DELETE /api/v1/admin/invites/[code] — 招待取消し (#0129)

import { json } from '@sveltejs/kit';
import { revokeInvite } from '$lib/server/services/invite-service';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	await revokeInvite(params.code, tenantId);
	return json({ ok: true });
};
