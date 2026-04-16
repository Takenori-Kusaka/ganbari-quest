// src/lib/server/db/dynamodb/repo-helpers.ts
// DynamoDB repo 層の共通ヘルパ (#983)
// - stripKeys: PK/SK/GSI キーの除去
// - queryAllItems: ページネーション付きクエリ
// - batchDeleteItems: 25 件ずつの BatchWrite 削除
// - findChildByIdRaw: 子供プロフィールの直接取得(hydration なし)

import { BatchWriteCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { Child } from '../types';
import { getDocClient, TABLE_NAME } from './client';
import { childKey } from './keys';

const BATCH_SIZE = 25;

/**
 * DynamoDB アイテムから PK/SK/GSI キーを除去して純粋なエンティティデータを返す。
 * 全 repo で同一の実装が重複していたものを共通化。
 */
export function stripKeys<T extends Record<string, unknown>>(
	item: T,
): Omit<T, 'PK' | 'SK' | 'GSI2PK' | 'GSI2SK'> {
	const { PK, SK, GSI2PK, GSI2SK, ...rest } = item;
	return rest;
}

/**
 * PK + SK prefix でクエリし、ページネーションを自動処理して全アイテムを返す。
 * evaluation-repo / status-repo / login-bonus-repo 等で重複していたパターンを共通化。
 */
export async function queryAllItems(
	pk: string,
	skPrefix: string,
	opts?: {
		filterExpression?: string;
		expressionAttributeNames?: Record<string, string>;
		expressionAttributeValues?: Record<string, unknown>;
		projectionExpression?: string;
	},
): Promise<Record<string, unknown>[]> {
	const doc = getDocClient();
	const items: Record<string, unknown>[] = [];
	let lastKey: Record<string, unknown> | undefined;

	do {
		const result = await doc.send(
			new QueryCommand({
				TableName: TABLE_NAME,
				KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
				FilterExpression: opts?.filterExpression,
				ExpressionAttributeNames: opts?.expressionAttributeNames,
				ExpressionAttributeValues: {
					':pk': pk,
					':prefix': skPrefix,
					...opts?.expressionAttributeValues,
				},
				ProjectionExpression: opts?.projectionExpression,
				ExclusiveStartKey: lastKey,
			}),
		);

		for (const item of result.Items ?? []) {
			items.push(item);
		}
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);

	return items;
}

/**
 * PK/SK キーの配列を 25 件ずつ BatchWriteCommand で削除する。
 * login-bonus-repo / point-repo / child-repo で重複していた BatchWrite ループを共通化。
 */
export async function batchDeleteItems(
	keys: Array<{ PK: string; SK: string }>,
): Promise<number> {
	const doc = getDocClient();

	for (let i = 0; i < keys.length; i += BATCH_SIZE) {
		const chunk = keys.slice(i, i + BATCH_SIZE);
		await doc.send(
			new BatchWriteCommand({
				RequestItems: {
					[TABLE_NAME]: chunk.map((key) => ({
						DeleteRequest: { Key: key },
					})),
				},
			}),
		);
	}

	return keys.length;
}

/**
 * 子供プロフィールを直接取得する（hydration なし）。
 * evaluation-repo / login-bonus-repo / point-repo / daily-mission-repo / image-repo で
 * 各 repo が独自に findChildById を定義していた重複を解消。
 *
 * Note: child-repo.ts の findChildById は hydration + write-back を含むため別物。
 * この関数は簡易的な存在確認用途。
 */
export async function findChildByIdRaw(
	id: number,
	tenantId: string,
): Promise<Child | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: childKey(id, tenantId),
		}),
	);

	if (!result.Item) return undefined;
	return stripKeys(result.Item) as unknown as Child;
}
