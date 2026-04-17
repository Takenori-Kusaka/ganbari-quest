// tests/unit/services/grace-period-service.test.ts
// #742: グレースピリオドサービスのユニットテスト

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- mocks ---

const settingsStore = new Map<string, string>();
const mockGetSettings = vi.fn(async (keys: string[], _tenantId: string) => {
	const result: Record<string, string | undefined> = {};
	for (const key of keys) {
		result[key] = settingsStore.get(key);
	}
	return result;
});
const mockSetSetting = vi.fn(async (key: string, value: string, _tenantId: string) => {
	settingsStore.set(key, value);
});
const mockListAllTenants = vi.fn().mockResolvedValue([]);
const mockUpdateTenantStripe = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		settings: {
			getSettings: mockGetSettings,
			setSetting: mockSetSetting,
		},
		auth: {
			listAllTenants: mockListAllTenants,
			updateTenantStripe: mockUpdateTenantStripe,
		},
	}),
}));

vi.mock('$lib/server/auth/factory', () => ({
	getAuthMode: () => 'cognito',
}));

vi.mock('$lib/server/services/trial-service', () => ({
	getTrialStatus: vi.fn().mockResolvedValue({
		isTrialActive: false,
		trialUsed: false,
		trialStartDate: null,
		trialEndDate: null,
		trialTier: null,
		daysRemaining: 0,
		source: null,
	}),
}));

vi.mock('$lib/server/request-context', () => ({
	getRequestContext: () => null,
	buildPlanTierCacheKey: (...args: unknown[]) => args.join(':'),
}));

vi.mock('$lib/server/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import {
	DELETION_GRACE_PERIOD_DAYS,
	findExpiredSoftDeletedTenants,
	getGracePeriodDays,
	getGracePeriodStatus,
	restoreSoftDeletedTenant,
	softDeleteTenant,
} from '$lib/server/services/grace-period-service';

