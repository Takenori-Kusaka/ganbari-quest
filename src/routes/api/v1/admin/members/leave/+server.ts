// src/routes/api/v1/admin/members/leave/+server.ts
// 自主離脱（parent のみ）

import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAppUserId } from '$lib/server/auth/guards';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';

export const POST: RequestHandler = async ({ locals }) => {
	const context = locals.context;
	const identity = locals.identity;

	if (!context || !identity || identity.type !== 'cognito') {
		return json({ error: '認証が必要です' }, { status: 401 });
	}

	const tenantId = context.tenantId;

	// owner は離脱不可（権限を移譲してから）
	if (context.role === 'owner') {
		return json(
			{ error: 'owner は離脱できません。先に別のメンバーにオーナー権限を移譲してください。' },
			{ status: 400 },
		);
	}

	// #4643: memberships.user_id はアプリ DB の users.user_id。identity.userId (IdP の sub) を
	// 渡していたため DELETE が 0 件になり、「離脱しました」と返しながら実際は残っていた。
	const userId = requireAppUserId(locals);

	const repos = getRepos();

	// テナントの全メンバーを確認
	const members = await repos.auth.findTenantMembers(tenantId);
	if (members.length <= 1) {
		return json(
			{ error: '最後のメンバーは離脱できません。アカウント削除をご利用ください。' },
			{ status: 400 },
		);
	}

	// メンバーシップ削除
	await repos.auth.deleteMembership(userId, tenantId);

	logger.info('[members] 自主離脱', {
		context: { tenantId, userId, role: context.role },
	});

	return json({ success: true });
};
