import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// DynamoDB mocks
const mockSend = vi.fn();
vi.mock('$lib/server/db/dynamodb/client', () => ({
	TABLE_NAME: 'test-table',
	getDocClient: () => ({ send: mockSend }),
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
			mockSend.mockResolvedValue({ Item: undefined });
			const result = await checkAccountLockout('test@example.com');
			expect(result.locked).toBe(false);
			expect(result.failedCount).toBe(0);
		});

		it('ロック期間内ならロック状態を返す', async () => {
			const future = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10分後
			mockSend.mockResolvedValue({
				Item: {
					email: 'test@example.com',
					failedCount: 10,
					lockedUntil: future,
					lastFailedAt: new Date().toISOString(),
				},
			});
			const result = await checkAccountLockout('test@example.com');
			expect(result.locked).toBe(true);
			expect(result.remainingMinutes).toBeGreaterThan(0);
			expect(result.failedCount).toBe(10);
		});

		it('ロック期間が過ぎていればロックなし', async () => {
			const past = new Date(Date.now() - 1000).toISOString(); // 1秒前
			mockSend.mockResolvedValue({
				Item: {
					email: 'test@example.com',
					failedCount: 10,
					lockedUntil: past,
					lastFailedAt: new Date().toISOString(),
				},
			});
			const result = await checkAccountLockout('test@example.com');
			expect(result.locked).toBe(false);
		});

		it('DynamoDBエラー時はロックなしを返す（フェイルオープン）', async () => {
			mockSend.mockRejectedValue(new Error('DynamoDB error'));
			const result = await checkAccountLockout('test@example.com');
			expect(result.locked).toBe(false);
		});
	});

	describe('recordLoginFailure', () => {
		it('初回失敗でカウンター1を記録', async () => {
			// Get returns no record
			mockSend
				.mockResolvedValueOnce({ Item: undefined }) // getLockoutRecord
				.mockResolvedValueOnce({}); // putLockoutRecord
			const result = await recordLoginFailure('test@example.com');
			expect(result.locked).toBe(false);
			expect(result.failedCount).toBe(1);
		});

		it('10回目の失敗でアカウントをロック', async () => {
			mockSend
				.mockResolvedValueOnce({
					Item: {
						email: 'test@example.com',
						failedCount: 9,
						lockedUntil: null,
						lastFailedAt: new Date().toISOString(),
					},
				})
				.mockResolvedValueOnce({}); // putLockoutRecord
			const result = await recordLoginFailure('test@example.com');
			expect(result.locked).toBe(true);
			expect(result.failedCount).toBe(10);
			expect(result.remainingMinutes).toBe(30);
		});

		it('ロック期間が過ぎた後の失敗はカウント1からリセット', async () => {
			const past = new Date(Date.now() - 1000).toISOString();
			mockSend
				.mockResolvedValueOnce({
					Item: {
						email: 'test@example.com',
						failedCount: 10,
						lockedUntil: past,
						lastFailedAt: new Date().toISOString(),
					},
				})
				.mockResolvedValueOnce({}); // putLockoutRecord
			const result = await recordLoginFailure('test@example.com');
			expect(result.locked).toBe(false);
			expect(result.failedCount).toBe(1);
		});
	});

	describe('resetLoginFailures', () => {
		it('カウンターをリセット', async () => {
			mockSend
				.mockResolvedValueOnce({
					Item: {
						email: 'test@example.com',
						failedCount: 5,
						lockedUntil: null,
						lastFailedAt: new Date().toISOString(),
					},
				})
				.mockResolvedValueOnce({}); // putLockoutRecord
			await resetLoginFailures('test@example.com');
			expect(mockSend).toHaveBeenCalledTimes(2);
		});

		it('レコードがなければ何もしない', async () => {
			mockSend.mockResolvedValue({ Item: undefined });
			await resetLoginFailures('test@example.com');
			expect(mockSend).toHaveBeenCalledTimes(1); // getのみ
		});

		it('DynamoDBエラーでも例外をスローしない', async () => {
			mockSend.mockRejectedValue(new Error('DynamoDB error'));
			await expect(resetLoginFailures('test@example.com')).resolves.toBeUndefined();
		});
	});
});
