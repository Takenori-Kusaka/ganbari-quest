// src/lib/server/db/dynamodb/special-reward-repo.ts
// DynamoDB implementation of ISpecialRewardRepo

import { PutCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { InsertSpecialRewardInput, SpecialReward } from '../types';
import { deleteItemsByPkPrefix } from './bulk-delete';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import { childPK, ENTITY_NAMES, specialRewardKey, specialRewardPrefix, tenantPK } from './keys';

/** Strip PK/SK/GSI keys from a DynamoDB item */
function stripKeys<T extends Record<string, unknown>>(
	item: T,
): Omit<T, 'PK' | 'SK' | 'GSI2PK' | 'GSI2SK'> {
	const { PK, SK, GSI2PK, GSI2SK, ...rest } = item;
	return rest;
}

/** 特別報酬を記録 */
export async function insertSpecialReward(
	input: InsertSpecialRewardInput,
	tenantId: string,
): Promise<SpecialReward> {
	const id = await nextId(ENTITY_NAMES.specialReward, tenantId);
	const now = new Date().toISOString();

	const reward: SpecialReward = {
		id,
		childId: input.childId,
		grantedBy: input.grantedBy ?? null,
		title: input.title,
		description: input.description ?? null,
		points: input.points,
		icon: input.icon ?? null,
		category: input.category,
		grantedAt: now,
		shownAt: null,
		sourcePresetId: input.sourcePresetId ?? null,
	};

	const key = specialRewardKey(input.childId, now, id, tenantId);

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...key,
				...reward,
			},
		}),
	);

	return reward;
}

/** 子供の特別報酬履歴を取得（降順） */
export async function findSpecialRewards(
	childId: number,
	tenantId: string,
): Promise<SpecialReward[]> {
	const pk = childPK(childId, tenantId);
	const prefix = specialRewardPrefix();

	const items: SpecialReward[] = [];
	let lastKey: Record<string, unknown> | undefined;

	do {
		const result = await getDocClient().send(
			new QueryCommand({
				TableName: TABLE_NAME,
				KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
				ExpressionAttributeValues: {
					':pk': pk,
					':prefix': prefix,
				},
				ScanIndexForward: false, // descending order (newest first)
				ExclusiveStartKey: lastKey,
			}),
		);

		for (const item of result.Items ?? []) {
			items.push(stripKeys(item) as unknown as SpecialReward);
		}
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);

	return items;
}

/** 子供の未表示の特別報酬を1件取得 */
export async function findUnshownReward(
	childId: number,
	tenantId: string,
): Promise<SpecialReward | undefined> {
	const pk = childPK(childId, tenantId);
	const prefix = specialRewardPrefix();

	// Query all rewards for this child (descending), filter for unshown
	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			FilterExpression: 'attribute_not_exists(shownAt) OR shownAt = :null',
			ExpressionAttributeValues: {
				':pk': pk,
				':prefix': prefix,
				':null': null,
			},
			ScanIndexForward: false, // descending order (newest first)
			Limit: 1,
		}),
	);

	const items = result.Items ?? [];
	if (items.length === 0) return undefined;
	return stripKeys(items[0] as Record<string, unknown>) as unknown as SpecialReward;
}

/** 特別報酬を表示済みにする */
export async function markRewardShown(
	rewardId: number,
	_tenantId: string,
): Promise<SpecialReward | undefined> {
	// Since we don't know the PK/SK for a given rewardId, we need to scan for it
	const result = await getDocClient().send(
		new ScanCommand({
			TableName: TABLE_NAME,
			FilterExpression: 'begins_with(SK, :prefix) AND id = :id',
			ExpressionAttributeValues: {
				':prefix': 'REWARD#',
				':id': rewardId,
			},
			Limit: 1,
		}),
	);

	const items = result.Items ?? [];
	if (items.length === 0) return undefined;

	const item = items[0] as Record<string, unknown>;
	const pk = item.PK as string;
	const sk = item.SK as string;
	const now = new Date().toISOString();

	const updateResult = await getDocClient().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: { PK: pk, SK: sk },
			UpdateExpression: 'SET #shownAt = :shownAt',
			ExpressionAttributeNames: { '#shownAt': 'shownAt' },
			ExpressionAttributeValues: { ':shownAt': now },
			ReturnValues: 'ALL_NEW',
		}),
	);

	if (!updateResult.Attributes) return undefined;
	return stripKeys(updateResult.Attributes) as unknown as SpecialReward;
}

/** テナントの全特別報酬を削除（CHILD#* 配下の REWARD# アイテム） */
export async function deleteByTenantId(tenantId: string): Promise<void> {
	await deleteItemsByPkPrefix(tenantPK('CHILD#', tenantId), specialRewardPrefix());
}
