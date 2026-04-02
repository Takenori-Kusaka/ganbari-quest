// src/lib/server/db/sqlite/report-daily-summary-repo.ts
// レポート日次サマリーのリポジトリ層

import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../client';
import { reportDailySummaries } from '../schema';
import type { InsertReportDailySummaryInput, ReportDailySummary } from '../types/index.js';

export async function findByChildAndDateRange(
	childId: number,
	startDate: string,
	endDate: string,
	_tenantId: string,
): Promise<ReportDailySummary[]> {
	return db
		.select()
		.from(reportDailySummaries)
		.where(
			and(
				eq(reportDailySummaries.childId, childId),
				gte(reportDailySummaries.date, startDate),
				lte(reportDailySummaries.date, endDate),
			),
		)
		.all();
}

export async function findByTenantAndDateRange(
	tenantId: string,
	startDate: string,
	endDate: string,
): Promise<ReportDailySummary[]> {
	return db
		.select()
		.from(reportDailySummaries)
		.where(
			and(
				eq(reportDailySummaries.tenantId, tenantId),
				gte(reportDailySummaries.date, startDate),
				lte(reportDailySummaries.date, endDate),
			),
		)
		.all();
}

export async function upsert(input: InsertReportDailySummaryInput): Promise<void> {
	db.insert(reportDailySummaries)
		.values(input)
		.onConflictDoUpdate({
			target: [
				reportDailySummaries.tenantId,
				reportDailySummaries.childId,
				reportDailySummaries.date,
			],
			set: {
				activityCount: sql`excluded.activity_count`,
				categoryBreakdown: sql`excluded.category_breakdown`,
				checklistCompletion: sql`excluded.checklist_completion`,
				level: sql`excluded.level`,
				totalPoints: sql`excluded.total_points`,
				streakDays: sql`excluded.streak_days`,
				newAchievements: sql`excluded.new_achievements`,
			},
		})
		.run();
}

export async function deleteOlderThan(tenantId: string, cutoffDate: string): Promise<number> {
	const result = db
		.delete(reportDailySummaries)
		.where(
			and(eq(reportDailySummaries.tenantId, tenantId), lte(reportDailySummaries.date, cutoffDate)),
		)
		.run();
	return result.changes;
}
