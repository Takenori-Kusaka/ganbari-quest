// src/lib/server/db/interfaces/auth-repo.interface.ts
// マルチテナント認証リポジトリインターフェース

import type {
	AuthUser,
	CreateDeviceTokenInput,
	CreateMembershipInput,
	CreateTenantInput,
	CreateUserInput,
	DeviceToken,
	Membership,
	Tenant,
} from '$lib/server/auth/entities';

export interface IAuthRepo {
	// --- User ---
	findUserByEmail(email: string): Promise<AuthUser | undefined>;
	findUserById(userId: string): Promise<AuthUser | undefined>;
	createUser(input: CreateUserInput): Promise<AuthUser>;

	// --- Tenant ---
	findTenantById(tenantId: string): Promise<Tenant | undefined>;
	createTenant(input: CreateTenantInput): Promise<Tenant>;
	updateTenantStatus(tenantId: string, status: Tenant['status']): Promise<void>;

	// --- Membership ---
	findMembership(userId: string, tenantId: string): Promise<Membership | undefined>;
	findUserTenants(userId: string): Promise<Membership[]>;
	findTenantMembers(tenantId: string): Promise<Membership[]>;
	createMembership(input: CreateMembershipInput): Promise<Membership>;
	deleteMembership(userId: string, tenantId: string): Promise<void>;

	// --- DeviceToken ---
	findDeviceToken(deviceId: string): Promise<DeviceToken | undefined>;
	createDeviceToken(input: CreateDeviceTokenInput): Promise<DeviceToken>;
	revokeDeviceToken(deviceId: string): Promise<void>;
	findTenantDevices(tenantId: string): Promise<DeviceToken[]>;
}
