// src/lib/server/db/dynamodb/activity-repo.ts
// DynamoDB implementation of IActivityRepo
//
// #2458-A2 (2026-05-26): facade rewrite — 旧 `activities` partition (SK=MASTER) への
// write を全て NotImplementedError に置き換えた。これにより sqlite と同型に
// 「旧 activities table への write 0 件」を 3 backend (sqlite / demo / dynamodb) で
// 達成。次 PR #2458-C で旧 activities partition / 旧 dynamodb activity-repo は
// 物理削除される予定。
//
// 設計の前提:
//   - ADR-0048 Multi-Lambda Demo Deployment で main Lambda は sqlite local file +
//     S3 backup を使用。`DATA_SOURCE='dynamodb'` は production 未使用 (factory.ts
//     interface 整合のため stub 保持)。
//   - production で本 file の write 経路が呼ばれることはないが、cross-backend test
//     等で interface 契約 (IActivityRepo) を満たす必要があるため type 整合は維持。
//   - write 系を NotImplementedError 化することで「将来 dynamodb 本実装を再開する
//     際に必ず `dynamodb/child-activity-repo.ts` (ADR-0055 per-child schema) 経由で
//     実装し直す」ことを構造的に強制する (旧 activities partition への退行を防止)。
//
// 読み込み系 (findActivities / findActivityById / findActivityLogs 等) は依然として
// activities partition (SK=MASTER) / activity_logs LOG# partition を Scan / Query で
// 取得する legacy 実装を保持。production 未使用のため write 0 化が達成できれば
// 残 read 経路は #2458-C で削除される。
//
// 関連:
//   - PR #2487 (#2458-A1 sqlite facade rewrite、本 PR の reference pattern)
//   - ADR-0055 §3.1 per-child primary data model
//   - ADR-0048 §2 demo Lambda stateless 原則
//   - docs/design/data-model-resource-scope.md §4.1

