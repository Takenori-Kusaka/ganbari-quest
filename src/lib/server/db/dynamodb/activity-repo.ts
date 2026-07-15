// src/lib/server/db/dynamodb/activity-repo.ts
// DynamoDB implementation of IActivityRepo
//
// #2824 Wave 4A (2026-06-04 / ADR-0055): write 8 method を本実装化。
//   本番 main Lambda (`ganbari-quest-app`、infra/lib/compute-stack.ts、AUTH_MODE=cognito)
//   は **DATA_SOURCE=dynamodb** で稼働する (旧コメントの「production 未使用 / main Lambda は
//   sqlite」は stale な誤記だった)。そのため write 8 method が NotImplementedError throw のままだと:
//     - insertActivityLog: 子供の活動記録 (activity-log-service L211) が throw → 記録不能 (CRITICAL)
//     - insertPointLedger: ポイント台帳 → ポイント付与不能 (CRITICAL)
//     - insertActivity 等 6: family-master activity CRUD が throw
//   というコアループ全停止 gap になっていた。本 PR で根治する。
//
// 設計 (read 整合と family-master 判断):
//   - insertActivityLog / insertPointLedger は log/ledger エンティティ。read 側
//     (findDailyLog / findStreakLogs / findActivityLogs / findActivityLogById /
//     countTodayActiveRecords / getCategoryCountsByDate / findTodayLogsWithCategory 等) が
//     既に期待する key 形式 (LOG#<date>#<id> / POINT#<createdAt>#<id>) と denormalized 属性
//     (activityName / activityIcon / categoryId) に整合する形で write する。
//     denormalize は insert 時に child_activities instance を lookup して埋める
//     (SQLite の innerJoin (activityLogs ⋈ childActivities) と機能等価)。
//   - family-master CRUD (insertActivity / updateActivity / setActivityVisibility /
//     deleteActivity / archiveActivities / restoreArchivedActivities) は SQLite 側
//     (#2458-A1 facade rewrite) と同じく **per-child `child_activities` 経由** に統一する。
//     live app の `activity-service.ts` は CRUD を `getRepos().childActivity.*` で直接
//     叩いており、本 facade の family-master write を呼ぶのは barrel 経由の
//     archive / restore (downgrade-service / resource-archive-service) のみ。これらを
//     child-activity-repo の per-child 実装に委譲することで signature 不変のまま
//     live schema (child_activities) に write する (旧 activities partition への退行ゼロ)。
//
// #3575: repo interface は branded id (ChildId/ActivityId/CategoryId)。stored item は
//   数値 id のまま (storage format 不変)、repo 境界で Number()/as* 変換する。
//
// 関連:
//   - PR #2487 (#2458-A1 sqlite facade rewrite、本 PR の挙動 SSOT)
//   - PR #2820 (dynamodb/child-activity-repo.ts 本実装、委譲先)
//   - ADR-0055 §3.1 per-child primary data model
//   - docs/design/08-データベース設計書.md / data-model-resource-scope.md §4.1

