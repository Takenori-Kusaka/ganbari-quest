// tests/unit/server/stripe/alert-integration.test.ts
//
// Phase 7 #2735 / QA Adversarial security 軸 follow-up: silent degradation 強化検証。
//
// PR #2727 (#2720) で配備済の `notifyStripeAlert` wrapper が、price-cache fallback 経路で
// **実 implementation 経由** で正しく発火することを end-to-end で検証する。
//
// 既存 test との差分:
//   - `tests/unit/server/stripe/alert.test.ts`: notifyStripeAlert 単体の動作 (mock 経由)
//   - `tests/unit/server/stripe/lookup-key-config.test.ts`: getPriceId → alert dispatch (alert を mock)
//   - **本 test**: alert.ts 実 implementation を通して discord-alert + logger まで到達する end-to-end
//
// 検証対象:
//   - kind=`stripe-lookup-failed` (Phase 6 子 5 §6 R4 SSOT) 経路で
//     (1) logger.warn が CloudWatch Logs Insights 検索可能な structured context で出力
//     (2) sendDiscordAlert が fire-and-forget で起動 (await 不要、課金 path をブロックしない)
//     (3) tags (plan / lookupKey / fallbackUsed) が context に含まれる
//
// 設計 SSOT:
//   - docs/decisions/0059-phase7-cutover-sequence.md §「結果」§2 kill switch
//   - docs/design/billing-redesign/phase6-rollback-and-kill-switches.md §3 §6 alert SSOT
//   - src/lib/server/stripe/alert.ts (PR #2727、本 test の対象)
//   - src/lib/server/stripe/config.ts L189-232 getPriceId fallback 経路

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// discord-alert と logger を mock (alert.ts 経由で呼ばれることを assert)
vi.mock('../../../../src/lib/server/discord-alert', () => ({
	sendDiscordAlert: vi.fn(),
}));
vi.mock('../../../../src/lib/server/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		critical: vi.fn(),
	},
}));
// price-cache を mock (Stripe API 障害を simulate)
vi.mock('../../../../src/lib/server/stripe/price-cache', () => ({
	getPriceByLookupKey: vi.fn(),
}));

import { sendDiscordAlert } from '$lib/server/discord-alert';
import { logger } from '$lib/server/logger';
import { getPriceId } from '$lib/server/stripe/config';
import { getPriceByLookupKey } from '$lib/server/stripe/price-cache';

const sendDiscordAlertMock = vi.mocked(sendDiscordAlert);
const loggerWarnMock = vi.mocked(logger.warn);
const getPriceByLookupKeyMock = vi.mocked(getPriceByLookupKey);

const ENV_KEYS = ['USE_LOOKUP_KEY', 'STRIPE_PRICE_STANDARD_MONTHLY', 'STRIPE_PRICE_FAMILY_MONTHLY'];

function clearEnvKeys() {
	for (const key of ENV_KEYS) {
		delete process.env[key];
	}
}

let originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
	originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
	clearEnvKeys();
	sendDiscordAlertMock.mockReset();
	sendDiscordAlertMock.mockResolvedValue(undefined);
	loggerWarnMock.mockReset();
	getPriceByLookupKeyMock.mockReset();
});

afterEach(() => {
	clearEnvKeys();
	for (const [k, v] of Object.entries(originalEnv)) {
		if (v !== undefined) process.env[k] = v;
	}
});

