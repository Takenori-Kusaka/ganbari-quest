/**
 * Unit tests for test-user-factory (ADR-0030 D-3).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CognitoAdminClient } from '../../../tests/e2e/helpers/cognito-admin-client';
import {
	buildTestUserEmail,
	createTestUser,
	generateTestPassword,
	withTestUser,
} from '../../../tests/e2e/helpers/test-user-factory';

function fakeAdminClient(): CognitoAdminClient & {
	createUser: ReturnType<typeof vi.fn>;
	deleteUser: ReturnType<typeof vi.fn>;
} {
	return {
		createUser: vi.fn().mockResolvedValue({ userId: 'sub-abc', email: 'ignored', enabled: true }),
		deleteUser: vi.fn().mockResolvedValue(undefined),
	} as unknown as CognitoAdminClient & {
		createUser: ReturnType<typeof vi.fn>;
		deleteUser: ReturnType<typeof vi.fn>;
	};
}

describe('buildTestUserEmail', () => {
	const origEnv = { ...process.env };

	afterEach(() => {
		process.env = { ...origEnv };
	});

	it('uses ganbari-quest.test TLD per ADR-0030 D-3', () => {
		const email = buildTestUserEmail();
		expect(email.endsWith('@ganbari-quest.test')).toBe(true);
	});

	it('never uses production @ganbari-quest.com domain', () => {
		for (let i = 0; i < 20; i++) {
			expect(buildTestUserEmail().endsWith('@ganbari-quest.com')).toBe(false);
		}
	});

	it('includes date / sha / run / worker / uuid segments', () => {
		process.env.GITHUB_SHA = 'abc1234567890';
		process.env.GITHUB_RUN_ATTEMPT = '3';
		const email = buildTestUserEmail({ workerIndex: 5 });
		expect(email).toMatch(/^e2e-\d{4}-\d{2}-\d{2}-abc1234-3-w5-[0-9a-f]{8}@ganbari-quest\.test$/);
	});

	it('generates unique emails across calls (UUID collision resistance)', () => {
		const seen = new Set<string>();
		for (let i = 0; i < 100; i++) {
			seen.add(buildTestUserEmail());
		}
		expect(seen.size).toBe(100);
	});

	it('falls back to localdev / 0 when GITHUB env is absent', () => {
		delete process.env.GITHUB_SHA;
		delete process.env.GITHUB_RUN_ATTEMPT;
		delete process.env.TEST_WORKER_INDEX;
		const email = buildTestUserEmail();
		// 'localdev' sliced to 7 chars = 'localde'
		expect(email).toMatch(/-localde-0-w0-[0-9a-f]{8}@ganbari-quest\.test$/);
	});
});

describe('generateTestPassword', () => {
	it('meets Cognito default password policy (upper/lower/digit/symbol, 8+)', () => {
		for (let i = 0; i < 10; i++) {
			const pw = generateTestPassword();
			expect(pw.length).toBeGreaterThanOrEqual(8);
			expect(pw).toMatch(/[A-Z]/);
			expect(pw).toMatch(/[a-z]/);
			expect(pw).toMatch(/\d/);
			expect(pw).toMatch(/[!@#$%^&*()_+=\-/]/);
		}
	});

	it('generates different passwords each call', () => {
		const pw1 = generateTestPassword();
		const pw2 = generateTestPassword();
		expect(pw1).not.toBe(pw2);
	});
});

describe('createTestUser', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns TestUser with email/password/userId and cleanup function', async () => {
		const client = fakeAdminClient();
		const user = await createTestUser({ adminClient: client });

		expect(user.email).toMatch(/@ganbari-quest\.test$/);
		expect(user.password.length).toBeGreaterThanOrEqual(16);
		expect(user.userId).toBe('sub-abc');
		expect(typeof user.cleanup).toBe('function');

		expect(client.createUser).toHaveBeenCalledWith(
			expect.objectContaining({
				email: user.email,
				password: user.password,
			}),
		);
	});

	it('passes groups through to adminClient', async () => {
		const client = fakeAdminClient();
		await createTestUser({ adminClient: client, groups: ['ops'] });
		expect(client.createUser).toHaveBeenCalledWith(expect.objectContaining({ groups: ['ops'] }));
	});

	it('cleanup() deletes the user and is idempotent when user already gone', async () => {
		const client = fakeAdminClient();
		const notFound = Object.assign(new Error('not found'), { name: 'UserNotFoundException' });
		client.deleteUser.mockRejectedValueOnce(notFound);

		const user = await createTestUser({ adminClient: client });
		await expect(user.cleanup()).resolves.not.toThrow();
		expect(client.deleteUser).toHaveBeenCalledWith(user.email);
	});

	it('cleanup() rethrows non-UserNotFound errors', async () => {
		const client = fakeAdminClient();
		client.deleteUser.mockRejectedValueOnce(new Error('network boom'));

		const user = await createTestUser({ adminClient: client });
		await expect(user.cleanup()).rejects.toThrow(/network boom/);
	});
});

describe('withTestUser', () => {
	it('runs fn then cleans up on success', async () => {
		const client = fakeAdminClient();
		const result = await withTestUser({ adminClient: client }, async (user) => {
			expect(user.email).toMatch(/@ganbari-quest\.test$/);
			return 42;
		});
		expect(result).toBe(42);
		expect(client.deleteUser).toHaveBeenCalledTimes(1);
	});

	it('cleans up even when fn throws', async () => {
		const client = fakeAdminClient();
		await expect(
			withTestUser({ adminClient: client }, async () => {
				throw new Error('test body failure');
			}),
		).rejects.toThrow(/test body failure/);
		expect(client.deleteUser).toHaveBeenCalledTimes(1);
	});
});
