// src/lib/server/db/interfaces/auth-repo.interface.ts
// マルチテナント認証リポジトリインターフェース (#0123)

import type {
	AuthUser,
	ConsentRecord,
	CreateInviteInput,
	CreateMembershipInput,
	CreateTenantInput,
	CreateUserInput,
	Invite,
	Membership,
	RecordConsentInput,
	Tenant,
} from '$lib/server/auth/entities';

export interface IAuthRepo {
	// --- User ---
	findUserByEmail(email: string): Promise<AuthUser | undefined>;
	findUserById(userId: string): Promise<AuthUser | undefined>;
	createUser(input: CreateUserInput): Promise<AuthUser>;

	// --- Tenant ---
	findTenantById(tenantId: string): Promise<Tenant | undefined>;
	findTenantByStripeCustomerId(stripeCustomerId: string): Promise<Tenant | undefined>;
	createTenant(input: CreateTenantInput): Promise<Tenant>;
	updateTenantStatus(tenantId: string, status: Tenant['status']): Promise<void>;
	updateTenantStripe(
		tenantId: string,
		data: {
			stripeCustomerId?: string;
			stripeSubscriptionId?: string;
			plan?: Tenant['plan'];
			planExpiresAt?: string;
			trialUsedAt?: string;
			status?: Tenant['status'];
		},
	): Promise<void>;

	// --- Membership ---
	findMembership(userId: string, tenantId: string): Promise<Membership | undefined>;
	findUserTenants(userId: string): Promise<Membership[]>;
	findTenantMembers(tenantId: string): Promise<Membership[]>;
	createMembership(input: CreateMembershipInput): Promise<Membership>;
	deleteMembership(userId: string, tenantId: string): Promise<void>;

	// --- Invite ---
	createInvite(input: CreateInviteInput): Promise<Invite>;
	findInviteByCode(inviteCode: string): Promise<Invite | undefined>;
	updateInviteStatus(
		inviteCode: string,
		status: Invite['status'],
		acceptedBy?: string,
	): Promise<void>;
	findTenantInvites(tenantId: string): Promise<Invite[]>;

	// --- Consent (#0192) ---
	recordConsent(input: RecordConsentInput): Promise<ConsentRecord>;
	findLatestConsent(
		tenantId: string,
		type: ConsentRecord['type'],
	): Promise<ConsentRecord | undefined>;
	findAllConsents(tenantId: string): Promise<ConsentRecord[]>;
}
