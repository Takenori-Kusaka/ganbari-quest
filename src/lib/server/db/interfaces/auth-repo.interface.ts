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
import type { LicenseRecord, LicenseRevokeReason } from '$lib/server/services/license-key-service';

export interface IAuthRepo {
	// --- User ---
	findUserByEmail(email: string): Promise<AuthUser | undefined>;
	findUserById(userId: string): Promise<AuthUser | undefined>;
	createUser(input: CreateUserInput): Promise<AuthUser>;
	deleteUser(userId: string): Promise<void>;

	// --- Tenant ---
	findTenantById(tenantId: string): Promise<Tenant | undefined>;
	findTenantByStripeCustomerId(stripeCustomerId: string): Promise<Tenant | undefined>;
	listAllTenants(): Promise<Tenant[]>;
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
			licenseKey?: string;
		},
	): Promise<void>;
	updateTenantOwner(tenantId: string, newOwnerId: string): Promise<void>;
	deleteTenant(tenantId: string): Promise<void>;

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
	deleteInvite(inviteCode: string, tenantId: string): Promise<void>;

	// --- Consent (#0192) ---
	recordConsent(input: RecordConsentInput): Promise<ConsentRecord>;
	findLatestConsent(
		tenantId: string,
		type: ConsentRecord['type'],
	): Promise<ConsentRecord | undefined>;
	findAllConsents(tenantId: string): Promise<ConsentRecord[]>;

	// --- License Key (#0247) ---
	saveLicenseKey(record: LicenseRecord): Promise<void>;
	findLicenseKey(key: string): Promise<LicenseRecord | undefined>;
	updateLicenseKeyStatus(
		key: string,
		status: LicenseRecord['status'],
		consumedBy?: string,
	): Promise<void>;
	/**
	 * #797: ライセンスキーを失効させる。
	 * status='revoked' + revokedAt + revokedReason + revokedBy を一括更新。
	 */
	revokeLicenseKey(params: {
		licenseKey: string;
		reason: LicenseRevokeReason;
		revokedBy: string;
		revokedAt: string;
	}): Promise<void>;
}
