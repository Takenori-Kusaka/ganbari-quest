// tests/unit/db/webhook-event-repo.test.ts
//
// `src/lib/server/db/demo/webhook-event-repo.ts` の in-memory 実装検証
// (#2641 / Phase 5 子 3 / Phase 7 PR-1 / #4128 insert-first)
//
// 設計 SSOT:
// - docs/design/billing-redesign/phase5-webhook-idempotency-architecture.md §3.3
// - src/lib/server/db/interfaces/webhook-event-repo.interface.ts (契約 SSOT)
//
// backend 整合の起点となる in-memory 実装の挙動を確定する (sqlite / dsql 実装が同契約に従う)。
// #4128 で `insert` を `claim` / `finalize` / `releaseClaim` に置き換えたため、本 spec も
// 「処理権を取れたか」を軸に検証する。

import { beforeEach, describe, expect, it } from 'vitest';
import {
	_resetDemoWebhookEvents,
	demoWebhookEventRepo,
} from '$lib/server/db/demo/webhook-event-repo';
import type { WebhookEventRecord } from '$lib/server/db/interfaces/webhook-event-repo.interface';

/** stale 判定を確実に外す (= 死んだ claim を奪わせない) 基準時刻 */
const NEVER_STALE = '2000-01-01T00:00:00.000Z';

function makeRecord(overrides: Partial<WebhookEventRecord> = {}): WebhookEventRecord {
	return {
		eventId: 'evt_1ABCxyz',
		eventType: 'checkout.session.completed',
		processedAt: '2026-05-30T12:00:00.000Z',
		handlerResult: 'processing',
		errorMessage: null,
		retryCount: 0,
		tenantId: null,
		...overrides,
	};
}

/** 「掴んで完了させた」状態を作る (完了済 row を用意するための helper)。 */
async function seedCompleted(overrides: Partial<WebhookEventRecord> = {}): Promise<void> {
	const record = makeRecord(overrides);
	await demoWebhookEventRepo.claim(record, NEVER_STALE);
	await demoWebhookEventRepo.finalize(record.eventId, 'success', record.processedAt);
}

