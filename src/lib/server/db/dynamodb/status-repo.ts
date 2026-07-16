// src/lib/server/db/dynamodb/status-repo.ts
// DynamoDB implementation of IStatusRepo

import {
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { CategoryId, ChildId } from '$lib/domain/ids';
import { asCategoryId, asChildId } from '$lib/domain/ids';
import { hydrate, withVersion } from '../migration';
import { writeBackDynamoDB } from '../migration/writeback';
import type {
	Child,
	InsertStatusHistoryInput,
	MarketBenchmark,
	Status,
	StatusHistoryEntry,
} from '../types';
import { deleteChildScopedItems } from './bulk-delete';
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
} from './keys';
import { queryAllItems, stripKeys } from './repo-helpers';

// stored item は数値 id のまま (storage format 不変、#3575)。repo 境界で branded string に変換する。
function toStatus(item: Record<string, unknown>): Status {
	const raw = stripKeys(item) as unknown as Omit<Status, 'id' | 'childId' | 'categoryId'> & {
		id: number;
		childId: number;
		categoryId: number;
	};
	return {
		...raw,
		id: String(raw.id),
		childId: asChildId(raw.childId),
		categoryId: asCategoryId(raw.categoryId),
	};
}

function toStatusHistoryEntry(item: Record<string, unknown>): StatusHistoryEntry {
	const raw = stripKeys(item) as unknown as Omit<
		StatusHistoryEntry,
		'id' | 'childId' | 'categoryId'
	> & { id: number; childId: number; categoryId: number };
	return {
		...raw,
		id: String(raw.id),
		childId: asChildId(raw.childId),
		categoryId: asCategoryId(raw.categoryId),
	};
}

function toMarketBenchmark(item: Record<string, unknown>): MarketBenchmark {
	const raw = stripKeys(item) as unknown as Omit<MarketBenchmark, 'id' | 'categoryId'> & {
		id: number;
		categoryId: number;
	};
	return { ...raw, id: String(raw.id), categoryId: asCategoryId(raw.categoryId) };
}

/** DynamoDB アイテムをマイグレーション（必要なら Write-Back） */
async function hydrateStatus(
	item: Record<string, unknown>,
	childId: ChildId,
	categoryId: number,
	tenantId: string,
): Promise<Record<string, unknown>> {
	const { data, didMigrate } = hydrate('status', item);
	if (didMigrate) {
		await writeBackDynamoDB('status', statusKey(Number(childId), categoryId, tenantId), item, data);
	}
	return data;
}

/** 子供の全ステータスを取得 */
export async function findStatuses(childId: ChildId, tenantId: string): Promise<Status[]> {
	const pk = childPK(Number(childId), tenantId);
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
	return hydrated.map((item) => toStatus(item));
}

/** カテゴリ別のステータスを取得 */
export async function findStatus(
	childId: ChildId,
	categoryId: CategoryId,
	tenantId: string,
): Promise<Status | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: statusKey(Number(childId), Number(categoryId), tenantId),
		}),
	);

	if (!result.Item) return undefined;
	const data = await hydrateStatus(result.Item, childId, Number(categoryId), tenantId);
	return toStatus(data);
}

/** ステータスを更新（upsert） */
// biome-ignore lint/complexity/useMaxParams: 型安全のため引数を個別定義、別 Issue でオブジェクト引数化予定
export async function upsertStatus(
	childId: ChildId,
	categoryId: CategoryId,
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
				Key: statusKey(Number(childId), Number(categoryId), tenantId),
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

		return toStatus(result.Attributes as Record<string, unknown>);
	}

	const id = await nextId(ENTITY_NAMES.status, tenantId);
	const status: Status = {
		id: String(id),
		childId,
		categoryId,
		totalXp: clampedXp,
		level,
		peakXp,
		updatedAt: now,
	};

	// stored attributes は数値 id のまま (storage format 不変、#3575)
	const versioned = withVersion('status', {
		...statusKey(Number(childId), Number(categoryId), tenantId),
		...status,
		id,
		childId: Number(childId),
		categoryId: Number(categoryId),
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
		id: String(id),
		childId: input.childId,
		categoryId: input.categoryId,
		value: input.value,
		changeAmount: input.changeAmount,
		changeType: input.changeType,
		recordedAt: now,
	};

	const key = statusHistoryKey(Number(input.childId), Number(input.categoryId), now, id, tenantId);

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...key,
				...entry,
				// stored attributes は数値 id のまま (storage format 不変、#3575)
				id,
				childId: Number(input.childId),
				categoryId: Number(input.categoryId),
			},
		}),
	);

	return entry;
}

