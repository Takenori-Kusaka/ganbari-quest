// Demo IPushSubscriptionRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import type {
	InsertNotificationLogInput,
	InsertPushSubscriptionInput,
	NotificationLog,
	PushSubscriptionRecord,
} from '../types';

export async function findByTenant(_tenantId: string): Promise<PushSubscriptionRecord[]> {
	return [];
}

export async function findByEndpoint(
	_endpoint: string,
	_tenantId: string,
): Promise<PushSubscriptionRecord | undefined> {
	return undefined;
}

export async function insert(input: InsertPushSubscriptionInput): Promise<PushSubscriptionRecord> {
	return {
		id: 0,
		tenantId: input.tenantId,
		endpoint: input.endpoint,
		keysP256dh: input.keysP256dh,
		keysAuth: input.keysAuth,
		userAgent: input.userAgent ?? null,
		subscriberRole: input.subscriberRole,
		createdAt: new Date().toISOString(),
	};
}

export async function deleteByEndpoint(_endpoint: string, _tenantId: string): Promise<void> {
	// Stub: no-op
}

export async function insertLog(input: InsertNotificationLogInput): Promise<NotificationLog> {
	return {
		id: 0,
		tenantId: input.tenantId,
		notificationType: input.notificationType,
		title: input.title,
		body: input.body,
		sentAt: new Date().toISOString(),
		success: input.success ? 1 : 0,
		errorMessage: input.errorMessage ?? null,
	};
}

export async function countTodayLogs(_tenantId: string, _today: string): Promise<number> {
	return 0;
}

export async function findRecentLogs(
	_tenantId: string,
	_limit: number,
): Promise<NotificationLog[]> {
	return [];
}
