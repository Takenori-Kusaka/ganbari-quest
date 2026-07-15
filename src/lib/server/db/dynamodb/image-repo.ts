// src/lib/server/db/dynamodb/image-repo.ts
// DynamoDB implementation of IImageRepo

import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { ChildId } from '$lib/domain/ids';
import { asChildId } from '$lib/domain/ids';
import type { CharacterImage, InsertCharacterImageInput } from '../types';
import { deleteChildScopedItems } from './bulk-delete';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import { characterImageKey, characterImagePrefix, childKey, ENTITY_NAMES, tenantPK } from './keys';
import { stripKeys } from './repo-helpers';

// biome-ignore lint/performance/noBarrelFile: 後方互換 re-export のため維持、削除は別 Issue で検討
export { findChildByIdRaw as findChildForImage } from './repo-helpers';

/** キャッシュされた画像を取得 */
export async function findCachedImage(
	childId: ChildId,
	type: string,
	promptHash: string,
	tenantId: string,
): Promise<CharacterImage | undefined> {
	const key = characterImageKey(Number(childId), type, promptHash, tenantId);

	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: key,
		}),
	);

	if (!result.Item) return undefined;
	const raw = stripKeys(result.Item) as unknown as Omit<CharacterImage, 'id' | 'childId'> & {
		id: number;
		childId: number;
	};
	return { ...raw, id: String(raw.id), childId: asChildId(raw.childId) };
}

/** 画像レコードを挿入 */
export async function insertCharacterImage(
	input: InsertCharacterImageInput,
	tenantId: string,
): Promise<void> {
	const id = await nextId(ENTITY_NAMES.characterImage, tenantId);
	const now = new Date().toISOString();

	const image: CharacterImage = {
		id: String(id),
		childId: input.childId,
		type: input.type,
		filePath: input.filePath,
		promptHash: input.promptHash,
		generatedAt: now,
	};

	const key = characterImageKey(Number(input.childId), input.type, input.promptHash, tenantId);

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...key,
				...image,
				// stored attributes は数値 id のまま (storage format 不変、#3575)
				id,
				childId: Number(input.childId),
			},
		}),
	);
}

/** 子供のアバターURLを更新 */
export async function updateChildAvatarUrl(
	childId: ChildId,
	avatarUrl: string | null,
	tenantId: string,
): Promise<void> {
	const now = new Date().toISOString();

	await getDocClient().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: childKey(Number(childId), tenantId),
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

/** テナントの全キャラクター画像レコードを削除（CHILD#* 配下の IMG# アイテム） */
export async function deleteByTenantId(
	tenantId: string,
	childIds?: readonly ChildId[],
): Promise<void> {
	await deleteChildScopedItems(tenantId, childIds, characterImagePrefix());
}
