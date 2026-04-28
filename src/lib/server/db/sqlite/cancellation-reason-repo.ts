// src/lib/server/db/sqlite/cancellation-reason-repo.ts
// SQLite implementation of ICancellationReasonRepo (#1596 / ADR-0023 §3.8 / I3)

import { and, desc, eq, gte, like, sql } from 'drizzle-orm';
import type { CancellationCategory } from '$lib/domain/labels';
import { CANCELLATION_CATEGORIES } from '$lib/domain/labels';
import { db } from '../client';
import type {
	CancellationReasonAggregation,
	CancellationReasonRecord,
	CreateCancellationReasonInput,
} from '../interfaces/cancellation-reason-repo.interface';
import { cancellationReasons } from '../schema';

const DEFAULT_AGGREGATION_DAYS = 90;
const DEFAULT_FREE_TEXT_SEARCH_LIMIT = 50;

function mapRow(row: typeof cancellationReasons.$inferSelect): CancellationReasonRecord {
	return {
		id: row.id,
		tenantId: row.tenantId,
		category: row.category as CancellationCategory,
		freeText: row.freeText ?? null,
		planAtCancellation: row.planAtCancellation ?? null,
		stripeSubscriptionId: row.stripeSubscriptionId ?? null,
		createdAt: row.createdAt,
	};
}

export async function create(
	input: CreateCancellationReasonInput,
): Promise<CancellationReasonRecord> {
	const [inserted] = await db
		.insert(cancellationReasons)
		.values({
			tenantId: input.tenantId,
			category: input.category,
			freeText: input.freeText ?? null,
			planAtCancellation: input.planAtCancellation ?? null,
			stripeSubscriptionId: input.stripeSubscriptionId ?? null,
		})
		.returning();
	if (!inserted) {
		throw new Error('Failed to create cancellation reason');
	}
	return mapRow(inserted);
}

export async function listByTenant(tenantId: string): Promise<CancellationReasonRecord[]> {
	const rows = await db
		.select()
		.from(cancellationReasons)
		.where(eq(cancellationReasons.tenantId, tenantId))
		.orderBy(desc(cancellationReasons.id));
	return rows.map(mapRow);
}

export async function aggregateRecent(days: number = DEFAULT_AGGREGATION_DAYS): Promise<{
	total: number;
	breakdown: CancellationReasonAggregation[];
}> {
	const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
	const rows = await db
		.select({
			category: cancellationReasons.category,
			count: sql<number>`count(*)`,
		})
		.from(cancellationReasons)
		.where(gte(cancellationReasons.createdAt, since))
		.groupBy(cancellationReasons.category);

	const total = rows.reduce((sum, r) => sum + Number(r.count), 0);

	// 全カテゴリを 0 件で初期化してから集計値を埋める（UI で 3 行常に表示）
	const breakdown: CancellationReasonAggregation[] = CANCELLATION_CATEGORIES.map((cat) => {
		const found = rows.find((r) => r.category === cat);
		const count = found ? Number(found.count) : 0;
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
	const rows = trimmed
		? await db
				.select()
				.from(cancellationReasons)
				.where(
					and(
						sql`${cancellationReasons.freeText} IS NOT NULL`,
						sql`${cancellationReasons.freeText} != ''`,
						like(cancellationReasons.freeText, `%${trimmed}%`),
					),
				)
				.orderBy(desc(cancellationReasons.id))
				.limit(limit)
		: await db
				.select()
				.from(cancellationReasons)
				.where(
					and(
						sql`${cancellationReasons.freeText} IS NOT NULL`,
						sql`${cancellationReasons.freeText} != ''`,
					),
				)
				.orderBy(desc(cancellationReasons.id))
				.limit(limit);
	return rows.map(mapRow);
}

export async function deleteByTenantId(tenantId: string): Promise<void> {
	db.delete(cancellationReasons).where(eq(cancellationReasons.tenantId, tenantId)).run();
}
