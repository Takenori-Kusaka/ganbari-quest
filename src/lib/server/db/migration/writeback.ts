// src/lib/server/db/migration/writeback.ts
// DynamoDB / SQLite 共通の Write-Back ヘルパー

import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '$lib/server/logger';
import { getDocClient, TABLE_NAME } from '../dynamodb/client';
import type { DynamoKey } from '../dynamodb/keys';
import { type RawRecord, SCHEMA_VERSION_FIELD } from './types';

/**
 * DynamoDB: マイグレーション済みレコードを Optimistic Locking で書き戻す
 *
 * - 変更されたフィールドのみ SET で更新
 * - ConditionExpression: _sv が存在しない OR 現在値より小さい場合のみ書き込み
 * - ConditionalCheckFailedException は正常（別プロセスが先に更新済み）
 */
export async function writeBackDynamoDB(
	entityType: string,
	key: DynamoKey,
	original: RawRecord,
	migrated: RawRecord,
): Promise<void> {
	// 変更差分を検出
	const parts: string[] = [];
	const names: Record<string, string> = {};
	const values: Record<string, unknown> = {};

	for (const [field, value] of Object.entries(migrated)) {
		// DynamoDB キーフィールドは更新不可
		if (field === 'PK' || field === 'SK' || field === 'GSI2PK' || field === 'GSI2SK') continue;
		if (original[field] !== value) {
			const nameAlias = `#wb_${field}`;
			const valAlias = `:wb_${field}`;
			parts.push(`${nameAlias} = ${valAlias}`);
			names[nameAlias] = field;
			values[valAlias] = value;
		}
	}

	if (parts.length === 0) return;

	// _sv のエイリアスが無い場合（変更無し）はスキップ
	const svNameAlias = `#wb_${SCHEMA_VERSION_FIELD}`;
	const svValAlias = `:wb_${SCHEMA_VERSION_FIELD}`;
	if (!names[svNameAlias]) return;

	try {
		await getDocClient().send(
			new UpdateCommand({
				TableName: TABLE_NAME,
				Key: key,
				UpdateExpression: `SET ${parts.join(', ')}`,
				ConditionExpression: `attribute_not_exists(${svNameAlias}) OR ${svNameAlias} < ${svValAlias}`,
				ExpressionAttributeNames: names,
				ExpressionAttributeValues: values,
			}),
		);
		logger.info('[migration] Write-back succeeded', {
			context: { entityType, sv: migrated[SCHEMA_VERSION_FIELD] },
		});
	} catch (err) {
		if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
			// 別プロセスが先に更新済み — 正常
			return;
		}
		logger.warn('[migration] Write-back failed', {
			error: String(err),
			context: { entityType },
		});
	}
}
