// src/routes/api/v1/admin/account/deletion-info/+server.ts
// Owner 削除前の情報取得（他メンバー一覧、移譲先候補）

import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { ERROR_NOTIFY_LABELS, OWNER_GATE_LABELS } from '$lib/domain/labels';
import { requireAppUserId } from '$lib/server/auth/guards';
import { ownerGateResponse } from '$lib/server/auth/owner-gate';
import { logger } from '$lib/server/logger';
import { getOwnerDeletionInfo } from '$lib/server/services/account-deletion-service';

export const GET: RequestHandler = async ({ locals }) => {
	const context = locals.context;
	const identity = locals.identity;

	if (!context || !identity || identity.type !== 'cognito') {
		return json({ error: '認証が必要です' }, { status: 401 });
	}

	const tenantId = context.tenantId;

	// #3556: role 判定は requireRole seam (#3528 fitness#3) に統一。
	// #3561: 403 文言は OWNER_GATE_LABELS (SSOT)、401/403 変換は ownerGateResponse に集約。
	const guard = ownerGateResponse(locals, OWNER_GATE_LABELS.deletionInfo);
	if (guard) {
		return guard;
	}

	try {
		// #4643: users.user_id を渡す (identity.userId は IdP の sub で users を引けない)
		const info = await getOwnerDeletionInfo(tenantId, requireAppUserId(locals));
		return json(info);
	} catch (err) {
		// ADR-0062 §2 / #3571: 内部例外メッセージ (String(err)) をユーザに露出しない。
		// 生例外は logger のみに残し、レスポンスは固定のユーザ向け文言 (ERROR_NOTIFY_LABELS.server, SSOT) にする (#3561 / #3673)。
		logger.error('[deletion-info] 削除前情報取得失敗', {
			error: String(err),
			context: { tenantId },
		});
		return json({ error: ERROR_NOTIFY_LABELS.server }, { status: 500 });
	}
};
