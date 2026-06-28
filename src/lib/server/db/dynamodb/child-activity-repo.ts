// src/lib/server/db/dynamodb/child-activity-repo.ts
// per-child activity instance repository — DynamoDB 本実装 (ADR-0055)
//
// IChildActivityRepo (child-activity-repo.interface.ts) を SQLite 実装
// (sqlite/child-activity-repo.ts、挙動 SSOT) と機能等価に DynamoDB single-table で実装する。
//
// 経緯: PR #2455 (#2362 PR-3) で導入された stub が #2263 hotfix で「read=空返却 /
//   write=throw」化された。当時の「write 経路は本番に到達しない」仮定は marketplace の
//   per-child 取込 (importActivities → dispatchPerChildBulk → insertActivitiesBulk) で破れ、
//   本番 cognito Lambda (AUTH_MODE=cognito + DATA_SOURCE=dynamodb) で取込が永続せず、
//   UI が「N 件登録しました」と偽る CRITICAL バグの一因となった。本実装で根治する。
//
// key 設計 (keys.ts §childActivityKey):
//   PK = T#<tenantId>#CHILD#<childId>   (child partition、activity_logs 等と同居)
//   SK = CHILDACT#<paddedId>            (8 桁 0 埋め、辞書順)
//   → findActivitiesByChild は単一 partition Query で完結し GSI 不要 (ADR-0055 §3.1)。
//
// 関連: ADR-0055 / docs/design/08-データベース設計書.md / sqlite/child-activity-repo.ts (SSOT)

import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { ArchivedReason } from '$lib/domain/archive-types';
import type {
	Child,
	ChildActivity,
	InsertChildActivityInput,
	UpdateChildActivityInput,
} from '../types';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import { childActivityKey, childActivityPrefix, childPK, ENTITY_NAMES, tenantPK } from './keys';
import { findChildByIdRaw, queryAllItems, stripKeys } from './repo-helpers';

const PREFIX = childActivityPrefix();

/**
 * DynamoDB item を ChildActivity に正規化する。
 * SQLite の schema default と整合させるため、欠落しうる属性を補完する
 * (旧データ / 部分書込みへの防御。本実装の write は常に全属性を埋める)。
 */
function toChildActivity(item: Record<string, unknown>): ChildActivity {
	const stripped = stripKeys(item) as unknown as ChildActivity;
	// priority backfill (SQLite schema default 'optional' と整合)
	if (stripped.priority !== 'must' && stripped.priority !== 'optional') {
		stripped.priority = 'optional';
	}
	return stripped;
}

// ============================================================
// findActivitiesByChild — 指定 child の activity 一覧 (child partition Query)
// ============================================================

export async function findActivitiesByChild(
	childId: number,
	tenantId: string,
	options?: { includeArchived?: boolean; visibleOnly?: boolean },
): Promise<ChildActivity[]> {
	const items = await queryAllItems(childPK(childId, tenantId), PREFIX);
	let activities = items.map(toChildActivity);

	// archive filter (SQLite: NULL 互換 — NULL/0 は active 扱い、#962 教訓)
	if (!options?.includeArchived) {
		activities = activities.filter((a) => !a.isArchived || a.isArchived === 0);
	}

	if (options?.visibleOnly) {
		activities = activities.filter((a) => a.isVisible === 1);
	}

	// SQLite は ORDER BY sort_order。in-memory で同順に揃える。
	activities.sort((a, b) => a.sortOrder - b.sortOrder);
	return activities;
}

// ============================================================
// findActivityById — id + child + tenant 3 軸取得 (GetItem)
// ============================================================

export async function findActivityById(
	id: number,
	childId: number,
	tenantId: string,
): Promise<ChildActivity | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: childActivityKey(childId, id, tenantId),
		}),
	);
	if (!result.Item) return undefined;
	return toChildActivity(result.Item);
}

// ============================================================
// countMainQuestActivities — per-child main quest 数
// ============================================================

export async function countMainQuestActivities(childId: number, tenantId: string): Promise<number> {
	// SQLite: isMainQuest=1 AND isVisible=1 AND (isArchived=0 OR NULL)
	const activities = await findActivitiesByChild(childId, tenantId, { visibleOnly: true });
	return activities.filter((a) => a.isMainQuest === 1).length;
}

// ============================================================
// insertActivity — per-child instance 新規作成
// ============================================================

/**
 * 1 件の ChildActivity を組み立てる (DynamoDB item にも返り値にも同じ shape を使う)。
 * SQLite schema default (sortOrder=0 / isVisible=1 / source='seed' / dailyLimit=null /
 * nameKana=null / nameKanji=null / isMainQuest=0 / isArchived=0 / priority='optional')
 * を明示的に埋め、insertActivity の返り値が SQLite の `.returning()` と等価になるようにする。
 */
