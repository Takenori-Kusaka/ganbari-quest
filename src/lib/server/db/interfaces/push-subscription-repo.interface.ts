import type {
	InsertNotificationLogInput,
	InsertPushSubscriptionInput,
	NotificationLog,
	PushSubscriptionRecord,
} from '../types';

export interface IPushSubscriptionRepo {
	findByTenant(tenantId: string): Promise<PushSubscriptionRecord[]>;
	findByEndpoint(endpoint: string, tenantId: string): Promise<PushSubscriptionRecord | undefined>;
	insert(input: InsertPushSubscriptionInput): Promise<PushSubscriptionRecord>;
	deleteByEndpoint(endpoint: string, tenantId: string): Promise<void>;

	// Notification logs
	insertLog(input: InsertNotificationLogInput): Promise<NotificationLog>;
	countTodayLogs(tenantId: string, today: string): Promise<number>;
	findRecentLogs(tenantId: string, limit: number): Promise<NotificationLog[]>;
}
