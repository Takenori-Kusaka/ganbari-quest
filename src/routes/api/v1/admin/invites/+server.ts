// POST /api/v1/admin/invites — 招待リンク作成
// GET  /api/v1/admin/invites — 招待一覧取得
// (#0129)

import { error, json } from '@sveltejs/kit';
import { createInviteSchema } from '$lib/domain/validation/auth';
import { validationError } from '$lib/server/errors';
import { createInvite, listInvites } from '$lib/server/services/invite-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const invites = await listInvites(tenantId);
	return json({ invites });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const identity = locals.identity;
	if (!identity || identity.type !== 'cognito') {
		error(401, 'Unauthorized');
	}
	const userId = identity.userId;

	const body = await request.json();
	const parsed = createInviteSchema.safeParse(body);
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? 'パラメータが不正です');
	}

	const invite = await createInvite(tenantId, userId, parsed.data.role, parsed.data.childId);

	return json({ invite }, { status: 201 });
};
