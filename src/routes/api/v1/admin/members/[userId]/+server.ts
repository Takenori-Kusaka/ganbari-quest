// src/routes/api/v1/admin/members/[userId]/+server.ts
// メンバー削除（owner のみ）

import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { OWNER_GATE_LABELS } from '$lib/domain/labels';
import { ownerGateResponse } from '$lib/server/auth/owner-gate';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { sendMemberRemovedEmail } from '$lib/server/services/email-service';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const targetUserId = (params as Record<string, string>).userId ?? '';

	// #3528: role 判定は requireRole seam に統一。response 形は既存 client
	// (admin/members/+page.svelte が d.error を表示) 互換の {error} JSON を維持する。
	// #3561: 403 文言は OWNER_GATE_LABELS (SSOT)、401/403 変換は ownerGateResponse に集約。
	// #3552 ②: role-mutation の 403 拒否は監査ログに残す (濫用試行の追跡)。
	const guard = ownerGateResponse(locals, OWNER_GATE_LABELS.memberDelete, {
		auditAction: 'members.delete',
		targetId: targetUserId,
	});
	if (guard) {
		return guard;
	}

	if (!targetUserId) {
		return json({ error: 'userId が必要です' }, { status: 400 });
	}

	// owner 自身は削除不可
	// #4643: 比較対象は params の users.user_id。identity.userId (IdP の sub) と比べていたため
	// この guard は一度も成立せず、owner が自分自身を削除できてしまう状態だった。
	if (locals.context?.userId === targetUserId) {
		return json(
			{ error: 'owner 自身は削除できません。アカウント削除をご利用ください。' },
			{ status: 400 },
		);
	}

	const repos = getRepos();

	// メンバーシップ確認
	const membership = await repos.auth.findMembership(targetUserId, tenantId);
	if (!membership) {
		return json({ error: 'メンバーが見つかりません' }, { status: 404 });
	}

	// owner は削除不可
	if (membership.role === 'owner') {
		return json({ error: 'owner は削除できません' }, { status: 400 });
	}

	// メンバーシップ削除
	await repos.auth.deleteMembership(targetUserId, tenantId);

	// メール通知（被削除者に）
	const user = await repos.auth.findUserById(targetUserId);
	const tenant = await repos.auth.findTenantById(tenantId);
	if (user?.email && tenant) {
		sendMemberRemovedEmail(user.email, tenant.name).catch(() => {});
	}

	logger.info('[members] メンバー削除', {
		context: { tenantId, targetUserId, role: membership.role },
	});

	return json({ success: true });
};
