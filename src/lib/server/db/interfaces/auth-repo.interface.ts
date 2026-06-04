// src/lib/server/db/interfaces/auth-repo.interface.ts
// マルチテナント認証リポジトリインターフェース (#0123)
//
// Epic #2525 Phase 7 PR-L5 (#2860): license key 全廃 contract。LicenseRecord / LicenseKeyStatus /
// saveLicenseKey 系メソッド + LicenseKeyPage / LicenseKeyCountFilter を撤去。entitlement は
// Stripe Subscription (tenant.status) が唯一 SSOT。

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
		},
	): Promise<void>;
	updateTenantOwner(tenantId: string, newOwnerId: string): Promise<void>;
	/**
	 * #1601 (ADR-0023 §5 I11): テナントの最終活動時刻 (lastActiveAt) を更新する。
	 *
	 * `hooks.server.ts` が認証成功ごとに呼ぶ可能性があるため、呼び出し側で
	 * 1 日 1 回のガード（前回値が当日と同じならスキップ）を行うこと。
	 * 本メソッド自体は冪等で副作用は ISO 文字列の上書きのみ。
	 */
	updateTenantLastActiveAt(tenantId: string, lastActiveAt: string): Promise<void>;
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
}
