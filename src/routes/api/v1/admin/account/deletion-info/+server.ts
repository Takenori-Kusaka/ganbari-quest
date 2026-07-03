// src/routes/api/v1/admin/account/deletion-info/+server.ts
// Owner 削除前の情報取得（他メンバー一覧、移譲先候補）

import type { RequestHandler } from '@sveltejs/kit';
import { isHttpError, json } from '@sveltejs/kit';
import { requireRole } from '$lib/server/auth/guards';
import { getOwnerDeletionInfo } from '$lib/server/services/account-deletion-service';

export const GET: RequestHandler = async ({ locals }) => {
	const context = locals.context;
	const identity = locals.identity;

	if (!context || !identity || identity.type !== 'cognito') {
		return json({ error: '認証が必要です' }, { status: 401 });
	}

	const tenantId = context.tenantId;

	// #3556: role 判定は requireRole seam (#3528 fitness#3) に統一。
	// response 形は既存 client 互換の {error} JSON を維持する
	try {
		requireRole(locals, ['owner']);
	} catch (e) {
		if (isHttpError(e, 403)) {
			return json({ error: 'owner のみ取得できます' }, { status: 403 });
		}
		throw e;
	}

	try {
		const info = await getOwnerDeletionInfo(tenantId, identity.userId);
		return json(info);
	} catch (err) {
		return json({ error: String(err) }, { status: 500 });
	}
};
