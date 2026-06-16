// src/lib/server/db/dynamodb/daily-mission-repo.ts
// DynamoDB implementation of IDailyMissionRepo

import {
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Activity, DailyMissionWithActivity } from '../types';
import { deleteItemsByPkPrefix } from './bulk-delete';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import {
	activityKey,
	activityLogPrefix,
	childPK,
	dailyMissionDatePrefix,
	dailyMissionKey,
	dailyMissionPrefix,
	ENTITY_NAMES,
	pointLedgerPrefix,
	tenantPK,
} from './keys';
import { stripKeys } from './repo-helpers';

// biome-ignore lint/performance/noBarrelFile: 後方互換 re-export のため維持、削除は別 Issue で検討
export { findChildByIdRaw as findChildForMission } from './repo-helpers';

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

/**
 * ミッションボーナスの記録を検索。
 *
 * #2845 B2: 旧実装は `Limit: 1` + FilterExpression の併用で「filter 前評価 1 件が
 * 別 description だと false NOT_FOUND」になる #2842 class だった (重複ボーナス付与の温床)。
 * Limit を撤去し全ページ走査 + 一致で早期 return に置換。
 */
export async function findMissionBonusRecord(
	childId: number,
	description: string,
	tenantId: string,
): Promise<{ amount: number } | undefined> {
	let lastKey: Record<string, unknown> | undefined;
	do {
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
				ExclusiveStartKey: lastKey,
			}),
		);
		const item = (result.Items ?? [])[0];
		if (item) return { amount: item.amount as number };
		lastKey = result.LastEvaluatedKey;
	} while (lastKey);
	return undefined;
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

/**
 * ミッションを完了に更新。
 *
 * #2845 B1: 旧実装は tenant prefix を含まない全テーブル Scan (`begins_with(SK,'MISSION#') + id`)
 * で全 tenant の mission を write できる形状だった。SK = MISSION#<date>#<activityId> は
 * 呼び出し元 (daily-mission-service.checkMissionCompletion) が全要素を持つため、
 * signature を (childId, date, activityId) に変更し exact Key (`dailyMissionKey`) で
 * 直接 UpdateItem する (Scan 撤去)。`attribute_exists(PK)` で phantom item 生成を防ぎ、
 * 不在 (tenant/child 不一致を含む) は旧挙動どおり silent no-op に正規化 (§08-DB 原則 1)。
 */
export async function markMissionCompleted(
	childId: number,
	date: string,
	activityId: number,
	tenantId: string,
): Promise<void> {
	try {
		await getDocClient().send(
			new UpdateCommand({
				TableName: TABLE_NAME,
				Key: dailyMissionKey(childId, date, activityId, tenantId),
				UpdateExpression: 'SET completed = :completed, completedAt = :completedAt',
				ConditionExpression: 'attribute_exists(PK)',
				ExpressionAttributeValues: {
					':completed': 1,
					':completedAt': new Date().toISOString(),
				},
			}),
		);
	} catch (error) {
		if ((error as { name?: string }).name === 'ConditionalCheckFailedException') return;
		throw error;
	}
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

/** テナントの全デイリーミッションを削除（CHILD#* 配下の MISSION# アイテム） */
export async function deleteByTenantId(tenantId: string): Promise<void> {
	await deleteItemsByPkPrefix(tenantPK('CHILD#', tenantId), dailyMissionPrefix());
}
