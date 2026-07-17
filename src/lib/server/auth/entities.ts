import type { ChildId } from '$lib/domain/ids';
// src/lib/server/auth/entities.ts
// マルチテナント認証エンティティの型定義 (#0123)

import type { SubscriptionPlan } from '$lib/domain/constants/subscription-plan';
import type { SubscriptionStatus } from '$lib/domain/constants/subscription-status';
import type { Role } from './types';

/** 認証プロバイダの固定集合。
 * runtime 配列は DSQL users.provider の CHECK 生成 SSOT (#3528、手書き二重化禁止)。 */
export const AUTH_PROVIDERS = ['cognito'] as const;
export type AuthProviderKind = (typeof AUTH_PROVIDERS)[number];

/** Cognito ユーザー（Email/Password 認証） */
export interface AuthUser {
	userId: string;
	email: string;
	provider: AuthProviderKind;
	displayName?: string;
	createdAt: string;
	updatedAt: string;
}

export interface CreateUserInput {
	email: string;
	provider: AuthProviderKind;
	displayName?: string;
}

/** テナント（家族グループ） */
export interface Tenant {
	tenantId: string;
	name: string;
	ownerId: string;
	status: SubscriptionStatus;
	plan?: SubscriptionPlan;
	stripeCustomerId?: string;
	stripeSubscriptionId?: string;
	planExpiresAt?: string;
	trialUsedAt?: string;
	// #742: Soft delete state (softDeletedAt / deletionGracePlanTier) is stored
	// in settings table (not Tenant entity) to avoid schema migration on DynamoDB.
	// See grace-period-service.ts for details.
	/**
	 * #1601 (ADR-0023 §5 I11): 最終活動時刻 (ISO string)。
	 * `hooks.server.ts` が認証成功時に 1 日 1 回のガード付きで更新する。
	 * 90 日以上経過したテナントを「休眠」と判定し、休眠復帰メールの送信対象とする。
	 * 既存テナントでは undefined のことがあり、その場合は createdAt を fallback とする。
	 */
	lastActiveAt?: string;
	createdAt: string;
	updatedAt: string;
}

export interface CreateTenantInput {
	name: string;
	ownerId: string;
}

/** メンバーシップ（ユーザー × テナント、1ユーザー=1テナント） */
export interface Membership {
	userId: string;
	tenantId: string;
	role: Role;
	joinedAt: string;
	invitedBy?: string;
}

export interface CreateMembershipInput {
	userId: string;
	tenantId: string;
	role: Role;
	invitedBy?: string;
}

/** invite 状態の固定集合。
 * runtime 配列は DSQL invites.status の CHECK 生成 SSOT (#3528、手書き二重化禁止)。 */
export const INVITE_STATUSES = ['pending', 'accepted', 'revoked', 'expired'] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

/** 招待リンク */
export interface Invite {
	/**
	 * 管理操作 (updateInviteStatus / deleteInvite / 一覧からの revoke) の安定鍵 (#3585)。
	 * 呼び出し側にとって opaque な backend 定義のハンドル:
	 *   - DSQL: invites.invite_id (DB 採番 uuid)。raw code は token_hash のみ保存で復元不能 (CWE-522)
	 *   - DynamoDB: raw inviteCode と同値 (PK=INVITE#<code> を管理鍵に流用)
	 * findTenantInvites はこの inviteId を返し、inviteCode は空文字にする (raw は作成時のみ露出)。
	 */
	inviteId: string;
	/**
	 * raw 招待コード (受諾リンクに埋め込む capability)。作成時 (createInvite) と
	 * 受諾照合 (findInviteByCode、raw 提示者 = capability 保持者) でのみ非空。
	 * 一覧 (findTenantInvites) では復元不能 (DSQL) / 非露出 (統一) のため空文字。
	 */
	inviteCode: string;
	tenantId: string;
	invitedBy: string;
	role: Role;
	childId?: ChildId;
	/** #3549 判断2 (§6.6 ⚠️): 設定時は受諾 user の email と一致必須 (横流し防止)。小文字正規化して保存 */
	email?: string;
	status: InviteStatus;
	createdAt: string;
	expiresAt: string;
	acceptedBy?: string;
	acceptedAt?: string;
}

export interface CreateInviteInput {
	tenantId: string;
	invitedBy: string;
	role: Role;
	childId?: ChildId;
	/** 宛先 email (任意)。設定時は受諾者 email 束縛が有効になる (#3549 判断2) */
	email?: string;
}

/** 同意種別の固定集合。
 * runtime 配列は DSQL consents.type の CHECK 生成 SSOT (#3528、手書き二重化禁止)。 */
export const CONSENT_TYPES = ['terms', 'privacy'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

/** 利用規約・PP 同意記録 (#0192) */
export interface ConsentRecord {
	tenantId: string;
	userId: string;
	type: ConsentType;
	version: string;
	consentedAt: string;
	ipAddress: string;
	userAgent: string;
}

export interface RecordConsentInput {
	tenantId: string;
	userId: string;
	type: ConsentType;
	version: string;
	ipAddress: string;
	userAgent: string;
}
