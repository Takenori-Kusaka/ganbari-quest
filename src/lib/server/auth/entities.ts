// src/lib/server/auth/entities.ts
// マルチテナント認証エンティティの型定義 (#0123)

import type { LicensePlan } from '$lib/domain/constants/license-plan';
import type { SubscriptionStatus } from '$lib/domain/constants/subscription-status';
import type { Role } from './types';

/** Cognito ユーザー（Email/Password 認証） */
export interface AuthUser {
	userId: string;
	email: string;
	provider: 'cognito';
	displayName?: string;
	createdAt: string;
	updatedAt: string;
}

export interface CreateUserInput {
	email: string;
	provider: 'cognito';
	displayName?: string;
}

/** テナント（家族グループ） */
export interface Tenant {
	tenantId: string;
	name: string;
	ownerId: string;
	status: SubscriptionStatus;
	licenseKey?: string;
	plan?: LicensePlan;
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
	licenseKey?: string;
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

/** 招待リンク */
export interface Invite {
	inviteCode: string;
	tenantId: string;
	invitedBy: string;
	role: Role;
	childId?: number;
	status: 'pending' | 'accepted' | 'revoked' | 'expired';
	createdAt: string;
	expiresAt: string;
	acceptedBy?: string;
	acceptedAt?: string;
}

export interface CreateInviteInput {
	tenantId: string;
	invitedBy: string;
	role: Role;
	childId?: number;
}

/** 利用規約・PP 同意記録 (#0192) */
export interface ConsentRecord {
	tenantId: string;
	userId: string;
	type: 'terms' | 'privacy';
	version: string;
	consentedAt: string;
	ipAddress: string;
	userAgent: string;
}

export interface RecordConsentInput {
	tenantId: string;
	userId: string;
	type: 'terms' | 'privacy';
	version: string;
	ipAddress: string;
	userAgent: string;
}
