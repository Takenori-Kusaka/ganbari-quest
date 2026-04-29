// src/lib/server/db/dynamodb/push-subscription-repo.ts
// DynamoDB implementation of IPushSubscriptionRepo
//
// #1689 (#1666 follow-up — ADR-0023 I6 / ADR-0010 / #1021 段階的リリース禁止)
//
// 設計方針:
//   - SQLite 実装 (src/lib/server/db/sqlite/push-subscription-repo.ts) と機能等価
//   - キー設計:
//       push_subscription:  PK = T#<tenantId>#PUSH_SUB,  SK = PUSH_SUB#<endpointHash>
//       notification_log:   PK = T#<tenantId>#NOTIF_LOG, SK = NOTIF#<sentAt>#<paddedId>
//   - 追加 GSI なし: Pre-PMF 規模 (1家族あたり <10 デバイス, <100 通知/日) では PK Query で十分
//   - subscriberRole は必須属性として PutItem 時に付与 (#1593 ADR-0023 I6 二重防御)
//   - migration script (#1666) と同じ SK = `PUSH_SUB#` prefix 規約を使用

import {
	DeleteCommand,
	GetCommand,
	PutCommand,
	QueryCommand,
	type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import type {
	InsertNotificationLogInput,
	InsertPushSubscriptionInput,
	NotificationLog,
	PushSubscriberRole,
	PushSubscriptionRecord,
} from '../types';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import {
	notificationLogDatePrefix,
	notificationLogKey,
	notificationLogTenantPK,
	pushSubscriptionEndpointHash,
	pushSubscriptionKey,
	pushSubscriptionSKPrefix,
	pushSubscriptionTenantPK,
} from './keys';

// ============================================================
// Item types (DynamoDB attribute layout)
// ============================================================

interface PushSubscriptionItem {
	PK: string;
	SK: string;
	id: number;
	tenantId: string;
	endpoint: string;
	keysP256dh: string;
	keysAuth: string;
	userAgent: string | null;
	subscriberRole: PushSubscriberRole;
	createdAt: string;
}

interface NotificationLogItem {
	PK: string;
	SK: string;
	id: number;
	tenantId: string;
	notificationType: string;
	title: string;
	body: string;
	sentAt: string;
	success: number; // 0 / 1 (SQLite 互換のため number で保持)
	errorMessage: string | null;
}

// ============================================================
// Mappers
// ============================================================

function mapPushItem(item: Record<string, unknown>): PushSubscriptionRecord {
	const i = item as unknown as PushSubscriptionItem;
	// #1593 backfill 観点: 不正値 ('child' / NULL / 空文字列) は string のまま渡す。
	// 送信側 (notification-service) で skip される二重防御があるため、ここでは再キャストしない。
	return {
		id: i.id,
		tenantId: i.tenantId,
		endpoint: i.endpoint,
		keysP256dh: i.keysP256dh,
		keysAuth: i.keysAuth,
		userAgent: i.userAgent ?? null,
		subscriberRole: i.subscriberRole,
		createdAt: i.createdAt,
	};
}

function mapLogItem(item: Record<string, unknown>): NotificationLog {
	const i = item as unknown as NotificationLogItem;
	return {
		id: i.id,
		tenantId: i.tenantId,
		notificationType: i.notificationType,
		title: i.title,
		body: i.body,
		sentAt: i.sentAt,
		success: i.success,
		errorMessage: i.errorMessage ?? null,
	};
}

// ============================================================
// Push subscription operations
// ============================================================

export async function findByTenant(tenantId: string): Promise<PushSubscriptionRecord[]> {
	const all: PushSubscriptionRecord[] = [];
	let exclusiveStartKey: Record<string, unknown> | undefined;
	const pk = pushSubscriptionTenantPK(tenantId);
	const skPrefix = pushSubscriptionSKPrefix();

	do {
		const input: QueryCommandInput = {
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
			ExpressionAttributeValues: {
				':pk': pk,
				':skPrefix': skPrefix,
			},
			ExclusiveStartKey: exclusiveStartKey,
		};
		const res = await getDocClient().send(new QueryCommand(input));
		for (const item of res.Items ?? []) {
			all.push(mapPushItem(item));
		}
		exclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (exclusiveStartKey);

	return all;
}

export async function findByEndpoint(
	endpoint: string,
	tenantId: string,
): Promise<PushSubscriptionRecord | undefined> {
	const endpointHash = pushSubscriptionEndpointHash(endpoint);
	const key = pushSubscriptionKey(tenantId, endpointHash);
	const res = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: key,
		}),
	);
	if (!res.Item) return undefined;
	// 念のため endpoint 完全一致で確認（hash 衝突対策の二重防御）
	const record = mapPushItem(res.Item);
	if (record.endpoint !== endpoint) return undefined;
	return record;
}

