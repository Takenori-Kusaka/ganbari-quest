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
import type { LicenseRecord, LicenseRevokeReason } from './license-record.types';

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
	/**
	 * #2484 (HMAC migration Phase 1.3): ライセンスキー形式での絞込み。
	 * - `'legacy'`: HMAC 未署名形式 `GQ-XXXX-XXXX-XXXX` (17 文字)
	 * - `'signed'`: HMAC 署名付き形式 `GQ-XXXX-XXXX-XXXX-YYYYY` (23 文字)
	 * - 未指定: 形式不問
	 *
	 * 実装は `licenseKey` 属性の長さで判定 (schema 変更不要)。
	 * `docs/operations/license-hmac-migration-plan.md` §4 line 90 整合:
	 * 「Phase 1 / 2 / 3 の AC で参照される『legacy 残存数』は全て SaaS (DynamoDB) backend のみ」。
	 * SQLite 実装は本 filter を ignore (no-op、count 0 を返す) して問題なし。
	 */
	format?: 'legacy' | 'signed';
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

	/**
	 * ステータス別のライセンスキー一覧（ページネーション対応）。
	 *
	 * #2490 Phase 2 Sub-B2: format filter 拡張 (`countLicenseKeys` と同パターン、OCP 整合)。
	 * - `options.format: 'legacy' | 'signed'` で key 形式絞込み (`size(licenseKey)` で判定、schema 変更不要)
	 * - migration plan §4 line 90 整合: SQLite no-op (空配列返却、SaaS DynamoDB のみ実集計)
	 */
	listLicenseKeysByStatus(
		status: LicenseKeyStatus,
		options?: { format?: 'legacy' | 'signed'; limit?: number; cursor?: string },
	): Promise<LicenseKeyPage>;

	/** N 日以内に有効期限が切れるアクティブなキー一覧 */
	listExpiringSoon(days: number): Promise<LicenseRecord[]>;

	/** ライセンスキーの集計 */
	countLicenseKeys(filter?: LicenseKeyCountFilter): Promise<number>;

	/**
	 * #821: status='active' かつ expiresAt <= now のキーを列挙する。
	 * (#2818 Phase 7 PR-L3: 旧呼び出し元の日次 revoke バッチ /api/cron/license-expire は物理削除済。
	 *  本 DB interface メソッドは dead 化のまま PR-L5 の列・enum・table 物理削除まで残す)
	 * DynamoDB 側は LICENSE# パーティションの Scan + FilterExpression で実装する。
	 */
	listActiveExpiredKeys(now: string): Promise<LicenseRecord[]>;
}
