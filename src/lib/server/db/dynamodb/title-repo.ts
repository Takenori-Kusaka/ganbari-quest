// src/lib/server/db/dynamodb/title-repo.ts
// DynamoDB implementation of ITitleRepo

import {
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { ChildTitle, Title } from '../types';
import { TABLE_NAME, getDocClient } from './client';
import { nextId } from './counter';
import { ENTITY_NAMES, childKey, childPK, childTitleKey, childTitlePrefix, titleKey } from './keys';

/** Strip PK/SK/GSI keys from a DynamoDB item */
function stripKeys<T extends Record<string, unknown>>(
	item: T,
): Omit<T, 'PK' | 'SK' | 'GSI2PK' | 'GSI2SK'> {
	const { PK, SK, GSI2PK, GSI2SK, ...rest } = item;
	return rest;
}

/** 全称号マスタを取得 */
export async function findAllTitles(_tenantId: string): Promise<Title[]> {
	const result = await getDocClient().send(
		new ScanCommand({
			TableName: TABLE_NAME,
			FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
			ExpressionAttributeValues: {
				':prefix': 'TITLE#',
				':sk': 'MASTER',
			},
		}),
	);

	return (result.Items ?? []).map((item) => stripKeys(item) as unknown as Title);
}

/** IDで称号を取得 */
export async function findTitleById(id: number, _tenantId: string): Promise<Title | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: titleKey(id),
		}),
	);

	if (!result.Item) return undefined;
	return stripKeys(result.Item) as unknown as Title;
}

/** 子供の解除済み称号を取得 */
export async function findUnlockedTitles(
	childId: number,
	tenantId: string,
): Promise<{ titleId: number; unlockedAt: string }[]> {
	const pk = childPK(childId, tenantId);
	const prefix = childTitlePrefix();

	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': pk,
				':prefix': prefix,
			},
			ProjectionExpression: 'titleId, unlockedAt',
		}),
	);

	return (result.Items ?? []).map((item) => ({
		titleId: item.titleId as number,
		unlockedAt: item.unlockedAt as string,
	}));
}

/** 特定の称号が解除済みか確認 */
export async function isTitleUnlocked(
	childId: number,
	titleId: number,
	tenantId: string,
): Promise<boolean> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: childTitleKey(childId, titleId, tenantId),
			ProjectionExpression: 'id',
		}),
	);

	return !!result.Item;
}

/** 称号解除を記録 */
export async function insertChildTitle(
	childId: number,
	titleId: number,
	tenantId: string,
): Promise<ChildTitle> {
	const id = await nextId(ENTITY_NAMES.childTitle, tenantId);
	const now = new Date().toISOString();

	const childTitle: ChildTitle = {
		id,
		childId,
		titleId,
		unlockedAt: now,
	};

	const key = childTitleKey(childId, titleId, tenantId);

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...key,
				...childTitle,
			},
		}),
	);

	return childTitle;
}

/** アクティブ称号IDを取得 */
export async function getActiveTitleId(childId: number, tenantId: string): Promise<number | null> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: childKey(childId, tenantId),
			ProjectionExpression: 'activeTitleId',
		}),
	);

	return (result.Item?.activeTitleId as number | null) ?? null;
}

/** アクティブ称号を設定（nullで解除） */
export async function setActiveTitleId(
	childId: number,
	titleId: number | null,
	tenantId: string,
): Promise<void> {
	await getDocClient().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: childKey(childId, tenantId),
			UpdateExpression: 'SET #activeTitleId = :titleId',
			ExpressionAttributeNames: { '#activeTitleId': 'activeTitleId' },
			ExpressionAttributeValues: { ':titleId': titleId },
		}),
	);
}
