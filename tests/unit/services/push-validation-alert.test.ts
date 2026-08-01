// tests/unit/services/push-validation-alert.test.ts
// #3404 item3: subscribe validation 拒否 (INVALID_ENDPOINT / INVALID_KEY) 可視化の結線テスト:
//   [B1] logger.warn に構造化 context (kind/code/reason) で emit する (Logs Insights query 用 stable key)
//   [B2] sendDiscordAlert を fire-and-forget で起動する (level=error / path / errorSummary)
//   [B3] Discord alert 自体の失敗が throw せず logger.warn に留まる (subscribe response をブロックしない)

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/logger', () => ({
	logger: {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	},
}));
vi.mock('$lib/server/discord-alert', () => ({
	sendDiscordAlert: vi.fn(async () => undefined),
}));

import { sendDiscordAlert } from '../../../src/lib/server/discord-alert';
import { logger } from '../../../src/lib/server/logger';
import { reportPushValidationRejection } from '../../../src/lib/server/services/push-validation-alert';

const alertMock = vi.mocked(sendDiscordAlert);

beforeEach(() => {
	vi.clearAllMocks();
	alertMock.mockResolvedValue(undefined);
});

describe('#3404 item3: reportPushValidationRejection (発生可視化)', () => {
	it('[B1] logger.warn に kind/code/reason の構造化 context で emit する', () => {
		reportPushValidationRejection({
			tenantId: 't-1',
			code: 'INVALID_ENDPOINT',
			reason: 'endpoint host not in push-service allowlist (push.new-vendor.example.com)',
		});

		expect(logger.warn).toHaveBeenCalledTimes(1);
		const [message, meta] = vi.mocked(logger.warn).mock.calls[0] ?? [];
		expect(message).toContain('INVALID_ENDPOINT');
		expect(meta).toMatchObject({
			tenantId: 't-1',
			service: 'push-subscribe',
			context: {
				kind: 'push-validation-rejected',
				code: 'INVALID_ENDPOINT',
				reason: 'endpoint host not in push-service allowlist (push.new-vendor.example.com)',
			},
		});
	});

	// #4192 (#4174 Q3): tenantId は Discord に載せない。「誰に起きたか」は [B1] で assert 済の
	// logger.warn (tenantId 付き) 側が持つ。ここでは alert が tenantId を**渡さない**ことを固定する。
	it('[B2] sendDiscordAlert を level=error + path + errorSummary で起動し、tenantId は渡さない', () => {
		reportPushValidationRejection({
			tenantId: 't-2',
			code: 'INVALID_KEY',
			reason: 'push key failed base64url format / length validation',
		});

		expect(alertMock).toHaveBeenCalledTimes(1);
		expect(alertMock).toHaveBeenCalledWith(
			expect.objectContaining({
				level: 'error',
				message: expect.stringContaining('INVALID_KEY'),
				path: '/api/v1/notifications/subscribe',
				errorSummary: 'push key failed base64url format / length validation',
			}),
		);
		const alertArg = alertMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
		expect(alertArg).not.toHaveProperty('tenantId');
		expect(JSON.stringify(alertArg)).not.toContain('t-2');
	});

	it('[B3] Discord alert 自体の失敗は throw せず logger.warn に留まる', async () => {
		alertMock.mockRejectedValueOnce(new Error('webhook down'));

		expect(() =>
			reportPushValidationRejection({
				tenantId: 't-3',
				code: 'INVALID_ENDPOINT',
				reason: 'x',
			}),
		).not.toThrow();

		// fire-and-forget の rejection が処理されるのを待つ
		await vi.waitFor(() => {
			expect(logger.warn).toHaveBeenCalledWith(
				expect.stringContaining('Discord alert dispatch failed'),
			);
		});
	});
});
