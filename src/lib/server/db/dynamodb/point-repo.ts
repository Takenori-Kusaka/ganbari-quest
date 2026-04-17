// src/lib/server/db/dynamodb/point-repo.ts
// DynamoDB implementation of IPointRepo

import {
	BatchWriteCommand,
	GetCommand,
	PutCommand,
	QueryCommand,
	UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { InsertPointLedgerInput, PointLedgerEntry } from '../types';
import { deleteItemsByPkPrefix } from './bulk-delete';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import {
	childPK,
	ENTITY_NAMES,
	pointBalanceKey,
	pointLedgerKey,
	pointLedgerPrefix,
	tenantPK,
} from './keys';
import { batchDeleteItems, findChildByIdRaw, stripKeys } from './repo-helpers';

export { findChildByIdRaw as findChildById } from './repo-helpers';

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

/** テナントの全ポイント台帳・残高を削除（CHILD#* 配下の POINT# + BALANCE アイテム） */
export async function deleteByTenantId(tenantId: string): Promise<void> {
	// Delete point ledger entries (POINT#...)
	await deleteItemsByPkPrefix(tenantPK('CHILD#', tenantId), pointLedgerPrefix());
	// Delete balance records (BALANCE)
	await deleteItemsByPkPrefix(tenantPK('CHILD#', tenantId), 'BALANCE');
}

// ============================================================
// Retention cleanup (#717, #729)
// ============================================================

/**
 * 指定した子供の `created_at < cutoffDate` に該当する point_ledger を削除する。
 * SK 形式 `POINT#<ISO timestamp>#<id>` の辞書順比較で、`POINT#` (inclusive) 〜
 * `POINT#<cutoffDate>` (inclusive) を BETWEEN で抽出し BatchWrite で削除する。
 * cutoffDate 当日 0:00:00Z 以降の `POINT#<cutoffDate>T...` は辞書順で
 * `POINT#<cutoffDate>` より大きいため対象外（strict less than）。
 *
 * 注意: point_ledger の削除は残高 (BALANCE アイテム) には反映されない。
 * 保持期間切れのエントリは履歴閲覧上から消えるだけで、現在の総残高は変わらない
 * （#729 の設計: ポイントは消えず、過去明細だけが消える）。
 */
export async function deletePointLedgerBeforeDate(
	childId: number,
	cutoffDate: string,
	tenantId: string,
): Promise<number> {
	const items: Record<string, unknown>[] = [];
	let lastKey: Record<string, unknown> | undefined;

	do {
		const result = await getDocClient().send(
			new QueryCommand({
				TableName: TABLE_NAME,
				KeyConditionExpression: 'PK = :pk AND SK BETWEEN :lower AND :upper',
				ExpressionAttributeValues: {
					':pk': childPK(childId, tenantId),
					':lower': pointLedgerPrefix(),
					':upper': `POINT#${cutoffDate}`,
				},
				ProjectionExpression: 'PK, SK',
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of result.Items ?? []) {
			items.push(item as Record<string, unknown>);
		}
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);

	return batchDeleteItems(items.map((it) => ({ PK: it.PK as string, SK: it.SK as string })));
}
