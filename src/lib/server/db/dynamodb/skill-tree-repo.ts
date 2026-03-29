// src/lib/server/db/dynamodb/skill-tree-repo.ts
// パッシブスキルツリー リポジトリ（DynamoDB実装）

import { GetCommand, PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { ChildSkillNode, SkillNode, SkillPoints } from '../types';
import { TABLE_NAME, getDocClient } from './client';
import { childPK, childSkillNodeKey, childSkillNodePrefix, skillPointsKey } from './keys';

function stripKeys<T extends Record<string, unknown>>(
	item: T,
): Omit<T, 'PK' | 'SK' | 'GSI2PK' | 'GSI2SK'> {
	const { PK, SK, GSI2PK, GSI2SK, ...rest } = item;
	return rest;
}

// スキルノードマスタは少数（16件）なので Scan で取得
export async function findAllSkillNodes(_tenantId: string): Promise<SkillNode[]> {
	const result = await getDocClient().send(
		new ScanCommand({
			TableName: TABLE_NAME,
			FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
			ExpressionAttributeValues: {
				':prefix': 'SKILLNODE#',
				':sk': 'MASTER',
			},
		}),
	);
	return (result.Items ?? []).map(
		(item) => stripKeys(item as unknown as Record<string, unknown>) as unknown as SkillNode,
	);
}

export async function findSkillNodeById(
	nodeId: number,
	_tenantId: string,
): Promise<SkillNode | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: { PK: `SKILLNODE#${nodeId}`, SK: 'MASTER' },
		}),
	);
	if (!result.Item) return undefined;
	return stripKeys(result.Item as unknown as Record<string, unknown>) as unknown as SkillNode;
}

export async function findChildSkillNodes(
	childId: number,
	tenantId: string,
): Promise<ChildSkillNode[]> {
	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': childPK(childId, tenantId),
				':prefix': childSkillNodePrefix(),
			},
		}),
	);
	return (result.Items ?? []).map(
		(item) => stripKeys(item as unknown as Record<string, unknown>) as unknown as ChildSkillNode,
	);
}

export async function insertChildSkillNode(
	childId: number,
	nodeId: number,
	tenantId: string,
): Promise<ChildSkillNode> {
	const now = new Date().toISOString();
	const key = childSkillNodeKey(childId, nodeId, tenantId);
	const id = Date.now();
	const item: Record<string, unknown> = {
		...key,
		id,
		childId,
		nodeId,
		unlockedAt: now,
	};
	await getDocClient().send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
	return stripKeys(item) as unknown as ChildSkillNode;
}

export async function findSkillPoints(
	childId: number,
	tenantId: string,
): Promise<SkillPoints | undefined> {
	const key = skillPointsKey(childId, tenantId);
	const result = await getDocClient().send(new GetCommand({ TableName: TABLE_NAME, Key: key }));
	if (!result.Item) return undefined;
	return stripKeys(result.Item as unknown as Record<string, unknown>) as unknown as SkillPoints;
}

export async function upsertSkillPoints(
	childId: number,
	balance: number,
	totalEarned: number,
	totalSpent: number,
	tenantId: string,
): Promise<SkillPoints> {
	const now = new Date().toISOString();
	const key = skillPointsKey(childId, tenantId);
	const existing = await findSkillPoints(childId, tenantId);
	const id = existing?.id ?? Date.now();
	const item: Record<string, unknown> = {
		...key,
		id,
		childId,
		balance,
		totalEarned,
		totalSpent,
		updatedAt: now,
	};
	await getDocClient().send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
	return stripKeys(item) as unknown as SkillPoints;
}