import {
	BatchWriteCommand,
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	TransactWriteCommand,
	UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { ArchivedReason } from '$lib/domain/archive-types';
import type { ActivityId, CategoryId, ChildId } from '$lib/domain/ids';
import { asActivityId, asCategoryId, asChildId } from '$lib/domain/ids';
import type {
	Activity,
	ActivityFilter,
	ActivityLog,
	ActivityLogSummary,
	Child,
	ChildActivity,
	InsertActivityInput,
	InsertActivityLogInput,
	InsertPointLedgerInput,
	UpdateActivityInput,
	UpdateChildActivityInput,
} from '../types';
import * as childActivityRepo from './child-activity-repo';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import {
	activityKey,
	activityLogDatePrefix,
	activityLogKey,
	activityLogPrefix,
	childKey,
	childPK,
	ENTITY_NAMES,
	pointLedgerIdempotencyKey,
	pointLedgerKey,
	pointLedgerPrefix,
	tenantPK,
} from './keys';
import { toChildEntity } from './repo-helpers';

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

// stored item は数値 id のまま (storage format 不変、#3575)。repo 境界で branded string に変換する。
type StoredActivity = Omit<Activity, 'id' | 'categoryId'> & { id: number; categoryId: number };
type StoredActivityLog = Omit<ActivityLog, 'id' | 'childId' | 'activityId'> & {
	id: number;
	childId: number;
	activityId: number;
};

function toActivity(item: Record<string, unknown>): Activity {
	const raw = stripKeys(item) as unknown as StoredActivity;
	const activity: Activity = {
		...raw,
		id: asActivityId(raw.id),
		categoryId: asCategoryId(raw.categoryId),
	};
	// #1755 (#1709-A): 既存レコード backfill — priority 未設定は 'optional' 扱い
	if (activity.priority !== 'must' && activity.priority !== 'optional') {
		activity.priority = 'optional';
	}
	return activity;
}

function toActivityLog(item: Record<string, unknown>): ActivityLog {
	const raw = stripKeys(item) as unknown as StoredActivityLog;
	return {
		id: String(raw.id),
		childId: asChildId(raw.childId),
		activityId: asActivityId(raw.activityId),
		points: raw.points,
		streakDays: raw.streakDays,
		streakBonus: raw.streakBonus,
		recordedDate: raw.recordedDate,
		recordedAt: raw.recordedAt,
		cancelled: raw.cancelled,
	};
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
 * activity_id (= child_activities instance id) から所属 childId を逆引きする (tenant 内)。
 *
 * facade signature `(id, …, tenantId)` は childId を受けないため、family-master write の
 * 委譲先 child-activity-repo (per-child) には childId が必須。child_activities は
 * child partition (PK=CHILD#<cId>) に分散するため GSI なしの逆引きは Scan が必要。
 * これらの write (insert を除く CRUD) は低頻度 (admin 操作 / プラン降格) のため
 * Pre-PMF (ADR-0010) では Scan + 属性フィルタで十分。SQLite の `_resolveChildIdForActivity`
 * (childActivities を id で 1 行 lookup) と機能等価。
 */
async function resolveChildIdForActivity(
	id: ActivityId,
	tenantId: string,
): Promise<ChildId | undefined> {
	let lastKey: Record<string, unknown> | undefined;
	do {
		const result = await getDocClient().send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression:
					'begins_with(PK, :tenantPrefix) AND begins_with(SK, :skPrefix) AND id = :id',
				ExpressionAttributeValues: {
					':tenantPrefix': tenantPK('CHILD#', tenantId),
					':skPrefix': 'CHILDACT#',
					':id': Number(id),
				},
				ProjectionExpression: 'childId',
				ExclusiveStartKey: lastKey,
				Limit: 100,
			}),
		);
		const hit = result.Items?.[0];
		if (hit) return asChildId(hit.childId as number);
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);
	return undefined;
}

/**
 * tenant 内の最初の child (id 昇順) を返す。insertActivity の bind 先解決用。
 * SQLite `_findFirstChild` と機能等価 (children を id 順で先頭 1 件)。
 */
async function findFirstChild(tenantId: string): Promise<{ id: number } | undefined> {
	const items = await scanAll({
		TableName: TABLE_NAME,
		FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
		ExpressionAttributeValues: {
			':prefix': tenantPK('CHILD#', tenantId),
			':sk': 'PROFILE',
		},
		ProjectionExpression: 'id',
	});
	if (items.length === 0) return undefined;
	const ids = items.map((it) => it.id as number).sort((a, b) => a - b);
	return { id: ids[0] as number };
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

	let activities = items.map((item) => toActivity(item));

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
	id: ActivityId,
	tenantId: string,
): Promise<Activity | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: activityKey(Number(id), tenantId),
		}),
	);

	if (!result.Item) return undefined;
	return toActivity(result.Item);
}

/**
 * ChildActivity (per-child instance) を facade の Activity shape に変換する。
 * family-master 列 (ageMin / ageMax / gradeLevel / subcategory / description) は
 * per-child instance に存在しないため null で埋める (SQLite `_toActivityShape` と同型)。
 */
function toActivityShape(c: ChildActivity): Activity {
	return {
		id: c.id,
		name: c.name,
		categoryId: c.categoryId,
		icon: c.icon,
		basePoints: c.basePoints,
		ageMin: null,
		ageMax: null,
		isVisible: c.isVisible,
		dailyLimit: c.dailyLimit,
		sortOrder: c.sortOrder,
		source: c.source,
		gradeLevel: null,
		subcategory: null,
		description: null,
		nameKana: c.nameKana,
		nameKanji: c.nameKanji,
		triggerHint: c.triggerHint,
		isMainQuest: c.isMainQuest,
		isArchived: c.isArchived,
		archivedReason: c.archivedReason,
		createdAt: c.createdAt,
		sourcePresetId: c.sourcePresetId ?? null,
		priority: c.priority,
	};
}

