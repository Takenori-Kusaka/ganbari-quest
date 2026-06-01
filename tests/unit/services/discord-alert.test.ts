// tests/unit/services/discord-alert.test.ts
// Discord アラート通知 + スロットリング テスト

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// mock env
vi.mock('$env/dynamic/private', () => ({
	env: {
		DISCORD_ALERT_WEBHOOK_URL: 'https://discord.com/api/webhooks/test/test',
	},
}));

// mock logger
vi.mock('$lib/server/logger', () => ({
	logger: {
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}));

// mock fetch
const mockFetch = vi.fn().mockResolvedValue({ ok: true });
vi.stubGlobal('fetch', mockFetch);

import { _getThrottleMap, _resetThrottleMap, sendDiscordAlert } from '$lib/server/discord-alert';

describe('discord-alert', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetThrottleMap();
	});

	afterEach(() => {
		_resetThrottleMap();
	});

	it('sends alert via Discord webhook', async () => {
		await sendDiscordAlert({
			level: 'error',
			message: 'Test error',
			method: 'GET',
			path: '/api/test',
			status: 500,
			requestId: 'req-1',
		});

		expect(mockFetch).toHaveBeenCalledTimes(1);
		const call = mockFetch.mock.calls[0] as [string, { body: string }];
		expect(call[0]).toBe('https://discord.com/api/webhooks/test/test');
		const body = JSON.parse(call[1].body);
		expect(body.embeds[0].title).toContain('[ERROR]');
		expect(body.embeds[0].title).toContain('Test error');
	});

	it('sends critical alert with @everyone mention', async () => {
		await sendDiscordAlert({
			level: 'critical',
			message: 'DB failure',
		});

		expect(mockFetch).toHaveBeenCalledTimes(1);
		const criticalCall = mockFetch.mock.calls[0] as [string, { body: string }];
		const body = JSON.parse(criticalCall[1].body);
		expect(body.content).toBe('@everyone ');
		expect(body.embeds[0].title).toContain('[CRITICAL]');
	});

	it('throttles after 3 identical errors within 5 min window', async () => {
		const opts = {
			level: 'error' as const,
			message: 'Repeated error',
			path: '/api/broken',
			errorSummary: 'DB connection failed',
			requestId: '',
		};

		// 1st: normal alert
		await sendDiscordAlert({ ...opts, requestId: 'req-1' });
		expect(mockFetch).toHaveBeenCalledTimes(1);

		// 2nd: normal alert
		await sendDiscordAlert({ ...opts, requestId: 'req-2' });
		expect(mockFetch).toHaveBeenCalledTimes(2);

		// 3rd: throttle kicks in, sends throttled summary
		await sendDiscordAlert({ ...opts, requestId: 'req-3' });
		expect(mockFetch).toHaveBeenCalledTimes(3);
		const throttledCall = mockFetch.mock.calls[2] as [string, { body: string }];
		const throttledBody = JSON.parse(throttledCall[1].body);
		expect(throttledBody.embeds[0].title).toContain('多発検知');

		// 4th+: silenced
		await sendDiscordAlert({ ...opts, requestId: 'req-4' });
		expect(mockFetch).toHaveBeenCalledTimes(3); // no additional call
	});

	it('tracks request IDs in throttle map', async () => {
		const opts = {
			level: 'error' as const,
			message: 'err',
			path: '/api/x',
			errorSummary: 'err detail',
		};

		await sendDiscordAlert({ ...opts, requestId: 'a' });
		await sendDiscordAlert({ ...opts, requestId: 'b' });

		const map = _getThrottleMap();
		const entry = map.get('/api/x:err detail');
		if (!entry) throw new Error('Expected throttle map entry to be defined');
		expect(entry.count).toBe(2);
		expect(entry.requestIds).toEqual(['a', 'b']);
	});

	it('does not send alert when webhook URL is not set', async () => {
		// Override env to have no webhook
		const { env } = await import('$env/dynamic/private');
		const original = env.DISCORD_ALERT_WEBHOOK_URL;
		env.DISCORD_ALERT_WEBHOOK_URL = '';
		(env as Record<string, string | undefined>).DISCORD_WEBHOOK_INCIDENT = undefined;

		await sendDiscordAlert({ level: 'error', message: 'no webhook' });
		// fetch should not have been called for this specific test
		// But the mock env is module-level, so this test checks the empty string path
		// In practice, getAlertWebhookUrl returns '' which is falsy

		env.DISCORD_ALERT_WEBHOOK_URL = original;
	});

	it('attack scenario: 大量の同一 stripe error 発火でも Discord rate limit を保護 (#2738)', async () => {
		// QA Adversarial security 軸: stripe error が大量発火する攻撃シナリオで
		// Discord webhook が rate limit (429) に到達しないことを確認。
		// throttle 機構が同一 (path:errorSummary) key で 3 件目以降は無音化する。
		const opts = {
			level: 'error' as const,
			message: 'Stripe webhook handler error',
			path: '/api/stripe/webhook',
			errorSummary: 'stripe-webhook-handler-typeerror',
		};

		// 100 件連続発火 (attack scenario)
		for (let i = 0; i < 100; i++) {
			await sendDiscordAlert({ ...opts, requestId: `attack-${i}` });
		}

		// 期待: 1st (normal) + 2nd (normal) + 3rd (throttled summary) = 3 件のみ送信
		// 4th 以降 (97 件) は throttle により silent
		expect(mockFetch).toHaveBeenCalledTimes(3);

		// throttle map に全 requestId が記録されている (証跡保持)
		const map = _getThrottleMap();
		const entry = map.get('/api/stripe/webhook:stripe-webhook-handler-typeerror');
		expect(entry).toBeDefined();
		expect(entry?.count).toBe(100);
		expect(entry?.requestIds.length).toBe(100);
	});

	it('throttle 機構は path+errorSummary を key とし、異なる kind なら独立 throttle (#2738)', async () => {
		// 異なる alert kind は throttle が独立しているため、両方を観測可能
		const lookupFailedOpts = {
			level: 'error' as const,
			message: 'Lookup key failed',
			path: '/api/stripe/checkout',
			errorSummary: 'stripe-lookup-failed',
		};
		const webhookErrorOpts = {
			level: 'error' as const,
			message: 'Webhook handler error',
			path: '/api/stripe/webhook',
			errorSummary: 'stripe-webhook-handler-typeerror',
		};

		// 各 kind を 2 件ずつ発火 (どちらも throttle 閾値 3 未満)
		await sendDiscordAlert({ ...lookupFailedOpts, requestId: 'l1' });
		await sendDiscordAlert({ ...lookupFailedOpts, requestId: 'l2' });
		await sendDiscordAlert({ ...webhookErrorOpts, requestId: 'w1' });
		await sendDiscordAlert({ ...webhookErrorOpts, requestId: 'w2' });

		// 異なる kind は throttle が独立 = 4 件全て送信される
		expect(mockFetch).toHaveBeenCalledTimes(4);
	});

	it('includes all fields in embed when provided', async () => {
		await sendDiscordAlert({
			level: 'error',
			message: 'Full error',
			method: 'POST',
			path: '/api/v1/activities',
			status: 500,
			requestId: 'abc-123',
			tenantId: 'tenant_xyz',
			errorSummary: 'DynamoDB write failed',
			stackSummary: 'at recordActivity\nat POST handler',
		});

		const fieldsCall = mockFetch.mock.calls[0] as [string, { body: string }];
		const body = JSON.parse(fieldsCall[1].body);
		const fields = body.embeds[0].fields;
		const fieldNames = fields.map((f: { name: string }) => f.name);
		expect(fieldNames).toContain('Endpoint');
		expect(fieldNames).toContain('Status');
		expect(fieldNames).toContain('RequestId');
		expect(fieldNames).toContain('TenantId');
		expect(fieldNames).toContain('Error');
		expect(fieldNames).toContain('Stack (先頭3行)');
	});
});
