import type { ChildId } from '$lib/domain/ids';
import type { InsertReportDailySummaryInput, ReportDailySummary } from '../types/index.js';

export interface IReportDailySummaryRepo {
	findByChildAndDateRange(
		childId: ChildId,
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
