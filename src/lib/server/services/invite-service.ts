import type { ChildId } from '$lib/domain/ids';
// src/lib/server/services/invite-service.ts
// 招待リンクサービス (#0129)

import { isEntitledStatus } from '$lib/domain/constants/subscription-status';
import type { Invite, Membership } from '$lib/server/auth/entities';
import { checkInviteEmailBinding } from '$lib/server/auth/invite-email-binding';
import type { Role } from '$lib/server/auth/types';
import { getRepos } from '$lib/server/db/factory';
import type { AcceptInviteFailure } from '$lib/server/db/interfaces/auth-repo.interface';
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

/**
 * 受諾前の **read だけの業務ガード** (#4039)。失敗時は error 文字列、通過時は null。
 *
 * 書込を伴わないため txn の外に置く。txn 内で守るべき不変条件は「invite の accepted 化と
 * membership 作成が一括で成立する」ことだけで、それは `acceptInviteTransactional` が担う。
 */
async function preflightAcceptInvite(
	invite: Invite,
	userId: string,
	userEmail: string | undefined,
	emailVerified: boolean | undefined,
): Promise<string | null> {
	// 自己招待防止 (#0203)
	if (invite.invitedBy === userId) return 'SELF_INVITE_NOT_ALLOWED';

	if (invite.email) {
		const bindingError = checkInviteEmailBinding(invite.email, userEmail, emailVerified);
		if (bindingError) return bindingError;
	}

	// 1ユーザー=1テナント制約チェック
	const existingTenants = await repos().auth.findUserTenants(userId);
	if (existingTenants.length > 0) {
		// owner が child ロールの招待を受けてダウングレードされるのを防止 (#0203)
		const existing = existingTenants.find((m) => m.tenantId === invite.tenantId);
		return existing?.role === 'owner' ? 'OWNER_CANNOT_BE_DOWNGRADED' : 'ALREADY_IN_TENANT';
	}

	// テナントの存在確認。
	// #4633: 判定は「機能が利用可能な status か」= isEntitledStatus (active + grace_period)。
	// active 厳密一致だと、支払いが 1 回失敗して猶予期間に入っただけの有料世帯からの招待が
	// すべて TENANT_NOT_FOUND で拒否される (機能自体は使えている世帯なのに受諾だけ落ちる)。
	// suspended / terminated は従来どおり拒否のまま。
	const tenant = await repos().auth.findTenantById(invite.tenantId);
	if (!tenant || !isEntitledStatus(tenant.status)) return 'TENANT_NOT_FOUND';

	return null;
}

/**
 * childId 招待は子供プロフィールに userId を紐づける (#0156)。
 * 紐付けの失敗は受諾自体を無効にしない (受諾済 membership は有効なまま warn で残す)。
 */
async function linkInviteChildToUser(invite: Invite, userId: string): Promise<void> {
	if (!invite.childId) return;
	try {
		const child = await repos().child.findChildById(invite.childId, invite.tenantId);
		if (!child) return;
		await repos().child.updateChild(invite.childId, { userId }, invite.tenantId);
		logger.info('[invite] Child linked to user', {
			context: { childId: invite.childId, userId, tenantId: invite.tenantId },
		});
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

/**
 * 受諾 txn の業務失敗 → 呼び出し側 (`auth/providers/cognito.ts`) が分岐する error 文字列。
 * email 束縛の 2 種は `checkInviteEmailBinding` の戻り値名に合わせる (#3742 / #3555 ③)。
 */
const ACCEPT_INVITE_FAILURE_ERRORS: Record<AcceptInviteFailure, string> = {
	INVALID_OR_EXPIRED: 'INVALID_OR_EXPIRED',
	ALREADY_IN_TENANT: 'ALREADY_IN_TENANT',
	EMAIL_MISMATCH: 'INVITE_EMAIL_MISMATCH',
	EMAIL_UNVERIFIED: 'INVITE_EMAIL_UNVERIFIED',
};

/**
 * 受諾を **試さずに** 拒否理由だけを引く (#4636)。書き込みを一切伴わない。
 *
 * `/auth/join` が「なぜ参加できなかったか」を画面表示のたびに再導出するために使う。
 * 判定は `acceptInvite` と同じ `getInvite` + `preflightAcceptInvite` を通すので、
 * 表示された理由と実際の受諾結果が食い違わない (理由の SSOT が 1 つになる)。
 *
 * @returns 拒否理由 (`INVITE_ACCEPT_ERROR_REASONS` の値)。受諾できる状態なら null。
 */
export async function previewInviteAcceptance(
	inviteCode: string,
	userId: string,
	userEmail?: string,
	opts?: { emailVerified?: boolean },
): Promise<string | null> {
	const invite = await getInvite(inviteCode);
	if (!invite) return 'INVALID_OR_EXPIRED';
	return preflightAcceptInvite(invite, userId, userEmail, opts?.emailVerified);
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

	const preflightError = await preflightAcceptInvite(
		invite,
		userId,
		userEmail,
		opts?.emailVerified,
	);
	if (preflightError) {
		return { error: preflightError };
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
		return { error: ACCEPT_INVITE_FAILURE_ERRORS[accepted.reason] };
	}
	const membership: Membership = {
		userId,
		tenantId: accepted.familyId,
		role: accepted.role,
		joinedAt: accepted.joinedAt,
		invitedBy: accepted.invitedBy,
	};

	await linkInviteChildToUser(invite, userId);

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
