// src/lib/server/db/dynamodb/child-repo.ts
// DynamoDB implementation of IChildRepo

import {
	BatchWriteCommand,
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Child, InsertChildInput, UpdateChildInput } from '../types';
import { TABLE_NAME, getDocClient } from './client';
import { nextId } from './counter';
import { ENTITY_NAMES, childKey, childPK, tenantPK } from './keys';

/** Strip PK/SK/GSI keys from a DynamoDB item */
function stripKeys<T extends Record<string, unknown>>(
	item: T,
): Omit<T, 'PK' | 'SK' | 'GSI2PK' | 'GSI2SK'> {
	const { PK, SK, GSI2PK, GSI2SK, ...rest } = item;
	return rest;
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
	return items.map((item) => stripKeys(item) as unknown as Child);
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
	return stripKeys(item) as unknown as Child;
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
	return stripKeys(result.Item) as unknown as Child;
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
		uiMode: input.uiMode ?? (input.age <= 2 ? 'baby' : 'kinder'),
		avatarUrl: null,
		activeTitleId: null,
		displayConfig: null,
		userId: null,
		createdAt: now,
		updatedAt: now,
	};

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...childKey(id, tenantId),
				...child,
			},
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

	// Batch delete in chunks of 25 (DynamoDB limit)
	const BATCH_SIZE = 25;
	for (let i = 0; i < allKeys.length; i += BATCH_SIZE) {
		const batch = allKeys.slice(i, i + BATCH_SIZE);
		await getDocClient().send(
			new BatchWriteCommand({
				RequestItems: {
					[TABLE_NAME]: batch.map((key) => ({
						DeleteRequest: { Key: key },
					})),
				},
			}),
		);
	}
}
