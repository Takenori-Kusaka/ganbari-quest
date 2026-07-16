// DELETE /api/v1/admin/invites/[id] — 招待取消し (#0129)
// #3585: パスセグメントは inviteId (管理鍵)。raw code は一覧から復元不能 (CWE-522) のため、
//        admin UI は一覧の inviteId を渡す。revokeInvite が tenant 束縛で検証する。

import { json } from '@sveltejs/kit';
import { OWNER_GATE_LABELS } from '$lib/domain/labels';
import { ownerGateResponse } from '$lib/server/auth/owner-gate';
import { revokeInvite } from '$lib/server/services/invite-service';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;

	// #3549 決裁 (a): 招待取消は owner 専用。#3726 (= #3673 same-class): 401→401 / 403→403 変換と
	// 文言 SSOT (OWNER_GATE_LABELS) を ownerGateResponse helper に集約 (401 の 500 化退行を構造排除)
	// #3552 ②: role-mutation の 403 拒否は監査ログに残す (招待濫用試行の追跡)。
	const gate = ownerGateResponse(locals, OWNER_GATE_LABELS.inviteRevoke, {
		auditAction: 'invites.revoke',
		targetId: params.id,
	});
	if (gate) return gate;

	await revokeInvite(params.id, tenantId);
	return json({ ok: true });
};
