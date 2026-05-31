// tests/unit/server/stripe/webhook-shadow-mode-config.test.ts
//
// Phase 7 PR-4a / Issue #2713: shadow mode 用 config 関数の env 解釈テスト。
//
// `src/lib/server/stripe/config.ts` の以下 2 関数:
//   - `isWebhookShadowModeEnabled()`: `STRIPE_WEBHOOK_SHADOW_MODE === 'true'` の厳密判定
//   - `getWebhookSecretForShadow()`: `STRIPE_WEBHOOK_SECRET_TEST` 優先 + 本番 secret fallback
//
// 設計 SSOT:
//   - docs/decisions/0059-phase7-cutover-sequence.md
//   - docs/design/billing-redesign/phase6-rollback-and-kill-switches.md §S6

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getWebhookSecretForShadow, isWebhookShadowModeEnabled } from '$lib/server/stripe/config';

const KEYS = ['STRIPE_WEBHOOK_SHADOW_MODE', 'STRIPE_WEBHOOK_SECRET_TEST', 'STRIPE_WEBHOOK_SECRET'];

function clearEnvKeys() {
	for (const key of KEYS) {
		delete process.env[key];
	}
}

let originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
	originalEnv = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
	clearEnvKeys();
});

afterEach(() => {
	clearEnvKeys();
	for (const [k, v] of Object.entries(originalEnv)) {
		if (v !== undefined) process.env[k] = v;
	}
});

describe('isWebhookShadowModeEnabled (#2713)', () => {
	it('env 未設定なら false', () => {
		expect(isWebhookShadowModeEnabled()).toBe(false);
	});

	it("'true' (lowercase 文字列) のみ true", () => {
		process.env.STRIPE_WEBHOOK_SHADOW_MODE = 'true';
		expect(isWebhookShadowModeEnabled()).toBe(true);
	});

	it("'false' / 'TRUE' / '1' / 任意の他値は false (誤切替防止)", () => {
		for (const value of ['false', 'TRUE', '1', '0', 'yes', '']) {
			process.env.STRIPE_WEBHOOK_SHADOW_MODE = value;
			expect(isWebhookShadowModeEnabled()).toBe(false);
		}
	});
});

describe('getWebhookSecretForShadow (#2713)', () => {
	it('STRIPE_WEBHOOK_SECRET_TEST が優先される', () => {
		process.env.STRIPE_WEBHOOK_SECRET_TEST = 'whsec_test_xxx';
		process.env.STRIPE_WEBHOOK_SECRET = 'whsec_prod_yyy';
		expect(getWebhookSecretForShadow()).toBe('whsec_test_xxx');
	});

	it('STRIPE_WEBHOOK_SECRET_TEST 未設定なら STRIPE_WEBHOOK_SECRET にフォールバック', () => {
		process.env.STRIPE_WEBHOOK_SECRET = 'whsec_prod_only';
		expect(getWebhookSecretForShadow()).toBe('whsec_prod_only');
	});

	it('両方未設定なら throw (kill switch 安全側)', () => {
		expect(() => getWebhookSecretForShadow()).toThrowError(
			/STRIPE_WEBHOOK_SECRET_TEST or STRIPE_WEBHOOK_SECRET/,
		);
	});
});
