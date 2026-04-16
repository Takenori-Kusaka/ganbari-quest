// src/lib/domain/constants/auth-license-status.ts
// #972: AuthContext.licenseStatus (認証コンテキスト上のライセンス状態) の SSOT。
//
// SubscriptionStatus との関係:
//   Tenant.status             → AuthContext.licenseStatus
//   ----------------------------------------------------
//   'active'                  → 'active'
//   'grace_period'            → 'active' (猶予中も機能利用可)
//   'suspended'               → 'suspended'
//   'terminated' / undefined  → 'none'
//
// この正規化は src/lib/server/auth/providers/cognito.ts で実装されている。

export const AUTH_LICENSE_STATUS = {
	/** 有効 (active / grace_period の正規化結果) */
	ACTIVE: 'active',
	/** 機能停止 (支払い失敗等) */
	SUSPENDED: 'suspended',
	/** 期限切れ (planExpiresAt 経過) */
	EXPIRED: 'expired',
	/** ライセンス無し (free / terminated) */
	NONE: 'none',
} as const;

export type AuthLicenseStatus = (typeof AUTH_LICENSE_STATUS)[keyof typeof AUTH_LICENSE_STATUS];

export const ALL_AUTH_LICENSE_STATUSES: readonly AuthLicenseStatus[] = [
	AUTH_LICENSE_STATUS.ACTIVE,
	AUTH_LICENSE_STATUS.SUSPENDED,
	AUTH_LICENSE_STATUS.EXPIRED,
	AUTH_LICENSE_STATUS.NONE,
] as const;

export function isAuthLicenseActive(status: AuthLicenseStatus): boolean {
	return status === AUTH_LICENSE_STATUS.ACTIVE;
}
