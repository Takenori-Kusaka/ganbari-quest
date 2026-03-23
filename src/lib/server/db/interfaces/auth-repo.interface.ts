// src/lib/server/db/interfaces/auth-repo.interface.ts
// マルチテナント認証リポジトリインターフェース (#0123)

import type {
	AuthUser,
	CreateMembershipInput,
	CreateTenantInput,
	CreateUserInput,
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
}
