// src/lib/server/db/dynamodb/child-repo.ts
// DynamoDB implementation of IChildRepo

import {
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { ArchivedReason } from '$lib/domain/archive-types';
import type { ChildProgressResetCounts } from '../interfaces/child-repo.interface';
import { hydrate, withVersion } from '../migration';
import { writeBackDynamoDB } from '../migration/writeback';
import type { Child, InsertChildInput, UpdateChildInput } from '../types';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import {
	activityLogPrefix,
	childAchievementPrefix,
	childKey,
	childPK,
	ENTITY_NAMES,
	loginBonusPrefix,
	pointBalanceKey,
	pointLedgerPrefix,
	tenantPK,
} from './keys';
import { batchDeleteItems, queryAllItems, stripKeys } from './repo-helpers';

/** DynamoDB アイテムをマイグレーション（必要なら Write-Back） */
async function hydrateChild(
	item: Record<string, unknown>,
	tenantId: string,
): Promise<Record<string, unknown>> {
	const { data, didMigrate } = hydrate('child', item);
	if (didMigrate) {
		const id = data.id as number;
		await writeBackDynamoDB('child', childKey(id, tenantId), item, data);
	}
	return data;
}

/** 全ての子供を取得 */
export async function findAllChildren(tenantId: string): Promise<Child[]> {
	// Scan for all CHILD#* items with SK=PROFILE
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

	const items = result.Items ?? [];
	const hydrated = await Promise.all(items.map((item) => hydrateChild(item, tenantId)));
	// #783: archive されたリソースをデフォルトで除外
	return hydrated
		.filter((item) => !item.isArchived || item.isArchived === 0)
		.map((item) => stripKeys(item) as unknown as Child);
}

/** userIdで子供を取得（招待紐づけ用） */
export async function findChildByUserId(
	userId: string,
	tenantId: string,
): Promise<Child | undefined> {
	const result = await getDocClient().send(
		new ScanCommand({
			TableName: TABLE_NAME,
			FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk AND userId = :userId',
			ExpressionAttributeValues: {
				':prefix': tenantPK('CHILD#', tenantId),
				':sk': 'PROFILE',
				':userId': userId,
			},
		}),
	);

	const item = result.Items?.[0];
	if (!item) return undefined;
	const data = await hydrateChild(item, tenantId);
	return stripKeys(data) as unknown as Child;
}

/** IDで子供を取得 */
export async function findChildById(id: number, tenantId: string): Promise<Child | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: childKey(id, tenantId),
		}),
	);

	if (!result.Item) return undefined;
	const data = await hydrateChild(result.Item, tenantId);
	return stripKeys(data) as unknown as Child;
}

/** 子供を作成 */
export async function insertChild(input: InsertChildInput, tenantId: string): Promise<Child> {
	const id = await nextId(ENTITY_NAMES.child, tenantId);
	const now = new Date().toISOString();

	const child: Child = {
		id,
		nickname: input.nickname,
		age: input.age,
		birthDate: input.birthDate ?? null,
		theme: input.theme ?? 'pink',
		uiMode: input.uiMode ?? (input.age <= 2 ? 'baby' : 'preschool'),
		uiModeManuallySet: 0,
		avatarUrl: null,
		displayConfig: null,
		userId: null,
		birthdayBonusMultiplier: 1.0,
		lastBirthdayBonusYear: null,
		isArchived: 0,
		archivedReason: null,
		createdAt: now,
		updatedAt: now,
	};

	const versioned = withVersion('child', { ...childKey(id, tenantId), ...child });
	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: versioned,
		}),
	);

	return child;
}