import {
	BatchWriteCommand,
	GetCommand,
	QueryCommand,
	ScanCommand,
	UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { ArchivedReason } from '$lib/domain/archive-types';
import type {
	Activity,
	ActivityFilter,
	ActivityLog,
	ActivityLogSummary,
	Child,
	InsertActivityInput,
	InsertActivityLogInput,
	InsertPointLedgerInput,
	UpdateActivityInput,
} from '../types';
import { getDocClient, TABLE_NAME } from './client';
import {
	activityKey,
	activityLogDatePrefix,
	activityLogPrefix,
	childKey,
	childPK,
	pointLedgerPrefix,
	tenantPK,
} from './keys';

// ============================================================
// Helpers
// ============================================================

/** Strip PK/SK/GSI keys from a DynamoDB item */
function stripKeys<T extends Record<string, unknown>>(
	item: T,
): Omit<T, 'PK' | 'SK' | 'GSI2PK' | 'GSI2SK'> {
	const { PK, SK, GSI2PK, GSI2SK, ...rest } = item;
	return rest;
}

/** Paginate a ScanCommand, collecting all items */
async function scanAll(
	params: ConstructorParameters<typeof ScanCommand>[0],
): Promise<Record<string, unknown>[]> {
	const items: Record<string, unknown>[] = [];
	let lastKey: Record<string, unknown> | undefined;

	do {
		const result = await getDocClient().send(
			new ScanCommand({
				...params,
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of result.Items ?? []) {
			items.push(item as Record<string, unknown>);
		}
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);

	return items;
}

/** Paginate a QueryCommand, collecting all items */
async function queryAll(
	params: ConstructorParameters<typeof QueryCommand>[0],
): Promise<Record<string, unknown>[]> {
	const items: Record<string, unknown>[] = [];
	let lastKey: Record<string, unknown> | undefined;

	do {
		const result = await getDocClient().send(
			new QueryCommand({
				...params,
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of result.Items ?? []) {
			items.push(item as Record<string, unknown>);
		}
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);

	return items;
}

/**
 * #2458-A2: 旧 `activities` partition への write を発生させない構造的ガード。
 * `dynamodb/child-activity-repo.ts` も全 method が NotImplemented stub のため、
 * 本実装の write 経路を再開する際は ADR-0055 per-child schema (`child_activities`
 * partition) を先に実装してから本 throw を解除する必要がある。
 */
function notImplementedWrite(method: string): never {
	throw new Error(
		`[activity-repo.dynamodb] ${method} not implemented (#2458-A2 旧 activities partition への write 防止). ` +
			'DynamoDB backend は ADR-0048 で production 未使用 (main Lambda は sqlite). ' +
			'再実装時は dynamodb/child-activity-repo.ts (ADR-0055 per-child) 経由で実装すること。',
	);
}

// ============================================================
// Activities CRUD
// ============================================================

/** 全活動を取得（フィルタ対応） */
export async function findActivities(
	tenantId: string,
	filter?: ActivityFilter,
): Promise<Activity[]> {
	const items = await scanAll({
		TableName: TABLE_NAME,
		FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
		ExpressionAttributeValues: {
			':prefix': tenantPK('ACTIVITY#', tenantId),
			':sk': 'MASTER',
		},
	});

	let activities = items.map((item) => {
		const stripped = stripKeys(item) as unknown as Activity;
		// #1755 (#1709-A): 既存レコード backfill — priority 未設定は 'optional' 扱い
		if (stripped.priority !== 'must' && stripped.priority !== 'optional') {
			stripped.priority = 'optional';
		}
		return stripped;
	});

	// #783: archive されたリソースをデフォルトで除外
	activities = activities.filter((a) => !a.isArchived || a.isArchived === 0);

	// Apply filters in memory
	if (filter?.categoryId) {
		activities = activities.filter((a) => a.categoryId === filter.categoryId);
	}

	if (!filter?.includeHidden) {
		activities = activities.filter((a) => a.isVisible === 1);
	}

	if (filter?.childAge != null) {
		const age = filter.childAge;
		activities = activities.filter((a) => {
			const minOk = a.ageMin == null || a.ageMin <= age;
			const maxOk = a.ageMax == null || a.ageMax >= age;
			return minOk && maxOk;
		});
	}

	// Sort by sortOrder
	activities.sort((a, b) => a.sortOrder - b.sortOrder);

	return activities;
}

/** IDで活動を取得 */
export async function findActivityById(
	id: number,
	tenantId: string,
): Promise<Activity | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: activityKey(id, tenantId),
		}),
	);

	if (!result.Item) return undefined;
	const activity = stripKeys(result.Item) as unknown as Activity;
	// #1755 (#1709-A): 既存レコード backfill — priority 未設定は 'optional' 扱い
	if (activity.priority !== 'must' && activity.priority !== 'optional') {
		activity.priority = 'optional';
	}
	return activity;
}

/**
 * 活動を作成 — #2458-A2: 旧 activities partition への write を停止。
 * dynamodb/child-activity-repo.ts (NotImplemented stub) 経由で実装する設計に shift。
 */
export async function insertActivity(
	_input: InsertActivityInput,
	_tenantId: string,
): Promise<Activity> {
	return notImplementedWrite('insertActivity');
}

/**
 * 活動を更新 — #2458-A2: 旧 activities partition への write を停止。
 */
export async function updateActivity(
	_id: number,
	_input: UpdateActivityInput,
	_tenantId: string,
): Promise<Activity | undefined> {
	return notImplementedWrite('updateActivity');
}

/**
 * 活動の表示/非表示を切り替え — #2458-A2: 旧 activities partition への write を停止。
 */
export async function setActivityVisibility(
	_id: number,
	_visible: boolean,
	_tenantId: string,
): Promise<Activity | undefined> {
	return notImplementedWrite('setActivityVisibility');
}

/**
 * 活動を削除 — #2458-A2: 旧 activities partition への write を停止。
 */
export async function deleteActivity(
	_id: number,
	_tenantId: string,
): Promise<Activity | undefined> {
	return notImplementedWrite('deleteActivity');
}

/** 活動にログが存在するか確認 */
export async function hasActivityLogs(activityId: number, _tenantId: string): Promise<boolean> {
	// Scan LOG# items filtered by activityId, limit 1 for efficiency
	const result = await getDocClient().send(
		new ScanCommand({
			TableName: TABLE_NAME,
			FilterExpression: 'begins_with(SK, :skPrefix) AND #activityId = :activityId',
			ExpressionAttributeNames: { '#activityId': 'activityId' },
			ExpressionAttributeValues: {
				':skPrefix': 'LOG#',
				':activityId': activityId,
			},
			Limit: 1,
		}),
	);

	return (result.Items?.length ?? 0) > 0;
}

/** 全活動のログ数を取得（キャンセル除外） */
export async function getActivityLogCounts(_tenantId: string): Promise<Record<number, number>> {
	const items = await scanAll({
		TableName: TABLE_NAME,
		FilterExpression: 'begins_with(SK, :skPrefix) AND #cancelled = :cancelled',
		ExpressionAttributeNames: { '#cancelled': 'cancelled' },
		ExpressionAttributeValues: {
			':skPrefix': 'LOG#',
			':cancelled': 0,
		},
		ProjectionExpression: 'activityId',
	});

	const counts: Record<number, number> = {};
	for (const item of items) {
		const aid = item.activityId as number;
		counts[aid] = (counts[aid] ?? 0) + 1;
	}
	return counts;
}

/** メインクエストに設定された活動数を取得 */
export async function countMainQuestActivities(_tenantId: string): Promise<number> {
	const all = await findActivities(_tenantId);
	return all.filter((a) => a.isMainQuest === 1 && a.isVisible === 1).length;
}

export async function deleteDailyMissionsByActivity(
	activityId: number,
	_tenantId: string,
): Promise<void> {
	const items = await scanAll({
		TableName: TABLE_NAME,
		FilterExpression: 'begins_with(SK, :skPrefix) AND #activityId = :activityId',
		ExpressionAttributeNames: { '#activityId': 'activityId' },
		ExpressionAttributeValues: {
			':skPrefix': 'MISSION#',
			':activityId': activityId,
		},
		ProjectionExpression: 'PK, SK',
	});

	// Batch delete in chunks of 25
	const BATCH_SIZE = 25;
	for (let i = 0; i < items.length; i += BATCH_SIZE) {
		const batch = items.slice(i, i + BATCH_SIZE);
		await getDocClient().send(
			new BatchWriteCommand({
				RequestItems: {
					[TABLE_NAME]: batch.map((item) => ({
						DeleteRequest: { Key: { PK: item.PK as string, SK: item.SK as string } },
					})),
				},
			}),
		);
	}
}

// ============================================================
// Children (convenience — shared lookup)
// ============================================================

/** IDで子供を取得 */
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

// ============================================================
// Activity Logs
// ============================================================

/** 特定日・特定活動のログを取得（キャンセル除外） */
export async function findDailyLog(
	childId: number,
	activityId: number,
	date: string,
	tenantId: string,
): Promise<ActivityLog | undefined> {
	const items = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
		FilterExpression: '#activityId = :activityId AND #cancelled = :cancelled',
		ExpressionAttributeNames: {
			'#activityId': 'activityId',
			'#cancelled': 'cancelled',
		},
		ExpressionAttributeValues: {
			':pk': childPK(childId, tenantId),
			':skPrefix': activityLogDatePrefix(date),
			':activityId': activityId,
			':cancelled': 0,
		},
	});

	const first = items[0];
	if (!first) return undefined;
	return stripKeys(first) as unknown as ActivityLog;
}

