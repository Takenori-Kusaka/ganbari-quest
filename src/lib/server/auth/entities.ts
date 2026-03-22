// src/lib/server/auth/entities.ts
// マルチテナント認証エンティティの型定義

import type { Role } from './types';

/** OAuth ユーザー（Cognito 連携） */
export interface AuthUser {
	userId: string;
	email: string;
	provider: 'google' | 'apple' | 'device';
	displayName?: string;
	createdAt: string;
	updatedAt: string;
}

export interface CreateUserInput {
	email: string;
	provider: 'google' | 'apple' | 'device';
	displayName?: string;
}

/** テナント（家庭） */
export interface Tenant {
	tenantId: string;
	name: string;
	status: 'active' | 'suspended' | 'grace_period' | 'terminated';
	createdAt: string;
	updatedAt: string;
}

export interface CreateTenantInput {
	name: string;
}

/** メンバーシップ（ユーザー × テナント） */
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

/** デバイストークン（共用タブレット登録） */
export interface DeviceToken {
	deviceId: string;
	tenantId: string;
	registeredBy: string;
	status: 'active' | 'revoked';
	createdAt: string;
}

export interface CreateDeviceTokenInput {
	tenantId: string;
	registeredBy: string;
}
