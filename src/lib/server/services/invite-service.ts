import type { ChildId } from '$lib/domain/ids';
// src/lib/server/services/invite-service.ts
// 招待リンクサービス (#0129)

import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
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
	childId?: ChildId,
	email?: string,
): Promise<Invite> {
	if (role === 'owner') {
		throw new Error('ownerロールでの招待はできません');
	}
	// #3549 判断2: 宛先 email は小文字正規化して保存 (照合は case-insensitive、email_lower と同原則)
	const normalizedEmail = email?.trim().toLowerCase() || undefined;
	return repos().auth.createInvite({ tenantId, invitedBy, role, childId, email: normalizedEmail });
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

/**
 * 宛先 email 束縛招待の受諾可否判定 (#3549 判断2 / dsql-data-model.md §6.6 ⚠️)。
 * invite.email 設定時は受諾 user の email と case-insensitive 一致必須。未提供は
 * fail-closed (招待リンクの横流しによる別人受諾を防ぐ)。招待は消費せず pending の
 * まま (正規宛先の受諾可能性を保持)。
 * #3555 ③: 束縛照合は「検証済み email」が前提。email_verified=false の provider
 * 構成では他人の email を自称して束縛招待を受諾できてしまうため fail-closed で拒否。
 */
function checkInviteEmailBinding(
	inviteEmail: string,
	userEmail: string | undefined,
	emailVerified: boolean | undefined,
): string | null {
	if (emailVerified === false) {
		return 'INVITE_EMAIL_UNVERIFIED';
	}
	if (inviteEmail.toLowerCase() !== userEmail?.trim().toLowerCase()) {
		return 'INVITE_EMAIL_MISMATCH';
	}
	return null;
}

/** 招待を受諾してテナントに参加 */
export async function acceptInvite(
	inviteCode: string,
	userId: string,
	userEmail?: string,
	opts?: {
		/**
		 * 受諾 user の email が IdP で検証済みか (Cognito `email_verified` claim、#3555 ③)。
		 * email 束縛招待でのみ判定に使う。`false` は fail-closed で拒否、`undefined` は
		 * claim を持たない provider (local / dev) との後方互換のため許容。
		 */
		emailVerified?: boolean;
	},
): Promise<{ membership: Membership } | { error: string }> {
	const invite = await getInvite(inviteCode);
	if (!invite) {
		return { error: 'INVALID_OR_EXPIRED' };
	}

	// 自己招待防止 (#0203)
	if (invite.invitedBy === userId) {
		return { error: 'SELF_INVITE_NOT_ALLOWED' };
	}

	if (invite.email) {
		const bindingError = checkInviteEmailBinding(invite.email, userEmail, opts?.emailVerified);
		if (bindingError) {
			return { error: bindingError };
		}
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
	if (!tenant || tenant.status !== SUBSCRIPTION_STATUS.ACTIVE) {
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
