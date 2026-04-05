// src/lib/server/db/dynamodb/bulk-delete.ts
// Shared utility for bulk-deleting DynamoDB items by PK prefix (tenant data cleanup).

import { BatchWriteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TABLE_NAME } from './client';

const BATCH_SIZE = 25;

/**
 * Scan for all items whose PK begins with `pkPrefix` and batch-delete them.
 * Handles pagination (LastEvaluatedKey) and batching (25 items per BatchWrite).
 *
 * @param pkPrefix - The PK prefix to match, e.g. `T#<tenantId>#CHILD#`
 * @param skPrefix - Optional SK prefix to further narrow the scan
 * @returns The number of items deleted
 */
export async function deleteItemsByPkPrefix(pkPrefix: string, skPrefix?: string): Promise<number> {
	const doc = getDocClient();
	const allKeys: Array<{ PK: string; SK: string }> = [];
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

		for (const item of result.Items ?? []) {
			allKeys.push({ PK: item.PK as string, SK: item.SK as string });
		}
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);

	// Batch delete in chunks of 25
	for (let i = 0; i < allKeys.length; i += BATCH_SIZE) {
		const batch = allKeys.slice(i, i + BATCH_SIZE);
		await doc.send(
			new BatchWriteCommand({
				RequestItems: {
					[TABLE_NAME]: batch.map((key) => ({
						DeleteRequest: { Key: key },
					})),
				},
			}),
		);
	}

	return allKeys.length;
}

/**
 * Delete all items whose PK exactly matches a single value.
 * Uses Query (more efficient than Scan) when we know the full PK.
 *
 * @param pk - The exact PK value
 * @returns The number of items deleted
 */
export async function deleteItemsByExactPk(pk: string): Promise<number> {
	const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
	const doc = getDocClient();
	const allKeys: Array<{ PK: string; SK: string }> = [];
	let lastKey: Record<string, unknown> | undefined;

	do {
		const result = await doc.send(
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

	for (let i = 0; i < allKeys.length; i += BATCH_SIZE) {
		const batch = allKeys.slice(i, i + BATCH_SIZE);
		await doc.send(
			new BatchWriteCommand({
				RequestItems: {
					[TABLE_NAME]: batch.map((key) => ({
						DeleteRequest: { Key: key },
					})),
				},
			}),
		);
	}

	return allKeys.length;
}
