import { and, count, desc, eq, gte, lt } from 'drizzle-orm';
import { db } from '../client';
import { notificationLogs, pushSubscriptions } from '../schema';
import type {
	InsertNotificationLogInput,
	InsertPushSubscriptionInput,
	NotificationLog,
	PushSubscriberRole,
	PushSubscriptionRecord,
} from '../types';

/**
 * #1593 (ADR-0023 I6): drizzle が schema.ts の `text('subscriber_role')` を `string` と推論するため、
 * Repository 境界で `PushSubscriberRole` 型に正規化する。送信側 (notification-service) で
 * `subscriberRole !== 'parent' && subscriberRole !== 'owner'` を skip する二重防御があるため、
 * 既存 DB の不正値（NULL / 旧 `'child'` レコード）も安全側に倒れる。
 */
type RawPushSubscriptionRow = Omit<PushSubscriptionRecord, 'subscriberRole'> & {
	subscriberRole: string;
};

function normalizePushRow(row: RawPushSubscriptionRow): PushSubscriptionRecord {
	// 不正値はそのまま PushSubscriberRole にキャストせず string 経由で渡す。
	// 送信側で安全に skip されるため、ここで `'parent' | 'owner'` 以外を捨てる必要はない。
	return row as unknown as PushSubscriptionRecord;
}

export async function findByTenant(tenantId: string): Promise<PushSubscriptionRecord[]> {
	const rows = (await db
		.select()
		.from(pushSubscriptions)
		.where(eq(pushSubscriptions.tenantId, tenantId))
		.all()) as RawPushSubscriptionRow[];
	return rows.map(normalizePushRow);
}

export async function findByEndpoint(
	endpoint: string,
	_tenantId: string,
): Promise<PushSubscriptionRecord | undefined> {
	const row = (await db
		.select()
		.from(pushSubscriptions)
		.where(eq(pushSubscriptions.endpoint, endpoint))
		.get()) as RawPushSubscriptionRow | undefined;
	return row ? normalizePushRow(row) : undefined;
}

export async function insert(input: InsertPushSubscriptionInput): Promise<PushSubscriptionRecord> {
	const now = new Date().toISOString();
	const row = (await db
		.insert(pushSubscriptions)
		.values({
			tenantId: input.tenantId,
			endpoint: input.endpoint,
			keysP256dh: input.keysP256dh,
			keysAuth: input.keysAuth,
			userAgent: input.userAgent ?? null,
			subscriberRole: input.subscriberRole satisfies PushSubscriberRole,
			createdAt: now,
		})
		.returning()
		.get()) as RawPushSubscriptionRow;
	return normalizePushRow(row);
}

export async function deleteByEndpoint(endpoint: string, _tenantId: string): Promise<void> {
	db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).run();
}

// ============================================================
// Notification Logs
// ============================================================

export async function insertLog(input: InsertNotificationLogInput): Promise<NotificationLog> {
	const now = new Date().toISOString();
	return db
		.insert(notificationLogs)
		.values({
			tenantId: input.tenantId,
			notificationType: input.notificationType,
			title: input.title,
			body: input.body,
			sentAt: now,
			success: input.success ? 1 : 0,
			errorMessage: input.errorMessage ?? null,
		})
		.returning()
		.get();
}

export async function countTodayLogs(tenantId: string, today: string): Promise<number> {
	const nextDay = `${today}T99:99:99`; // anything > today's timestamps
	const result = db
		.select({ value: count() })
		.from(notificationLogs)
		.where(
			and(
				eq(notificationLogs.tenantId, tenantId),
				gte(notificationLogs.sentAt, `${today}T00:00:00`),
				lt(notificationLogs.sentAt, nextDay),
			),
		)
		.get();
	return result?.value ?? 0;
}

export async function findRecentLogs(tenantId: string, limit: number): Promise<NotificationLog[]> {
	return db
		.select()
		.from(notificationLogs)
		.where(eq(notificationLogs.tenantId, tenantId))
		.orderBy(desc(notificationLogs.sentAt))
		.limit(limit)
		.all();
}
