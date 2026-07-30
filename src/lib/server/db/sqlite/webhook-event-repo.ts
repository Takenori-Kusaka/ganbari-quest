// src/lib/server/db/sqlite/webhook-event-repo.ts
// SQLite implementation of IWebhookEventRepo (#2641 / #3985)
//
// 設計 SSOT: docs/design/billing-redesign/phase5-webhook-idempotency-architecture.md §3.1 / §3.4
//
// 表 (`stripe_webhook_events`) は `src/lib/server/db/schema.ts` に配備済み
// (create-tables.ts / lazy-startup-migrations.ts / tests/e2e/global-setup.ts と並行同期済)。
// 本 file は「表はあるが sqlite backend の repo 実装だけ無い」欠落を埋める (#3985)。
//
// 冪等性契約 (interface SSOT 整合): 並列同時到達の二重 insert は PK (event_id) への
// `ON CONFLICT DO NOTHING` (drizzle `onConflictDoNothing`) で 2 度目以降を物理拒否する
// (first-writer-wins)。dsql 実装と同一挙動。

import { eq, lt, sql } from 'drizzle-orm';
import { db } from '../client';
import type { WebhookEventRecord } from '../interfaces/webhook-event-repo.interface';
import { stripeWebhookEvents } from '../schema';

function toRecord(row: typeof stripeWebhookEvents.$inferSelect): WebhookEventRecord {
	return {
		eventId: row.eventId,
		eventType: row.eventType,
		processedAt: row.processedAt,
		handlerResult: row.handlerResult,
		errorMessage: row.errorMessage,
		retryCount: row.retryCount,
		tenantId: row.tenantId,
	};
}

export async function findByEventId(eventId: string): Promise<WebhookEventRecord | null> {
	const rows = await db
		.select()
		.from(stripeWebhookEvents)
		.where(eq(stripeWebhookEvents.eventId, eventId))
		.limit(1);
	return rows[0] ? toRecord(rows[0]) : null;
}

export async function insert(record: WebhookEventRecord): Promise<void> {
	await db
		.insert(stripeWebhookEvents)
		.values({
			eventId: record.eventId,
			eventType: record.eventType,
			processedAt: record.processedAt,
			handlerResult: record.handlerResult,
			errorMessage: record.errorMessage,
			retryCount: record.retryCount,
			tenantId: record.tenantId,
		})
		.onConflictDoNothing();
}

export async function incrementRetryCount(eventId: string): Promise<void> {
	await db
		.update(stripeWebhookEvents)
		.set({ retryCount: sql`${stripeWebhookEvents.retryCount} + 1` })
		.where(eq(stripeWebhookEvents.eventId, eventId));
}

export async function deleteOlderThan(cutoffIso: string): Promise<number> {
	const result = db
		.delete(stripeWebhookEvents)
		.where(lt(stripeWebhookEvents.processedAt, cutoffIso))
		.run();
	return result.changes;
}
