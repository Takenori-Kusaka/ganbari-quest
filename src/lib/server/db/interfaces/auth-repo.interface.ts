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

	// --- Invite (#3585: 管理操作は inviteId 鍵、受諾のみ raw inviteCode 鍵) ---
	createInvite(input: CreateInviteInput): Promise<Invite>;
	/** 受諾フロー専用: raw code (capability) から invite を引く。返る Invite の inviteCode は引数の raw。 */
	findInviteByCode(inviteCode: string): Promise<Invite | undefined>;
	/**
	 * 管理系の状態遷移 (revoke / expire / 旧経路 accept)。鍵は inviteId (#3585)。
	 * pending からの遷移のみ許可する状態機械 (#3588 ③): 失効済 / 受諾済 invite への
	 * 再遷移は no-op (乱用余地を塞ぐ)。tenant scope は呼び出し側 (findTenantInvites 経由の
	 * 一覧束縛) が担保する。
	 */
	updateInviteStatus(
		inviteId: string,
		status: Invite['status'],
		acceptedBy?: string,
	): Promise<void>;
	/** 一覧。各 Invite の inviteId は管理鍵、inviteCode は空 (raw 非露出、#3585)。 */
	findTenantInvites(tenantId: string): Promise<Invite[]>;
	/** 物理削除。鍵は inviteId、tenant 束縛必須 (他 tenant の invite は消せない、#3585 / §P9)。 */
	deleteInvite(inviteId: string, tenantId: string): Promise<void>;

	// --- Consent (#0192) ---
	recordConsent(input: RecordConsentInput): Promise<ConsentRecord>;
	findLatestConsent(
		tenantId: string,
		type: ConsentRecord['type'],
	): Promise<ConsentRecord | undefined>;
	findAllConsents(tenantId: string): Promise<ConsentRecord[]>;
}
