// Demo IReportDailySummaryRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import type { InsertReportDailySummaryInput, ReportDailySummary } from '../types';

export async function findByChildAndDateRange(
	_childId: number,
	_startDate: string,
	_endDate: string,
	_tenantId: string,
): Promise<ReportDailySummary[]> {
	return [];
}

export async function findByTenantAndDateRange(
	_tenantId: string,
	_startDate: string,
	_endDate: string,
): Promise<ReportDailySummary[]> {
	return [];
}

export async function upsert(_input: InsertReportDailySummaryInput): Promise<void> {
	// Stub: no-op
}

export async function deleteOlderThan(_tenantId: string, _cutoffDate: string): Promise<number> {
	return 0;
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
