// src/lib/server/db/dynamodb/activity-mastery-repo.ts
// 活動習熟度リポジトリ（DynamoDB実装）

import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { ActivityMastery } from '../types';
import { getDocClient, TABLE_NAME } from './client';
import { activityMasteryKey, activityMasteryPrefix, childPK } from './keys';

function stripKeys<T extends Record<string, unknown>>(
	item: T,
): Omit<T, 'PK' | 'SK' | 'GSI2PK' | 'GSI2SK'> {
	const { PK, SK, GSI2PK, GSI2SK, ...rest } = item;
	return rest;
}

export async function findByChildAndActivity(
	childId: number,
	activityId: number,
	tenantId: string,
): Promise<ActivityMastery | undefined> {
	const key = activityMasteryKey(childId, activityId, tenantId);
	const result = await getDocClient().send(new GetCommand({ TableName: TABLE_NAME, Key: key }));
	if (!result.Item) return undefined;
	return stripKeys(result.Item as unknown as Record<string, unknown>) as unknown as ActivityMastery;
}

export async function findAllByChild(
	childId: number,
	tenantId: string,
): Promise<ActivityMastery[]> {
	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': childPK(childId, tenantId),
				':prefix': activityMasteryPrefix(),
			},
		}),
	);
	return (result.Items ?? []).map(
		(item) => stripKeys(item as unknown as Record<string, unknown>) as unknown as ActivityMastery,
	);
}

export async function upsert(
	childId: number,
	activityId: number,
	totalCount: number,
	level: number,
	tenantId: string,
): Promise<ActivityMastery> {
	const now = new Date().toISOString();
	const key = activityMasteryKey(childId, activityId, tenantId);
	const existing = await findByChildAndActivity(childId, activityId, tenantId);

	const id = existing?.id ?? Date.now();
	const item: Record<string, unknown> = {
		...key,
		id,
		childId,
		activityId,
		totalCount,
		level,
		updatedAt: now,
	};

	await getDocClient().send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
	return stripKeys(item) as unknown as ActivityMastery;
}
