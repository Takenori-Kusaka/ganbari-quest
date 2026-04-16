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
} as const;

export type LicenseKeyStatus = (typeof LICENSE_KEY_STATUS)[keyof typeof LICENSE_KEY_STATUS];

export const ALL_LICENSE_KEY_STATUSES: readonly LicenseKeyStatus[] = [
	LICENSE_KEY_STATUS.ACTIVE,
	LICENSE_KEY_STATUS.CONSUMED,
	LICENSE_KEY_STATUS.REVOKED,
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