/** 連続記録用ログを取得（キャンセル除外、recordedDate降順） */
export async function findStreakLogs(
	childId: number,
	activityId: number,
	tenantId: string,
): Promise<{ recordedDate: string }[]> {
	const items = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
		FilterExpression: '#activityId = :activityId AND #cancelled = :cancelled',
		ExpressionAttributeNames: {
			'#activityId': 'activityId',
			'#cancelled': 'cancelled',
		},
		ExpressionAttributeValues: {
			':pk': childPK(childId, tenantId),
			':skPrefix': activityLogPrefix(),
			':activityId': activityId,
			':cancelled': 0,
		},
		ProjectionExpression: 'recordedDate',
		ScanIndexForward: false,
	});

	return items.map((item) => ({ recordedDate: item.recordedDate as string }));
}

/**
 * 活動ログを挿入 — #2458-A2: 旧 activities partition への write 経路 (lookup の Put) を停止。
 * activity_logs LOG# partition への write も同時停止 (activity 表に依存するため)。
 * 再実装時は dynamodb/child-activity-repo.ts (ADR-0055) 経由で。
 */
export async function insertActivityLog(
	_input: InsertActivityLogInput,
	_tenantId: string,
): Promise<ActivityLog> {
	return notImplementedWrite('insertActivityLog');
}