/**
 * 活動を作成 — #2824: 旧 activities partition ではなく child_activities (per-child) に作成。
 * SQLite (#2458-A1) と同じく tenant の最初の child に bind する (signature 不変)。
 */
export async function insertActivity(
	input: InsertActivityInput,
	tenantId: string,
): Promise<Activity> {
	const firstChild = await findFirstChild(tenantId);
	if (!firstChild) {
		throw new Error('insertActivity: tenant に child が存在しないため作成不可');
	}
	const row = await childActivityRepo.insertActivity(
		{
			childId: asChildId(firstChild.id),
			name: input.name,
			categoryId: input.categoryId,
			icon: input.icon,
			basePoints: input.basePoints,
			triggerHint: input.triggerHint ?? null,
			isMainQuest: input.isMainQuest ?? 0,
			sourcePresetId: input.sourcePresetId ?? null,
			priority: input.priority ?? 'optional',
		},
		tenantId,
	);
	return toActivityShape(row);
}

/**
 * 活動を更新 — #2824: child_activities (per-child) を id 逆引き → child scope 更新。
 */
export async function updateActivity(
	id: ActivityId,
	input: UpdateActivityInput,
	tenantId: string,
): Promise<Activity | undefined> {
	const childId = await resolveChildIdForActivity(id, tenantId);
	if (childId === undefined) return undefined;
	// ChildActivity に存在しない field (ageMin / ageMax) は drop (SQLite と同型)。
	const updateInput: UpdateChildActivityInput = {};
	if (input.name !== undefined) updateInput.name = input.name;
	if (input.categoryId !== undefined) updateInput.categoryId = input.categoryId;
	if (input.icon !== undefined) updateInput.icon = input.icon;
	if (input.basePoints !== undefined) updateInput.basePoints = input.basePoints;
	if (input.triggerHint !== undefined) updateInput.triggerHint = input.triggerHint;
	if (input.priority !== undefined) updateInput.priority = input.priority;
	if (input.isMainQuest !== undefined) updateInput.isMainQuest = input.isMainQuest;
	const row = await childActivityRepo.updateActivity(id, childId, updateInput, tenantId);
	return row ? toActivityShape(row) : undefined;
}

/**
 * 活動の表示/非表示を切り替え — #2824: child_activities (per-child) 経由。
 */
export async function setActivityVisibility(
	id: ActivityId,
	visible: boolean,
	tenantId: string,
): Promise<Activity | undefined> {
	const childId = await resolveChildIdForActivity(id, tenantId);
	if (childId === undefined) return undefined;
	const row = await childActivityRepo.setActivityVisibility(id, childId, visible, tenantId);
	return row ? toActivityShape(row) : undefined;
}

/**
 * 活動を削除 — #2824: child_activities (per-child) 経由 (削除した行を返す)。
 */
export async function deleteActivity(
	id: ActivityId,
	tenantId: string,
): Promise<Activity | undefined> {
	const childId = await resolveChildIdForActivity(id, tenantId);
	if (childId === undefined) return undefined;
	const row = await childActivityRepo.deleteActivity(id, childId, tenantId);
	return row ? toActivityShape(row) : undefined;
}

