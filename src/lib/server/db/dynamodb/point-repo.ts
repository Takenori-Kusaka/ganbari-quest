// src/lib/server/db/dynamodb/point-repo.ts
// DynamoDB implementation of IPointRepo

import {
	GetCommand,
	PutCommand,
	QueryCommand,
	TransactWriteCommand,
	UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { ChildId } from '$lib/domain/ids';
import { asChildId } from '$lib/domain/ids';
import type { InsertPointLedgerInput, PointLedgerEntry } from '../types';
import { deleteItemsByPkPrefix } from './bulk-delete';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import {
	childPK,
	ENTITY_NAMES,
	pointBalanceKey,
	pointLedgerIdempotencyKey,
	pointLedgerKey,
	pointLedgerPrefix,
	tenantPK,
} from './keys';
import { batchDeleteItems, stripKeys } from './repo-helpers';

// stored item は数値 id のまま (storage format 不変、#3575)。repo 境界で branded string に変換する。
function toPointLedgerEntry(item: Record<string, unknown>): PointLedgerEntry {
	const raw = stripKeys(item) as unknown as Omit<
		PointLedgerEntry,
		'id' | 'childId' | 'referenceId'
	> & { id: number; childId: number; referenceId: number | null };
	return {
		...raw,
		id: String(raw.id),
		childId: asChildId(raw.childId),
		referenceId: raw.referenceId != null ? String(raw.referenceId) : null,
	};
}

// biome-ignore lint/performance/noBarrelFile: 後方互換 re-export のため維持、削除は別 Issue で検討
export { findChildByIdRaw as findChildById } from './repo-helpers';

/** ポイント残高を取得 */
export async function getBalance(childId: ChildId, tenantId: string): Promise<number> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: pointBalanceKey(Number(childId), tenantId),
		}),
	);

	return (result.Item?.balance as number) ?? 0;
}

/** ポイント履歴を取得（降順） */
export async function findPointHistory(
	childId: ChildId,
	options: { limit: number; offset: number },
	tenantId: string,
): Promise<PointLedgerEntry[]> {
	const pk = childPK(Number(childId), tenantId);
	const prefix = pointLedgerPrefix();

	// For offset, we need to skip items. Query with larger limit then slice.
	const totalNeeded = options.limit + options.offset;

	const items: PointLedgerEntry[] = [];
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
				Limit: totalNeeded - items.length,
				ExclusiveStartKey: lastKey,
			}),
		);

		for (const item of result.Items ?? []) {
			items.push(toPointLedgerEntry(item));
		}
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey && items.length < totalNeeded);

	// Apply offset and limit
	return items.slice(options.offset, options.offset + options.limit);
}

/** ポイント台帳にエントリを挿入 + 残高を更新 */
export async function insertPointEntry(
	input: InsertPointLedgerInput,
	tenantId: string,
): Promise<PointLedgerEntry> {
	const id = await nextId(ENTITY_NAMES.pointLedger, tenantId);
	const now = new Date().toISOString();

	const entry: PointLedgerEntry = {
		id: String(id),
		childId: input.childId,
		amount: input.amount,
		type: input.type,
		description: input.description ?? null,
		referenceId: input.referenceId ?? null,
		createdAt: now,
	};

	const key = pointLedgerKey(Number(input.childId), now, id, tenantId);

	// Put the ledger entry
	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...key,
				...entry,
				// stored attributes は数値 id のまま (storage format 不変、#3575)
				id,
				childId: Number(input.childId),
				referenceId: input.referenceId != null ? Number(input.referenceId) : null,
			},
		}),
	);

	// Atomically update the balance
	await getDocClient().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: pointBalanceKey(Number(input.childId), tenantId),
			UpdateExpression: 'ADD #balance :amount',
			ExpressionAttributeNames: { '#balance': 'balance' },
			ExpressionAttributeValues: { ':amount': input.amount },
		}),
	);

	return entry;
}

/**
 * #3347: 残高が `amount` 以上のときのみ、原子的にポイントを減算して台帳に負値エントリを挿入する。
 * BALANCE アイテムへの条件付き減算（`balance >= :amount` 成立時のみ `ADD balance -amount`）と
 * 台帳エントリ Put を **単一 TransactWrite** で実行し、TOCTOU 二重減算・残高マイナスを防ぐ。
 * 条件不成立（残高不足 / 並行減算で先に減った）は `TransactionCanceledException`
 * （理由 `ConditionalCheckFailed`）で送出されるため、握って `INSUFFICIENT_POINTS` を返す。
 */
