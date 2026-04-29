// src/lib/server/db/sqlite/graduation-consent-repo.ts
// SQLite implementation of IGraduationConsentRepo (#1603 / ADR-0023 §3.8 / §5 I10)

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../client';
import type {
	CreateGraduationConsentInput,
	GraduationConsentRecord,
	GraduationStats,
} from '../interfaces/graduation-consent-repo.interface';
import { graduationConsent } from '../schema';

const DEFAULT_AGGREGATION_DAYS = 90;
const DEFAULT_PUBLIC_SAMPLE_LIMIT = 20;

function mapRow(row: typeof graduationConsent.$inferSelect): GraduationConsentRecord {
	return {
		id: row.id,
		tenantId: row.tenantId,
		nickname: row.nickname,
		consented: !!row.consented,
		userPoints: row.userPoints,
		usagePeriodDays: row.usagePeriodDays,
		message: row.message ?? null,
		consentedAt: row.consentedAt,
	};
}

export async function create(
	input: CreateGraduationConsentInput,
): Promise<GraduationConsentRecord> {
	const [inserted] = await db
		.insert(graduationConsent)
		.values({
			tenantId: input.tenantId,
			nickname: input.nickname,
			consented: input.consented,
			userPoints: input.userPoints,
			usagePeriodDays: input.usagePeriodDays,
			message: input.message ?? null,
		})
		.returning();
	if (!inserted) {
		throw new Error('Failed to create graduation consent');
	}
	return mapRow(inserted);
}

export async function listByTenant(tenantId: string): Promise<GraduationConsentRecord[]> {
	const rows = await db
		.select()
		.from(graduationConsent)
		.where(eq(graduationConsent.tenantId, tenantId))
		.orderBy(desc(graduationConsent.id));
	return rows.map(mapRow);
}

export async function aggregateRecent(days: number = DEFAULT_AGGREGATION_DAYS): Promise<{
	totalGraduations: number;
	consentedCount: number;
	avgUsagePeriodDays: number;
	publicSamples: GraduationStats['publicSamples'];
}> {
	const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

	const rows = await db
		.select()
		.from(graduationConsent)
		.where(gte(graduationConsent.consentedAt, since))
		.orderBy(desc(graduationConsent.id));

	const records = rows.map(mapRow);
	const totalGraduations = records.length;
	const consentedCount = records.filter((r) => r.consented).length;
	const sumUsage = records.reduce((s, r) => s + r.usagePeriodDays, 0);
	const avgUsagePeriodDays =
		totalGraduations > 0 ? Math.round((sumUsage / totalGraduations) * 10) / 10 : 0;

	// 公開承諾された事例で message があるもの（最新順、最大 20 件）
	const publicSampleRows = await db
		.select()
		.from(graduationConsent)
		.where(
			and(
				eq(graduationConsent.consented, true),
				sql`${graduationConsent.message} IS NOT NULL`,
				sql`${graduationConsent.message} != ''`,
			),
		)
		.orderBy(desc(graduationConsent.id))
		.limit(DEFAULT_PUBLIC_SAMPLE_LIMIT);

	const publicSamples = publicSampleRows.map((r) => ({
		id: r.id,
		nickname: r.nickname,
		userPoints: r.userPoints,
		usagePeriodDays: r.usagePeriodDays,
		message: r.message ?? '',
		consentedAt: r.consentedAt,
	}));

	return {
		totalGraduations,
		consentedCount,
		avgUsagePeriodDays,
		publicSamples,
	};
}

export async function deleteByTenantId(tenantId: string): Promise<void> {
	db.delete(graduationConsent).where(eq(graduationConsent.tenantId, tenantId)).run();
}
