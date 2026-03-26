// DELETE /api/v1/admin/invites/[code] — 招待取消し (#0129)

import { requireTenantId } from '$lib/server/auth/factory';
import { revokeInvite } from '$lib/server/services/invite-service';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const tenantId = requireTenantId(locals);
	await revokeInvite(params.code, tenantId);
	return json({ ok: true });
};
