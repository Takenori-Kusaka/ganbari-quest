// src/lib/server/db/dynamodb/bulk-delete.ts
// Shared utility for bulk-deleting DynamoDB items (tenant data cleanup).
//
// #3693: アカウント削除 / data 全削除の deleteByTenantId 群 (約 25 呼び出し) が
// 全テーブル Scan に fan-out し、read 量が全テナント総量に比例して Lambda 30s /
// API GW 504 (restore 504 #3692 と同 class) に到達する問題への是正。
//
// - childIds が既知の経路 (tenant-cleanup-service) は `deleteChildScopedItems` で
//   child partition への Query に置換する (read が自 tenant のデータ量にのみ比例)。
// - childIds が得られない経路は従来どおり Scan fallback (`deleteItemsByPkPrefix`) で
//   削除完全性を優先する (退会 = 法的要請を伴う CUJ のため取り漏らし禁止)。
// - 全経路とも page 単位の streaming 削除 (収集完了を待たず削除) + BatchWrite
//   UnprocessedItems の retry で、途中失敗しても再実行で残存が消える (冪等再開)。

import { BatchWriteCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { ChildId } from '$lib/domain/ids';
import { getDocClient, TABLE_NAME } from './client';
import { childPK } from './keys';

/** BatchWriteItem の上限 (DynamoDB 仕様) */
const BATCH_SIZE = 25;
/** child partition Query の同時実行数 (#3693: 表ごと独立のため並列可、過剰 burst は避ける) */
const CHILD_QUERY_CONCURRENCY = 5;
/** UnprocessedItems retry 上限。超過時は throw (silent partial delete 禁止) */
const UNPROCESSED_RETRY_LIMIT = 5;
const UNPROCESSED_RETRY_BASE_MS = 25;

type ItemKey = { PK: string; SK: string };

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * keys を 25 件ずつ BatchWrite で削除する。
 * UnprocessedItems は指数 backoff で retry し、上限超過時は throw する
 * (握りつぶすと退会 / data 全削除で取り漏らしが silent に残るため)。
 */
async function batchDeleteKeys(keys: ItemKey[]): Promise<void> {
	const doc = getDocClient();
	for (let i = 0; i < keys.length; i += BATCH_SIZE) {
		let requests = keys.slice(i, i + BATCH_SIZE).map((key) => ({
			DeleteRequest: { Key: key },
		}));
		let attempt = 0;
		while (requests.length > 0) {
			const result = await doc.send(
				new BatchWriteCommand({
					RequestItems: { [TABLE_NAME]: requests },
				}),
			);
			const unprocessed = (result.UnprocessedItems?.[TABLE_NAME] ?? []) as typeof requests;
			if (unprocessed.length === 0) break;
			attempt++;
			if (attempt > UNPROCESSED_RETRY_LIMIT) {
				throw new Error(
					`[bulk-delete] BatchWrite unprocessed items remain after ${UNPROCESSED_RETRY_LIMIT} retries (${unprocessed.length} keys)`,
				);
			}
			await sleep(UNPROCESSED_RETRY_BASE_MS * 2 ** (attempt - 1));
			requests = unprocessed;
		}
	}
}

/**
 * Scan for all items whose PK begins with `pkPrefix` and batch-delete them.
 * Handles pagination (LastEvaluatedKey) and batching (25 items per BatchWrite).
 *
 * ⚠️ 全テーブル Scan のため read 量が全テナント総量に比例する (#3693)。
 * child partition の PK (`T#<t>#CHILD#<id>`) が既知なら `deleteChildScopedItems` /
 * `deleteItemsByExactPk` を使うこと。本関数は PK に埋まる ID を列挙できない
 * エンティティ (CKTPL#<tplId> / STMPCARD#<cardId> 等) と fallback 専用。
 *
 * @param pkPrefix - The PK prefix to match, e.g. `T#<tenantId>#CHILD#`
 * @param skPrefix - Optional SK prefix to further narrow the scan
 * @returns The number of items deleted
 */
export async function deleteItemsByPkPrefix(pkPrefix: string, skPrefix?: string): Promise<number> {
	const doc = getDocClient();
	let deleted = 0;
	let lastKey: Record<string, unknown> | undefined;

	const filterParts = ['begins_with(PK, :pkPrefix)'];
	const exprValues: Record<string, unknown> = { ':pkPrefix': pkPrefix };

	if (skPrefix) {
		filterParts.push('begins_with(SK, :skPrefix)');
		exprValues[':skPrefix'] = skPrefix;
	}

	do {
		const result = await doc.send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression: filterParts.join(' AND '),
				ExpressionAttributeValues: exprValues,
				ProjectionExpression: 'PK, SK',
				ExclusiveStartKey: lastKey,
			}),
		);

		const keys = (result.Items ?? []).map((item) => ({
			PK: item.PK as string,
			SK: item.SK as string,
		}));
		// streaming: page 単位で即削除 (10 万行 scale でも全 key をメモリ滞留させない +
		// 途中失敗時も削除済み分は確定し、再実行で残存だけを消せる)
		await batchDeleteKeys(keys);
		deleted += keys.length;
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);

	return deleted;
}

