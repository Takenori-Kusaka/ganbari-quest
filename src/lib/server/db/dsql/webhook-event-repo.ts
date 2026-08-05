// src/lib/server/db/dsql/webhook-event-repo.ts
// EPIC #3424 / M4-E PR8c (repo 層 衛星系) / 設計 SSOT: dsql-data-model.md §11.2 /
// billing-redesign/phase5-webhook-idempotency-architecture.md §3.4
//
// IWebhookEventRepo (stripe_webhook_events) の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8)。全操作が単文のため txn runner 不要。
//   - **グローバル表 (tenant 非依存)**: PK = event_id (Stripe `evt_*`) 自然キー。tenant_id は
//     nullable analytics 属性 (§P9 対象外、handler が解決できた場合のみ格納)。
//   - **冪等性 (first-writer-wins)**: 処理権の取得は `claim()` の 1 文 (INSERT ... ON CONFLICT
//     DO UPDATE ... WHERE processing AND stale ... RETURNING) に閉じ、勝者を DB の原子性で
//     1 つに決める (#4128)。完了済 row は奪えないため後着は silent skip (二重課金防止)。
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

		async claim(record, staleClaimBeforeIso) {
			// 処理権の取得を 1 文に閉じ込める (#4128)。競合時に DO UPDATE へ落ちるが、
			// WHERE で「死んだ claim」に限定しているため完了済 row は決して奪われない。
			// RETURNING の有無がそのまま勝敗になる (行が返る = このプロセスが書いた)。
			// retry_count は SET に含めない (再到達の計数を stale 引き取りで消さない)。
			const result = await db.execute(sql`
				INSERT INTO stripe_webhook_events
					(event_id, event_type, processed_at, handler_result, error_message, retry_count,
					 tenant_id)
				VALUES (${record.eventId}, ${record.eventType}, ${record.processedAt}::timestamptz,
					${record.handlerResult}, ${record.errorMessage}, ${record.retryCount},
					${record.tenantId})
				ON CONFLICT (event_id) DO UPDATE SET
					event_type = EXCLUDED.event_type,
					processed_at = EXCLUDED.processed_at,
					handler_result = EXCLUDED.handler_result,
					error_message = EXCLUDED.error_message,
					tenant_id = EXCLUDED.tenant_id
				WHERE stripe_webhook_events.handler_result = 'processing'
					AND stripe_webhook_events.processed_at < ${staleClaimBeforeIso}::timestamptz
				RETURNING 1 AS claimed
			`);
			return result.rows.length > 0;
		},

		async finalize(eventId, handlerResult, processedAtIso) {
			await db.execute(sql`
				UPDATE stripe_webhook_events
				SET handler_result = ${handlerResult}, processed_at = ${processedAtIso}::timestamptz
				WHERE event_id = ${eventId}
			`);
		},

		async releaseClaim(eventId) {
			// 完了済 row を巻き添えで消さないよう processing に限定する。
			await db.execute(sql`
				DELETE FROM stripe_webhook_events
				WHERE event_id = ${eventId} AND handler_result = 'processing'
			`);
		},

		async incrementRetryCount(eventId) {
			await db.execute(sql`
				UPDATE stripe_webhook_events SET retry_count = retry_count + 1
				WHERE event_id = ${eventId}
			`);
		},

		async deleteOlderThan(cutoffIso) {
			// #3625: 削除件数は CTE で DB 側 count 集約し、削除全行を client に materialize しない
			// (retention cron で大量 webhook event を削除しうる)。
			const result = await db.execute(sql`
				WITH deleted AS (
					DELETE FROM stripe_webhook_events WHERE processed_at < ${cutoffIso}::timestamptz
					RETURNING 1
				)
				SELECT count(*)::int AS c FROM deleted
			`);
			return Number((result.rows[0] as { c: number }).c);
		},
	};
}
