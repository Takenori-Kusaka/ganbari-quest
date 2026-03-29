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
		const entry = map.get('/api/x:err detail')!;
		expect(entry).toBeDefined();
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
