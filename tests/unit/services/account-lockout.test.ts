import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Facade mocks (replaces DynamoDB direct mocks)
const mockGetLockout = vi.fn();
const mockUpsertLockout = vi.fn();
vi.mock('$lib/server/db/account-lockout-repo', () => ({
	getLockout: (...args: unknown[]) => mockGetLockout(...args),
	upsertLockout: (...args: unknown[]) => mockUpsertLockout(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { warn: vi.fn(), info: vi.fn() },
}));

import {
	checkAccountLockout,
	recordLoginFailure,
	resetLoginFailures,
} from '$lib/server/security/account-lockout';

describe('account-lockout', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('checkAccountLockout', () => {
		it('レコードがなければロックなし', async () => {
			mockGetLockout.mockResolvedValue(null);
			const result = await checkAccountLockout('test@example.com');
			expect(result.locked).toBe(false);
			expect(result.failedCount).toBe(0);
		});

		it('ロック期間内ならロック状態を返す', async () => {
			const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
			mockGetLockout.mockResolvedValue({
				email: 'test@example.com',
				failedCount: 10,
				lockedUntil: future,
				lastFailedAt: new Date().toISOString(),
			});
			const result = await checkAccountLockout('test@example.com');
			expect(result.locked).toBe(true);
			expect(result.remainingMinutes).toBeGreaterThan(0);
			expect(result.failedCount).toBe(10);
		});

		it('ロック期間が過ぎていればロックなし', async () => {
			const past = new Date(Date.now() - 1000).toISOString();
			mockGetLockout.mockResolvedValue({
				email: 'test@example.com',
				failedCount: 10,
				lockedUntil: past,
				lastFailedAt: new Date().toISOString(),
			});
			const result = await checkAccountLockout('test@example.com');
			expect(result.locked).toBe(false);
		});

		it('リポジトリエラー時はロックなしを返す（フェイルオープン）', async () => {
			mockGetLockout.mockRejectedValue(new Error('DB error'));
			const result = await checkAccountLockout('test@example.com');
			expect(result.locked).toBe(false);
		});
	});

	describe('recordLoginFailure', () => {
		it('初回失敗でカウンター1を記録', async () => {
			mockGetLockout.mockResolvedValue(null);
			mockUpsertLockout.mockResolvedValue(undefined);
			const result = await recordLoginFailure('test@example.com');
			expect(result.locked).toBe(false);
			expect(result.failedCount).toBe(1);
			expect(mockUpsertLockout).toHaveBeenCalledWith(
				expect.objectContaining({ failedCount: 1, lockedUntil: null }),
			);
		});

		it('10回目の失敗でアカウントをロック', async () => {
			mockGetLockout.mockResolvedValue({
				email: 'test@example.com',
				failedCount: 9,
				lockedUntil: null,
				lastFailedAt: new Date().toISOString(),
			});
			mockUpsertLockout.mockResolvedValue(undefined);
			const result = await recordLoginFailure('test@example.com');
			expect(result.locked).toBe(true);
			expect(result.failedCount).toBe(10);
			expect(result.remainingMinutes).toBe(30);
			expect(mockUpsertLockout).toHaveBeenCalledWith(
				expect.objectContaining({ failedCount: 10, lockedUntil: expect.any(String) }),
			);
		});

		it('ロック期間が過ぎた後の失敗はカウント1からリセット', async () => {
			const past = new Date(Date.now() - 1000).toISOString();
			mockGetLockout.mockResolvedValue({
				email: 'test@example.com',
				failedCount: 10,
				lockedUntil: past,
				lastFailedAt: new Date().toISOString(),
			});
			mockUpsertLockout.mockResolvedValue(undefined);
			const result = await recordLoginFailure('test@example.com');
			expect(result.locked).toBe(false);
			expect(result.failedCount).toBe(1);
		});
	});

	describe('resetLoginFailures', () => {
		it('カウンターをリセット', async () => {
			mockGetLockout.mockResolvedValue({
				email: 'test@example.com',
				failedCount: 5,
				lockedUntil: null,
				lastFailedAt: new Date().toISOString(),
			});
			mockUpsertLockout.mockResolvedValue(undefined);
			await resetLoginFailures('test@example.com');
			expect(mockUpsertLockout).toHaveBeenCalledWith(
				expect.objectContaining({ failedCount: 0, lockedUntil: null }),
			);
		});

		it('レコードがなければ何もしない', async () => {
			mockGetLockout.mockResolvedValue(null);
			await resetLoginFailures('test@example.com');
			expect(mockUpsertLockout).not.toHaveBeenCalled();
		});

		it('リポジトリエラーでも例外をスローしない', async () => {
			mockGetLockout.mockRejectedValue(new Error('DB error'));
			await expect(resetLoginFailures('test@example.com')).resolves.toBeUndefined();
		});
	});
});