/** IDで活動ログを取得（childId不明のためScanが必要） */
export async function findActivityLogById(
	id: number,
	_tenantId: string,
): Promise<ActivityLog | undefined> {
	const result = await getDocClient().send(
		new ScanCommand({
			TableName: TABLE_NAME,
			FilterExpression: 'begins_with(SK, :skPrefix) AND #id = :id',
			ExpressionAttributeNames: { '#id': 'id' },
			ExpressionAttributeValues: {
				':skPrefix': 'LOG#',
				':id': id,
			},
			Limit: 100,
		}),
	);

	// Since Limit with FilterExpression may not find the item on first page, paginate
	let items = result.Items ?? [];
	let lastKey = result.LastEvaluatedKey;

	if (items.length > 0) {
		return stripKeys(items[0] as Record<string, unknown>) as unknown as ActivityLog;
	}

	while (lastKey && items.length === 0) {
		const nextResult = await getDocClient().send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression: 'begins_with(SK, :skPrefix) AND #id = :id',
				ExpressionAttributeNames: { '#id': 'id' },
				ExpressionAttributeValues: {
					':skPrefix': 'LOG#',
					':id': id,
				},
				ExclusiveStartKey: lastKey,
				Limit: 100,
			}),
		);
		items = nextResult.Items ?? [];
		lastKey = nextResult.LastEvaluatedKey;
		if (items.length > 0) {
			return stripKeys(items[0] as Record<string, unknown>) as unknown as ActivityLog;
		}
	}

	return undefined;
}

/** 活動ログをキャンセルにする（idからScanで検索後、Update） */
export async function markActivityLogCancelled(id: number, _tenantId: string): Promise<void> {
	// Find the item first by scanning
	const items = await scanAll({
		TableName: TABLE_NAME,
		FilterExpression: 'begins_with(SK, :skPrefix) AND #id = :id',
		ExpressionAttributeNames: { '#id': 'id' },
		ExpressionAttributeValues: {
			':skPrefix': 'LOG#',
			':id': id,
		},
		ProjectionExpression: 'PK, SK',
	});

	if (items.length === 0) return;

	const key = { PK: items[0]?.PK as string, SK: items[0]?.SK as string };

	await getDocClient().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: key,
			UpdateExpression: 'SET #cancelled = :cancelled',
			ExpressionAttributeNames: { '#cancelled': 'cancelled' },
			ExpressionAttributeValues: { ':cancelled': 1 },
		}),
	);
}

/** 活動ログ一覧を取得（ActivityLogSummary形式、非正規化フィールド使用） */
export async function findActivityLogs(
	childId: number,
	tenantId: string,
	options: { from?: string; to?: string } = {},
): Promise<ActivityLogSummary[]> {
	const items = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
		FilterExpression: '#cancelled = :cancelled',
		ExpressionAttributeNames: { '#cancelled': 'cancelled' },
		ExpressionAttributeValues: {
			':pk': childPK(childId, tenantId),
			':skPrefix': activityLogPrefix(),
			':cancelled': 0,
		},
		ScanIndexForward: false,
	});

	let logs = items as Array<Record<string, unknown>>;

	// Apply date range filter in memory
	if (options.from) {
		const from = options.from;
		logs = logs.filter((item) => (item.recordedDate as string) >= from);
	}
	if (options.to) {
		const to = options.to;
		logs = logs.filter((item) => (item.recordedDate as string) <= to);
	}

	// Map to ActivityLogSummary using denormalized fields
	return logs.map((item) => ({
		id: item.id as number,
		activityName: (item.activityName as string) ?? '',
		activityIcon: (item.activityIcon as string) ?? '',
		categoryId: (item.categoryId as number) ?? 0,
		points: item.points as number,
		streakDays: item.streakDays as number,
		streakBonus: item.streakBonus as number,
		recordedAt: item.recordedAt as string,
	}));
}

// ============================================================
// Aggregation Queries — Activity Counts
// ============================================================

