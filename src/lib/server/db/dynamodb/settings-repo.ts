// src/lib/server/db/dynamodb/settings-repo.ts
// DynamoDB implementation of ISettingsRepo

import { BatchGetCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TABLE_NAME } from './client';
import { settingKey } from './keys';

/** 設定値を取得 */
export async function getSetting(key: string, tenantId: string): Promise<string | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: settingKey(key, tenantId),
		}),
	);
	return result.Item?.value as string | undefined;
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
