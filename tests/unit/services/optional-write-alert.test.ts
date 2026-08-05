// tests/unit/services/optional-write-alert.test.ts
// EPIC #3424 / 実装 #3550 ① / 設計 SSOT: dsql-data-model.md §8 / §13.1 fitness#11
//
// createOptionalWriteFailureHandler (optional 欠落カウンタの service 層 bind) の結線テスト:
//   [A1] logger.error に構造化 context (kind/name/childId/tenantId/cause) で emit する
//   [A2] sendDiscordAlert を fire-and-forget で起動する (level=error)
//   [A3] Discord alert 自体の失敗が handler から漏れず、記録フローをブロックしない
//   [A4] Error 以外の throw 値も cause に文字列化される

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
import { createOptionalWriteFailureHandler } from '../../../src/lib/server/services/optional-write-alert';

const alertMock = vi.mocked(sendDiscordAlert);

beforeEach(() => {
	vi.clearAllMocks();
	alertMock.mockResolvedValue(undefined);
});

describe('#3550 ① fitness#11: optional 欠落カウンタの service 層 bind', () => {
	it('[A1] logger.error に kind/name/childId/tenantId/cause の構造化 context で emit する', () => {
		const handler = createOptionalWriteFailureHandler({ childId: 'c-1', tenantId: 't-1' });
		handler('combo_bonus', new Error('mini-txn failed'));

		expect(logger.error).toHaveBeenCalledTimes(1);
		const [message, meta] = vi.mocked(logger.error).mock.calls[0] ?? [];
		expect(message).toContain('combo_bonus');
		expect(meta).toMatchObject({
			tenantId: 't-1',
			service: 'activity-record',
			context: {
				kind: 'optional-write-failed',
				name: 'combo_bonus',
				childId: 'c-1',
				cause: 'mini-txn failed',
			},
		});
	});

	// #4192 (#4174 Q3): tenantId は Discord に載せない。「誰に起きたか」は [A1] で assert 済の
	// logger.error (tenantId / childId 付き) 側が持つ。
	it('[A2] sendDiscordAlert を level=error + errorSummary で起動し、tenantId は渡さない', () => {
		const handler = createOptionalWriteFailureHandler({ childId: 'c-1', tenantId: 't-1' });
		handler('mission_bonus', new Error('boom'));

		expect(alertMock).toHaveBeenCalledTimes(1);
		expect(alertMock).toHaveBeenCalledWith(
			expect.objectContaining({
				level: 'error',
				message: expect.stringContaining('mission_bonus'),
				errorSummary: 'boom',
			}),
		);
		const alertArg = alertMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
		expect(alertArg).not.toHaveProperty('tenantId');
		expect(JSON.stringify(alertArg)).not.toContain('t-1');
	});

	it('[A3] Discord alert 自体の失敗は handler から throw せず logger.warn に留まる', async () => {
		alertMock.mockRejectedValueOnce(new Error('webhook down'));
		const handler = createOptionalWriteFailureHandler({ childId: 'c-1', tenantId: 't-1' });

		expect(() => handler('certificate', new Error('x'))).not.toThrow();
		// fire-and-forget の rejection が処理されるのを待つ
		await vi.waitFor(() => {
			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('certificate'));
		});
	});

	it('[A4] Error 以外の throw 値も cause に文字列化される', () => {
		const handler = createOptionalWriteFailureHandler({ childId: 'c-9', tenantId: 't-9' });
		handler('special_reward', 'string failure');

		const [, meta] = vi.mocked(logger.error).mock.calls[0] ?? [];
		expect((meta?.context as Record<string, unknown>)?.cause).toBe('string failure');
	});
});