/** 指定日・指定活動の有効ログ数 */
export async function countTodayActiveRecords(
	childId: number,
	activityId: number,
	date: string,
	tenantId: string,
): Promise<number> {
	const items = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
		FilterExpression: '#activityId = :activityId AND #cancelled = :cancelled',
		ExpressionAttributeNames: {
			'#activityId': 'activityId',
			'#cancelled': 'cancelled',
		},
		ExpressionAttributeValues: {
			':pk': childPK(childId, tenantId),
			':skPrefix': activityLogDatePrefix(date),
			':activityId': activityId,
			':cancelled': 0,
		},
		ProjectionExpression: 'PK',
	});

	return items.length;
}

/** 指定日の活動別ログ数を取得 */
export async function getTodayActivityCountsByChild(
	childId: number,
	date: string,
	tenantId: string,
): Promise<{ activityId: number; count: number }[]> {
	const items = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
		FilterExpression: '#cancelled = :cancelled',
		ExpressionAttributeNames: { '#cancelled': 'cancelled' },
		ExpressionAttributeValues: {
			':pk': childPK(childId, tenantId),
			':skPrefix': activityLogDatePrefix(date),
			':cancelled': 0,
		},
		ProjectionExpression: 'activityId',
	});

	const counts = new Map<number, number>();
	for (const item of items) {
		const aid = item.activityId as number;
		counts.set(aid, (counts.get(aid) ?? 0) + 1);
	}

	return Array.from(counts.entries()).map(([activityId, count]) => ({ activityId, count }));
}

/** 指定日に記録済みの活動IDリストを取得 */
export async function findTodayRecordedActivityIds(
	childId: number,
	today: string,
	tenantId: string,
): Promise<number[]> {
	const items = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
		FilterExpression: '#cancelled = :cancelled',
		ExpressionAttributeNames: { '#cancelled': 'cancelled' },
		ExpressionAttributeValues: {
			':pk': childPK(childId, tenantId),
			':skPrefix': activityLogDatePrefix(today),
			':cancelled': 0,
		},
		ProjectionExpression: 'activityId',
	});

	return items.map((item) => item.activityId as number);
}

// ============================================================
// Aggregation Queries — for achievement/title/combo services
// ============================================================

/** 子供の活動記録日（重複除去・昇順） */
export async function findDistinctRecordedDates(
	childId: number,
	tenantId: string,
): Promise<{ recordedDate: string }[]> {
	const items = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
		FilterExpression: '#cancelled = :cancelled',
		ExpressionAttributeNames: { '#cancelled': 'cancelled' },
		ExpressionAttributeValues: {
			':pk': childPK(childId, tenantId),
			':skPrefix': activityLogPrefix(),
			':cancelled': 0,
		},
		ProjectionExpression: 'recordedDate',
		ScanIndexForward: true,
	});

	const dateSet = new Set<string>();
	for (const item of items) {
		dateSet.add(item.recordedDate as string);
	}

	return Array.from(dateSet)
		.sort()
		.map((d) => ({ recordedDate: d }));
}

/** 子供の累計活動記録数（キャンセル除外） */
export async function countActiveActivityLogs(childId: number, tenantId: string): Promise<number> {
	const items = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
		FilterExpression: '#cancelled = :cancelled',
		ExpressionAttributeNames: { '#cancelled': 'cancelled' },
		ExpressionAttributeValues: {
			':pk': childPK(childId, tenantId),
			':skPrefix': activityLogPrefix(),
			':cancelled': 0,
		},
		ProjectionExpression: 'PK',
	});

	return items.length;
}

/** 日別カテゴリ数を取得（achievement: all_categories 判定用） */
export async function getCategoryCountsByDate(
	childId: number,
	tenantId: string,
): Promise<{ recordedDate: string; categoryCount: number }[]> {
	const items = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
		FilterExpression: '#cancelled = :cancelled',
		ExpressionAttributeNames: { '#cancelled': 'cancelled' },
		ExpressionAttributeValues: {
			':pk': childPK(childId, tenantId),
			':skPrefix': activityLogPrefix(),
			':cancelled': 0,
		},
		ProjectionExpression: 'recordedDate, categoryId',
	});

	// Group by date, count distinct categories per date
	const dateCategories = new Map<string, Set<number>>();
	for (const item of items) {
		const date = item.recordedDate as string;
		const catId = item.categoryId as number;
		if (!dateCategories.has(date)) {
			dateCategories.set(date, new Set());
		}
		dateCategories.get(date)?.add(catId);
	}

	return Array.from(dateCategories.entries()).map(([recordedDate, cats]) => ({
		recordedDate,
		categoryCount: cats.size,
	}));
}