/** 活動にログが存在するか確認 */
export async function hasActivityLogs(activityId: ActivityId, tenantId: string): Promise<boolean> {
	// #3044 (#2845 §1 read 系残党): 旧実装は `begins_with(SK, 'LOG#')` のみで tenant 無束縛の
	//   全テーブル Scan だった。pooled multi-tenant single-table では別 tenant が同じ
	//   activity_id を採番していると他 tenant の LOG item を拾い、活動削除判定 (admin/activities
	//   delete / clearAll) が cross-tenant の存在に引きずられる (原則 1 = full composite-key
	//   addressing 違反)。FilterExpression に `begins_with(PK, T#<tenant>#CHILD#)` を加え、
	//   Scan を当該 tenant の child partition に構造的に閉じ込める (resolveChildIdForActivity と
	//   同型の tenant 束縛、§1「tenant 束縛済だが childId を interface が受けない tenant Scan
	//   解決」カテゴリ)。
	// #2842: DynamoDB は FilterExpression より先に Limit を評価するため、Limit:1 では
	//   「最初に scan された 1 件が match しない」だけで false negative になる
	//   (= ログを持つ活動が hard-delete され子供の履歴が永久消失する)。
	//   Limit は付けず scanAll と同型の do/while + ExclusiveStartKey で全 page を走査し、
	//   filter match を 1 件見つけ次第 early-return true、page 尽きたら false を返す。
	let lastKey: Record<string, unknown> | undefined;
	do {
		const result = await getDocClient().send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression:
					'begins_with(PK, :tenantPrefix) AND begins_with(SK, :skPrefix) AND #activityId = :activityId',
				ExpressionAttributeNames: { '#activityId': 'activityId' },
				ExpressionAttributeValues: {
					':tenantPrefix': tenantPK('CHILD#', tenantId),
					':skPrefix': 'LOG#',
					':activityId': Number(activityId),
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		if ((result.Items?.length ?? 0) > 0) {
			return true;
		}
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);

	return false;
}

/** 全活動のログ数を取得（キャンセル除外、tenant 束縛） */
export async function getActivityLogCounts(tenantId: string): Promise<Record<number, number>> {
	// #3044 (#2845 §1 同型残党、cross-tenant read 集計混入): 旧実装は `begins_with(SK, 'LOG#')`
	//   のみで tenant 無束縛の全テーブル Scan だった。pooled multi-tenant single-table では他 tenant
	//   の LOG item も集計され、admin/activities 一覧の活動別ログ件数 (activityId 別 count) に
	//   別家庭の記録数が混入する形状だった (情報開示 + 削除可否判定の誤り)。FilterExpression に
	//   `begins_with(PK, T#<tenant>#CHILD#)` を加え、当該 tenant の child partition だけを集計する
	//   (hasActivityLogs と同型)。activityId は tenant 別採番で衝突しうるため、tenant 束縛なしでは
	//   別 tenant の同 id ログが加算され count が過大になる。
	const items = await scanAll({
		TableName: TABLE_NAME,
		FilterExpression:
			'begins_with(PK, :tenantPrefix) AND begins_with(SK, :skPrefix) AND #cancelled = :cancelled',
		ExpressionAttributeNames: { '#cancelled': 'cancelled' },
		ExpressionAttributeValues: {
			':tenantPrefix': tenantPK('CHILD#', tenantId),
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
	activityId: ActivityId,
	tenantId: string,
): Promise<void> {
	// #3044 (#2845 §1 同型残党、cross-tenant write/delete IDOR): 旧実装は
	//   `begins_with(SK, 'MISSION#')` のみで tenant 無束縛の全テーブル Scan だった。MISSION item は
	//   `dailyMissionKey` (keys.ts) で PK=`T#<tenant>#CHILD#<cId>` / SK=`MISSION#<date>#<paddedActId>`
	//   と child partition 配下に置かれる (LOG# と同じ child scope)。pooled multi-tenant single-table
	//   で別 tenant が同じ activity_id を採番していると他 tenant の MISSION item を拾い、活動削除に
	//   随伴する mission cleanup が他家庭の今日のミッションを巻き込んで BatchWrite 削除する
	//   cross-tenant delete IDOR 形状だった。FilterExpression に `begins_with(PK, T#<tenant>#CHILD#)`
	//   を加え、当該 tenant の child partition だけを削除対象にする (LOG# 系 read 2 件と同じ PK 規約)。
	const items = await scanAll({
		TableName: TABLE_NAME,
		FilterExpression:
			'begins_with(PK, :tenantPrefix) AND begins_with(SK, :skPrefix) AND #activityId = :activityId',
		ExpressionAttributeNames: { '#activityId': 'activityId' },
		ExpressionAttributeValues: {
			':tenantPrefix': tenantPK('CHILD#', tenantId),
			':skPrefix': 'MISSION#',
			':activityId': Number(activityId),
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
export async function findChildById(id: ChildId, tenantId: string): Promise<Child | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: childKey(Number(id), tenantId),
		}),
	);

	if (!result.Item) return undefined;
	return toChildEntity(result.Item);
}

// ============================================================
// Activity Logs
// ============================================================

/** 特定日・特定活動のログを取得（キャンセル除外） */
export async function findDailyLog(
	childId: ChildId,
	activityId: ActivityId,
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
			':pk': childPK(Number(childId), tenantId),
			':skPrefix': activityLogDatePrefix(date),
			':activityId': Number(activityId),
			':cancelled': 0,
		},
	});

	const first = items[0];
	if (!first) return undefined;
	return toActivityLog(first);
}

/** 連続記録用ログを取得（キャンセル除外、recordedDate降順） */
export async function findStreakLogs(
	childId: ChildId,
	activityId: ActivityId,
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
			':pk': childPK(Number(childId), tenantId),
			':skPrefix': activityLogPrefix(),
			':activityId': Number(activityId),
			':cancelled': 0,
		},
		ProjectionExpression: 'recordedDate',
		ScanIndexForward: false,
	});

	return items.map((item) => ({ recordedDate: item.recordedDate as string }));
}

