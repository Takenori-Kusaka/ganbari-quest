// src/lib/server/db/dynamodb/activity-pref-repo.ts
// DynamoDB implementation of IActivityPrefRepo

import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { ActivityUsageCount, ChildActivityPreference } from '../types';
import { deleteItemsByPkPrefix } from './bulk-delete';
import { getDocClient, TABLE_NAME } from './client';
import { activityLogPrefix, activityPrefKey, activityPrefPrefix, childPK, tenantPK } from './keys';

function stripKeys<T extends Record<string, unknown>>(
	item: T,
): Omit<T, 'PK' | 'SK' | 'GSI2PK' | 'GSI2SK'> {
	const { PK, SK, GSI2PK, GSI2SK, ...rest } = item;
	return rest;
}

export async function findPinnedByChild(
	childId: number,
	tenantId: string,
): Promise<ChildActivityPreference[]> {
	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			FilterExpression: 'isPinned = :pinned',
			ExpressionAttributeValues: {
				':pk': childPK(childId, tenantId),
				':prefix': activityPrefPrefix(),
				':pinned': 1,
			},
		}),
	);
	const items = (result.Items ?? []) as unknown as ChildActivityPreference[];
	return items
		.map(
			(item) =>
				stripKeys(item as unknown as Record<string, unknown>) as unknown as ChildActivityPreference,
		)
		.sort((a, b) => (a.pinOrder ?? 999) - (b.pinOrder ?? 999));
}

export async function togglePin(
	childId: number,
	activityId: number,
	pinned: boolean,
	tenantId: string,
): Promise<ChildActivityPreference> {
	const now = new Date().toISOString();
	const key = activityPrefKey(childId, activityId, tenantId);

	// Get existing item
	const existing = await getDocClient().send(new GetCommand({ TableName: TABLE_NAME, Key: key }));

	let pinOrder: number | null = null;
	if (pinned) {
		// Find max pinOrder
		const pinnedItems = await findPinnedByChild(childId, tenantId);
		pinOrder = pinnedItems.reduce((max, p) => Math.max(max, p.pinOrder ?? 0), 0) + 1;
	}

	const id = existing.Item?.id ?? Date.now();
	const item: Record<string, unknown> = {
		...key,
		id,
		childId,
		activityId,
		isPinned: pinned ? 1 : 0,
		pinOrder,
		createdAt: existing.Item?.createdAt ?? now,
		updatedAt: now,
	};

	await getDocClient().send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

	return stripKeys(item) as unknown as ChildActivityPreference;
}

export async function countPinnedInCategory(
	childId: number,
	categoryId: number,
	tenantId: string,
): Promise<number> {
	// Get all pinned prefs, then filter by checking activity's category
	const pinnedItems = await findPinnedByChild(childId, tenantId);
	// We need to check each activity's category — query the activity items
	let count = 0;
	for (const pref of pinnedItems) {
		const actKey = {
			PK: tenantPK(`ACTIVITY#${String(pref.activityId).padStart(8, '0')}`, tenantId),
			SK: 'MASTER',
		};
		const actResult = await getDocClient().send(
			new GetCommand({ TableName: TABLE_NAME, Key: actKey }),
		);
		if (actResult.Item && (actResult.Item as Record<string, unknown>).categoryId === categoryId) {
			count++;
		}
	}
	return count;
}

export async function getUsageCounts(
	childId: number,
	sinceDate: string,
	_tenantId: string,
): Promise<ActivityUsageCount[]> {
	// Query activity logs for this child since sinceDate
	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			FilterExpression:
				'recordedDate >= :since AND (attribute_not_exists(cancelled) OR cancelled = :notCancelled)',
			ExpressionAttributeValues: {
				':pk': childPK(childId, _tenantId),
				':prefix': activityLogPrefix(),
				':since': sinceDate,
				':notCancelled': 0,
			},
		}),
	);

	// Aggregate by activityId
	const countMap = new Map<number, number>();
	for (const item of result.Items ?? []) {
		const activityId = (item as Record<string, unknown>).activityId as number;
		countMap.set(activityId, (countMap.get(activityId) ?? 0) + 1);
	}

	return Array.from(countMap.entries()).map(([activityId, usageCount]) => ({
		activityId,
		usageCount,
	}));
}

/** テナントの全活動ピン留め設定を削除（CHILD#* 配下の ACTPREF# アイテム） */
export async function deleteByTenantId(tenantId: string): Promise<void> {
	await deleteItemsByPkPrefix(tenantPK('CHILD#', tenantId), activityPrefPrefix());
}
