// src/lib/server/db/dynamodb/avatar-repo.ts
// DynamoDB implementation of IAvatarRepo

import type { AvatarCategory } from '$lib/domain/validation/avatar';
import {
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { AvatarItem, ChildAvatarItem } from '../types';
import { TABLE_NAME, getDocClient } from './client';
import { nextId } from './counter';
import {
	ENTITY_NAMES,
	avatarItemKey,
	childAvatarItemKey,
	childAvatarItemPrefix,
	childKey,
	childPK,
} from './keys';

/** Strip PK/SK/GSI keys from a DynamoDB item */
function stripKeys<T extends Record<string, unknown>>(
	item: T,
): Omit<T, 'PK' | 'SK' | 'GSI2PK' | 'GSI2SK'> {
	const { PK, SK, GSI2PK, GSI2SK, ...rest } = item;
	return rest;
}

/** 全アイテムマスタを取得 */
export async function findAllAvatarItems(): Promise<AvatarItem[]> {
	const result = await getDocClient().send(
		new ScanCommand({
			TableName: TABLE_NAME,
			FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk AND #isActive = :active',
			ExpressionAttributeNames: { '#isActive': 'isActive' },
			ExpressionAttributeValues: {
				':prefix': 'AVITEM#',
				':sk': 'MASTER',
				':active': 1,
			},
		}),
	);

	const items = (result.Items ?? []).map((item) => stripKeys(item) as unknown as AvatarItem);
	// Sort by category then sortOrder to match SQLite behavior
	items.sort((a, b) => {
		if (a.category < b.category) return -1;
		if (a.category > b.category) return 1;
		return a.sortOrder - b.sortOrder;
	});
	return items;
}

/** カテゴリ別アイテム取得 */
export async function findAvatarItemsByCategory(category: AvatarCategory): Promise<AvatarItem[]> {
	const result = await getDocClient().send(
		new ScanCommand({
			TableName: TABLE_NAME,
			FilterExpression:
				'begins_with(PK, :prefix) AND SK = :sk AND #isActive = :active AND #category = :category',
			ExpressionAttributeNames: {
				'#isActive': 'isActive',
				'#category': 'category',
			},
			ExpressionAttributeValues: {
				':prefix': 'AVITEM#',
				':sk': 'MASTER',
				':active': 1,
				':category': category,
			},
		}),
	);

	const items = (result.Items ?? []).map((item) => stripKeys(item) as unknown as AvatarItem);
	items.sort((a, b) => a.sortOrder - b.sortOrder);
	return items;
}

/** アイテム単体取得 */
export async function findAvatarItemById(itemId: number): Promise<AvatarItem | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: avatarItemKey(itemId),
		}),
	);

	if (!result.Item) return undefined;
	return stripKeys(result.Item) as unknown as AvatarItem;
}

/** 子供の所持アイテム一覧 */
export async function findOwnedItems(
	childId: number,
): Promise<{ avatarItemId: number; acquiredAt: string }[]> {
	const pk = childPK(childId);
	const prefix = childAvatarItemPrefix();

	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': pk,
				':prefix': prefix,
			},
			ProjectionExpression: 'avatarItemId, acquiredAt',
		}),
	);

	return (result.Items ?? []).map((item) => ({
		avatarItemId: item.avatarItemId as number,
		acquiredAt: item.acquiredAt as string,
	}));
}

/** 所持チェック */
export async function isItemOwned(childId: number, itemId: number): Promise<boolean> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: childAvatarItemKey(childId, itemId),
			ProjectionExpression: 'id',
		}),
	);

	return !!result.Item;
}

/** アイテム付与 */
export async function insertChildAvatarItem(
	childId: number,
	itemId: number,
): Promise<ChildAvatarItem> {
	const id = await nextId(ENTITY_NAMES.childAvatarItem);
	const now = new Date().toISOString();

	const childItem: ChildAvatarItem = {
		id,
		childId,
		avatarItemId: itemId,
		acquiredAt: now,
	};

	const key = childAvatarItemKey(childId, itemId);

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...key,
				...childItem,
			},
		}),
	);

	return childItem;
}

/** 装備中のアバター設定を取得 */
export async function getActiveAvatarIds(
	childId: number,
): Promise<{ bgId: number | null; frameId: number | null; effectId: number | null }> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: childKey(childId),
			ProjectionExpression: 'activeAvatarBg, activeAvatarFrame, activeAvatarEffect',
		}),
	);

	return {
		bgId: (result.Item?.activeAvatarBg as number | null) ?? null,
		frameId: (result.Item?.activeAvatarFrame as number | null) ?? null,
		effectId: (result.Item?.activeAvatarEffect as number | null) ?? null,
	};
}

/** 装備変更 */
export async function setActiveAvatar(
	childId: number,
	category: AvatarCategory,
	itemId: number | null,
): Promise<void> {
	const fieldMap: Record<AvatarCategory, string> = {
		background: 'activeAvatarBg',
		frame: 'activeAvatarFrame',
		effect: 'activeAvatarEffect',
	};
	const field = fieldMap[category];

	await getDocClient().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: childKey(childId),
			UpdateExpression: 'SET #field = :value',
			ExpressionAttributeNames: { '#field': field },
			ExpressionAttributeValues: { ':value': itemId },
		}),
	);
}
