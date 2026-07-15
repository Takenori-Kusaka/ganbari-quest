// src/lib/server/db/dynamodb/activity-mastery-repo.ts
// 活動習熟度リポジトリ（DynamoDB実装）

import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { ActivityId, ChildId } from '$lib/domain/ids';
import { asActivityId, asChildId } from '$lib/domain/ids';
import type { ActivityMastery } from '../types';
import { deleteChildScopedItems } from './bulk-delete';
import { getDocClient, TABLE_NAME } from './client';
import { activityMasteryKey, activityMasteryPrefix, childPK } from './keys';

function stripKeys<T extends Record<string, unknown>>(
	item: T,
): Omit<T, 'PK' | 'SK' | 'GSI2PK' | 'GSI2SK'> {
	const { PK, SK, GSI2PK, GSI2SK, ...rest } = item;
	return rest;
}

// stored item は数値 id のまま (storage format 不変、#3575)。repo 境界で branded string に変換する。
type StoredActivityMastery = Omit<ActivityMastery, 'id' | 'childId' | 'activityId'> & {
	id: number;
	childId: number;
	activityId: number;
};

function toActivityMastery(item: Record<string, unknown>): ActivityMastery {
	const raw = stripKeys(item) as unknown as StoredActivityMastery;
	return {
		...raw,
		id: String(raw.id),
		childId: asChildId(raw.childId),
		activityId: asActivityId(raw.activityId),
	};
}

export async function findByChildAndActivity(
	childId: ChildId,
	activityId: ActivityId,
	tenantId: string,
): Promise<ActivityMastery | undefined> {
	const key = activityMasteryKey(Number(childId), Number(activityId), tenantId);
	const result = await getDocClient().send(new GetCommand({ TableName: TABLE_NAME, Key: key }));
	if (!result.Item) return undefined;
	return toActivityMastery(result.Item as unknown as Record<string, unknown>);
}

export async function findAllByChild(
	childId: ChildId,
	tenantId: string,
): Promise<ActivityMastery[]> {
	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': childPK(Number(childId), tenantId),
				':prefix': activityMasteryPrefix(),
			},
		}),
	);
	return (result.Items ?? []).map((item) =>
		toActivityMastery(item as unknown as Record<string, unknown>),
	);
}

export async function upsert(
	childId: ChildId,
	activityId: ActivityId,
	totalCount: number,
	level: number,
	tenantId: string,
): Promise<ActivityMastery> {
	const now = new Date().toISOString();
	const key = activityMasteryKey(Number(childId), Number(activityId), tenantId);
	const existing = await findByChildAndActivity(childId, activityId, tenantId);

	const id = existing ? Number(existing.id) : Date.now();
	const item: Record<string, unknown> = {
		...key,
		id,
		childId: Number(childId),
		activityId: Number(activityId),
		totalCount,
		level,
		updatedAt: now,
	};

	await getDocClient().send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
	return toActivityMastery(item);
}

/** テナントの全活動習熟度を削除（CHILD#* パーティション配下の MAST# アイテム、#3693: childIds 指定時は Query 化） */
export async function deleteByTenantId(
	tenantId: string,
	childIds?: readonly ChildId[],
): Promise<void> {
	await deleteChildScopedItems(tenantId, childIds, activityMasteryPrefix());
}