/** 直近のステータス変動を取得 */
export async function findRecentStatusHistory(
	childId: ChildId,
	categoryId: CategoryId,
	tenantId: string,
	limit = 7,
): Promise<StatusHistoryEntry[]> {
	const pk = childPK(Number(childId), tenantId);
	const prefix = statusHistoryByCategoryPrefix(Number(categoryId));

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

	return (result.Items ?? []).map((item) => toStatusHistoryEntry(item));
}

/** 指定日時点のステータス値を取得（その日以前の最新のhistory entry） */
export async function findStatusValueAtDate(
	childId: ChildId,
	categoryId: CategoryId,
	beforeDate: string,
	tenantId: string,
): Promise<number | null> {
	const pk = childPK(Number(childId), tenantId);
	const prefix = statusHistoryByCategoryPrefix(Number(categoryId));

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
		const entry = toStatusHistoryEntry(item);
		if (entry.recordedAt && entry.recordedAt < beforeDate) {
			return entry.value;
		}
	}
	return null;
}

/** 市場ベンチマークを取得 (global) */
export async function findBenchmark(
	age: number,
	categoryId: CategoryId,
	_tenantId: string,
): Promise<MarketBenchmark | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: marketBenchmarkKey(age, Number(categoryId)),
		}),
	);

	if (!result.Item) return undefined;
	return toMarketBenchmark(result.Item);
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

	return (result.Items ?? []).map((item) => toMarketBenchmark(item));
}

/** ベンチマークをupsert (global) */
// biome-ignore lint/complexity/useMaxParams: 型安全のため引数を個別定義、別 Issue でオブジェクト引数化予定
export async function upsertBenchmark(
	age: number,
	categoryId: CategoryId,
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
				Key: marketBenchmarkKey(age, Number(categoryId)),
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

		return toMarketBenchmark(result.Attributes as Record<string, unknown>);
	}

	const id = await nextId(ENTITY_NAMES.marketBenchmark, _tenantId);
	const benchmark: MarketBenchmark = {
		id: String(id),
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
				...marketBenchmarkKey(age, Number(categoryId)),
				...benchmark,
				// stored attributes は数値 id のまま (storage format 不変、#3575)
				id,
				categoryId: Number(categoryId),
			},
		}),
	);

	return benchmark;
}

/** 子供の存在確認（年齢も取得） */
export async function findChildById(id: ChildId, tenantId: string): Promise<Child | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: childKey(Number(id), tenantId),
		}),
	);

	if (!result.Item) return undefined;
	const { data, didMigrate } = hydrate('child', result.Item);
	if (didMigrate) {
		await writeBackDynamoDB('child', childKey(Number(id), tenantId), result.Item, data);
	}
	const raw = stripKeys(data) as unknown as Omit<Child, 'id'> & { id: number };
	return { ...raw, id: asChildId(raw.id) };
}

/** カテゴリ別の最終活動日を取得 */
export async function findLastActivityDates(
	childId: ChildId,
	tenantId: string,
): Promise<{ category: number; lastDate: string | null }[]> {
	const pk = childPK(Number(childId), tenantId);
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
export async function deleteByTenantId(
	tenantId: string,
	childIds?: readonly ChildId[],
): Promise<void> {
	// Delete status records (STATUS#...)
	await deleteChildScopedItems(tenantId, childIds, statusPrefix());
	// Delete status history records (STATHIST#...)
	await deleteChildScopedItems(tenantId, childIds, statusHistoryPrefix());
}
