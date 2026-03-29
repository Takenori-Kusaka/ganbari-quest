// src/lib/server/services/invite-service.ts
// 招待リンクサービス (#0129)

import type { Invite, Membership } from '$lib/server/auth/entities';
import type { Role } from '$lib/server/auth/types';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';

const repos = () => getRepos();

/** 招待リンクを作成する */
export async function createInvite(
	tenantId: string,
	invitedBy: string,
	role: Role,
	childId?: number,
): Promise<Invite> {
	if (role === 'owner') {
		throw new Error('ownerロールでの招待はできません');
	}
	return repos().auth.createInvite({ tenantId, invitedBy, role, childId });
}

/** 招待コードで招待を検索。期限切れの場合は自動で expired に更新 */
export async function getInvite(inviteCode: string): Promise<Invite | null> {
	const invite = await repos().auth.findInviteByCode(inviteCode);
	if (!invite) return null;

	if (invite.status !== 'pending') return null;

	// 有効期限チェック
	if (new Date(invite.expiresAt) < new Date()) {
		try {
			await repos().auth.updateInviteStatus(inviteCode, 'expired');
		} catch {
			// conditional write failure は無視（既に別ステータスに遷移済み）
		}
		return null;
	}

	return invite;
}

/** 招待を受諾してテナントに参加 */
export async function acceptInvite(
	inviteCode: string,
	userId: string,
): Promise<{ membership: Membership } | { error: string }> {
	const invite = await getInvite(inviteCode);
	if (!invite) {
		return { error: 'INVALID_OR_EXPIRED' };
	}

	// 自己招待防止 (#0203)
	if (invite.invitedBy === userId) {
		return { error: 'SELF_INVITE_NOT_ALLOWED' };
	}

	// 1ユーザー=1テナント制約チェック
	const existingTenants = await repos().auth.findUserTenants(userId);
	if (existingTenants.length > 0) {
		// owner が child ロールの招待を受けてダウングレードされるのを防止 (#0203)
		const existingMembership = existingTenants.find((m) => m.tenantId === invite.tenantId);
		if (existingMembership && existingMembership.role === 'owner') {
			return { error: 'OWNER_CANNOT_BE_DOWNGRADED' };
		}
		return { error: 'ALREADY_IN_TENANT' };
	}

	// テナントの存在確認
	const tenant = await repos().auth.findTenantById(invite.tenantId);
	if (!tenant || tenant.status !== 'active') {
		return { error: 'TENANT_NOT_FOUND' };
	}

	// メンバーシップ作成
	const membership = await repos().auth.createMembership({
		userId,
		tenantId: invite.tenantId,
		role: invite.role,
		invitedBy: invite.invitedBy,
	});

	// 招待ステータス更新（accepted）
	try {
		await repos().auth.updateInviteStatus(inviteCode, 'accepted', userId);
	} catch {
		// conditional write failure — 既に受諾済み（race condition）
		// メンバーシップは作成済みなので続行
	}

	// childId が指定されている場合、子供プロフィールに userId を紐づけ (#0156)
	if (invite.childId) {
		try {
			const child = await repos().child.findChildById(invite.childId, invite.tenantId);
			if (child) {
				await repos().child.updateChild(invite.childId, { userId }, invite.tenantId);
				logger.info('[invite] Child linked to user', {
					context: { childId: invite.childId, userId, tenantId: invite.tenantId },
				});
			}
		} catch (e) {
			logger.warn('[invite] Failed to link child to user', {
				context: {
					childId: invite.childId,
					userId,
					error: e instanceof Error ? e.message : String(e),
				},
			});
		}
	}

	return { membership };
}

/** 招待を取り消す */
export async function revokeInvite(inviteCode: string, tenantId: string): Promise<void> {
	const invite = await repos().auth.findInviteByCode(inviteCode);
	if (!invite || invite.tenantId !== tenantId || invite.status !== 'pending') {
		return;
	}
	try {
		await repos().auth.updateInviteStatus(inviteCode, 'revoked');
	} catch {
		// conditional write failure は無視
	}
}

/** テナントの招待一覧を取得 */
export async function listInvites(tenantId: string): Promise<Invite[]> {
	return repos().auth.findTenantInvites(tenantId);
}
