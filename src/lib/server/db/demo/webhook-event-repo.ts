// src/lib/server/db/demo/webhook-event-repo.ts
//
// In-memory `IWebhookEventRepo` 実装 (demo Lambda + unit fixture 用)。
// #2641 / Phase 5 子 3 / Phase 7 PR-1
//
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid pattern。
// demo Lambda 環境では Map に in-memory 保持し、Lambda 再起動で消える設計
// (demo は単一 tenant + 数分の体験フローのみで永続化不要)。
//
// 設計 SSOT: docs/design/billing-redesign/phase5-webhook-idempotency-architecture.md §3.3
// 関連: src/lib/server/db/interfaces/webhook-event-repo.interface.ts (interface SSOT)

import type {
	IWebhookEventRepo,
	WebhookEventRecord,
} from '../interfaces/webhook-event-repo.interface';

/**
 * demo Lambda 起動から終了まで保持される in-memory Map。
 *
 * Pre-PMF 段階で demo Lambda は ephemeral (Lambda コンテナ ライフサイクル) のため
 * persistent 化は不要。webhook fixture 用 dedup 動作の挙動確認 + unit test の
 * 4 backend 整合検証で使用。
 */
const events = new Map<string, WebhookEventRecord>();

export const demoWebhookEventRepo: IWebhookEventRepo = {
	async findByEventId(eventId) {
		return events.get(eventId) ?? null;
	},
	async claim(record, staleClaimBeforeIso) {
		// SQL 実装 (dsql / sqlite) の 1 文 upsert と同じ判定を in-memory で再現する (#4128)。
		// JS は単一スレッドで本関数内に await が無いため、この読み書きは不可分に進む
		// (= 並列到達しても勝者は 1 つ)。
		const existing = events.get(record.eventId);
		if (existing) {
			const isDeadClaim =
				existing.handlerResult === 'processing' && existing.processedAt < staleClaimBeforeIso;
			if (!isDeadClaim) return false;
			// retry_count は引き継ぐ (再到達の計数を stale 引き取りで消さない)
			events.set(record.eventId, { ...record, retryCount: existing.retryCount });
			return true;
		}
		events.set(record.eventId, record);
		return true;
	},
	async finalize(eventId, handlerResult, processedAtIso) {
		const existing = events.get(eventId);
		if (existing) {
			events.set(eventId, { ...existing, handlerResult, processedAt: processedAtIso });
		}
	},
	async releaseClaim(eventId) {
		// 完了済 row を巻き添えで消さないよう processing に限定する。
		if (events.get(eventId)?.handlerResult === 'processing') {
			events.delete(eventId);
		}
	},
	async incrementRetryCount(eventId) {
		const existing = events.get(eventId);
		if (existing) {
			events.set(eventId, { ...existing, retryCount: existing.retryCount + 1 });
		}
	},
	async deleteOlderThan(cutoffIso) {
		let deleted = 0;
		for (const [id, record] of events) {
			if (record.processedAt < cutoffIso) {
				events.delete(id);
				deleted += 1;
			}
		}
		return deleted;
	},
};

/**
 * Test fixture リセット用 (unit test の `resetDb` パターンと整合)。
 *
 * Phase 7 PR-4a 実装後に webhook fixture を使う E2E / integration test で test 間漏洩を防ぐ。
 * 本 PR では unit test (`tests/unit/db/webhook-event-repo.test.ts`) からのみ呼ばれる。
 */
export function _resetDemoWebhookEvents(): void {
	events.clear();
}