describe('demoWebhookEventRepo (in-memory)', () => {
	beforeEach(() => {
		_resetDemoWebhookEvents();
	});

	describe('findByEventId', () => {
		it('未存在の event.id に対して null を返す', async () => {
			expect(await demoWebhookEventRepo.findByEventId('evt_unknown')).toBeNull();
		});

		it('claim 済の event.id に対して record を返す', async () => {
			const record = makeRecord({ eventId: 'evt_known' });
			await demoWebhookEventRepo.claim(record, NEVER_STALE);

			expect(await demoWebhookEventRepo.findByEventId('evt_known')).toEqual(record);
		});
	});

	describe('claim (処理権の取得、#4128)', () => {
		it('未存在の event.id は処理権を取れる', async () => {
			expect(await demoWebhookEventRepo.claim(makeRecord(), NEVER_STALE)).toBe(true);
		});

		it('同一 event.id の 2 度目は処理権を取れない (二重実行させない)', async () => {
			await demoWebhookEventRepo.claim(makeRecord(), NEVER_STALE);

			expect(await demoWebhookEventRepo.claim(makeRecord(), NEVER_STALE)).toBe(false);
		});

		it('完了済 row は stale 判定に関わらず奪えない (冪等性を壊さない)', async () => {
			await seedCompleted({ processedAt: '2020-01-01T00:00:00.000Z' });

			// 基準時刻を未来にして「十分古い」状態を作っても、processing でなければ奪えない
			const claimed = await demoWebhookEventRepo.claim(
				makeRecord({ processedAt: '2026-06-01T00:00:00.000Z' }),
				'2030-01-01T00:00:00.000Z',
			);

			expect(claimed).toBe(false);
			expect((await demoWebhookEventRepo.findByEventId('evt_1ABCxyz'))?.handlerResult).toBe(
				'success',
			);
		});

		it('processing のまま古くなった claim は奪える (処理中に死んだ Lambda の引き取り)', async () => {
			await demoWebhookEventRepo.claim(
				makeRecord({ processedAt: '2026-05-30T12:00:00.000Z' }),
				NEVER_STALE,
			);

			const claimed = await demoWebhookEventRepo.claim(
				makeRecord({ processedAt: '2026-05-30T13:00:00.000Z' }),
				'2026-05-30T12:30:00.000Z',
			);

			expect(claimed).toBe(true);
		});

		it('processing でもまだ新しい claim は奪えない (実行中の処理を横取りしない)', async () => {
			await demoWebhookEventRepo.claim(
				makeRecord({ processedAt: '2026-05-30T12:00:00.000Z' }),
				NEVER_STALE,
			);

			const claimed = await demoWebhookEventRepo.claim(
				makeRecord({ processedAt: '2026-05-30T12:05:00.000Z' }),
				'2026-05-30T11:50:00.000Z',
			);

			expect(claimed).toBe(false);
		});

		it('stale 引き取り時も retryCount は引き継ぐ (再到達の計数を消さない)', async () => {
			await demoWebhookEventRepo.claim(
				makeRecord({ processedAt: '2026-05-30T12:00:00.000Z' }),
				NEVER_STALE,
			);
			await demoWebhookEventRepo.incrementRetryCount('evt_1ABCxyz');

			await demoWebhookEventRepo.claim(
				makeRecord({ processedAt: '2026-05-30T13:00:00.000Z', retryCount: 0 }),
				'2026-05-30T12:30:00.000Z',
			);

			expect((await demoWebhookEventRepo.findByEventId('evt_1ABCxyz'))?.retryCount).toBe(1);
		});
	});

	describe('finalize / releaseClaim (#4128)', () => {
		it('finalize で handlerResult と processedAt が確定する', async () => {
			await demoWebhookEventRepo.claim(makeRecord(), NEVER_STALE);
			await demoWebhookEventRepo.finalize('evt_1ABCxyz', 'skipped', '2026-05-30T12:00:05.000Z');

			expect(await demoWebhookEventRepo.findByEventId('evt_1ABCxyz')).toMatchObject({
				handlerResult: 'skipped',
				processedAt: '2026-05-30T12:00:05.000Z',
			});
		});

		it('releaseClaim で processing の row が消える (Stripe の再送に載せ直せる)', async () => {
			await demoWebhookEventRepo.claim(makeRecord(), NEVER_STALE);
			await demoWebhookEventRepo.releaseClaim('evt_1ABCxyz');

			expect(await demoWebhookEventRepo.findByEventId('evt_1ABCxyz')).toBeNull();
		});

		it('releaseClaim は完了済 row を消さない (完了記録の巻き添え削除を作らない)', async () => {
			await seedCompleted();
			await demoWebhookEventRepo.releaseClaim('evt_1ABCxyz');

			expect(await demoWebhookEventRepo.findByEventId('evt_1ABCxyz')).not.toBeNull();
		});
	});

	describe('incrementRetryCount', () => {
		it('既存 record の retryCount を +1 する', async () => {
			await seedCompleted();
			await demoWebhookEventRepo.incrementRetryCount('evt_1ABCxyz');
			await demoWebhookEventRepo.incrementRetryCount('evt_1ABCxyz');

			expect((await demoWebhookEventRepo.findByEventId('evt_1ABCxyz'))?.retryCount).toBe(2);
		});

		it('未存在の event.id に対して何もしない (silent no-op)', async () => {
			await demoWebhookEventRepo.incrementRetryCount('evt_unknown');
			expect(await demoWebhookEventRepo.findByEventId('evt_unknown')).toBeNull();
		});
	});

	describe('deleteOlderThan', () => {
		it('processedAt < cutoffIso の row のみ削除し件数を返す', async () => {
			await seedCompleted({ eventId: 'evt_old', processedAt: '2026-04-01T00:00:00.000Z' });
			await seedCompleted({ eventId: 'evt_keep', processedAt: '2026-06-01T00:00:00.000Z' });

			const deleted = await demoWebhookEventRepo.deleteOlderThan('2026-05-01T00:00:00.000Z');
			expect(deleted).toBe(1);

			expect(await demoWebhookEventRepo.findByEventId('evt_old')).toBeNull();
			expect(await demoWebhookEventRepo.findByEventId('evt_keep')).not.toBeNull();
		});

		it('cutoff より新しい row のみの場合は 0 件削除', async () => {
			await seedCompleted({ eventId: 'evt_new', processedAt: '2026-06-01T00:00:00.000Z' });

			const deleted = await demoWebhookEventRepo.deleteOlderThan('2026-05-01T00:00:00.000Z');
			expect(deleted).toBe(0);
			expect(await demoWebhookEventRepo.findByEventId('evt_new')).not.toBeNull();
		});
	});
});
