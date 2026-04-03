// tests/unit/services/plan-limit-service.test.ts
// plan-limit-service ユニットテスト (#0196, #0269, #0270)

import { beforeEach, describe, expect, it, vi } from 'vitest';

// mock repos
const mockFindAllChildren = vi.fn();
const mockFindActivities = vi.fn();
vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		child: { findAllChildren: mockFindAllChildren },
		activity: { findActivities: mockFindActivities },
	}),
}));

vi.mock('$lib/server/auth/factory', () => ({
	getAuthMode: () => process.env.AUTH_MODE ?? 'local',
}));

// mock trial-service (resolveFullPlanTier depends on it)
const mockGetTrialEndDate = vi.fn().mockResolvedValue(null);
vi.mock('$lib/server/services/trial-service', () => ({
	getTrialEndDate: (...args: unknown[]) => mockGetTrialEndDate(...args),
}));

import {
	checkActivityLimit,
	checkChildLimit,
	getHistoryCutoffDate,
	getPlanLimits,
	isPaidTier,
	resolveFullPlanTier,
	resolvePlanTier,
} from '$lib/server/services/plan-limit-service';

describe('plan-limit-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('resolvePlanTier', () => {
		it('active (no planId) → standard', () => {
			process.env.AUTH_MODE = 'cognito';
			expect(resolvePlanTier('active')).toBe('standard');
		});

		it('active + planId=family-monthly → family', () => {
			process.env.AUTH_MODE = 'cognito';
			expect(resolvePlanTier('active', 'family-monthly')).toBe('family');
		});

		it('active + planId=family-yearly → family', () => {
			process.env.AUTH_MODE = 'cognito';
			expect(resolvePlanTier('active', 'family-yearly')).toBe('family');
		});

		it('active + planId=monthly → standard', () => {
			process.env.AUTH_MODE = 'cognito';
			expect(resolvePlanTier('active', 'monthly')).toBe('standard');
		});

		it('active + planId=yearly → standard', () => {
			process.env.AUTH_MODE = 'cognito';
			expect(resolvePlanTier('active', 'yearly')).toBe('standard');
		});

		it('local mode: none → family (selfhost = 全機能解放)', () => {
			process.env.AUTH_MODE = 'local';
			expect(resolvePlanTier('none')).toBe('family');
		});

		it('cognito mode: none → free', () => {
			process.env.AUTH_MODE = 'cognito';
			expect(resolvePlanTier('none')).toBe('free');
		});

		it('cognito mode: expired → free', () => {
			process.env.AUTH_MODE = 'cognito';
			expect(resolvePlanTier('expired')).toBe('free');
		});

		it('cognito mode: suspended → free', () => {
			process.env.AUTH_MODE = 'cognito';
			expect(resolvePlanTier('suspended')).toBe('free');
		});

		it('cognito mode: trial active → family', () => {
			process.env.AUTH_MODE = 'cognito';
			const futureDate = new Date();
			futureDate.setDate(futureDate.getDate() + 5);
			const endStr = futureDate.toISOString().slice(0, 10);
			expect(resolvePlanTier('none', undefined, endStr)).toBe('family');
		});

		it('cognito mode: trial expired → free', () => {
			process.env.AUTH_MODE = 'cognito';
			const pastDate = new Date();
			pastDate.setDate(pastDate.getDate() - 1);
			const endStr = pastDate.toISOString().slice(0, 10);
			expect(resolvePlanTier('none', undefined, endStr)).toBe('free');
		});

		it('active license overrides trial', () => {
			process.env.AUTH_MODE = 'cognito';
			const futureDate = new Date();
			futureDate.setDate(futureDate.getDate() + 5);
			const endStr = futureDate.toISOString().slice(0, 10);
			expect(resolvePlanTier('active', 'monthly', endStr)).toBe('standard');
		});
	});

	describe('resolveFullPlanTier', () => {
		it('resolves with trial end date from service', async () => {
			process.env.AUTH_MODE = 'cognito';
			const futureDate = new Date();
			futureDate.setDate(futureDate.getDate() + 3);
			mockGetTrialEndDate.mockResolvedValue(futureDate.toISOString().slice(0, 10));
			const tier = await resolveFullPlanTier('tenant1', 'none');
			expect(tier).toBe('family');
			expect(mockGetTrialEndDate).toHaveBeenCalledWith('tenant1');
		});

		it('resolves to free when no trial', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockGetTrialEndDate.mockResolvedValue(null);
			const tier = await resolveFullPlanTier('tenant1', 'none');
			expect(tier).toBe('free');
		});
	});

	describe('isPaidTier', () => {
		it('free → false', () => {
			expect(isPaidTier('free')).toBe(false);
		});

		it('standard → true', () => {
			expect(isPaidTier('standard')).toBe(true);
		});

		it('family → true', () => {
			expect(isPaidTier('family')).toBe(true);
		});
	});

	describe('getPlanLimits', () => {
		it('free tier limits', () => {
			const limits = getPlanLimits('free');
			expect(limits.maxChildren).toBe(2);
			expect(limits.maxActivities).toBe(3);
			expect(limits.historyRetentionDays).toBe(90);
			expect(limits.canExport).toBe(false);
			expect(limits.canCustomAvatar).toBe(false);
		});

		it('standard tier limits', () => {
			const limits = getPlanLimits('standard');
			expect(limits.maxChildren).toBeNull();
			expect(limits.maxActivities).toBeNull();
			expect(limits.historyRetentionDays).toBe(365);
			expect(limits.canExport).toBe(true);
			expect(limits.canCustomAvatar).toBe(true);
		});

		it('family tier limits', () => {
			const limits = getPlanLimits('family');
			expect(limits.maxChildren).toBeNull();
			expect(limits.maxActivities).toBeNull();
			expect(limits.historyRetentionDays).toBeNull();
			expect(limits.canExport).toBe(true);
			expect(limits.canCustomAvatar).toBe(true);
		});
	});

	describe('getHistoryCutoffDate', () => {
		it('free: returns date 90 days ago', () => {
			const cutoff = getHistoryCutoffDate('free');
			expect(cutoff).not.toBeNull();
			// 実装と同じロジックで期待値を算出（setDate ベース）
			const expected = new Date();
			expected.setDate(expected.getDate() - 90);
			const expectedStr = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`;
			expect(cutoff).toBe(expectedStr);
		});

		it('standard: returns date 365 days ago', () => {
			const cutoff = getHistoryCutoffDate('standard');
			expect(cutoff).not.toBeNull();
			const expected = new Date();
			expected.setDate(expected.getDate() - 365);
			const expectedStr = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`;
			expect(cutoff).toBe(expectedStr);
		});

		it('family: returns null (no limit)', () => {
			const cutoff = getHistoryCutoffDate('family');
			expect(cutoff).toBeNull();
		});

		it('cutoff date format is YYYY-MM-DD', () => {
			const cutoff = getHistoryCutoffDate('free');
			expect(cutoff).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		});
	});

	describe('checkChildLimit', () => {
		it('standard: always allowed', async () => {
			process.env.AUTH_MODE = 'cognito';
			const result = await checkChildLimit('tenant1', 'active');
			expect(result.allowed).toBe(true);
			expect(result.max).toBeNull();
			expect(mockFindAllChildren).not.toHaveBeenCalled();
		});

		it('free (cognito): allowed when under limit', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindAllChildren.mockResolvedValue([]);
			const result = await checkChildLimit('tenant1', 'none');
			expect(result.allowed).toBe(true);
			expect(result.current).toBe(0);
			expect(result.max).toBe(2);
		});

		it('free (cognito): blocked when at limit', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindAllChildren.mockResolvedValue([
				{ id: 1, nickname: 'a' },
				{ id: 2, nickname: 'b' },
			]);
			const result = await checkChildLimit('tenant1', 'none');
			expect(result.allowed).toBe(false);
			expect(result.current).toBe(2);
			expect(result.max).toBe(2);
		});

		it('local: always allowed (selfhost)', async () => {
			process.env.AUTH_MODE = 'local';
			const result = await checkChildLimit('tenant1', 'none');
			expect(result.allowed).toBe(true);
			expect(result.max).toBeNull();
		});
	});

	describe('checkActivityLimit', () => {
		it('standard: always allowed', async () => {
			process.env.AUTH_MODE = 'cognito';
			const result = await checkActivityLimit('tenant1', 'active');
			expect(result.allowed).toBe(true);
			expect(result.max).toBeNull();
			expect(mockFindActivities).not.toHaveBeenCalled();
		});

		it('free (cognito): allowed when under limit', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindActivities.mockResolvedValue([
				{ id: 1, source: 'custom' },
				{ id: 2, source: 'custom' },
			]);
			const result = await checkActivityLimit('tenant1', 'none');
			expect(result.allowed).toBe(true);
			expect(result.current).toBe(2);
			expect(result.max).toBe(3);
		});

		it('free (cognito): blocked when at limit', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindActivities.mockResolvedValue([
				{ id: 1, source: 'custom' },
				{ id: 2, source: 'custom' },
				{ id: 3, source: 'custom' },
			]);
			const result = await checkActivityLimit('tenant1', 'none');
			expect(result.allowed).toBe(false);
			expect(result.current).toBe(3);
			expect(result.max).toBe(3);
		});

		it('free (cognito): system activities are not counted', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindActivities.mockResolvedValue([
				{ id: 1, source: 'system' },
				{ id: 2, source: 'system' },
				{ id: 3, source: 'custom' },
			]);
			const result = await checkActivityLimit('tenant1', 'none');
			expect(result.allowed).toBe(true);
			expect(result.current).toBe(1);
		});

		it('local: always allowed (selfhost)', async () => {
			process.env.AUTH_MODE = 'local';
			const result = await checkActivityLimit('tenant1', 'none');
			expect(result.allowed).toBe(true);
			expect(result.max).toBeNull();
		});
	});
});
