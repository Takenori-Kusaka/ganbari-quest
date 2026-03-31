// src/lib/server/db/dynamodb/status-repo.ts
// DynamoDB implementation of IStatusRepo

import {
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
	Child,
	InsertStatusHistoryInput,
	MarketBenchmark,
	Status,
	StatusHistoryEntry,
} from '../types';
import { TABLE_NAME, getDocClient } from './client';
import { nextId } from './counter';
import {
	ENTITY_NAMES,
	activityLogPrefix,
	childKey,
	childPK,
	marketBenchmarkKey,
	marketBenchmarkPrefix,
	statusHistoryByCategoryPrefix,
	statusHistoryKey,
	statusKey,
	statusPrefix,
} from './keys';

/** Strip PK/SK/GSI keys from a DynamoDB item */
function stripKeys<T extends Record<string, unknown>>(
	item: T,
): Omit<T, 'PK' | 'SK' | 'GSI2PK' | 'GSI2SK'> {
	const { PK, SK, GSI2PK, GSI2SK, ...rest } = item;
	return rest;
}

/** 子供の全ステータスを取得 */
export async function findStatuses(childId: number, tenantId: string): Promise<Status[]> {
	const pk = childPK(childId, tenantId);
	const prefix = statusPrefix();

	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': pk,
				':prefix': prefix,
			},
		}),
	);

	return (result.Items ?? []).map((item) => stripKeys(item) as unknown as Status);
}

/** カテゴリ別のステータスを取得 */
export async function findStatus(
	childId: number,
	categoryId: number,
	tenantId: string,
): Promise<Status | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: statusKey(childId, categoryId, tenantId),
		}),
	);

	if (!result.Item) return undefined;
	return stripKeys(result.Item) as unknown as Status;
}

/** ステータスを更新（upsert） */
export async function upsertStatus(
	childId: number,
	categoryId: number,
	totalXp: number,
	level: number,
	peakXp: number,
	tenantId: string,
): Promise<Status> {
	const clampedXp = Math.max(0, totalXp);
	const now = new Date().toISOString();
	const existing = await findStatus(childId, categoryId, tenantId);

	if (existing) {
		const result = await getDocClient().send(
			new UpdateCommand({
				TableName: TABLE_NAME,
				Key: statusKey(childId, categoryId, tenantId),
				UpdateExpression:
					'SET #totalXp = :totalXp, #level = :level, #peakXp = :peakXp, #updatedAt = :updatedAt',
				ExpressionAttributeNames: {
					'#totalXp': 'totalXp',
					'#level': 'level',
					'#peakXp': 'peakXp',
					'#updatedAt': 'updatedAt',
				},
				ExpressionAttributeValues: {
					':totalXp': clampedXp,
					':level': level,
					':peakXp': peakXp,
					':updatedAt': now,
				},
				ReturnValues: 'ALL_NEW',
			}),
		);

		return stripKeys(result.Attributes as Record<string, unknown>) as unknown as Status;
	}

	const id = await nextId(ENTITY_NAMES.status, tenantId);
	const status: Status = {
		id,
		childId,
		categoryId,
		totalXp: clampedXp,
		level,
		peakXp,
		updatedAt: now,
	};

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...statusKey(childId, categoryId, tenantId),
				...status,
			},
		}),
	);

	return status;
}

/** ステータス変動履歴を追加 */
export async function insertStatusHistory(
	input: InsertStatusHistoryInput,
	tenantId: string,
): Promise<StatusHistoryEntry> {
	const id = await nextId(ENTITY_NAMES.statusHistory, tenantId);
	const now = new Date().toISOString();

	const entry: StatusHistoryEntry = {
		id,
		childId: input.childId,
		categoryId: input.categoryId,
		value: input.value,
		changeAmount: input.changeAmount,
		changeType: input.changeType,
		recordedAt: now,
	};

	const key = statusHistoryKey(input.childId, input.categoryId, now, id, tenantId);

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...key,
				...entry,
			},
		}),
	);

	return entry;
}

/** 直近のステータス変動を取得 */
export async function findRecentStatusHistory(
	childId: number,
	categoryId: number,
	tenantId: string,
	limit = 7,
): Promise<StatusHistoryEntry[]> {
	const pk = childPK(childId, tenantId);
	const prefix = statusHistoryByCategoryPrefix(categoryId);

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

	return (result.Items ?? []).map((item) => stripKeys(item) as unknown as StatusHistoryEntry);
}