describe('silent degradation end-to-end (#2735 / kill switch fallback alert 統合)', () => {
	it('getPriceId fallback → notifyStripeAlert → logger.warn + sendDiscordAlert まで到達 (silent degradation 解消の end-to-end 証跡)', async () => {
		// scenario: USE_LOOKUP_KEY=true で Stripe API が 500 を返した kill switch fallback
		process.env.USE_LOOKUP_KEY = 'true';
		process.env.STRIPE_PRICE_STANDARD_MONTHLY = 'price_env_fallback';
		getPriceByLookupKeyMock.mockRejectedValue(new Error('Stripe API 500 Internal Server Error'));

		const result = await getPriceId('standard');

		// 1. 課金 path は env var fallback で継続 (kill switch 動作)
		expect(result).toBe('price_env_fallback');

		// 2. logger.warn が CloudWatch Logs Insights 検索可能な structured context で出力
		//    (Sentry SaaS 統合は別 Issue、本 test では logger 経由の structured log のみ assert)
		expect(loggerWarnMock).toHaveBeenCalledTimes(1);
		const loggerArgs = loggerWarnMock.mock.calls[0];
		const loggerMsg = loggerArgs?.[0] as string;
		const loggerCtx = loggerArgs?.[1];

		expect(loggerMsg).toContain('[stripe-alert] stripe-lookup-failed');
		expect(loggerCtx?.service).toBe('stripe');
		expect(loggerCtx?.context).toMatchObject({
			kind: 'stripe-lookup-failed',
			plan: 'standard',
			lookupKey: 'standard_monthly',
			fallbackUsed: true,
		});

		// 3. sendDiscordAlert が fire-and-forget で起動 (await 不要)
		expect(sendDiscordAlertMock).toHaveBeenCalledTimes(1);
		const discordCall = sendDiscordAlertMock.mock.calls[0]?.[0];
		expect(discordCall?.level).toBe('error');
		expect(discordCall?.message).toContain('[stripe-lookup-failed]');
		expect(discordCall?.errorSummary).toContain('lookup_failed:standard_monthly');
	});

	it('致命 path (lookup_key + env var 双方 NG) でも notifyStripeAlert は起動する (fallbackUsed=false)', async () => {
		// scenario: USE_LOOKUP_KEY=true で Stripe API 障害 + env var も未配備の最悪 case
		// 課金 path は throw するが、Discord alert は必ず起動して observability を担保する
		process.env.USE_LOOKUP_KEY = 'true';
		// env var は未配備
		getPriceByLookupKeyMock.mockRejectedValue(new Error('INVALID_LOOKUP_KEY: premium_monthly'));

		await expect(getPriceId('premium')).rejects.toThrowError(/MISSING_PRICE_ID/);

		expect(loggerWarnMock).toHaveBeenCalledTimes(1);
		const loggerCtx = loggerWarnMock.mock.calls[0]?.[1]?.context as Record<string, unknown>;
		expect(loggerCtx?.kind).toBe('stripe-lookup-failed');
		expect(loggerCtx?.fallbackUsed).toBe(false); // ← 致命 path の signal

		expect(sendDiscordAlertMock).toHaveBeenCalledTimes(1);
		const discordCall = sendDiscordAlertMock.mock.calls[0]?.[0];
		expect(discordCall?.message).toContain('課金 path 停止');
	});

	it('Discord alert dispatch 失敗 (5xx) でも getPriceId 自体は成功する (fire-and-forget 整合、課金 path 非ブロッキング)', async () => {
		process.env.USE_LOOKUP_KEY = 'true';
		process.env.STRIPE_PRICE_STANDARD_MONTHLY = 'price_env_fallback';
		getPriceByLookupKeyMock.mockRejectedValue(new Error('Stripe API timeout'));
		// Discord webhook 自体も 5xx で失敗
		sendDiscordAlertMock.mockRejectedValueOnce(new Error('Discord webhook 503'));

		// getPriceId は throw しない (fire-and-forget、課金 path 継続)
		const result = await getPriceId('standard');
		expect(result).toBe('price_env_fallback');

		// microtask flush で alert dispatch の .catch() を起動
		await new Promise((r) => setImmediate(r));

		// logger.warn は 2 回呼ばれる (1: alert 主体、2: dispatch failure)
		expect(loggerWarnMock.mock.calls.length).toBeGreaterThanOrEqual(2);
		// sendDiscordAlert は 1 回のみ (recursive alert 抑制、alert.ts L100-106 整合)
		expect(sendDiscordAlertMock).toHaveBeenCalledTimes(1);
	});

	it('正常 path (lookup_key 解決成功) では alert を起動しない (Discord channel ノイズ防止)', async () => {
		process.env.USE_LOOKUP_KEY = 'true';
		getPriceByLookupKeyMock.mockResolvedValue('price_lookup_success');

		const result = await getPriceId('standard');
		expect(result).toBe('price_lookup_success');

		expect(loggerWarnMock).not.toHaveBeenCalled();
		expect(sendDiscordAlertMock).not.toHaveBeenCalled();
	});

	it('CloudWatch Logs Insights query 例 (kind フィルタ) と整合する context structure を出力', async () => {
		// 本 test は alert.ts L82-92 の logger.warn 第 2 引数の structure を SSOT として固定する。
		// CloudWatch Logs Insights query:
		//   fields @timestamp, message, service, context.kind, context.plan, context.lookupKey, context.fallbackUsed
		//   | filter service = "stripe" and context.kind = "stripe-lookup-failed"
		//   | sort @timestamp desc
		//   | limit 50
		// この query が成立するためには context.kind が **第 2 引数 .context** に必ず存在する必要がある。
		process.env.USE_LOOKUP_KEY = 'true';
		process.env.STRIPE_PRICE_FAMILY_MONTHLY = 'price_env_fallback';
		getPriceByLookupKeyMock.mockRejectedValue(new Error('Stripe API timeout'));

		// getPriceId 完了まで await (notifyStripeAlert は内部で同期的に logger.warn 呼出)
		await getPriceId('premium');

		expect(loggerWarnMock).toHaveBeenCalled();
		const callArgs = loggerWarnMock.mock.calls[0];
		const ctx = callArgs?.[1];

		// CloudWatch Logs Insights query 適合: service + context.kind の 2 field 必須
		expect(ctx).toHaveProperty('service', 'stripe');
		expect(ctx).toHaveProperty('context');
		expect(ctx?.context).toHaveProperty('kind', 'stripe-lookup-failed');
		expect(ctx?.context).toHaveProperty('plan');
		expect(ctx?.context).toHaveProperty('lookupKey');
		expect(ctx?.context).toHaveProperty('fallbackUsed');
	});
});
