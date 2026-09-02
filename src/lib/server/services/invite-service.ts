import type { ChildId } from '$lib/domain/ids';
// src/lib/server/services/invite-service.ts
// 招待リンクサービス (#0129)

import { isEntitledStatus } from '$lib/domain/constants/subscription-status';
import type { Invite, Membership, Tenant } from '$lib/server/auth/entities';
import { checkInviteEmailBinding } from '$lib/server/auth/invite-email-binding';
import { deriveTenantEntitlement } from '$lib/server/auth/tenant-entitlement';
import type { Role } from '$lib/server/auth/types';
import { getRepos } from '$lib/server/db/factory';
import type { AcceptInviteFailure } from '$lib/server/db/interfaces/auth-repo.interface';
import { logger } from '$lib/server/logger';
import { checkFamilyMemberLimit } from './plan-limit-service';

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
 * 受諾前の read だけの業務ガードの結果 (#4039 / #4723)。
 *
 * 通過時に `maxMembers` を返すのは、受諾 txn が txn 内で数え直すための上限を
 * **preflight が引いたのと同じテナント契約から**受け取るため (tenant を 2 度引かない)。
 */
type InviteAcceptPreflight =
	/** 拒否。値は `INVITE_ACCEPT_ERROR_REASONS` の理由コード */
	| { error: string }
	/** 通過。`maxMembers` は招待元テナントのメンバー上限 (null = 無制限) */
	| { error: null; maxMembers: number | null };

/**
 * 受諾前の **read だけの業務ガード** (#4039)。失敗時は理由コード、通過時は上限つきの通過。
 *
 * 書込を伴わないため txn の外に置く。txn 内で守るべき不変条件は「invite の accepted 化と
 * membership 作成が一括で成立する」ことだけで、それは `acceptInviteTransactional` が担う。
 */
async function preflightAcceptInvite(
	invite: Invite,
	userId: string,
	userEmail: string | undefined,
	emailVerified: boolean | undefined,
	/**
	 * #4642: 引っ越し合流 (元の家族グループを畳んで別の家族グループへ移る) を許すか。
	 * **既定は false** — 通常のログイン経路でこれを許すと、招待リンクを踏んだだけで
	 * 元の家族のデータが破棄される。呼び出し側 (`tenant-relocation-service`) が
	 * 「唯一のメンバーかつ owner」と顧客の明示同意を確認したときだけ true にする。
	 */
	allowRelocation = false,
): Promise<InviteAcceptPreflight> {
	// 自己招待防止 (#0203)
	if (invite.invitedBy === userId) return { error: 'SELF_INVITE_NOT_ALLOWED' };

	if (invite.email) {
		const bindingError = checkInviteEmailBinding(invite.email, userEmail, emailVerified);
		if (bindingError) return { error: bindingError };
	}

	// 1ユーザー=1テナント制約チェック
	const existingTenants = await repos().auth.findUserTenants(userId);
	if (existingTenants.length > 0) {
		// owner が child ロールの招待を受けてダウングレードされるのを防止 (#0203)
		const existing = existingTenants.find((m) => m.tenantId === invite.tenantId);
		if (existing?.role === 'owner') return { error: 'OWNER_CANNOT_BE_DOWNGRADED' };
		// #4642: 招待元と同じ家族グループに既に居るなら、引っ越しても行き先が同じで意味がない
		if (existing) return { error: 'ALREADY_IN_TENANT' };
		if (!allowRelocation) return { error: 'ALREADY_IN_TENANT' };
	}

	// テナントの存在確認。
	// #4633: 判定は「機能が利用可能な status か」= isEntitledStatus (active + grace_period)。
	// active 厳密一致だと、支払いが 1 回失敗して猶予期間に入っただけの有料世帯からの招待が
	// すべて TENANT_NOT_FOUND で拒否される (機能自体は使えている世帯なのに受諾だけ落ちる)。
	// suspended / terminated は従来どおり拒否のまま。
	const tenant = await repos().auth.findTenantById(invite.tenantId);
	if (!tenant || !isEntitledStatus(tenant.status)) return { error: 'TENANT_NOT_FOUND' };

	// #4723: プランのメンバー上限を受諾時に再評価する。発行時に上限内でも、その後の
	// ダウングレードや他の招待の先着受諾で枠が埋まっていることがある。
	// ここは早期 return (顧客に理由を出すため) で、**厳密な排他は受諾 txn の中の数え直し**が担う。
	const memberLimit = await resolveInviteMemberLimit(tenant);
	if (!memberLimit.allowed) return { error: 'MEMBER_LIMIT_REACHED' };

	return { error: null, maxMembers: memberLimit.max };
}

/**
 * 受諾先テナントのメンバー上限を解決する (#4723)。
 *
 * 受諾者は招待元テナントの context (`locals.context`) を持たないため、課金状態は
 * **招待元テナントの行から導出する** (`deriveTenantEntitlement` = context token 発行時と
 * 同じ SSOT)。受諾者側の licenseStatus は持ち込まない — 上限は招待元の契約で決まる。
 *
 * licenseStatus / planId を渡さないと `resolveFullPlanTier` がプランを解決できず free
 * (`maxFamilyMembers` = 1) に落ち、**有料世帯の受諾がすべて MEMBER_LIMIT_REACHED で
 * 弾かれる** (owner 1 人で既に上限)。planId が要るのは standard (4) と family (無制限) を
 * 分けるため。
 *
 * 受諾時は未受諾の招待を数えない (`countPendingInvites` を渡さない) — いま受諾しようと
 * している招待自身を「予約」として二重に数えてしまうため。
 */
function resolveInviteMemberLimit(tenant: Tenant) {
	const entitlement = deriveTenantEntitlement(tenant);
	return checkFamilyMemberLimit(tenant.tenantId, entitlement.licenseStatus, {
		planId: entitlement.plan,
	});
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
	// #4704: 受諾するとメンバー上限を超えるため受け入れられない
	MEMBER_LIMIT_REACHED: 'MEMBER_LIMIT_REACHED',
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
	userId: string | null,
	userEmail?: string,
	opts?: { emailVerified?: boolean },
): Promise<string | null> {
	const invite = await getInvite(inviteCode);
	if (!invite) return 'INVALID_OR_EXPIRED';

	// #4643: users 行がまだ無い人 (null) は、自己招待にも「既に別グループ所属」にも当たり得ない。
	// IdP の sub を users.user_id の代わりに渡すと、存在しない id での問い合わせになる
	// (uuid 列では型エラーにもなる)。所有者依存の判定を飛ばして束縛判定だけを行う。
	if (userId === null) {
		if (invite.email) {
			const bindingError = checkInviteEmailBinding(invite.email, userEmail, opts?.emailVerified);
			if (bindingError) return bindingError;
		}
		const tenant = await repos().auth.findTenantById(invite.tenantId);
		return !tenant || !isEntitledStatus(tenant.status) ? 'TENANT_NOT_FOUND' : null;
	}

	return (await preflightAcceptInvite(invite, userId, userEmail, opts?.emailVerified)).error;
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
		/**
		 * #4642: 引っ越し合流を許すか。既定 false。true にしてよいのは、呼び出し側が
		 * 「唯一のメンバーかつ owner」+ 顧客の明示同意を確認したときだけ。
		 */
		allowRelocation?: boolean;
	},
): Promise<{ membership: Membership } | { error: string }> {
	const invite = await getInvite(inviteCode);
	if (!invite) {
		return { error: 'INVALID_OR_EXPIRED' };
	}

	const preflight = await preflightAcceptInvite(
		invite,
		userId,
		userEmail,
		opts?.emailVerified,
		opts?.allowRelocation === true,
	);
	if (preflight.error !== null) {
		return { error: preflight.error };
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
		// #4723: 上限は txn の中で数え直す (残り 1 枠への同時受諾を排他する)。
		// 値は preflight が招待元テナントの契約から解決したものをそのまま使う。
		maxMembers: preflight.maxMembers,
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
