// src/routes/api/v1/admin/members/[userId]/transfer-ownership/+server.ts
// owner 権限移譲（owner のみ）

import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { sendMemberJoinedEmail } from '$lib/server/services/email-service';

export const POST: RequestHandler = async ({ params, locals }) => {
	const tenantId = requireTenantId(locals);
	const context = locals.context;
	const identity = locals.identity;
	const targetUserId = (params as Record<string, string>).userId ?? '';

	if (!context || context.role !== 'owner') {
		return json({ error: 'owner のみ権限を移譲できます' }, { status: 403 });
	}

	if (!identity || identity.type !== 'cognito') {
		return json({ error: '認証が必要です' }, { status: 401 });
	}

	if (!targetUserId) {
		return json({ error: 'userId が必要です' }, { status: 400 });
	}

	if (identity.userId === targetUserId) {
		return json({ error: '自分自身には移譲できません' }, { status: 400 });
	}

	const repos = getRepos();

	// 移譲先メンバーの存在確認
	const targetMembership = await repos.auth.findMembership(targetUserId, tenantId);
	if (!targetMembership) {
		return json({ error: '移譲先メンバーが見つかりません' }, { status: 404 });
	}

	// 旧 owner のメンバーシップを parent に変更（delete + create）
	await repos.auth.deleteMembership(identity.userId, tenantId);
	await repos.auth.createMembership({
		userId: identity.userId,
		tenantId,
		role: 'parent',
	});

	// 新 owner のメンバーシップを owner に変更（delete + create）
	await repos.auth.deleteMembership(targetUserId, tenantId);
	await repos.auth.createMembership({
		userId: targetUserId,
		tenantId,
		role: 'owner',
	});

	// テナントの ownerId を更新
	await repos.auth.updateTenantOwner(tenantId, targetUserId);

	// メール通知
	const newOwner = await repos.auth.findUserById(targetUserId);
	if (newOwner?.email) {
		sendMemberJoinedEmail(newOwner.email, newOwner.displayName ?? newOwner.email, 'owner').catch(
			() => {},
		);
	}

	logger.info('[members] owner 権限移譲', {
		context: { tenantId, oldOwner: identity.userId, newOwner: targetUserId },
	});

	return json({ success: true });
};
