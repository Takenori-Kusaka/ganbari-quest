import type {
	InsertNotificationLogInput,
	InsertPushSubscriptionInput,
	NotificationLog,
	PushSubscriptionRecord,
} from '../types';

const NOT_IMPL = 'DynamoDB push-subscription-repo not implemented';

export async function findByTenant(_tenantId: string): Promise<PushSubscriptionRecord[]> {
	throw new Error(NOT_IMPL);
}

export async function findByEndpoint(
	_endpoint: string,
	_tenantId: string,
): Promise<PushSubscriptionRecord | undefined> {
	throw new Error(NOT_IMPL);
}

export async function insert(_input: InsertPushSubscriptionInput): Promise<PushSubscriptionRecord> {
	throw new Error(NOT_IMPL);
}

export async function deleteByEndpoint(_endpoint: string, _tenantId: string): Promise<void> {
	throw new Error(NOT_IMPL);
}

export async function insertLog(_input: InsertNotificationLogInput): Promise<NotificationLog> {
	throw new Error(NOT_IMPL);
}

export async function countTodayLogs(_tenantId: string, _today: string): Promise<number> {
	throw new Error(NOT_IMPL);
}

export async function findRecentLogs(
	_tenantId: string,
	_limit: number,
): Promise<NotificationLog[]> {
	throw new Error(NOT_IMPL);
}