export async function spendPointsAtomic(
	childId: ChildId,
	amount: number,
	entry: { type: string; description: string; referenceId?: string },
	tenantId: string,
): Promise<PointLedgerEntry | { error: 'INSUFFICIENT_POINTS' }> {
	const id = await nextId(ENTITY_NAMES.pointLedger, tenantId);
	const now = new Date().toISOString();

	const ledger: PointLedgerEntry = {
		id: String(id),
		childId,
		amount: -amount,
		type: entry.type,
		description: entry.description ?? null,
		referenceId: entry.referenceId ?? null,
		createdAt: now,
	};
	const key = pointLedgerKey(Number(childId), now, id, tenantId);

	// #3284: referenceId 付き減算 (reward_redemption 等) は冪等 marker の条件付き Put を同一
	// transaction 化し、同一 (child, type, reference) の二重減算を DB レベルで物理拒否する
	// (SQLite idx_point_ledger_idempotency と機能等価)。
	const transactItems: NonNullable<
		ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']
	> = [
		{
			// 残高 >= コスト のときのみ原子的に減算（条件不成立で transaction 全体が cancel される）
			Update: {
				TableName: TABLE_NAME,
				Key: pointBalanceKey(Number(childId), tenantId),
				UpdateExpression: 'ADD #balance :neg',
				ConditionExpression: '#balance >= :amount',
				ExpressionAttributeNames: { '#balance': 'balance' },
				ExpressionAttributeValues: { ':neg': -amount, ':amount': amount },
			},
		},
		{
			Put: {
				TableName: TABLE_NAME,
				Item: {
					...key,
					...ledger,
					// stored attributes は数値 id のまま (storage format 不変、#3575)
					id,
					childId: Number(childId),
					referenceId: entry.referenceId != null ? Number(entry.referenceId) : null,
				},
			},
		},
	];
	if (entry.referenceId != null) {
		transactItems.push({
			Put: {
				TableName: TABLE_NAME,
				Item: {
					...pointLedgerIdempotencyKey(
						Number(childId),
						entry.type,
						Number(entry.referenceId),
						tenantId,
					),
					ledgerId: id,
					createdAt: now,
				},
				ConditionExpression: 'attribute_not_exists(PK)',
			},
		});
	}

	try {
		await getDocClient().send(new TransactWriteCommand({ TransactItems: transactItems }));
	} catch (err) {
		const cancellation = (err as { name?: string; CancellationReasons?: Array<{ Code?: string }> })
			?.CancellationReasons;
		const isCancel = (err as { name?: string })?.name === 'TransactionCanceledException';
		// #3356 (2): 旧 `?? true` は CancellationReasons 無しの TransactionCanceledException
		// (transient conflict / throttle) まで「残高不足」に誤分類していた。CancellationReasons の
		// index は TransactItems と 1:1 のため、index 0 (残高条件) の失敗のみ INSUFFICIENT_POINTS に
		// 分類する。index 2 (冪等 marker、#3284) の失敗 = 同一 reference の二重減算は明示 throw、
		// 分類不能な cancel も throw して呼び出し側 / インフラ retry に委ねる (減算はされず fail-closed)。
		if (isCancel && cancellation?.[0]?.Code === 'ConditionalCheckFailed') {
			return { error: 'INSUFFICIENT_POINTS' };
		}
		if (isCancel && cancellation?.[2]?.Code === 'ConditionalCheckFailed') {
			throw new Error(
				`spendPointsAtomic: duplicate spend rejected (child=${childId}, type=${entry.type}, referenceId=${entry.referenceId}) #3284`,
			);
		}
		throw err;
	}

	return ledger;
}

/** テナントの全ポイント台帳・残高を削除（CHILD#* 配下の POINT# + POINTIDEM# + BALANCE アイテム） */
export async function deleteByTenantId(tenantId: string): Promise<void> {
	// Delete point ledger entries (POINT#...)
	await deleteItemsByPkPrefix(tenantPK('CHILD#', tenantId), pointLedgerPrefix());
	// Delete idempotency markers (POINTIDEM#..., #3284)
	await deleteItemsByPkPrefix(tenantPK('CHILD#', tenantId), 'POINTIDEM#');
	// Delete balance records (BALANCE)
	await deleteItemsByPkPrefix(tenantPK('CHILD#', tenantId), 'BALANCE');
}

// ============================================================
// Retention cleanup (#717, #729)
// ============================================================

/**
 * 指定した子供の `created_at < cutoffDate` に該当する point_ledger を削除する。
 * SK 形式 `POINT#<ISO timestamp>#<id>` の辞書順比較で、`POINT#` (inclusive) 〜
 * `POINT#<cutoffDate>` (inclusive) を BETWEEN で抽出し BatchWrite で削除する。
 * cutoffDate 当日 0:00:00Z 以降の `POINT#<cutoffDate>T...` は辞書順で
 * `POINT#<cutoffDate>` より大きいため対象外（strict less than）。
 *
 * 注意: point_ledger の削除は残高 (BALANCE アイテム) には反映されない。
 * 保持期間切れのエントリは履歴閲覧上から消えるだけで、現在の総残高は変わらない
 * （#729 の設計: ポイントは消えず、過去明細だけが消える）。
 */
export async function deletePointLedgerBeforeDate(
	childId: ChildId,
	cutoffDate: string,
	tenantId: string,
): Promise<number> {
	const items: Record<string, unknown>[] = [];
	let lastKey: Record<string, unknown> | undefined;

	do {
		const result = await getDocClient().send(
			new QueryCommand({
				TableName: TABLE_NAME,
				KeyConditionExpression: 'PK = :pk AND SK BETWEEN :lower AND :upper',
				ExpressionAttributeValues: {
					':pk': childPK(Number(childId), tenantId),
					':lower': pointLedgerPrefix(),
					':upper': `POINT#${cutoffDate}`,
				},
				ProjectionExpression: 'PK, SK',
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of result.Items ?? []) {
			items.push(item as Record<string, unknown>);
		}
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);

	return batchDeleteItems(items.map((it) => ({ PK: it.PK as string, SK: it.SK as string })));
}
