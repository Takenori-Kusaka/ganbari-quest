// src/lib/server/db/dynamodb/image-repo.ts
// DynamoDB implementation of IImageRepo

import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { CharacterImage, Child, InsertCharacterImageInput } from '../types';
import { TABLE_NAME, getDocClient } from './client';
import { nextId } from './counter';
import { ENTITY_NAMES, characterImageKey, childKey } from './keys';

/** Strip PK/SK/GSI keys from a DynamoDB item */
function stripKeys<T extends Record<string, unknown>>(
	item: T,
): Omit<T, 'PK' | 'SK' | 'GSI2PK' | 'GSI2SK'> {
	const { PK, SK, GSI2PK, GSI2SK, ...rest } = item;
	return rest;
}

/** キャッシュされた画像を取得 */
export async function findCachedImage(
	childId: number,
	type: string,
	promptHash: string,
	tenantId: string,
): Promise<CharacterImage | undefined> {
	const key = characterImageKey(childId, type, promptHash, tenantId);

	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: key,
		}),
	);

	if (!result.Item) return undefined;
	return stripKeys(result.Item) as unknown as CharacterImage;
}

/** 画像レコードを挿入 */
export async function insertCharacterImage(
	input: InsertCharacterImageInput,
	tenantId: string,
): Promise<void> {
	const id = await nextId(ENTITY_NAMES.characterImage, tenantId);
	const now = new Date().toISOString();

	const image: CharacterImage = {
		id,
		childId: input.childId,
		type: input.type,
		filePath: input.filePath,
		promptHash: input.promptHash,
		generatedAt: now,
	};

	const key = characterImageKey(input.childId, input.type, input.promptHash, tenantId);

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...key,
				...image,
			},
		}),
	);
}

/** 子供のアバターURLを更新 */
export async function updateChildAvatarUrl(
	childId: number,
	avatarUrl: string,
	tenantId: string,
): Promise<void> {
	const now = new Date().toISOString();

	await getDocClient().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: childKey(childId, tenantId),
			UpdateExpression: 'SET #avatarUrl = :avatarUrl, #updatedAt = :updatedAt',
			ExpressionAttributeNames: {
				'#avatarUrl': 'avatarUrl',
				'#updatedAt': 'updatedAt',
			},
			ExpressionAttributeValues: {
				':avatarUrl': avatarUrl,
				':updatedAt': now,
			},
		}),
	);
}

/** 子供情報を取得 */
export async function findChildForImage(
	childId: number,
	tenantId: string,
): Promise<Child | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: childKey(childId, tenantId),
		}),
	);

	if (!result.Item) return undefined;
	return stripKeys(result.Item) as unknown as Child;
}