/** 子供を更新 */
export async function updateChild(
	id: number,
	input: UpdateChildInput,
	tenantId: string,
): Promise<Child | undefined> {
	// Build update expression dynamically from provided fields
	const expressionParts: string[] = [];
	const expressionNames: Record<string, string> = {};
	const expressionValues: Record<string, unknown> = {};

	const now = new Date().toISOString();

	// Always update updatedAt
	expressionParts.push('#updatedAt = :updatedAt');
	expressionNames['#updatedAt'] = 'updatedAt';
	expressionValues[':updatedAt'] = now;

	if (input.nickname !== undefined) {
		expressionParts.push('#nickname = :nickname');
		expressionNames['#nickname'] = 'nickname';
		expressionValues[':nickname'] = input.nickname;
	}
	if (input.age !== undefined) {
		expressionParts.push('#age = :age');
		expressionNames['#age'] = 'age';
		expressionValues[':age'] = input.age;
	}
	if (input.theme !== undefined) {
		expressionParts.push('#theme = :theme');
		expressionNames['#theme'] = 'theme';
		expressionValues[':theme'] = input.theme;
	}
	if (input.uiMode !== undefined) {
		expressionParts.push('#uiMode = :uiMode');
		expressionNames['#uiMode'] = 'uiMode';
		expressionValues[':uiMode'] = input.uiMode;
	}
	if (input.uiModeManuallySet !== undefined) {
		expressionParts.push('#uiModeManuallySet = :uiModeManuallySet');
		expressionNames['#uiModeManuallySet'] = 'uiModeManuallySet';
		expressionValues[':uiModeManuallySet'] = input.uiModeManuallySet;
	}
	if (input.birthDate !== undefined) {
		expressionParts.push('#birthDate = :birthDate');
		expressionNames['#birthDate'] = 'birthDate';
		expressionValues[':birthDate'] = input.birthDate;
	}
	if (input.displayConfig !== undefined) {
		expressionParts.push('#displayConfig = :displayConfig');
		expressionNames['#displayConfig'] = 'displayConfig';
		expressionValues[':displayConfig'] = input.displayConfig;
	}
	if (input.userId !== undefined) {
		expressionParts.push('#userId = :userId');
		expressionNames['#userId'] = 'userId';
		expressionValues[':userId'] = input.userId;
	}
	if (input.birthdayBonusMultiplier !== undefined) {
		expressionParts.push('#birthdayBonusMultiplier = :birthdayBonusMultiplier');
		expressionNames['#birthdayBonusMultiplier'] = 'birthdayBonusMultiplier';
		expressionValues[':birthdayBonusMultiplier'] = input.birthdayBonusMultiplier;
	}
	if (input.lastBirthdayBonusYear !== undefined) {
		expressionParts.push('#lastBirthdayBonusYear = :lastBirthdayBonusYear');
		expressionNames['#lastBirthdayBonusYear'] = 'lastBirthdayBonusYear';
		expressionValues[':lastBirthdayBonusYear'] = input.lastBirthdayBonusYear;
	}

	try {
		const result = await getDocClient().send(
			new UpdateCommand({
				TableName: TABLE_NAME,
				Key: childKey(id, tenantId),
				UpdateExpression: `SET ${expressionParts.join(', ')}`,
				ExpressionAttributeNames: expressionNames,
				ExpressionAttributeValues: expressionValues,
				ConditionExpression: 'attribute_exists(PK)',
				ReturnValues: 'ALL_NEW',
			}),
		);

		if (!result.Attributes) return undefined;
		return stripKeys(result.Attributes) as unknown as Child;
	} catch (err: unknown) {
		if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
			return undefined;
		}
		throw err;
	}
}

/** 子供と関連データをすべて削除 */
export async function deleteChild(id: number, tenantId: string): Promise<void> {
	const pk = childPK(id, tenantId);

	// Query all items under the child's partition key
	let lastKey: Record<string, unknown> | undefined;
	const allKeys: Array<{ PK: string; SK: string }> = [];

	do {
		const result = await getDocClient().send(
			new QueryCommand({
				TableName: TABLE_NAME,
				KeyConditionExpression: 'PK = :pk',
				ExpressionAttributeValues: { ':pk': pk },
				ProjectionExpression: 'PK, SK',
				ExclusiveStartKey: lastKey,
			}),
		);

		for (const item of result.Items ?? []) {
			allKeys.push({ PK: item.PK as string, SK: item.SK as string });
		}
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);

	await batchDeleteItems(allKeys);
}

