// src/lib/server/db/dynamodb/special-reward-repo.ts
// DynamoDB implementation of ISpecialRewardRepo

import { DeleteCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { UpdateSpecialRewardInput } from '../interfaces/special-reward-repo.interface';
import type { InsertSpecialRewardInput, SpecialReward } from '../types';
import { deleteItemsByPkPrefix } from './bulk-delete';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import {
	childPK,
	ENTITY_NAMES,
	rewardRedemptionPrefix,
	specialRewardKey,
	specialRewardPrefix,
	tenantPK,
} from './keys';

/** Strip PK/SK/GSI keys from a DynamoDB item */
function stripKeys<T extends Record<string, unknown>>(
	item: T,
): Omit<T, 'PK' | 'SK' | 'GSI2PK' | 'GSI2SK'> {
	const { PK, SK, GSI2PK, GSI2SK, ...rest } = item;
	return rest;
}

/** 特別報酬を記録 */
export async function insertSpecialReward(
	input: InsertSpecialRewardInput,
	tenantId: string,
): Promise<SpecialReward> {
	const id = await nextId(ENTITY_NAMES.specialReward, tenantId);
	const now = new Date().toISOString();

	const reward: SpecialReward = {
		id,
		childId: input.childId,
		grantedBy: input.grantedBy ?? null,
		title: input.title,
		description: input.description ?? null,
		points: input.points,
		icon: input.icon ?? null,
		category: input.category,
		grantedAt: now,
		shownAt: null,
		sourcePresetId: input.sourcePresetId ?? null,
	};

	const key = specialRewardKey(input.childId, now, id, tenantId);

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...key,
				...reward,
			},
		}),
	);

	return reward;
}

/** 子供の特別報酬履歴を取得（降順） */
export async function findSpecialRewards(
	childId: number,
	tenantId: string,
): Promise<SpecialReward[]> {
	const pk = childPK(childId, tenantId);
	const prefix = specialRewardPrefix();

	const items: SpecialReward[] = [];
	let lastKey: Record<string, unknown> | undefined;

	do {
		const result = await getDocClient().send(
			new QueryCommand({
				TableName: TABLE_NAME,
				KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
				ExpressionAttributeValues: {
					':pk': pk,
					':prefix': prefix,
				},
				ScanIndexForward: false, // descending order (newest first)
				ExclusiveStartKey: lastKey,
			}),
		);

		for (const item of result.Items ?? []) {
			items.push(stripKeys(item) as unknown as SpecialReward);
		}
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);

	return items;
}

/** 子供の未表示の特別報酬を1件取得 */
export async function findUnshownReward(
	childId: number,
	tenantId: string,
): Promise<SpecialReward | undefined> {
	const pk = childPK(childId, tenantId);
	const prefix = specialRewardPrefix();

	// Query all rewards for this child (descending), filter for unshown
	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			FilterExpression: 'attribute_not_exists(shownAt) OR shownAt = :null',
			ExpressionAttributeValues: {
				':pk': pk,
				':prefix': prefix,
				':null': null,
			},
			ScanIndexForward: false, // descending order (newest first)
			Limit: 1,
		}),
	);

	const items = result.Items ?? [];
	if (items.length === 0) return undefined;
	return stripKeys(items[0] as Record<string, unknown>) as unknown as SpecialReward;
}

/**
 * 特別報酬を表示済みにする。
 *
 * #2845 課題① / B1: 旧実装は tenant prefix を含まない全テーブル Scan + `Limit:1`
 * (cross-tenant IDOR 形状 + #2842 silent no-op クラス) だった。childId を受け取り
 * child partition Query (tenant + child 境界を KeyCondition で構造的に担保) に置換。
 */
export async function markRewardShown(
	childId: number,
	rewardId: number,
	tenantId: string,
): Promise<SpecialReward | undefined> {
	const found = await findRewardItemByChildAndId(childId, rewardId, tenantId);
	if (!found) return undefined;

	const now = new Date().toISOString();
	const updateResult = await getDocClient().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: { PK: found.PK, SK: found.SK },
			UpdateExpression: 'SET #shownAt = :shownAt',
			ExpressionAttributeNames: { '#shownAt': 'shownAt' },
			ExpressionAttributeValues: { ':shownAt': now },
			ReturnValues: 'ALL_NEW',
		}),
	);

	if (!updateResult.Attributes) return undefined;
	return stripKeys(updateResult.Attributes) as unknown as SpecialReward;
}

