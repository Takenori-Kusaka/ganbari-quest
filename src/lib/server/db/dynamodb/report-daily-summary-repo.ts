import type { InsertReportDailySummaryInput, ReportDailySummary } from '../types';

const NOT_IMPL = 'DynamoDB report-daily-summary-repo not implemented';

export async function findByChildAndDateRange(
	_childId: number,
	_startDate: string,
	_endDate: string,
	_tenantId: string,
): Promise<ReportDailySummary[]> {
	throw new Error(NOT_IMPL);
}

export async function findByTenantAndDateRange(
	_tenantId: string,
	_startDate: string,
	_endDate: string,
): Promise<ReportDailySummary[]> {
	throw new Error(NOT_IMPL);
}

export async function upsert(_input: InsertReportDailySummaryInput): Promise<void> {
	throw new Error(NOT_IMPL);
}

export async function deleteOlderThan(_tenantId: string, _cutoffDate: string): Promise<number> {
	throw new Error(NOT_IMPL);
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	throw new Error(NOT_IMPL);
}
