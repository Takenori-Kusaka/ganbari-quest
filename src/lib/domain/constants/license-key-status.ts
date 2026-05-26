// src/lib/domain/constants/license-key-status.ts
// #972: LicenseRecord.status (発行したライセンスキー自体の状態) の SSOT。
//
// 意味的に以下の 3 種類の status と区別すること:
//  - SubscriptionStatus (Tenant.status): テナント購読の状態
//  - AuthLicenseStatus (AuthContext.licenseStatus): 認証コンテキストへの正規化後の状態
//  - StampCardStatus: スタンプカードの状態 (本 issue 範囲外)

export const LICENSE_KEY_STATUS = {
	/** 発行済み / 未使用 */
	ACTIVE: 'active',
	/** consumeLicenseKey で tenant に紐付いた (使用済み) */
	CONSUMED: 'consumed',
	/** revokeLicenseKey で失効された (返金 / 漏洩 / 期限切れ等) */
	REVOKED: 'revoked',
	/**
	 * #2490 Phase 2 Sub-B1: HMAC migration により旧 legacy key が SIGNED 再発行され無効化された状態。
	 * - validate / consume / revoke 全経路で reject される (validateLicenseKey は invalid を返す)
	 * - 監査ログ用に元 record は残置 (status のみ migrated に遷移)
	 * - 詳細: docs/operations/license-hmac-migration-plan.md §4 Phase 2 / docs/design/license-key-lifecycle.md §3.1
	 */
	MIGRATED: 'migrated',
} as const;

export type LicenseKeyStatus = (typeof LICENSE_KEY_STATUS)[keyof typeof LICENSE_KEY_STATUS];

export const ALL_LICENSE_KEY_STATUSES: readonly LicenseKeyStatus[] = [
	LICENSE_KEY_STATUS.ACTIVE,
	LICENSE_KEY_STATUS.CONSUMED,
	LICENSE_KEY_STATUS.REVOKED,
	LICENSE_KEY_STATUS.MIGRATED,
] as const;

export function isLicenseKeyActive(status: LicenseKeyStatus): boolean {
	return status === LICENSE_KEY_STATUS.ACTIVE;
}

export function isLicenseKeyConsumed(status: LicenseKeyStatus): boolean {
	return status === LICENSE_KEY_STATUS.CONSUMED;
}

export function isLicenseKeyRevoked(status: LicenseKeyStatus): boolean {
	return status === LICENSE_KEY_STATUS.REVOKED;
}

export function isLicenseKeyMigrated(status: LicenseKeyStatus): boolean {
	return status === LICENSE_KEY_STATUS.MIGRATED;
}
