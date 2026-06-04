// src/lib/server/db/dynamodb/report-daily-summary-repo.ts
// DynamoDB implementation of report daily summary repository (#2824 Wave 6B / ADR-0055)
//
// 旧 stub (#2263 hotfix: read = 空 / write = no-op) を本実装に置換。
// SQLite 実装 (sqlite/report-daily-summary-repo.ts) と機能等価。
//
// キー設計 (keys.ts reportDailySummaryKey、GSI 不要):
//   PK = T#<tenant>#RDS, SK = <date>#<childId>
//   - tenant 単位 partition + date 先頭 SK で tenant 横断 + 日付範囲を Query で実現
//   - child 単位 (findByChildAndDateRange) は同 PK + FilterExpression(childId)
//   - upsert は SK 決定的 → PutItem 上書きで SQLite onConflictDoUpdate 等価

import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { InsertReportDailySummaryInput, ReportDailySummary } from '../types';
import { deleteItemsByExactPk } from './bulk-delete';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import { ENTITY_NAMES, reportDailySummaryKey, reportDailySummaryTenantPK } from './keys';
import { stripKeys } from './repo-helpers';

// SK は <date>#<childId>。日付範囲の上端まで全 childId を含めるための番兵 (最大 char)。
const SK_DATE_UPPER_BOUND = '￿';

function mapItem(item: Record<string, unknown>): ReportDailySummary {
	return stripKeys(item) as unknown as ReportDailySummary;
}

/**
 * tenant partition を date 範囲 (BETWEEN) で Query し、ページネーション処理する。
 * SK = <date>#<childId> のため、start は <startDate>、end は <endDate>￿ で
 * endDate 当日の全 childId を含める。
 */
async function queryByDateRange(
	tenantId: string,
	startDate: string,
	endDate: string,
): Promise<ReportDailySummary[]> {
	const pk = reportDailySummaryTenantPK(tenantId);
	const items: ReportDailySummary[] = [];
	let lastKey: Record<string, unknown> | undefined;

	do {
		const res = await getDocClient().send(
			new QueryCommand({
				TableName: TABLE_NAME,
				KeyConditionExpression: 'PK = :pk AND SK BETWEEN :start AND :end',
				ExpressionAttributeValues: {
					':pk': pk,
					':start': startDate,
					':end': `${endDate}${SK_DATE_UPPER_BOUND}`,
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of res.Items ?? []) {
			items.push(mapItem(item));
		}
		lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);

	return items;
}

export async function findByChildAndDateRange(
	childId: number,
	startDate: string,
	endDate: string,
	tenantId: string,
): Promise<ReportDailySummary[]> {
	const all = await queryByDateRange(tenantId, startDate, endDate);
	return all.filter((r) => r.childId === childId);
}

export async function findByTenantAndDateRange(
	tenantId: string,
	startDate: string,
	endDate: string,
): Promise<ReportDailySummary[]> {
	return queryByDateRange(tenantId, startDate, endDate);
}

export async function upsert(input: InsertReportDailySummaryInput): Promise<void> {
	const key = reportDailySummaryKey(input.childId, input.date, input.tenantId);

	// 既存レコードがあれば id / createdAt を維持 (SQLite onConflictDoUpdate は id を保つ)。
	const existing = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: key,
			ProjectionExpression: 'id, createdAt',
		}),
	);

	const id =
		typeof existing.Item?.id === 'number'
			? (existing.Item.id as number)
			: await nextId(ENTITY_NAMES.reportDailySummary, input.tenantId);
	const createdAt =
		typeof existing.Item?.createdAt === 'string'
			? (existing.Item.createdAt as string)
			: new Date().toISOString();

	const record: ReportDailySummary = {
		id,
		tenantId: input.tenantId,
		childId: input.childId,
		date: input.date,
		activityCount: input.activityCount,
		categoryBreakdown: input.categoryBreakdown,
		checklistCompletion: input.checklistCompletion,
		level: input.level,
		totalPoints: input.totalPoints,
		streakDays: input.streakDays,
		newAchievements: input.newAchievements,
		createdAt,
	};

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: { ...key, ...record },
		}),
	);
}

export async function deleteOlderThan(tenantId: string, cutoffDate: string): Promise<number> {
	const pk = reportDailySummaryTenantPK(tenantId);
	const keys: Array<{ PK: string; SK: string }> = [];
	let lastKey: Record<string, unknown> | undefined;

	// SK = <date>#<childId> なので SK <= <cutoff>￿ が date <= cutoff と等価。
	do {
		const res = await getDocClient().send(
			new QueryCommand({
				TableName: TABLE_NAME,
				KeyConditionExpression: 'PK = :pk AND SK <= :cutoff',
				ExpressionAttributeValues: {
					':pk': pk,
					':cutoff': `${cutoffDate}${SK_DATE_UPPER_BOUND}`,
				},
				ProjectionExpression: 'PK, SK',
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of res.Items ?? []) {
			keys.push({ PK: item.PK as string, SK: item.SK as string });
		}
		lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);

	for (const key of keys) {
		await getDocClient().send(new DeleteCommand({ TableName: TABLE_NAME, Key: key }));
	}
	return keys.length;
}

/** テナントの全日次サマリーを削除 (PK 単一 partition なので exact PK 削除)。 */
export async function deleteByTenantId(tenantId: string): Promise<void> {
	await deleteItemsByExactPk(reportDailySummaryTenantPK(tenantId));
}