/**
 * child partition から指定 rewardId の REWARD# item を 1 件特定する (PK/SK 解決用)。
 * SK = REWARD#<grantedAt>#<id> で grantedAt が不明なため、child partition Query
 * (KeyCondition で tenant + child 境界を構造的に担保) + id filter で解決する
 * (#2845 課題①: 旧 tenant Scan を置換)。Query は全ページ走査し一致 item で早期 return する
 * (#2842 paging 正パターン: Limit + Filter の silent no-op を避ける)。
 */
async function findRewardItemByChildAndId(
	childId: number,
	rewardId: number,
	tenantId: string,
): Promise<({ PK: string; SK: string } & Record<string, unknown>) | undefined> {
	const doc = getDocClient();
	let lastKey: Record<string, unknown> | undefined;
	do {
		const result = await doc.send(
			new QueryCommand({
				TableName: TABLE_NAME,
				KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
				FilterExpression: 'id = :id',
				ExpressionAttributeValues: {
					':pk': childPK(childId, tenantId),
					':prefix': specialRewardPrefix(),
					':id': rewardId,
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		const item = (result.Items ?? [])[0];
		if (item) return item as { PK: string; SK: string } & Record<string, unknown>;
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);
	return undefined;
}

/**
 * #2832: 特別報酬を編集 (title / points / icon / category)。
 * pending redemption が存在しても編集可 (案 b)。申請済みの交換は redemption item の
 * 非正規化 snapshot (申請時点値) で処理されるため、本編集は申請に波及しない。
 */
export async function updateSpecialReward(
	childId: number,
	rewardId: number,
	updates: UpdateSpecialRewardInput,
	tenantId: string,
): Promise<SpecialReward | undefined> {
	const found = await findRewardItemByChildAndId(childId, rewardId, tenantId);
	if (!found) return undefined;

	const sets: string[] = [];
	const names: Record<string, string> = {};
	const values: Record<string, unknown> = {};
	if (updates.title !== undefined) {
		sets.push('#title = :title');
		names['#title'] = 'title';
		values[':title'] = updates.title;
	}
	if (updates.points !== undefined) {
		sets.push('#points = :points');
		names['#points'] = 'points';
		values[':points'] = updates.points;
	}
	if (updates.icon !== undefined) {
		sets.push('#icon = :icon');
		names['#icon'] = 'icon';
		values[':icon'] = updates.icon;
	}
	if (updates.category !== undefined) {
		sets.push('#category = :category');
		names['#category'] = 'category';
		values[':category'] = updates.category;
	}
	if (sets.length === 0) {
		return stripKeys(found) as unknown as SpecialReward;
	}

	const result = await getDocClient().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: { PK: found.PK, SK: found.SK },
			UpdateExpression: `SET ${sets.join(', ')}`,
			ExpressionAttributeNames: names,
			ExpressionAttributeValues: values,
			ReturnValues: 'ALL_NEW',
		}),
	);
	if (!result.Attributes) return undefined;
	return stripKeys(result.Attributes) as unknown as SpecialReward;
}

/**
 * #2832: 特別報酬を削除。
 * pending redemption ガードは service 層 (hasPendingByReward) が担う前提。
 * SQLite 実装 (挙動 SSOT) と等価にするため、当該 reward の交換申請履歴 item
 * (解決済 approved/rejected/expired) も削除する。
 */
export async function deleteSpecialReward(
	childId: number,
	rewardId: number,
	tenantId: string,
): Promise<boolean> {
	const found = await findRewardItemByChildAndId(childId, rewardId, tenantId);
	if (!found) return false;

	// 当該 reward の REDEMPT# item を child partition Query で収集して削除
	// (SQLite の cascade 削除と等価。reward は per-child のため申請も同 child partition に閉じる)
	const doc = getDocClient();
	let lastKey: Record<string, unknown> | undefined;
	do {
		const result = await doc.send(
			new QueryCommand({
				TableName: TABLE_NAME,
				KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
				FilterExpression: 'rewardId = :rid',
				ExpressionAttributeValues: {
					':pk': childPK(childId, tenantId),
					':skPrefix': rewardRedemptionPrefix(),
					':rid': rewardId,
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of result.Items ?? []) {
			await doc.send(
				new DeleteCommand({
					TableName: TABLE_NAME,
					Key: { PK: item.PK as string, SK: item.SK as string },
				}),
			);
		}
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);

	await doc.send(
		new DeleteCommand({
			TableName: TABLE_NAME,
			Key: { PK: found.PK, SK: found.SK },
		}),
	);
	return true;
}

/** テナントの全特別報酬を削除（CHILD#* 配下の REWARD# アイテム） */
export async function deleteByTenantId(tenantId: string): Promise<void> {
	await deleteItemsByPkPrefix(tenantPK('CHILD#', tenantId), specialRewardPrefix());
}
