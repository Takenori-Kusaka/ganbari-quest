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
	/**
	 * 処理権を取得した時刻 / handler 実行完了時刻 (ISO 8601)。
	 *
	 * `handlerResult === 'processing'` の間は「いつ掴んだか」を意味し、stale claim の
	 * 判定基準になる (#4128)。完了時に完了時刻で上書きされる。
	 */
	processedAt: string;
	/**
	 * handler 実行結果。
	 *
	 * - `'processing'` — 処理権を取得したが handler 未完了 (#4128 insert-first)。
	 *   正常系では一過性で、成功なら `'success'` / `'skipped'` に、失敗なら row ごと消える。
	 *   Lambda が処理中に死ぬと残るため、一定時間経過後は他プロセスが奪える (stale claim)。
	 * - `'success'` — handler が正常終了した
	 * - `'skipped'` — 未購読の event 型だった
	 * - `'error'` — 予約 (現行の dispatcher は失敗時に row を残さない、§4.2)
	 */
	handlerResult: 'processing' | 'success' | 'error' | 'skipped';
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
	 * event の**処理権**を取得する (insert-first、#4128)。
	 *
	 * 「find して無ければ処理する」は find と insert の間に await 境界があるため、同一
	 * event.id の並列到達で両方が通過し handler が二重実行される (痕跡も残らない)。
	 * 処理権の取得を **1 文の insert (競合時は条件付き update)** に閉じ込め、DB の原子性で
	 * 勝者を 1 つに決める。
	 *
	 * 勝つ条件は 2 つだけ:
	 *   1. row が存在しない (初回到達)
	 *   2. 既存 row が `'processing'` のまま `staleClaimBeforeIso` より古い
	 *      (処理中に Lambda が死んだ claim を引き取る。これが無いと insert-first は
	 *      「一度掴んで死んだ event を永久に捨てる」機構になる)
	 *
	 * 完了済 row (`'success'` / `'skipped'`) は決して奪えない = 冪等性は保たれる。
	 *
	 * @param record `handlerResult: 'processing'` で渡す。`processedAt` は取得時刻
	 * @param staleClaimBeforeIso この時刻より古い `'processing'` は死んだ claim とみなす
	 * @returns このプロセスが処理権を得たら true。false なら handler を実行してはならない
	 */
	claim(record: WebhookEventRecord, staleClaimBeforeIso: string): Promise<boolean>;

	/**
	 * 処理権を持つ row の最終結果を確定する (#4128)。
	 *
	 * @param eventId Stripe `evt_*`
	 * @param handlerResult handler の実行結果
	 * @param processedAtIso 完了時刻 (ISO 8601)
	 */
	finalize(
		eventId: string,
		handlerResult: 'success' | 'skipped',
		processedAtIso: string,
	): Promise<void>;

	/**
	 * 処理権を解放する (handler 失敗時、#4128)。
	 *
	 * 台帳は「**完了した** event の台帳」なので、失敗した event の row は残さない。
	 * 残すと次回到達で dedup され、Stripe の再送で復旧する経路を自分で潰す (§4.2)。
	 *
	 * @param eventId Stripe `evt_*`
	 */
	releaseClaim(eventId: string): Promise<void>;

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
