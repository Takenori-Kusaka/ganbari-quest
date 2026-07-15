// src/lib/server/db/dynamodb/login-bonus-repo.ts
// DynamoDB implementation of ILoginBonusRepo

import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { ChildId } from '$lib/domain/ids';
import { asChildId } from '$lib/domain/ids';
import type { InsertLoginBonusInput, LoginBonus } from '../types';
import { deleteChildScopedItems } from './bulk-delete';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import { childPK, ENTITY_NAMES, loginBonusKey, loginBonusPrefix } from './keys';
import { batchDeleteItems, stripKeys } from './repo-helpers';

// stored item は数値 id のまま (storage format 不変、#3575)。repo 境界で branded string に変換する。
function toLoginBonus(item: Record<string, unknown>): LoginBonus {
	const raw = stripKeys(item) as unknown as Omit<LoginBonus, 'id' | 'childId'> & {
		id: number;
		childId: number;
	};
	return { ...raw, id: String(raw.id), childId: asChildId(raw.childId) };
}

// biome-ignore lint/performance/noBarrelFile: 後方互換 re-export のため維持、削除は別 Issue で検討
export { findChildByIdRaw as findChildById } from './repo-helpers';

/** 今日のログインボーナスを取得 */
export async function findTodayBonus(
	childId: ChildId,
	today: string,
	tenantId: string,
): Promise<LoginBonus | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: loginBonusKey(Number(childId), today, tenantId),
		}),
	);

	if (!result.Item) return undefined;
	return toLoginBonus(result.Item);
}

/** 直近のログインボーナスを取得（降順） */
export async function findRecentBonuses(
	childId: ChildId,
	tenantId: string,
	limit = 60,
): Promise<LoginBonus[]> {
	const pk = childPK(Number(childId), tenantId);
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

	return (result.Items ?? []).map((item) => toLoginBonus(item));
}

/** ログインボーナスを挿入 */
export async function insertLoginBonus(
	input: InsertLoginBonusInput,
	tenantId: string,
): Promise<LoginBonus> {
	const id = await nextId(ENTITY_NAMES.loginBonus, tenantId);
	const now = new Date().toISOString();

	const bonus: LoginBonus = {
		id: String(id),
		childId: input.childId,
		loginDate: input.loginDate,
		rank: input.rank,
		basePoints: input.basePoints,
		multiplier: input.multiplier,
		totalPoints: input.totalPoints,
		consecutiveDays: input.consecutiveDays,
		createdAt: now,
	};

	const key = loginBonusKey(Number(input.childId), input.loginDate, tenantId);

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...key,
				...bonus,
				// stored attributes は数値 id のまま (storage format 不変、#3575)
				id,
				childId: Number(input.childId),
			},
		}),
	);

	return bonus;
}

/** テナントの全ログインボーナスを削除（CHILD#* 配下の LOGIN# アイテム） */
export async function deleteByTenantId(
	tenantId: string,
	childIds?: readonly ChildId[],
): Promise<void> {
	await deleteChildScopedItems(tenantId, childIds, loginBonusPrefix());
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
	childId: ChildId,
	cutoffDate: string,
	tenantId: string,
): Promise<number> {
	const items: Record<string, unknown>[] = [];
	let lastKey: Record<string, unknown> | undefined;
	const pk = childPK(Number(childId), tenantId);
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

	return batchDeleteItems(items.map((it) => ({ PK: it.PK as string, SK: it.SK as string })));
}
