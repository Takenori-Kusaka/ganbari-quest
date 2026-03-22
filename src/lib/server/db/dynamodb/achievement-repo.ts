// src/lib/server/db/dynamodb/achievement-repo.ts
// DynamoDB implementation of IAchievementRepo

import { GetCommand, PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { Achievement, ChildAchievement } from '../types';
import { TABLE_NAME, getDocClient } from './client';
import { nextId } from './counter';
import { ENTITY_NAMES, childAchievementKey, childAchievementPrefix, childPK } from './keys';

/** Strip PK/SK/GSI keys from a DynamoDB item */
function stripKeys<T extends Record<string, unknown>>(
	item: T,
): Omit<T, 'PK' | 'SK' | 'GSI2PK' | 'GSI2SK'> {
	const { PK, SK, GSI2PK, GSI2SK, ...rest } = item;
	return rest;
}

/** 全実績マスタを取得 */
export async function findAllAchievements(): Promise<Achievement[]> {
	const result = await getDocClient().send(
		new ScanCommand({
			TableName: TABLE_NAME,
			FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
			ExpressionAttributeValues: {
				':prefix': 'ACHIEVEMENT#',
				':sk': 'MASTER',
			},
		}),
	);

	return (result.Items ?? []).map((item) => stripKeys(item) as unknown as Achievement);
}

/** コードで実績を1件取得 */
export async function findAchievementByCode(code: string): Promise<Achievement | undefined> {
	const result = await getDocClient().send(
		new ScanCommand({
			TableName: TABLE_NAME,
			FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk AND #code = :code',
			ExpressionAttributeNames: { '#code': 'code' },
			ExpressionAttributeValues: {
				':prefix': 'ACHIEVEMENT#',
				':sk': 'MASTER',
				':code': code,
			},
		}),
	);

	const items = result.Items ?? [];
	if (items.length === 0) return undefined;
	return stripKeys(items[0] as Record<string, unknown>) as unknown as Achievement;
}

/** 子供の解除済み実績（全レコード、マイルストーン含む）を取得 */
export async function findUnlockedAchievements(
	childId: number,
): Promise<{ achievementId: number; milestoneValue: number | null; unlockedAt: string }[]> {
	const pk = childPK(childId);
	const prefix = childAchievementPrefix();

	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': pk,
				':prefix': prefix,
			},
			ProjectionExpression: 'achievementId, milestoneValue, unlockedAt',
		}),
	);

	return (result.Items ?? []).map((item) => ({
		achievementId: item.achievementId as number,
		milestoneValue: (item.milestoneValue as number | null) ?? null,
		unlockedAt: item.unlockedAt as string,
	}));
}

/** 子供の解除済み実績IDセットを取得（非繰り返し実績用） */
export async function findUnlockedAchievementIds(childId: number): Promise<Set<number>> {
	const pk = childPK(childId);
	const prefix = childAchievementPrefix();

	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': pk,
				':prefix': prefix,
			},
			ProjectionExpression: 'achievementId',
		}),
	);

	const ids = (result.Items ?? []).map((item) => item.achievementId as number);
	return new Set(ids);
}

/** 特定の実績+マイルストーン値が解除済みか確認 */
export async function isAchievementUnlocked(
	childId: number,
	achievementId: number,
	milestoneValue: number | null,
): Promise<boolean> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: childAchievementKey(childId, achievementId, milestoneValue),
		}),
	);

	return !!result.Item;
}

/** 実績解除を記録（マイルストーン値付き） */
export async function insertChildAchievement(
	childId: number,
	achievementId: number,
	milestoneValue?: number | null,
): Promise<ChildAchievement> {
	const id = await nextId(ENTITY_NAMES.childAchievement);
	const now = new Date().toISOString();

	const achievement: ChildAchievement = {
		id,
		childId,
		achievementId,
		milestoneValue: milestoneValue ?? null,
		unlockedAt: now,
	};

	const key = childAchievementKey(childId, achievementId, milestoneValue);

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...key,
				...achievement,
			},
		}),
	);

	return achievement;
}
