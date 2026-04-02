import { and, count, desc, eq, gte, lt } from 'drizzle-orm';
import { db } from '../client';
import { notificationLogs, pushSubscriptions } from '../schema';
import type {
	InsertNotificationLogInput,
	InsertPushSubscriptionInput,
	NotificationLog,
	PushSubscriptionRecord,
} from '../types';

export async function findByTenant(tenantId: string): Promise<PushSubscriptionRecord[]> {
	return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.tenantId, tenantId)).all();
}

export async function findByEndpoint(
	endpoint: string,
	_tenantId: string,
): Promise<PushSubscriptionRecord | undefined> {
	return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).get();
}

export async function insert(input: InsertPushSubscriptionInput): Promise<PushSubscriptionRecord> {
	const now = new Date().toISOString();
	return db
		.insert(pushSubscriptions)
		.values({
			tenantId: input.tenantId,
			endpoint: input.endpoint,
			keysP256dh: input.keysP256dh,
			keysAuth: input.keysAuth,
			userAgent: input.userAgent ?? null,
			createdAt: now,
		})
		.returning()
		.get();
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
