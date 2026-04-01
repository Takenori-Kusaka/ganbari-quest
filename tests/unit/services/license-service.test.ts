// tests/unit/services/license-service.test.ts
// license-service ユニットテスト — ライセンス情報取得

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindTenantById = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			findTenantById: (...args: unknown[]) => mockFindTenantById(...args),
		},
	}),
}));

import { getLicenseInfo } from '$lib/server/services/license-service';
import type { LicenseInfo } from '$lib/server/services/license-service';

describe('license-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('getLicenseInfo', () => {
		it('テナントが見つからない場合 null を返す', async () => {
			mockFindTenantById.mockResolvedValue(undefined);

			const result = await getLicenseInfo('nonexistent-tenant');

			expect(result).toBeNull();
		});

		it('テナントが存在する場合 LicenseInfo を返す', async () => {
			mockFindTenantById.mockResolvedValue({
				tenantId: 'tenant-1',
				name: 'テスト家族',
				ownerId: 'user-1',
				status: 'active',
				plan: 'monthly',
				licenseKey: 'LIC-123',
				stripeCustomerId: 'cus_abc',
				stripeSubscriptionId: 'sub_xyz',
				planExpiresAt: '2027-01-01T00:00:00Z',
				createdAt: '2026-01-01T00:00:00Z',
				updatedAt: '2026-03-01T00:00:00Z',
			});

			const result = await getLicenseInfo('tenant-1');

			expect(result).not.toBeNull();
			const info = result as LicenseInfo;
			expect(info.plan).toBe('monthly');
			expect(info.status).toBe('active');
			expect(info.licenseKey).toBe('LIC-123');
			expect(info.tenantName).toBe('テスト家族');
			expect(info.stripeCustomerId).toBe('cus_abc');
			expect(info.stripeSubscriptionId).toBe('sub_xyz');
			expect(info.planExpiresAt).toBe('2027-01-01T00:00:00Z');
			expect(info.createdAt).toBe('2026-01-01T00:00:00Z');
			expect(info.updatedAt).toBe('2026-03-01T00:00:00Z');
		});

		it('tenant.plan が null の場合 "free" にデフォルトする', async () => {
			mockFindTenantById.mockResolvedValue({
				tenantId: 'tenant-2',
				name: '無料家族',
				ownerId: 'user-2',
				status: 'active',
				plan: null,
				licenseKey: undefined,
				stripeCustomerId: undefined,
				stripeSubscriptionId: undefined,
				planExpiresAt: undefined,
				createdAt: '2026-01-01T00:00:00Z',
				updatedAt: '2026-01-01T00:00:00Z',
			});

			const result = await getLicenseInfo('tenant-2');

			expect(result).not.toBeNull();
			expect(result?.plan).toBe('free');
		});

		it('tenant.plan が undefined の場合 "free" にデフォルトする', async () => {
			mockFindTenantById.mockResolvedValue({
				tenantId: 'tenant-3',
				name: '未設定家族',
				ownerId: 'user-3',
				status: 'active',
				plan: undefined,
				createdAt: '2026-02-01T00:00:00Z',
				updatedAt: '2026-02-01T00:00:00Z',
			});

			const result = await getLicenseInfo('tenant-3');

			expect(result).not.toBeNull();
			expect(result?.plan).toBe('free');
		});

		it('全フィールドが正しくマッピングされる', async () => {
			const tenantData = {
				tenantId: 'tenant-full',
				name: 'フル家族',
				ownerId: 'user-full',
				status: 'grace_period' as const,
				plan: 'yearly' as const,
				licenseKey: 'LIC-FULL',
				stripeCustomerId: 'cus_full',
				stripeSubscriptionId: 'sub_full',
				planExpiresAt: '2028-12-31T00:00:00Z',
				createdAt: '2025-01-01T00:00:00Z',
				updatedAt: '2026-04-01T00:00:00Z',
			};
			mockFindTenantById.mockResolvedValue(tenantData);

			const result = await getLicenseInfo('tenant-full');

			expect(result).toEqual({
				plan: 'yearly',
				status: 'grace_period',
				licenseKey: 'LIC-FULL',
				tenantName: 'フル家族',
				stripeCustomerId: 'cus_full',
				stripeSubscriptionId: 'sub_full',
				planExpiresAt: '2028-12-31T00:00:00Z',
				createdAt: '2025-01-01T00:00:00Z',
				updatedAt: '2026-04-01T00:00:00Z',
			});
		});

		it('tenantId が正しく findTenantById に渡される', async () => {
			mockFindTenantById.mockResolvedValue(undefined);

			await getLicenseInfo('specific-tenant-id');

			expect(mockFindTenantById).toHaveBeenCalledTimes(1);
			expect(mockFindTenantById).toHaveBeenCalledWith('specific-tenant-id');
		});

		it('オプショナルフィールドが undefined のとき undefined として返される', async () => {
			mockFindTenantById.mockResolvedValue({
				tenantId: 'tenant-minimal',
				name: '最小家族',
				ownerId: 'user-min',
				status: 'active',
				plan: 'monthly',
				licenseKey: undefined,
				stripeCustomerId: undefined,
				stripeSubscriptionId: undefined,
				planExpiresAt: undefined,
				createdAt: '2026-01-01T00:00:00Z',
				updatedAt: '2026-01-01T00:00:00Z',
			});

			const result = await getLicenseInfo('tenant-minimal');

			expect(result).not.toBeNull();
			expect(result?.licenseKey).toBeUndefined();
			expect(result?.stripeCustomerId).toBeUndefined();
			expect(result?.stripeSubscriptionId).toBeUndefined();
			expect(result?.planExpiresAt).toBeUndefined();
		});
	});
});