/**
 * Delete all items under a single exact PK via Query (no table Scan).
 *
 * @param pk - The exact PK value
 * @param skPrefix - Optional SK prefix (`begins_with`) to narrow the deletion
 * @returns The number of items deleted
 */
export async function deleteItemsByExactPk(pk: string, skPrefix?: string): Promise<number> {
	const doc = getDocClient();
	let deleted = 0;
	let lastKey: Record<string, unknown> | undefined;

	const keyCondParts = ['PK = :pk'];
	const exprValues: Record<string, unknown> = { ':pk': pk };
	if (skPrefix) {
		keyCondParts.push('begins_with(SK, :skPrefix)');
		exprValues[':skPrefix'] = skPrefix;
	}

	do {
		const result = await doc.send(
			new QueryCommand({
				TableName: TABLE_NAME,
				KeyConditionExpression: keyCondParts.join(' AND '),
				ExpressionAttributeValues: exprValues,
				ProjectionExpression: 'PK, SK',
				ExclusiveStartKey: lastKey,
			}),
		);

		const keys = (result.Items ?? []).map((item) => ({
			PK: item.PK as string,
			SK: item.SK as string,
		}));
		await batchDeleteKeys(keys);
		deleted += keys.length;
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);

	return deleted;
}

/**
 * child partition (`T#<tenantId>#CHILD#<childId>`) 配下の items を SK prefix で削除する。
 *
 * #3693: childIds が与えられた場合は child ごとの Query (並列 chunk) で削除し、
 * 全テーブル Scan を回避する。childIds が undefined の場合 (呼び出し元が children を
 * 列挙できなかった場合) は Scan fallback で削除完全性を優先する。
 *
 * @param tenantId - 対象テナント
 * @param childIds - 対象テナントの全児童 ID (archived 含む)。undefined で Scan fallback
 * @param skPrefix - SK prefix (`begins_with`)。省略時は child partition 全件
 * @returns The number of items deleted
 */
export async function deleteChildScopedItems(
	tenantId: string,
	childIds: readonly ChildId[] | undefined,
	skPrefix?: string,
): Promise<number> {
	if (!childIds) {
		return deleteItemsByPkPrefix(`T#${tenantId}#CHILD#`, skPrefix);
	}

	let deleted = 0;
	for (let i = 0; i < childIds.length; i += CHILD_QUERY_CONCURRENCY) {
		const chunk = childIds.slice(i, i + CHILD_QUERY_CONCURRENCY);
		const results = await Promise.all(
			chunk.map((childId) => deleteItemsByExactPk(childPK(Number(childId), tenantId), skPrefix)),
		);
		for (const count of results) deleted += count;
	}
	return deleted;
}
