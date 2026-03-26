// src/lib/server/db/dynamodb/daily-mission-repo.ts
// DynamoDB implementation of IDailyMissionRepo

import {
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Activity, Child, DailyMissionWithActivity } from '../types';
import { TABLE_NAME, getDocClient } from './client';
import { nextId } from './counter';
import {
	ENTITY_NAMES,
	activityKey,
	activityLogPrefix,
	childKey,
	childPK,
	dailyMissionDatePrefix,
	dailyMissionKey,
	dailyMissionPrefix,
	pointLedgerPrefix,
	tenantPK,
} from './keys';

function stripKeys<T extends Record<string, unknown>>(
	item: T,
): Omit<T, 'PK' | 'SK' | 'GSI2PK' | 'GSI2SK'> {
	const { PK, SK, GSI2PK, GSI2SK, ...rest } = item;
	return rest;
}

/** 今日のミッション一覧（活動情報付き） */
export async function findTodayMissions(
	childId: number,
	date: string,
	tenantId: string,
): Promise<DailyMissionWithActivity[]> {
	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': childPK(childId, tenantId),
				':prefix': dailyMissionDatePrefix(date),
			},
		}),
	);

	const missions = result.Items ?? [];
	const enriched: DailyMissionWithActivity[] = [];

	for (const mission of missions) {
		// Get activity details
		const actResult = await getDocClient().send(
			new GetCommand({
				TableName: TABLE_NAME,
				Key: activityKey(mission.activityId as number, tenantId),
			}),
		);
		const activity = actResult.Item;

		enriched.push({
			id: mission.id as number,
			activityId: mission.activityId as number,
			completed: mission.completed as number,
			activityName: (activity?.name as string) ?? '',
			activityIcon: (activity?.icon as string) ?? '',
			categoryId: (activity?.categoryId as number) ?? 0,
		});
	}

	return enriched;
}

/** ミッションボーナスの記録を検索 */
export async function findMissionBonusRecord(
	childId: number,
	description: string,
	tenantId: string,
): Promise<{ amount: number } | undefined> {
	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			FilterExpression: 'description = :desc',
			ExpressionAttributeValues: {
				':pk': childPK(childId, tenantId),
				':prefix': pointLedgerPrefix(),
				':desc': description,
			},
			Limit: 1,
		}),
	);

	if (!result.Items || result.Items.length === 0) return undefined;
	return { amount: result.Items[0]?.amount as number };
}

/** 特定活動のミッションを検索 */
export async function findMissionByActivity(
	childId: number,
	date: string,
	activityId: number,
	tenantId: string,
): Promise<{ id: number; completed: number } | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: dailyMissionKey(childId, date, activityId, tenantId),
		}),
	);

	if (!result.Item) return undefined;
	return {
		id: result.Item.id as number,
		completed: result.Item.completed as number,
	};
}

/** ミッションを完了に更新 */
export async function markMissionCompleted(missionId: number, _tenantId: string): Promise<void> {
	// Scan to find the mission by id
	let lastKey: Record<string, unknown> | undefined;

	do {
		const result = await getDocClient().send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression: 'begins_with(SK, :prefix) AND id = :id',
				ExpressionAttributeValues: {
					':prefix': dailyMissionPrefix(),
					':id': missionId,
				},
				ExclusiveStartKey: lastKey,
			}),
		);

		if (result.Items && result.Items.length > 0) {
			const item = result.Items[0]!;
			await getDocClient().send(
				new UpdateCommand({
					TableName: TABLE_NAME,
					Key: { PK: item.PK, SK: item.SK },
					UpdateExpression: 'SET completed = :completed, completedAt = :completedAt',
					ExpressionAttributeValues: {
						':completed': 1,
						':completedAt': new Date().toISOString(),
					},
				}),
			);
			return;
		}
		lastKey = result.LastEvaluatedKey;
	} while (lastKey);
}

/** 全ミッションのステータス一覧 */
export async function findAllMissionStatuses(
	childId: number,
	date: string,
	tenantId: string,
): Promise<{ completed: number }[]> {
	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': childPK(childId, tenantId),
				':prefix': dailyMissionDatePrefix(date),
			},
			ProjectionExpression: 'completed',
		}),
	);

	return (result.Items ?? []).map((item) => ({
		completed: item.completed as number,
	}));
}

/** ミッション用の子供情報取得 */
export async function findChildForMission(
	childId: number,
	tenantId: string,
): Promise<Child | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: childKey(childId, tenantId),
		}),
	);

	if (!result.Item) return undefined;
	return stripKeys(result.Item) as unknown as Child;
}

/** 表示可能な全活動を取得 */
export async function findVisibleActivities(tenantId: string): Promise<Activity[]> {
	const items: Record<string, unknown>[] = [];
	let lastKey: Record<string, unknown> | undefined;

	do {
		const result = await getDocClient().send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk AND isVisible = :visible',
				ExpressionAttributeValues: {
					':prefix': tenantPK('ACTIVITY#', tenantId),
					':sk': 'MASTER',
					':visible': 1,
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		items.push(...(result.Items ?? []));
		lastKey = result.LastEvaluatedKey;
	} while (lastKey);

	return items.map((item) => stripKeys(item) as unknown as Activity);
}

/** 前日のミッション活動IDリストを取得 */
export async function findPreviousDayMissionIds(
	childId: number,
	date: string,
	tenantId: string,
): Promise<number[]> {
	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': childPK(childId, tenantId),
				':prefix': dailyMissionDatePrefix(date),
			},
			ProjectionExpression: 'activityId',
		}),
	);

	return (result.Items ?? []).map((item) => item.activityId as number);
}

/** 最近の活動ログの活動IDリストを取得 */
export async function findRecentActivityIds(
	childId: number,
	sinceDate: string,
	tenantId: string,
): Promise<number[]> {
	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND SK >= :since',
			ExpressionAttributeValues: {
				':pk': childPK(childId, tenantId),
				':since': `LOG#${sinceDate}`,
			},
		}),
	);

	const items = (result.Items ?? []).filter(
		(item) => typeof item.SK === 'string' && (item.SK as string).startsWith('LOG#'),
	);

	const ids = new Set<number>();
	for (const item of items) {
		if (item.activityId != null) {
			ids.add(item.activityId as number);
		}
	}

	return [...ids];
}

/** 全活動ログの活動IDリストを取得 */
export async function findAllRecordedActivityIds(
	childId: number,
	tenantId: string,
): Promise<number[]> {
	const items: Record<string, unknown>[] = [];
	let lastKey: Record<string, unknown> | undefined;

	do {
		const result = await getDocClient().send(
			new QueryCommand({
				TableName: TABLE_NAME,
				KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
				ExpressionAttributeValues: {
					':pk': childPK(childId, tenantId),
					':prefix': activityLogPrefix(),
				},
				ProjectionExpression: 'activityId',
				ExclusiveStartKey: lastKey,
			}),
		);
		items.push(...(result.Items ?? []));
		lastKey = result.LastEvaluatedKey;
	} while (lastKey);

	const ids = new Set<number>();
	for (const item of items) {
		if (item.activityId != null) {
			ids.add(item.activityId as number);
		}
	}

	return [...ids];
}

/** デイリーミッションを挿入 */
export async function insertDailyMission(
	childId: number,
	date: string,
	activityId: number,
	tenantId: string,
): Promise<void> {
	const id = await nextId(ENTITY_NAMES.dailyMission, tenantId);

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...dailyMissionKey(childId, date, activityId, tenantId),
				id,
				childId,
				missionDate: date,
				activityId,
				completed: 0,
				completedAt: null,
			},
		}),
	);
}