function buildChildActivity(
	id: number,
	input: InsertChildActivityInput,
	createdAt: string,
): ChildActivity {
	return {
		id,
		childId: input.childId,
		name: input.name,
		categoryId: input.categoryId,
		icon: input.icon,
		basePoints: input.basePoints,
		// #3358: round-trip 復元時の表示状態 / 並び順 / アーカイブ状態を保全 (省略時 schema default)
		isVisible: input.isVisible ?? 1,
		dailyLimit: null,
		sortOrder: input.sortOrder ?? 0,
		source: 'seed',
		nameKana: null,
		nameKanji: null,
		triggerHint: input.triggerHint ?? null,
		isMainQuest: input.isMainQuest ?? 0,
		isArchived: input.isArchived ?? 0,
		archivedReason: input.archivedReason ?? null,
		createdAt,
		sourcePresetId: input.sourcePresetId ?? null,
		priority: input.priority ?? 'optional',
	};
}

export async function insertActivity(
	input: InsertChildActivityInput,
	tenantId: string,
): Promise<ChildActivity> {
	const id = await nextId(ENTITY_NAMES.childActivity, tenantId);
	const activity = buildChildActivity(id, input, new Date().toISOString());

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...childActivityKey(input.childId, id, tenantId),
				...activity,
			},
		}),
	);

	return activity;
}

// ============================================================
// insertActivitiesBulk — 一括作成 (取込時 per-child 配信)
// ============================================================

export async function insertActivitiesBulk(
	inputs: InsertChildActivityInput[],
	tenantId: string,
): Promise<ChildActivity[]> {
	if (inputs.length === 0) return [];
	// SQLite 実装と同じく直列 insert (driver 側 transaction batching 相当)。
	// id 採番が atomic counter のため BatchWrite ではなく順次 Put。
	const results: ChildActivity[] = [];
	for (const input of inputs) {
		const row = await insertActivity(input, tenantId);
		results.push(row);
	}
	return results;
}

// ============================================================
// updateActivity — child scope 更新 (条件付き UpdateItem)
// ============================================================

export async function updateActivity(
	id: number,
	childId: number,
	input: UpdateChildActivityInput,
	tenantId: string,
): Promise<ChildActivity | undefined> {
	const fields = [
		'name',
		'categoryId',
		'icon',
		'basePoints',
		'triggerHint',
		'isMainQuest',
		'priority',
	] as const;

	const sets: string[] = [];
	const names: Record<string, string> = {};
	const values: Record<string, unknown> = {};
	for (const field of fields) {
		if (input[field] !== undefined) {
			sets.push(`#${field} = :${field}`);
			names[`#${field}`] = field;
			values[`:${field}`] = input[field];
		}
	}

	// 更新対象がない場合は SQLite (.set({})) と同様、現在値をそのまま返す。
	if (sets.length === 0) {
		return findActivityById(id, childId, tenantId);
	}

	try {
		const result = await getDocClient().send(
			new UpdateCommand({
				TableName: TABLE_NAME,
				Key: childActivityKey(childId, id, tenantId),
				UpdateExpression: `SET ${sets.join(', ')}`,
				ExpressionAttributeNames: names,
				ExpressionAttributeValues: values,
				// 存在しない (= 別 child / 不在) なら更新せず undefined を返す。
				ConditionExpression: 'attribute_exists(PK)',
				ReturnValues: 'ALL_NEW',
			}),
		);
		if (!result.Attributes) return undefined;
		return toChildActivity(result.Attributes);
	} catch (e) {
		if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
			return undefined;
		}
		throw e;
	}
}

// ============================================================
// setActivityVisibility
// ============================================================

export async function setActivityVisibility(
	id: number,
	childId: number,
	visible: boolean,
	tenantId: string,
): Promise<ChildActivity | undefined> {
	try {
		const result = await getDocClient().send(
			new UpdateCommand({
				TableName: TABLE_NAME,
				Key: childActivityKey(childId, id, tenantId),
				UpdateExpression: 'SET isVisible = :v',
				ExpressionAttributeValues: { ':v': visible ? 1 : 0 },
				ConditionExpression: 'attribute_exists(PK)',
				ReturnValues: 'ALL_NEW',
			}),
		);
		if (!result.Attributes) return undefined;
		return toChildActivity(result.Attributes);
	} catch (e) {
		if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
			return undefined;
		}
		throw e;
	}
}

// ============================================================
// deleteActivity — child scope 削除 (返り値は削除前 row)
// ============================================================

export async function deleteActivity(
	id: number,
	childId: number,
	tenantId: string,
): Promise<ChildActivity | undefined> {
	const result = await getDocClient().send(
		new DeleteCommand({
			TableName: TABLE_NAME,
			Key: childActivityKey(childId, id, tenantId),
			// SQLite `.returning()` 等価: 削除した行を返す。
			ReturnValues: 'ALL_OLD',
		}),
	);
	if (!result.Attributes) return undefined;
	return toChildActivity(result.Attributes);
}

