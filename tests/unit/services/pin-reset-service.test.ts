// tests/unit/services/pin-reset-service.test.ts
// #2353 設計欠陥 4: PIN reset (jose JWT 30 分 + 1 回限り) の機構テスト
//
// 注意: jose v6 webapi flavor は vitest CJS/ESM 解決の影響で TextEncoder の出力が
// `instanceof Uint8Array` ガードを通らないことがある (node 直接実行では問題なし、
// E2E でも問題なし、unit vitest 環境のみ)。jose 内部の整合性テストは E2E spec
// (tests/e2e/parent-gate.spec.ts) に委譲し、本 unit test は consume logic の
// tenant scope 整合 + verify 失敗時の error code 分類のみカバーする。

import { beforeEach, describe, expect, it, vi } from 'vitest';

// settings-repo を inmemory mock 化 (tenant-scope key/value)
vi.mock('$lib/server/db/settings-repo', () => {
	const store = new Map<string, string>();
	return {
		getSetting: vi.fn(async (key: string, tenantId: string) => {
			return store.get(`${tenantId}:${key}`);
		}),
		setSetting: vi.fn(async (key: string, value: string, tenantId: string) => {
			store.set(`${tenantId}:${key}`, value);
		}),
		__resetStore: () => store.clear(),
	};
});

vi.mock('$lib/runtime/env', () => ({
	getEnv: () => ({
		PARENT_GATE_COOKIE_SECRET: 'test-secret-for-pin-reset-32bytes',
		NODE_ENV: 'test',
		VITEST: true,
	}),
}));

beforeEach(async () => {
	const mod = (await import('$lib/server/db/settings-repo')) as unknown as {
		__resetStore: () => void;
	};
	mod.__resetStore();
});

describe('pin-reset-service: consume logic (jose-independent)', () => {
	const tenantId = 'tenant-abc-123';

	it('consumePinResetToken は JTI を tenant scope の settings に persist する', async () => {
		const { consumePinResetToken } = await import('$lib/server/services/pin-reset-service');
		const { getSetting } = await import('$lib/server/db/settings-repo');
		const jti = 'a'.repeat(32);
		await consumePinResetToken(jti, tenantId);
		const stored = await getSetting(`pin_reset_jti_consumed:${jti}`, tenantId);
		expect(stored).toBe('true');
	});

	it('別 tenant の JTI consume は本 tenant 側に影響しない', async () => {
		const { consumePinResetToken } = await import('$lib/server/services/pin-reset-service');
		const { getSetting } = await import('$lib/server/db/settings-repo');
		const jti = 'b'.repeat(32);
		await consumePinResetToken(jti, 'other-tenant');
		const storedForOriginal = await getSetting(`pin_reset_jti_consumed:${jti}`, tenantId);
		expect(storedForOriginal).toBeUndefined();
	});

	it('verifyPinResetToken は不正な形式の token を TOKEN_INVALID とする', async () => {
		const { verifyPinResetToken } = await import('$lib/server/services/pin-reset-service');
		const result = await verifyPinResetToken('not-a-jwt-format-at-all');
		expect(result.ok).toBe(false);
		expect(result.error).toBe('TOKEN_INVALID');
	});

	it('verifyPinResetToken は空文字 token を TOKEN_INVALID とする', async () => {
		const { verifyPinResetToken } = await import('$lib/server/services/pin-reset-service');
		const result = await verifyPinResetToken('');
		expect(result.ok).toBe(false);
		expect(result.error).toBe('TOKEN_INVALID');
	});

	it('RESET_TOKEN_TTL_SEC は 30 分 (1800 秒) である', async () => {
		const { RESET_TOKEN_TTL_SEC } = await import('$lib/server/services/pin-reset-service');
		expect(RESET_TOKEN_TTL_SEC).toBe(30 * 60);
	});
});
