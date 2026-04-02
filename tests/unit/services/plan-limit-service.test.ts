// tests/unit/services/plan-limit-service.test.ts
// plan-limit-service ユニットテスト (#0196, #0269)

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

import {
	checkActivityLimit,
	checkChildLimit,
	getHistoryCutoffDate,
	getPlanLimits,
	isPaidTier,
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

		it('active + planId=family → family', () => {
			process.env.AUTH_MODE = 'cognito';
			expect(resolvePlanTier('active', 'family')).toBe('family');
		});

		it('active + planId=standard → standard', () => {
			process.env.AUTH_MODE = 'cognito';
			expect(resolvePlanTier('active', 'standard')).toBe('standard');
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
			const d = new Date(cutoff!);
			const now = new Date();
			const diffDays = Math.round((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
			expect(diffDays).toBe(90);
		});

		it('standard: returns date 365 days ago', () => {
			const cutoff = getHistoryCutoffDate('standard');
			expect(cutoff).not.toBeNull();
			const d = new Date(cutoff!);
			const now = new Date();
			const diffDays = Math.round((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
			expect(diffDays).toBe(365);
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
