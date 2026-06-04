// tests/unit/server/auth/tenant-license-status.test.ts
// #2894: license 全廃 cutover の entitlement 保全。
// `deriveTenantLicenseStatus` が Stripe / legacy plan いずれの経路でも
// 有効なテナントを ACTIVE と判定し、free 新規テナントは NONE のままにすることを検証する。

import { describe, expect, it } from 'vitest';
import { AUTH_LICENSE_STATUS } from '../../../../src/lib/domain/constants/auth-license-status';
import { SUBSCRIPTION_STATUS } from '../../../../src/lib/domain/constants/subscription-status';
import {
	deriveTenantLicenseStatus,
	type LicenseStatusTenantInput,
} from '../../../../src/lib/server/auth/tenant-license-status';

const NOW = new Date('2026-06-04T00:00:00.000Z');

function tenant(partial: Partial<LicenseStatusTenantInput>): LicenseStatusTenantInput {
	return {
		status: SUBSCRIPTION_STATUS.ACTIVE,
		...partial,
	};
}

describe('deriveTenantLicenseStatus (#2894 cutover entitlement)', () => {
	describe('経路 1: Stripe subscription を持つ (従来挙動、不変)', () => {
		it('Stripe active → ACTIVE', () => {
			const result = deriveTenantLicenseStatus(
				tenant({ stripeSubscriptionId: 'sub_123', status: SUBSCRIPTION_STATUS.ACTIVE }),
				NOW,
			);
			expect(result).toBe(AUTH_LICENSE_STATUS.ACTIVE);
		});

		it('Stripe grace_period → ACTIVE (猶予中も機能利用可)', () => {
			const result = deriveTenantLicenseStatus(
				tenant({ stripeSubscriptionId: 'sub_123', status: SUBSCRIPTION_STATUS.GRACE_PERIOD }),
				NOW,
			);
			expect(result).toBe(AUTH_LICENSE_STATUS.ACTIVE);
		});

		it('Stripe suspended → SUSPENDED', () => {
			const result = deriveTenantLicenseStatus(
				tenant({ stripeSubscriptionId: 'sub_123', status: SUBSCRIPTION_STATUS.SUSPENDED }),
				NOW,
			);
			expect(result).toBe(AUTH_LICENSE_STATUS.SUSPENDED);
		});

		it('Stripe terminated → SUSPENDED (entitlement なし)', () => {
			const result = deriveTenantLicenseStatus(
				tenant({ stripeSubscriptionId: 'sub_123', status: SUBSCRIPTION_STATUS.TERMINATED }),
				NOW,
			);
			expect(result).toBe(AUTH_LICENSE_STATUS.SUSPENDED);
		});
	});

	describe('経路 2: license 時代の paid テナント (Stripe なし + plan あり、cutover 保全)', () => {
		it('legacy plan (期限なし lifetime) → ACTIVE', () => {
			// reward 系 gate (#728) が回復する最重要ケース。
			const result = deriveTenantLicenseStatus(
				tenant({ plan: 'monthly', stripeSubscriptionId: undefined, planExpiresAt: undefined }),
				NOW,
			);
			expect(result).toBe(AUTH_LICENSE_STATUS.ACTIVE);
		});

		it('legacy family plan (期限内) → ACTIVE', () => {
			const result = deriveTenantLicenseStatus(
				tenant({
					plan: 'family-yearly',
					stripeSubscriptionId: undefined,
					planExpiresAt: '2026-12-31T00:00:00.000Z',
				}),
				NOW,
			);
			expect(result).toBe(AUTH_LICENSE_STATUS.ACTIVE);
		});

		it('legacy plan (期限切れ) → EXPIRED', () => {
			const result = deriveTenantLicenseStatus(
				tenant({
					plan: 'monthly',
					stripeSubscriptionId: undefined,
					planExpiresAt: '2026-01-01T00:00:00.000Z',
				}),
				NOW,
			);
			expect(result).toBe(AUTH_LICENSE_STATUS.EXPIRED);
		});

		it('legacy plan だが terminated status → NONE (解約済は entitlement なし)', () => {
			const result = deriveTenantLicenseStatus(
				tenant({
					plan: 'monthly',
					stripeSubscriptionId: undefined,
					status: SUBSCRIPTION_STATUS.TERMINATED,
				}),
				NOW,
			);
			expect(result).toBe(AUTH_LICENSE_STATUS.NONE);
		});

		it('legacy plan だが suspended status → NONE', () => {
			const result = deriveTenantLicenseStatus(
				tenant({
					plan: 'monthly',
					stripeSubscriptionId: undefined,
					status: SUBSCRIPTION_STATUS.SUSPENDED,
				}),
				NOW,
			);
			expect(result).toBe(AUTH_LICENSE_STATUS.NONE);
		});

		it('planExpiresAt 境界 (now と同時刻) は EXPIRED 側に倒す', () => {
			const result = deriveTenantLicenseStatus(
				tenant({
					plan: 'monthly',
					stripeSubscriptionId: undefined,
					planExpiresAt: NOW.toISOString(),
				}),
				NOW,
			);
			expect(result).toBe(AUTH_LICENSE_STATUS.EXPIRED);
		});
	});

	describe('経路 3: free 新規テナント (plan なし + Stripe なし、緩和しない)', () => {
		it('plan 未設定 → NONE (新規 free ユーザーは free のまま)', () => {
			const result = deriveTenantLicenseStatus(
				tenant({ plan: undefined, stripeSubscriptionId: undefined }),
				NOW,
			);
			expect(result).toBe(AUTH_LICENSE_STATUS.NONE);
		});

		it('tenant が null/undefined → NONE', () => {
			expect(deriveTenantLicenseStatus(null, NOW)).toBe(AUTH_LICENSE_STATUS.NONE);
			expect(deriveTenantLicenseStatus(undefined, NOW)).toBe(AUTH_LICENSE_STATUS.NONE);
		});
	});
});
