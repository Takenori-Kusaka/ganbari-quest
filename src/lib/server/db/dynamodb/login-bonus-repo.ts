// src/lib/server/db/dynamodb/login-bonus-repo.ts
// DynamoDB implementation of ILoginBonusRepo

import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { Child, InsertLoginBonusInput, LoginBonus } from '../types';
import { deleteItemsByPkPrefix } from './bulk-delete';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import { childKey, childPK, ENTITY_NAMES, loginBonusKey, loginBonusPrefix, tenantPK } from './keys';

/** Strip PK/SK/GSI keys from a DynamoDB item */
function stripKeys<T extends Record<string, unknown>>(
	item: T,
): Omit<T, 'PK' | 'SK' | 'GSI2PK' | 'GSI2SK'> {
	const { PK, SK, GSI2PK, GSI2SK, ...rest } = item;
	return rest;
}

/** 今日のログインボーナスを取得 */
export async function findTodayBonus(
	childId: number,
	today: string,
	tenantId: string,
): Promise<LoginBonus | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: loginBonusKey(childId, today, tenantId),
		}),
	);

	if (!result.Item) return undefined;
	return stripKeys(result.Item) as unknown as LoginBonus;
}

/** 直近のログインボーナスを取得（降順） */
export async function findRecentBonuses(
	childId: number,
	tenantId: string,
	limit = 60,
): Promise<LoginBonus[]> {
	const pk = childPK(childId, tenantId);
	const prefix = loginBonusPrefix();

	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': pk,
				':prefix': prefix,
			},
			ScanIndexForward: false, // descending order (newest first)
			Limit: limit,
		}),
	);

	return (result.Items ?? []).map((item) => stripKeys(item) as unknown as LoginBonus);
}

/** ログインボーナスを挿入 */
export async function insertLoginBonus(
	input: InsertLoginBonusInput,
	tenantId: string,
): Promise<LoginBonus> {
	const id = await nextId(ENTITY_NAMES.loginBonus, tenantId);
	const now = new Date().toISOString();

	const bonus: LoginBonus = {
		id,
		childId: input.childId,
		loginDate: input.loginDate,
		rank: input.rank,
		basePoints: input.basePoints,
		multiplier: input.multiplier,
		totalPoints: input.totalPoints,
		consecutiveDays: input.consecutiveDays,
		createdAt: now,
	};

	const key = loginBonusKey(input.childId, input.loginDate, tenantId);

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...key,
				...bonus,
			},
		}),
	);

	return bonus;
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

/** テナントの全ログインボーナスを削除（CHILD#* 配下の LOGIN# アイテム） */
export async function deleteByTenantId(tenantId: string): Promise<void> {
	await deleteItemsByPkPrefix(tenantPK('CHILD#', tenantId), loginBonusPrefix());
}
