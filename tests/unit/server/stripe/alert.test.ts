// tests/unit/server/stripe/alert.test.ts
//
// Phase 7 PR-3b prerequisite / Issue #2720: `notifyStripeAlert` の動作検証。
//
// 検証内容:
//   - 3 種 alert kind (stripe-lookup-failed / stripe-webhook-unknown-type
//     / stripe-webhook-handler-typeerror) で `sendDiscordAlert` + `logger.warn` 両方発火
//   - fire-and-forget: alert 失敗が caller を blocking しない
//   - structured logger context (tags) が context フィールドに含まれる
//   - errorSummary が embed Error field に渡される
//
// 設計 SSOT:
//   - docs/design/billing-redesign/phase6-rollback-and-kill-switches.md §6 R1/R4/R5
//   - src/lib/server/stripe/alert.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 順序: vi.mock を import 前に hoist
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

import { sendDiscordAlert } from '$lib/server/discord-alert';
import { logger } from '$lib/server/logger';
import { notifyStripeAlert } from '$lib/server/stripe/alert';

const sendDiscordAlertMock = vi.mocked(sendDiscordAlert);
const loggerWarnMock = vi.mocked(logger.warn);

beforeEach(() => {
	sendDiscordAlertMock.mockReset();
	sendDiscordAlertMock.mockResolvedValue(undefined);
	loggerWarnMock.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('notifyStripeAlert — 基本動作 (#2720)', () => {
	it('logger.warn + sendDiscordAlert の両方を発火する (silent degradation 防止)', () => {
		notifyStripeAlert({
			kind: 'stripe-lookup-failed',
			message: 'lookup_key 解決失敗 → env var fallback 起動',
			errorSummary: 'lookup_failed:standard_monthly',
			tags: { plan: 'standard', interval: 'monthly', fallbackUsed: true },
		});

		expect(loggerWarnMock).toHaveBeenCalledTimes(1);
		expect(sendDiscordAlertMock).toHaveBeenCalledTimes(1);
	});

	it('structured logger context に kind + tags + errorSummary が含まれる (Sentry tag 相当、CloudWatch Logs Insights 検索可能)', () => {
		notifyStripeAlert({
			kind: 'stripe-lookup-failed',
			message: 'lookup_key 解決失敗',
			errorSummary: 'lookup_failed:premium_monthly',
			tags: { plan: 'premium', interval: 'monthly', fallbackUsed: true },
		});

		const callArg = loggerWarnMock.mock.calls[0]?.[1];
		expect(callArg?.service).toBe('stripe');
		expect(callArg?.context).toMatchObject({
			kind: 'stripe-lookup-failed',
			errorSummary: 'lookup_failed:premium_monthly',
			plan: 'premium',
			interval: 'monthly',
			fallbackUsed: true,
		});
	});

	it('Discord alert message に kind prefix が含まれる (Discord channel で検索可能)', () => {
		notifyStripeAlert({
			kind: 'stripe-lookup-failed',
			message: 'fallback 起動',
		});

		const alertOptions = sendDiscordAlertMock.mock.calls[0]?.[0];
		expect(alertOptions?.level).toBe('error');
		expect(alertOptions?.message).toContain('[stripe-lookup-failed]');
		expect(alertOptions?.message).toContain('fallback 起動');
	});

	it('errorSummary 省略時は kind を errorSummary に fallback', () => {
		notifyStripeAlert({
			kind: 'stripe-webhook-unknown-type',
			message: 'Unknown event type',
		});

		const alertOptions = sendDiscordAlertMock.mock.calls[0]?.[0];
		expect(alertOptions?.errorSummary).toBe('stripe-webhook-unknown-type');
	});
});

describe('notifyStripeAlert — fire-and-forget 動作 (#2720)', () => {
	it('caller への return が synchronous (await 不要、課金 path をブロックしない)', () => {
		// notifyStripeAlert は `void` を返す。Promise を返さないことで
		// caller が await し忘れても fire-and-forget が成立する。
		const result = notifyStripeAlert({
			kind: 'stripe-lookup-failed',
			message: 'test',
		});
		// 戻り値が undefined であることを assert (Promise でない)
		expect(result).toBeUndefined();
	});

	it('sendDiscordAlert が reject しても throw しない (logger.warn で recursive 抑制)', async () => {
		sendDiscordAlertMock.mockRejectedValueOnce(new Error('Discord webhook 5xx'));

		// notifyStripeAlert 自体は throw しない
		expect(() =>
			notifyStripeAlert({
				kind: 'stripe-lookup-failed',
				message: 'test',
			}),
		).not.toThrow();

		// microtask flush で .catch() ハンドラを起動
		await new Promise((r) => setImmediate(r));

		// recursive alert を避けるため logger.warn で記録 (sendDiscordAlert は再呼出されない)
		const recursiveCall = sendDiscordAlertMock.mock.calls.length;
		expect(recursiveCall).toBe(1); // 最初の 1 回のみ、再帰しない
		// logger.warn は 2 回呼ばれる (1: alert dispatch時、2: dispatch failure時)
		expect(loggerWarnMock.mock.calls.length).toBeGreaterThanOrEqual(2);
	});
});

describe('notifyStripeAlert — 3 種 alert kind 全て発火可能 (#2720、phase6-rollback-and-kill-switches.md §6 SSOT 整合)', () => {
	it.each([
		'stripe-lookup-failed',
		'stripe-webhook-unknown-type',
		'stripe-webhook-handler-typeerror',
	] as const)('kind=%s で発火可能 (regression: SSOT 3 種が type 安全に dispatch される)', (kind) => {
		notifyStripeAlert({
			kind,
			message: `test for ${kind}`,
		});

		const callArg = loggerWarnMock.mock.calls[0]?.[1];
		expect(callArg?.context).toMatchObject({ kind });
		expect(sendDiscordAlertMock.mock.calls[0]?.[0]?.message).toContain(`[${kind}]`);
	});
});
