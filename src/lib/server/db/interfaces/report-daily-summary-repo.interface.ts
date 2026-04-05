import type { InsertReportDailySummaryInput, ReportDailySummary } from '../types/index.js';

export interface IReportDailySummaryRepo {
	findByChildAndDateRange(
		childId: number,
		startDate: string,
		endDate: string,
		tenantId: string,
	): Promise<ReportDailySummary[]>;

	findByTenantAndDateRange(
		tenantId: string,
		startDate: string,
		endDate: string,
	): Promise<ReportDailySummary[]>;

	upsert(input: InsertReportDailySummaryInput): Promise<void>;

	deleteOlderThan(tenantId: string, cutoffDate: string): Promise<number>;
	deleteByTenantId(tenantId: string): Promise<void>;
}