describe('grace-period-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		settingsStore.clear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ============================================================
	// Constants
	// ============================================================

	describe('DELETION_GRACE_PERIOD_DAYS', () => {
		it('free は 0 日', () => {
			expect(DELETION_GRACE_PERIOD_DAYS.free).toBe(0);
		});

		it('standard は 7 日', () => {
			expect(DELETION_GRACE_PERIOD_DAYS.standard).toBe(7);
		});

		it('family は 30 日', () => {
			expect(DELETION_GRACE_PERIOD_DAYS.family).toBe(30);
		});
	});

	describe('getGracePeriodDays', () => {
		it('プランティアに対応した日数を返す', () => {
			expect(getGracePeriodDays('free')).toBe(0);
			expect(getGracePeriodDays('standard')).toBe(7);
			expect(getGracePeriodDays('family')).toBe(30);
		});
	});

	// ============================================================
	// softDeleteTenant
	// ============================================================

	describe('softDeleteTenant', () => {
		it('free プランは即時削除フラグを返す', async () => {
			// licenseStatus=none で resolveFullPlanTier が 'free' を返す
			const result = await softDeleteTenant('tenant-1', 'none');

			expect(result.success).toBe(true);
			expect(result.gracePeriodDays).toBe(0);
			expect(result.requiresImmediateDeletion).toBe(true);
		});

		it('standard プラン (active) は 7 日のグレースピリオドを設定する', async () => {
			// active + planId なし → standard 扱い
			const result = await softDeleteTenant('tenant-1', 'active', 'monthly');

			expect(result.success).toBe(true);
			expect(result.gracePeriodDays).toBe(7);
			expect(result.requiresImmediateDeletion).toBe(false);

			// settings にグレースピリオド情報が保存される
			expect(mockSetSetting).toHaveBeenCalledWith(
				'soft_deleted_at',
				expect.any(String),
				'tenant-1',
			);
			expect(mockSetSetting).toHaveBeenCalledWith(
				'deletion_grace_plan_tier',
				'standard',
				'tenant-1',
			);
		});

		it('family プランは 30 日のグレースピリオドを設定する', async () => {
			const result = await softDeleteTenant('tenant-1', 'active', 'family-monthly');

			expect(result.success).toBe(true);
			expect(result.gracePeriodDays).toBe(30);
			expect(result.requiresImmediateDeletion).toBe(false);
		});
	});

	// ============================================================
	// getGracePeriodStatus
	// ============================================================

	describe('getGracePeriodStatus', () => {
		it('ソフトデリートされていない場合は未削除状態を返す', async () => {
			const result = await getGracePeriodStatus('tenant-1');

			expect(result.isSoftDeleted).toBe(false);
			expect(result.daysRemaining).toBe(0);
		});

		it('ソフトデリート中でグレースピリオド内の場合', async () => {
			const futureDate = new Date();
			futureDate.setDate(futureDate.getDate() + 10);

			settingsStore.set('soft_deleted_at', new Date().toISOString());
			settingsStore.set('deletion_grace_plan_tier', 'family');
			settingsStore.set('physical_deletion_date', futureDate.toISOString());

			const result = await getGracePeriodStatus('tenant-1');

			expect(result.isSoftDeleted).toBe(true);
			expect(result.isExpired).toBe(false);
			expect(result.daysRemaining).toBeGreaterThan(0);
			expect(result.planTier).toBe('family');
		});

		it('グレースピリオドが期限切れの場合', async () => {
			const pastDate = new Date();
			pastDate.setDate(pastDate.getDate() - 5);

			settingsStore.set('soft_deleted_at', new Date(Date.now() - 35 * 86400000).toISOString());
			settingsStore.set('deletion_grace_plan_tier', 'family');
			settingsStore.set('physical_deletion_date', pastDate.toISOString());

			const result = await getGracePeriodStatus('tenant-1');

			expect(result.isSoftDeleted).toBe(true);
			expect(result.isExpired).toBe(true);
			expect(result.daysRemaining).toBe(0);
		});
	});

	// ============================================================
	// restoreSoftDeletedTenant
	// ============================================================

	describe('restoreSoftDeletedTenant', () => {
		it('グレースピリオド内なら復元できる', async () => {
			const futureDate = new Date();
			futureDate.setDate(futureDate.getDate() + 10);

			settingsStore.set('soft_deleted_at', new Date().toISOString());
			settingsStore.set('deletion_grace_plan_tier', 'family');
			settingsStore.set('physical_deletion_date', futureDate.toISOString());

			const result = await restoreSoftDeletedTenant('tenant-1');

			expect(result.success).toBe(true);
			// settings がクリアされている
			expect(mockSetSetting).toHaveBeenCalledWith('soft_deleted_at', '', 'tenant-1');
		});

		it('ソフトデリートされていない場合は失敗する', async () => {
			const result = await restoreSoftDeletedTenant('tenant-1');

			expect(result.success).toBe(false);
		});

		it('グレースピリオド期限切れの場合は失敗する', async () => {
			const pastDate = new Date();
			pastDate.setDate(pastDate.getDate() - 5);

			settingsStore.set('soft_deleted_at', new Date(Date.now() - 35 * 86400000).toISOString());
			settingsStore.set('deletion_grace_plan_tier', 'family');
			settingsStore.set('physical_deletion_date', pastDate.toISOString());

			const result = await restoreSoftDeletedTenant('tenant-1');

			expect(result.success).toBe(false);
		});
	});

	// ============================================================
	// findExpiredSoftDeletedTenants
	// ============================================================

	describe('findExpiredSoftDeletedTenants', () => {
		it('期限切れのソフトデリートテナントを返す', async () => {
			const pastDate = new Date();
			pastDate.setDate(pastDate.getDate() - 5);

			mockListAllTenants.mockResolvedValue([
				{ tenantId: 'tenant-expired' },
				{ tenantId: 'tenant-active' },
			]);

			// tenant-expired は期限切れ
			mockGetSettings
				.mockResolvedValueOnce({
					soft_deleted_at: new Date(Date.now() - 35 * 86400000).toISOString(),
					deletion_grace_plan_tier: 'family',
					physical_deletion_date: pastDate.toISOString(),
				})
				// tenant-active はソフトデリートされていない
				.mockResolvedValueOnce({});

			const result = await findExpiredSoftDeletedTenants();

			expect(result).toHaveLength(1);
			expect(result[0]?.tenantId).toBe('tenant-expired');
			expect(result[0]?.planTier).toBe('family');
		});

		it('期限切れテナントがない場合は空配列を返す', async () => {
			mockListAllTenants.mockResolvedValue([]);

			const result = await findExpiredSoftDeletedTenants();

			expect(result).toHaveLength(0);
		});
	});
});
