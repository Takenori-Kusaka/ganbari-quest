// src/lib/server/db/dynamodb/status-repo.ts
// DynamoDB implementation of IStatusRepo

import {
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { hydrate, withVersion } from '../migration';
import { writeBackDynamoDB } from '../migration/writeback';
import type {
	Child,
	InsertStatusHistoryInput,
	MarketBenchmark,
	Status,
	StatusHistoryEntry,
} from '../types';
import { deleteItemsByPkPrefix } from './bulk-delete';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import {
	activityLogPrefix,
	childKey,
	childPK,
	ENTITY_NAMES,
	marketBenchmarkKey,
	marketBenchmarkPrefix,
	statusHistoryByCategoryPrefix,
	statusHistoryKey,
	statusHistoryPrefix,
	statusKey,
	statusPrefix,
	tenantPK,
} from './keys';
import { queryAllItems, stripKeys } from './repo-helpers';

/** DynamoDB アイテムをマイグレーション（必要なら Write-Back） */
async function hydrateStatus(
	item: Record<string, unknown>,
	childId: number,
	categoryId: number,
	tenantId: string,
): Promise<Record<string, unknown>> {
	const { data, didMigrate } = hydrate('status', item);
	if (didMigrate) {
		await writeBackDynamoDB('status', statusKey(childId, categoryId, tenantId), item, data);
	}
	return data;
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

	const items = result.Items ?? [];
	const hydrated = await Promise.all(
		items.map((item) => hydrateStatus(item, childId, item.categoryId as number, tenantId)),
	);
	return hydrated.map((item) => stripKeys(item) as unknown as Status);
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
	const data = await hydrateStatus(result.Item, childId, categoryId, tenantId);
	return stripKeys(data) as unknown as Status;
}

/** ステータスを更新（upsert） */
// biome-ignore lint/complexity/useMaxParams: 既存コード、別Issueで対応予定
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

	const versioned = withVersion('status', {
		...statusKey(childId, categoryId, tenantId),
		...status,
	});
	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: versioned,
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
// biome-ignore lint/complexity/useMaxParams: 既存コード、別Issueで対応予定
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
	const { data, didMigrate } = hydrate('child', result.Item);
	if (didMigrate) {
		await writeBackDynamoDB('child', childKey(id, tenantId), result.Item, data);
	}
	return stripKeys(data) as unknown as Child;
}

/** カテゴリ別の最終活動日を取得 */
export async function findLastActivityDates(
	childId: number,
	tenantId: string,
): Promise<{ category: number; lastDate: string | null }[]> {
	const pk = childPK(childId, tenantId);
	const prefix = activityLogPrefix();

	const items = await queryAllItems(pk, prefix, {
		filterExpression: '#cancelled = :zero',
		expressionAttributeNames: { '#cancelled': 'cancelled' },
		expressionAttributeValues: { ':zero': 0 },
		projectionExpression: 'activityId, recordedDate',
	});

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

/**
 * テナントの全ステータスデータを削除（CHILD#* 配下の STATUS# + STATHIST# アイテム）。
 * market_benchmarks はグローバルなマスターデータのため削除しない。
 */
export async function deleteByTenantId(tenantId: string): Promise<void> {
	// Delete status records (STATUS#...)
	await deleteItemsByPkPrefix(tenantPK('CHILD#', tenantId), statusPrefix());
	// Delete status history records (STATHIST#...)
	await deleteItemsByPkPrefix(tenantPK('CHILD#', tenantId), statusHistoryPrefix());
}