/**
 * 活動ログを挿入 — #2824 (CRITICAL): 子供の活動記録の本経路 (activity-log-service L211)。
 *
 * key: PK=CHILD#<cId>, SK=LOG#<recordedDate>#<paddedId> (read 側 findDailyLog /
 * findStreakLogs / findActivityLogs 等が begins_with(SK, 'LOG#…') で読む形式)。
 *
 * 非正規化: read 側の `findActivityLogs` (ActivityLogSummary) / `getCategoryCountsByDate` /
 * `findTodayLogsWithCategory` / `countActiveActivityLogsByCategory` は LOG item の
 * activityName / activityIcon / categoryId を直接読む (SQLite では innerJoin で解決)。
 * そのため insert 時に child_activities instance を lookup し非正規化属性として埋める。
 * instance が見つからない場合 (理論上発生しないが防御) は空文字 / 0 で埋める。
 */
export async function insertActivityLog(
	input: InsertActivityLogInput,
	tenantId: string,
): Promise<ActivityLog> {
	const id = await nextId(ENTITY_NAMES.activityLog, tenantId);

	// JOIN 代替: child_activities instance から denormalize する属性を解決。
	const activity = await childActivityRepo.findActivityById(
		input.activityId,
		input.childId,
		tenantId,
	);

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...activityLogKey(Number(input.childId), input.recordedDate, id, tenantId),
				// stored attributes は数値 id のまま (storage format 不変、#3575)
				id,
				childId: Number(input.childId),
				activityId: Number(input.activityId),
				points: input.points,
				streakDays: input.streakDays,
				streakBonus: input.streakBonus,
				recordedDate: input.recordedDate,
				recordedAt: input.recordedAt,
				cancelled: 0,
				// 非正規化 (read 側 ActivityLogSummary / category 集計の JOIN 代替)
				activityName: activity?.name ?? '',
				activityIcon: activity?.icon ?? '',
				categoryId: activity ? Number(activity.categoryId) : 0,
			},
		}),
	);

	return {
		id: String(id),
		childId: input.childId,
		activityId: input.activityId,
		points: input.points,
		streakDays: input.streakDays,
		streakBonus: input.streakBonus,
		recordedDate: input.recordedDate,
		recordedAt: input.recordedAt,
		cancelled: 0,
	};
}

/** IDで活動ログを取得（childId 不明のため tenant 内 Scan + id filter で 1 件特定） */
export async function findActivityLogById(
	id: string,
	tenantId: string,
): Promise<ActivityLog | undefined> {
	// #3044 (#2845 §1 read 系残党、cross-tenant read IDOR): 旧実装は `begins_with(SK, 'LOG#')`
	//   のみで tenant 無束縛の全テーブル Scan だった。tenant 別採番の id 衝突時に他 tenant の
	//   LOG item を返し、上位 (cancelActivityLog) がそのまま childId / points 等を読み取れば
	//   cross-tenant 情報漏洩になる。FilterExpression に `begins_with(PK, T#<tenant>#CHILD#)` を
	//   加え、当該 tenant の child partition だけを走査することで cross-tenant read を構造的に
	//   遮断する (childId は interface が受けないため §1「tenant 束縛済だが childId を interface
	//   が受けない tenant Scan 解決」カテゴリ。certificate.findCertificateById と同型)。
	// #2842: DynamoDB は FilterExpression より先に Limit を評価するため、Limit を付けると
	//   1 page 内に match が無いだけで取りこぼす。Limit は外し、scanAll と同型の
	//   do/while + ExclusiveStartKey で全 page を走査する。各 page では filter match した
	//   全 Items を走査し (`items[0]` だけ見ない)、最初の match を返す。
	let lastKey: Record<string, unknown> | undefined;
	do {
		const result = await getDocClient().send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression:
					'begins_with(PK, :tenantPrefix) AND begins_with(SK, :skPrefix) AND #id = :id',
				ExpressionAttributeNames: { '#id': 'id' },
				ExpressionAttributeValues: {
					':tenantPrefix': tenantPK('CHILD#', tenantId),
					':skPrefix': 'LOG#',
					':id': Number(id),
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of result.Items ?? []) {
			return toActivityLog(item as Record<string, unknown>);
		}
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);

	return undefined;
}

