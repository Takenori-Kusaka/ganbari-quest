// src/routes/api/v1/admin/members/[userId]/+server.ts
// メンバー削除（owner のみ）

import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
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

	if (context.role !== 'owner') {
		return json({ error: 'owner のみメンバーを削除できます' }, { status: 403 });
	}

	if (!targetUserId) {
		return json({ error: 'userId が必要です' }, { status: 400 });
	}

	// owner 自身は削除不可
	const identity = locals.identity;
	if (identity?.type === 'cognito' && identity.userId === targetUserId) {
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