// ============================================================
// copyActivitiesAcrossChildren — 兄弟共通化 (User §1)
// ============================================================

export async function copyActivitiesAcrossChildren(
	sourceChildId: number,
	targetChildId: number,
	tenantId: string,
): Promise<ChildActivity[]> {
	const sourceActivities = await findActivitiesByChild(sourceChildId, tenantId, {
		includeArchived: false,
		visibleOnly: false,
	});
	if (sourceActivities.length === 0) return [];

	const inputs: InsertChildActivityInput[] = sourceActivities.map((a) => ({
		childId: targetChildId,
		name: a.name,
		categoryId: a.categoryId,
		icon: a.icon,
		basePoints: a.basePoints,
		triggerHint: a.triggerHint,
		isMainQuest: a.isMainQuest,
		sourcePresetId: a.sourcePresetId,
		priority: a.priority,
	}));

	return insertActivitiesBulk(inputs, tenantId);
}

// ============================================================
// archive / restore (#783)
// Phase 7 PR-2a (#2688): reason は ArchivedReason 型 (`ARCHIVED_REASONS` SSOT)。
// ============================================================

/**
 * 指定 id 群を archive する。child を跨ぐ可能性があるため、id ごとに
 * inverted-index lookup を避けるよう tenant 配下を Scan して PK/SK を解決する。
 * (ids 件数は通常少数 — プラン降格時の must/optional 整理。Pre-PMF / ADR-0010)。
 */
export async function archiveActivities(
	ids: number[],
	reason: ArchivedReason,
	tenantId: string,
): Promise<void> {
	if (ids.length === 0) return;
	const targets = await findChildActivityKeysByIds(ids, tenantId);
	for (const key of targets) {
		await getDocClient().send(
			new UpdateCommand({
				TableName: TABLE_NAME,
				Key: key,
				UpdateExpression: 'SET isArchived = :one, archivedReason = :reason',
				ExpressionAttributeValues: { ':one': 1, ':reason': reason },
			}),
		);
	}
}

export async function restoreArchivedActivities(
	reason: ArchivedReason,
	tenantId: string,
): Promise<void> {
	const targets = await findChildActivityKeysByReason(reason, tenantId);
	for (const key of targets) {
		await getDocClient().send(
			new UpdateCommand({
				TableName: TABLE_NAME,
				Key: key,
				UpdateExpression: 'SET isArchived = :zero REMOVE archivedReason',
				ExpressionAttributeValues: { ':zero': 0 },
			}),
		);
	}
}

// ============================================================
// archive helpers — tenant 配下の CHILDACT# を Scan で解決
// ============================================================
//
// child_activities は child partition (PK=CHILD#<cId>) に分散するため、id / reason での
// 横断検索は GSI なしでは Scan が必要。archive / restore は低頻度 (プラン降格時のみ) の
// ため Pre-PMF (ADR-0010) では Scan + 属性フィルタで十分。GSI 追加は過剰防衛。

async function scanChildActivities(
	extraFilter: string,
	extraValues: Record<string, unknown>,
): Promise<{ PK: string; SK: string }[]> {
	const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
	const keys: { PK: string; SK: string }[] = [];
	let lastKey: Record<string, unknown> | undefined;
	do {
		const result = await getDocClient().send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression: `begins_with(SK, :skPrefix)${extraFilter}`,
				ExpressionAttributeValues: { ':skPrefix': PREFIX, ...extraValues },
				ProjectionExpression: 'PK, SK',
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of result.Items ?? []) {
			keys.push({ PK: item.PK as string, SK: item.SK as string });
		}
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);
	return keys;
}

async function findChildActivityKeysByIds(
	ids: number[],
	tenantId: string,
): Promise<{ PK: string; SK: string }[]> {
	const idSet = new Set(ids);
	const all = await scanChildActivities(' AND begins_with(PK, :tenantPrefix)', {
		':tenantPrefix': tenantPK('CHILD#', tenantId),
	});
	// id は SK = CHILDACT#<paddedId> から復元 (Scan 結果は PK/SK のみ projection)。
	return all.filter((k) => idSet.has(Number(k.SK.replace('CHILDACT#', ''))));
}

async function findChildActivityKeysByReason(
	reason: ArchivedReason,
	tenantId: string,
): Promise<{ PK: string; SK: string }[]> {
	return scanChildActivities(' AND begins_with(PK, :tenantPrefix) AND archivedReason = :reason', {
		':tenantPrefix': tenantPK('CHILD#', tenantId),
		':reason': reason,
	});
}

// ============================================================
// Child convenience lookup (repo-helpers の共通実装に委譲)
// ============================================================

export async function findChildById(id: number, tenantId: string): Promise<Child | undefined> {
	return findChildByIdRaw(id, tenantId);
}
