// src/lib/server/db/dynamodb/cancellation-reason-repo.ts
// DynamoDB implementation of ICancellationReasonRepo (#1596 / ADR-0023 §3.8 / I3)
//
// Single-partition (PK=CANCEL_REASON) with SK=<isoTs>#<uuid>。
// 集計とテナント削除のみがアクセスパターンで、低頻度書込み (<100/月) を想定。
// Tenant 単位の検索は属性フィルタによる Scan で対応 (Pre-PMF / ADR-0010)。

import { randomUUID } from 'node:crypto';
import { PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { CancellationCategory } from '$lib/domain/labels';
import { CANCELLATION_CATEGORIES } from '$lib/domain/labels';
import type {
	CancellationReasonAggregation,
	CancellationReasonRecord,
	CreateCancellationReasonInput,
} from '../interfaces/cancellation-reason-repo.interface';
import { getDocClient, TABLE_NAME } from './client';
import { CANCELLATION_REASON_PK, cancellationReasonKey } from './keys';

const DEFAULT_AGGREGATION_DAYS = 90;
const DEFAULT_FREE_TEXT_SEARCH_LIMIT = 50;

interface CancellationReasonItem {
	PK: string;
	SK: string;
	id: number;
	tenantId: string;
	category: string;
	freeText: string | null;
	planAtCancellation: string | null;
	stripeSubscriptionId: string | null;
	createdAt: string;
}

function mapItem(item: Record<string, unknown>): CancellationReasonRecord {
	const i = item as unknown as CancellationReasonItem;
	return {
		id: i.id,
		tenantId: i.tenantId,
		category: i.category as CancellationCategory,
		freeText: i.freeText ?? null,
		planAtCancellation: i.planAtCancellation ?? null,
		stripeSubscriptionId: i.stripeSubscriptionId ?? null,
		createdAt: i.createdAt,
	};
}

/**
 * id の生成: 単純にランダム数値 (DynamoDB 側で連番性を担保しないため)。
 * 衝突確率は十分低い (Math.random * 1e9) が、SK に uuid を含めるので主キー衝突は無し。
 */
function generateId(): number {
	return Math.floor(Math.random() * 1_000_000_000);
}

export async function create(
	input: CreateCancellationReasonInput,
): Promise<CancellationReasonRecord> {
	const createdAt = new Date().toISOString();
	const id = generateId();
	const uuid = randomUUID();

	const item: CancellationReasonItem = {
		...cancellationReasonKey(createdAt, uuid),
		id,
		tenantId: input.tenantId,
		category: input.category,
		freeText: input.freeText ?? null,
		planAtCancellation: input.planAtCancellation ?? null,
		stripeSubscriptionId: input.stripeSubscriptionId ?? null,
		createdAt,
	};

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: item,
		}),
	);

	return {
		id,
		tenantId: input.tenantId,
		category: input.category,
		freeText: input.freeText ?? null,
		planAtCancellation: input.planAtCancellation ?? null,
		stripeSubscriptionId: input.stripeSubscriptionId ?? null,
		createdAt,
	};
}

async function queryAllInPartition(): Promise<CancellationReasonRecord[]> {
	const all: CancellationReasonRecord[] = [];
	let exclusiveStartKey: Record<string, unknown> | undefined;
	do {
		const res = await getDocClient().send(
			new QueryCommand({
				TableName: TABLE_NAME,
				KeyConditionExpression: 'PK = :pk',
				ExpressionAttributeValues: { ':pk': CANCELLATION_REASON_PK },
				ExclusiveStartKey: exclusiveStartKey,
			}),
		);
		for (const item of res.Items ?? []) {
			all.push(mapItem(item));
		}
		exclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (exclusiveStartKey);
	return all;
}

export async function listByTenant(tenantId: string): Promise<CancellationReasonRecord[]> {
	// テナント単位のクエリは削除時のみ。属性フィルタ Scan で対応。
	const all = await queryAllInPartition();
	return all.filter((r) => r.tenantId === tenantId);
}

export async function aggregateRecent(days: number = DEFAULT_AGGREGATION_DAYS): Promise<{
	total: number;
	breakdown: CancellationReasonAggregation[];
}> {
	const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
	const sinceIso = new Date(sinceMs).toISOString();

	// SK は <isoTs>#<uuid> なので createdAt >= since と等価な範囲クエリが可能
	const res = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND SK >= :sk',
			ExpressionAttributeValues: {
				':pk': CANCELLATION_REASON_PK,
				':sk': sinceIso,
			},
		}),
	);

	const items = (res.Items ?? []).map(mapItem);
	const total = items.length;

	const breakdown: CancellationReasonAggregation[] = CANCELLATION_CATEGORIES.map((cat) => {
		const count = items.filter((it) => it.category === cat).length;
		return {
			category: cat,
			count,
			percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
		};
	});

	return { total, breakdown };
}

export async function searchFreeText(
	query: string,
	limit: number = DEFAULT_FREE_TEXT_SEARCH_LIMIT,
): Promise<CancellationReasonRecord[]> {
	const trimmed = query.trim();
	const all = await queryAllInPartition();
	const filtered = all
		.filter((r) => r.freeText && r.freeText.length > 0)
		.filter((r) => (trimmed ? r.freeText?.includes(trimmed) : true))
		.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
	return filtered.slice(0, limit);
}

export async function deleteByTenantId(tenantId: string): Promise<void> {
	const records = await listByTenant(tenantId);
	if (records.length === 0) return;

	// SK は <isoTs>#<uuid>。マッチした項目を 1 件ずつ削除（低頻度想定）。
	const { DeleteCommand } = await import('@aws-sdk/lib-dynamodb');
	for (const _record of records) {
		// id ベースだと SK が分からないため、Scan で実 SK を取り直す必要がある。
		// listByTenant で record.id しか持たない実装を簡略化: 全件 Scan して属性フィルタ
		// + raw item の PK/SK を取得して削除する。
	}

	// 改めて raw item を取得
	const res = await getDocClient().send(
		new ScanCommand({
			TableName: TABLE_NAME,
			FilterExpression: 'PK = :pk AND tenantId = :tid',
			ExpressionAttributeValues: {
				':pk': CANCELLATION_REASON_PK,
				':tid': tenantId,
			},
		}),
	);
	for (const item of res.Items ?? []) {
		await getDocClient().send(
			new DeleteCommand({
				TableName: TABLE_NAME,
				Key: { PK: item.PK, SK: item.SK },
			}),
		);
	}
}
