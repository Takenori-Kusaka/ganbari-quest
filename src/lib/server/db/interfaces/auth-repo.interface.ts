// src/lib/server/db/interfaces/auth-repo.interface.ts
// マルチテナント認証リポジトリインターフェース (#0123)

import type { LicenseKeyStatus } from '$lib/domain/constants/license-key-status';
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

/** ページネーション用カーソル (#816) */
export interface LicenseKeyPage {
	items: LicenseRecord[];
	/** 次ページのカーソル。null なら最終ページ */
	cursor: string | null;
}

/** ライセンスキー検索フィルタ (#816) */
export interface LicenseKeyCountFilter {
	tenantId?: string;
	status?: LicenseKeyStatus;
}

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

	// --- License Key Search (#816) ---

	/** テナントに紐付く全ライセンスキーを取得（ページネーション対応） */
	listLicenseKeysByTenant(
		tenantId: string,
		limit?: number,
		cursor?: string,
	): Promise<LicenseKeyPage>;

	/** ステータス別のライセンスキー一覧（ページネーション対応） */
	listLicenseKeysByStatus(
		status: LicenseKeyStatus,
		limit?: number,
		cursor?: string,
	): Promise<LicenseKeyPage>;

	/** N 日以内に有効期限が切れるアクティブなキー一覧 */
	listExpiringSoon(days: number): Promise<LicenseRecord[]>;

	/** ライセンスキーの集計 */
	countLicenseKeys(filter?: LicenseKeyCountFilter): Promise<number>;

	/**
	 * #821: status='active' かつ expiresAt <= now のキーを列挙する。
	 * 日次の期限切れ revoke バッチ (/api/cron/license-expire) で対象抽出に使う。
	 * 件数は通常数十件/日を想定。DynamoDB 側は LICENSE# パーティションの Scan
	 * + FilterExpression で実装する（GSI を足すほど頻度が高くない）。
	 */
	listActiveExpiredKeys(now: string): Promise<LicenseRecord[]>;
}
