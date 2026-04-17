// src/routes/api/v1/admin/account/deletion-info/+server.ts
// Owner 削除前の情報取得（他メンバー一覧、移譲先候補）

import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getOwnerDeletionInfo } from '$lib/server/services/account-deletion-service';

export const GET: RequestHandler = async ({ locals }) => {
	const context = locals.context;
	const identity = locals.identity;

	if (!context || !identity || identity.type !== 'cognito') {
		return json({ error: '認証が必要です' }, { status: 401 });
	}

	const tenantId = context.tenantId;

	if (context.role !== 'owner') {
		return json({ error: 'owner のみ取得できます' }, { status: 403 });
	}

	try {
		const info = await getOwnerDeletionInfo(tenantId, identity.userId);
		return json(info);
	} catch (err) {
		return json({ error: String(err) }, { status: 500 });
	}
};
