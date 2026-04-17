// src/lib/server/db/push-subscription-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type {
	InsertNotificationLogInput,
	InsertPushSubscriptionInput,
	NotificationLog,
	PushSubscriptionRecord,
} from './types';

export async function findByTenant(tenantId: string): Promise<PushSubscriptionRecord[]> {
	return getRepos().pushSubscription.findByTenant(tenantId);
}

export async function findByEndpoint(
	endpoint: string,
	tenantId: string,
): Promise<PushSubscriptionRecord | undefined> {
	return getRepos().pushSubscription.findByEndpoint(endpoint, tenantId);
}

export async function insert(input: InsertPushSubscriptionInput): Promise<PushSubscriptionRecord> {
	return getRepos().pushSubscription.insert(input);
}

export async function deleteByEndpoint(endpoint: string, tenantId: string): Promise<void> {
	return getRepos().pushSubscription.deleteByEndpoint(endpoint, tenantId);
}

export async function insertLog(input: InsertNotificationLogInput): Promise<NotificationLog> {
	return getRepos().pushSubscription.insertLog(input);
}

export async function countTodayLogs(tenantId: string, today: string): Promise<number> {
	return getRepos().pushSubscription.countTodayLogs(tenantId, today);
}

async function findRecentLogs(tenantId: string, limit: number): Promise<NotificationLog[]> {
	return getRepos().pushSubscription.findRecentLogs(tenantId, limit);
}