/** 活動ログをキャンセルにする（tenant 内 Scan で id 解決後、Update） */
export async function markActivityLogCancelled(id: string, tenantId: string): Promise<void> {
	// #3044 (#2845 §1 同型残党、cross-tenant write IDOR): 旧実装は `begins_with(SK, 'LOG#')`
	//   のみで tenant 無束縛の全テーブル Scan だった。pooled multi-tenant single-table で別 tenant
	//   が同じ log id を採番していると他 tenant の LOG item を拾い、上位 (cancelActivityLog) が
	//   その item を cancelled=1 に書き換える cross-tenant write IDOR (他家庭の活動記録を勝手に
	//   取り消す) 形状だった。FilterExpression に `begins_with(PK, T#<tenant>#CHILD#)` を加え
	//   (resolveChildIdForActivity / findActivityLogById と同型)、Scan を当該 tenant の child
	//   partition に構造的に閉じ込める (childId は interface が受けないため §1「tenant 束縛済だが
	//   childId を interface が受けない tenant Scan 解決」カテゴリ)。
	// Find the item first by scanning
	const items = await scanAll({
		TableName: TABLE_NAME,
		FilterExpression: 'begins_with(PK, :tenantPrefix) AND begins_with(SK, :skPrefix) AND #id = :id',
		ExpressionAttributeNames: { '#id': 'id' },
		ExpressionAttributeValues: {
			':tenantPrefix': tenantPK('CHILD#', tenantId),
			':skPrefix': 'LOG#',
			':id': Number(id),
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
	childId: ChildId,
	tenantId: string,
	options: { from?: string; to?: string } = {},
): Promise<ActivityLogSummary[]> {
	const items = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
		FilterExpression: '#cancelled = :cancelled',
		ExpressionAttributeNames: { '#cancelled': 'cancelled' },
		ExpressionAttributeValues: {
			':pk': childPK(Number(childId), tenantId),
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
		id: String(item.id as number),
		activityName: (item.activityName as string) ?? '',
		activityIcon: (item.activityIcon as string) ?? '',
		categoryId: asCategoryId((item.categoryId as number) ?? 0),
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
	childId: ChildId,
	activityId: ActivityId,
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
			':pk': childPK(Number(childId), tenantId),
			':skPrefix': activityLogDatePrefix(date),
			':activityId': Number(activityId),
			':cancelled': 0,
		},
		ProjectionExpression: 'PK',
	});

	return items.length;
}

/** 指定日の活動別ログ数を取得 */
export async function getTodayActivityCountsByChild(
	childId: ChildId,
	date: string,
	tenantId: string,
): Promise<{ activityId: ActivityId; count: number }[]> {
	const items = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
		FilterExpression: '#cancelled = :cancelled',
		ExpressionAttributeNames: { '#cancelled': 'cancelled' },
		ExpressionAttributeValues: {
			':pk': childPK(Number(childId), tenantId),
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

	return Array.from(counts.entries()).map(([activityId, count]) => ({
		activityId: asActivityId(activityId),
		count,
	}));
}

/** 指定日に記録済みの活動IDリストを取得 */
export async function findTodayRecordedActivityIds(
	childId: ChildId,
	today: string,
	tenantId: string,
): Promise<ActivityId[]> {
	const items = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
		FilterExpression: '#cancelled = :cancelled',
		ExpressionAttributeNames: { '#cancelled': 'cancelled' },
		ExpressionAttributeValues: {
			':pk': childPK(Number(childId), tenantId),
			':skPrefix': activityLogDatePrefix(today),
			':cancelled': 0,
		},
		ProjectionExpression: 'activityId',
	});

	return items.map((item) => asActivityId(item.activityId as number));
}

// ============================================================
// Aggregation Queries — for achievement/title/combo services
// ============================================================

