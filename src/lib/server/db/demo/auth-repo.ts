// Demo IAuthRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.
// Demo Lambda は AnonymousAuthProvider 経由で認証なし、ユーザ / テナント情報は dummy のみ返す。

import type { LicenseKeyStatus } from '$lib/domain/constants/license-key-status';
import { LICENSE_PLAN } from '$lib/domain/constants/license-plan';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
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
import type {
	LicenseRecord,
	LicenseRevokeReason,
} from '$lib/server/db/interfaces/license-record.types';
import type {
	IAuthRepo,
	LicenseKeyCountFilter,
	LicenseKeyPage,
} from '../interfaces/auth-repo.interface';

const DEMO_TENANT_ID = 'demo';
const DEMO_NOW = '2026-03-27T09:00:00.000Z';

// ---------- User ----------

export async function findUserByEmail(_email: string): Promise<AuthUser | undefined> {
	return undefined;
}

export async function findUserById(_userId: string): Promise<AuthUser | undefined> {
	return undefined;
}

export async function createUser(input: CreateUserInput): Promise<AuthUser> {
	return {
		userId: 'demo-user',
		email: input.email,
		provider: input.provider,
		displayName: input.displayName,
		createdAt: DEMO_NOW,
		updatedAt: DEMO_NOW,
	};
}

export async function deleteUser(_userId: string): Promise<void> {
	// Stub: no-op
}

// ---------- Tenant ----------

export async function findTenantById(tenantId: string): Promise<Tenant | undefined> {
	if (tenantId !== DEMO_TENANT_ID) return undefined;
	return {
		tenantId: DEMO_TENANT_ID,
		name: 'がんばり家 (デモ)',
		ownerId: 'demo-owner',
		status: SUBSCRIPTION_STATUS.ACTIVE,
		plan: LICENSE_PLAN.FAMILY_MONTHLY,
		// #1601: 最終活動時刻
		lastActiveAt: DEMO_NOW,
		createdAt: DEMO_NOW,
		updatedAt: DEMO_NOW,
	};
}

export async function findTenantByStripeCustomerId(
	_stripeCustomerId: string,
): Promise<Tenant | undefined> {
	return undefined;
}

export async function listAllTenants(): Promise<Tenant[]> {
	const demo = await findTenantById(DEMO_TENANT_ID);
	return demo ? [demo] : [];
}

export async function createTenant(input: CreateTenantInput): Promise<Tenant> {
	return {
		tenantId: DEMO_TENANT_ID,
		name: input.name,
		ownerId: input.ownerId,
		status: SUBSCRIPTION_STATUS.ACTIVE,
		licenseKey: input.licenseKey,
		createdAt: DEMO_NOW,
		updatedAt: DEMO_NOW,
	};
}

export async function updateTenantStatus(
	_tenantId: string,
	_status: Tenant['status'],
): Promise<void> {
	// Stub: no-op
}

export async function updateTenantStripe(
	_tenantId: string,
	_data: {
		stripeCustomerId?: string;
		stripeSubscriptionId?: string;
		plan?: Tenant['plan'];
		planExpiresAt?: string;
		trialUsedAt?: string;
		status?: Tenant['status'];
		licenseKey?: string;
	},
): Promise<void> {
	// Stub: no-op
}

export async function updateTenantOwner(_tenantId: string, _newOwnerId: string): Promise<void> {
	// Stub: no-op
}

export async function updateTenantLastActiveAt(
	_tenantId: string,
	_lastActiveAt: string,
): Promise<void> {
	// Stub: no-op (Lambda stateless, mutable state は持たない — ADR-0048 §決定 §2)
}

export async function deleteTenant(_tenantId: string): Promise<void> {
	// Stub: no-op
}

// ---------- Membership ----------

export async function findMembership(
	userId: string,
	tenantId: string,
): Promise<Membership | undefined> {
	if (tenantId !== DEMO_TENANT_ID) return undefined;
	return {
		userId,
		tenantId: DEMO_TENANT_ID,
		role: 'owner',
		joinedAt: DEMO_NOW,
	};
}

export async function findUserTenants(userId: string): Promise<Membership[]> {
	return [
		{
			userId,
			tenantId: DEMO_TENANT_ID,
			role: 'owner',
			joinedAt: DEMO_NOW,
		},
	];
}

export async function findTenantMembers(tenantId: string): Promise<Membership[]> {
	if (tenantId !== DEMO_TENANT_ID) return [];
	return [
		{
			userId: 'demo-owner',
			tenantId: DEMO_TENANT_ID,
			role: 'owner',
			joinedAt: DEMO_NOW,
		},
	];
}

