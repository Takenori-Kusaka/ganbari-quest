// src/lib/server/db/dynamodb/evaluation-repo.ts
// DynamoDB implementation of IEvaluationRepo

import { GetCommand, PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type {
	CategoryActivityCount,
	CategoryLastDate,
	Child,
	Evaluation,
	InsertEvaluationInput,
	RestDay,
} from '../types';
import { deleteItemsByPkPrefix } from './bulk-delete';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import {
	activityLogPrefix,
	childPK,
	ENTITY_NAMES,
	evaluationKey,
	evaluationPrefix,
	statusHistoryPrefix,
	tenantPK,
} from './keys';
import { queryAllItems, stripKeys } from './repo-helpers';

/** 指定期間のカテゴリ別活動回数を集計 */
export async function countActivitiesByCategory(
	childId: number,
	weekStart: string,
	weekEnd: string,
	tenantId: string,
): Promise<CategoryActivityCount[]> {
	const pk = childPK(childId, tenantId);
	const prefix = activityLogPrefix();

	const items = await queryAllItems(pk, prefix, {
		filterExpression:
			'#cancelled = :zero AND #recordedDate >= :weekStart AND #recordedDate <= :weekEnd',
		expressionAttributeNames: {
			'#cancelled': 'cancelled',
			'#recordedDate': 'recordedDate',
		},
		expressionAttributeValues: {
			':zero': 0,
			':weekStart': weekStart,
			':weekEnd': weekEnd,
		},
		projectionExpression: 'activityId, categoryId, points',
	});

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
export async function insertEvaluation(
	input: InsertEvaluationInput,
	tenantId: string,
): Promise<Evaluation> {
	const id = await nextId(ENTITY_NAMES.evaluation, tenantId);
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

	const key = evaluationKey(input.childId, input.weekStart, tenantId);

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
export async function findAllChildren(tenantId: string): Promise<Child[]> {
	const result = await getDocClient().send(
		new ScanCommand({
			TableName: TABLE_NAME,
			FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
			ExpressionAttributeValues: {
				':prefix': tenantPK('CHILD#', tenantId),
				':sk': 'PROFILE',
			},
		}),
	);

	return (result.Items ?? []).map(
		(item) => stripKeys(item as Record<string, unknown>) as unknown as Child,
	);
}

/** 子供の評価履歴を取得 */
export async function findEvaluationsByChild(
	childId: number,
	limit: number,
	tenantId: string,
): Promise<Evaluation[]> {
	const pk = childPK(childId, tenantId);
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
export async function hasDecayRunToday(
	childId: number,
	today: string,
	tenantId: string,
): Promise<boolean> {
	const pk = childPK(childId, tenantId);
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
	tenantId: string,
): Promise<{ id: number } | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: evaluationKey(childId, weekStart, tenantId),
			ProjectionExpression: 'id',
		}),
	);

	if (!result.Item) return undefined;
	return { id: result.Item.id as number };
}

/** 子供の最終活動日をカテゴリ別に取得 */
export async function findLastActivityDateByCategory(
	childId: number,
	tenantId: string,
): Promise<CategoryLastDate[]> {
	const pk = childPK(childId, tenantId);
	const prefix = activityLogPrefix();

	const items = await queryAllItems(pk, prefix, {
		filterExpression: '#cancelled = :zero',
		expressionAttributeNames: { '#cancelled': 'cancelled' },
		expressionAttributeValues: { ':zero': 0 },
		projectionExpression: 'categoryId, recordedDate',
	});

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

// ============================================================
// おやすみ日 (rest_days) — DynamoDB stub
// TODO: DynamoDB 本番対応時に実装
// ============================================================

export async function insertRestDay(
	_childId: number,
	_date: string,
	_reason: string,
	_tenantId: string,
): Promise<RestDay | undefined> {
	return undefined;
}

export async function deleteRestDay(
	_childId: number,
	_date: string,
	_tenantId: string,
): Promise<void> {}

export async function isRestDay(
	_childId: number,
	_date: string,
	_tenantId: string,
): Promise<boolean> {
	return false;
}

export async function countRestDaysInMonth(
	_childId: number,
	_yearMonth: string,
	_tenantId: string,
): Promise<number> {
	return 0;
}

export async function findRestDays(
	_childId: number,
	_yearMonth: string,
	_tenantId: string,
): Promise<RestDay[]> {
	return [];
}

/** テナントの全評価データを削除（CHILD#* 配下の EVAL# アイテム） */
export async function deleteByTenantId(tenantId: string): Promise<void> {
	await deleteItemsByPkPrefix(tenantPK('CHILD#', tenantId), evaluationPrefix());
}
