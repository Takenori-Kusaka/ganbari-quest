// DELETE /api/v1/admin/viewer-tokens/:id — 閲覧トークン削除/無効化
// (#371)

import { error, json } from '@sveltejs/kit';
import { deleteViewerToken, revokeViewerToken } from '$lib/server/services/viewer-token-service';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals, url }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const id = Number(params.id);
	if (!Number.isFinite(id)) {
		error(400, '不正なID');
	}

	const action = url.searchParams.get('action');
	if (action === 'revoke') {
		await revokeViewerToken(id, tenantId);
	} else {
		await deleteViewerToken(id, tenantId);
	}

	return json({ success: true });
};
