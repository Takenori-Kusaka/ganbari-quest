// src/lib/server/db/dynamodb/settings-repo.ts
// DynamoDB implementation of ISettingsRepo

import { BatchGetCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '$lib/server/logger';
import { deleteItemsByExactPk } from './bulk-delete';
import { getDocClient, TABLE_NAME } from './client';
import { settingKey, tenantPK } from './keys';

/** 設定値を取得 */
export async function getSetting(key: string, tenantId: string): Promise<string | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: settingKey(key, tenantId),
		}),
	);
	const value = result.Item?.value as string | undefined;
	// #2335 hotfix Phase 1: pin_hash の DynamoDB 取得実態を root cause 特定用に log 出力。
	// value (= bcrypt hash) そのものは出さず存在判定 / 長さ / type のみ。Phase 2 後に削除予定。
	if (key === 'pin_hash') {
		logger.warn('[AUTH][DEBUG #2335] getSetting pin_hash', {
			context: {
				itemFound: !!result.Item,
				valueIsUndefined: value === undefined,
				valueIsEmptyString: value === '',
				valueType: typeof value,
				valueLen: value?.length ?? -1,
				tenantIdPrefix: tenantId.slice(0, 12),
			},
		});
	}
	return value;
}

/** 設定値を更新（upsert） */
export async function setSetting(key: string, value: string, tenantId: string): Promise<void> {
	const now = new Date().toISOString();
	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...settingKey(key, tenantId),
				key,
				value,
				updatedAt: now,
			},
		}),
	);
}

/** 複数の設定値を一括取得 */
export async function getSettings(
	keys: string[],
	tenantId: string,
): Promise<Record<string, string>> {
	if (keys.length === 0) return {};

	const requestKeys = keys.map((k) => settingKey(k, tenantId));
	const result = await getDocClient().send(
		new BatchGetCommand({
			RequestItems: {
				[TABLE_NAME]: {
					Keys: requestKeys,
				},
			},
		}),
	);

	const items = result.Responses?.[TABLE_NAME] ?? [];
	const map: Record<string, string> = {};
	for (const item of items) {
		if (item.key && item.value) {
			map[item.key as string] = item.value as string;
		}
	}
	return map;
}

/** テナントの全設定を削除（PK=T#<tenantId>#SETTING のアイテムをすべて削除） */
export async function deleteByTenantId(tenantId: string): Promise<void> {
	await deleteItemsByExactPk(tenantPK('SETTING', tenantId));
}
