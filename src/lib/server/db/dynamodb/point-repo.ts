// src/lib/server/db/dynamodb/point-repo.ts
// DynamoDB implementation of IPointRepo

import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Child, InsertPointLedgerInput, PointLedgerEntry } from '../types';
import { deleteItemsByPkPrefix } from './bulk-delete';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import {
	childKey,
	childPK,
	ENTITY_NAMES,
	pointBalanceKey,
	pointLedgerKey,
	pointLedgerPrefix,
	tenantPK,
} from './keys';

/** Strip PK/SK/GSI keys from a DynamoDB item */
function stripKeys<T extends Record<string, unknown>>(
	item: T,
): Omit<T, 'PK' | 'SK' | 'GSI2PK' | 'GSI2SK'> {
	const { PK, SK, GSI2PK, GSI2SK, ...rest } = item;
	return rest;
}

/** ポイント残高を取得 */
export async function getBalance(childId: number, tenantId: string): Promise<number> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: pointBalanceKey(childId, tenantId),
		}),
	);

	return (result.Item?.balance as number) ?? 0;
}

/** ポイント履歴を取得（降順） */
export async function findPointHistory(
	childId: number,
	options: { limit: number; offset: number },
	tenantId: string,
): Promise<PointLedgerEntry[]> {
	const pk = childPK(childId, tenantId);
	const prefix = pointLedgerPrefix();

	// For offset, we need to skip items. Query with larger limit then slice.
	const totalNeeded = options.limit + options.offset;

	const items: PointLedgerEntry[] = [];
	let lastKey: Record<string, unknown> | undefined;

	do {
		const result = await getDocClient().send(
			new QueryCommand({
				TableName: TABLE_NAME,
				KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
				ExpressionAttributeValues: {
					':pk': pk,
					':prefix': prefix,
				},
				ScanIndexForward: false, // descending order (newest first)
				Limit: totalNeeded - items.length,
				ExclusiveStartKey: lastKey,
			}),
		);

		for (const item of result.Items ?? []) {
			items.push(stripKeys(item) as unknown as PointLedgerEntry);
		}
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey && items.length < totalNeeded);

	// Apply offset and limit
	return items.slice(options.offset, options.offset + options.limit);
}

/** ポイント台帳にエントリを挿入 + 残高を更新 */
export async function insertPointEntry(
	input: InsertPointLedgerInput,
	tenantId: string,
): Promise<PointLedgerEntry> {
	const id = await nextId(ENTITY_NAMES.pointLedger, tenantId);
	const now = new Date().toISOString();

	const entry: PointLedgerEntry = {
		id,
		childId: input.childId,
		amount: input.amount,
		type: input.type,
		description: input.description ?? null,
		referenceId: input.referenceId ?? null,
		createdAt: now,
	};

	const key = pointLedgerKey(input.childId, now, id, tenantId);

	// Put the ledger entry
	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...key,
				...entry,
			},
		}),
	);

	// Atomically update the balance
	await getDocClient().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: pointBalanceKey(input.childId, tenantId),
			UpdateExpression: 'ADD #balance :amount',
			ExpressionAttributeNames: { '#balance': 'balance' },
			ExpressionAttributeValues: { ':amount': input.amount },
		}),
	);

	return entry;
}

/** 子供の存在確認 */
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

/** テナントの全ポイント台帳・残高を削除（CHILD#* 配下の POINT# + BALANCE アイテム） */
export async function deleteByTenantId(tenantId: string): Promise<void> {
	// Delete point ledger entries (POINT#...)
	await deleteItemsByPkPrefix(tenantPK('CHILD#', tenantId), pointLedgerPrefix());
	// Delete balance records (BALANCE)
	await deleteItemsByPkPrefix(tenantPK('CHILD#', tenantId), 'BALANCE');
}
