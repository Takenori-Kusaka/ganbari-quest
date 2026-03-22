// src/lib/server/db/dynamodb/evaluation-repo.ts
// DynamoDB implementation of IEvaluationRepo

import { GetCommand, PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type {
	CategoryActivityCount,
	CategoryLastDate,
	Child,
	Evaluation,
	InsertEvaluationInput,
} from '../types';
import { TABLE_NAME, getDocClient } from './client';
import { nextId } from './counter';
import {
	ENTITY_NAMES,
	activityLogPrefix,
	childPK,
	evaluationKey,
	evaluationPrefix,
	statusHistoryPrefix,
} from './keys';

/** Strip PK/SK/GSI keys from a DynamoDB item */
function stripKeys<T extends Record<string, unknown>>(
	item: T,
): Omit<T, 'PK' | 'SK' | 'GSI2PK' | 'GSI2SK'> {
	const { PK, SK, GSI2PK, GSI2SK, ...rest } = item;
	return rest;
}

/** 指定期間のカテゴリ別活動回数を集計 */
export async function countActivitiesByCategory(
	childId: number,
	weekStart: string,
	weekEnd: string,
): Promise<CategoryActivityCount[]> {
	const pk = childPK(childId);
	const prefix = activityLogPrefix();

	// Query all activity logs for this child, filter by date range
	const items: Record<string, unknown>[] = [];
	let lastKey: Record<string, unknown> | undefined;

	do {
		const result = await getDocClient().send(
			new QueryCommand({
				TableName: TABLE_NAME,
				KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
				FilterExpression:
					'#cancelled = :zero AND #recordedDate >= :weekStart AND #recordedDate <= :weekEnd',
				ExpressionAttributeNames: {
					'#cancelled': 'cancelled',
					'#recordedDate': 'recordedDate',
				},
				ExpressionAttributeValues: {
					':pk': pk,
					':prefix': prefix,
					':zero': 0,
					':weekStart': weekStart,
					':weekEnd': weekEnd,
				},
				ProjectionExpression: 'activityId, categoryId, points',
				ExclusiveStartKey: lastKey,
			}),
		);

		for (const item of result.Items ?? []) {
			items.push(item);
		}
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);

	// Group by categoryId and count + sum points
	const catMap = new Map<number, { count: number; totalPoints: number }>();
	for (const item of items) {
		const catId = item.categoryId as number;
		const points = (item.points as number) ?? 0;
		const existing = catMap.get(catId) ?? { count: 0, totalPoints: 0 };
		existing.count += 1;
		existing.totalPoints += points;
		catMap.set(catId, existing);
	}

	return Array.from(catMap.entries()).map(([categoryId, data]) => ({
		categoryId,
		count: data.count,
		totalPoints: data.totalPoints,
	}));
}

/** 評価結果を保存 */
export async function insertEvaluation(input: InsertEvaluationInput): Promise<Evaluation> {
	const id = await nextId(ENTITY_NAMES.evaluation);
	const now = new Date().toISOString();

	const evaluation: Evaluation = {
		id,
		childId: input.childId,
		weekStart: input.weekStart,
		weekEnd: input.weekEnd,
		scoresJson: input.scoresJson,
		bonusPoints: input.bonusPoints,
		createdAt: now,
	};

	const key = evaluationKey(input.childId, input.weekStart);

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...key,
				...evaluation,
			},
		}),
	);

	return evaluation;
}

/** 全子供を取得 */
export async function findAllChildren(): Promise<Child[]> {
	const result = await getDocClient().send(
		new ScanCommand({
			TableName: TABLE_NAME,
			FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
			ExpressionAttributeValues: {
				':prefix': 'CHILD#',
				':sk': 'PROFILE',
			},
		}),
	);

	return (result.Items ?? []).map((item) => stripKeys(item) as unknown as Child);
}

/** 子供の評価履歴を取得 */
export async function findEvaluationsByChild(
	childId: number,
	limit: number,
): Promise<Evaluation[]> {
	const pk = childPK(childId);
	const prefix = evaluationPrefix();

	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': pk,
				':prefix': prefix,
			},
			ScanIndexForward: false,
			Limit: limit,
		}),
	);

	return (result.Items ?? []).map((item) => stripKeys(item) as unknown as Evaluation);
}

/** 指定日にdaily_decayが既に実行されたか確認 */
export async function hasDecayRunToday(childId: number, today: string): Promise<boolean> {
	const pk = childPK(childId);
	const prefix = statusHistoryPrefix();

	// Query all status history items and filter for daily_decay on today
	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			FilterExpression: '#changeType = :decay AND begins_with(#recordedAt, :today)',
			ExpressionAttributeNames: {
				'#changeType': 'changeType',
				'#recordedAt': 'recordedAt',
			},
			ExpressionAttributeValues: {
				':pk': pk,
				':prefix': prefix,
				':decay': 'daily_decay',
				':today': today,
			},
			Limit: 1,
		}),
	);

	return (result.Items ?? []).length > 0;
}

/** 指定週の評価が存在するか確認 */
export async function findWeekEvaluation(
	childId: number,
	weekStart: string,
): Promise<{ id: number } | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: evaluationKey(childId, weekStart),
			ProjectionExpression: 'id',
		}),
	);

	if (!result.Item) return undefined;
	return { id: result.Item.id as number };
}

/** 子供の最終活動日をカテゴリ別に取得 */
export async function findLastActivityDateByCategory(childId: number): Promise<CategoryLastDate[]> {
	const pk = childPK(childId);
	const prefix = activityLogPrefix();

	// Query all activity logs for this child
	const items: Record<string, unknown>[] = [];
	let lastKey: Record<string, unknown> | undefined;

	do {
		const result = await getDocClient().send(
			new QueryCommand({
				TableName: TABLE_NAME,
				KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
				FilterExpression: '#cancelled = :zero',
				ExpressionAttributeNames: { '#cancelled': 'cancelled' },
				ExpressionAttributeValues: {
					':pk': pk,
					':prefix': prefix,
					':zero': 0,
				},
				ProjectionExpression: 'categoryId, recordedDate',
				ExclusiveStartKey: lastKey,
			}),
		);

		for (const item of result.Items ?? []) {
			items.push(item);
		}
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);

	// Group by categoryId and find max date
	const catMaxDate = new Map<number, string>();
	for (const item of items) {
		const catId = item.categoryId as number;
		const date = item.recordedDate as string;
		const current = catMaxDate.get(catId);
		if (!current || date > current) {
			catMaxDate.set(catId, date);
		}
	}

	return Array.from(catMaxDate.entries()).map(([categoryId, lastDate]) => ({
		categoryId,
		lastDate,
	}));
}