/** 子供の活動記録日（重複除去・昇順） */
export async function findDistinctRecordedDates(
	childId: ChildId,
	tenantId: string,
): Promise<{ recordedDate: string }[]> {
	const items = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
		FilterExpression: '#cancelled = :cancelled',
		ExpressionAttributeNames: { '#cancelled': 'cancelled' },
		ExpressionAttributeValues: {
			':pk': childPK(Number(childId), tenantId),
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
export async function countActiveActivityLogs(childId: ChildId, tenantId: string): Promise<number> {
	const items = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
		FilterExpression: '#cancelled = :cancelled',
		ExpressionAttributeNames: { '#cancelled': 'cancelled' },
		ExpressionAttributeValues: {
			':pk': childPK(Number(childId), tenantId),
			':skPrefix': activityLogPrefix(),
			':cancelled': 0,
		},
		ProjectionExpression: 'PK',
	});

	return items.length;
}

/** 日別カテゴリ数を取得（achievement: all_categories 判定用） */
export async function getCategoryCountsByDate(
	childId: ChildId,
	tenantId: string,
): Promise<{ recordedDate: string; categoryCount: number }[]> {
	const items = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
		FilterExpression: '#cancelled = :cancelled',
		ExpressionAttributeNames: { '#cancelled': 'cancelled' },
		ExpressionAttributeValues: {
			':pk': childPK(Number(childId), tenantId),
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
export async function countDistinctCategories(childId: ChildId, tenantId: string): Promise<number> {
	const items = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
		FilterExpression: '#cancelled = :cancelled',
		ExpressionAttributeNames: { '#cancelled': 'cancelled' },
		ExpressionAttributeValues: {
			':pk': childPK(Number(childId), tenantId),
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
	childId: ChildId,
	date: string,
	tenantId: string,
): Promise<{ activityId: ActivityId; categoryId: CategoryId }[]> {
	const items = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
		FilterExpression: '#cancelled = :cancelled',
		ExpressionAttributeNames: { '#cancelled': 'cancelled' },
		ExpressionAttributeValues: {
			':pk': childPK(Number(childId), tenantId),
			':skPrefix': activityLogDatePrefix(date),
			':cancelled': 0,
		},
		ProjectionExpression: 'activityId, categoryId',
	});

	return items.map((item) => ({
		activityId: asActivityId(item.activityId as number),
		categoryId: asCategoryId((item.categoryId as number) ?? 0),
	}));
}

/** コンボボーナス既付与額を取得 — combo-service用 */
export async function getComboPointsGranted(
	childId: ChildId,
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
			':pk': childPK(Number(childId), tenantId),
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
	childId: ChildId,
	categoryId: CategoryId,
	tenantId: string,
): Promise<number> {
	const items = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
		FilterExpression: '#cancelled = :cancelled AND categoryId = :catId',
		ExpressionAttributeNames: { '#cancelled': 'cancelled' },
		ExpressionAttributeValues: {
			':pk': childPK(Number(childId), tenantId),
			':skPrefix': activityLogPrefix(),
			':cancelled': 0,
			':catId': Number(categoryId),
		},
		ProjectionExpression: 'PK',
	});

	return items.length;
}

/** 指定タイプのポイント台帳エントリ数を取得 */
export async function countPointLedgerEntriesByType(
	childId: ChildId,
	type: string,
	tenantId: string,
): Promise<number> {
	const items = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
		FilterExpression: '#type = :type',
		ExpressionAttributeNames: { '#type': 'type' },
		ExpressionAttributeValues: {
			':pk': childPK(Number(childId), tenantId),
			':skPrefix': pointLedgerPrefix(),
			':type': type,
		},
		ProjectionExpression: 'PK',
	});

	return items.length;
}

/** 指定タイプ＋日付のポイント台帳エントリ数を取得 */
export async function countPointLedgerEntriesByTypeAndDate(
	childId: ChildId,
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
			':pk': childPK(Number(childId), tenantId),
			':skPrefix': pointLedgerPrefix(),
			':type': type,
			':date': date,
		},
		ProjectionExpression: 'PK',
	});

	return items.length;
}

// ============================================================
// Point Ledger — #2824 (CRITICAL): ポイント台帳 (記録 → ポイント付与の本経路)
// ============================================================

