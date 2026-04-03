import { and, count, desc, eq, lt, sql } from 'drizzle-orm';
import { db } from '../client';
import { cloudExports } from '../schema';
import type { CloudExportRecord, InsertCloudExportInput } from '../types';

/** Drizzle の text カラムは string に推論されるので CloudExportRecord にキャスト */
function toRecord(row: typeof cloudExports.$inferSelect): CloudExportRecord {
	return row as unknown as CloudExportRecord;
}

export async function findByTenant(tenantId: string): Promise<CloudExportRecord[]> {
	const rows = await db
		.select()
		.from(cloudExports)
		.where(eq(cloudExports.tenantId, tenantId))
		.orderBy(desc(cloudExports.createdAt))
		.all();
	return rows.map(toRecord);
}

export async function findByPin(pinCode: string): Promise<CloudExportRecord | undefined> {
	const row = db.select().from(cloudExports).where(eq(cloudExports.pinCode, pinCode)).get();
	return row ? toRecord(row) : undefined;
}

export async function findById(
	id: number,
	tenantId: string,
): Promise<CloudExportRecord | undefined> {
	const row = db
		.select()
		.from(cloudExports)
		.where(and(eq(cloudExports.id, id), eq(cloudExports.tenantId, tenantId)))
		.get();
	return row ? toRecord(row) : undefined;
}

export async function insert(input: InsertCloudExportInput): Promise<CloudExportRecord> {
	const now = new Date().toISOString();
	const row = db
		.insert(cloudExports)
		.values({
			tenantId: input.tenantId,
			exportType: input.exportType,
			pinCode: input.pinCode,
			s3Key: input.s3Key,
			fileSizeBytes: input.fileSizeBytes,
			label: input.label ?? null,
			description: input.description ?? null,
			expiresAt: input.expiresAt,
			maxDownloads: input.maxDownloads ?? 10,
			createdAt: now,
		})
		.returning()
		.get();
	return toRecord(row);
}

export async function incrementDownloadCount(id: number): Promise<void> {
	db.update(cloudExports)
		.set({ downloadCount: sql`${cloudExports.downloadCount} + 1` })
		.where(eq(cloudExports.id, id))
		.run();
}

export async function deleteById(id: number, tenantId: string): Promise<void> {
	db.delete(cloudExports)
		.where(and(eq(cloudExports.id, id), eq(cloudExports.tenantId, tenantId)))
		.run();
}

export async function deleteExpired(now: string): Promise<number> {
	const result = db.delete(cloudExports).where(lt(cloudExports.expiresAt, now)).run();
	return result.changes;
}

export async function countByTenant(tenantId: string): Promise<number> {
	const result = db
		.select({ value: count() })
		.from(cloudExports)
		.where(eq(cloudExports.tenantId, tenantId))
		.get();
	return result?.value ?? 0;
}