/** #3152: 子供 1 人分の進捗データを削除 (child profile / 関連 master は残す) */
export async function resetChildProgressData(
	id: number,
	tenantId: string,
): Promise<ChildProgressResetCounts> {
	const pk = childPK(id, tenantId);
	// 進捗系 4 entity の SK prefix のみを Query → batch 削除する。
	// #3184 item2: prefix ごとの件数を診断用に集計する (SQLite backend と同 shape)。
	const prefixByEntity: Array<[keyof ChildProgressResetCounts, string]> = [
		['activityLogs', activityLogPrefix()],
		['pointLedger', pointLedgerPrefix()],
		['loginBonuses', loginBonusPrefix()],
		['childAchievements', childAchievementPrefix()],
	];

	const counts: ChildProgressResetCounts = {
		activityLogs: 0,
		pointLedger: 0,
		loginBonuses: 0,
		childAchievements: 0,
		pointBalance: 0,
	};
	const allKeys: Array<{ PK: string; SK: string }> = [];
	for (const [entity, prefix] of prefixByEntity) {
		const items = await queryAllItems(pk, prefix, { projectionExpression: 'PK, SK' });
		counts[entity] = items.length;
		for (const item of items) {
			allKeys.push({ PK: item.PK as string, SK: item.SK as string });
		}
	}

	// POINT# 行のみ消すと、ADD #balance で増分維持される派生集計 (SK=BALANCE) が
	// 取り残され getBalance() が reset 前の残高を返す (SQLite は行集計のため reset 後 0)。
	// deleteByTenantId / deletePointLedgerBeforeDate と同じく BALANCE も明示削除し
	// reset 後の getBalance() を 0 に揃える。
	//
	// 削除保証 (最優先): BALANCE 集計行は**決定的キーで無条件に削除集合へ加える**。
	// 存在確認 query (結果整合 read) の結果に削除を gate すると、stale read-miss 時に
	// BALANCE が残存し getBalance() が reset 前残高を返し続ける (子供が phantom spendable
	// point でごほうび交換できてしまう)。reset の BALANCE clear は不変条件のため、read に
	// 依存させない (ADR-0006 安全 assertion 後退禁止)。
	const balanceKey = pointBalanceKey(id, tenantId);
	allKeys.push(balanceKey);

	// #3475: counts.pointBalance を「実際に存在した BALANCE 行数」(他 entity の count と
	// 同じ実態件数の意味) に揃える診断値。削除保証とは独立に、ConsistentRead GetItem
	// (SK=BALANCE は完全一致のため GetItem が厳密かつ安価) で存在を確認し 0 or 1 を設定する。
	// 削除自体は上の無条件 push で行うため、この read が miss しても BALANCE は削除される。
	const balanceProbe = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: balanceKey,
			ConsistentRead: true,
			ProjectionExpression: 'PK',
		}),
	);
	counts.pointBalance = balanceProbe.Item ? 1 : 0;

	await batchDeleteItems(allKeys);
	return counts;
}

// #783: archive / restore
// Phase 7 PR-2a (#2688): reason は ArchivedReason 型 (`ARCHIVED_REASONS` SSOT)。

export async function archiveChildren(
	ids: number[],
	reason: ArchivedReason,
	tenantId: string,
): Promise<void> {
	for (const id of ids) {
		await getDocClient().send(
			new UpdateCommand({
				TableName: TABLE_NAME,
				Key: childKey(id, tenantId),
				UpdateExpression: 'SET isArchived = :archived, archivedReason = :reason, updatedAt = :now',
				ExpressionAttributeValues: {
					':archived': 1,
					':reason': reason,
					':now': new Date().toISOString(),
				},
			}),
		);
	}
}

export async function restoreArchivedChildren(
	reason: ArchivedReason,
	tenantId: string,
): Promise<void> {
	const result = await getDocClient().send(
		new ScanCommand({
			TableName: TABLE_NAME,
			FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk AND archivedReason = :reason',
			ExpressionAttributeValues: {
				':prefix': tenantPK('CHILD#', tenantId),
				':sk': 'PROFILE',
				':reason': reason,
			},
		}),
	);

	for (const item of result.Items ?? []) {
		await getDocClient().send(
			new UpdateCommand({
				TableName: TABLE_NAME,
				Key: { PK: item.PK, SK: item.SK },
				UpdateExpression: 'SET isArchived = :zero, updatedAt = :now REMOVE archivedReason',
				ExpressionAttributeValues: {
					':zero': 0,
					':now': new Date().toISOString(),
				},
			}),
		);
	}
}

export async function findArchivedChildren(tenantId: string): Promise<Child[]> {
	const result = await getDocClient().send(
		new ScanCommand({
			TableName: TABLE_NAME,
			FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk AND isArchived = :one',
			ExpressionAttributeValues: {
				':prefix': tenantPK('CHILD#', tenantId),
				':sk': 'PROFILE',
				':one': 1,
			},
		}),
	);

	const items = result.Items ?? [];
	const hydrated = await Promise.all(items.map((item) => hydrateChild(item, tenantId)));
	return hydrated.map((item) => stripKeys(item) as unknown as Child);
}
