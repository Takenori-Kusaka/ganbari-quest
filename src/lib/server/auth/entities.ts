// src/lib/server/auth/entities.ts
// マルチテナント認証エンティティの型定義 (#0123)

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
	status: 'active' | 'suspended' | 'grace_period' | 'terminated';
	licenseKey?: string;
	plan?: 'monthly' | 'yearly' | 'lifetime';
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
