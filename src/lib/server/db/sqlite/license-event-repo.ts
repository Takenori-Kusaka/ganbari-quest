// src/lib/server/db/sqlite/license-event-repo.ts
// SQLite implementation of ILicenseEventRepo (#804)

import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { db } from '../client';
import type {
	InsertLicenseEventInput,
	LicenseEventRow,
	LicenseEventType,
} from '../interfaces/license-event-repo.interface';
import { licenseEvents } from '../schema';

function rowFromRecord(r: typeof licenseEvents.$inferSelect): LicenseEventRow {
	return {
		id: r.id,
		eventType: r.eventType as LicenseEventType,
		licenseKey: r.licenseKey,
		tenantId: r.tenantId,
		actorId: r.actorId,
		ip: r.ip,
		ua: r.ua,
		metadata: r.metadata,
		createdAt: r.createdAt,
	};
}

export async function insert(input: InsertLicenseEventInput): Promise<void> {
	await db.insert(licenseEvents).values({
		eventType: input.eventType,
		licenseKey: input.licenseKey,
		tenantId: input.tenantId ?? null,
		actorId: input.actorId ?? null,
		ip: input.ip ?? null,
		ua: input.ua ?? null,
		metadata:
			input.metadata === undefined || input.metadata === null
				? null
				: JSON.stringify(input.metadata),
	});
}

export async function findByLicenseKey(
	licenseKey: string,
	limit: number,
): Promise<LicenseEventRow[]> {
	const rows = await db
		.select()
		.from(licenseEvents)
		.where(eq(licenseEvents.licenseKey, licenseKey))
		.orderBy(desc(licenseEvents.id))
		.limit(limit);
	return rows.map(rowFromRecord);
}

export async function findRecent(limit: number): Promise<LicenseEventRow[]> {
	const rows = await db.select().from(licenseEvents).orderBy(desc(licenseEvents.id)).limit(limit);
	return rows.map(rowFromRecord);
}

export async function countRecentFailuresByIp(
	windowMinutes: number,
	limit: number,
): Promise<Array<{ ip: string; count: number }>> {
	const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
	const rows = await db
		.select({
			ip: licenseEvents.ip,
			count: sql<number>`count(*)`.as('count'),
		})
		.from(licenseEvents)
		.where(
			and(
				eq(licenseEvents.eventType, 'validation_failed'),
				gte(licenseEvents.createdAt, since),
				isNotNull(licenseEvents.ip),
			),
		)
		.groupBy(licenseEvents.ip)
		.orderBy(desc(sql`count`))
		.limit(limit);
	return rows
		.filter((r): r is { ip: string; count: number } => r.ip !== null)
		.map((r) => ({ ip: r.ip, count: Number(r.count) }));
}
