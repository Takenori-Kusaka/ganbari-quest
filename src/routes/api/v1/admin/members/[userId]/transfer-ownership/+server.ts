// src/routes/api/v1/admin/members/[userId]/transfer-ownership/+server.ts
// owner 権限移譲（owner のみ）

import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getMemberRoleLabel, OWNER_GATE_LABELS } from '$lib/domain/labels';
import { ownerGateResponse } from '$lib/server/auth/owner-gate';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { sendOwnershipTransferredEmail } from '$lib/server/services/email-service';

export const POST: RequestHandler = async ({ params, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const identity = locals.identity;
	const targetUserId = (params as Record<string, string>).userId ?? '';

	// #3528: role 判定は requireRole seam に統一。response 形は既存 client
	// (admin/members/+page.svelte が d.error を表示) 互換の {error} JSON を維持する。
	// #3561: 403 文言は OWNER_GATE_LABELS (SSOT)、401/403 変換は ownerGateResponse に集約。
	// #3552 ②: role-mutation の 403 拒否は監査ログに残す (濫用試行の追跡)。
	const guard = ownerGateResponse(locals, OWNER_GATE_LABELS.transferOwnership, {
		auditAction: 'members.transfer-ownership',
		targetId: targetUserId,
	});
	if (guard) {
		return guard;
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

	// 移譲先メンバーの存在確認（#3552 ①: 移譲先が存在しない家族への移譲で owner 不在化するのを防ぐ）
	const targetMembership = await repos.auth.findMembership(targetUserId, tenantId);
	if (!targetMembership) {
		return json({ error: '移譲先メンバーが見つかりません' }, { status: 404 });
	}

	// #3552 ①: 「owner が常に 1 人以上残る」不変条件を操作順序で担保する。
	// 旧実装は「旧 owner を parent に降格 → 新 owner を昇格」の順で、降格〜昇格の
	// 中間状態で owner が 0 人になる window があり、その間にクラッシュ/失敗すると
	// owner 不在家族（復旧困難）が発生し得た。昇格を先に行うことで、どの中間状態でも
	// owner が最低 1 人（昇格前は旧 owner / 昇格後は新 owner）残る fail-safe な順序にする。
	//
	// 新 owner を owner に昇格（delete + create）。この間も旧 owner は owner のまま。
	await repos.auth.deleteMembership(targetUserId, tenantId);
	await repos.auth.createMembership({
		userId: targetUserId,
		tenantId,
		role: 'owner',
	});

	// 旧 owner を parent に降格（delete + create）。この間は新 owner が owner。
	await repos.auth.deleteMembership(identity.userId, tenantId);
	await repos.auth.createMembership({
		userId: identity.userId,
		tenantId,
		role: 'parent',
	});

	// テナントの ownerId を更新
	await repos.auth.updateTenantOwner(tenantId, targetUserId);

	// メール通知
	// #4507: 旧実装は sendMemberJoinedEmail を流用しており、新オーナーには
	// 「新しいメンバーが参加しました」という別事象の文面が届き、role には内部コード
	// 'owner' が生のまま差し込まれていた。移譲専用の文面 + 日本語 role ラベルで送る。
	const newOwner = await repos.auth.findUserById(targetUserId);
	if (newOwner?.email) {
		sendOwnershipTransferredEmail(
			newOwner.email,
			newOwner.displayName ?? newOwner.email,
			getMemberRoleLabel('owner'),
		).catch(() => {});
	}

	logger.info('[members] owner 権限移譲', {
		context: { tenantId, oldOwner: identity.userId, newOwner: targetUserId },
	});

	return json({ success: true });
};