export async function createMembership(input: CreateMembershipInput): Promise<Membership> {
	return {
		userId: input.userId,
		tenantId: input.tenantId,
		role: input.role,
		joinedAt: DEMO_NOW,
		invitedBy: input.invitedBy,
	};
}

export async function deleteMembership(_userId: string, _tenantId: string): Promise<void> {
	// Stub: no-op
}

// ---------- Invite ----------

export async function createInvite(input: CreateInviteInput): Promise<Invite> {
	const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
	return {
		inviteCode: 'DEMO-INVITE',
		tenantId: input.tenantId,
		invitedBy: input.invitedBy,
		role: input.role,
		childId: input.childId,
		status: 'pending',
		createdAt: DEMO_NOW,
		expiresAt,
	};
}

export async function findInviteByCode(_inviteCode: string): Promise<Invite | undefined> {
	return undefined;
}

export async function updateInviteStatus(
	_inviteCode: string,
	_status: Invite['status'],
	_acceptedBy?: string,
): Promise<void> {
	// Stub: no-op
}

export async function findTenantInvites(_tenantId: string): Promise<Invite[]> {
	return [];
}

export async function deleteInvite(_inviteCode: string, _tenantId: string): Promise<void> {
	// Stub: no-op
}

// ---------- Consent ----------

export async function recordConsent(input: RecordConsentInput): Promise<ConsentRecord> {
	return {
		tenantId: input.tenantId,
		userId: input.userId,
		type: input.type,
		version: input.version,
		consentedAt: DEMO_NOW,
		ipAddress: input.ipAddress,
		userAgent: input.userAgent,
	};
}

export async function findLatestConsent(
	_tenantId: string,
	_type: ConsentRecord['type'],
): Promise<ConsentRecord | undefined> {
	return undefined;
}

export async function findAllConsents(_tenantId: string): Promise<ConsentRecord[]> {
	return [];
}

// ---------- License Key ----------

export async function saveLicenseKey(_record: LicenseRecord): Promise<void> {
	// Stub: no-op
}

export async function findLicenseKey(_key: string): Promise<LicenseRecord | undefined> {
	return undefined;
}

export async function updateLicenseKeyStatus(
	_key: string,
	_status: LicenseRecord['status'],
	_consumedBy?: string,
): Promise<void> {
	// Stub: no-op
}

export async function revokeLicenseKey(_params: {
	licenseKey: string;
	reason: LicenseRevokeReason;
	revokedBy: string;
	revokedAt: string;
}): Promise<void> {
	// Stub: no-op
}

export async function listLicenseKeysByTenant(
	_tenantId: string,
	_limit?: number,
	_cursor?: string,
): Promise<LicenseKeyPage> {
	return { items: [], cursor: null };
}

export async function listLicenseKeysByStatus(
	_status: LicenseKeyStatus,
	_options?: { format?: 'legacy' | 'signed'; limit?: number; cursor?: string },
): Promise<LicenseKeyPage> {
	return { items: [], cursor: null };
}

export async function listExpiringSoon(_days: number): Promise<LicenseRecord[]> {
	return [];
}

export async function countLicenseKeys(_filter?: LicenseKeyCountFilter): Promise<number> {
	return 0;
}

export async function listActiveExpiredKeys(_now: string): Promise<LicenseRecord[]> {
	return [];
}

// Type-check: 全 method が IAuthRepo を満たすことを確認
const _typecheck: IAuthRepo = {
	findUserByEmail,
	findUserById,
	createUser,
	deleteUser,
	findTenantById,
	findTenantByStripeCustomerId,
	listAllTenants,
	createTenant,
	updateTenantStatus,
	updateTenantStripe,
	updateTenantOwner,
	updateTenantLastActiveAt,
	deleteTenant,
	findMembership,
	findUserTenants,
	findTenantMembers,
	createMembership,
	deleteMembership,
	createInvite,
	findInviteByCode,
	updateInviteStatus,
	findTenantInvites,
	deleteInvite,
	recordConsent,
	findLatestConsent,
	findAllConsents,
	saveLicenseKey,
	findLicenseKey,
	updateLicenseKeyStatus,
	revokeLicenseKey,
	listLicenseKeysByTenant,
	listLicenseKeysByStatus,
	listExpiringSoon,
	countLicenseKeys,
	listActiveExpiredKeys,
};
void _typecheck;