/**
 * ポイント台帳エントリを挿入する。
 *
 * key: PK=CHILD#<cId>, SK=POINT#<createdAt>#<paddedId> (read 側
 * countPointLedgerEntriesByType / countPointLedgerEntriesByTypeAndDate /
 * getComboPointsGranted が begins_with(SK, 'POINT#…') + type / createdAt / description /
 * amount で読む形式)。createdAt は ISO 文字列 (SQLite schema default の datetime と整合、
 * `countPointLedgerEntriesByTypeAndDate` の begins_with(createdAt, :date) prefix 一致のため
 * `YYYY-MM-DD…` 形式)。SQLite の `pointLedger` insert と機能等価。
 */
export async function insertPointLedger(
	input: InsertPointLedgerInput,
	tenantId: string,
): Promise<void> {
	const id = await nextId(ENTITY_NAMES.pointLedger, tenantId);
	const createdAt = new Date().toISOString();

	const ledgerItem = {
		...pointLedgerKey(Number(input.childId), createdAt, id, tenantId),
		id,
		childId: Number(input.childId),
		amount: input.amount,
		type: input.type,
		description: input.description,
		referenceId: input.referenceId != null ? Number(input.referenceId) : null,
		createdAt,
	};

	// #3284: referenceId 付き付与は冪等 marker (POINTIDEM#<type>#<ref>) の条件付き Put を
	// ledger Put と同一 TransactWriteItems 化し、同一 (child, type, reference) の二重付与を
	// 物理拒否する (SQLite idx_point_ledger_idempotency と機能等価)。referenceId 無しの付与
	// (combo / daily_mission 等) は従来通り単発 Put。
	if (input.referenceId == null) {
		await getDocClient().send(new PutCommand({ TableName: TABLE_NAME, Item: ledgerItem }));
		return;
	}

	try {
		await getDocClient().send(
			new TransactWriteCommand({
				TransactItems: [
					{
						Put: {
							TableName: TABLE_NAME,
							Item: {
								...pointLedgerIdempotencyKey(
									Number(input.childId),
									input.type,
									Number(input.referenceId),
									tenantId,
								),
								ledgerId: id,
								createdAt,
							},
							ConditionExpression: 'attribute_not_exists(PK)',
						},
					},
					{ Put: { TableName: TABLE_NAME, Item: ledgerItem } },
				],
			}),
		);
	} catch (err) {
		const cancellation = (err as { name?: string; CancellationReasons?: Array<{ Code?: string }> })
			?.CancellationReasons;
		const conditionFailed =
			(err as { name?: string })?.name === 'TransactionCanceledException' &&
			(cancellation?.some((r) => r?.Code === 'ConditionalCheckFailed') ?? false);
		if (conditionFailed) {
			// SQLite の UNIQUE 違反 throw と対称。silent no-op にせず呼び出し側へ露出する
			// (冪等 guard 発火 = 上流の二重付与バグの兆候であり、握り潰すと lost signal になる)。
			throw new Error(
				`insertPointLedger: duplicate grant rejected (child=${input.childId}, type=${input.type}, referenceId=${input.referenceId}) #3284`,
			);
		}
		throw err;
	}
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
	childId: ChildId,
	cutoffDate: string,
	tenantId: string,
): Promise<number> {
	const items = await queryAll({
		TableName: TABLE_NAME,
		KeyConditionExpression: 'PK = :pk AND SK BETWEEN :lower AND :upper',
		ExpressionAttributeValues: {
			':pk': childPK(Number(childId), tenantId),
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
	childId: ChildId,
	today: string,
	tenantId: string,
): Promise<{
	logged: number;
	total: number;
	activities: Array<{ id: ActivityId; name: string; icon: string; loggedToday: number }>;
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
			':pk': childPK(Number(childId), tenantId),
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
		loggedToday: loggedSet.has(Number(a.id)) ? 1 : 0,
	}));
	const logged = enriched.filter((a) => a.loggedToday === 1).length;
	return { logged, total: enriched.length, activities: enriched };
}

// #783: archive / restore — #2824: child_activities (per-child) 経由に委譲。
// Phase 7 PR-2a (#2688): reason は ArchivedReason 型 (`ARCHIVED_REASONS` SSOT)。
export async function archiveActivities(
	ids: ActivityId[],
	reason: ArchivedReason,
	tenantId: string,
): Promise<void> {
	return childActivityRepo.archiveActivities(ids, reason, tenantId);
}

export async function restoreArchivedActivities(
	reason: ArchivedReason,
	tenantId: string,
): Promise<void> {
	return childActivityRepo.restoreArchivedActivities(reason, tenantId);
}
