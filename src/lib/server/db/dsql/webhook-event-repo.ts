// src/lib/server/db/dsql/webhook-event-repo.ts
// EPIC #3424 / M4-E PR8c (repo 層 衛星系) / 設計 SSOT: dsql-data-model.md §11.2 /
// billing-redesign/phase5-webhook-idempotency-architecture.md §3.4
//
// IWebhookEventRepo (stripe_webhook_events) の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8)。全操作が単文のため txn runner 不要。
//   - **グローバル表 (tenant 非依存)**: PK = event_id (Stripe `evt_*`) 自然キー。tenant_id は
//     nullable analytics 属性 (§P9 対象外、handler が解決できた場合のみ格納)。
//   - **冪等性 (first-writer-wins)**: 並列同時到達の二重 insert は PK への
//     ON CONFLICT DO NOTHING で 2 度目以降を物理拒否する (interface SSOT の
//     「INSERT OR IGNORE / attribute_not_exists」契約、Phase 5 子 3 §13 #6)。初回の
//     handler 結果が正であり後着は silent skip (二重課金防止)。
//   - **processedAt は verbatim 格納**: 呼び出し元 (webhook dispatcher) が確定した処理時刻を
//     そのまま書く (::timestamptz cast)。30 日 retention は deleteOlderThan (cron) が担い、
//     RETURNING で削除行数を数える (SqlExecutor は rowCount 非公開)。

import { sql } from 'drizzle-orm';
import type {
	IWebhookEventRepo,
	WebhookEventRecord,
} from '../interfaces/webhook-event-repo.interface';
import type { SqlExecutor } from './sql-executor';

interface WebhookEventRow {
	event_id: string;
	event_type: string;
	processed_at: string;
	handler_result: string;
	error_message: string | null;
	retry_count: number;
	tenant_id: string | null;
}

const EVENT_COLUMNS = sql.raw(
	`event_id, event_type, processed_at, handler_result, error_message, retry_count, tenant_id`,
);

/** row → WebhookEventRecord entity (handler_result は type-only enum を narrow)。 */
function toEvent(row: WebhookEventRow): WebhookEventRecord {
	return {
		eventId: row.event_id,
		eventType: row.event_type,
		processedAt: row.processed_at,
		handlerResult: row.handler_result as WebhookEventRecord['handlerResult'],
		errorMessage: row.error_message,
		retryCount: row.retry_count,
		tenantId: row.tenant_id,
	};
}

/** DSQL 用 IWebhookEventRepo を生成する (db は注入、fitness#8)。 */
export function createDsqlWebhookEventRepo(db: SqlExecutor): IWebhookEventRepo {
	return {
		async findByEventId(eventId) {
			const result = await db.execute(sql`
				SELECT ${EVENT_COLUMNS} FROM stripe_webhook_events WHERE event_id = ${eventId}
			`);
			const row = result.rows[0] as unknown as WebhookEventRow | undefined;
			return row ? toEvent(row) : null;
		},

		async insert(record) {
			// PK (event_id) への ON CONFLICT DO NOTHING で並列二重 insert を物理拒否
			// (first-writer-wins、interface SSOT の冪等契約)。
			await db.execute(sql`
				INSERT INTO stripe_webhook_events
					(event_id, event_type, processed_at, handler_result, error_message, retry_count,
					 tenant_id)
				VALUES (${record.eventId}, ${record.eventType}, ${record.processedAt}::timestamptz,
					${record.handlerResult}, ${record.errorMessage}, ${record.retryCount},
					${record.tenantId})
				ON CONFLICT (event_id) DO NOTHING
			`);
		},

		async incrementRetryCount(eventId) {
			await db.execute(sql`
				UPDATE stripe_webhook_events SET retry_count = retry_count + 1
				WHERE event_id = ${eventId}
			`);
		},

		async deleteOlderThan(cutoffIso) {
			const result = await db.execute(sql`
				DELETE FROM stripe_webhook_events WHERE processed_at < ${cutoffIso}::timestamptz
				RETURNING event_id
			`);
			return result.rows.length;
		},
	};
}
