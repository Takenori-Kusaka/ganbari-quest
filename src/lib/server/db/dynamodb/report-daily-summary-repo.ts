// DynamoDB implementation of IReportDailySummaryRepo
//
// #2263 hotfix: 旧バージョンの未実装エラー throw で本番 500 を引き起こしうるため、
// Pre-PMF fallback (read = 空 / write = no-op + logger.warn) に置換。
// 日次サマリー集計機能は本番未活用 (ADR-0010 Pre-PMF Bucket B = まだ作らない)。

import { logger } from '$lib/server/logger';
import type { InsertReportDailySummaryInput, ReportDailySummary } from '../types';

const SERVICE = 'report-daily-summary-repo.dynamodb';

function warnRead(method: string, context: Record<string, unknown>): void {
	logger.warn(`[${SERVICE}] read fallback: returning empty (Pre-PMF stub, #2263)`, {
		service: SERVICE,
		context: { method, ...context },
	});
}

function warnWrite(method: string, context: Record<string, unknown>): void {
	logger.warn(`[${SERVICE}] write fallback: no-op (Pre-PMF stub, #2263)`, {
		service: SERVICE,
		context: { method, ...context },
	});
}

export async function findByChildAndDateRange(
	childId: number,
	startDate: string,
	endDate: string,
	tenantId: string,
): Promise<ReportDailySummary[]> {
	warnRead('findByChildAndDateRange', { childId, startDate, endDate, tenantId });
	return [];
}

export async function findByTenantAndDateRange(
	tenantId: string,
	startDate: string,
	endDate: string,
): Promise<ReportDailySummary[]> {
	warnRead('findByTenantAndDateRange', { tenantId, startDate, endDate });
	return [];
}

export async function upsert(input: InsertReportDailySummaryInput): Promise<void> {
	warnWrite('upsert', { tenantId: input.tenantId, childId: input.childId, date: input.date });
}

export async function deleteOlderThan(tenantId: string, cutoffDate: string): Promise<number> {
	warnWrite('deleteOlderThan', { tenantId, cutoffDate });
	return 0;
}

/** テナントの全日次サマリーを削除（Pre-PMF fallback: no-op） */
export async function deleteByTenantId(tenantId: string): Promise<void> {
	warnWrite('deleteByTenantId', { tenantId });
}
