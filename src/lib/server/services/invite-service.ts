import type { ChildId } from '$lib/domain/ids';
// src/lib/server/services/invite-service.ts
// 招待リンクサービス (#0129)

import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import type { Invite, Membership } from '$lib/server/auth/entities';
import { checkInviteEmailBinding } from '$lib/server/auth/invite-email-binding';
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
			// #3585: 状態遷移は inviteId 鍵。invite は raw code で引いた本物のため inviteId は信頼できる
			// #3588: tenant scope (family_id 述語) を query 層で強制するため invite.tenantId を渡す
			await repos().auth.updateInviteStatus(invite.inviteId, invite.tenantId, 'expired');
		} catch {
			// conditional write failure は無視（既に別ステータスに遷移済み）
		}
		return null;
	}

	return invite;
}

// 宛先 email 束縛判定は `$lib/server/auth/invite-email-binding` が SSOT (#3742)。
// 受諾 txn (`db/dsql/invite-accept.ts`) と同一関数を共有し parity を機械保証する
// (service 層は事前 read で早期 return、txn 内は defense-in-depth の再検証)。
// 判定結果の招待は消費せず pending のまま (正規宛先の受諾可能性を保持)。

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

	// 受諾 = invite の accepted 化 + membership INSERT を **単一 txn** で実行する (§6.6、#4039)。
	// 旧実装は createMembership → updateInviteStatus の 2 回呼びで、後者の失敗を握り潰していた
	// ため「membership はあるのに invite は pending のまま」= 招待リンクが再利用可能な部分
	// コミットが起きえた。txn 化で rowCount=0 / 23505 を確定失敗として厳密分岐する。
	// #3585: 鍵は inviteId (invite は getInvite が raw code で引いた本物)。
	const accepted = await repos().auth.acceptInviteTransactional({
		inviteId: invite.inviteId,
		userId,
		userEmail: userEmail ?? '',
		userEmailVerified: opts?.emailVerified,
		now: new Date().toISOString(),
	});
	if (!accepted.ok) {
		// txn 内の email 束縛判定は service 層と同一 SSOT (#3742)。呼び出し側 (cognito.ts) が
		// 分岐する文字列に合わせて写像する。
		if (accepted.reason === 'EMAIL_MISMATCH') return { error: 'INVITE_EMAIL_MISMATCH' };
		if (accepted.reason === 'EMAIL_UNVERIFIED') return { error: 'INVITE_EMAIL_UNVERIFIED' };
		return { error: accepted.reason };
	}
	const membership: Membership = {
		userId,
		tenantId: accepted.familyId,
		role: accepted.role,
		joinedAt: accepted.joinedAt,
		invitedBy: accepted.invitedBy,
	};

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

/**
 * 招待を取り消す (#3585: 管理鍵は inviteId)。
 *
 * raw code は一覧から復元不能 (CWE-522) のため、admin UI は inviteId を渡す。tenant scope は
 * findTenantInvites (tenant 束縛) の一覧に inviteId が存在することで担保する — 他 tenant の
 * inviteId を渡しても一覧に無いため no-op となり cross-tenant revoke を防ぐ。
 */
export async function revokeInvite(inviteId: string, tenantId: string): Promise<void> {
	const invites = await repos().auth.findTenantInvites(tenantId);
	const target = invites.find((i) => i.inviteId === inviteId);
	if (!target || target.status !== 'pending') {
		return;
	}
	try {
		// #3588: tenant scope は tenantId (family_id 述語) で query 層が強制する
		await repos().auth.updateInviteStatus(inviteId, tenantId, 'revoked');
	} catch {
		// conditional write failure は無視 (状態機械が pending 以外を弾く)
	}
}

/** テナントの招待一覧を取得 */
export async function listInvites(tenantId: string): Promise<Invite[]> {
	return repos().auth.findTenantInvites(tenantId);
}