/** 累計で記録した異なるカテゴリ数 */
export async function countDistinctCategories(childId: number, tenantId: string): Promise<number> {
	const items = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
		FilterExpression: '#cancelled = :cancelled',
		ExpressionAttributeNames: { '#cancelled': 'cancelled' },
		ExpressionAttributeValues: {
			':pk': childPK(childId, tenantId),
			':skPrefix': activityLogPrefix(),
			':cancelled': 0,
		},
		ProjectionExpression: 'categoryId',
	});

	const catSet = new Set<number>();
	for (const item of items) {
		catSet.add(item.categoryId as number);
	}

	return catSet.size;
}

/** 今日のログ（活動ID+カテゴリID付き） — combo-service用 */
export async function findTodayLogsWithCategory(
	childId: number,
	date: string,
	tenantId: string,
): Promise<{ activityId: number; categoryId: number }[]> {
	const items = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
		FilterExpression: '#cancelled = :cancelled',
		ExpressionAttributeNames: { '#cancelled': 'cancelled' },
		ExpressionAttributeValues: {
			':pk': childPK(childId, tenantId),
			':skPrefix': activityLogDatePrefix(date),
			':cancelled': 0,
		},
		ProjectionExpression: 'activityId, categoryId',
	});

	return items.map((item) => ({
		activityId: item.activityId as number,
		categoryId: (item.categoryId as number) ?? 0,
	}));
}

/** コンボボーナス既付与額を取得 — combo-service用 */
export async function getComboPointsGranted(
	childId: number,
	descriptionPrefix: string,
	tenantId: string,
): Promise<number> {
	const items = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
		FilterExpression: '#type = :type AND begins_with(#description, :descPrefix)',
		ExpressionAttributeNames: {
			'#type': 'type',
			'#description': 'description',
		},
		ExpressionAttributeValues: {
			':pk': childPK(childId, tenantId),
			':skPrefix': pointLedgerPrefix(),
			':type': 'combo_bonus',
			':descPrefix': descriptionPrefix,
		},
		ProjectionExpression: 'amount',
	});

	let total = 0;
	for (const item of items) {
		total += (item.amount as number) ?? 0;
	}

	return total;
}

/** カテゴリ別の累計活動記録数（キャンセル除外） */
export async function countActiveActivityLogsByCategory(
	childId: number,
	categoryId: number,
	tenantId: string,
): Promise<number> {
	const items = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
		FilterExpression: '#cancelled = :cancelled AND categoryId = :catId',
		ExpressionAttributeNames: { '#cancelled': 'cancelled' },
		ExpressionAttributeValues: {
			':pk': childPK(childId, tenantId),
			':skPrefix': activityLogPrefix(),
			':cancelled': 0,
			':catId': categoryId,
		},
		ProjectionExpression: 'PK',
	});

	return items.length;
}

/** 指定タイプのポイント台帳エントリ数を取得 */
export async function countPointLedgerEntriesByType(
	childId: number,
	type: string,
	tenantId: string,
): Promise<number> {
	const items = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
		FilterExpression: '#type = :type',
		ExpressionAttributeNames: { '#type': 'type' },
		ExpressionAttributeValues: {
			':pk': childPK(childId, tenantId),
			':skPrefix': pointLedgerPrefix(),
			':type': type,
		},
		ProjectionExpression: 'PK',
	});

	return items.length;
}

/** 指定タイプ＋日付のポイント台帳エントリ数を取得 */
export async function countPointLedgerEntriesByTypeAndDate(
	childId: number,
	type: string,
	date: string,
	tenantId: string,
): Promise<number> {
	const items = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
		FilterExpression: '#type = :type AND begins_with(createdAt, :date)',
		ExpressionAttributeNames: { '#type': 'type' },
		ExpressionAttributeValues: {
			':pk': childPK(childId, tenantId),
			':skPrefix': pointLedgerPrefix(),
			':type': type,
			':date': date,
		},
		ProjectionExpression: 'PK',
	});

	return items.length;
}

// ============================================================
// Point Ledger — #2458-A2: 旧 activities partition への write 停止に伴い同時停止
// ============================================================
// point_ledger 自体は activities partition を直接 update しないが、activity_logs 経由の
// bonus 付与 chain が write 停止になるため、本実装も整合のため stub 化する。

