// tests/unit/services/plan-limit-service.test.ts
// plan-limit-service ユニットテスト

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
	getPlanLimits,
	resolvePlanTier,
} from '$lib/server/services/plan-limit-service';

describe('plan-limit-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('resolvePlanTier', () => {
		it('active → paid', () => {
			expect(resolvePlanTier('active')).toBe('paid');
		});

		it('local mode: none → paid (selfhost = 全機能解放)', () => {
			process.env.AUTH_MODE = 'local';
			expect(resolvePlanTier('none')).toBe('paid');
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

	describe('getPlanLimits', () => {
		it('free tier limits', () => {
			const limits = getPlanLimits('free');
			expect(limits.maxChildren).toBe(1);
			expect(limits.maxActivities).toBe(5);
			expect(limits.historyRetentionDays).toBe(30);
			expect(limits.canExport).toBe(false);
			expect(limits.canCustomAvatar).toBe(false);
		});

		it('paid tier limits', () => {
			const limits = getPlanLimits('paid');
			expect(limits.maxChildren).toBeNull();
			expect(limits.maxActivities).toBeNull();
			expect(limits.historyRetentionDays).toBeNull();
			expect(limits.canExport).toBe(true);
			expect(limits.canCustomAvatar).toBe(true);
		});
	});

	describe('checkChildLimit', () => {
		it('paid: always allowed', async () => {
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
			expect(result.max).toBe(1);
		});

		it('free (cognito): blocked when at limit', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindAllChildren.mockResolvedValue([{ id: 1, nickname: 'test' }]);
			const result = await checkChildLimit('tenant1', 'none');
			expect(result.allowed).toBe(false);
			expect(result.current).toBe(1);
			expect(result.max).toBe(1);
		});

		it('local: always allowed (selfhost)', async () => {
			process.env.AUTH_MODE = 'local';
			const result = await checkChildLimit('tenant1', 'none');
			expect(result.allowed).toBe(true);
			expect(result.max).toBeNull();
		});
	});

	describe('checkActivityLimit', () => {
		it('paid: always allowed', async () => {
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
			expect(result.max).toBe(5);
		});

		it('free (cognito): blocked when at limit', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindActivities.mockResolvedValue([
				{ id: 1, source: 'custom' },
				{ id: 2, source: 'custom' },
				{ id: 3, source: 'custom' },
				{ id: 4, source: 'custom' },
				{ id: 5, source: 'custom' },
			]);
			const result = await checkActivityLimit('tenant1', 'none');
			expect(result.allowed).toBe(false);
			expect(result.current).toBe(5);
			expect(result.max).toBe(5);
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
