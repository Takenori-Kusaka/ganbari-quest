// tests/unit/services/trial-service.test.ts
// trial-service ユニットテスト (#314 リファクタ)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory trial_history store for testing
let trialRows: Array<{
	id: number;
	tenantId: string;
	startDate: string;
	endDate: string;
	tier: string;
	source: string;
	campaignId: string | null;
	createdAt: string;
}> = [];
let nextId = 1;

const mockTrialHistoryRepo = {
	findLatestByTenant: vi.fn(async (tenantId: string) => {
		const rows = trialRows.filter((r) => r.tenantId === tenantId).sort((a, b) => b.id - a.id);
		return rows[0];
	}),
	insert: vi.fn(
		async (input: {
			tenantId: string;
			startDate: string;
			endDate: string;
			tier: string;
			source: string;
			campaignId?: string | null;
		}) => {
			trialRows.push({
				id: nextId++,
				tenantId: input.tenantId,
				startDate: input.startDate,
				endDate: input.endDate,
				tier: input.tier,
				source: input.source,
				campaignId: input.campaignId ?? null,
				createdAt: new Date().toISOString(),
			});
		},
	),
};

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		trialHistory: mockTrialHistoryRepo,
	}),
}));

vi.mock('$lib/server/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import {
	getTrialEndDate,
	getTrialStatus,
	getTrialTier,
	isTrialActive,
	startTrial,
} from '$lib/server/services/trial-service';

