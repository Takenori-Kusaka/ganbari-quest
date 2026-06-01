// tests/unit/server/stripe/lookup-key-config.test.ts
//
// Phase 7 PR-3a / Issue #2716: lookup_key 経由 + USE_LOOKUP_KEY flag 並行運用テスト。
// #2719 (PR-3b prerequisite): yearly 経路 + 旧名 STRIPE_PRICE_MONTHLY legacy 物理削除に伴い、
//   `getPriceId(plan)` (interval 引数削除) signature 整合 + 旧名 fallback テスト撤去。
//
// `src/lib/server/stripe/config.ts` の以下 2 関数:
//   - `isLookupKeyEnabled()`: `USE_LOOKUP_KEY === 'true'` の厳密判定
//   - `getPriceId(plan)`: flag 分岐 (env var 直読 / lookup_key 経由 + fallback)
//
// 設計 SSOT:
//   - docs/decisions/0059-phase7-cutover-sequence.md §「結果」§1-2
//   - docs/design/billing-redesign/phase6-context-decisions-6.md §4 lookup_key 段階移行
//   - docs/design/billing-redesign/phase1-plan-naming-pricing-axis-requirements.md §FR-2 (年額廃止)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// price-cache を mock (getPriceByLookupKey)
vi.mock('../../../../src/lib/server/stripe/price-cache', () => ({
	getPriceByLookupKey: vi.fn(),
}));
// alert を mock (#2720: notifyStripeAlert 呼出 assert 用)
vi.mock('../../../../src/lib/server/stripe/alert', () => ({
	notifyStripeAlert: vi.fn(),
}));

import { notifyStripeAlert } from '$lib/server/stripe/alert';
import { getPriceId, isLookupKeyEnabled } from '$lib/server/stripe/config';
import { getPriceByLookupKey } from '$lib/server/stripe/price-cache';

const ENV_KEYS = ['USE_LOOKUP_KEY', 'STRIPE_PRICE_STANDARD_MONTHLY', 'STRIPE_PRICE_FAMILY_MONTHLY'];

function clearEnvKeys() {
	for (const key of ENV_KEYS) {
		delete process.env[key];
	}
}

let originalEnv: Record<string, string | undefined> = {};

const getPriceByLookupKeyMock = vi.mocked(getPriceByLookupKey);
const notifyStripeAlertMock = vi.mocked(notifyStripeAlert);

