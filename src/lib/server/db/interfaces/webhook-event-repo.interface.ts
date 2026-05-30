// src/lib/server/db/interfaces/webhook-event-repo.interface.ts
//
// Stripe Webhook 冪等性 dedup repository interface (#2641 / Phase 5 子 3 / Phase 7 PR-1)
//
// 4 backend (sqlite / dynamodb / in-memory demo / unit fixture) で同一 interface を実装する SSOT。
// dedup 判定 (`findByEventId`) と handler 結果書込み (`insert`) を 1 transaction で対 (at-least-once
// で冪等 handler を作る Stripe 推奨パターン整合)。
//
// 設計 SSOT:
// - docs/design/billing-redesign/phase5-webhook-idempotency-architecture.md §3.4 (本 interface SSOT)
// - docs/design/billing-redesign/phase6-db-migration-plan.md §3.4 (本 PR で配備)

/**
 * Stripe Webhook 1 event の処理結果 record。
 *
 * Stripe `evt_*` を PK にし、handler 実行結果 + retry_count を保存する。
 * 30 日 retention (ADR-0049、Stripe Events API 保持期間と同期) で物理削除される。
 */
export interface WebhookEventRecord {
	/** Stripe event.id (`evt_*`)、immutable、Stripe 側 SSOT */
	eventId: string;
	/** event.type (`checkout.session.completed` / `invoice.paid` 等) */
	eventType: string;
	/** handler 実行完了時刻 (ISO 8601) */
	processedAt: string;
	/** handler 実行結果 — 'skipped' は未購読 event 型を意味する */
	handlerResult: 'success' | 'error' | 'skipped';
	/** handler 例外時の error message (Stripe.Error.message 最大 500 文字 truncate、PII strip 済) */
	errorMessage: string | null;
	/** 同一 event.id の再到達回数 (初回 = 0、replay/resend で increment) */
	retryCount: number;
	/** 関連 tenant_id (handler が解決できた場合のみ、analytics 用、PII ではない) */
	tenantId: string | null;
}

/**
 * Stripe Webhook 冪等性 dedup repository interface (4 backend 統一)。
 *
 * Phase 7 PR-4a で `src/lib/server/services/stripe-service.ts` の `handleWebhookEvent`
 * dispatcher 入口に統合される。Step 1 (本 PR) では interface + in-memory demo / unit fixture
 * 実装のみ配備し、sqlite / dynamodb 実装は Phase 7 PR-4a (webhook handler 統合) で同時実装する。
 */
export interface IWebhookEventRepo {
	/**
	 * event.id に対応する処理済み record を返す (dedup 判定の primary check)。
	 *
	 * @param eventId Stripe `evt_*`
	 * @returns 既に処理済みなら record、未処理なら null
	 */
	findByEventId(eventId: string): Promise<WebhookEventRecord | null>;

	/**
	 * 新規 event の処理結果を insert する。
	 *
	 * `findByEventId` が null を返した直後に呼ぶ前提。並列同時到達時の競合は PK 制約で
	 * 検知し、INSERT OR IGNORE / `ConditionExpression: attribute_not_exists` で
	 * 2 度目以降を弾く (Phase 5 子 3 §13 #6、Phase 7 PR-4a 実装)。
	 *
	 * @param record event 処理結果
	 */
	insert(record: WebhookEventRecord): Promise<void>;

	/**
	 * 既存 record の retry_count を +1 する (replay / resend で同一 event.id 再到達時)。
	 *
	 * @param eventId Stripe `evt_*`
	 */
	incrementRetryCount(eventId: string): Promise<void>;

	/**
	 * `processedAt < cutoffIso` の row を物理削除する (sqlite 用、30 日 retention cron)。
	 *
	 * DynamoDB は item-level TTL native 機能で自動削除されるため、dynamodb 実装は
	 * 本メソッドを no-op で実装してよい (Phase 5 子 3 §3.2)。
	 *
	 * @param cutoffIso ISO 8601、この時刻より前の row を削除
	 * @returns 削除した row 数
	 */
	deleteOlderThan(cutoffIso: string): Promise<number>;
}
