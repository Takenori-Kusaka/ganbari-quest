// tests/unit/db/webhook-event-repo.test.ts
//
// `src/lib/server/db/demo/webhook-event-repo.ts` の in-memory 4 メソッド検証
// (#2641 / Phase 5 子 3 / Phase 7 PR-1)
//
// 設計 SSOT:
// - docs/design/billing-redesign/phase5-webhook-idempotency-architecture.md §3.3
// - docs/design/billing-redesign/phase6-db-migration-plan.md §3.3
//
// Phase 7 PR-4a で sqlite / dynamodb 実装が追加されるが、本 PR (PR-1) では
// 4 backend 整合の起点となる in-memory 実装の挙動を確定する。

import { beforeEach, describe, expect, it } from 'vitest';
import {
	_resetDemoWebhookEvents,
	demoWebhookEventRepo,
} from '$lib/server/db/demo/webhook-event-repo';
import {
	STRIPE_WEBHOOK_EVENT_PK,
	STRIPE_WEBHOOK_EVENT_TTL_DAYS,
	stripeWebhookEventKey,
} from '$lib/server/db/dynamodb/keys';
import type { WebhookEventRecord } from '$lib/server/db/interfaces/webhook-event-repo.interface';

function makeRecord(overrides: Partial<WebhookEventRecord> = {}): WebhookEventRecord {
	return {
		eventId: 'evt_1ABCxyz',
		eventType: 'checkout.session.completed',
		processedAt: '2026-05-30T12:00:00.000Z',
		handlerResult: 'success',
		errorMessage: null,
		retryCount: 0,
		tenantId: null,
		...overrides,
	};
}

describe('demoWebhookEventRepo (in-memory)', () => {
	beforeEach(() => {
		_resetDemoWebhookEvents();
	});

	describe('findByEventId', () => {
		it('未存在の event.id に対して null を返す (dedup primary check)', async () => {
			const result = await demoWebhookEventRepo.findByEventId('evt_unknown');
			expect(result).toBeNull();
		});

		it('insert 済の event.id に対して record を返す', async () => {
			const record = makeRecord({ eventId: 'evt_known' });
			await demoWebhookEventRepo.insert(record);

			const result = await demoWebhookEventRepo.findByEventId('evt_known');
			expect(result).toEqual(record);
		});
	});

	describe('insert', () => {
		it('同一 event.id の上書き insert で 2 度目の record が勝つ (Map.set 挙動)', async () => {
			await demoWebhookEventRepo.insert(makeRecord({ handlerResult: 'success' }));
			await demoWebhookEventRepo.insert(
				makeRecord({ handlerResult: 'error', errorMessage: 'retry' }),
			);

			const result = await demoWebhookEventRepo.findByEventId('evt_1ABCxyz');
			expect(result?.handlerResult).toBe('error');
			expect(result?.errorMessage).toBe('retry');
			// 注: Phase 7 PR-4a の sqlite/dynamodb 実装では `INSERT OR IGNORE` /
			// `attribute_not_exists` で 2 度目を弾く設計 (race condition 検出)。
			// 本 demo 実装は最小限の Map.set のため上書き挙動になるが、
			// dispatcher 側で findByEventId 経由の dedup 後に呼ぶ前提で問題ない。
		});
	});

	describe('incrementRetryCount', () => {
		it('既存 record の retryCount を +1 する', async () => {
			await demoWebhookEventRepo.insert(makeRecord({ retryCount: 0 }));
			await demoWebhookEventRepo.incrementRetryCount('evt_1ABCxyz');
			await demoWebhookEventRepo.incrementRetryCount('evt_1ABCxyz');

			const result = await demoWebhookEventRepo.findByEventId('evt_1ABCxyz');
			expect(result?.retryCount).toBe(2);
		});

		it('未存在の event.id に対して何もしない (silent no-op)', async () => {
			await demoWebhookEventRepo.incrementRetryCount('evt_unknown');
			const result = await demoWebhookEventRepo.findByEventId('evt_unknown');
			expect(result).toBeNull();
		});
	});

	describe('deleteOlderThan', () => {
		it('processedAt < cutoffIso の row のみ削除し件数を返す', async () => {
			await demoWebhookEventRepo.insert(
				makeRecord({ eventId: 'evt_old', processedAt: '2026-04-01T00:00:00.000Z' }),
			);
			await demoWebhookEventRepo.insert(
				makeRecord({ eventId: 'evt_keep', processedAt: '2026-06-01T00:00:00.000Z' }),
			);

			// cutoff = 2026-05-01: evt_old は削除、evt_keep は残る
			const deleted = await demoWebhookEventRepo.deleteOlderThan('2026-05-01T00:00:00.000Z');
			expect(deleted).toBe(1);

			expect(await demoWebhookEventRepo.findByEventId('evt_old')).toBeNull();
			expect(await demoWebhookEventRepo.findByEventId('evt_keep')).not.toBeNull();
		});

		it('cutoff より新しい row のみの場合は 0 件削除', async () => {
			await demoWebhookEventRepo.insert(
				makeRecord({ eventId: 'evt_new', processedAt: '2026-06-01T00:00:00.000Z' }),
			);

			const deleted = await demoWebhookEventRepo.deleteOlderThan('2026-05-01T00:00:00.000Z');
			expect(deleted).toBe(0);
			expect(await demoWebhookEventRepo.findByEventId('evt_new')).not.toBeNull();
		});
	});
});

// ============================================================
// DynamoDB key constants (Phase 7 PR-4a で dynamodb 実装が参照する SSOT)
// ============================================================
describe('stripeWebhookEventKey (dynamodb keys.ts)', () => {
	it('PK = STRIPE_WEBHOOK_EVENT, SK = <event.id> の DynamoKey を返す', () => {
		const key = stripeWebhookEventKey('evt_1ABCxyz');
		expect(key).toEqual({ PK: 'STRIPE_WEBHOOK_EVENT', SK: 'evt_1ABCxyz' });
	});

	it('STRIPE_WEBHOOK_EVENT_PK 定数は SSOT (global single-partition pattern)', () => {
		// cancellationReasonKey / graduationConsentKey と同パターン (Pre-PMF / ADR-0010)
		expect(STRIPE_WEBHOOK_EVENT_PK).toBe('STRIPE_WEBHOOK_EVENT');
	});

	it('STRIPE_WEBHOOK_EVENT_TTL_DAYS = 30 (Stripe Events API 保持期間と同期、ADR-0049)', () => {
		// この値変更時は ADR-0049 整合を要確認 (Phase 5 子 3 §2 原則 4)
		expect(STRIPE_WEBHOOK_EVENT_TTL_DAYS).toBe(30);
	});
});
