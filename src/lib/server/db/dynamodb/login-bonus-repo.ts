// src/lib/server/db/dynamodb/login-bonus-repo.ts
// DynamoDB implementation of ILoginBonusRepo

import { BatchWriteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
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

// ============================================================
// Retention cleanup (#717, #729)
// ============================================================

/**
 * 指定した子供の `login_date < cutoffDate` に該当する login_bonuses を削除する。
 * SK 形式 `LOGIN#<loginDate>` の辞書順比較で、`LOGIN#` (inclusive) 〜
 * `LOGIN#<cutoffDate>` (exclusive) を Query → BatchWrite で削除する。
 * cutoffDate 当日のレコード (`LOGIN#<cutoffDate>`) は境界値なので含めない
 * ため、upper bound は `LOGIN#<cutoffDate>` の直前 = `LOGIN#<cutoffDate - 1 char>`
 * ではなく、`LOGIN#<cutoffDate>` の1文字前を使う代わりに「< upper」を使う。
 * DynamoDB の KeyCondition では `<` 演算子がサポートされているので、それを使用する。
 */
export async function deleteLoginBonusesBeforeDate(
	childId: number,
	cutoffDate: string,
	tenantId: string,
): Promise<number> {
	const items: Record<string, unknown>[] = [];
	let lastKey: Record<string, unknown> | undefined;
	const pk = childPK(childId, tenantId);
	const lowerBound = loginBonusPrefix(); // 'LOGIN#'
	const upperBound = `LOGIN#${cutoffDate}`; // exclusive upper (will use <)

	do {
		const result = await getDocClient().send(
			new QueryCommand({
				TableName: TABLE_NAME,
				// SK must be >= 'LOGIN#' AND < 'LOGIN#<cutoffDate>'
				KeyConditionExpression: 'PK = :pk AND SK BETWEEN :lower AND :upperExclusive',
				ExpressionAttributeValues: {
					':pk': pk,
					':lower': lowerBound,
					// BETWEEN is inclusive; we want SK < `LOGIN#<cutoffDate>`, so use a slightly
					// smaller upper bound. Any SK lexicographically < `LOGIN#<cutoffDate>` is
					// matched if upper is `LOGIN#<cutoffDate-1char>`. Simpler: use char code
					// 0 (zero byte) is not easily representable; instead keep BETWEEN inclusive
					// with `LOGIN#<cutoffDate>` and then filter out any exact date match client-side.
					':upperExclusive': upperBound,
				},
				ProjectionExpression: 'PK, SK, loginDate',
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of result.Items ?? []) {
			// Strict less than: exclude records where loginDate === cutoffDate
			if ((item.loginDate as string) < cutoffDate) {
				items.push(item as Record<string, unknown>);
			}
		}
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);

	// BatchWrite in chunks of 25
	for (let i = 0; i < items.length; i += 25) {
		const chunk = items.slice(i, i + 25);
		await getDocClient().send(
			new BatchWriteCommand({
				RequestItems: {
					[TABLE_NAME]: chunk.map((it) => ({
						DeleteRequest: { Key: { PK: it.PK as string, SK: it.SK as string } },
					})),
				},
			}),
		);
	}

	return items.length;
}
