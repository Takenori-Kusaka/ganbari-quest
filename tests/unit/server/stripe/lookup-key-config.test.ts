// tests/unit/server/stripe/lookup-key-config.test.ts
//
// Phase 7 PR-3a / Issue #2716: lookup_key 経由 + USE_LOOKUP_KEY flag 並行運用テスト。
//
// `src/lib/server/stripe/config.ts` の以下 2 関数:
//   - `isLookupKeyEnabled()`: `USE_LOOKUP_KEY === 'true'` の厳密判定
//   - `getPriceId(plan, interval)`: flag 分岐 (env var 直読 / lookup_key 経由 + fallback)
//
// 設計 SSOT:
//   - docs/decisions/0059-phase7-cutover-sequence.md §「結果」§1-2
//   - docs/design/billing-redesign/phase6-context-decisions-6.md §4 lookup_key 段階移行

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// price-cache を mock (getPriceByLookupKey)
vi.mock('../../../../src/lib/server/stripe/price-cache', () => ({
	getPriceByLookupKey: vi.fn(),
}));

import { getPriceId, isLookupKeyEnabled } from '$lib/server/stripe/config';
import { getPriceByLookupKey } from '$lib/server/stripe/price-cache';

const ENV_KEYS = [
	'USE_LOOKUP_KEY',
	'STRIPE_PRICE_STANDARD_MONTHLY',
	'STRIPE_PRICE_MONTHLY',
	'STRIPE_PRICE_FAMILY_MONTHLY',
];

function clearEnvKeys() {
	for (const key of ENV_KEYS) {
		delete process.env[key];
	}
}

let originalEnv: Record<string, string | undefined> = {};

const getPriceByLookupKeyMock = vi.mocked(getPriceByLookupKey);

beforeEach(() => {
	originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
	clearEnvKeys();
	getPriceByLookupKeyMock.mockReset();
});

afterEach(() => {
	clearEnvKeys();
	for (const [k, v] of Object.entries(originalEnv)) {
		if (v !== undefined) process.env[k] = v;
	}
});

describe('isLookupKeyEnabled (#2716)', () => {
	it('env 未設定なら false (default 安全側)', () => {
		expect(isLookupKeyEnabled()).toBe(false);
	});

	it("'true' (lowercase 文字列) のみ true", () => {
		process.env.USE_LOOKUP_KEY = 'true';
		expect(isLookupKeyEnabled()).toBe(true);
	});

	it("'false' / 'TRUE' / '1' / 任意の他値は false (誤切替防止、PR-4a パターン整合)", () => {
		for (const value of ['false', 'TRUE', '1', '0', 'yes', '']) {
			process.env.USE_LOOKUP_KEY = value;
			expect(isLookupKeyEnabled()).toBe(false);
		}
	});
});

describe('getPriceId — USE_LOOKUP_KEY=false (default、env var 直読) (#2716)', () => {
	it('standard / monthly: STRIPE_PRICE_STANDARD_MONTHLY 優先', async () => {
		process.env.STRIPE_PRICE_STANDARD_MONTHLY = 'price_std_new';
		process.env.STRIPE_PRICE_MONTHLY = 'price_std_legacy';
		expect(await getPriceId('standard', 'monthly')).toBe('price_std_new');
		expect(getPriceByLookupKeyMock).not.toHaveBeenCalled();
	});

	it('standard / monthly: 旧名 STRIPE_PRICE_MONTHLY に fallback (#2347 整合)', async () => {
		process.env.STRIPE_PRICE_MONTHLY = 'price_std_legacy';
		expect(await getPriceId('standard', 'monthly')).toBe('price_std_legacy');
	});

	it('premium / monthly: STRIPE_PRICE_FAMILY_MONTHLY 直読 (premium = family rename 過渡期)', async () => {
		process.env.STRIPE_PRICE_FAMILY_MONTHLY = 'price_prm';
		expect(await getPriceId('premium', 'monthly')).toBe('price_prm');
		expect(getPriceByLookupKeyMock).not.toHaveBeenCalled();
	});

	it('env 未設定なら MISSING_PRICE_ID で throw', async () => {
		await expect(getPriceId('standard', 'monthly')).rejects.toThrowError(/MISSING_PRICE_ID/);
	});
});

describe('getPriceId — USE_LOOKUP_KEY=true (lookup_key 経路) (#2716)', () => {
	beforeEach(() => {
		process.env.USE_LOOKUP_KEY = 'true';
	});

	it('standard / monthly: lookup_key=standard_monthly で解決', async () => {
		getPriceByLookupKeyMock.mockResolvedValue('price_std_via_lookup');
		expect(await getPriceId('standard', 'monthly')).toBe('price_std_via_lookup');
		expect(getPriceByLookupKeyMock).toHaveBeenCalledWith('standard_monthly');
	});

	it('premium / monthly: lookup_key=premium_monthly で解決', async () => {
		getPriceByLookupKeyMock.mockResolvedValue('price_prm_via_lookup');
		expect(await getPriceId('premium', 'monthly')).toBe('price_prm_via_lookup');
		expect(getPriceByLookupKeyMock).toHaveBeenCalledWith('premium_monthly');
	});

	it('Stripe API 障害時は env var fallback (kill switch、context-decisions-6 §4.3 整合)', async () => {
		process.env.STRIPE_PRICE_STANDARD_MONTHLY = 'price_std_env_fallback';
		getPriceByLookupKeyMock.mockRejectedValue(new Error('Stripe API timeout'));
		expect(await getPriceId('standard', 'monthly')).toBe('price_std_env_fallback');
	});

	it('lookup_key 失敗 + env var 双方 NG なら MISSING_PRICE_ID で throw', async () => {
		getPriceByLookupKeyMock.mockRejectedValue(new Error('INVALID_LOOKUP_KEY'));
		// env var も未設定
		await expect(getPriceId('standard', 'monthly')).rejects.toThrowError(/MISSING_PRICE_ID/);
	});
});

describe('getPriceId — 並行運用整合 (両モードで同じ Price ID 解決) (#2716)', () => {
	it('USE_LOOKUP_KEY 切替前後で同じ priceId が解決される (検証手段)', async () => {
		process.env.STRIPE_PRICE_STANDARD_MONTHLY = 'price_same';
		getPriceByLookupKeyMock.mockResolvedValue('price_same');

		// flag OFF (env var 直読)
		process.env.USE_LOOKUP_KEY = 'false';
		const offResult = await getPriceId('standard', 'monthly');

		// flag ON (lookup_key 経由)
		process.env.USE_LOOKUP_KEY = 'true';
		const onResult = await getPriceId('standard', 'monthly');

		expect(offResult).toBe(onResult);
		expect(offResult).toBe('price_same');
	});
});