export async function insertPointLedger(
	_input: InsertPointLedgerInput,
	_tenantId: string,
): Promise<void> {
	return notImplementedWrite('insertPointLedger');
}

// ============================================================
// Retention cleanup (#717, #729)
// ============================================================

/** Batch-delete PK/SK pairs in chunks of 25 (DynamoDB BatchWriteItem limit). */
async function batchDeleteKeys(keys: { PK: string; SK: string }[]): Promise<void> {
	for (let i = 0; i < keys.length; i += 25) {
		const chunk = keys.slice(i, i + 25);
		await getDocClient().send(
			new BatchWriteCommand({
				RequestItems: {
					[TABLE_NAME]: chunk.map((k) => ({
						DeleteRequest: { Key: { PK: k.PK, SK: k.SK } },
					})),
				},
			}),
		);
	}
}

/**
 * 指定した子供の `recorded_date < cutoffDate` に該当する activity_logs を削除する。
 * SK 形式 `LOG#<date>#<id>` の辞書順比較で、`LOG#` (inclusive) 〜 `LOG#<cutoffDate>` (inclusive)
 * を BETWEEN クエリ → BatchWrite で削除。cutoffDate 当日のログ（`LOG#<cutoffDate>#<id>`）は
 * `LOG#<cutoffDate>` よりも辞書順で大きいため対象外。
 */
export async function deleteActivityLogsBeforeDate(
	childId: number,
	cutoffDate: string,
	tenantId: string,
): Promise<number> {
	const items = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND SK BETWEEN :lower AND :upper',
		ExpressionAttributeValues: {
			':pk': childPK(childId, tenantId),
			':lower': activityLogPrefix(),
			':upper': `LOG#${cutoffDate}`,
		},
		ProjectionExpression: 'PK, SK',
	});

	const keys = items.map((item) => ({ PK: item.PK as string, SK: item.SK as string }));
	await batchDeleteKeys(keys);
	return keys.length;
}

// ============================================================
// #1755 (#1709-A): 「今日のおやくそく」(priority='must') 集計
// ============================================================

/**
 * priority='must' の活動全件と、`today` 当日に記録されたものを集計する。
 * - SQLite 実装と同じ契約 (logged / total / activities[]) を返す
 */
export async function findMustActivitiesWithToday(
	childId: number,
	today: string,
	tenantId: string,
): Promise<{
	logged: number;
	total: number;
	activities: Array<{ id: number; name: string; icon: string; loggedToday: number }>;
}> {
	// must な活動を全件取得（findActivities が priority backfill 込みで返す）
	const allActive = await findActivities(tenantId);
	const mustList = allActive.filter((a) => a.priority === 'must');

	if (mustList.length === 0) {
		return { logged: 0, total: 0, activities: [] };
	}

	// 今日記録された activity id 集合
	const todayItems = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
		FilterExpression: '#cancelled = :cancelled',
		ExpressionAttributeNames: { '#cancelled': 'cancelled' },
		ExpressionAttributeValues: {
			':pk': childPK(childId, tenantId),
			':skPrefix': activityLogDatePrefix(today),
			':cancelled': 0,
		},
		ProjectionExpression: 'activityId',
	});
	const loggedSet = new Set<number>(todayItems.map((it) => it.activityId as number));

	const enriched = mustList.map((a) => ({
		id: a.id,
		name: a.name,
		icon: a.icon,
		loggedToday: loggedSet.has(a.id) ? 1 : 0,
	}));
	const logged = enriched.filter((a) => a.loggedToday === 1).length;
	return { logged, total: enriched.length, activities: enriched };
}

// #783: archive / restore — #2458-A2: 旧 activities partition への write 停止

// Phase 7 PR-2a (#2688): reason は ArchivedReason 型 (`ARCHIVED_REASONS` SSOT)。
export async function archiveActivities(
	_ids: number[],
	_reason: ArchivedReason,
	_tenantId: string,
): Promise<void> {
	return notImplementedWrite('archiveActivities');
}

export async function restoreArchivedActivities(
	_reason: ArchivedReason,
	_tenantId: string,
): Promise<void> {
	return notImplementedWrite('restoreArchivedActivities');
}