/** 指定日時点のステータス値を取得（その日以前の最新のhistory entry） */
export async function findStatusValueAtDate(
	childId: number,
	categoryId: number,
	beforeDate: string,
	tenantId: string,
): Promise<number | null> {
	const pk = childPK(childId, tenantId);
	const prefix = statusHistoryByCategoryPrefix(categoryId);

	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': pk,
				':prefix': prefix,
			},
			ScanIndexForward: false,
		}),
	);

	for (const item of result.Items ?? []) {
		const entry = stripKeys(item) as unknown as StatusHistoryEntry;
		if (entry.recordedAt && entry.recordedAt < beforeDate) {
			return entry.value;
		}
	}
	return null;
}

/** 市場ベンチマークを取得 (global) */
export async function findBenchmark(
	age: number,
	categoryId: number,
	_tenantId: string,
): Promise<MarketBenchmark | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: marketBenchmarkKey(age, categoryId),
		}),
	);

	if (!result.Item) return undefined;
	return stripKeys(result.Item) as unknown as MarketBenchmark;
}

/** 全ベンチマークを取得 (global) */
export async function findAllBenchmarks(_tenantId: string): Promise<MarketBenchmark[]> {
	const result = await getDocClient().send(
		new ScanCommand({
			TableName: TABLE_NAME,
			FilterExpression: 'begins_with(PK, :prefix) AND begins_with(SK, :skPrefix)',
			ExpressionAttributeValues: {
				':prefix': 'BENCH#',
				':skPrefix': marketBenchmarkPrefix(),
			},
		}),
	);

	return (result.Items ?? []).map((item) => stripKeys(item) as unknown as MarketBenchmark);
}

/** ベンチマークをupsert (global) */
export async function upsertBenchmark(
	age: number,
	categoryId: number,
	mean: number,
	stdDev: number,
	source: string,
	_tenantId: string,
): Promise<MarketBenchmark> {
	const now = new Date().toISOString();
	const existing = await findBenchmark(age, categoryId, _tenantId);

	if (existing) {
		const result = await getDocClient().send(
			new UpdateCommand({
				TableName: TABLE_NAME,
				Key: marketBenchmarkKey(age, categoryId),
				UpdateExpression:
					'SET #mean = :mean, #stdDev = :stdDev, #source = :source, #updatedAt = :updatedAt',
				ExpressionAttributeNames: {
					'#mean': 'mean',
					'#stdDev': 'stdDev',
					'#source': 'source',
					'#updatedAt': 'updatedAt',
				},
				ExpressionAttributeValues: {
					':mean': mean,
					':stdDev': stdDev,
					':source': source,
					':updatedAt': now,
				},
				ReturnValues: 'ALL_NEW',
			}),
		);

		return stripKeys(result.Attributes as Record<string, unknown>) as unknown as MarketBenchmark;
	}

	const id = await nextId(ENTITY_NAMES.marketBenchmark, _tenantId);
	const benchmark: MarketBenchmark = {
		id,
		age,
		categoryId,
		mean,
		stdDev,
		source,
		updatedAt: now,
	};

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...marketBenchmarkKey(age, categoryId),
				...benchmark,
			},
		}),
	);

	return benchmark;
}

/** 子供の存在確認（年齢も取得） */
export async function findChildById(id: number, tenantId: string): Promise<Child | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: childKey(id, tenantId),
		}),
	);

	if (!result.Item) return undefined;
	return stripKeys(result.Item) as unknown as Child;
}

/** カテゴリ別の最終活動日を取得 */
export async function findLastActivityDates(
	childId: number,
	tenantId: string,
): Promise<{ category: number; lastDate: string | null }[]> {
	const pk = childPK(childId, tenantId);
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
				ProjectionExpression: 'activityId, recordedDate',
				ExclusiveStartKey: lastKey,
			}),
		);

		for (const item of result.Items ?? []) {
			items.push(item);
		}
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);

	// Group by activityId and find max date
	const activityMaxDate = new Map<number, string>();
	for (const item of items) {
		const activityId = item.activityId as number;
		const date = item.recordedDate as string;
		const current = activityMaxDate.get(activityId);
		if (!current || date > current) {
			activityMaxDate.set(activityId, date);
		}
	}

	return Array.from(activityMaxDate.entries()).map(([category, lastDate]) => ({
		category,
		lastDate,
	}));
}