export async function insert(input: InsertPushSubscriptionInput): Promise<PushSubscriptionRecord> {
	const createdAt = new Date().toISOString();
	const id = await nextId('pushSubscription', input.tenantId);
	const endpointHash = pushSubscriptionEndpointHash(input.endpoint);

	const item: PushSubscriptionItem = {
		...pushSubscriptionKey(input.tenantId, endpointHash),
		id,
		tenantId: input.tenantId,
		endpoint: input.endpoint,
		keysP256dh: input.keysP256dh,
		keysAuth: input.keysAuth,
		userAgent: input.userAgent ?? null,
		subscriberRole: input.subscriberRole satisfies PushSubscriberRole,
		createdAt,
	};

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: item,
		}),
	);

	return {
		id,
		tenantId: input.tenantId,
		endpoint: input.endpoint,
		keysP256dh: input.keysP256dh,
		keysAuth: input.keysAuth,
		userAgent: input.userAgent ?? null,
		subscriberRole: input.subscriberRole,
		createdAt,
	};
}

export async function deleteByEndpoint(endpoint: string, tenantId: string): Promise<void> {
	const endpointHash = pushSubscriptionEndpointHash(endpoint);
	const key = pushSubscriptionKey(tenantId, endpointHash);
	await getDocClient().send(
		new DeleteCommand({
			TableName: TABLE_NAME,
			Key: key,
		}),
	);
}

// ============================================================
// Notification log operations
// ============================================================

export async function insertLog(input: InsertNotificationLogInput): Promise<NotificationLog> {
	const sentAt = new Date().toISOString();
	const id = await nextId('notificationLog', input.tenantId);
	const successInt = input.success ? 1 : 0;

	const item: NotificationLogItem = {
		...notificationLogKey(input.tenantId, sentAt, id),
		id,
		tenantId: input.tenantId,
		notificationType: input.notificationType,
		title: input.title,
		body: input.body,
		sentAt,
		success: successInt,
		errorMessage: input.errorMessage ?? null,
	};

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: item,
		}),
	);

	return {
		id,
		tenantId: input.tenantId,
		notificationType: input.notificationType,
		title: input.title,
		body: input.body,
		sentAt,
		success: successInt,
		errorMessage: input.errorMessage ?? null,
	};
}

/**
 * 当日 (today) の通知ログ件数をカウント。
 * SQLite 実装と一致: today (YYYY-MM-DD) 始まりの sentAt 範囲を集計。
 *
 * SK = `NOTIF#<sentAt>#<paddedId>` のため `NOTIF#<today>T00:00:00` ~ `NOTIF#<today>T99:99:99`
 * の範囲 Query で当日分を抽出可能 (sentAt は ISO 8601、辞書順比較で OK)。
 */
export async function countTodayLogs(tenantId: string, today: string): Promise<number> {
	const pk = notificationLogTenantPK(tenantId);
	const skStart = `${notificationLogDatePrefix(today)}T00:00:00`;
	const skEnd = `${notificationLogDatePrefix(today)}T99:99:99`;

	let count = 0;
	let exclusiveStartKey: Record<string, unknown> | undefined;
	do {
		const input: QueryCommandInput = {
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND SK BETWEEN :skStart AND :skEnd',
			ExpressionAttributeValues: {
				':pk': pk,
				':skStart': skStart,
				':skEnd': skEnd,
			},
			Select: 'COUNT',
			ExclusiveStartKey: exclusiveStartKey,
		};
		const res = await getDocClient().send(new QueryCommand(input));
		count += res.Count ?? 0;
		exclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (exclusiveStartKey);

	return count;
}

/**
 * 最新の通知ログ N 件を返す (sentAt 降順)。
 * SK が `NOTIF#<sentAt>#<id>` で時刻順なので ScanIndexForward=false で逆順 + Limit。
 */
export async function findRecentLogs(tenantId: string, limit: number): Promise<NotificationLog[]> {
	const pk = notificationLogTenantPK(tenantId);
	const input: QueryCommandInput = {
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
		ExpressionAttributeValues: {
			':pk': pk,
			':skPrefix': 'NOTIF#',
		},
		ScanIndexForward: false, // 降順
		Limit: limit,
	};
	const res = await getDocClient().send(new QueryCommand(input));
	return (res.Items ?? []).map(mapLogItem);
}
