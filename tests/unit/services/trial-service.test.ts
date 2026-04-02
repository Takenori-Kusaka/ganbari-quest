// tests/unit/services/trial-service.test.ts
// trial-service ユニットテスト (#0270)

import { beforeEach, describe, expect, it, vi } from 'vitest';

// mock settings
const settingsStore: Record<string, string> = {};
vi.mock('$lib/server/db/settings-repo', () => ({
	getSettings: vi.fn(async (keys: string[]) => {
		const result: Record<string, string | undefined> = {};
		for (const key of keys) {
			result[key] = settingsStore[key];
		}
		return result;
	}),
	setSetting: vi.fn(async (key: string, value: string) => {
		settingsStore[key] = value;
	}),
}));

vi.mock('$lib/server/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { getTrialStatus, isTrialActive, startTrial } from '$lib/server/services/trial-service';

describe('trial-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Clear settings store
		for (const key of Object.keys(settingsStore)) {
			delete settingsStore[key];
		}
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
			const future = new Date();
			future.setDate(future.getDate() + 5);
			const endStr = future.toISOString().slice(0, 10);
			const startStr = new Date().toISOString().slice(0, 10);

			settingsStore.trial_start_date = startStr;
			settingsStore.trial_end_date = endStr;
			settingsStore.trial_used = '1';

			const status = await getTrialStatus('tenant1');
			expect(status.isTrialActive).toBe(true);
			expect(status.trialUsed).toBe(true);
			expect(status.daysRemaining).toBeGreaterThanOrEqual(4);
			expect(status.daysRemaining).toBeLessThanOrEqual(6);
		});

		it('returns expired trial', async () => {
			const past = new Date();
			past.setDate(past.getDate() - 2);
			const endStr = past.toISOString().slice(0, 10);
			const start = new Date();
			start.setDate(start.getDate() - 9);
			const startStr = start.toISOString().slice(0, 10);

			settingsStore.trial_start_date = startStr;
			settingsStore.trial_end_date = endStr;
			settingsStore.trial_used = '1';

			const status = await getTrialStatus('tenant1');
			expect(status.isTrialActive).toBe(false);
			expect(status.trialUsed).toBe(true);
			expect(status.daysRemaining).toBe(0);
			expect(status.trialEndDate).toBe(endStr);
		});
	});

	describe('startTrial', () => {
		it('starts a 7-day trial for new tenant', async () => {
			const result = await startTrial('tenant1');
			expect(result).toBe(true);
			expect(settingsStore.trial_used).toBe('1');
			expect(settingsStore.trial_start_date).toBeDefined();
			expect(settingsStore.trial_end_date).toBeDefined();

			// Verify end date is ~7 days from now
			const endDate = new Date(settingsStore.trial_end_date ?? '');
			const now = new Date();
			const diffDays = Math.round((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
			expect(diffDays).toBeGreaterThanOrEqual(6);
			expect(diffDays).toBeLessThanOrEqual(7);
		});

		it('skips if trial already used', async () => {
			settingsStore.trial_used = '1';
			settingsStore.trial_end_date = '2020-01-01';

			const result = await startTrial('tenant1');
			expect(result).toBe(false);
		});

		it('skips if trial already active', async () => {
			const future = new Date();
			future.setDate(future.getDate() + 3);
			settingsStore.trial_start_date = new Date().toISOString().slice(0, 10);
			settingsStore.trial_end_date = future.toISOString().slice(0, 10);
			settingsStore.trial_used = '1';

			const result = await startTrial('tenant1');
			expect(result).toBe(false);
		});
	});

	describe('isTrialActive', () => {
		it('returns true during active trial', async () => {
			const future = new Date();
			future.setDate(future.getDate() + 3);
			settingsStore.trial_end_date = future.toISOString().slice(0, 10);
			settingsStore.trial_used = '1';

			const result = await isTrialActive('tenant1');
			expect(result).toBe(true);
		});

		it('returns false when no trial', async () => {
			const result = await isTrialActive('tenant1');
			expect(result).toBe(false);
		});

		it('returns false when trial expired', async () => {
			const past = new Date();
			past.setDate(past.getDate() - 1);
			settingsStore.trial_end_date = past.toISOString().slice(0, 10);
			settingsStore.trial_used = '1';

			const result = await isTrialActive('tenant1');
			expect(result).toBe(false);
		});
	});

	describe('trial reuse prevention (G6)', () => {
		it('cannot start trial twice', async () => {
			// Start first trial
			const first = await startTrial('tenant1');
			expect(first).toBe(true);

			// Try to start again
			const second = await startTrial('tenant1');
			expect(second).toBe(false);
		});
	});
});
