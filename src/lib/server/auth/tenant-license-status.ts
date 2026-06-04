// src/lib/server/auth/tenant-license-status.ts
// #2894: Tenant の購読/ライセンス状態 → AuthContext.licenseStatus 正規化 SSOT。
//
// 背景 (license 全廃 cutover の entitlement 保全):
//   #2813 / #2822 (Epic #2525 Phase 7) で license key 認可経路を撤廃した際、
//   SaaS 側の tier 解決 (`cognito.ts` issueContextFromMembership) は元々
//   `stripeSubscriptionId` の有無のみで licenseStatus を決めていた。
//   しかし license 時代に課金していた既存テナントは、Stripe ではなく
//   license 経由で `plan` / `planExpiresAt` が付与され、`stripeSubscriptionId`
//   を持たない。このため cutover 後にそれらのテナントが `NONE` → free に
//   降格し、reward 系の有料 gate (#728) が全 403 になる回帰が発生した (#2894)。
//
// 本モジュールは「Stripe / license いずれの経路でも、有効な entitlement を
//   持つ既存テナントを ACTIVE と判定する」純粋関数を提供する。
//   - free 新規テナント (plan 未設定) は従来どおり NONE のまま (緩和しない)
//   - 期限切れ (planExpiresAt 経過) の legacy テナントは EXPIRED に落とす
//
// SSOT 上の対応 (auth-license-status.ts のコメント表):
//   Tenant.status / 課金経路        → AuthContext.licenseStatus
//   ------------------------------------------------------------
//   Stripe active / grace_period    → 'active'
//   Stripe suspended                → 'suspended'
//   Stripe terminated               → 'none'
//   legacy plan + 期限内 (or 無期限) → 'active'   (#2894 cutover 保全)
//   legacy plan + 期限切れ           → 'expired'  (#2894)
//   plan 未設定 (free 新規)          → 'none'

import {
	AUTH_LICENSE_STATUS,
	type AuthLicenseStatus,
} from '$lib/domain/constants/auth-license-status';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import type { Tenant } from './entities';

/** {@link deriveTenantLicenseStatus} が判定に使う Tenant の最小 shape */
export type LicenseStatusTenantInput = Pick<
	Tenant,
	'status' | 'plan' | 'stripeSubscriptionId' | 'planExpiresAt'
>;

/**
 * Tenant レコードから AuthContext.licenseStatus を導出する (#2894 SSOT)。
 *
 * Stripe subscription を持つテナントは従来どおり `tenant.status` を正規化する。
 * Stripe を持たないが legacy plan (license 時代の課金) を持つテナントは、
 * 期限内なら ACTIVE / 期限切れなら EXPIRED として entitlement を保全する。
 *
 * @param tenant - status / plan / stripeSubscriptionId / planExpiresAt を持つ Tenant
 * @param now - 期限判定の基準時刻 (テスト注入用、既定は現在時刻)
 */
export function deriveTenantLicenseStatus(
	tenant: LicenseStatusTenantInput | null | undefined,
	now: Date = new Date(),
): AuthLicenseStatus {
	if (!tenant) return AUTH_LICENSE_STATUS.NONE;

	// 経路 1: Stripe subscription を持つ → status 正規化 (従来挙動、不変)
	if (tenant.stripeSubscriptionId) {
		if (
			tenant.status === SUBSCRIPTION_STATUS.ACTIVE ||
			tenant.status === SUBSCRIPTION_STATUS.GRACE_PERIOD
		) {
			return AUTH_LICENSE_STATUS.ACTIVE;
		}
		return AUTH_LICENSE_STATUS.SUSPENDED;
	}

	// 経路 2 (#2894 cutover 保全): Stripe を持たないが legacy plan を持つ既存テナント。
	// license 経由で付与された plan は、cutover 後も entitlement として尊重する。
	if (tenant.plan) {
		// terminated / suspended な legacy テナントは entitlement を持たない。
		if (
			tenant.status === SUBSCRIPTION_STATUS.TERMINATED ||
			tenant.status === SUBSCRIPTION_STATUS.SUSPENDED
		) {
			return AUTH_LICENSE_STATUS.NONE;
		}
		// 期限切れ (planExpiresAt 経過) は EXPIRED。
		// 無期限 (lifetime, planExpiresAt 未設定) は ACTIVE。
		if (tenant.planExpiresAt && new Date(tenant.planExpiresAt) <= now) {
			return AUTH_LICENSE_STATUS.EXPIRED;
		}
		return AUTH_LICENSE_STATUS.ACTIVE;
	}

	// 経路 3: plan も Stripe も無い (free 新規テナント) → NONE (従来どおり、緩和しない)
	return AUTH_LICENSE_STATUS.NONE;
}
