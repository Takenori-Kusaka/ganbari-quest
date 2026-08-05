// src/lib/server/db/sqlite/webhook-event-repo.ts
// SQLite implementation of IWebhookEventRepo (#2641 / #3985)
//
// 設計 SSOT: docs/design/billing-redesign/phase5-webhook-idempotency-architecture.md §3.1 / §3.4
//
// 表 (`stripe_webhook_events`) は `src/lib/server/db/schema.ts` に配備済み
// (create-tables.ts / lazy-startup-migrations.ts / tests/e2e/global-setup.ts と並行同期済)。
// 本 file は「表はあるが sqlite backend の repo 実装だけ無い」欠落を埋める (#3985)。
//
// 冪等性契約 (interface SSOT 整合): 処理権の取得は `claim()` の 1 文
// (`onConflictDoUpdate` + `setWhere` で「processing かつ stale」に限定 + `returning()`) に閉じ、
// 並列同時到達の勝者を 1 つに決める (#4128、first-writer-wins)。dsql 実装と同一挙動。

import { and, eq, lt, sql } from 'drizzle-orm';
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

export async function claim(
	record: WebhookEventRecord,
	staleClaimBeforeIso: string,
): Promise<boolean> {
	// 処理権の取得を 1 文に閉じ込める (#4128、dsql 実装と同一挙動)。
	// 競合時は「死んだ claim (processing かつ stale)」に限って奪い、完了済 row は奪わない。
	// returning() が行を返したかどうかがそのまま勝敗になる。
	const rows = await db
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
		.onConflictDoUpdate({
			target: stripeWebhookEvents.eventId,
			set: {
				eventType: record.eventType,
				processedAt: record.processedAt,
				handlerResult: record.handlerResult,
				errorMessage: record.errorMessage,
				tenantId: record.tenantId,
			},
			setWhere: and(
				eq(stripeWebhookEvents.handlerResult, 'processing'),
				lt(stripeWebhookEvents.processedAt, staleClaimBeforeIso),
			),
		})
		.returning({ eventId: stripeWebhookEvents.eventId });
	return rows.length > 0;
}

export async function finalize(
	eventId: string,
	handlerResult: 'success' | 'skipped',
	processedAtIso: string,
): Promise<void> {
	await db
		.update(stripeWebhookEvents)
		.set({ handlerResult, processedAt: processedAtIso })
		.where(eq(stripeWebhookEvents.eventId, eventId));
}

export async function releaseClaim(eventId: string): Promise<void> {
	// 完了済 row を巻き添えで消さないよう processing に限定する。
	await db
		.delete(stripeWebhookEvents)
		.where(
			and(
				eq(stripeWebhookEvents.eventId, eventId),
				eq(stripeWebhookEvents.handlerResult, 'processing'),
			),
		);
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
