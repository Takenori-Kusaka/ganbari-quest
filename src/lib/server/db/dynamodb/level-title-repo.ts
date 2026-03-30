import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { LevelTitle } from '../types';
import { TABLE_NAME, getDocClient } from './client';
import type { DynamoKey } from './keys';
import { tenantPK } from './keys';

function levelTitlePK(tenantId: string): string {
	return tenantPK('LVTITLE', tenantId);
}

function levelTitleKey(tenantId: string, level: number): DynamoKey {
	return {
		PK: levelTitlePK(tenantId),
		SK: `LV#${String(level).padStart(2, '0')}`,
	};
}

export async function findByTenant(tenantId: string): Promise<LevelTitle[]> {
	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk',
			ExpressionAttributeValues: { ':pk': levelTitlePK(tenantId) },
		}),
	);
	return (result.Items ?? []).map((item) => ({
		id: 0,
		tenantId,
		level: item.level as number,
		customTitle: item.customTitle as string,
		updatedAt: item.updatedAt as string,
	}));
}

export async function upsert(tenantId: string, level: number, customTitle: string): Promise<void> {
	const now = new Date().toISOString();
	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...levelTitleKey(tenantId, level),
				tenantId,
				level,
				customTitle,
				updatedAt: now,
			},
		}),
	);
}

export async function deleteByTenantAndLevel(tenantId: string, level: number): Promise<void> {
	await getDocClient().send(
		new DeleteCommand({
			TableName: TABLE_NAME,
			Key: levelTitleKey(tenantId, level),
		}),
	);
}

export async function deleteAllByTenant(tenantId: string): Promise<void> {
	const items = await findByTenant(tenantId);
	for (const item of items) {
		await deleteByTenantAndLevel(tenantId, item.level);
	}
}