beforeEach(() => {
	originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
	clearEnvKeys();
	getPriceByLookupKeyMock.mockReset();
	notifyStripeAlertMock.mockReset();
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

describe('getPriceId — USE_LOOKUP_KEY=false (default、env var 直読) (#2716 / #2719)', () => {
	it('standard: STRIPE_PRICE_STANDARD_MONTHLY を直読', async () => {
		process.env.STRIPE_PRICE_STANDARD_MONTHLY = 'price_std_new';
		expect(await getPriceId('standard')).toBe('price_std_new');
		expect(getPriceByLookupKeyMock).not.toHaveBeenCalled();
	});

	it('premium: STRIPE_PRICE_FAMILY_MONTHLY 直読 (premium = family rename 過渡期)', async () => {
		process.env.STRIPE_PRICE_FAMILY_MONTHLY = 'price_prm';
		expect(await getPriceId('premium')).toBe('price_prm');
		expect(getPriceByLookupKeyMock).not.toHaveBeenCalled();
	});

	it('env 未設定なら MISSING_PRICE_ID で throw', async () => {
		await expect(getPriceId('standard')).rejects.toThrowError(/MISSING_PRICE_ID/);
	});
});

describe('getPriceId — USE_LOOKUP_KEY=true (lookup_key 経路) (#2716)', () => {
	beforeEach(() => {
		process.env.USE_LOOKUP_KEY = 'true';
	});

	it('standard / monthly: lookup_key=standard_monthly で解決', async () => {
		getPriceByLookupKeyMock.mockResolvedValue('price_std_via_lookup');
		expect(await getPriceId('standard')).toBe('price_std_via_lookup');
		expect(getPriceByLookupKeyMock).toHaveBeenCalledWith('standard_monthly');
	});

	it('premium / monthly: lookup_key=premium_monthly で解決', async () => {
		getPriceByLookupKeyMock.mockResolvedValue('price_prm_via_lookup');
		expect(await getPriceId('premium')).toBe('price_prm_via_lookup');
		expect(getPriceByLookupKeyMock).toHaveBeenCalledWith('premium_monthly');
	});

	it('Stripe API 障害時は env var fallback (kill switch、context-decisions-6 §4.3 整合)', async () => {
		process.env.STRIPE_PRICE_STANDARD_MONTHLY = 'price_std_env_fallback';
		getPriceByLookupKeyMock.mockRejectedValue(new Error('Stripe API timeout'));
		expect(await getPriceId('standard')).toBe('price_std_env_fallback');
	});

	it('fallback 発動時に notifyStripeAlert が起動する (#2720 silent degradation 防止)', async () => {
		process.env.STRIPE_PRICE_STANDARD_MONTHLY = 'price_std_env_fallback';
		getPriceByLookupKeyMock.mockRejectedValue(new Error('Stripe API 500'));

		const result = await getPriceId('standard');

		expect(result).toBe('price_std_env_fallback'); // 課金 path は継続 (fire-and-forget)
		expect(notifyStripeAlertMock).toHaveBeenCalledTimes(1);
		const callArg = notifyStripeAlertMock.mock.calls[0]?.[0];
		expect(callArg?.kind).toBe('stripe-lookup-failed');
		expect(callArg?.tags?.fallbackUsed).toBe(true);
		expect(callArg?.tags?.plan).toBe('standard');
		expect(callArg?.tags?.lookupKey).toBe('standard_monthly');
	});

	it('lookup_key 失敗 + env var 双方 NG なら MISSING_PRICE_ID で throw', async () => {
		getPriceByLookupKeyMock.mockRejectedValue(new Error('INVALID_LOOKUP_KEY'));
		// env var も未設定
		await expect(getPriceId('standard')).rejects.toThrowError(/MISSING_PRICE_ID/);
	});

	it('lookup_key 失敗 + env var 双方 NG 時も notifyStripeAlert が起動する (致命 alert、fallbackUsed=false)', async () => {
		getPriceByLookupKeyMock.mockRejectedValue(new Error('INVALID_LOOKUP_KEY'));
		// env var も未設定

		await expect(getPriceId('premium')).rejects.toThrowError(/MISSING_PRICE_ID/);
		expect(notifyStripeAlertMock).toHaveBeenCalledTimes(1);
		const callArg = notifyStripeAlertMock.mock.calls[0]?.[0];
		expect(callArg?.kind).toBe('stripe-lookup-failed');
		expect(callArg?.tags?.fallbackUsed).toBe(false);
		expect(callArg?.tags?.plan).toBe('premium');
	});

	it('lookup_key 成功時は notifyStripeAlert を起動しない (正常 path で alert 抑制、Discord channel ノイズ防止)', async () => {
		getPriceByLookupKeyMock.mockResolvedValue('price_std_via_lookup');

		await getPriceId('standard');

		expect(notifyStripeAlertMock).not.toHaveBeenCalled();
	});
});

describe('getPriceId — 並行運用整合 (両モードで同じ Price ID 解決) (#2716)', () => {
	it('USE_LOOKUP_KEY 切替前後で同じ priceId が解決される (検証手段)', async () => {
		process.env.STRIPE_PRICE_STANDARD_MONTHLY = 'price_same';
		getPriceByLookupKeyMock.mockResolvedValue('price_same');

		// flag OFF (env var 直読)
		process.env.USE_LOOKUP_KEY = 'false';
		const offResult = await getPriceId('standard');

		// flag ON (lookup_key 経由)
		process.env.USE_LOOKUP_KEY = 'true';
		const onResult = await getPriceId('standard');

		expect(offResult).toBe(onResult);
		expect(offResult).toBe('price_same');
	});
});
