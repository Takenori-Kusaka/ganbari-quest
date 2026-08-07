// tests/unit/server/ai/ai-unavailable-notification.test.ts
// AI が使えないことを運営に届ける経路 (#4375 follow-up、PO 決裁 2026-08-07)
//
// 顧客に出す文言は「システム側の問題で、運営に通知済み」である。守るべき不変条件は 2 つ:
//
//   [1] 通知が **出る**    … 出なければ顧客に出した「通知済み」が嘘になる
//   [2] 通知が **溢れない** … per-request で出すと本物の異常がログに埋もれる (#4366 害 c)
//
// [2] は「1 回で止まる」ことを実際に複数回呼んで確かめる (実装を読んで納得する、ではなく)。

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
	AI_PROVIDER_UNAVAILABLE_LOG_TERM,
	markProviderUnavailable,
	reportAiUnavailableAtGuard,
	resetAiAvailabilityLatch,
	withAvailabilityTracking,
} from '$lib/server/ai/availability';
import { logger } from '$lib/server/logger';

/** `[ai-alert] ai-provider-unavailable` を含む warn 行だけを取り出す。 */
function alertLines(): string[] {
	return vi
		.mocked(logger.warn)
		.mock.calls.map((call) => String(call[0]))
		.filter((line) => line.includes(AI_PROVIDER_UNAVAILABLE_LOG_TERM));
}

describe('AI 不達の運営通知', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetAiAvailabilityLatch();
	});

	it('[1] latch へ遷移したとき 1 行出る', () => {
		markProviderUnavailable('bedrock-claude');

		expect(alertLines()).toEqual([`${AI_PROVIDER_UNAVAILABLE_LOG_TERM} reason=latched`]);
	});

	it('[2] latch 済みなら 2 回目以降は出さない (per-request 連発の回帰 guard)', () => {
		markProviderUnavailable('bedrock-claude');
		markProviderUnavailable('bedrock-claude');
		markProviderUnavailable('bedrock-claude');

		expect(alertLines()).toHaveLength(1);
	});

	it('[2] 可用性クラスの例外が何度出ても log は 1 行に収まる', async () => {
		const fail = async () => {
			await expect(
				withAvailabilityTracking('bedrock-claude', async () => {
					throw Object.assign(new Error('not authorized'), { name: 'AccessDeniedException' });
				}),
			).rejects.toThrow();
		};

		await fail();
		await fail();
		await fail();

		expect(alertLines()).toHaveLength(1);
	});

	it('[2] guard 側 (呼ぶ前に使えないと分かる経路) も 1 行に収まる', () => {
		reportAiUnavailableAtGuard('bedrock-claude');
		reportAiUnavailableAtGuard('bedrock-claude');
		reportAiUnavailableAtGuard('bedrock-claude');

		expect(alertLines()).toEqual([`${AI_PROVIDER_UNAVAILABLE_LOG_TERM} reason=not-configured`]);
	});

	it('[1] guard は latch 済みかどうかで理由を言い分ける (ops log に誤った理由を載せない)', () => {
		markProviderUnavailable('bedrock-claude');
		vi.mocked(logger.warn).mockClear();

		// latch 済み provider の guard は「未設定」と言ってはならない。既に報告済みなので出力自体も 0。
		reportAiUnavailableAtGuard('bedrock-claude');
		expect(alertLines()).toHaveLength(0);

		// 別 provider (latch されていない) は「未設定」として報告される。
		reportAiUnavailableAtGuard('gemini');
		expect(alertLines()).toEqual([`${AI_PROVIDER_UNAVAILABLE_LOG_TERM} reason=not-configured`]);
	});

	it('[1] log に識別子・例外本文を載せない (alert.ts 既存規約)', () => {
		reportAiUnavailableAtGuard('bedrock-claude');

		const line = alertLines()[0];
		// 載ってよいのは検索語と理由の分類だけ。provider 名すら載せない。
		expect(line).toBe(`${AI_PROVIDER_UNAVAILABLE_LOG_TERM} reason=not-configured`);
		expect(line).not.toContain('bedrock');
	});
});