describe('trial-service (#314)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		trialRows = [];
		nextId = 1;
	});

	describe('getTrialStatus', () => {
		it('returns inactive when no trial data exists', async () => {
			const status = await getTrialStatus('tenant1');
			expect(status.isTrialActive).toBe(false);
			expect(status.trialUsed).toBe(false);
			expect(status.trialStartDate).toBeNull();
			expect(status.trialEndDate).toBeNull();
			expect(status.daysRemaining).toBe(0);
		});

		it('returns active trial with remaining days', async () => {
			const now = new Date();
			const end = new Date(now);
			end.setDate(end.getDate() + 5);
			const startStr = now.toISOString().slice(0, 10);
			const endStr = end.toISOString().slice(0, 10);

			trialRows.push({
				id: nextId++,
				tenantId: 'tenant1',
				startDate: startStr,
				endDate: endStr,
				tier: 'standard',
				source: 'user_initiated',
				campaignId: null,
				createdAt: new Date().toISOString(),
			});

			const status = await getTrialStatus('tenant1');
			expect(status.isTrialActive).toBe(true);
			expect(status.trialUsed).toBe(true);
			expect(status.trialTier).toBe('standard');
			expect(status.daysRemaining).toBeGreaterThanOrEqual(4);
			expect(status.daysRemaining).toBeLessThanOrEqual(6);
		});

		it('returns expired trial', async () => {
			const start = new Date();
			start.setDate(start.getDate() - 9);
			const end = new Date();
			end.setDate(end.getDate() - 2);

			trialRows.push({
				id: nextId++,
				tenantId: 'tenant1',
				startDate: start.toISOString().slice(0, 10),
				endDate: end.toISOString().slice(0, 10),
				tier: 'standard',
				source: 'user_initiated',
				campaignId: null,
				createdAt: new Date().toISOString(),
			});

			const status = await getTrialStatus('tenant1');
			expect(status.isTrialActive).toBe(false);
			expect(status.trialUsed).toBe(true);
			expect(status.daysRemaining).toBe(0);
		});
	});

	describe('startTrial', () => {
		it('starts a 7-day trial for new tenant (user_initiated)', async () => {
			const result = await startTrial({
				tenantId: 'tenant1',
				source: 'user_initiated',
			});
			expect(result).toBe(true);

			const status = await getTrialStatus('tenant1');
			expect(status.isTrialActive).toBe(true);
			expect(status.trialTier).toBe('standard');
			expect(status.daysRemaining).toBeGreaterThanOrEqual(6);
			expect(status.daysRemaining).toBeLessThanOrEqual(7);
			expect(status.source).toBe('user_initiated');
		});

		it('rejects user_initiated if trial already used', async () => {
			// First trial (expired)
			const past = new Date();
			past.setDate(past.getDate() - 10);
			const pastEnd = new Date();
			pastEnd.setDate(pastEnd.getDate() - 3);

			trialRows.push({
				id: nextId++,
				tenantId: 'tenant1',
				startDate: past.toISOString().slice(0, 10),
				endDate: pastEnd.toISOString().slice(0, 10),
				tier: 'standard',
				source: 'user_initiated',
				campaignId: null,
				createdAt: new Date().toISOString(),
			});

			const result = await startTrial({
				tenantId: 'tenant1',
				source: 'user_initiated',
			});
			expect(result).toBe(false);
		});

		it('allows admin_grant even if trial already used', async () => {
			// First trial (expired)
			const past = new Date();
			past.setDate(past.getDate() - 10);
			const pastEnd = new Date();
			pastEnd.setDate(pastEnd.getDate() - 3);

			trialRows.push({
				id: nextId++,
				tenantId: 'tenant1',
				startDate: past.toISOString().slice(0, 10),
				endDate: pastEnd.toISOString().slice(0, 10),
				tier: 'standard',
				source: 'user_initiated',
				campaignId: null,
				createdAt: new Date().toISOString(),
			});

			const result = await startTrial({
				tenantId: 'tenant1',
				source: 'admin_grant',
				tier: 'family',
				durationDays: 14,
			});
			expect(result).toBe(true);

			const status = await getTrialStatus('tenant1');
			expect(status.isTrialActive).toBe(true);
			expect(status.trialTier).toBe('family');
			expect(status.daysRemaining).toBeGreaterThanOrEqual(13);
		});

		it('skips if trial already active', async () => {
			const now = new Date();
			const end = new Date(now);
			end.setDate(end.getDate() + 3);

			trialRows.push({
				id: nextId++,
				tenantId: 'tenant1',
				startDate: now.toISOString().slice(0, 10),
				endDate: end.toISOString().slice(0, 10),
				tier: 'standard',
				source: 'user_initiated',
				campaignId: null,
				createdAt: new Date().toISOString(),
			});

			const result = await startTrial({
				tenantId: 'tenant1',
				source: 'admin_grant',
			});
			expect(result).toBe(false);
		});

		it('supports campaign source with campaignId', async () => {
			const result = await startTrial({
				tenantId: 'tenant1',
				source: 'campaign',
				campaignId: 'spring2026',
			});
			expect(result).toBe(true);

			const row = trialRows.find((r) => r.tenantId === 'tenant1');
			expect(row?.campaignId).toBe('spring2026');
		});
	});

	describe('isTrialActive', () => {
		it('returns true during active trial', async () => {
			await startTrial({ tenantId: 'tenant1', source: 'user_initiated' });
			const result = await isTrialActive('tenant1');
			expect(result).toBe(true);
		});

		it('returns false when no trial', async () => {
			const result = await isTrialActive('tenant1');
			expect(result).toBe(false);
		});

		it('returns false when trial expired', async () => {
			const past = new Date();
			past.setDate(past.getDate() - 2);
			const pastEnd = new Date();
			pastEnd.setDate(pastEnd.getDate() - 1);

			trialRows.push({
				id: nextId++,
				tenantId: 'tenant1',
				startDate: past.toISOString().slice(0, 10),
				endDate: pastEnd.toISOString().slice(0, 10),
				tier: 'standard',
				source: 'user_initiated',
				campaignId: null,
				createdAt: new Date().toISOString(),
			});

			const result = await isTrialActive('tenant1');
			expect(result).toBe(false);
		});
	});

	describe('getTrialEndDate', () => {
		it('returns end date during active trial', async () => {
			await startTrial({ tenantId: 'tenant1', source: 'user_initiated' });
			const endDate = await getTrialEndDate('tenant1');
			expect(typeof endDate).toBe('string');
			expect(endDate).not.toBe('');
		});

		it('returns null when no trial', async () => {
			const endDate = await getTrialEndDate('tenant1');
			expect(endDate).toBeNull();
		});
	});

	describe('getTrialTier', () => {
		it('returns tier during active trial', async () => {
			await startTrial({ tenantId: 'tenant1', source: 'user_initiated', tier: 'standard' });
			const tier = await getTrialTier('tenant1');
			expect(tier).toBe('standard');
		});

		it('returns null when no active trial', async () => {
			const tier = await getTrialTier('tenant1');
			expect(tier).toBeNull();
		});
	});

	describe('date boundary (#689 off-by-one regression)', () => {
		afterEach(() => {
			vi.useRealTimers();
		});

		it('daysRemaining does not round up due to fractional time (23:59 JST)', async () => {
			// 2026-04-10 23:59 JST = 2026-04-10 14:59 UTC
			// JST today = 2026-04-10, endDate = 2026-04-13
			// Expected daysRemaining = 3 (not 4 due to rounding up)
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-04-10T14:59:00Z'));

			trialRows.push({
				id: nextId++,
				tenantId: 'tenant1',
				startDate: '2026-04-08',
				endDate: '2026-04-13',
				tier: 'standard',
				source: 'user_initiated',
				campaignId: null,
				createdAt: '2026-04-08T00:00:00Z',
			});

			const status = await getTrialStatus('tenant1');
			expect(status.isTrialActive).toBe(true);
			expect(status.daysRemaining).toBe(3);
		});

		it('daysRemaining is consistent right after midnight JST', async () => {
			// 2026-04-11 00:01 JST = 2026-04-10 15:01 UTC
			// JST today = 2026-04-11, endDate = 2026-04-13
			// Expected daysRemaining = 2
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-04-10T15:01:00Z'));

			trialRows.push({
				id: nextId++,
				tenantId: 'tenant1',
				startDate: '2026-04-08',
				endDate: '2026-04-13',
				tier: 'standard',
				source: 'user_initiated',
				campaignId: null,
				createdAt: '2026-04-08T00:00:00Z',
			});

			const status = await getTrialStatus('tenant1');
			expect(status.isTrialActive).toBe(true);
			expect(status.daysRemaining).toBe(2);
		});

		it('isTrialActive is true and daysRemaining is 0 on the last day', async () => {
			// 2026-04-13 10:00 JST = 2026-04-13 01:00 UTC
			// JST today = 2026-04-13, endDate = 2026-04-13
			// endDate >= todayDate → isActive = true, daysRemaining = 0
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-04-13T01:00:00Z'));

			trialRows.push({
				id: nextId++,
				tenantId: 'tenant1',
				startDate: '2026-04-08',
				endDate: '2026-04-13',
				tier: 'standard',
				source: 'user_initiated',
				campaignId: null,
				createdAt: '2026-04-08T00:00:00Z',
			});

			const status = await getTrialStatus('tenant1');
			expect(status.isTrialActive).toBe(true);
			expect(status.daysRemaining).toBe(0);
		});

		it('isTrialActive becomes false the day after endDate', async () => {
			// 2026-04-14 10:00 JST = 2026-04-14 01:00 UTC
			// JST today = 2026-04-14, endDate = 2026-04-13
			// endDate < todayDate → isActive = false
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-04-14T01:00:00Z'));

			trialRows.push({
				id: nextId++,
				tenantId: 'tenant1',
				startDate: '2026-04-08',
				endDate: '2026-04-13',
				tier: 'standard',
				source: 'user_initiated',
				campaignId: null,
				createdAt: '2026-04-08T00:00:00Z',
			});

			const status = await getTrialStatus('tenant1');
			expect(status.isTrialActive).toBe(false);
			expect(status.daysRemaining).toBe(0);
		});

		it('no inconsistency: isTrialActive and daysRemaining agree at 23:59 JST on endDate', async () => {
			// 2026-04-13 23:59 JST = 2026-04-13 14:59 UTC
			// JST today = 2026-04-13, endDate = 2026-04-13
			// isActive should be true, daysRemaining should be 0
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-04-13T14:59:00Z'));

			trialRows.push({
				id: nextId++,
				tenantId: 'tenant1',
				startDate: '2026-04-08',
				endDate: '2026-04-13',
				tier: 'standard',
				source: 'user_initiated',
				campaignId: null,
				createdAt: '2026-04-08T00:00:00Z',
			});

			const status = await getTrialStatus('tenant1');
			// Both should be consistent: active with 0 days remaining (last day)
			expect(status.isTrialActive).toBe(true);
			expect(status.daysRemaining).toBe(0);
		});
	});

	describe('trial reuse prevention', () => {
		it('user_initiated cannot start trial twice', async () => {
			const first = await startTrial({ tenantId: 'tenant1', source: 'user_initiated' });
			expect(first).toBe(true);

			// Expire the first trial
			const row = trialRows.find((r) => r.tenantId === 'tenant1');
			if (row) {
				const yesterday = new Date();
				yesterday.setDate(yesterday.getDate() - 1);
				row.endDate = yesterday.toISOString().slice(0, 10);
			}

			const second = await startTrial({ tenantId: 'tenant1', source: 'user_initiated' });
			expect(second).toBe(false);
		});

		it('campaign can re-grant after expired trial', async () => {
			const first = await startTrial({ tenantId: 'tenant1', source: 'user_initiated' });
			expect(first).toBe(true);

			// Expire the first trial
			const row = trialRows.find((r) => r.tenantId === 'tenant1');
			if (row) {
				const yesterday = new Date();
				yesterday.setDate(yesterday.getDate() - 1);
				row.endDate = yesterday.toISOString().slice(0, 10);
			}

			const second = await startTrial({
				tenantId: 'tenant1',
				source: 'campaign',
				campaignId: 'test',
			});
			expect(second).toBe(true);
		});
	});
});
