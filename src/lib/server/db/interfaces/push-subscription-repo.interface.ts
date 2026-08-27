import type {
	InsertNotificationLogInput,
	InsertPushSubscriptionInput,
	NotificationLog,
	PushSubscriptionRecord,
} from '../types';

export interface IPushSubscriptionRepo {
	findByTenant(tenantId: string): Promise<PushSubscriptionRecord[]>;
	/**
	 * endpoint (global UNIQUE) の値単独 lookup。**#3574 ② で family scope を再適用する契約に変更**:
	 * endpoint は attacker 可制御値 (subscribe route の body.endpoint) のため、返却前に family_id で
	 * 再スコープし cross-family read (push key 存在オラクル) を遮断する (§P9)。endpoint は 1 family に
	 * しか属さない (global UNIQUE) ので family 一致時のみ 1 行に解決する。全 backend で tenantId を使う。
	 */
	findByEndpoint(endpoint: string, tenantId: string): Promise<PushSubscriptionRecord | undefined>;
	insert(input: InsertPushSubscriptionInput): Promise<PushSubscriptionRecord>;
	/**
	 * **#3574 ②**: family scope 再適用 (§P9)。unsubscribe route が body.endpoint をそのまま渡すため、
	 * family 不一致の削除は cross-family IDOR-delete になる。family 一致行のみ削除し不一致は no-op。
	 */
	deleteByEndpoint(endpoint: string, tenantId: string): Promise<void>;

	// Notification logs
	insertLog(input: InsertNotificationLogInput): Promise<NotificationLog>;
	/**
	 * 送信ログの件数を **UTC instant 範囲** [fromIso, toIso) で数える (#4722)。
	 * 旧 `countTodayLogs(tenantId, today)` は JST の暦日文字列を UTC 日境界として比較しており、
	 * 日次上限のカウント窓が 9 時間ずれていた (JST 09:00 〜 翌 09:00 を「今日」と数えていた)。
	 * 呼び出し側が `jstDayStartUtcIso()` で JST 暦日の境界を instant 化して渡す。
	 */
	countLogsBetween(tenantId: string, fromIso: string, toIso: string): Promise<number>;
	findRecentLogs(tenantId: string, limit: number): Promise<NotificationLog[]>;
}
